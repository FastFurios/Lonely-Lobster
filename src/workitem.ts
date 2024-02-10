//----------------------------------------------------------------------
//    WORK ITEM  
//----------------------------------------------------------------------
//-- terminology remark: work item: at the beginning it is typically a work order, in its final state it is the end-product / service 

import { TimeUnit, Timestamp, Effort, Value, WorkItemId, WorkItemTag } from './io_api_definitions'
import { LogEntry, LogEntryType } from './logging.js'
import { LonelyLobsterSystem } from './system.js'
import { ValueChain } from './valuechain.js'
import { Worker } from './worker.js'
import { WorkItemBasketHolder, ProcessStep, OutputBasket } from './workitembasketholder.js'

//----------------------------------------------------------------------
//    definitions and helpers
//----------------------------------------------------------------------

export interface WorkOrder {
    timestamp:  Timestamp,
    valueChain: ValueChain
}

// unique workitem identifier
export function* wiIdGenerator(): IterableIterator<WorkItemId> { 
    for(let i = 0; true; i++) yield i 
}

// workitem tags for display: lower letter = untouched, upper letter = some work already exerted
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

export function* wiTagGenerator(wiTags: WorkItemTag[]): IterableIterator<WorkItemTag> {
    for (let i = 0; true; i = i < wiTags.length - 1 ? i + 1 : 0) 
        yield wiTags[i] 
}

//----------------------------------------------------------------------
//    WORK ITEM LOGGING 
//----------------------------------------------------------------------

abstract class LogEntryWorkItem extends LogEntry {
    constructor(    public sys:                 LonelyLobsterSystem,
                    public workItem:            WorkItem,       
                    public valueChain:          ValueChain, 
                    public workItemBasketHolder:WorkItemBasketHolder,
                           logEntryType:        LogEntryType) {
        super(sys, logEntryType)
    }
    public stringifyLeWi = () => `${this.stringifiedLe()}, ${this.logEntryType}, vc = ${this.valueChain.id}, ps = ${this.workItemBasketHolder == this.sys.outputBasket ? "OutputBasket" : (<ProcessStep>this.workItemBasketHolder).id}, wi = ${this.workItem.id}`
} 

//      -- moved -- used also for "workitem created and injected" ---
export class LogEntryWorkItemMoved extends LogEntryWorkItem {
    constructor(       sys:                        LonelyLobsterSystem,
                       workItem:                   WorkItem,
                       valueChain:                 ValueChain, 
                       toWorkItemBasketHolder:     WorkItemBasketHolder) { 
        super(sys, workItem, valueChain, toWorkItemBasketHolder, LogEntryType.workItemMovedTo)
    }
    public stringified = () => `${this.stringifyLeWi()}`
}

//      -- worked --
export class LogEntryWorkItemWorked extends LogEntryWorkItem {
    constructor(            sys:                        LonelyLobsterSystem,
                            workItem:                   WorkItem,
                            valueChain:                 ValueChain, 
                            processStep:                ProcessStep,
                     public worker:                     Worker) {
        super(sys, workItem, valueChain, processStep, LogEntryType.workItemWorkedOn)
    }
    public stringified = () => `${this.stringifyLeWi()}, worker = ${this.worker.id}`
}

//----------------------------------------------------------------------
//    definitions   
//----------------------------------------------------------------------

export enum ElapsedTimeMode {
    firstToLastEntryFound,   // timestamp of last entry found minus timestamp of first entry found in a workitem list
    firstEntryToNow          // clock.time minus timestamp of first entry found in workitem list
}

export interface StatsEventForExitingAProcessStep {
    wi:                             WorkItem,
    vc:                             ValueChain,
    psExited:                       ProcessStep,        
    psEntered:                      WorkItemBasketHolder,
    finishedTime:                   Timestamp,
    elapsedTime:                    TimeUnit,
    injectionIntoValueChainTime:    Timestamp // used for calculating cycletimes of the valuechain  
}

//----------------------------------------------------------------------
//    WORK ITEM   
//----------------------------------------------------------------------

export class WorkItem {
    public  log:            LogEntryWorkItem[] = []
    public  id:             WorkItemId
    public  tag:            WorkItemTag
    public  extendedInfos:  WorkItemExtendedInfos

    constructor(private sys:                 LonelyLobsterSystem,
                public valueChain:          ValueChain,
                public currentProcessStep:  WorkItemBasketHolder) {
        this.id             = sys.idGen.next().value
        this.tag            = sys.tagGen.next().value
        this.extendedInfos  = new WorkItemExtendedInfos(this.sys, this)   
    }

