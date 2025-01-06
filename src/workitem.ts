//----------------------------------------------------------------------
/**
 *    WORK ITEM
 */
//----------------------------------------------------------------------
// last code cleaning: 05.01.2025

import { LogEntry, LogEntryType } from './logging.js'
import { TimeUnit, Timestamp, Effort, Value, WorkItemId, WorkItemTag, I_WorkItemEvent} from './io_api_definitions'
import { WorkItemBasketHolder, ProcessStep } from './workitembasketholder.js'
import { ValueChain } from './valuechain.js'
import { Worker } from './worker.js'
import { LonelyLobsterSystem } from './system.js'

//----------------------------------------------------------------------
//    definitions and helpers
//----------------------------------------------------------------------

/** a new work item to be injected into the first process step of a given value chain at the given timestamp */
export interface WorkOrder {
    timestamp:  Timestamp,
    valueChain: ValueChain
}


/**
 * Generates unique work item identifier for console display in batch mode
 * @returns work item identifier
 */
export function* wiIdGenerator(): IterableIterator<WorkItemId> { 
    for(let i = 0; true; i++) yield i 
}

/** list of available work item tags for console display in batch mode */
export const wiTags: WorkItemTag[] = [
    ["a", "A"],
    ["b", "B"],
    ["c", "C"],
    ["d", "D"],
    ["e", "E"],
    ["f", "F"],
    ["g", "G"],
    ["h", "H"],
    ["i", "I"],
    ["j", "J"],
    ["k", "K"],
    ["l", "L"],
    ["m", "M"],
    ["n", "N"],
    ["o", "O"],
    ["p", "P"],
    ["q", "Q"],
    ["r", "R"],
    ["s", "S"],
    ["t", "T"],
    ["u", "U"],
    ["v", "V"],
    ["w", "W"],
    ["x", "X"],
    ["y", "Y"],
    ["z", "Z"]
]  
/**
 * Generates workitem tags for display in batch mode: lower letter = untouched, upper letter = some work already exerted;
 * the letters are assigned in round-robin fashion to the work items
 * @param wiTags list of available tags
 * @returns work item tag
 */
export function* wiTagGenerator(wiTags: WorkItemTag[]): IterableIterator<WorkItemTag> {
    for (let i = 0; true; i = i < wiTags.length - 1 ? i + 1 : 0) 
        yield wiTags[i] 
}

//----------------------------------------------------------------------
//    WORK ITEM LOGGING 
//----------------------------------------------------------------------

/**
 * Work item log entry 
 */
abstract class LogEntryWorkItem extends LogEntry {
    constructor(    public sys:                 LonelyLobsterSystem,
                    public workItem:            WorkItem,       
                    public valueChain:          ValueChain, 
                    public workItemBasketHolder:WorkItemBasketHolder,
                           logEntryType:        LogEntryType) {
        super(sys, logEntryType)
    }
    /** provide getter for work item events */
    abstract get workItemEvent(): I_WorkItemEvent 

    public stringifyLeWi = () => `${this.stringifiedLe()}, ${this.logEntryType}, vc = ${this.valueChain.id}, ps = ${this.workItemBasketHolder == this.sys.outputBasket ? "OutputBasket" : (<ProcessStep>this.workItemBasketHolder).id}, wi = ${this.workItem.id}`
} 

/**
 * work item log entry when moved -- used also for "work order injected"
 */
export class LogEntryWorkItemMoved extends LogEntryWorkItem {
    constructor(       sys:                        LonelyLobsterSystem,
                       workItem:                   WorkItem,
                       valueChain:                 ValueChain, 
                       toWorkItemBasketHolder:     WorkItemBasketHolder) { 
        super(sys, workItem, valueChain, toWorkItemBasketHolder, LogEntryType.workItemMovedTo)
    }
    get workItemEvent(): I_WorkItemEvent {
        return {
            system:         this.sys.id,
            timestamp:      this.timestamp,
            workitem:       this.workItem.id,
            eventType:      LogEntryType.workItemMovedTo,
            valueChain:     this.valueChain.id,
            processStep:    this.workItemBasketHolder.id
        }
    }
    public stringified = () => `${this.stringifyLeWi()}`
}

