//----------------------------------------------------------------------
/**
 *    WORK ITEM
 */
//----------------------------------------------------------------------

import { LogEntry, LogEntryType } from './logging.js'
import { TimeUnit, Timestamp, Effort, Value, WorkItemId, WorkItemTag, I_WorkItemEvent} from './io_api_definitions'
import { WorkItemBasketHolder, ProcessStep } from './workitembasketholder.js'
import { ValueChain } from './valuechain.js'
import { Worker } from './worker.js'
import { LonelyLobsterSystem, ToString } from './system.js'

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
    ["a", "A"], ["b", "B"], ["c", "C"], ["d", "D"], ["e", "E"], ["f", "F"], ["g", "G"], ["h", "H"], ["i", "I"], ["j", "J"],
    ["k", "K"], ["l", "L"], ["m", "M"], ["n", "N"], ["o", "O"], ["p", "P"], ["q", "Q"], ["r", "R"], ["s", "S"],  ["t", "T"],
    ["u", "U"], ["v", "V"], ["w", "W"], ["x", "X"], ["y", "Y"], ["z", "Z"]
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
    constructor(       timestamp:               Timestamp,
                public valueChain:              ValueChain,
                public workItem:                WorkItem,       
                public workItemBasketHolder:    WorkItemBasketHolder | undefined, // undefined if injected i.e. moved from "outside" into the first process step of the value chain
                       logEntryType:            LogEntryType) {
        super(timestamp, logEntryType)
    }
    /** provide getter for work item events */
    abstract get workItemEvent(): I_WorkItemEvent 

    public toString(): string {
        return `${super.toString()}, wi = ${this.workItem.id}, vc = ${this.workItem.valueChain.id}, wibh = ${this.workItemBasketHolder!.id}`
    }
} 

/**
 * work item log entry when moved -- used also for "work order injected"
 */
export class LogEntryWorkItemMoved extends LogEntryWorkItem {
    constructor(       timestamp:                   Timestamp,
                       valueChain:                  ValueChain,
                       workItem:                    WorkItem,
                public fromWorkItemBasketHolder:    WorkItemBasketHolder | undefined, 
                       toWorkItemBasketHolder:      WorkItemBasketHolder) { 
        super(timestamp, valueChain, workItem, toWorkItemBasketHolder, LogEntryType.workItemMoved)
    }

    get workItemEvent(): I_WorkItemEvent {
        return {
            timestamp:                  this.timestamp,
            workItemId:                 this.workItem.id,
            eventType:                  LogEntryType.workItemMoved,
            valueChainId:               this.workItem.valueChain.id,
            fromProcessStepId:          this.fromWorkItemBasketHolder?.id,
            workItemBasketHolderId:     this.workItemBasketHolder!.id
        }
    }

    public toString(): string {
        return `${super.toString()}, ${this.fromWorkItemBasketHolder?.id}=>${this.workItemBasketHolder?.id}` // console.log uses automatically this method when called with ${this-workitem}
    }
}

/**
 * work item log entry when being worked on
 */
export class LogEntryWorkItemWorked extends LogEntryWorkItem {
    constructor(       timestamp:                  Timestamp,
                       valueChain:                  ValueChain,
                       workItem:                   WorkItem,
                       processStep:                ProcessStep,
                public worker:                     Worker) {
        super(timestamp, valueChain, workItem, processStep, LogEntryType.workItemWorkedOn)
    }
    get workItemEvent(): I_WorkItemEvent {
        return {
            timestamp:                  this.timestamp,
            workItemId:                 this.workItem.id,
            eventType:                  LogEntryType.workItemWorkedOn,
            valueChainId:               this.workItem.valueChain.id,
            workItemBasketHolderId:     this.workItemBasketHolder!.id,
            worker:                     this.worker.id
        }
    }

    public toString(): string {
        return `${super.toString()}, worker = ${this.worker.id}`
    }
}

//----------------------------------------------------------------------
//    definitions   
//----------------------------------------------------------------------

/** statistic event data when the work item leaves a process step */
export interface WorkItemFlowEventStats {
    wi:                             WorkItem,
    vc:                             ValueChain,
    /** the process step the work items left */
    psExited:                       ProcessStep,        
    /** process steps the work items entered; can also be the output basket */
    wibhEntered:                    WorkItemBasketHolder,
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
export class WorkItem implements ToString {
    public  id:                             WorkItemId
    public  tag:                            WorkItemTag
    public  log:                            LogEntryWorkItem[] = []
    public  currentWorkItemBasketHolder:    WorkItemBasketHolder  // redundant for efficiency reasons: could find this information also in the log 
    public  extendedInfos:                  WorkItemExtendedInfos | undefined // additional low level statistical data about the work item's lifecycle

