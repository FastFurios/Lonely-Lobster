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
import { I_WeightedSelectionStrategyAtTimestamp, I_LearningStatsWorker, I_SystemStatistics } from './io_api_definitions.js'

export type SuccessMeasureFunction = (sys: LonelyLobsterSystem, wo: Worker) => number

export type LearnAndAdaptParms = {
    observationPeriod:  TimeUnit
    successMeasureFct:  SuccessMeasureFunction
    adjustmentFactor:   number
}

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
                 public measurementOfEndingPeriod:                  Value,
                 public adjustedSelectionStrategy:                  SelectionStrategy,
                 public chosenSelectionStrategy:                    SelectionStrategy,
                 public weigthedSelectionStrategies:                WeightedSelectionStrategy[] ) {
        super(sys, LogEntryType.workerLearnedAndAdapted, worker)
    }

    private stringifiedWeightedSelectionStrategies = (): string => `\tweighted selection strategies:\n` +
        this.weigthedSelectionStrategies.map(wsest => "\t\t" + wsest.element.id + ": \t" + wsest.weight.toPrecision(2) + "\n")
                                        .reduce((a, b) => a + b)

    public stringified = () => `${this.stringifiedLe()}, ${this.worker.id},` +
                               `measurement=${this.measurementOfEndingPeriod.toPrecision(2)}, ` +
                               `adjusted strategy: [${this.adjustedSelectionStrategy.id}],  ` +
                               `newly chosen: [${this.chosenSelectionStrategy.id}]\n` +
                               this.stringifiedWeightedSelectionStrategies()

    public plainFacts = (header: boolean) => 
        header  ? `time; worker; ivc; adjusted; ${this.weigthedSelectionStrategies.map(wsest => `${wsest.element.id};`).reduce((a, b) => a + b)}` + "chosen" 
                : `${this.timestamp}; ${this.worker.id};` +
                  `${this.measurementOfEndingPeriod.toPrecision(2)};` +
                  `${this.adjustedSelectionStrategy.id};` +
                  `${this.weigthedSelectionStrategies.map(wsest => `${wsest.weight.toPrecision(2)};`).reduce((a, b) => a + b)}` + 
                  `${this.chosenSelectionStrategy.id}`
} 

export class LogWorker {
    constructor(public log: LogEntryWorker[]=[]) {}

    public add = (lew: LogEntryWorker) => this.log.push(lew) 

    public get statsOverTime(): I_WeightedSelectionStrategyAtTimestamp[] {
        //console.log("LogWorker.statsOverTime() = " + this.log.filter(le => le.logEntryType == LogEntryType.workerLearnedAndAdapted)
        //                                                 .map(lew => console.log((<LogEntryWorkerLearnedAndAdapted>lew).stringified())))
        return this.log.filter(le => le.logEntryType == LogEntryType.workerLearnedAndAdapted).map(lew => { 
            return {
                timestamp:  lew.timestamp,
                selectionStrategyNamesWithWeights: (<LogEntryWorkerLearnedAndAdapted>lew).weigthedSelectionStrategies.map(wsest => { return {id: wsest.element.id, weight: wsest.weight}})
            }
        })
    } 
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

// --- WORKER class --------------------------------------
export class Worker {
    static sysStats: I_SystemStatistics
    logWorker:    LogWorker     = new LogWorker([])
    stats:        WorkerStats   = { assignments: [], utilization: 0 }

    constructor(private sys:                            LonelyLobsterSystem,
                public  id:                             WorkerName,
                        weightedSelectionStrategies:    WeightedSelectionStrategy[]) {
        this.logEventLearnedAndAdapted(0, weightedSelectionStrategies[0].element, weightedSelectionStrategies[0].element, weightedSelectionStrategies) // initialize worker's learning & adaption log
    }

    private logEventWorked(): void { this.logWorker.add(new LogEntryWorkerWorked(this.sys, this)) }

    private logEventLearnedAndAdapted(ivc: Value, adjustedSest: SelectionStrategy, chosenSest: SelectionStrategy, weightedSelectionStrategies: WeightedSelectionStrategy[]): void { 
        this.logWorker.add(new LogEntryWorkerLearnedAndAdapted(this.sys, this, ivc, adjustedSest, chosenSest, weightedSelectionStrategies))
    }

    private get logWorkerWorked(): LogEntryWorkerWorked[] { return this.logWorker.log.filter(le => le.logEntryType == LogEntryType.workerWorked) }

    public get logWorkerLearnedAndAdapted(): LogEntryWorkerLearnedAndAdapted[] { return <LogEntryWorkerLearnedAndAdapted[]>this.logWorker.log.filter(le => le.logEntryType == LogEntryType.workerLearnedAndAdapted) }

    private  workItemsAtHand(asSet: AssignmentSet): WorkItem[] {
        const pss: ProcessStep[] = asSet.assignments.filter(as => as.worker.id == this.id).map(as => as.valueChainProcessStep.processStep)
        return pss.flatMap(ps => ps.workItemBasket) 
    }

