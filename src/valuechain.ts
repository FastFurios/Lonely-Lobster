//----------------------------------------------------------------------
//    VALUE CHAIN 
//----------------------------------------------------------------------
import { TimeUnit, Timestamp, Value, ValueChainId, Effort } from './io_api_definitions'
import { LonelyLobsterSystem } from './system.js'
import { WorkItem } from './workitem.js'
import { WorkItemBasketHolder, ProcessStep } from './workitembasketholder.js'

// ------------------------------------------------------------
// discounting financial value
// ------------------------------------------------------------

export type TimeValuationFct = (value: Value, time: TimeUnit) => Value  // time is the time from injection to completion minus the minimal cycle time (i.e. sum of norm efforts) 

export function discounted(discRate: number, value: Value, time: TimeUnit): Value {
    return time < 1 ? value : discounted(discRate, value * (1 - discRate), time - 1)
}
export function expired(expiryTime: TimeUnit, value: Value, time: TimeUnit): number {
    return time < expiryTime ? value : 0
}
export function net(value: Value, time: TimeUnit): Value {
    return value
}

//----------------------------------------------------------------------
// VALUE CHAIN 
//----------------------------------------------------------------------

export class ValueChain {
    public processSteps: ProcessStep[] = []

    constructor(public sys:             LonelyLobsterSystem,
                public id:              ValueChainId,
                public totalValueAdd:   Value,
                public injectionThroughput?: number,
                public valueDegration: TimeValuationFct = net) {   // call signatutre is valueDegration(totalValueAdd: Value, excessTime: Timeunit) where excessTime is the additional time above the minimal cycle time it took to reach the output basket
    }   

    public createAndInjectNewWorkItem(): void { 
        const wi = new WorkItem(this.sys, this, this.processSteps[0])
        this.processSteps[0].addToBasket(wi)
    }

    private nextWorkItemBasketHolder(ps: ProcessStep): WorkItemBasketHolder {
        const psi = this.processSteps.indexOf(ps) 
        return psi == this.processSteps.length - 1 ? this.sys.outputBasket : this.processSteps[psi + 1]
    }

    private moveWorkItemToNextWorkItemBasketHolder(wi: WorkItem): void {
        (<ProcessStep>wi.currentProcessStep).removeFromBasket(wi)
        const nextProcessStep: WorkItemBasketHolder = this.nextWorkItemBasketHolder(<ProcessStep>wi.currentProcessStep) 
        wi.currentProcessStep = nextProcessStep
        nextProcessStep.addToBasket(wi)
    }

    public updateWorkItemExtendedInfos(): void {
         this.processSteps.forEach(ps => ps.workItemBasket.forEach(wi => wi.updateExtendedInfos()))
    }

    public letWorkItemsFlow(): void { 
        this.processSteps.forEach(ps =>                                             // for all process steps in the value chain 
            ps.workItemBasket                   
                .filter(wi => wi.finishedAtCurrentProcessStep())                    // filter the workitems ready to be moved on
                .forEach(wi => this.moveWorkItemToNextWorkItemBasketHolder(wi)))    // move these workitems on
    }

    public accumulatedEffortMade(until: Timestamp): Effort {
        return this.processSteps.map(ps => ps.accumulatedEffortMade(until)).reduce((ef1, ef2) => ef1 + ef2)
    } 

    get normEffort(): Effort {
        return this.processSteps.map(ps => ps.normEffort).reduce((e1, e2) => e1 + e2)  // == minimum cycle time thru value chain
    }

    get minimalCycleTime(): TimeUnit {  // correct as long as at every timestamp only 1 worker can work the workitem, otherwise needs modification
        return this.normEffort
    } 

    public stringifiedHeader(): string {
        const stringifyColumnHeader = (wibh: ProcessStep): string => `_${this.id}.${wibh.id}${"_".repeat(wibh.barLen)}`.substring(0, wibh.barLen)
        return this.processSteps.map(ps => stringifyColumnHeader(ps)).reduce((a, b) => a + "|" + b)  
    } 
    
    public stringifiedRow = (): string => this.processSteps.map(ps => ps.stringifiedBar()).reduce((a, b) => a + "|" + b)  
}