    constructor(private sys:                LonelyLobsterSystem,
                private injectedIntoVc:     ValueChain) {
        this.id  = sys.idGen.next().value
        this.tag = sys.tagGen.next().value

        // place work item in the first process step in the value chain:
        this.currentWorkItemBasketHolder = injectedIntoVc.processSteps[0]                      
        this.currentWorkItemBasketHolder.add(this)
        this.logMovedEvent(undefined, this.currentWorkItemBasketHolder)    

        /** extended infos are bundled into a separate object */
        this.extendedInfos  = new WorkItemExtendedInfos(this.sys, this, WorkItemExtendedInfosCreationMode.empty)
    }

    /** 
     * add log entry when the work item was moved into a a new work item basket holder; includes injection and also the reaching of the output basket
     * @param fromProcessStep the process step from where the work item comes; if newly injected work order, then this parameter must be undefined
     * @param toWorkItemBasketHolder the work item basket holder the work item proceeded to
     */
    public logMovedEvent(fromProcessStep: ProcessStep | undefined, toWorkItemBasketHolder: WorkItemBasketHolder): void {
        this.log.push(new LogEntryWorkItemMoved(this.sys.clock.time,
                                                this.injectedIntoVc,
                                                this,
                                                fromProcessStep,
                                                toWorkItemBasketHolder))
    }

    /** add log entry when a worker worked the work item */
    public logWorkedEvent(worker: Worker): void {
        this.log.push(new LogEntryWorkItemWorked(this.sys.clock.time,
                                                 this.injectedIntoVc,
                                                 this,
                                                 <ProcessStep>this.currentWorkItemBasketHolder,
                                                 worker))
    }


    /** return all "worked" log entries */
    private get workedLogEntries(): LogEntryWorkItemWorked[] {
        return <LogEntryWorkItemWorked[]>this.log.filter(le => le.logEntryType == LogEntryType.workItemWorkedOn)
    }

    /** return all "moved" log entries */
    private get movedLogEntries(): LogEntryWorkItemMoved[] {
        return <LogEntryWorkItemMoved[]>this.log.filter(le => le.logEntryType == LogEntryType.workItemMoved)
    }

    /** returns last "moved" log entry */
    private get lastMovedLogEntry(): LogEntryWorkItemMoved {
        return this.movedLogEntries[this.movedLogEntries.length - 1]
    }

    /** returns the first "moved" log entry */
    private get firstMovedLogEntry(): LogEntryWorkItemMoved {
        return this.movedLogEntries[0]
    }

    /** returns the timestamp of last log entry */
    public get lastLogEntry(): LogEntry {
        return this.log[this.log.length - 1]
    }

    /** returns the elapsed time since entry into the current process step; if already being in the output basket, return undefined*/
    public get elapsedTimeInCurrentProcessStep(): TimeUnit | undefined {
        if (this.currentWorkItemBasketHolder == this.sys.outputBasket) return undefined // this function calculates elapsed time for process steps only!
        return this.sys.clock.time - this.lastMovedLogEntry.timestamp
    }
 
    /** returns the elapsed time of the work item still being in a value chain; if already in the output basket return undefined */
    public get elapsedTimeInValueChain(): TimeUnit | undefined {
        if (this.currentWorkItemBasketHolder == this.sys.outputBasket) return undefined // this function calculates elapsed time for work items that are still being in the value chain!
        return this.sys.clock.time - this.firstMovedLogEntry.timestamp
    }

    /** 
     * returns the cycle time in the given process step, i.e. the work item has been worked on in the process step and has already moved out of it  
     * @param ps the process step for which the work item's cycle time is to be caclulated   
     * @param from (optional) from time (including) from which the work item must have entered the process step; if left empty take system start time i.e. 0 
     * @param to (optional) to time (including) until which the work item must have moved out of the process step; if left empty take current system time
     * @returns the work item's cycle time in the given process step 
     */
    public cycleTimeInProcessStep(ps: ProcessStep, from: Timestamp = 0, to: Timestamp = this.sys.clock.time): TimeUnit | undefined { // null if never having left the given process step  
        const entryIntoPsTime = this.movedLogEntries.find(le => (<LogEntryWorkItemMoved>le).workItemBasketHolder == ps)?.timestamp
        if (!entryIntoPsTime) return undefined
        const exitFromPsTime  = this.movedLogEntries.find(le => (<LogEntryWorkItemMoved>le).fromWorkItemBasketHolder == ps)?.timestamp
        if (!exitFromPsTime)  return undefined
        if (exitFromPsTime < from || exitFromPsTime > to) return undefined
        return exitFromPsTime - entryIntoPsTime
    }

