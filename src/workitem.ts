//----------------------------------------------------------------------
//    WORK ITEM  
//----------------------------------------------------------------------
//-- terminology remark: work item: at the beginning it is typically a work order, in its final state it is the end-product / service ------------------------------------------------------------------------

//import { last } from 'rxjs'
import { clock, outputBasket, idGen, tagGen } from './_main.js'
import { TimeUnit, Timestamp } from './clock.js'
import { LogEntry, LogEntryType } from './logging.js'
import { Value, ValueChain } from './valuechain.js'
import { Worker } from './worker.js'
import { WorkItemBasketHolder, ProcessStep, Effort } from './workitembasketholder.js'

//----------------------------------------------------------------------
//    HELPERS 
//----------------------------------------------------------------------

export type WorkItemId = number

export interface WorkOrder {
    timestamp:  Timestamp,
    valueChain: ValueChain
}


// unique workitem identifier
export function* workItemIdGenerator(): IterableIterator<WorkItemId> { 
    for(let i = 0; true; i++) yield i 
}

// workitem tags for display: lower letter = untouched, upper letter = some work already exerted
type WorkItemTag = [string, string]
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
    constructor(    public workItem:            WorkItem,       
                    public valueChain:          ValueChain, 
                    public workItemBasketHolder:WorkItemBasketHolder,
                           logEntryType:        LogEntryType) {
        super(logEntryType)
    }

    public stringifyLeWi = () => `${this.stringifiedLe()}, ${this.logEntryType}, vc = ${this.valueChain.id}, ps = ${this.workItemBasketHolder == outputBasket ? "OutputBasket" : (<ProcessStep>this.workItemBasketHolder).id}, wi = ${this.workItem.id}`
} 

//      -- moved -- used also for "workitem created and injected" ---
export class LogEntryWorkItemMoved extends LogEntryWorkItem {
    constructor(       workItem:                   WorkItem,
                       valueChain:                 ValueChain, 
                       toWorkItemBasketHolder:     WorkItemBasketHolder) { 
        super(workItem, valueChain, toWorkItemBasketHolder, LogEntryType.workItemMovedTo)
    }

    public stringified = () => `${this.stringifyLeWi()}`
}

//      -- worked --
export class LogEntryWorkItemWorked extends LogEntryWorkItem {
    constructor(            workItem:                   WorkItem,
                            valueChain:                 ValueChain, 
                            processStep:                ProcessStep,
                     public worker:                     Worker) {
        super(workItem, valueChain, processStep, LogEntryType.workItemWorkedOn)
    }

    public stringified = () => `${this.stringifyLeWi()}, worker = ${this.worker.id}`
}

//----------------------------------------------------------------------
//    WORK ITEM  
//----------------------------------------------------------------------

export enum ElapsedTimeMode {
    firstToLastEntryFound,   // timestamp of last entry found minus timestamp of first entry found in a workitem list
    firstEntryToNow          // clock.time minus timestamp of first entry found in workitem list
}

export interface StatsEventForExitingAProcessStep {
    wi:           WorkItem,
    vc:           ValueChain,
    psExited:       ProcessStep,        
    psEntered:    WorkItemBasketHolder,
    finishedTime: Timestamp,
    elapsedTime:  TimeUnit,
    injectionIntoValueChainTime: Timestamp // used for calculating cycletimes of the valuechain  
}

export class WorkItem {
    /* private */ log:            LogEntryWorkItem[] = []
    public  id:             WorkItemId
    public  tag:            WorkItemTag
    public  extendedInfos:  WorkItemExtendedInfos

    constructor(public valueChain:          ValueChain,
                public currentProcessStep:  WorkItemBasketHolder) {
        this.id             = idGen.next().value
        this.tag            = tagGen.next().value
        this.extendedInfos  = new WorkItemExtendedInfos(this)   
    }

    public logMovedTo(toProcessStep: WorkItemBasketHolder): void {
        this.log.push(new LogEntryWorkItemMoved(    this,
                                                    this.valueChain, 
                                                    toProcessStep ))
    }

    public logWorkedOn(worker: Worker): void {
        this.log.push(new LogEntryWorkItemWorked(   this,
                                                    this.valueChain, 
                                                    <ProcessStep>this.currentProcessStep,
                                                    worker ))
    }