    private hasWorkedAt(timestamp: Timestamp): boolean { 
        return this.logWorkerWorked.filter(le => le.timestamp == timestamp).length > 0
    }

    public work(asSet: AssignmentSet): void {
        // --- learning and adaption -----
        if (this.sys.clock.time > 0 && this.sys.clock.time % this.sys.learnAndAdaptParms.observationPeriod == 0) {

            const measurementEndingPeriod: number = this.sys.learnAndAdaptParms.successMeasureFct(this.sys, this) 
            this.adjustWeightAndChooseNewSelectionStrategy(measurementEndingPeriod,         
                                                           this.measurementPeriodBefore,    
                                                           this.weightAdjustment,                       
                                                           this.sys.learnAndAdaptParms.adjustmentFactor)
        }

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

    public get statsOverTime(): I_LearningStatsWorker {
        return {
            worker: this.id,
            series: this.logWorker.statsOverTime
        }
    }

    private get measurementPeriodBefore(): Value {
        return (this.logWorkerLearnedAndAdapted[this.logWorkerLearnedAndAdapted.length - 1]).measurementOfEndingPeriod
    }

    private get currentSelectionStrategy(): SelectionStrategy {
        return this.logWorkerLearnedAndAdapted[this.logWorkerLearnedAndAdapted.length - 1].chosenSelectionStrategy
    }

    public /* private? */ get currentWeightedSelectionStrategies(): WeightedSelectionStrategy[] {
        return this.logWorkerLearnedAndAdapted[this.logWorkerLearnedAndAdapted.length - 1].weigthedSelectionStrategies
    }

    private adjustWeightAndChooseNewSelectionStrategy(endingPeriodMeasurement:  Value, 
                                                      periodBeforeMeasurment:   Value, 
                                                      weightAdjustmentFunction: (epm: Value, pbm: Value, waf: number) => number,
                                                      weigthAdjustmentFactor:   number): void {
        const weightIncrease = weightAdjustmentFunction(endingPeriodMeasurement, periodBeforeMeasurment, weigthAdjustmentFactor)
        const modifiedWeightedSelectionStrategies = arrayWithModifiedWeightOfAnElement<SelectionStrategy>(this.currentWeightedSelectionStrategies, 
                                                                                                          this.currentSelectionStrategy, 
                                                                                                          weightIncrease)
        const newNormedWeightedSelectionStrategies = arrayWithNormalizedWeights<SelectionStrategy>(modifiedWeightedSelectionStrategies, this.ensuredMinimum)
        const nextSelectionStrategy = newNormedWeightedSelectionStrategies?.length > 0  ? randomlyPickedByWeigths<SelectionStrategy>(newNormedWeightedSelectionStrategies, this.ensuredMinimum) : this.currentSelectionStrategy
        this.logEventLearnedAndAdapted(endingPeriodMeasurement, this.currentSelectionStrategy, nextSelectionStrategy, newNormedWeightedSelectionStrategies)
    }

    private ensuredMinimum(w: number): number {
        return w < 0.01 ? 0.01 : w
    }

    private weightAdjustment(measurementEndingPeriod: Value, measurementPeriodBefore: Value, weigthAdjustFactor: number): number {
        return weigthAdjustFactor *
               (measurementEndingPeriod > measurementPeriodBefore ? 1 
                                                                  : measurementEndingPeriod < measurementPeriodBefore ? -1 : 0) 
    }
}

// --- Learning and Adpting Success Functions -------------------------------------------

export function successMeasureIvc(sys: LonelyLobsterSystem, wo: Worker): number {
    return sys.outputBasket.workItemBasket.map((wi: WorkItem) => wi.workerValueContribution(wo, sys.clock.time - sys.learnAndAdaptParms.observationPeriod < 0 ? 0 : sys.clock.time - sys.learnAndAdaptParms.observationPeriod, sys.clock.time)).reduce((a, b) => a + b, 0)
}

export function successMeasureRoce(sys: LonelyLobsterSystem, wo: Worker): number {
    if (sys.learnAndAdaptParms.successMeasureFct == successMeasureRoce) {
        if (!Worker.sysStats || Worker.sysStats.timestamp < sys.clock.time) {
            //console.log(wo.id + " at " + sys.clock.time + ": work() Worker.sysStats.timestamp = " + Worker.sysStats?.timestamp)
            Worker.sysStats = sys.systemStatistics(
                sys.clock.time - sys.learnAndAdaptParms.observationPeriod < 0 ? 0 : sys.clock.time - sys.learnAndAdaptParms.observationPeriod,
                sys.clock.time)
        }
    }
    const aux =  Worker.sysStats.outputBasket.economics.roce  
    //console.log("successMeasureRoce("+ wo.id +") returns: " + aux)
    return aux
}

export function successMeasureNone(sys: LonelyLobsterSystem, wo: Worker): number {
    return 0  
}