    /**
     * returns the cycle time of the work item in its value chain, i.e. from its injection to reaching the output basket
     * @param from (optional) from time (including) from which the work item must have entered the value chain; if left empty take system start time i.e. 0 
     * @param to (optional) to time (including) until which the work item must have moved out of the value chain into the output basket; if left empty take current system time
     * @returns the work item's cycle time 
     */
    public cycleTimeInValueChain(from: Timestamp = 0, to: Timestamp = this.sys.clock.time): TimeUnit | undefined {
        const entryIntoVcTime = this.firstMovedLogEntry.timestamp
        const exitFromVcTime  = this.lastMovedLogEntry.timestamp 
        if (exitFromVcTime < from || exitFromVcTime > to ) return undefined
        return exitFromVcTime - entryIntoVcTime
    }

    /** returns the number of process steps the work item has entered */
    public get numProcessStepsVisited(): number {
        return this.movedLogEntries.length
    }

    /** returns value chain of the work */
    public get valueChain(): ValueChain {
        return this.firstMovedLogEntry.valueChain
    }

    /**
     * Calculate the accumulated effort that has gone into the work item
     * @param toTime timestamp (including) until when worked-on events are to be considered
     * @param workItemBasketHolder if defined then focus on that work item basket holder: if it is a process step then return the accumulated work in that process step; 
     * if it is the output basket it returns 0 as no one works on a work item in the output basket;  
     * if this parameter is undefined return the accumulated effort of all process steps of the value chain
     * @returns the work effort so far 
     */
    public accumulatedEffort(fromTime: Timestamp, toTime: Timestamp, workItemBasketHolder?: WorkItemBasketHolder): Effort {
        return  (workItemBasketHolder == undefined ? this.log 
                                                   : this.log.filter(le => le.workItemBasketHolder == workItemBasketHolder))
            .filter(le => le.timestamp >= fromTime && le.timestamp <= toTime && le.logEntryType == LogEntryType.workItemWorkedOn)
            .length
    }

    /**
     * move the work item on to the next basket holder; remark: this methods deals with the work item internal things to do, 
     * the actual removing of the work item from the current process step and adding to the next work basket holder is done in the ProcessStep instance   
     * @param toWorkItemBasketHolder target work item basket holder
     */
    public moveTo(toWorkItemBasketHolder: WorkItemBasketHolder): void {
        this.logMovedEvent(<ProcessStep>this.currentWorkItemBasketHolder, toWorkItemBasketHolder)
        this.currentWorkItemBasketHolder = toWorkItemBasketHolder
        if (toWorkItemBasketHolder == this.sys.outputBasket) this.extendedInfos = undefined   // get rid of the extendedInfos as they have no longer a meaning once the work item is in the output basket
      }

    /**
     * Check if the work item was worked on 
     * @param timestamp point in time to check 
     * @returns true if worked on, otherwise false
     */    
    public hasBeenWorkedOnAtTimestamp = (timestamp: Timestamp): boolean  => 
        this.log.filter(le => (le.timestamp == timestamp && le.logEntryType == LogEntryType.workItemWorkedOn)).length > 0
    
    /**
     * Check if the work item has already been worked on in the current process step; for batch-mode only
     * @returns true if has beed worked on else false 
     */
    public workedOnAtCurrentProcessStep = (): boolean => 
        this.accumulatedEffort(0, this.sys.clock.time, <ProcessStep>this.currentWorkItemBasketHolder) > 0

    /**
     * Check if all work is done on the work item in the current process step  
     * @returns true if this work item is finished at the current process step  
     */
    public finishedAtCurrentProcessStep = (): boolean => 
        this.accumulatedEffort(0, this.sys.clock.time, <ProcessStep>this.currentWorkItemBasketHolder) >= (<ProcessStep>this.currentWorkItemBasketHolder).normEffort

