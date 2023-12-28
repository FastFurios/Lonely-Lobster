//----------------------------------------------------------------------
//    WORKERS 
//----------------------------------------------------------------------

import { Timestamp, WorkerName, Value, TimeUnit } from './io_api_definitions'
import { topElemAfterSort, randomlyPickedByWeigths, arrayWithModifiedWeightOfAnElement, WeightedElement, SortVectorSequence, arrayWithNormalizedWeights } from "./helpers.js"
import { LogEntry, LogEntryType } from './logging.js'
import { ValueChain } from './valuechain.js'
import { WorkItem, WiExtInfoElem, WiExtInfoTuple, WorkItemExtendedInfos } from './workitem.js'
import { ProcessStep } from './workitembasketholder.js'
import { LonelyLobsterSystem } from './system'


//----------------------------------------------------------------------
//    WORKER BEHAVIOUR 
//----------------------------------------------------------------------

export interface SelectionStrategy {
    id:         string
    strategy:   SortVectorSequence
}

function selectedNextWorkItemBySortVector(wis: WorkItem[], sest: SortVectorSequence): WorkItem { // take the top-ranked work item after sorting the accessible work items
    const extInfoTuples: WiExtInfoTuple[] = wis.map(wi => wi.extendedInfos.workOrderExtendedInfos) 
    const selectedWi: WiExtInfoTuple = topElemAfterSort(extInfoTuples, sest)
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

/* no export */ export class LogEntryWorkerLearnedAndAdapted extends LogEntryWorker {
    constructor (       sys:                                        LonelyLobsterSystem,
                        worker:                                     Worker,
                 public individualValueContributionOfEndingPeriod:  Value,
                 public adjustedSelectionStrategy:                  SelectionStrategy,
                 public chosenSelectionStrategy:                    SelectionStrategy,
                 public weigthedSelectionStrategies:                WeightedSelectionStrategy[] ) {
        super(sys, LogEntryType.workerLearnedAndAdapted, worker)
    }

    private stringifiedWeightedSelectionStrategies = (): string => `\tweighted selection strategies:\n` +
        this.weigthedSelectionStrategies.map(wsest => "\t\t" + wsest.element.id + ": \t" + wsest.weight.toPrecision(2) + "\n")
                                        .reduce((a, b) => a + b)

    public stringified = () => `${this.stringifiedLe()}, ${this.worker.id},` +
                               `ivc=${this.individualValueContributionOfEndingPeriod.toPrecision(2)}, ` +
                               `adjusted strategy: [${this.adjustedSelectionStrategy.id}],  ` +
                               `newly chosen: [${this.chosenSelectionStrategy.id}]\n` +
                               this.stringifiedWeightedSelectionStrategies()

    public plainFacts = (header: boolean) => 
        header  ? `time; worker; ivc; adjusted; ${this.weigthedSelectionStrategies.map(wsest => `${wsest.element.id};`).reduce((a, b) => a + b)}` + "chosen" 
                : `${this.timestamp}; ${this.worker.id};` +
                  `${this.individualValueContributionOfEndingPeriod.toPrecision(2)};` +
                  `${this.adjustedSelectionStrategy.id};` +
                  `${this.weigthedSelectionStrategies.map(wsest => `${wsest.weight.toPrecision(2)};`).reduce((a, b) => a + b)}` + 
                  `${this.chosenSelectionStrategy.id}`
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
    assignments:                    ValueChainProcessStep[],  
    utilization:                    number, // in percent, i.e. 55 is 55%
    weigthedSelectionStrategies?:   WeightedSelectionStrategy[]
}

export type WeightedSelectionStrategy = WeightedElement<SelectionStrategy>

const observationPeriod: TimeUnit = 20   // <= should come via the config json file sometime
const weightAdjustmentFactor: number  = 0.3 // <= should come via the config json file sometime

// --- WORKER class --------------------------------------
export class Worker {
    /* private */ logWorker:    LogEntryWorker[] = []
    stats:                      WorkerStats      = { assignments: [], utilization: 0 }

    constructor(private sys:                            LonelyLobsterSystem,
                public  id:                             WorkerName,
                        weightedSelectionStrategies:    WeightedSelectionStrategy[]) {
        this.logEventLearnedAndAdapted(0, weightedSelectionStrategies[0].element, weightedSelectionStrategies[0].element, weightedSelectionStrategies) // initialize worker's learning & adaption log
    }

    private logEventWorked(): void { this.logWorker.push(new LogEntryWorkerWorked(this.sys, this)) }

    private logEventLearnedAndAdapted(ivc: Value, adjustedSest: SelectionStrategy, chosenSest: SelectionStrategy, weightedSelectionStrategies: WeightedSelectionStrategy[]): void { 
        this.logWorker.push(new LogEntryWorkerLearnedAndAdapted(this.sys, this, ivc, adjustedSest, chosenSest, weightedSelectionStrategies))
    }

    private get logWorkerWorked(): LogEntryWorkerWorked[] { return this.logWorker.filter(le => le.logEntryType == LogEntryType.workerWorked) }

    private get logWorkerLearnedAndAdapted(): LogEntryWorkerLearnedAndAdapted[] { return <LogEntryWorkerLearnedAndAdapted[]>this.logWorker.filter(le => le.logEntryType == LogEntryType.workerLearnedAndAdapted) }

    private  workItemsAtHand(asSet: AssignmentSet): WorkItem[] {
        const pss: ProcessStep[] = asSet.assignments.filter(as => as.worker.id == this.id).map(as => as.valueChainProcessStep.processStep)
        return pss.flatMap(ps => ps.workItemBasket) 
    }

    private hasWorkedAt(timestamp: Timestamp): boolean { 
        return this.logWorkerWorked.filter(le => le.timestamp == timestamp).length > 0
    }

    public work(asSet: AssignmentSet): void {
        // --- learning and adaption -----
        if (this.sys.clock.time > 0 && this.sys.clock.time % observationPeriod == 0) this.adjustWeightAndChooseNewSelectionStrategy()

        // --- working -----
        if (this.hasWorkedAt(this.sys.clock.time)) return    // worker has already worked at current time

        const workableWorkItemsAtHand: WorkItem[] = this.workItemsAtHand(asSet)
                                                    .filter(wi => !wi.finishedAtCurrentProcessStep())               // not yet in OutputBasket
                                                    .filter(wi => !wi.hasBeenWorkedOnAtCurrentTime(this.sys.clock.time))     // no one worked on it at current time

        if (workableWorkItemsAtHand.length == 0) return // no workable workitems at hand

        if(this.sys.debugShowOptions.workerChoices) console.log("Worker__" + WorkItemExtendedInfos.stringifiedHeader())
        if(this.sys.debugShowOptions.workerChoices) workableWorkItemsAtHand.forEach(wi => console.log(`${this.id.padEnd(6, ' ')}: ${wi.extendedInfos.stringifiedDataLine()}`)) // ***

        const wi: WorkItem = selectedNextWorkItemBySortVector(workableWorkItemsAtHand, this.currentSelectionStrategy.strategy)

        if(this.sys.debugShowOptions.workerChoices) console.log(`=> ${this.id} picked: ${wi.id}|${wi.tag[0]}`)

        wi.logWorkedOn(this)
        this.logEventWorked()
    }

    public utilization(sys: LonelyLobsterSystem): void {
        this.stats.utilization = this.logWorkerWorked.length / (this.sys.clock.time - this.sys.clock.firstIteration) * 100 
        this.stats.assignments = sys.assignmentSet.assignments
                                .filter(a => a.worker.id == this.id)
                                .map(a => { return { valueChain:  a.valueChainProcessStep.valueChain,
                                                     processStep: a.valueChainProcessStep.processStep }
                                            })
        this.stats.weigthedSelectionStrategies = this.currentWeightedSelectionStrategies                         
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

    private get currentSelectionStrategy(): SelectionStrategy {
        return this.logWorkerLearnedAndAdapted[this.logWorkerLearnedAndAdapted.length - 1].chosenSelectionStrategy
    }

    public /* */ get currentWeightedSelectionStrategies(): WeightedSelectionStrategy[] {
        return this.logWorkerLearnedAndAdapted[this.logWorkerLearnedAndAdapted.length - 1].weigthedSelectionStrategies
    }

    private adjustWeightAndChooseNewSelectionStrategy(): void {
        //console.log("\nt = " + this.sys.clock.time + ": ----------------------------------------------------------")
        const ivcep = this.individualValueContributionEndingPeriod
        //console.log(`${this.id}'s IVC of ending period is: ${ivcep.toPrecision(2)}`)

        // console.log("adjusting: before: " + this.id + ": " + this.logWorker.filter(le => le.logEntryType == LogEntryType.workerLearnedAndAdapted).reverse()[0].stringified() + "\n")

        const weightIncrease = this.weightAdjustment(ivcep, this.individualValueContributionPeriodBefore)
        //console.log("adjusting: " + this.id + ": newWeight = " + weightIncrease)
        const modifiedWeightedSelectionStrategies = arrayWithModifiedWeightOfAnElement<SelectionStrategy>(this.currentWeightedSelectionStrategies, 
                                                                                                          this.currentSelectionStrategy, 
                                                                                                          weightIncrease)
        //console.log("adjusting: " + this.id + ": modifiedWeightedSelectionStrategies = " + modifiedWeightedSelectionStrategies.map(wsest => "\n" + wsest.weight.toPrecision(2) + ": " + wsest.element.id))
        const newNormedWeightedSelectionStrategies = arrayWithNormalizedWeights<SelectionStrategy>(modifiedWeightedSelectionStrategies, this.ensuredMinimum)
        //console.log("adjusting: " + this.id + ": this.weightedSelectionStrategies = " + this.currentWeightedSelectionStrategies.map(wsest => "\n" + wsest.weight.toPrecision(2) + ": " + wsest.element.id))
        const nextSelectionStrategy = newNormedWeightedSelectionStrategies?.length > 0  ? randomlyPickedByWeigths<SelectionStrategy>(newNormedWeightedSelectionStrategies, this.ensuredMinimum) : this.currentSelectionStrategy
        //console.log("adjusting: " + this.id + ": nextSelectionStrategy = " + nextSelectionStrategy.id)
        this.logEventLearnedAndAdapted(ivcep, this.currentSelectionStrategy, nextSelectionStrategy, newNormedWeightedSelectionStrategies)
        //console.log("adjusting: " + this.id + ": showing logEventLearnedAndAdapted log entries:" + this.logWorker.filter(le => le.logEntryType == LogEntryType.workerLearnedAndAdapted).map(le => "\n" + le.stringified()))
    }

    private ensuredMinimum(w: number): number {
        return w < 0.01 ? 0.01 : w
    }

    private weightAdjustment(ivcEndingPeriod: Value, ivcPeriodBefore: Value): number {
        return (ivcEndingPeriod > ivcPeriodBefore ? 1 
                                                  : ivcEndingPeriod < ivcPeriodBefore ? -1 : 0) * weightAdjustmentFactor
    }
}
