//----------------------------------------------------------------------
/**
 * VALUE CHAIN
 */
//----------------------------------------------------------------------
// last code cleaning: 05.01.2025

import { TimeUnit, Timestamp, Value, ValueChainId, Effort, Injection } from './io_api_definitions'
import { LonelyLobsterSystem } from './system.js'
import { WorkItem } from './workitem.js'
import { WorkItemBasketHolder, ProcessStep } from './workitembasketholder.js'

// ------------------------------------------------------------
// discounting financial value
// ------------------------------------------------------------

/**
 * Type of a function that calculates the value add of a work item over time 
 * @param time is the time from injection to completion minus the minimal cycle time (i.e. sum of norm efforts), or in other words the excess time beyond the minimum cycle time 
 * @returns the work items's remaining value
 */
export type TimeValuationFct = (value: Value, time: TimeUnit) => Value

/**
 * Calculates the remaining value based on a discount rate
 * @param discRate the discount rate per time unit between 0 and 1, e.g. 0.1 is 10%  
 * @param value work item's value add
 * @param excessTime excess time i.e. the additional time above the minimal cycle time it took to reach the output basket
 * @returns the discounted value add 
 * @example discounted(0.1, 100, 1) => 90
 * discounted(0.15, 100, 3) => 61.4125
 */
export function discounted(discRate: number, value: Value, excessTime: TimeUnit): Value {
    return excessTime < 1 ? value : discounted(discRate, value * (1 - discRate), excessTime - 1)
}
/**
 * Calculates the value based on a given expiry time
 * @param expiryTime time period from which on an end product gets worthless; before that it has the value add from the value chain
 * @param value work item's value add
 * @param excessTime excess time i.e. the additional time above the minimal cycle time it took to reach the output basket
 * @returns 0 if time >= expireTime, otherwise the work item's value chain value-add 
 * @example expired(3, 100, 2) => 100
 * expired(3, 100, 4) => 0
 * expired(3, 100, 3) => 0
 */
export function expired(expiryTime: TimeUnit, value: Value, excessTime: TimeUnit): number {
    return excessTime < expiryTime ? value : 0
}
/**
 * No discounting or expiry or anything else
 * @param value work item's value add
 * @param excessTime ignored
 * @returns work item's value add unchanged i.e. as definded in the value chain
 * @example net(100, <any number>) => 100 
*/
export function net(value: Value, excessTime: TimeUnit): Value {
    return value
}

//----------------------------------------------------------------------
// VALUE CHAIN 
//----------------------------------------------------------------------

/**
 * Value chain in an Lonely Lobster system
 */
export class ValueChain {
    /** process steps of the value chain */
    public processSteps: ProcessStep[] = []

    constructor(public sys:               LonelyLobsterSystem,
                public id:                ValueChainId,
                public totalValueAdd:     Value,
                public injection:         Injection,
                public valueDegradation:  TimeValuationFct = net) { 
    }   

    /**
     * if wip limit is set and not yet reached create a new work item and inject it into the process step 
     */
    public createAndInjectNewWorkItem(): void { 
        if (!(<ProcessStep>this.processSteps[0]).reachedWipLimit()) new WorkItem(this.sys, this)
    }

    /**
     * Identify the next work item basket holder after the given process step 
     * @param ps given process step
     * @returns the following process step or the output basket if ps was the last process step in the value chain
     */
    private nextWorkItemBasketHolder(ps: ProcessStep): WorkItemBasketHolder {
        const psi = this.processSteps.indexOf(ps) 
        return psi == this.processSteps.length - 1 ? this.sys.outputBasket : this.processSteps[psi + 1]
    }

    /**
     * Update the statistical data of the work items in the value chain
     */
    public updateWorkItemsExtendedInfos(): void {
         this.processSteps.forEach(ps => ps.updateWorkItemsExtendedInfos())
    }

    /**
     * Move all work items in this value chain to the next basket holder
     */
    public letWorkItemsFlow(): void { 
        this.processSteps.forEach(ps => ps.letWorkItemsFlowTo(this.nextWorkItemBasketHolder(ps)))
    }

    /**
     * Calculate the accumulated effort that had gone into work items having been in the value chain until the given timestamp
     * @param until timestamp (inclusive)   
     * @returns accumulated effort
     */
    public accumulatedEffortMade(fromTime: Timestamp, toTime: Timestamp): Effort {
        return this.processSteps.map(ps => ps.accumulatedEffortMade(fromTime, toTime)).reduce((ae1, ae2) => ae1 + ae2)
    } 

    /**
     * returns the norm effort of the value chain (which is by the way also the minimum cycle time) 
     */
    get normEffort(): Effort {
        return this.processSteps.map(ps => ps.normEffort).reduce((e1, e2) => e1 + e2)
    }

    /** returns the minimum cycle time of work items in the value chain */
    get minimalCycleTime(): TimeUnit {  // correct as long as at every timestamp only 1 worker can work the workitem, otherwise needs modification
        return this.normEffort
    } 

    /**
     * @returns all work item lifecycle events in the value chain 
     */
    public get allWorkitemLifecycleEvents() {
        return this.processSteps.flatMap(ps => ps.allWorkitemLifecycleEvents)
    }
    
    /**
     * @returns the number of process steps in the value chain 
     */
    public get length() {
        return this.processSteps.length
    }
    
    /** batch mode only */
    public stringifiedHeader(): string {
        const stringifyColumnHeader = (wibh: ProcessStep): string => `_${this.id}.${wibh.id}${"_".repeat(wibh.barLen)}`.substring(0, wibh.barLen)
        return this.processSteps.map(ps => stringifyColumnHeader(ps)).reduce((a, b) => a + "|" + b)  
    } 
    
    /** batch mode only */
    public stringifiedRow = (): string => this.processSteps.map(ps => ps.stringifiedBar()).reduce((a, b) => a + "|" + b)  
}