    public logMovedTo(toProcessStep: WorkItemBasketHolder): void {
        this.log.push(new LogEntryWorkItemMoved(    this.sys,
                                                    this,
                                                    this.valueChain, 
                                                    toProcessStep ))
    }

    public logWorkedOn(worker: Worker): void {
        this.log.push(new LogEntryWorkItemWorked(   this.sys,
                                                    this,
                                                    this.valueChain, 
                                                    <ProcessStep>this.currentProcessStep,
                                                    worker ))
    }

    public elapsedTime (mode: ElapsedTimeMode, workItemBasketHolder?: WorkItemBasketHolder): TimeUnit { 
        const logInScope: LogEntryWorkItem[] = workItemBasketHolder == undefined ? this.log
                                                                                 : this.log.filter(le => le.workItemBasketHolder == workItemBasketHolder)
        if (logInScope.length == 0) return -1                                                                         
        
        const maxTime   = mode == ElapsedTimeMode.firstEntryToNow ? this.sys.clock.time : logInScope[logInScope.length - 1].timestamp 
        const minTime   = logInScope[0].timestamp
        return maxTime - minTime
    }

//  private timeOfLastLogEntry = (): Timestamp => this.log[this.log.length - 1].timestamp

    public accumulatedEffort = (until: Timestamp, workItemBasketHolder?: WorkItemBasketHolder): Effort =>
        (workItemBasketHolder == undefined ? this.log 
                                           : this.log.filter(le => le.workItemBasketHolder == workItemBasketHolder))
        .filter(le => le.timestamp <= until)
        .filter(le => le.logEntryType == LogEntryType.workItemWorkedOn).length

    public hasBeenWorkedOnAtCurrentTime = (timestamp: Timestamp, ps?: ProcessStep): boolean  => // ## "ps?: ProcessStep" delete?
        this.log.filter(le => (le.timestamp == timestamp && le.logEntryType == LogEntryType.workItemWorkedOn)).length > 0
    
    public workedOnAtCurrentProcessStep = (): boolean => 
        this.accumulatedEffort(this.sys.clock.time, <ProcessStep>this.currentProcessStep) > 0

    public finishedAtCurrentProcessStep = (): boolean => 
        this.accumulatedEffort(this.sys.clock.time, <ProcessStep>this.currentProcessStep) >= (<ProcessStep>this.currentProcessStep).normEffort

    public updateExtendedInfos(): void {
        this.extendedInfos = new WorkItemExtendedInfos(this.sys, this)         
    }

    public wasInValueChainAt(t: Timestamp): boolean { 
        return this.log[0].timestamp < t && !this.hasMovedToOutputBasketBetween(0, (t - 1))
    }

    public hasMovedToOutputBasketBetween(fromTime: Timestamp, toTime: Timestamp) {
        const lastLogEntry = this.log[this.log.length - 1]
        return this.currentProcessStep == this.sys.outputBasket && lastLogEntry.timestamp >= fromTime && lastLogEntry.timestamp <= toTime
    }

    private materializedValue(): Value {
        if (this.currentProcessStep != this.sys.outputBasket) return 0
        const vc         = this.log[0].valueChain 
        const crv: Value = vc.valueDegration(vc.totalValueAdd, this.elapsedTime(ElapsedTimeMode.firstToLastEntryFound) - vc.minimalCycleTime)
        return crv
    } 

    private effortPutInByWorker(wo: Worker, fromTime: Timestamp, toTime: Timestamp): Effort {
        return this.log.filter(le => le.logEntryType == LogEntryType.workItemWorkedOn && (<LogEntryWorkItemWorked>le).worker == wo && le.timestamp > fromTime && le.timestamp <= toTime).length 
    }

    public workerValueContribution(wo: Worker, fromTime: Timestamp, toTime: Timestamp): Value {
        if (this.currentProcessStep != this.sys.outputBasket) return 0
        const effortByWorker =  this.effortPutInByWorker(wo, fromTime, toTime)
        const aux = effortByWorker > 0 ? this.materializedValue() * (effortByWorker / this.log[0].valueChain.normEffort) : 0 
        //console.log(`${wo.id} worked ${effortByWorker} units of time on end product ${this.id}, that materialized ${this.materializedValue().toPrecision(2)}`)
        return aux
    }