    public elapsedTime (mode: ElapsedTimeMode, workItemBasketHolder?: WorkItemBasketHolder): TimeUnit { 
        const logInScope: LogEntryWorkItem[] = workItemBasketHolder == undefined ? this.log
                                                                                 : this.log.filter(le => le.workItemBasketHolder == workItemBasketHolder)
        if (logInScope.length == 0) return -1                                                                         
        
        const maxTime   = mode == ElapsedTimeMode.firstEntryToNow ? clock.time : Math.max(logInScope[logInScope.length - 1].timestamp)  // ## Math.max?! WTF 
        const minTime   = logInScope[0].timestamp
        const deltaTime = maxTime - minTime

        return deltaTime
    }

    public timeOfLastLogEntry = (): Timestamp => this.log[this.log.length - 1].timestamp

    public accumulatedEffort = (workItemBasketHolder?: WorkItemBasketHolder): Effort =>
        (workItemBasketHolder == undefined ? this.log 
                                           : this.log.filter(le => le.workItemBasketHolder == workItemBasketHolder))
        .filter(le => le.logEntryType == LogEntryType.workItemWorkedOn).length

    public hasBeenWorkedOnAtCurrentTime = (timestamp: Timestamp, ps?: ProcessStep): boolean  => // ## "ps?: ProcessStep" delete?
        this.log.filter(le => (le.timestamp == timestamp && le.logEntryType == LogEntryType.workItemWorkedOn)).length > 0
    
    public workedOnAtCurrentProcessStep = (): boolean => 
        this.accumulatedEffort(<ProcessStep>this.currentProcessStep) > 0

    public finishedAtCurrentProcessStep = (): boolean => 
        this.accumulatedEffort(<ProcessStep>this.currentProcessStep) >= (<ProcessStep>this.currentProcessStep).normEffort

    public updateExtendedInfos(): void {
        this.extendedInfos = new WorkItemExtendedInfos(this)         
    }

    public statisticsEventsHistory(fromTime: Timestamp = 0, toTime: Timestamp = clock.time): StatsEventForExitingAProcessStep[]  { // lists all events btw. from and to timestamp when the workitem exited a process step 
        console.log("workitem.statsEventsForFinishingAProcessSteps(fromTime: " + fromTime + ", toTime: " + toTime +") for wi = " + this.id)
        const statEvents: StatsEventForExitingAProcessStep[] = []

        const moveToLogEntries = this.log
                                .filter(le => le.logEntryType == "movedTo")
                                .filter(le => le.timestamp <= toTime)
//      console.log("workitem.statsEventsForFinishingAProcessSteps().moveToLogEntries=")
//      console.log(moveToLogEntries)
        let firstMovedToEvent = <LogEntryWorkItem>moveToLogEntries[0]
        let lastMovedToEvent  = <LogEntryWorkItem>moveToLogEntries.pop()
        if (lastMovedToEvent.timestamp <= fromTime) return []

//      console.log("workitem.statsEventsForFinishingAProcessSteps().lastMovedToEvent=")
//      console.log(lastMovedToEvent)
        for (let le of moveToLogEntries.reverse()) {
/*
            const aux =                 {
                wi:                          this,
                vc:                          this.valueChain,
                psExited:                    <ProcessStep>le.workItemBasketHolder,
                psEntered:                   lastMovedToEvent.workItemBasketHolder,           
                finishedTime:                lastMovedToEvent.timestamp,
                elapsedTime:                 lastMovedToEvent.timestamp - le.timestamp,
                injectionIntoValueChainTime: firstMovedToEvent.timestamp
            }
            if (clock.time > 20 && this.id == 0) console.log("workitem.statitsicsEventsHistory().for-loop: going to append to statEvents = { wi=" + this.id + ", " + aux.psExited.id + "=>" + aux.psEntered.id + ", finTime=" + aux.finishedTime)
*/
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

    public stringified = (): string => `\tt=${clock.time} wi=${this.id} ps=${this.currentProcessStep.id} vc=${this.valueChain.id} et=${this.elapsedTime(ElapsedTimeMode.firstToLastEntryFound)} ae=${this.accumulatedEffort(this.currentProcessStep)} ${this.finishedAtCurrentProcessStep() ? "done" : ""}\n`
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

export class WorkItemExtendedInfos {
    public workOrderExtendedInfos: WiExtInfoTuple

    constructor(public wi: WorkItem) {
        let accumulatedEffortInProcessStep   = wi.accumulatedEffort(wi.currentProcessStep)
        let remainingEffortInProcessStep     = (<ProcessStep>wi.currentProcessStep).normEffort - accumulatedEffortInProcessStep
        let accumulatedEffortInValueChain    = wi.accumulatedEffort()
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