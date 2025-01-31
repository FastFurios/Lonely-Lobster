//----------------------------------------------------------------------
/**
 *   WORKERS
 */
//----------------------------------------------------------------------

import { LogEntry, LogEntryType } from './logging.js'
import { topElemAfterSort, randomlyPickedByWeigths, arrayWithModifiedWeightOfAnElement, WeightedElement, SortVectorSequence, arrayWithNormalizedWeights } from "./helpers.js"
import { Timestamp, WorkerName, Value, TimeUnit, I_WeightedSelectionStrategyAtTimestamp, I_LearningStatsWorker, I_SystemStatistics  } from './io_api_definitions'
import { WorkItem, WiExtInfoElem, WiExtInfoTuple } from './workitem.js'
import { ProcessStep } from './workitembasketholder.js'
import { ValueChain } from './valuechain.js'
import { LonelyLobsterSystem } from './system'

/** signature of the function by which all the workers measures the outcome of their work item selection strategy behaviour  */
export type SuccessMeasureFunction = (sys: LonelyLobsterSystem, wo: Worker) => number

/** system-wide parameters for learning and adapting of worker's behaviour */
export type LearnAndAdaptParms = {
    /** time intervall into the past that is used to calculate the success */
    observationPeriod:  TimeUnit
    successMeasureFct:  SuccessMeasureFunction
    /** factor with which the current weight of a work item selection strategy is multiplied; between 0 and 1  */
    adjustmentFactor:   number
}

//----------------------------------------------------------------------
//    WORKER BEHAVIOUR 
//----------------------------------------------------------------------

/** a globally defined work item selection strategy in the Lonely Lobster system */
interface SelectionStrategy {
    id:    string
    svs:   SortVectorSequence
}

/**
 * take the top-ranked work item after sorting the accessible work items
 * @param wis work items at hand to the worker 
 * @param svs how the work items are sorted before the top item is picked
 * @returns the top item after sort
 */
function selectedNextWorkItemBySortVectorSequence(wis: WorkItem[], svs: SortVectorSequence): WorkItem {
    const extInfoTuples: WiExtInfoTuple[] = wis.map(wi => wi.extendedInfos!.workOrderExtendedInfos) 
    const selectedWi:    WiExtInfoTuple   = topElemAfterSort(extInfoTuples, svs)
    return selectedWi[WiExtInfoElem.workItem]  // return workitem object reference
} 

//----------------------------------------------------------------------
//    WORKER LOGGING 
//----------------------------------------------------------------------

/**
 * Log entry for a worker
 */
abstract class LogEntryWorker extends LogEntry {
    constructor(       timestamp:       Timestamp,
                       logEntryType:    LogEntryType,
                public worker:          Worker) {
        super(timestamp, logEntryType)
    }
} 

/**
 * Log entry for a worker having worked on a work item
 */
class LogEntryWorkerWorked extends LogEntryWorker {
    constructor(timestamp:  Timestamp,
                worker:     Worker) {
        super(timestamp, LogEntryType.workerWorked, worker)
    }
    
    public toString = (): string => `${super.toString()}, wo=${this.worker.id}` 
} 

/**
 * Log entry for a worker when he observed the success of his current behaviour using selection strategies
 */
class LogEntryWorkerLearnedAndAdapted extends LogEntryWorker {
    constructor (       timestamp:                      Timestamp,
                        worker:                         Worker,
                 public measurementOfEndingPeriod:      Value,                  
                 public adjustedSelectionStrategy:      SelectionStrategy,
                 public chosenSelectionStrategy:        SelectionStrategy,   // chosen strategy for the next period
                 public weigthedSelectionStrategies:    WeightedSelectionStrategy[] ) {
        super(timestamp, LogEntryType.workerLearnedAndAdapted, worker)
    }

    /**
     * for debugging only
     * @returns the weighted selection strategies of the worker  
     */
    private stringifiedWeightedSelectionStrategies = (): string => `\tweighted selection strategies:\n` +
        this.weigthedSelectionStrategies.map(wsest => "\t\t" + wsest.element.id + ": \t" + wsest.weight.toPrecision(2) + "\n")
                                        .reduce((a, b) => a + b)

    /**
     * for debugging only
     * @returns log entry as string  
     */                                        
    public toString = () => `${super.toString()}, ${this.worker.id},` +
                               `measurement=${this.measurementOfEndingPeriod.toPrecision(2)}, ` +
                               `adjusted strategy: [${this.adjustedSelectionStrategy.id}],  ` +
                               `newly chosen: [${this.chosenSelectionStrategy.id}]\n` +
                               this.stringifiedWeightedSelectionStrategies()