    public statisticsEventsHistory(fromTime: Timestamp = 1, toTime: Timestamp = this.sys.clock.time): StatsEventForExitingAProcessStep[]  { // lists all events btw. from and to timestamp when the workitem exited a process step 
        const statEvents: StatsEventForExitingAProcessStep[] = []

        const moveToLogEntries = this.log
                                .filter(le => le.logEntryType == "movedTo")
                                .filter(le => le.timestamp <= toTime)
        let firstMovedToEvent = <LogEntryWorkItem>moveToLogEntries[0]
        let lastMovedToEvent  = <LogEntryWorkItem>moveToLogEntries.pop()
        if (lastMovedToEvent.timestamp <= fromTime) return []

        for (let le of moveToLogEntries.reverse()) {
            statEvents.push(
                {
                    wi:                          this,
                    vc:                          this.valueChain,
                    psExited:                    <ProcessStep>le.workItemBasketHolder,
                    psEntered:                   lastMovedToEvent.workItemBasketHolder,           
                    finishedTime:                lastMovedToEvent.timestamp,
                    elapsedTime:                 lastMovedToEvent.timestamp - le.timestamp,
                    injectionIntoValueChainTime: firstMovedToEvent.timestamp
                }
            )           
            if (le.timestamp <= fromTime) break
            lastMovedToEvent = le
        }
        return statEvents
    }

    public stringified = (): string => `\tt=${this.sys.clock.time} wi=${this.id} ps=${this.currentProcessStep.id} vc=${this.valueChain.id} et=${this.elapsedTime(ElapsedTimeMode.firstToLastEntryFound)} ae=${this.accumulatedEffort(this.sys.clock.time, this.currentProcessStep)} ${this.finishedAtCurrentProcessStep() ? "done" : ""}\n`
}

//----------------------------------------------------------------------
//    WORKITEM EXTENDED INFO   ...for workers' decision making 
//----------------------------------------------------------------------

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
export type WiExtInfoTuple = [WorkItem, wiDecisionInput, wiDecisionInput, wiDecisionInput, wiDecisionInput, wiDecisionInput, wiDecisionInput, wiDecisionInput, wiDecisionInput, wiDecisionInput, wiDecisionInput, wiDecisionInput, wiDecisionInput]

//----------------------------------------------------------------------
//    WORKITEM EXTENDED INFO  
//----------------------------------------------------------------------
export class WorkItemExtendedInfos {
    public workOrderExtendedInfos: WiExtInfoTuple

    constructor(public sys: LonelyLobsterSystem, 
                public wi:  WorkItem) {
        let accumulatedEffortInProcessStep   = wi.accumulatedEffort(sys.clock.time, wi.currentProcessStep)
        let remainingEffortInProcessStep     = (<ProcessStep>wi.currentProcessStep).normEffort - accumulatedEffortInProcessStep
        let accumulatedEffortInValueChain    = wi.accumulatedEffort(sys.clock.time, )
        let remainingEffortInValueChain      = wi.valueChain.processSteps.map(ps => (<ProcessStep>ps).normEffort).reduce((a, b) => a + b) - accumulatedEffortInValueChain

        let visitedProcessSteps              = (<ProcessStep>wi.currentProcessStep).valueChain.processSteps.indexOf(<ProcessStep>wi.currentProcessStep) + 1
        let remainingProcessSteps            = (<ProcessStep>wi.currentProcessStep).valueChain.processSteps.length - visitedProcessSteps
        
        let valueOfValueChain                = (<ProcessStep>wi.currentProcessStep).valueChain.totalValueAdd
        let totalEffortInValueChain          = accumulatedEffortInValueChain + remainingEffortInValueChain
        let contributionOfValueChain         = valueOfValueChain - totalEffortInValueChain

        let sizeOfInventoryInProcessStep     = (<ProcessStep>wi.currentProcessStep).workItemBasket.length

        let elapsedTimeInProcessStep         = wi.elapsedTime(ElapsedTimeMode.firstEntryToNow, wi.currentProcessStep)
        let elapsedTimeInValueChain          = wi.elapsedTime(ElapsedTimeMode.firstEntryToNow)

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
   
   public static stringifiedHeader = (): string => "___wi___vc/ps___________aeps_reps_aevc_revc_vpss_rpss__vvc_tevc__cvc_sips_etps_etvc" 

   public stringifiedDataLine = (): string => `${this.wi.id.toString().padStart(4, ' ')}|${this.wi.tag[0]}: ` 
        + `${((<ProcessStep>this.wi.currentProcessStep).valueChain.id + "/" + this.wi.currentProcessStep.id).padEnd(15, ' ')}`
        + this.workOrderExtendedInfos.slice(1).map(e => (<number>e).toFixed().padStart(5, ' ')).reduce((a, b) => a + b)




}