//----------------------------------------------------------------------
/**
 *    WORKITEM BASKET HOLDER
 */
//----------------------------------------------------------------------

import { LogEntry, LogEntryType } from './logging.js'
import { Timestamp, Effort, I_EndProductStatistics, I_EndProductMoreStatistics, WipLimit } from './io_api_definitions.js'
import { WorkItem, WorkItemFlowEventStats } from './workitem.js'
import { ValueChain } from './valuechain.js'
import { LonelyLobsterSystem, ToString } from './system.js'

//----------------------------------------------------------------------
//    WIP LIMIT CHANGE LOG 
//----------------------------------------------------------------------

/**
 * Process step log entry for changed work-in-progress limit 
 */
class LogEntryWipLimit extends LogEntry {
    constructor(public sys:             LonelyLobsterSystem,
                public valueChain:      ValueChain, 
                public processStep:     ProcessStep,
                public wipLimit:        WipLimit) {
        super(sys.clock.time, LogEntryType.wipLimitsVector) 
    }

    public toString = () => `${super.toString()}, ${this.logEntryType}, vc = ${this.valueChain.id}, ps = ${this.processStep.id}, set wipLimit to = ${this.wipLimit}`
}


// ------------------------------------------------------------
/**
 *      WORKITEM BASKET HOLDER -    abstract base class for 
 *                                  process steps and output basket
 */
// ------------------------------------------------------------
export abstract class WorkItemBasketHolder implements ToString {
    /** work items in the basket holder */
    public workItemBasket: WorkItem[] = []

    constructor(public sys:         LonelyLobsterSystem,
                public id:          string,
                /** for batch mode console display only */
                public barLen:      number = 20) { }  // ## delete when batch mode is modified to frontend workload file loading  

    /**
     * add work item to the basket
     * @param wi the work item to be added
     */            
    public add(wi: WorkItem): void {
        this.workItemBasket.push(wi)
    }    
 
    /**
     * Collect flow statistics events for the basket holder in the given interval
     * @param fromTime start of interval (inclusive)
     * @param toTime end of interval (inclusive)
     * @returns list of statistic events for the basket holder
     */
    public flowStats(fromTime: Timestamp, toTime: Timestamp): WorkItemFlowEventStats[] {
        return this.workItemBasket.flatMap(wi => wi.flowStatisticsEventsHistory(fromTime, toTime))
    }

    /**
     * Calculate the accumulated effort made to work items over all visited process steps  
     * @param until point in time until made efforts are considered   
     * @returns accumulated effort
     */
    public accumulatedEffortMade(fromTime: Timestamp, toTime: Timestamp): Effort {
        return this.workItemBasket.map(wi => wi.accumulatedEffort(fromTime, toTime)).reduce((ef1, ef2) => ef1 + ef2, 0 )
    }

    /**
     * @returns all lifecycle events in the workitem basket holder 
     */
    public get allWorkitemLifecycleEvents() {
        return this.workItemBasket.flatMap(wi => wi.allWorkitemLifecycleEvents)
    }
    
    /**
     * @returns the number of work items being in this work item basket holder 
     */
    public get inventorySize() {
        return this.workItemBasket.length
    }
    
    /** batch mode only ## */
    public stringifiedBar = (): string => { 
        const strOfBskLen = this.workItemBasket.length.toString()
        return this.workItemBasket
                .map(wi => wi.workedOnAtCurrentProcessStep() ? wi.tag[1] : wi.tag[0])
                .reduce((a, b) => a + b, "")
                .padEnd(this.barLen - strOfBskLen.length, " ")
                .substring(0, this.barLen - strOfBskLen.length)
            + strOfBskLen 
    }  

    public toString(): string {
        return `Work item basket holder: t=${this.sys.clock.time} wibh=${this.id} ${this.workItemBasket.length == 0 ? "empty" : this.workItemBasket.map(wi => `\t\t${wi}`).reduce((a, b) => a + " " + b)}`
    }
}
//----------------------------------------------------------------------
/**
 *      PROCESS STEP
 */
//----------------------------------------------------------------------
export class ProcessStep extends WorkItemBasketHolder  {
    /** flow rate of the last iteration */
    public  lastIterationFlowRate: number = 0
    /** log with the wip limit changes */
    private wipLimitLog:           LogEntryWipLimit[] = []

    constructor(       sys:           LonelyLobsterSystem,
                       id:            string,
                /** value chain to which this process step belongs */
                public valueChain:    ValueChain,
                /** work effort required to finish a work item in this process step */
                public normEffort:    Effort,
                /** work-in-progress limit setting */
                       wipLimit:      WipLimit | undefined,
                /** batch mode only */
                       barLen:        number) {  // ##
        super(sys, id, barLen)
        this.wipLimitLog.push(new LogEntryWipLimit(sys, valueChain, this, wipLimit ? wipLimit : 0))
    }

    /**
     * @returns the current work-in-progress limit 
     */
    public get wipLimit(): WipLimit { return this.wipLimitLog[this.wipLimitLog.length - 1].wipLimit }

    /**
     * @returns true if the number of work items in the process step has reached the set work-in-progress limit, else false 
     */
    public reachedWipLimit(): boolean { 
        return this.wipLimit > 0 ? this.workItemBasket.length >= this.wipLimit : false 
    }