    /**
     * check if work item moved to the output basket in a given time interval
     * @param fromTime start of interval (including)
     * @param toTime end of interval (including)
     * @returns true if work item became an end-product i.e. it moved to output basket in the given intervall  
     */
    public hasMovedToOutputBasketBetween(fromTime: Timestamp, toTime: Timestamp): boolean {
        return this.currentWorkItemBasketHolder == this.sys.outputBasket 
            && this.lastMovedLogEntry.timestamp >= fromTime 
            && this.lastMovedLogEntry.timestamp <= toTime
    }

    /**
     * Check if the work item was being processed in the value chain at given point in time 
     * @param t point in time 
     * @returns true if work item was in value chain else false
     */
    public wasInValueChainAt(t: Timestamp): boolean { 
        return  this.log[0].timestamp <= t                      // was injected before or at t ... 
            && !this.hasMovedToOutputBasketBetween(0, t - 1)    // ... and did not move to the output basket before t      
    }

    /** 
     * Calculate the (degraded) value-add the work item materialized if and when it reached the output basket
     * @returns the (degraded) value-add  
     */
    public materializedValue(): Value {
        if (this.currentWorkItemBasketHolder != this.sys.outputBasket) return 0
        const vc = this.valueChain 
        return vc.valueDegradation(vc.totalValueAdd, this.cycleTimeInValueChain()! - vc.minimalCycleTime)
    } 

    /**
     * Calculate the effort a worker has put in into the work item in a given time intervall
     * @param wo worker 
     * @param fromTime start of interval (including)
     * @param toTime end of interval (including)
     * @returns the worker's effort on the work item in the interval  
     */
    private effortPutInByWorker(wo: Worker, fromTime: Timestamp, toTime: Timestamp): Effort {
        return this.workedLogEntries
                   .filter(le => le.worker == wo && le.timestamp >= fromTime && le.timestamp <= toTime)
                   .length 
    }

    /**
     * Calculate the worker's individual contribution to the materialized value of an end product that reached the output basket in the given time interval. 
     * The value attributed to the worker is proportional to his work effort contribution.   
     * @param wo worker
     * @param fromTime start of interval (including)
     * @param toTime end of interval (including)
     * @returns the worker's individual contribution to the materialized value of the end product 
     */
    public workerValueContribution(wo: Worker, fromTime: Timestamp, toTime: Timestamp): Value {
        if (this.currentWorkItemBasketHolder != this.sys.outputBasket) return 0
        const effortByWorker =  this.effortPutInByWorker(wo, fromTime, toTime)
        return this.materializedValue() * (effortByWorker / this.valueChain.normEffort)
    }