/**
 * work item log entry when being worked on
 */
export class LogEntryWorkItemWorked extends LogEntryWorkItem {
    constructor(            sys:                        LonelyLobsterSystem,
                            workItem:                   WorkItem,
                            valueChain:                 ValueChain, 
                            processStep:                ProcessStep,
                     public worker:                     Worker) {
        super(sys, workItem, valueChain, processStep, LogEntryType.workItemWorkedOn)
    }
    get workItemEvent(): I_WorkItemEvent {
        return {
            system:         this.sys.id,
            timestamp:      this.timestamp,
            workitem:       this.workItem.id,
            eventType:      LogEntryType.workItemWorkedOn,
            valueChain:     this.valueChain.id,
            processStep:    this.workItemBasketHolder.id,
            worker:         this.worker.id
        }
    }
    public stringified = () => `${this.stringifyLeWi()}, worker = ${this.worker.id}`
}

//----------------------------------------------------------------------
//    definitions   
//----------------------------------------------------------------------

/** modes how to calculate the elapsed time of an work item*/
export enum ElapsedTimeMode {
    /**  calculated between timestamp of last entry found minus timestamp of first entry found in the work item log */
    firstToLastEntryFound,
    /**  calculated between current clock time minus timestamp of first entry found in the work item log */
    firstEntryToNow  
}

/** statistic event data when the work item leaves a process step */
export interface StatsEventForExitingAProcessStep {
    wi:                             WorkItem,
    vc:                             ValueChain,
    /** the process step the work items left */
    psExited:                       ProcessStep,        
    /** process steps the work items entered; can also be the output basket */
    psEntered:                      WorkItemBasketHolder,
    /** timestamp when the work item was finished in the exited process step */
    finishedTime:                   Timestamp,
    /** span of time the work item spent in the exited process step */
    elapsedTime:                    TimeUnit,
    /** the work items timestamp when it was injected into the value chain; used for calculating cycletimes of the value chain */
    injectionIntoValueChainTime:    Timestamp   
}
//----------------------------------------------------------------------
/**
 *    WORK ITEM   
 * 
 * Terminology remarks: 
 * - work item: is a item that is being worked on by workers in process steps of the value chain the work item was injected into. Special types are:
 * - work order: is a work item that is being injected into a value chain
 * - end-product: is a work item that has reached the output basket i.e. it is finished 
 */
//----------------------------------------------------------------------
export class WorkItem {
    /** the  log of work item lifecycle events */
    public  log:            LogEntryWorkItem[] = []
    public  id:             WorkItemId
    public  tag:            WorkItemTag
    /** additional low level statistical data about the work item's lifecycle */
    public  extendedInfos:  WorkItemExtendedInfos

    constructor(private sys:                LonelyLobsterSystem,
                public valueChain:          ValueChain,
                /** the process step the work item is to be placed into */
                public currentProcessStep:  WorkItemBasketHolder) {
        this.id             = sys.idGen.next().value
        this.tag            = sys.tagGen.next().value
        /** extended infos are bundled into a separate object */
        this.extendedInfos  = new WorkItemExtendedInfos(this.sys, this)   
    }

    /** add log entry that work item was moved into a process step; includes injection and also reaching the output basket */
    public logMovedTo(toProcessStep: WorkItemBasketHolder): void {
        this.log.push(new LogEntryWorkItemMoved(    this.sys,
                                                    this,
                                                    this.valueChain, 
                                                    toProcessStep ))
    }

    /** add log a worker worked the work item */
    public logWorkedOn(worker: Worker): void {
        this.log.push(new LogEntryWorkItemWorked(   this.sys,
                                                    this,
                                                    this.valueChain, 
                                                    <ProcessStep>this.currentProcessStep,
                                                    worker ))
    }

