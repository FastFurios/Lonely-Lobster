// ------------------------------------------------------------
//  READ SYSTEM CONFIGURATION FROM JSON FILE OR OBJECT
// ------------------------------------------------------------

import { readFileSync } from "fs"
import { LonelyLobsterSystem } from "./system.js"
import { I_Injection, Injection, TimeUnit } from "./io_api_definitions"
import { ValueChain, TimeValuationFct, discounted, expired, net } from './valuechain.js'
import { Worker, AssignmentSet, Assignment, WeightedSelectionStrategy, LearnAndAdaptParms, SuccessMeasureFunction, successMeasureIvc, successMeasureRoce, successMeasureNone } from './worker.js'
import { WiExtInfoElem } from './workitem.js'
import { ProcessStep } from "./workitembasketholder.js"
import { SortVector, SelectionCriterion, SortVectorSequence, arrayWithNormalizedWeights} from "./helpers.js"

export interface DebugShowOptions  {
    clock:          boolean,
    workerChoices:  boolean,
    readFiles:      boolean
}

interface I_TimeValueFctAndArg {
    function: string,
    argument: number
}

type I_SuccessMeasureFct = string

const observationPeriodDefault: TimeUnit  = 20   
const weightAdjustmentDefault:  number    = 0.3  

// -------------------------------------------------------------------------
// Create system configuration from JSON file (when running in batch mode)
// -------------------------------------------------------------------------

export function systemCreatedFromConfigFile(filename : string) : LonelyLobsterSystem {
    // read system parameter JSON file
    let paramsAsString : string = ""
    try { paramsAsString  = readFileSync(filename, "utf8") } 
    catch (e: any) {
        switch (e.code) {
            case "ENOENT" : { throw new Error("System config file not found: " + e) }
            default       : { throw new Error("System config file: other error: " + e.message) }
        }   
    } 
    finally {}

    const paj: any = JSON.parse(paramsAsString)  // "paj" = parameters as JSON 
    return systemCreatedFromConfigJson(paj)
}

// -----------------------------------------------------------------------------------------------------------
// Create system from JSON config object
// -----------------------------------------------------------------------------------------------------------

