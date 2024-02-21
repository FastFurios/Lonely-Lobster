//----------------------------------------------------------------------
//    WORKITEM BASKET HOLDER
//----------------------------------------------------------------------

import { LonelyLobsterSystem } from './system.js'
import { ValueChain } from './valuechain.js'
import { WorkItem, ElapsedTimeMode, StatsEventForExitingAProcessStep } from './workitem.js'
import { Timestamp, Value, Effort, I_EndProductStatistics, I_EndProductMoreStatistics, WipLimit } from './io_api_definitions.js'
import { LogEntry, LogEntryType } from './logging.js'

//----------------------------------------------------------------------
//    W.I.P. LIMIT CHANGE LOG 
//----------------------------------------------------------------------

class LogEntryWipLimit extends LogEntry {
    constructor(public sys:             LonelyLobsterSystem,
                public valueChain:      ValueChain, 
                public processStep:     ProcessStep,
                public wipLimit:        WipLimit) {
        super(sys, LogEntryType.wipLimitSet) 
    }

    public stringified = () => `${this.stringifiedLe()}, ${this.logEntryType}, vc = ${this.valueChain.id}, ps = ${this.processStep.id}, set wipLimit to = ${this.wipLimit}`
}


// ------------------------------------------------------------
// WORKITEM BASKET HOLDER
// ------------------------------------------------------------

export abstract class WorkItemBasketHolder {
    public workItemBasket: WorkItem[] = []

    constructor(public sys:     LonelyLobsterSystem,
                public id:      string, 
                public barLen:  number = 20) {}

    public addToBasket(workItem: WorkItem) { 
        this.workItemBasket.push(workItem) 
        workItem.logMovedTo(this)
    }

    public flowStats(fromTime: Timestamp, toTime: Timestamp): StatsEventForExitingAProcessStep[] {
        return this.workItemBasket.flatMap(wi => wi.statisticsEventsHistory(fromTime, toTime))
    }

    public accumulatedEffortMade(until: Timestamp): Effort {
        return this.workItemBasket.map(wi => wi.accumulatedEffort(until)).reduce((ef1, ef2) => ef1 + ef2, 0 )
    }

    public abstract stringified(): string

    public stringifiedBar = (): string => { 
        const strOfBskLen = this.workItemBasket.length.toString()
        return this.workItemBasket
                .map(wi => wi.workedOnAtCurrentProcessStep() ? wi.tag[1] : wi.tag[0])
                .reduce((a, b) => a + b, "")
                .padEnd(this.barLen - strOfBskLen.length, " ")
                .substring(0, this.barLen - strOfBskLen.length)
            + strOfBskLen 
    }  

    public stringifyBasketItems = (): string => this.workItemBasket.length == 0 ? "empty" : this.workItemBasket.map(wi => "\t\t" + wi.stringified()).reduce((a, b) => a + " " + b)
}

//----------------------------------------------------------------------
//    PROCESS STEP 
//----------------------------------------------------------------------

export class ProcessStep extends WorkItemBasketHolder  {
    public  lastIterationFlowRate: number = 0
    private wipLimitLog:           LogEntryWipLimit[] = []

    constructor(       sys:           LonelyLobsterSystem,
                       id:            string,
                public valueChain:    ValueChain,
                public normEffort:    Effort,
                       wipLimit:      WipLimit | undefined,
                       barLen:        number) {
        super(sys, id, barLen)
        
        this.wipLimitLog.push(new LogEntryWipLimit(sys, valueChain, this, wipLimit ? wipLimit : 0))
    }

    public get wipLimit(): WipLimit { return this.wipLimitLog[this.wipLimitLog.length - 1].wipLimit }

    public reachedWipLimit(): boolean { 
        return this.wipLimit > 0 ? this.workItemBasket.length >= this.wipLimit : false 
    }

    public removeFromBasket(workItem: WorkItem) { 
        this.lastIterationFlowRate += this.workItemBasket.some(wi => wi == workItem) ? 1 : 0  
        this.workItemBasket = this.workItemBasket.filter(wi => wi != workItem)  
    }

    public set wipLimit(wipLimit: WipLimit) {
        this.wipLimitLog.push(new LogEntryWipLimit(this.sys, this.valueChain, this, wipLimit))
    } 

    public stringified = () => `\tt=${this.sys.clock.time} basket of ps=${this.id} ne=${this.normEffort}:\n` + this.stringifyBasketItems()
}


//----------------------------------------------------------------------
//    OUTPUT BASKET 
//----------------------------------------------------------------------
//-- overall  OUTPUT BASKET (just one unique instance): here the total output of all value chains is collected over time

export class OutputBasket extends WorkItemBasketHolder {
    constructor(public sys: LonelyLobsterSystem) { 
        super(sys, "OutputBasket")
    } 

    private statsOfArrivedWorkitemsBetween(fromTime: Timestamp, toTime: Timestamp): I_EndProductStatistics {
        const invWisStats: I_EndProductStatistics[] = []
        const wisArrived = this.workItemBasket.filter(wi => wi.hasMovedToOutputBasketBetween(fromTime, toTime))  //  all workitems that have transitioned into output basket after fromTime and up to toTime

        const emptyWorkItemInInventoryStatistics = {
            numWis:             0,
            normEffort:         0,
            elapsedTime:        0,
            netValueAdd:        0,
            discountedValueAdd: 0
        }

        if (wisArrived.length < 1) return emptyWorkItemInInventoryStatistics

        for (let wi of wisArrived) {  // process all workitems that have transitioned into output basket after fromTime and up to toTime
            const normEffort            = wi.log[0].valueChain.normEffort
            const minCycleTime          = wi.log[0].valueChain.minimalCycleTime
            const elapsedTime           = wi.elapsedTime(ElapsedTimeMode.firstToLastEntryFound)
            const netValueAdd           = wi.log[0].valueChain.totalValueAdd
            const discountedValueAdd    = wi.log[0].valueChain.valueDegration!(netValueAdd, elapsedTime - minCycleTime)
            invWisStats.push(
                {
                    numWis:             1,
                    normEffort:         normEffort,
                    elapsedTime:        elapsedTime,
                    netValueAdd:        netValueAdd,
                    discountedValueAdd: discountedValueAdd 
                })
        }
        const wiBasedStats = invWisStats.reduce(
            (iws1, iws2) => { return {
                numWis:             iws1.numWis             + iws2.numWis,
                normEffort:         iws1.normEffort         + iws2.normEffort,  
                elapsedTime:        iws1.elapsedTime        + iws2.elapsedTime,
                netValueAdd:        iws1.netValueAdd        + iws2.netValueAdd,
                discountedValueAdd: iws1.discountedValueAdd + iws2.discountedValueAdd }}, 
            emptyWorkItemInInventoryStatistics)

        return wiBasedStats
    }
    
    public endProductMoreStatistics(fromTime: Timestamp, toTime: Timestamp): I_EndProductMoreStatistics {
        // --- calculating figures for end products in the output basket ---
        const wiBasedStats = this.statsOfArrivedWorkitemsBetween(fromTime, toTime)
    
        return {
            ...wiBasedStats,
            avgElapsedTime: wiBasedStats.elapsedTime / (wiBasedStats.numWis > 0 ? wiBasedStats.numWis : 1),  
        }
    }

    public revenues(fromTime: Timestamp, toTime: Timestamp): Value {
        return this.statsOfArrivedWorkitemsBetween(fromTime, toTime).discountedValueAdd
    }

    public stringified  = () => `t=${this.sys.clock.time} ${this.id}:\n` + this.stringifyBasketItems()
}