    /** calculate the elapsed time of the work item
     * @param mode bas calculation on timestamp from entering the specified basket holder, or alteratively the value chain, to now
     * @param workItemBasketHolder if defined then focus on this basket holder (i.e. process step or output basket) 
     * otherwise all process steps of the value chain
     * @returns elapsed time 
     */
    public elapsedTime (mode: ElapsedTimeMode, workItemBasketHolder?: WorkItemBasketHolder): TimeUnit { 
        const logInScope: LogEntryWorkItem[] = workItemBasketHolder == undefined ? this.log
                                                                                 : this.log.filter(le => le.workItemBasketHolder == workItemBasketHolder)
        if (logInScope.length == 0) return -1                                                                         
        
        const maxTime   = mode == ElapsedTimeMode.firstEntryToNow ? this.sys.clock.time : logInScope[logInScope.length - 1].timestamp 
        const minTime   = logInScope[0].timestamp
        return maxTime - minTime
    }

    /**
     * Calculate the accumulated effort that has gone into the work item
     * @param until timestamp until when worked-on events are to be considered
     * @param workItemBasketHolder if defined then focus on this basket holder (i.e. process step or output basket) 
     * otherwise all process steps of the value chain
     * @returns the work effort so far 
     */
    public accumulatedEffort = (until: Timestamp, workItemBasketHolder?: WorkItemBasketHolder): Effort =>
        (workItemBasketHolder == undefined ? this.log 
                                           : this.log.filter(le => le.workItemBasketHolder == workItemBasketHolder))
        .filter(le => le.timestamp <= until)
        .filter(le => le.logEntryType == LogEntryType.workItemWorkedOn)
        .length

    /**
     * Check if the work item was worked on 
     * @param timestamp point in time to check 
     * @returns true if worked on, otherwise false
     */    
    public hasBeenWorkedOnAtTimestamp = (timestamp: Timestamp): boolean  => 
        this.log.filter(le => (le.timestamp == timestamp && le.logEntryType == LogEntryType.workItemWorkedOn)).length > 0
    
    /**
     * Check if the work item has already been worked on in the current process step
     * @returns true if has beed worked on else false 
     */
    public workedOnAtCurrentProcessStep = (): boolean => 
        this.accumulatedEffort(this.sys.clock.time, <ProcessStep>this.currentProcessStep) > 0

    /**
     * Check if all work is done on the work item in the current process step  
     * @returns 
     */
    public finishedAtCurrentProcessStep = (): boolean => 
        this.accumulatedEffort(this.sys.clock.time, <ProcessStep>this.currentProcessStep) >= (<ProcessStep>this.currentProcessStep).normEffort

    /**
     * Check if the work item was being processed in the value chain at given point in time 
     * @param t point in time 
     * @returns true if work item was in valiue chain else false
     */
    public wasInValueChainAt(t: Timestamp): boolean { 
        return this.log[0].timestamp < t && !this.hasMovedToOutputBasketBetween(0, (t - 1))
    }

    /**
     * check if work item moved to the output basket in a given time interval
     * @param fromTime start of interval (including)
     * @param toTime end of interval (including)
     * @returns true if work item became an end-product i.e. it moved to output basket in the given intervall  
     */
    public hasMovedToOutputBasketBetween(fromTime: Timestamp, toTime: Timestamp) {
        const lastLogEntry = this.log[this.log.length - 1]
        return this.currentProcessStep == this.sys.outputBasket && lastLogEntry.timestamp >= fromTime && lastLogEntry.timestamp <= toTime
    }

    /** Calculate the value-add the work item materialized if and when it reached he output basket */
    private materializedValue(): Value {
        if (this.currentProcessStep != this.sys.outputBasket) return 0
        const vc         = this.log[0].valueChain 
        const crv: Value = vc.valueDegradation(vc.totalValueAdd, this.elapsedTime(ElapsedTimeMode.firstToLastEntryFound) - vc.minimalCycleTime)
        return crv
    } 

    /**
     * Calculate the effort a worker has put in into the work item in a given time intervall
     * @param wo worker 
     * @param fromTime start of interval (excluding)
     * @param toTime end of interval (including)
     * @returns the worker's effort on the work item in the interval  
     */
    private effortPutInByWorker(wo: Worker, fromTime: Timestamp, toTime: Timestamp): Effort {
        return this.log.filter(le => le.logEntryType == LogEntryType.workItemWorkedOn && (<LogEntryWorkItemWorked>le).worker == wo && le.timestamp > fromTime && le.timestamp <= toTime).length 
    }

