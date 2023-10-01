// --------------------------------------------------------------------------------
//  take api request and feed it to the LonelyLobster system for the next iteration
// --------------------------------------------------------------------------------

import { duplicate } from "./helpers.js"
import { LonelyLobsterSystem } from "./system.js"
import { ValueChain } from './valuechain.js'
import { WorkOrder, WiExtInfoElem } from './workitem.js'
import { I_IterationRequest, I_SystemState, I_ValueChain, I_ProcessStep, I_WorkItem, I_OutputBasket, I_WorkerState } from './io_api_definitions.js'
import { WorkItem, wiTags } from './workitem.js';
import { ProcessStep, OutputBasket } from './workitembasketholder.js';
//23.9. import { clock, outputBasket } from './_main.js'
import { Worker } from './worker';

//?? 3.7.23 type ValueChainId = string 

export function emptyIterationRequest(sys: LonelyLobsterSystem): I_IterationRequest {
  return {
    time: 0,
    newWorkOrders: sys.valueChains.map(vc => { 
      return {
        valueChainId: vc.id, 
        numWorkOrders: 0

      } 
    })
  }
}

export function nextSystemState(sys: LonelyLobsterSystem, iterReq: I_IterationRequest): I_SystemState { // iterReq is undefined when initialization request received
//  console.log("Lonely Lobster Backend: io_api: nextSystemState(" + sys.id + "): iterReq=")
//  console.log(iterReq)

    function workOrderList(sys: LonelyLobsterSystem, iterReq: I_IterationRequest): WorkOrder[] {
        //    console.log("io_api//workOrderList/iterReq =")
        //    console.log(iterReq)
            return iterReq.newWorkOrders.flatMap(nwo => duplicate<WorkOrder>(
                                                    { timestamp:    sys.clock.time, // iterReq.time!, 
                                                      valueChain:   sys.valueChains.find(vc => vc.id == nwo.valueChainId.trim())! },
                                                    nwo.numWorkOrders ))
    }
    
    function i_systemState(sys: LonelyLobsterSystem): I_SystemState {

      function i_workItem (wi: WorkItem): I_WorkItem { 
        return {
          id:                 wi.id,
          tag:                wiTags[0],
          valueChainId:       wi.valueChain.id,
          value:              wi.valueChain.totalValueAdd,
          maxEffort:          (<ProcessStep>wi.currentProcessStep).normEffort,
          processStepId:      wi.currentProcessStep.id,
          accumulatedEffort:  wi.extendedInfos.workOrderExtendedInfos[WiExtInfoElem.accumulatedEffortInProcessStep],
          elapsedTime:        wi.extendedInfos.workOrderExtendedInfos[WiExtInfoElem.elapsedTimeInProcessStep]
        }
      }

      function i_processStep(ps: ProcessStep): I_ProcessStep {
        return {
          id:                 ps.id,
          normEffort:         ps.normEffort,
          workItems:          ps.workItemBasket.map(wi => i_workItem(wi)),
          workItemFlow:       ps.lastIterationFlowRate
        }
      }

      function i_valueChain(vc: ValueChain): I_ValueChain {
        return {
          id:                 vc.id,
          totalValueAdd:      vc.totalValueAdd,
          injectionThroughput:vc.injectionThroughput ? vc.injectionThroughput : 1,
          processSteps:       vc.processSteps.map(ps => i_processStep(ps))
        }
      }

      function i_endProduct (wi: WorkItem): I_WorkItem { 
        return {
          id:                 wi.id,
          tag:                wiTags[0],
          valueChainId:       wi.valueChain.id,
          value:              wi.valueChain.totalValueAdd,
          maxEffort:          wi.valueChain.processSteps.map(ps => ps.normEffort).reduce((e1, e2) => e1 + e2),
          processStepId:      wi.currentProcessStep.id,
          accumulatedEffort:  wi.extendedInfos.workOrderExtendedInfos[WiExtInfoElem.accumulatedEffortInValueChain],
          elapsedTime:        wi.extendedInfos.workOrderExtendedInfos[WiExtInfoElem.elapsedTimeInValueChain]
        }
      }

      function i_outputBasket(ob: OutputBasket): I_OutputBasket {
        return {
          workItems: ob.workItemBasket.map(wi => i_endProduct(wi))
        }
      }

      function i_workerState(wo: Worker): I_WorkerState {
        return {
          worker:      wo.id,
          utilization: wo.stats.utilization,
          assignments: wo.stats.assignments.map(a => {
            return {
              valueChain:  a.valueChain.id,
              processStep: a.processStep.id
            }
          })
        }
      }

      return {
        id:           sys.id,
        time:         sys.clock.time,
        valueChains:  sys.valueChains.map(vc => i_valueChain(vc)),
        outputBasket: { workItems: sys.outputBasket.workItemBasket.map(wi => i_endProduct(wi)) },
        workersState: sys.workers.map(wo => i_workerState(wo))
      }
    }

//  console.log("io_api/nextSystemState() iterReq=")
//  console.log(iterReq)

    sys.doNextIteration(
        sys.clock.time, 
        workOrderList(sys, 
                      { time:          sys.clock.time,
                        newWorkOrders: iterReq.newWorkOrders } ))

//    console.log("io.api: nextSystemState()")
//    sys.valueChains.forEach(vc => vc.processSteps
//                    .forEach(ps =>ps.workItemBasket
//                      .forEach(wi => wi.log
////                      .filter(le => true /*le.logEntryType == LogEntryType.workItemMovedTo*/)
//                        .forEach(le => console.log("\ttime= " + clock.time + ", vc= " + vc.id + ", ps= " + ps.id + ", wi= " + wi.id + "/" + wi.tag[0] + ", le= " + le.logEntryType)
//                        )
//                      )
//                    )
//    )
    
    return i_systemState(sys)
}