    /** 
     * for debugging only
     * @returns debug infos as string 
     */
    public plainFacts = (header: boolean) => 
        header  ? `time; worker; ivc; adjusted; ${this.weigthedSelectionStrategies.map(wsest => `${wsest.element.id};`).reduce((a, b) => a + b)}` + "chosen" 
                : `${this.timestamp}; ${this.worker.id};` +
                  `${this.measurementOfEndingPeriod.toPrecision(2)};` +
                  `${this.adjustedSelectionStrategy.id};` +
                  `${this.weigthedSelectionStrategies.map(wsest => `${wsest.weight.toPrecision(2)};`).reduce((a, b) => a + b)}` + 
                  `${this.chosenSelectionStrategy.id}`
} 

/**
 * the worker's log
 */
export class LogWorker {
    constructor(public log: LogEntryWorker[]=[]) {}

    /**
     * add a log entry
     * @param lew log entry
     * @returns none
     */
    public add = (lew: LogEntryWorker) => this.log.push(lew) 

    /**
     * List all learning and adption log entries of the worker with the weighted selection strategies at each timestamp
     * @returns weighted selection strategies at each timestamp
     */
    public get statsOverTime(): I_WeightedSelectionStrategyAtTimestamp[] {
        return this.log.filter(le => le.logEntryType == LogEntryType.workerLearnedAndAdapted).map(lew => { 
            return {
                timestamp:  lew.timestamp,
                selectionStrategyNamesWithWeights: (<LogEntryWorkerLearnedAndAdapted>lew).weigthedSelectionStrategies
                        .map(wsest => { 
                            return {id:     wsest.element.id, 
                                    weight: wsest.weight}})
            }
        })
    } 
}


//----------------------------------------------------------------------
//    ASSIGNMENTS OF WORKERS TO PROCESS STEPS
//----------------------------------------------------------------------

/** worker assignment to a process step */
export interface Assignment {
    worker:                Worker
    valueChainProcessStep: ValueChainProcessStep
}

/** all worker assignments in the system; multiple sets are possible */
export class AssignmentSet {
    public assignments: Assignment[] = []
    constructor(
        /** name of the assigment set */
        public id: string) {}

    /**
     * Add a process step assigment to the worker
     * @param as assigment 
     */    
    public addAssignment(as: Assignment) {
        this.assignments.push(as)
    }

    /**
     * Return the workers being assigned to a given process step
     * @param ps given process step
     * @returns list of workers
     */
    public assignedWorkersToProcessStep(ps: ProcessStep): Worker[] | undefined {
        return this.assignments.filter(assignment => assignment.valueChainProcessStep.processStep == ps).map(assignment => assignment.worker)
    }
}

//----------------------------------------------------------------------
//    WORKER 
//----------------------------------------------------------------------

/** process step with its parent value chain */
type ValueChainProcessStep = {
    valueChain:  ValueChain,
    processStep: ProcessStep
}

/** worker's statistics */
type WorkerStats = {
    assignments:                    ValueChainProcessStep[],  
    utilization:                    number, // in percent, i.e. 55 is 55%
    weigthedSelectionStrategies?:   WeightedSelectionStrategy[]
}

/** specific type in the worker context derived from generic type definitions of the optimize module */
export type WeightedSelectionStrategy = WeightedElement<SelectionStrategy>

// -------------------------------------------------------
/**
 *      WORKER 
 */
// -------------------------------------------------------
export class Worker {
    /** central storage of the only once calculated system statistics on basis of the latest learn and adapt observation period */
    static sysStats:    I_SystemStatistics
    /** worker's log */
    logWorker:          LogWorker     = new LogWorker([])
    /** worker's statistics */
    stats:              WorkerStats   = { assignments: [], utilization: 0 }

    constructor(private sys:                            LonelyLobsterSystem,
                        /** worker name */
                        public  id:                     WorkerName,
                        /** worker's selection strategies and their weights from initialization of the system */
                        weightedSelectionStrategies:    WeightedSelectionStrategy[]) {
        this.logEventLearnedAndAdapted(0, weightedSelectionStrategies[0].element, weightedSelectionStrategies[0].element, weightedSelectionStrategies) // initialize worker's learning & adaption log
    }

