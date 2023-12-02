//----------------------------------------------------------------------
//    WORKERS 
//----------------------------------------------------------------------

import { Timestamp, WorkerName, Value, TimeUnit } from './io_api_definitions'
import { topElemAfterSort, randomlyPickedByWeigths, arrayWithModifiedWeightOfAnElement, WeightedElement, SortStrategy } from "./helpers.js"
import { LogEntry, LogEntryType } from './logging.js'
import { ValueChain } from './valuechain.js'
import { WorkItem, WiExtInfoElem, WiExtInfoTuple, WorkItemExtendedInfos } from './workitem.js'
import { ProcessStep } from './workitembasketholder.js'
import { LonelyLobsterSystem } from './system'


//----------------------------------------------------------------------
//    WORKER BEHAVIOUR 
//----------------------------------------------------------------------

 function selectedNextWorkItemBySortVector(wis: WorkItem[], sost: SortStrategy): WorkItem { // take the top-ranked work item after sorting the accessible work items
    const extInfoTuples: WiExtInfoTuple[] = wis.map(wi => wi.extendedInfos.workOrderExtendedInfos) 
    const selectedWi: WiExtInfoTuple = topElemAfterSort(extInfoTuples, sost)
    return selectedWi[WiExtInfoElem.workItem]  // return workitem object reference
} 

//----------------------------------------------------------------------
//    WORKER LOGGING 
//----------------------------------------------------------------------

abstract class LogEntryWorker extends LogEntry {
    constructor(       sys:          LonelyLobsterSystem,
                       logEntryType: LogEntryType,
                public worker:       Worker) {
        super(sys, logEntryType)
    }
} 

class LogEntryWorkerWorked extends LogEntryWorker {
    constructor(sys:     LonelyLobsterSystem,
                worker:  Worker) {
        super(sys, LogEntryType.workerWorked, worker)
    }
    public stringified = (): string => `${this.stringifiedLe()}, ${this.logEntryType}, wo=${this.worker.id}` 
} 

class LogEntryWorkerLearnedAndAdapted extends LogEntryWorker {
    constructor (       sys:                                        LonelyLobsterSystem,
                        worker:                                     Worker,
                 public individualValueContributionOfEndingPeriod:  Value,
                 public adjustedWeightedSortStrategy:               WeightedSortStrategy,
                 public chosenWeightedSortStrategy:                 WeightedSortStrategy) {
        super(sys, LogEntryType.workerLearnedAndAdapted, worker)
    }
    public stringified = () => `${this.stringifiedLe()}, ${this.worker.id},` +
                               `ivc=${this.individualValueContributionOfEndingPeriod}, ` +
                               `adjusted wsost of ending period: ${this.adjustedWeightedSortStrategy.weight}:[${this.adjustedWeightedSortStrategy.element.map(sost => `${sost.colIndex}/${sost.selCrit}`)}],  ` +
                               `newly chosen: ${this.chosenWeightedSortStrategy.weight}:[${this.chosenWeightedSortStrategy.element.map(sost => `${sost.colIndex}/${sost.selCrit}`)}]\n`
} 

//----------------------------------------------------------------------
//    ASSIGNMENTS OF WORKERS TO PROCESS STEPS
//----------------------------------------------------------------------

export interface Assignment {
    valueChainProcessStep: ValueChainProcessStep
    worker:                Worker
}

export class AssignmentSet {
    public assignments: Assignment[] = []
    constructor(public id: string) {}

    public addAssignment(as: Assignment) {
        this.assignments.push(as)
    }
}

//----------------------------------------------------------------------
//    WORKER 
//----------------------------------------------------------------------

type ValueChainProcessStep = {
    valueChain:  ValueChain,
    processStep: ProcessStep
}

type WorkerStats = {
    assignments: ValueChainProcessStep[],  
    utilization: number // in percent, i.e. 55 is 55%
}

export type WeightedSortStrategy = WeightedElement<SortStrategy>

const observationPeriod: TimeUnit = 20   // <= should come via the config json file sometime
const weightAdjustmentFactor: number  = 0.3

// --- WORKER class --------------------------------------
export class Worker {
    logWorkerWorked:            LogEntryWorkerWorked[]  = []
    logWorkerLearnedAndAdapted: LogEntryWorkerLearnedAndAdapted[]  = []
    stats:                      WorkerStats      = { assignments: [], utilization: 0 }

    constructor(private sys:                        LonelyLobsterSystem,
                public  id:                         WorkerName,
                public  weightedSortStrategies:     WeightedSortStrategy[]) {
        console.log(`${this.id}'s available weighted sort strategies: ${this.weightedSortStrategies.map(wsost => `${wsost.weight}:[${wsost.element.map(sost => `${sost.colIndex}/${sost.selCrit}`)}]` )}`)
        this.logLearnedAndAdapted(0, this.weightedSortStrategies[0], this.weightedSortStrategies[0]) // initialize worker's learning & adaption log
    }

    private logWorked(): void { this.logWorkerWorked.push(new LogEntryWorkerWorked(this.sys, this)) }

    private logLearnedAndAdapted(ivc: Value, adjustedWeightedSost: WeightedSortStrategy, ChosenWeightedSost: WeightedSortStrategy): void { this.logWorkerLearnedAndAdapted.push(new LogEntryWorkerLearnedAndAdapted(this.sys, this, ivc, adjustedWeightedSost, ChosenWeightedSost)) }

