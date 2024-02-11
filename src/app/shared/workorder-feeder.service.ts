import { Injectable } from '@angular/core'
import { I_IterationRequest, I_IterationRequests, ValueChainId, Injection, ProcessStepId, WipLimit } from './io_api_definitions'
import { DoubleStringMap } from './helpers'


type VcFeederParmsAndState = {
  aggregatedWorkOrders:   number, // being managed by ...
  parms:                  Injection
}

@Injectable({
  providedIn: 'root'
})
export class WorkorderFeederService {

    private vcFeederTimeUnitMap:    Map<ValueChainId, VcFeederParmsAndState>
    private psVcWipLimitMap:        DoubleStringMap<WipLimit>
    private timeNow:                number

    constructor() { }

    public setInjectionParms(vcId: ValueChainId, inj: Injection): void {
        if (inj.throughput == undefined || inj.probability == undefined) return
        const aggrWos: number = this.vcFeederTimeUnitMap.has(vcId) 
                                ? this.vcFeederTimeUnitMap.get(vcId)!.aggregatedWorkOrders
                                : 0 
        this.vcFeederTimeUnitMap.set(
            vcId, 
            { 
                aggregatedWorkOrders: aggrWos,
                parms: {
                    throughput:     inj.throughput,
                    probability:    inj.probability
                }    
            })
    }

    public getInjectionParms(vcId: ValueChainId): Injection | undefined {
        return this.vcFeederTimeUnitMap.has(vcId) ? this.vcFeederTimeUnitMap.get(vcId)!.parms : undefined
    }

    public setWipLimit(vcId: ValueChainId, psId: ProcessStepId, wipLimit: WipLimit) {
        this.psVcWipLimitMap.dsSet([vcId, psId], wipLimit)
    }

    public iterationRequestsForAllVcs(batchSize: number): I_IterationRequests {
        const iterationRequest: I_IterationRequest = { 
            vcsWorkOrders:  [],
            wipLimits:      []
        } 
        for (const [vcId, vcFeederParmsAndState] of this.vcFeederTimeUnitMap.entries()) {
            vcFeederParmsAndState.aggregatedWorkOrders += vcFeederParmsAndState.parms.throughput 

            let injectWosNum: number
            if (Math.random() < vcFeederParmsAndState.parms.probability) {
                injectWosNum = Math.floor(vcFeederParmsAndState.aggregatedWorkOrders)
                vcFeederParmsAndState.aggregatedWorkOrders -= injectWosNum
            }
            else injectWosNum = 0

            iterationRequest.vcsWorkOrders.push({
                valueChainId: vcId, 
                numWorkOrders: injectWosNum
            })
        }

        for (const [psVcWipLimitKey0, psVcWipLimitKey1, wipLimit] of this.psVcWipLimitMap.dsEntries()) {
            iterationRequest.wipLimits.push({vc: psVcWipLimitKey0, ps: psVcWipLimitKey1, wipLimit: wipLimit})
        }
           
        return [iterationRequest]
    }

    public initialize(): void {
        this.vcFeederTimeUnitMap = new Map<ValueChainId, VcFeederParmsAndState>()
        this.psVcWipLimitMap     = new DoubleStringMap<WipLimit>()
    }
}