    /** add log entry when worked */
    private logEventWorked(): void { this.logWorker.add(new LogEntryWorkerWorked(this.sys.clock.time, this)) }

    /** add log entry when having gone through learning and adaption */
    private logEventLearnedAndAdapted(ivc: Value, adjustedSest: SelectionStrategy, chosenSest: SelectionStrategy, weightedSelectionStrategies: WeightedSelectionStrategy[]): void { 
        this.logWorker.add(new LogEntryWorkerLearnedAndAdapted(this.sys.clock.time, this, ivc, adjustedSest, chosenSest, weightedSelectionStrategies))
    }

    /** @returns list of worked log entries */
    public get logWorkerWorked(): LogEntryWorkerWorked[] {
        return this.logWorker.log.filter(le => le.logEntryType == LogEntryType.workerWorked)
    }

    /** @returns list of learninf & adaption log entries */
    public get logWorkerLearnedAndAdapted(): LogEntryWorkerLearnedAndAdapted[] { 
        return <LogEntryWorkerLearnedAndAdapted[]>this.logWorker.log.filter(le => le.logEntryType == LogEntryType.workerLearnedAndAdapted) 
    }

    /** @returns work items that are currently at hand for the worker */
    private  workItemsAtHand(asSet: AssignmentSet): WorkItem[] {
        const pss: ProcessStep[] = asSet.assignments.filter(as => as.worker.id == this.id).map(as => as.valueChainProcessStep.processStep)
        return pss.flatMap(ps => ps.workItemBasket) 
    }

    /** @returns true if worker worked at the given timestamp, else false  */
    private hasWorkedAt(timestamp: Timestamp): boolean { 
        return this.logWorkerWorked.filter(le => le.timestamp == timestamp).length > 0
    }

    /**
     * Conduct work at every iteration if any work items at hand; every observation period end the worker goes through 
     * the learning and adaption excercise 
     * @param asSet assignment set
     * @returns none
     */
    public work(asSet: AssignmentSet): void {
        // --- learning and adaption -----
        if (this.sys.clock.time > 0 && this.sys.clock.time % this.sys.learnAndAdaptParms.observationPeriod == 0) {

            const measurementEndingPeriod: number = this.sys.learnAndAdaptParms.successMeasureFct(this.sys, this) 
            /** adjust the relative weights of the worker's strategies at the end of the current observation period
             * on basis of the outcome difference to the prior period */
            this.adjustWeightAndChooseNewSelectionStrategy(measurementEndingPeriod,         
                                                           this.measurementPeriodBefore,    
                                                           this.weightAdjustment,                       
                                                           this.sys.learnAndAdaptParms.adjustmentFactor)
        }

        // --- working -----
        if (this.hasWorkedAt(this.sys.clock.time)) return    // worker has already worked at current time

        /** find the work items at hand that not yet finished at the current process step and 
         * which no other worker has already worked on at the current time */
        const workableWorkItemsAtHand: WorkItem[] = this.workItemsAtHand(asSet)
                                                        .filter(wi => !wi.finishedAtCurrentProcessStep())                     // not yet in OutputBasket
                                                        .filter(wi => !wi.hasBeenWorkedOnAtTimestamp(this.sys.clock.time))    // no one worked on it at current time
        if (workableWorkItemsAtHand.length == 0) return // no workable workitems at hand

        // if(this.sys.debugShowOptions.workerChoices) console.log("Worker__" + WorkItemExtendedInfos.stringifiedHeader())
        // if(this.sys.debugShowOptions.workerChoices) workableWorkItemsAtHand.forEach(wi => console.log(`${this.id.padEnd(6, ' ')}: ${wi.extendedInfos?.stringifiedDataLine()}`)) // ***

        /** selected work item to work on */        
        const wi: WorkItem = selectedNextWorkItemBySortVectorSequence(workableWorkItemsAtHand, this.currentSelectionStrategy.svs)

        // if(this.sys.debugShowOptions.workerChoices) console.log(`=> ${this.id} picked: ${wi.id}|${wi.tag[0]}`)

        wi.logWorkedEvent(this)     // record in the work item log that the worker worked the item
        this.logEventWorked()       // record in the worker's log that he did the work
    }