    /**
     * remove a work item from the process step when it moves to the next (or to the output basket);
     * increment the flow rate 
     * @param workItem the given work item
     */
    public removeFromBasket(workItem: WorkItem): void { 
        this.lastIterationFlowRate += this.workItemBasket.some(wi => wi == workItem) ? 1 : 0  
        this.workItemBasket = this.workItemBasket.filter(wi => wi != workItem)  
    }

    /**
     * moves a work item from a process step into another work item basket holder, and log this event in the work item's log
     * @param wi work item to be moved 
     * @param toWibh target work item basekt holder
     */
    private moveTo(wi: WorkItem, toWibh: WorkItemBasketHolder) {
        this.removeFromBasket(wi)  // take the work item from this process step ...
        toWibh.add(wi)             // ... and add in into the target ...
        wi.moveTo(toWibh)          // ... and log the move within the work item
    }

    /**
     * moves finished work items from this process step to the next work item basket holder
     * @param toWibh work item basket holder the work items are to move to 
     */
    public letWorkItemsFlowTo(toWibh: WorkItemBasketHolder): void { 
        this.workItemBasket                   
            .filter(wi => wi.finishedAtCurrentProcessStep())                    // filter the workitems ready to be moved on
            .forEach(wi => this.moveTo(wi, toWibh))                             // move these workitems on
    }

    /**
     * Update the statistical data of the work items in the process step
     */
    public updateWorkItemsExtendedInfos(): void {
        this.workItemBasket.forEach(wi => wi.updateExtendedInfos())
   }

    /**
     * set a work-in-progress limit 
     */
    public set wipLimit(wipLimit: WipLimit) {
        this.wipLimitLog.push(new LogEntryWipLimit(this.sys, this.valueChain, this, wipLimit))
    } 

    /** batch mode only ## */
    public toString = () => `\t${this.valueChain.id}.${this.id}` 
}



//----------------------------------------------------------------------
/**
 *    OUTPUT BASKET     overall output basket (just one unique instance 
 *                      for the system): here the total output of end products 
 *                      of all value chains is collected over time
 */
//----------------------------------------------------------------------
export class OutputBasket extends WorkItemBasketHolder {
    constructor(public sys: LonelyLobsterSystem) { 
        super(sys, "OutputBasket")
    } 

    /**
     * Calculate aggregated end-product based statistics
     * @param fromTime start of interval (inclusive)
     * @param toTime end of interval (inclusive)
     * @returns aggregated end-product based statistics
     */
    public statsOfArrivedWorkitemsBetween(fromTime: Timestamp, toTime: Timestamp): I_EndProductMoreStatistics {
        /** end-product statistics */
        const invWisStats: I_EndProductStatistics[] = []
        /** work items that reached the output basket within the time interval */
        const wisArrived = this.workItemBasket.filter(wi => wi.hasMovedToOutputBasketBetween(fromTime, toTime))
        /** define statistics if no end-products yet */
        const emptyWorkItemInInventoryStatistics = {
            numWis:             0,
            normEffort:         0,
            elapsedTime:        0,
            netValueAdd:        0,
            discountedValueAdd: 0,
            avgElapsedTime:     0
        }
        if (wisArrived.length < 1) return emptyWorkItemInInventoryStatistics

        /** process all work items that have transitioned into output basket from fromTime and up to toTime */
        for (let wi of wisArrived) {
            const normEffort            = wi.valueChain.normEffort
            const minCycleTime          = wi.valueChain.minimalCycleTime
            const elapsedTime           = wi.cycleTimeInValueChain()!
            const netValueAdd           = wi.valueChain.totalValueAdd
            const discountedValueAdd    = wi.valueChain.valueDegradation!(netValueAdd, elapsedTime - minCycleTime)
            invWisStats.push(
                {
                    numWis:             1,
                    normEffort:         normEffort,
                    elapsedTime:        elapsedTime,
                    netValueAdd:        netValueAdd,
                    discountedValueAdd: discountedValueAdd 
                })
        }
        /** aggregated work items statistics data of the output basket */
        const wiBasedStats = invWisStats.reduce(
            (iws1, iws2) => { return {
                numWis:             iws1.numWis             + iws2.numWis,
                normEffort:         iws1.normEffort         + iws2.normEffort,  
                elapsedTime:        iws1.elapsedTime        + iws2.elapsedTime,
                netValueAdd:        iws1.netValueAdd        + iws2.netValueAdd,
                discountedValueAdd: iws1.discountedValueAdd + iws2.discountedValueAdd }}, 
            emptyWorkItemInInventoryStatistics)

        console.log(`Wibh.statsOfArrivedWorkitemsBetween(${fromTime}, ${toTime}): numWis=${wiBasedStats.numWis}, normEffort=${wiBasedStats.normEffort}, elapsedTime=${wiBasedStats.elapsedTime}, netValueAdd=${wiBasedStats.netValueAdd}, discValueAdd=${wiBasedStats.discountedValueAdd}, avgElapsedTime=${wiBasedStats.elapsedTime / (wiBasedStats.numWis > 0 ? wiBasedStats.numWis : 1)}`)    
        return { ...wiBasedStats,
                 avgElapsedTime: wiBasedStats.elapsedTime / (wiBasedStats.numWis > 0 ? wiBasedStats.numWis : 1) }  

    }
}