export function systemCreatedFromConfigJson(paj: any) : LonelyLobsterSystem {
    // extract system id
    const systemId: string = paj.system_id

    // extract value chains
    interface I_process_step {
        process_step_id:        string
        norm_effort:            number
        bar_length:             number
    } 
    
    interface I_value_chain {
        value_chain_id:         string
        value_add:              number,
        injection?:             I_Injection,
        value_degradation:      I_TimeValueFctAndArg,
        process_steps:          I_process_step[]  
    }

    function valueDegradationFct(timeValueFctAndArg: I_TimeValueFctAndArg): TimeValuationFct {
        switch (timeValueFctAndArg?.function) {
            case "discounted": return discounted.bind(null, timeValueFctAndArg.argument) 
            case "expired"   : return expired.bind(null, timeValueFctAndArg.argument)
            default: { 
                console.log(`WARNING: Reading system parameters: value degration function \"${timeValueFctAndArg?.function}\" not known to Lonely Lobster; resorting to \"net()\"`)
                return net
            }
        }
    }

    function successMeasureFct(smf: I_SuccessMeasureFct): SuccessMeasureFunction  {
        console.log("io_config: successMeasureFct(\"" + smf + "\")")
        switch (smf) {
            case "ivc":     return successMeasureIvc   // ivc = individual value contribution (how much realized value is attributed to my effort?)
            case "roce":    return successMeasureRoce  // roce = system's return on capital employed 
            case "none":    return successMeasureNone  // no measurement 
            default: { 
                console.log(`WARNING: Reading system parameters: learn & adapt success function \"${smf}\" not known to Lonely Lobster; resorting to \"successMeasureNone()\"`)
                return successMeasureNone
            }
        }
    }

    const debugShowOptions: DebugShowOptions  = {
                                                    clock          : paj.debug_show_options == undefined ? false : paj.debug_show_options.clock,
                                                    workerChoices  : paj.debug_show_options == undefined ? false : paj.debug_show_options.worker_choices,
                                                    readFiles      : paj.debug_show_options == undefined ? false : paj.debug_show_options.read_files
                                                }

    const sys = new LonelyLobsterSystem(systemId, debugShowOptions)

    function filledInjectionParms(inj?: I_Injection): Injection {
        return inj ? { "throughput":  inj!.throughput  ? inj!.throughput  : 1, "probability": inj!.probability ? inj!.probability : 1 }
                   : { "throughput":  1,                                       "probability": 1 } 
    }                                                

    const newProcessStep         = (psj:  I_process_step, vc: ValueChain)   : ProcessStep   => new ProcessStep(sys, psj.process_step_id, vc, psj.norm_effort, psj.bar_length)
    const newEmptyValueChain     = (vcj:  I_value_chain)                    : ValueChain    => new ValueChain(sys, vcj.value_chain_id, vcj.value_add, filledInjectionParms(vcj.injection), valueDegradationFct(vcj.value_degradation))
    const addProcStepsToValChain = (pssj: I_process_step[], vc: ValueChain) : void          => pssj.forEach(psj => vc.processSteps.push(newProcessStep(psj, vc))) 
    const filledValueChain       = (vcj:  I_value_chain)                    : ValueChain    => {
        const newVc: ValueChain = newEmptyValueChain(vcj)
        addProcStepsToValChain(vcj.process_steps, newVc)
        return newVc
    }
    const valueChains: ValueChain[] = paj.value_chains.map((vcj: I_value_chain) => filledValueChain(vcj))
    sys.addValueChains(valueChains)

    // extract workers and assignments
    interface I_process_step_assignment {
        value_chain_id:     string
        process_steps_id:   string
    }
    interface I_sortVector {
        measure:             WiExtInfoElem
        selection_criterion: SelectionCriterion
    }
    interface I_availableSelectionStrategy {
        id:         string
        strategy:   I_sortVector[]
    }
    interface I_worker {
        worker_id:                                              string
        select_next_work_item_sort_vector_sequence:             I_sortVector[] // deprecated, replaced by ... see next line 
        workitem_selection_strategies:                          I_availableSelectionStrategy[]
        process_step_assignments:                               I_process_step_assignment[]
    }
    
    const createdNewWorker = (woj: I_worker): Worker => { 
        function sortVectorFromJson(svj: I_sortVector): SortVector {
            if (Object.getOwnPropertyDescriptor(WiExtInfoElem, svj.measure) == undefined) { 
                console.log(`Reading system parameters: selecting next workitem by \"${svj.measure}\" is an unknown measure`)
                throw new Error(`Reading system parameters: selecting next workitem by \"${svj.measure}\" is an unknown measure`)
            }
            if (Object.getOwnPropertyDescriptor(SelectionCriterion, svj.selection_criterion) == undefined) { 
                console.log(`Reading system parameters: selecting next workitem by \"${svj.measure}\" has unknown sort order \"${svj.selection_criterion}\"`)
                throw new Error(`Reading system parameters: selecting next workitem by \"${svj.measure}\" has unknown sort order \"${svj.selection_criterion}\"`)
            }
            return {
                colIndex: Object.getOwnPropertyDescriptor(WiExtInfoElem, svj.measure)!.value,
                selCrit:  Object.getOwnPropertyDescriptor(SelectionCriterion, svj.selection_criterion)!.value
            } 
        }

        let weightedSelStrategies: WeightedSelectionStrategy[]
        if (woj.workitem_selection_strategies) {  // the new property, introduced in Rel.3, is used
            weightedSelStrategies = woj.workitem_selection_strategies == undefined 
                                        ? [ { element: { id: "random", strategy: [] }, weight: 1 }] // random ("[]") is the only available selection strategy 
                                        : arrayWithNormalizedWeights(woj.workitem_selection_strategies.map(strat => { 
                                            return { 
                                                element: { 
                                                    id:         strat.id,
                                                    strategy:   strat.strategy.map(svj => sortVectorFromJson(svj)) 
                                                },
                                                weight: 1
                                            }}), (x => x) /* take numbers as is */)      
        } else if (woj.select_next_work_item_sort_vector_sequence) {
            // in case we did not find the new property "workitem_selection_strategies" try to find the deprecated old
            // property "select_next_work_item_sort_vector_sequence"
            const svs: SortVectorSequence = woj.select_next_work_item_sort_vector_sequence == undefined 
                                          ? [] // random ("[]") is the only available selection strategy
                                          : woj.select_next_work_item_sort_vector_sequence?.map(svj => sortVectorFromJson(svj))
            weightedSelStrategies = [{ element: {id: "#unnamed#", strategy: svs}, weight: 1 }]
        } else 
            weightedSelStrategies = [{ element: { id: "random", strategy: [] }, weight: 1 }] // random ("[]") is the only available selection strategy

        return new Worker(sys, woj.worker_id, weightedSelStrategies) 
    }

    const addWorkerAssignment = (psaj: I_process_step_assignment, newWorker: Worker, vcs: ValueChain[], asSet: AssignmentSet): void  => {
        const mayBeVc = vcs.find(vc => vc.id == psaj.value_chain_id)
        if (mayBeVc == undefined) { 
            console.log(`Reading system parameters: tried to assign worker \"${newWorker.id}\" to value chain \"${psaj.value_chain_id}\": could not find value chain`)
            throw new Error(`Reading system parameters: tried to assign worker \"${newWorker.id}\" to value chain \"${psaj.value_chain_id}\": could not find value chain`)
        }
        const vc: ValueChain  = mayBeVc

        const mayBePs = vc.processSteps.find(ps => ps.id == psaj.process_steps_id)
        if (mayBePs == undefined) { 
            console.log(`Reading system parameters: tried to assign worker \"${newWorker.id}\" to process step "\${psaj.process_steps_id}"\ in value chain=${psaj.value_chain_id}: could not find process step`)
            throw new Error(`Reading system parameters: tried to assign worker \"${newWorker.id}\" to process step "\${psaj.process_steps_id}"\ in value chain=${psaj.value_chain_id}: could not find process step`) 
        }
        const ps: ProcessStep = mayBePs

        const newAssignment: Assignment =  { worker:                 newWorker,            
                                             valueChainProcessStep:  { valueChain:  vc, 
                                                                       processStep: ps }}
        asSet.assignments.push(newAssignment)
    }

    const createAndAssignWorker = (woj: I_worker, workers: Worker[], valueChains: ValueChain[], asSet: AssignmentSet): void => { 
        const newWorker: Worker = createdNewWorker(woj)
        workers.push(newWorker)
        woj.process_step_assignments.forEach(psaj => addWorkerAssignment(psaj, newWorker, valueChains, asSet))
    }
 
    const workers: Worker[] = [] 
    const asSet:   AssignmentSet = new AssignmentSet("default")
    paj.workers.forEach((woj: I_worker) => createAndAssignWorker(woj, workers, valueChains, asSet))
    
    sys.addWorkersAndAssignments(workers, asSet)

    const learnAndAdaptParms: LearnAndAdaptParms = paj.learn_and_adapt_parms ? 
        {
            observationPeriod: paj.learn_and_adapt_parms.observation_period ? paj.learn_and_adapt_parms.observation_period : 20,
            successMeasureFct: successMeasureFct(paj.learn_and_adapt_parms.success_measure_function ? paj.learn_and_adapt_parms.success_measure_function : "none"),
            adjustmentFactor:  paj.learn_and_adapt_parms.adjustment_factor  ? paj.learn_and_adapt_parms.adjustment_factor  : 0.3 
        } : {
            observationPeriod: 20,
            successMeasureFct: successMeasureFct(paj.learn_and_adapt_parms.success_measure_function ? paj.learn_and_adapt_parms.success_measure_function : "none"),
            adjustmentFactor:  0.3 
        }
    console.log("io_config: learn&adapt: successMeasureFct = " + learnAndAdaptParms.successMeasureFct)

    sys.addLearningParameters(learnAndAdaptParms)

    // return the configured system
    return sys
}