    /**
     * Compile the utilization data for the worker and store it in @see {@link this.stats}
     */
    public utilization(sys: LonelyLobsterSystem): void {
        //console.log(`Worker.utilization(): t=${this.sys.clock.time} wo=${this.id} logWorkerWorked.length=${this.logWorkerWorked.length} clock.firstIteration=${this.sys.clock.firstIteration}`)
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

    /**
     * @returns worker's learning statistics (i.e. worker's' weighted workitem selection strategies over time)
     */
    public get statsOverTime(): I_LearningStatsWorker {
        return {
            worker: this.id,
            series: this.logWorker.statsOverTime
        }
    }

    /**
     * @returns the measurement of the prior period
     */
    private get measurementPeriodBefore(): Value {
        return (this.logWorkerLearnedAndAdapted[this.logWorkerLearnedAndAdapted.length - 1]).measurementOfEndingPeriod
    }

    /**
     * @returns the worker's currently choosen work item selection strategy 
     */
    private get currentSelectionStrategy(): SelectionStrategy {
        return this.logWorkerLearnedAndAdapted[this.logWorkerLearnedAndAdapted.length - 1].chosenSelectionStrategy
    }

    /**
     * @returns the worker's current weighted selection strategies 
     */
    public get currentWeightedSelectionStrategies(): WeightedSelectionStrategy[] {
        return this.logWorkerLearnedAndAdapted[this.logWorkerLearnedAndAdapted.length - 1].weigthedSelectionStrategies
    }

    /**
     * Adjust the weights of the worker's selection strategies based on observed performance change since the prio period
     * and choose randomly a new strategy for the next period (based on the adjusted weights)  
     * @param endingPeriodMeasurement currently ending observation period
     * @param periodBeforeMeasurment the prior period 
     * @param weightAdjustmentFunction function how to adjust the strategy weight
     * @param weigthAdjustmentFactor factor by which the strategy weight is to be multiplied  
     */
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

    /**
     * Failsave to avoid number gets too low 
     * @param w the number value
     * @returns w but least 0.01
     */
    private ensuredMinimum(w: number): number {
        return w < 0.01 ? 0.01 : w
    }

    /**
     * Calculates the adjustment value
     * @param measurementEndingPeriod measurement of the currently ending observation period
     * @param measurementPeriodBefore measurement of the prior period
     * @param weigthAdjustFactor the factor of adjustment
     * @returns the weight adjustment; positive if measurement results of currently endling period was better than at the prior period,
     * otherwise negative   
     */
    private weightAdjustment(measurementEndingPeriod: Value, measurementPeriodBefore: Value, weigthAdjustFactor: number): number {
        return weigthAdjustFactor *
               (measurementEndingPeriod > measurementPeriodBefore ? 1 
                                                                  : measurementEndingPeriod < measurementPeriodBefore ? -1 : 0) 
    }
}

// --- Learning and Adpting Success Functions -------------------------------------------

/**
 * Calculate the worker's individual value contribution (ivc) in the observation period
 * @param sys system
 * @param wo worker
 * @returns worker's individual value contribution
 */
export function successMeasureIvc(sys: LonelyLobsterSystem, wo: Worker): number {
    return sys.outputBasket.workItemBasket.map((wi: WorkItem) => wi
            .workerValueContribution(wo, sys.clock.time - sys.learnAndAdaptParms.observationPeriod < 0 ? 0 : sys.clock.time - sys.learnAndAdaptParms.observationPeriod, sys.clock.time))
            .reduce((a, b) => a + b, 0)
}

/**
 * Calculate the system's overall economical performance in terms of roce (return on capital employed) in the observation period
 * @param sys system
 * @param wo ignored
 * @returns system's overall economical performance as roce
 */
export function successMeasureRoce(sys: LonelyLobsterSystem, wo: Worker): number {
    if (sys.learnAndAdaptParms.successMeasureFct == successMeasureRoce) {
        if (!Worker.sysStats || Worker.sysStats.timestamp < sys.clock.time) {
            /** calculate the system statistis for the current learning and adaption observation period and store it in the Worker class
             * where other workers then also habe access to without requiring calculating the statistics over and over again for each worker 
             */
            Worker.sysStats = sys.systemStatistics(sys.clock.time < sys.learnAndAdaptParms.observationPeriod ? sys.clock.time : sys.learnAndAdaptParms.observationPeriod)
        }
    }
    return Worker.sysStats.outputBasket.economics.roceVar  
}

/**
 * no success measurement
 */
export function successMeasureNone(sys: LonelyLobsterSystem, wo: Worker): number {
    return 0  
}