    private  workItemsAtHand(asSet: AssignmentSet): WorkItem[] {
        const pss: ProcessStep[] = asSet.assignments.filter(as => as.worker.id == this.id).map(as => as.valueChainProcessStep.processStep)
        return pss.flatMap(ps => ps.workItemBasket) 
    }

    private hasWorkedAt(timestamp: Timestamp): boolean { 
        return this.logWorkerWorked.filter(le => le.timestamp == timestamp).length > 0
    }

    public work(asSet: AssignmentSet): void {

        // --- learning and adaption -----
        if (this.sys.clock.time > 0 && this.sys.clock.time % observationPeriod == 0) this.adjustOldAndChooseNewSortStrategy()

        // --- working -----
        if (this.hasWorkedAt(this.sys.clock.time)) return    // worker has already worked at current time

        const workableWorkItemsAtHand: WorkItem[] = this.workItemsAtHand(asSet)
                                                    .filter(wi => !wi.finishedAtCurrentProcessStep())               // not yet in OutputBasket
                                                    .filter(wi => !wi.hasBeenWorkedOnAtCurrentTime(this.sys.clock.time))     // no one worked on it at current time

        if (workableWorkItemsAtHand.length == 0) return // no workable workitems at hand

        if(this.sys.debugShowOptions.workerChoices) console.log("Worker__" + WorkItemExtendedInfos.stringifiedHeader())
        if(this.sys.debugShowOptions.workerChoices) workableWorkItemsAtHand.forEach(wi => console.log(`${this.id.padEnd(6, ' ')}: ${wi.extendedInfos.stringifiedDataLine()}`)) // ***

        //this.chosenSortStrategy = this.weightedSortStrategys[0].sortStrategy // <== here goes the learning logic tbc

        const wi: WorkItem = selectedNextWorkItemBySortVector(workableWorkItemsAtHand, this.currentSortStrategy)

        if(this.sys.debugShowOptions.workerChoices) console.log(`=> ${this.id} picked: ${wi.id}|${wi.tag[0]}`)

        wi.logWorkedOn(this)
        this.logWorked()

        //console.log(`${this.id} worked in ${wi.log[0].workItemBasketHolder.id} on ${wi.id}; (s)he's realized an individual value contribution of : ${this.individualValueContribution(0, this.sys.clock.time).toPrecision(2)}`)
    }

    public utilization(sys: LonelyLobsterSystem): void {
        this.stats.utilization = this.logWorked.length / (this.sys.clock.time - this.sys.clock.firstIteration) * 100 
        this.stats.assignments = sys.assignmentSet.assignments
                                .filter(a => a.worker.id == this.id)
                                .map(a => { return { valueChain:  a.valueChainProcessStep.valueChain,
                                                     processStep: a.valueChainProcessStep.processStep }
                                            })
    }

    //----------------------------------------------------------------------
    //    Learning & Adaption 
    //----------------------------------------------------------------------

    private individualValueContribution(fromTime: Timestamp, toTime: Timestamp): Value {
        return this.sys.outputBasket.workItemBasket.map((wi: WorkItem) => wi.workerValueContribution(this, fromTime, toTime)).reduce((a, b) => a + b, 0)
    } 

    private get individualValueContributionEndingPeriod(): Value {
        return this.individualValueContribution(this.sys.clock.time - observationPeriod < 0 ? 0 : this.sys.clock.time - observationPeriod, this.sys.clock.time)
    } 

    private get individualValueContributionPeriodBefore(): Value {
        return (this.logWorkerLearnedAndAdapted[this.logWorkerLearnedAndAdapted.length - 1]).individualValueContributionOfEndingPeriod
    }

    private get currentWeightedSortStrategy(): WeightedSortStrategy {
        return this.logWorkerLearnedAndAdapted[this.logWorkerLearnedAndAdapted.length - 1].chosenWeightedSortStrategy
    }

    private get currentSortStrategy(): SortStrategy {
        return this.currentWeightedSortStrategy.element
    }

    private adjustOldAndChooseNewSortStrategy(): void {
        this.weightedSortStrategies = arrayWithModifiedWeightOfAnElement<SortStrategy>(
                this.weightedSortStrategies, 
                this.currentWeightedSortStrategy, 
                this.weightAdjustment(this.individualValueContributionEndingPeriod, this.individualValueContributionPeriodBefore))
        this.logLearnedAndAdapted(this.individualValueContributionEndingPeriod, 
                                  this.currentWeightedSortStrategy,
                                  randomlyPickedByWeigths<SortStrategy>(this.weightedSortStrategies))
        console.log(`${this.id}'s normalized weighted strategies: ${this.weightedSortStrategies.map(wsost => wsost.weight.toPrecision(2) + ":[" + wsost.element.map(sv => sv.colIndex + "/" + sv.selCrit) + "]")}, 
                      chosen strategy: ${this.currentSortStrategy.map(sv => sv.colIndex + "/" + sv.selCrit)}`)
        console.log(`${this.id}'s log:\n ${this.logWorkerLearnedAndAdapted.map(le => le.stringified())}`)
        console.log(`${this.id}'s available weighted sort strategies: ${this.weightedSortStrategies.map(wsost => `${wsost.weight}:[${wsost.element.map(sost => `${sost.colIndex}/${sost.selCrit}`)}]` )}`)
    }

    private weightAdjustment(ivcEndingPeriod: Value, ivcPeriodBefore: Value): number {
        return (ivcEndingPeriod > ivcPeriodBefore ? 1 : -1) * 0.3
    }

}
