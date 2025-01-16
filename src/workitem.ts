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
    constructor(public timestamp:               Timestamp,
                public valueChain:              ValueChain,
                public workItem:                WorkItem,       
                public workItemBasketHolder:    WorkItemBasketHolder | undefined, // undefined if injected i.e. moved from "outside" into the first process step of the value chain
                       logEntryType:            LogEntryType) {
        super(timestamp, logEntryType)
    }
    /** provide getter for work item events */
    abstract get workItemEvent(): I_WorkItemEvent 

    public stringifiedLeWi = () => `${this.stringifiedLe()}, wi = ${this.workItem.id}, vc = ${this.workItem.valueChain.id}, wibh = ${this.workItemBasketHolder!.id}, wi = ${this.workItem.id}`
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
            workItemBasketHolderId:     this.workItemBasketHolder?.id
        }
    }

    public toString = () => `${this.stringifiedLeWi()}, ${this.fromWorkItemBasketHolder?.id}=>${this.workItemBasketHolder?.id}`
    public toString_ = () => `${this.stringifiedLeWi()}, ${this.fromWorkItemBasketHolder?.id}=>${this.workItemBasketHolder?.id}`
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
            workItemBasketHolderId:     this.workItemBasketHolder?.id,
            worker:                     this.worker.id
        }
    }

    public toString = () => `${this.stringifiedLeWi()}, worker = ${this.worker.id}`
}

//----------------------------------------------------------------------
//    definitions   
//----------------------------------------------------------------------

/** statistic event data when the work item leaves a process step */
export interface StatsEventForExitingAProcessStep {
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
export class WorkItem {
    static idGen  = wiIdGenerator()
    static tagGen = wiTagGenerator(wiTags)

    public  id:                             WorkItemId
    public  tag:                            WorkItemTag
    public  log:                            LogEntryWorkItem[] = []
    public  currentWorkItemBasketHolder:    WorkItemBasketHolder  // redundant for efficiency reasons: could find this information also in the log 
    public  extendedInfos:                  WorkItemExtendedInfos // additional low level statistical data about the work item's lifecycle

    constructor(private sys:                LonelyLobsterSystem,
                private injectedIntoVc:     ValueChain) {
        this.id  = WorkItem.idGen.next().value
        this.tag = WorkItem.tagGen.next().value

        // place work item in the first process step in the value chain:
        this.currentWorkItemBasketHolder = injectedIntoVc.processSteps[0]                      
        this.currentWorkItemBasketHolder.workItemBasket.push(this)
        this.logMovedEvent(undefined, this.currentWorkItemBasketHolder)    

        /** extended infos are bundled into a separate object */
        this.extendedInfos  = new WorkItemExtendedInfos(this.sys, this, WorkItemExtendedInfosCreationMode.empty)
//          console.log(`Workitem.constructor(): created new work item: ${this.id}`)   
    }

    /** 
     * add log entry for the work item was moved into a a new work item basket holder; includes injection and also reaching the output basket
     * @param fromProcessStep the process step from where the work item comes; newly injected, then undefined
     * @param toWorkItemBasketHolder the work item basket holderthe work item proceeded to
     */
    public logMovedEvent(fromProcessStep: ProcessStep | undefined, toWorkItemBasketHolder: WorkItemBasketHolder): void {
        console.log(`Workitem.logMovedTo(): ${this.id} logging moved event: from ${fromProcessStep} to ${toWorkItemBasketHolder}`)
        this.log.push(new LogEntryWorkItemMoved(this.sys.clock.time,
                                                this.injectedIntoVc,
                                                this,
                                                fromProcessStep,
                                                toWorkItemBasketHolder))
    }

    /** add log a worker worked the work item */
    public logWorkedEvent(worker: Worker): void {
        this.log.push(new LogEntryWorkItemWorked(this.sys.clock.time,
                                                 this.injectedIntoVc,
                                                 this,
                                                 <ProcessStep>this.currentWorkItemBasketHolder,
                                                 worker))
    }

    /**  */

    private get workedLogEntries(): LogEntryWorkItemWorked[] {
        return <LogEntryWorkItemWorked[]>this.log.filter(le => le.logEntryType == LogEntryType.workItemWorkedOn)
    }

    private get movedLogEntries(): LogEntryWorkItemMoved[] {
        return <LogEntryWorkItemMoved[]>this.log.filter(le => le.logEntryType == LogEntryType.workItemMoved)
    }

    private get lastMovedLogEntry(): LogEntryWorkItemMoved {
        return this.movedLogEntries[this.movedLogEntries.length - 1]
    }

    private get firstMovedLogEntry(): LogEntryWorkItemMoved {
        return this.movedLogEntries[0]
    }

    public get elapsedTimeInCurrentProcessStep(): TimeUnit | undefined {
        if (this.currentWorkItemBasketHolder == this.sys.outputBasket) return undefined // this function calculates elapsed time for process steps only!
        return this.sys.clock.time - this.lastMovedLogEntry.timestamp
    }
 
