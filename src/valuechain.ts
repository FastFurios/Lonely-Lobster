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
 * @param time excess time i.e. the additional time above the minimal cycle time it took to reach the output basket
 * @returns the discounted value add 
 * @example discounted(0.1, 100, 1) => 90
 * discounted(0.15, 100, 3) => 61.4125
 */
export function discounted(discRate: number, value: Value, time: TimeUnit): Value {
    return time < 1 ? value : discounted(discRate, value * (1 - discRate), time - 1)
}
/**
 * Calculates the value based on a given expiry time
 * @param expiryTime time period after which and end product gets worthless; before that it has the value add from the value chain
 * @param value work item's value add
 * @param time excess time i.e. the additional time above the minimal cycle time it took to reach the output basket, after which the work item's value is set to 0
 * @returns the resulting value
 * @example expired(3, 100, 2) => 100
 * expired(3, 100, 4) => 0
 */
export function expired(expiryTime: TimeUnit, value: Value, time: TimeUnit): number {
    return time < expiryTime ? value : 0
}
/**
 * No discounting or expiry or anything else
 * @param value work item's value add
 * @param time ignored
 * @returns work item's value add unchanged i.e. as definded in the value chain
 * @example net(100, <any number>) => 100 
*/
export function net(value: Value, time: TimeUnit): Value {
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
        console.log(`\nValueChain.createAndInjectNewWorkItem(): time = ${this.sys.clock.time}; about to inject a new workorder`) // ##
        if (!(<ProcessStep>this.processSteps[0]).reachedWipLimit()) { 
            const wi = new WorkItem(this.sys, this)  // ## delete "const wi =" and subsequent console.log
            console.log(`ValueChain.createAndInjectNewWorkItem(): time = ${this.sys.clock.time}; created new work item= ${wi.id}`)
        }
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
     * @param until timestamp (including the timestamp itself, i.e. <= until)   
     * @returns accumulated effort
     */
    public accumulatedEffortMade(until: Timestamp): Effort {
        return this.processSteps.map(ps => ps.accumulatedEffortMade(until)).reduce((ef1, ef2) => ef1 + ef2)
    } 

    /**
     * returns the norm effort of the value chain (which is by the way also the minimum cycle time) 
     */
    get normEffort(): Effort {
        return this.processSteps.map(ps => ps.normEffort).reduce((e1, e2) => e1 + e2)  // == minimum cycle time thru value chain
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
    
    /** batch mode only */
    public stringifiedHeader(): string {
        const stringifyColumnHeader = (wibh: ProcessStep): string => `_${this.id}.${wibh.id}${"_".repeat(wibh.barLen)}`.substring(0, wibh.barLen)
        return this.processSteps.map(ps => stringifyColumnHeader(ps)).reduce((a, b) => a + "|" + b)  
    } 
    
    /** batch mode only */
    public stringifiedRow = (): string => this.processSteps.map(ps => ps.stringifiedBar()).reduce((a, b) => a + "|" + b)  
}