    /**
     * Calculate the worker's individual contribution to materialized value of an end product that reached the output basket in the given time interval. 
     * The value attributed to the worker is proportional to his work effort contribution.   
     * @param wo worker
     * @param fromTime start of interval (excluding)
     * @param toTime end of interval (including)
     * @returns 
     */
    public workerValueContribution(wo: Worker, fromTime: Timestamp, toTime: Timestamp): Value {
        if (this.currentProcessStep != this.sys.outputBasket) return 0
        const effortByWorker =  this.effortPutInByWorker(wo, fromTime, toTime)
        return effortByWorker > 0 ? this.materializedValue() * (effortByWorker / this.log[0].valueChain.normEffort) : 0 
    }

    /**
     * Returns a list of statistics for the events when the work item transitioned from on into the next basket holder; 
     * Author's annotation: weird imparative implementation, difficult to understand; 
     * would make sense to find a more functional programming style solution ##refactor##  
     * @param fromTime start of interval (excluding)
     * @param toTime end of interval (including)
     * @returns list of events with statistics of process step transitions
     */
    public statisticsEventsHistory(fromTime: Timestamp = 1, toTime: Timestamp = this.sys.clock.time): StatsEventForExitingAProcessStep[]  { // lists all events btw. from and to timestamp when the workitem exited a process step 
        const statEvents: StatsEventForExitingAProcessStep[] = []  // initialize the array of move-to events of the work item
        const moveToLogEntries = this.log  // filter all move-to events before end of interval
                                .filter(le => le.logEntryType == "movedTo")
                                .filter(le => le.timestamp <= toTime)
        const firstMovedToEvent       = <LogEntryWorkItem>moveToLogEntries[0] // log entry of the work order injection
        let currentlyLastMovedToEvent = <LogEntryWorkItem>moveToLogEntries.pop() // cut off the last entry of the events and assign it to currentlylastMovedToEvent which will be update in the lopp below
        if (currentlyLastMovedToEvent.timestamp <= fromTime) return [] // if the last event happened before start of interval we're done
        // we have events between start and end of interval
        for (let le of moveToLogEntries.reverse()) { // go through all events in the interval from latest but one to earliest 
            statEvents.push(
                {
                    wi:                          this,
                    vc:                          this.valueChain,
                    psExited:                    <ProcessStep>le.workItemBasketHolder, // process step in log entry that happened before currentlyLastMovedToEvent  
                    psEntered:                   currentlyLastMovedToEvent.workItemBasketHolder, // the currently last event where the work item moved into and ...           
                    finishedTime:                currentlyLastMovedToEvent.timestamp, // ... time stamp when this happened
                    elapsedTime:                 currentlyLastMovedToEvent.timestamp - le.timestamp, // elapsed time between having moved to the process step and out of there 
                    injectionIntoValueChainTime: firstMovedToEvent.timestamp // time when the work order was injected
                }
            )           
            if (le.timestamp <= fromTime) break // don't have to deal with older events outside the interval
            currentlyLastMovedToEvent = le // set the latest moved-to log entry to the current log entry for the next loop iteration  
        }
        return statEvents
    }

    /**
     * @returns all lifecycle events in the log of the work item 
     */
    public get allWorkitemLifecycleEvents() {
        return this.log.map(le => le.workItemEvent)
    }

    /**
     * Update the extended low-level statistical data of the work items 
     */
    public updateExtendedInfos(): void {
        this.extendedInfos = new WorkItemExtendedInfos(this.sys, this)         
    }
    
   /** batch mode only, console display */ 
   public stringified = (): string => `\tt=${this.sys.clock.time} wi=${this.id} ps=${this.currentProcessStep.id} vc=${this.valueChain.id} et=${this.elapsedTime(ElapsedTimeMode.firstToLastEntryFound)} ae=${this.accumulatedEffort(this.sys.clock.time, this.currentProcessStep)} ${this.finishedAtCurrentProcessStep() ? "done" : ""}\n`
}

//----------------------------------------------------------------------
//    WORKITEM EXTENDED INFO   ...for workers' decision making 
//----------------------------------------------------------------------

/** tuple field indexes for @see {@link WiExtInfoTuple};
 * Author's annotation: somewhat weird implementation, consider to transform this stgructure into an interface etc. ##refactor##*/