    public get elapsedTimeInValueChain(): TimeUnit {
        return this.sys.clock.time - this.firstMovedLogEntry.timestamp
    }

    public cycleTimeInProcessStep(ps: ProcessStep, from: Timestamp, to: Timestamp): TimeUnit | null { // null if never having left the given process step  
        const entryIntoPsTime = this.movedLogEntries.find(le => (<LogEntryWorkItemMoved>le).workItemBasketHolder == ps)?.timestamp
        if (!entryIntoPsTime) return null
        const exitFromPsTime  = this.movedLogEntries.find(le => (<LogEntryWorkItemMoved>le).fromWorkItemBasketHolder == ps)?.timestamp
        if (!exitFromPsTime)  return null
        if (exitFromPsTime < from || exitFromPsTime > to)  return null
        return exitFromPsTime - entryIntoPsTime
    }

    public cycleTimeInValueChain(from: Timestamp, to: Timestamp): TimeUnit | null {
        const entryIntoVcTime = this.firstMovedLogEntry.timestamp
        const exitFromVcTime  = this.lastMovedLogEntry.timestamp 
        if (exitFromVcTime < from || exitFromVcTime > to) return null
        return exitFromVcTime - entryIntoVcTime
    }

    public get valueChain(): ValueChain {  // ## make private once the extended info object is converted into a map inside the call Workitem
        return this.firstMovedLogEntry.valueChain
    }

    public moveTo(toWorkItemBasketHolder: WorkItemBasketHolder): void {
        this.logMovedEvent(<ProcessStep>this.currentWorkItemBasketHolder, toWorkItemBasketHolder)
        this.currentWorkItemBasketHolder = toWorkItemBasketHolder
    }

    /**
     * Calculate the accumulated effort that has gone into the work item
     * @param until timestamp (including) until when worked-on events are to be considered
     * @param workItemBasketHolder if defined then focus on this basket holder (i.e. process step or output basket) 
     * otherwise all process steps of the value chain
     * @returns the work effort so far 
     */
    public accumulatedEffort = (until: Timestamp, workItemBasketHolder?: WorkItemBasketHolder): Effort =>
        (workItemBasketHolder == undefined ? this.log 
                                           : this.log.filter(le => le.workItemBasketHolder == workItemBasketHolder))
        .filter(le => le.timestamp <= until && le.logEntryType == LogEntryType.workItemWorkedOn)
        .length

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
        this.accumulatedEffort(this.sys.clock.time, <ProcessStep>this.currentWorkItemBasketHolder) > 0

    /**
     * Check if all work is done on the work item in the current process step  
     * @returns true if this work item is finished at the current process step  
     */
    public finishedAtCurrentProcessStep = (): boolean => 
        this.accumulatedEffort(this.sys.clock.time, <ProcessStep>this.currentWorkItemBasketHolder) >= (<ProcessStep>this.currentWorkItemBasketHolder).normEffort

    /**
     * check if work item moved to the output basket in a given time interval
     * @param fromTime start of interval (including)
     * @param toTime end of interval (including)
     * @returns true if work item became an end-product i.e. it moved to output basket in the given intervall  
     */
    public hasMovedToOutputBasketBetween(fromTime: Timestamp, toTime: Timestamp): boolean {
        return this.currentWorkItemBasketHolder == this.sys.outputBasket && this.lastMovedLogEntry.timestamp >= fromTime && this.lastMovedLogEntry.timestamp <= toTime
    }

    /**
     * Check if the work item was being processed in the value chain at given point in time 
     * @param t point in time 
     * @returns true if work item was in valiue chain else false
     */
    public wasInValueChainAt(t: Timestamp): boolean { 
        return this.log[0].timestamp < t && !this.hasMovedToOutputBasketBetween(0, (t - 1))
    }

    /** 
     * Calculate the (degraded) value-add the work item materialized if and when it reached the output basket
     * @returns the (degraded) value-add  
     */
    private materializedValue(): Value {
        if (this.currentWorkItemBasketHolder != this.sys.outputBasket) return 0
        const vc = this.valueChain 
        return vc.valueDegradation(vc.totalValueAdd, this.cycleTimeInValueChain(0, this.sys.clock.time)! - vc.minimalCycleTime)
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
                   .filter(le => le.worker == wo && le.timestamp >= fromTime && le.timestamp <= toTime).length 
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
        return effortByWorker > 0 ? this.materializedValue() * (effortByWorker / this.valueChain.normEffort) : 0
    }

