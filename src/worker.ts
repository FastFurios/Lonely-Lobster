//----------------------------------------------------------------------
//    WORKERS 
//----------------------------------------------------------------------

import { Timestamp, WorkerName, Value, TimeUnit } from './io_api_definitions'
import { topElemAfterSort, SortVector, SortVectorSequence } from "./helpers.js"
import { LogEntry, LogEntryType } from './logging.js'
import { ValueChain } from './valuechain.js'
import { WorkItem, WiExtInfoElem, WiExtInfoTuple, WorkItemExtendedInfos } from './workitem.js'
import { ProcessStep } from './workitembasketholder.js'
import { LonelyLobsterSystem } from './system'


//----------------------------------------------------------------------
//    WORKER BEHAVIOUR 
//----------------------------------------------------------------------

 function selectedNextWorkItemBySortVector(wis: WorkItem[], svs: SortVectorSequence): WorkItem { // take the top-ranked work item after sorting the accessible work items
    const extInfoTuples: WiExtInfoTuple[] = wis.map(wi => wi.extendedInfos.workOrderExtendedInfos) 
    const selectedWi: WiExtInfoTuple = topElemAfterSort(extInfoTuples, svs)
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

class LogEntryWorkerAdjustedSortVectorSequenceWeight extends LogEntryWorker {
    public adjustedWeightedSortVectorSequence: WeightedSortVectorSequence
    constructor (       sys:                                        LonelyLobsterSystem,
                        worker:                                     Worker,
                 public individualValueContributionOfPeriodBefore:  Value,
                 public adjustedWeightedSortVectorSequencesIndex:   number, // index into weightedSortVectorSequences array of class Worker
                 public weightAdjustmentFactor:                     number) {
        super(sys, LogEntryType.workerAdjustedSortVectorSequenceWeight, worker)
        this.adjustedWeightedSortVectorSequence = worker.weightedSortVectorSequences[adjustedWeightedSortVectorSequencesIndex]
    }
    public stringified = () => `${this.stringifiedLe()}, ${this.logEntryType}, wo = ${this.worker.id}, chosen svs = ${this.adjustedWeightedSortVectorSequence.sortVectorSequence.map(svs => `${svs.colIndex}/${svs.selCrit}`)}, new weight=${this.adjustedWeightedSortVectorSequence.relativeWeight}`
} 

class LogEntryWorkerChoseWeightedSortVectorSequence extends LogEntryWorker {
    public chosenWeightedSortVectorSequence: WeightedSortVectorSequence
    constructor (       sys:                                        LonelyLobsterSystem,
                        worker:                                     Worker,
                 public chosenWeightedSortVectorSequenceIndex:      number) {
        super(sys, LogEntryType.workerChoseWeightedSortVectorSequence, worker)
        this.chosenWeightedSortVectorSequence = worker.weightedSortVectorSequences[chosenWeightedSortVectorSequenceIndex]
    }
    public stringified = () => `${this.stringifiedLe()}, ${this.logEntryType}, wo = ${this.worker.id}, chosen svs = ${this.chosenWeightedSortVectorSequence.sortVectorSequence.map(svs => `${svs.colIndex}/${svs.selCrit}`)}`
} 

type LogEntryWorkerAdapted = LogEntryWorkerChoseWeightedSortVectorSequence | LogEntryWorkerAdjustedSortVectorSequenceWeight

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

interface ValueChainProcessStep {
    valueChain:  ValueChain,
    processStep: ProcessStep
}

type WorkerStats = {
    assignments: ValueChainProcessStep[],  
    utilization: number // in percent, i.e. 55 is 55%
}

export type WeightedSortVectorSequence = {
    sortVectorSequence: SortVectorSequence,
    relativeWeight:     number // range 0 to 1; sum of all in a WeightedSortVectorSequences should be 1
}
export type WeightedSortVectorSequences = WeightedSortVectorSequence[]


const observationPeriod: TimeUnit = 20   // <= should come via the config json file sometime
const weightAdjustmentFactor: number  = 0.3


export class Worker {
    logWorkerWorked:          LogEntryWorkerWorked[] = []
    logWorkerAdapted:         LogEntryWorkerAdapted[] = []
    chosenSortVectorSequence!:SortVectorSequence // will be initialized in "initializeLearningAndAdaption()"
    stats:                    WorkerStats      = { assignments: [], utilization: 0 }

    constructor(private sys:                            LonelyLobsterSystem,
                public  id:                             WorkerName,
                public  weightedSortVectorSequences:    WeightedSortVectorSequences) {
        this.initializeLearningAndAdaption()
    }

    private logWorked(): void { this.logWorkerWorked.push(new LogEntryWorkerWorked(this.sys, this)) }

    private  workItemsAtHand(asSet: AssignmentSet): WorkItem[] {
        const pss: ProcessStep[] = asSet.assignments.filter(as => as.worker.id == this.id).map(as => as.valueChainProcessStep.processStep)
        return pss.flatMap(ps => ps.workItemBasket) 
    }

    private hasWorkedAt(timestamp: Timestamp): boolean { 
        return this.logWorkerWorked.filter(le => le.timestamp == timestamp).length > 0
    }

    public work(asSet: AssignmentSet): void {

        // --- learning and adaption -----
        if (this.sys.clock.time != 0 && this.sys.clock.time % observationPeriod == 0) {
            console.log(`${this.id} adjusting weighted svss and choosing a svs...`)
            this.adjustChosenSortVectorSequence(this.individualValueContribution(this.sys.clock.time - observationPeriod < 0 ? 0 : this.sys.clock.time - observationPeriod, this.sys.clock.time), 
                                                this.individualValueContributionOfPeriodBefore())
            this.choseSortVectorSequence()
        }

        // --- working -----
        if (this.hasWorkedAt(this.sys.clock.time)) return    // worker has already worked at current time

        const workableWorkItemsAtHand: WorkItem[] = this.workItemsAtHand(asSet)
                                                    .filter(wi => !wi.finishedAtCurrentProcessStep())               // not yet in OutputBasket
                                                    .filter(wi => !wi.hasBeenWorkedOnAtCurrentTime(this.sys.clock.time))     // no one worked on it at current time

        if (workableWorkItemsAtHand.length == 0) return // no workable workitems at hand

        if(this.sys.debugShowOptions.workerChoices) console.log("Worker__" + WorkItemExtendedInfos.stringifiedHeader())
        if(this.sys.debugShowOptions.workerChoices) workableWorkItemsAtHand.forEach(wi => console.log(`${this.id.padEnd(6, ' ')}: ${wi.extendedInfos.stringifiedDataLine()}`)) // ***

        this.chosenSortVectorSequence = this.weightedSortVectorSequences[0].sortVectorSequence // <== here goes the learning logic tbc

        const wi: WorkItem = selectedNextWorkItemBySortVector(workableWorkItemsAtHand, this.chosenSortVectorSequence)

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

    private initializeLearningAndAdaption(): void {
        console.log(`${this.id} had available weighted sort vec seqs: ${this.weightedSortVectorSequences.map(wsvs => `weight=${wsvs.relativeWeight} svs=${wsvs.sortVectorSequence.map(svs => `${svs.colIndex}/${svs.selCrit}`)}` )}`)
        this.normalizeSortVectorSequencesWeights()    
        console.log(`${this.id} now has available weighted sort vec seqs: ${this.weightedSortVectorSequences.map(wsvs => `weight=${wsvs.relativeWeight} svs=${wsvs.sortVectorSequence.map(svs => `${svs.colIndex}/${svs.selCrit}`)}` )}`)

        // initialize worker's learning & adaption log
        this.logWorkerAdapted.push(new LogEntryWorkerAdjustedSortVectorSequenceWeight(this.sys, this, /*individualValueContributionOfLastPeriod=*/0, 0, 0)) // set individualValueContributionOfLastPeriod = 0
        this.logWorkerAdapted.push(new LogEntryWorkerChoseWeightedSortVectorSequence(this.sys, this, 0)) // chose the first available weighted sort vector sequence for the start
        this.choseSortVectorSequence()
    }

    private normalizeSortVectorSequencesWeights(): void {
        //console.log(`${this.id} wsvs weights were: ${this.weightedSortVectorSequences.map(wsvs => wsvs.relativeWeight.toPrecision(2))}`)
        const sum = this.weightedSortVectorSequences.map(wsvs => wsvs.relativeWeight).reduce((a, b) => a + b, 0)
        if (sum > 0) 
            for (let wsvs of this.weightedSortVectorSequences)
                wsvs.relativeWeight /= sum 
        else // if for whatever reason all weights are set to 0
            for (let wsvs of this.weightedSortVectorSequences)
                wsvs.relativeWeight = 1 / this.weightedSortVectorSequences.length
        //console.log(`${this.id} wsvs weights are now: ${this.weightedSortVectorSequences.map(wsvs => wsvs.relativeWeight.toPrecision(2))}`)
    }

    public individualValueContribution(fromTime: Timestamp, toTime: Timestamp): Value {
        return this.sys.outputBasket.workItemBasket.map((wi: WorkItem) => wi.workerValueContribution(this, fromTime, toTime)).reduce((a, b) => a + b, 0)
    } 

    private individualValueContributionOfPeriodBefore(): Value {
        const lesWorkerAdjustedSvsWeight: LogEntryWorkerAdapted[] = this.logWorkerAdapted.filter(le => le.logEntryType == LogEntryType.workerAdjustedSortVectorSequenceWeight)
        return (<LogEntryWorkerAdjustedSortVectorSequenceWeight>lesWorkerAdjustedSvsWeight[lesWorkerAdjustedSvsWeight.length - 1]).individualValueContributionOfPeriodBefore
    }

    private adjustChosenSortVectorSequence(ivcCurrent: number, ivcBefore: number): void {
        const lesWorkerChoseSvs: LogEntryWorkerAdapted[] = this.logWorkerAdapted.filter(le => le.logEntryType == LogEntryType.workerChoseWeightedSortVectorSequence)
        const chosenWeightedSvsOfLastPeriod: WeightedSortVectorSequence= (<LogEntryWorkerChoseWeightedSortVectorSequence>lesWorkerChoseSvs[lesWorkerChoseSvs.length - 1]).chosenWeightedSortVectorSequence
        chosenWeightedSvsOfLastPeriod.relativeWeight *= 1 + weightAdjustmentFactor * (ivcCurrent - ivcBefore > 0 ? 1 : -1) 
        this.normalizeSortVectorSequencesWeights()
    }

    private choseSortVectorSequence(): void {
        this.chosenSortVectorSequence = this.weightedSortVectorSequences[0].sortVectorSequence
        console.log(`${this.id} chose svs ${this.chosenSortVectorSequence.map(sv => sv.colIndex + "/" + sv.selCrit)}`)

    }


}