export enum WiExtInfoElem {
    workItem                        =  0,

    accumulatedEffortInProcessStep  =  1,
    remainingEffortInProcessStep    =  2,
    accumulatedEffortInValueChain   =  3,
    remainingEffortInValueChain     =  4,

    visitedProcessSteps             =  5,
    remainingProcessSteps           =  6,

    valueOfValueChain               =  7,
    totalEffortInValueChain         =  8,
    contributionOfValueChain        =  9,

    sizeOfInventoryInProcessStep    = 10,

    elapsedTimeInProcessStep        = 11,
    elapsedTimeInValueChain         = 12
}

type wiDecisionInput = number  
/** tuple with work item and extended low-level statistical work item data */    
export type WiExtInfoTuple = [WorkItem, wiDecisionInput, wiDecisionInput, wiDecisionInput, wiDecisionInput, wiDecisionInput, wiDecisionInput, wiDecisionInput, wiDecisionInput, wiDecisionInput, wiDecisionInput, wiDecisionInput, wiDecisionInput]

//----------------------------------------------------------------------
/**
 *    WORKITEM EXTENDED INFO
 */
//----------------------------------------------------------------------
export class WorkItemExtendedInfos {
    public workOrderExtendedInfos: WiExtInfoTuple

    constructor(public sys: LonelyLobsterSystem, 
                public wi:  WorkItem) {
        const accumulatedEffortInProcessStep   = wi.accumulatedEffort(sys.clock.time, wi.currentProcessStep)
        const remainingEffortInProcessStep     = (<ProcessStep>wi.currentProcessStep).normEffort - accumulatedEffortInProcessStep
        const accumulatedEffortInValueChain    = wi.accumulatedEffort(sys.clock.time, )
        const remainingEffortInValueChain      = wi.valueChain.processSteps.map(ps => (<ProcessStep>ps).normEffort).reduce((a, b) => a + b) - accumulatedEffortInValueChain

        const visitedProcessSteps              = (<ProcessStep>wi.currentProcessStep).valueChain.processSteps.indexOf(<ProcessStep>wi.currentProcessStep) + 1
        const remainingProcessSteps            = (<ProcessStep>wi.currentProcessStep).valueChain.processSteps.length - visitedProcessSteps
        
        const valueOfValueChain                = (<ProcessStep>wi.currentProcessStep).valueChain.totalValueAdd
        const totalEffortInValueChain          = accumulatedEffortInValueChain + remainingEffortInValueChain
        const contributionOfValueChain         = valueOfValueChain - totalEffortInValueChain

        const sizeOfInventoryInProcessStep     = (<ProcessStep>wi.currentProcessStep).workItemBasket.length

        const elapsedTimeInProcessStep         = wi.elapsedTime(ElapsedTimeMode.firstEntryToNow, wi.currentProcessStep)
        const elapsedTimeInValueChain          = wi.elapsedTime(ElapsedTimeMode.firstEntryToNow)

        this.workOrderExtendedInfos = [
            wi,
            
            accumulatedEffortInProcessStep,   
            remainingEffortInProcessStep,     
            accumulatedEffortInValueChain,   
            remainingEffortInValueChain,      
    
            visitedProcessSteps,              
            remainingProcessSteps,           
            
            valueOfValueChain,                
            totalEffortInValueChain,          
            contributionOfValueChain,         
    
            sizeOfInventoryInProcessStep,    
    
            elapsedTimeInProcessStep,         
            elapsedTimeInValueChain          
        ]
    }
   
   /** batch mode only, console display */ 
   public static stringifiedHeader = (): string => "___wi___vc/ps___________aeps_reps_aevc_revc_vpss_rpss__vvc_tevc__cvc_sips_etps_etvc" 

   /** batch mode only, console display */ 
   public stringifiedDataLine = (): string => `${this.wi.id.toString().padStart(4, ' ')}|${this.wi.tag[0]}: ` 
        + `${((<ProcessStep>this.wi.currentProcessStep).valueChain.id + "/" + this.wi.currentProcessStep.id).padEnd(15, ' ')}`
        + this.workOrderExtendedInfos.slice(1).map(e => (<number>e).toFixed().padStart(5, ' ')).reduce((a, b) => a + b)




}