    /**
     * Returns a list of statistics for the events when the work item transitioned from a basket holder into the next. 
     * Annotation: weird imparative implementation, difficult to understand; 
     * would make sense to find a more functional programming style solution ##refactor##  
     * @param fromTime start of interval (including)
     * @param toTime end of interval (including)
     * @returns list of events with flow statistics of process step transitions
     */
    public flowStatisticsEventsHistory(fromTime: Timestamp = 1, toTime: Timestamp = this.sys.clock.time): StatsEventForExitingAProcessStep[]  { // lists all events btw. from and to timestamp when the workitem exited a process step 
        const moveLogEntriesUntilToTime = this.movedLogEntries.filter(le => le.timestamp <= toTime)
        if (moveLogEntriesUntilToTime.length < 2) return [] // every work item that has moved out off a process step must have at least 2 moved-to log entries: a) injection into and b) moved out of process step

        // we have events between start and end of interval
        const statEvents: StatsEventForExitingAProcessStep[] = []  // initialize the array of move-to events of the work item

        for (let movedLeCurrent = moveLogEntriesUntilToTime.pop()!, movedLeBefore = moveLogEntriesUntilToTime.pop()!; // 
             movedLeCurrent.fromWorkItemBasketHolder && movedLeCurrent.timestamp >= fromTime; // is not injection but real transition from a process step to another work item basket holder; also, if timestamp < fromTime then were done. 
             movedLeCurrent = movedLeBefore, movedLeBefore = moveLogEntriesUntilToTime.pop()!) {

            statEvents.push({
                    wi:                          this,
                    vc:                          this.valueChain,
                    psExited:                    <ProcessStep>movedLeCurrent.fromWorkItemBasketHolder, // process step in log entry that happened before currentlyLastMovedToEvent  
                    wibhEntered:                 movedLeCurrent.workItemBasketHolder!, // the currently last event where the work item moved into and ...           
                    finishedTime:                movedLeCurrent.timestamp, // ... timestamp when this happened
                    elapsedTime:                 movedLeCurrent.timestamp - movedLeBefore.timestamp, // elapsed time between having moved to the process step and out of there 
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
     * Update the extended low-level statistical data of the work items 
     */
    public updateExtendedInfos(): void {
        this.extendedInfos = new WorkItemExtendedInfos(this.sys, this, WorkItemExtendedInfosCreationMode.calculated)         
    }
    
   /** batch mode only, console display */ 
   public stringified = (): string => `\tt=${this.sys.clock.time} wi=${this.id} ps=${this.currentWorkItemBasketHolder.id} vc=${this.valueChain.id} et=${this.elapsedTimeInValueChain} ae=${this.accumulatedEffort(this.sys.clock.time, this.currentWorkItemBasketHolder)} ${this.finishedAtCurrentProcessStep() ? "done" : ""}\n`
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

enum WorkItemExtendedInfosCreationMode {
    empty = "initialization-empty",
    calculated = "calculated"
}

//----------------------------------------------------------------------
/**
 *    WORKITEM EXTENDED INFO
 */
//----------------------------------------------------------------------
export class WorkItemExtendedInfos {
    public workOrderExtendedInfos: WiExtInfoTuple

    constructor(public sys: LonelyLobsterSystem, 
                public wi:  WorkItem,
                       creationMode: WorkItemExtendedInfosCreationMode) {
        // ## console.log(`WorkitemExtendedInfo.constructor(): creating new work item extended infos object in ${creationMode} mode`) // ##   

        if (creationMode == WorkItemExtendedInfosCreationMode.empty) 
            this.workOrderExtendedInfos = [wi, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        else { // creationMode == WorkItemExtendedInfosCreationMode.caclulate
            const accumulatedEffortInProcessStep   = wi.accumulatedEffort(sys.clock.time, wi.currentWorkItemBasketHolder)
            const remainingEffortInProcessStep     = (<ProcessStep>wi.currentWorkItemBasketHolder).normEffort - accumulatedEffortInProcessStep
            const accumulatedEffortInValueChain    = wi.accumulatedEffort(sys.clock.time, )
            const remainingEffortInValueChain      = wi.valueChain.processSteps.map(ps => (<ProcessStep>ps).normEffort).reduce((a, b) => a + b) - accumulatedEffortInValueChain
    
            const visitedProcessSteps              = (<ProcessStep>wi.currentWorkItemBasketHolder).valueChain.processSteps.indexOf(<ProcessStep>wi.currentWorkItemBasketHolder) + 1
            const remainingProcessSteps            = (<ProcessStep>wi.currentWorkItemBasketHolder).valueChain.processSteps.length - visitedProcessSteps
            
            const valueOfValueChain                = (<ProcessStep>wi.currentWorkItemBasketHolder).valueChain.totalValueAdd
            const totalEffortInValueChain          = accumulatedEffortInValueChain + remainingEffortInValueChain
            const contributionOfValueChain         = valueOfValueChain - totalEffortInValueChain
    
            const sizeOfInventoryInProcessStep     = (<ProcessStep>wi.currentWorkItemBasketHolder).workItemBasket.length
    
            const elapsedTimeInProcessStep         = wi.elapsedTimeInCurrentProcessStep || 0
            const elapsedTimeInValueChain          = wi.elapsedTimeInValueChain
    
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