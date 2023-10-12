//----------------------------------------------------------------------
//    WORKERS 
//----------------------------------------------------------------------

import { Timestamp } from './clock.js'
import { topElemAfterSort, SortVector } from "./helpers.js"
import { LogEntry, LogEntryType } from './logging.js'
import { ValueChain } from './valuechain.js'
import { WorkItem, WiExtInfoElem, WiExtInfoTuple, WorkItemExtendedInfos } from './workitem.js'
import { ProcessStep } from './workitembasketholder.js'
import { LonelyLobsterSystem } from './system'


//----------------------------------------------------------------------
//    WORKER BEHAVIOUR 
//----------------------------------------------------------------------

 function selectNextWorkItemBySortVector(wis: WorkItem[], svs: SortVector[]): WorkItem { // take the top-ranked work item after sorting the accessible work items
    const extInfoTuples: WiExtInfoTuple[] = wis.map(wi => wi.extendedInfos.workOrderExtendedInfos) 
    const selectedWi: WiExtInfoTuple = topElemAfterSort(extInfoTuples, svs)
    return selectedWi[WiExtInfoElem.workItem]  // return workitem object reference
} 

//----------------------------------------------------------------------
//    WORKER LOGGING 
//----------------------------------------------------------------------

class LogEntryWorker extends LogEntry {
    constructor(public sys:     LonelyLobsterSystem,
                public worker:  Worker) {
        super(sys, LogEntryType.workerWorked)
    }
    public stringified = (): string => `${this.stringifiedLe()}, ${this.logEntryType}, wo=${this.worker.id}` 
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

interface ValueChainProcessStep {
    valueChain:  ValueChain,
    processStep: ProcessStep
}

type WorkerName = string
type WorkerStats = {
    assignments: ValueChainProcessStep[],  
    utilization: number // in percent, i.e. 55 is 55%
}

export class Worker {
    log:    LogEntryWorker[] = []
    stats:  WorkerStats = { 
        assignments: [],
        utilization: 0
     }

    constructor(private sys:                LonelyLobsterSystem,
                public  id:                 WorkerName,
                private sortVectorSequence: SortVector[]) {}

    private logWorked(): void { this.log.push(new LogEntryWorker(this.sys, this)) }

    private  workItemsAtHand(asSet: AssignmentSet): WorkItem[] {
        const pss: ProcessStep[] = asSet.assignments.filter(as => as.worker.id == this.id).map(as => as.valueChainProcessStep.processStep)
        return pss.flatMap(ps => ps.workItemBasket) 
    }

    private hasWorkedAt(timestamp: Timestamp): boolean { 
        return this.log.filter(le => le.timestamp == timestamp).length > 0
    }

    public work(asSet: AssignmentSet): void {
        if (this.hasWorkedAt(this.sys.clock.time)) return    // worker has already worked at current time

        const workableWorkItemsAtHand: WorkItem[] = this.workItemsAtHand(asSet)
                                                    .filter(wi => !wi.finishedAtCurrentProcessStep())               // not yet in OutputBasket
                                                    .filter(wi => !wi.hasBeenWorkedOnAtCurrentTime(this.sys.clock.time))     // no one worked on it at current time

        if (workableWorkItemsAtHand.length == 0) return // no workable workitems at hand

        if(this.sys.debugShowOptions.workerChoices) console.log("Worker__" + WorkItemExtendedInfos.stringifiedHeader())
        if(this.sys.debugShowOptions.workerChoices) workableWorkItemsAtHand.forEach(wi => console.log(`${this.id.padEnd(6, ' ')}: ${wi.extendedInfos.stringifiedDataLine()}`)) // ***

        const wi: WorkItem = selectNextWorkItemBySortVector(workableWorkItemsAtHand, this.sortVectorSequence)

        if(this.sys.debugShowOptions.workerChoices) console.log(`=> ${this.id} picked: ${wi.id}|${wi.tag[0]}`)

        wi.logWorkedOn(this)
        this.logWorked()
    }

    public utilization(sys: LonelyLobsterSystem): void {
        this.stats.utilization = this.log.length / (this.sys.clock.time - this.sys.clock.firstIteration) * 100 
        this.stats.assignments = sys.assignmentSet.assignments
                                .filter(a => a.worker.id == this.id)
                                .map(a => { return { valueChain:  a.valueChainProcessStep.valueChain,
                                                     processStep: a.valueChainProcessStep.processStep }
                                            })
    }
}