    /**
     * Returns a list of flow statistics for the events when the work item transitioned from a basket holder into the next
     * @param fromTime start of interval (including)
     * @param toTime end of interval (including)
     * @returns list of events with flow statistics of process step transitions
     */
    public flowStatisticsEventsHistory(fromTime: Timestamp = 1, toTime: Timestamp = this.sys.clock.time): WorkItemFlowEventStats[]  { // lists all events btw. from and to timestamp when the workitem exited a process step 
        const moveLogEntriesUntilToTime = this.movedLogEntries.filter(le => le.timestamp <= toTime)
        if (moveLogEntriesUntilToTime.length < 2) return [] // every work item that has moved out off a process step must have at least 2 moved-to log entries: a) injection into and b) moved out of process step

        // we have events between start and end of interval
        const statEvents: WorkItemFlowEventStats[] = []  // initialize the array of move-to events of the work item

        for (// initialize loop:
             let currentMovedLe = moveLogEntriesUntilToTime.pop()!, 
                 beforeMovedLe  = moveLogEntriesUntilToTime.pop()!; // there are at least 2 that we can pop
             // continue loop while this is true: 
             beforeMovedLe &&                               // as long as a log entry before was found and ...  
             currentMovedLe.fromWorkItemBasketHolder &&     // ... the current log entry is not the injection entry and ...
             currentMovedLe.timestamp >= fromTime;          // ... also timestamp not younger than fromTime 
             // execute at end of loop:
             currentMovedLe = beforeMovedLe, 
             beforeMovedLe = moveLogEntriesUntilToTime.pop()!) {

            statEvents.push({
                    wi:                          this,
                    vc:                          this.valueChain,
                    psExited:                    <ProcessStep>currentMovedLe.fromWorkItemBasketHolder, // process step in log entry that happened before currentlyLastMovedToEvent  
                    wibhEntered:                 currentMovedLe.workItemBasketHolder!, // the currently last event where the work item moved into and ...           
                    finishedTime:                currentMovedLe.timestamp, // ... timestamp when this happened
                    elapsedTime:                 currentMovedLe.timestamp - beforeMovedLe.timestamp, // elapsed time between having moved to the process step and out of there 
                    injectionIntoValueChainTime: this.firstMovedLogEntry.timestamp // time when the work order was injected
            })           
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
     * Update the extended low-level statistical data of the work items, only as long as being in the value chain  
     */
    public updateExtendedInfos(): void {
        if (this.currentWorkItemBasketHolder != this.sys.outputBasket) 
            this.extendedInfos = new WorkItemExtendedInfos(this.sys, this, WorkItemExtendedInfosCreationMode.calculated)         
    }
    
   /** batch mode only, console display */ 
   public toString(): string {
        return `Work item: t=${this.sys.clock.time} wi=${this.id} ps=${this.currentWorkItemBasketHolder.id} vc=${this.valueChain.id} et=${this.elapsedTimeInValueChain} ae=${this.accumulatedEffort(0, this.sys.clock.time, this.currentWorkItemBasketHolder)} ${this.finishedAtCurrentProcessStep() ? "done" : "in progress"}`
   }
}

//-------------------------------------------------------------------------------------------------------
/**
 *    WORKITEM EXTENDED INFO    provides additional life cycle data of the work item used for 
 *                              workers' decisions which work item to work on next. 
 *                              Also used to compile system flow statistics. 
 *                              Once the work item reached the output basket these extended infos are no 
 *                              longer valid. 
 */
//-------------------------------------------------------------------------------------------------------

/** tuple field indexes for @see {@link WiExtInfoTuple} */
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

enum WorkItemExtendedInfosCreationMode {
    empty      = "initialization-empty",
    calculated = "calculated"
}

export class WorkItemExtendedInfos {
    public workOrderExtendedInfos: WiExtInfoTuple

    constructor(public sys: LonelyLobsterSystem, 
                public wi:  WorkItem,
                       creationMode: WorkItemExtendedInfosCreationMode) {
        if (creationMode == WorkItemExtendedInfosCreationMode.empty) 
            this.workOrderExtendedInfos = [wi, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        else {
            // creationMode == WorkItemExtendedInfosCreationMode.caclulated
            const currPs: ProcessStep = <ProcessStep>wi.currentWorkItemBasketHolder 

            // efforts:
            const accumulatedEffortInProcessStep   = wi.accumulatedEffort(0, sys.clock.time, currPs)
            const remainingEffortInProcessStep     = currPs.normEffort - accumulatedEffortInProcessStep
            const accumulatedEffortInValueChain    = wi.accumulatedEffort(0, sys.clock.time)
            const remainingEffortInValueChain      = wi.valueChain.normEffort - accumulatedEffortInValueChain

            // travelling in the value chain:
            const visitedProcessSteps              = wi.numProcessStepsVisited
            const remainingProcessSteps            = wi.valueChain.length - visitedProcessSteps

            // value chain static data:            
            const valueOfValueChain                = wi.valueChain.totalValueAdd
            const totalEffortInValueChain          = wi.valueChain.normEffort
            const contributionOfValueChain         = valueOfValueChain - totalEffortInValueChain

            // inventory size:
            const sizeOfInventoryInProcessStep     = wi.currentWorkItemBasketHolder.inventorySize

            // elapsed times:
            const elapsedTimeInProcessStep         = wi.elapsedTimeInCurrentProcessStep!
            const elapsedTimeInValueChain          = wi.elapsedTimeInValueChain!          
    
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
    }
   
   /** batch mode only, console display */ 
   public static stringifiedHeader = (): string => "___wi___vc/ps___________aeps_reps_aevc_revc_vpss_rpss__vvc_tevc__cvc_sips_etps_etvc" 

   /** batch mode only, console display */ 
   public stringifiedDataLine = (): string => `${this.wi.id.toString().padStart(4, ' ')}|${this.wi.tag[0]}: ` 
        + `${((<ProcessStep>this.wi.currentWorkItemBasketHolder).valueChain.id + "/" + this.wi.currentWorkItemBasketHolder.id).padEnd(15, ' ')}`
        + this.workOrderExtendedInfos.slice(1).map(e => (<number>e).toFixed().padStart(5, ' ')).reduce((a, b) => a + b)




}