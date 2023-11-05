// ------------------------------------------------------------
//  READ SYSTEM CONFIGURATION FROM JSON FILE OR OBJECT
// ------------------------------------------------------------

import { readFileSync } from "fs"
import { LonelyLobsterSystem } from "./system.js"
import { ValueChain, TimeValuationFct, discounted, expired, net } from './valuechain.js'
import { Worker, AssignmentSet, Assignment } from './worker.js'
import { WiExtInfoElem } from './workitem.js'
import { ProcessStep } from "./workitembasketholder.js"
import { SortVector, SelectionCriterion } from "./helpers.js"

export interface DebugShowOptions  {
    clock:          boolean,
    workerChoices:  boolean,
    readFiles:      boolean
}

interface I_TimeValueFctAndArg {
    function: string,
    argument: number
}

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
            default       : { throw new Error("System config  file: other error: " + e.message) }
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
        injection_throughput?:  number,
        value_degration:        I_TimeValueFctAndArg,
        process_steps:          I_process_step[]  
    }

    function valueDegrationFct(timeValueFctAndArg: I_TimeValueFctAndArg): TimeValuationFct {
        switch (timeValueFctAndArg?.function) {
            case "discounted": return discounted.bind(null, timeValueFctAndArg.argument) 
            case "expired"   : return expired.bind(null, timeValueFctAndArg.argument)
            default: { 
                console.log(`WARNING: Reading system parameters: value degration function \"${timeValueFctAndArg?.function}\" not known to Lonely Lobster; resorting to \"net()\"`)
                return net
            }
        }
    }

    const debugShowOptions: DebugShowOptions  = {
                                                    clock          : paj.debug_show_options == undefined ? false : paj.debug_show_options.clock,
                                                    workerChoices  : paj.debug_show_options == undefined ? false : paj.debug_show_options.worker_choices,
                                                    readFiles      : paj.debug_show_options == undefined ? false : paj.debug_show_options.read_files
                                                }

    const sys = new LonelyLobsterSystem(systemId, debugShowOptions)

    const newProcessStep         = (psj:  I_process_step, vc: ValueChain)   : ProcessStep   => new ProcessStep(sys, psj.process_step_id, vc, psj.norm_effort, psj.bar_length)
    const newEmptyValueChain     = (vcj:  I_value_chain)                    : ValueChain    => new ValueChain(sys, vcj.value_chain_id, vcj.value_add, vcj.injection_throughput, valueDegrationFct(vcj.value_degration))
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
    interface I_worker {
        worker_id:                                  string
        select_next_work_item_sort_vector_sequence: I_sortVector[]
        process_step_assignments:                   I_process_step_assignment[]
    }
    interface I_sortVector {
        measure:             WiExtInfoElem
        selection_criterion: SelectionCriterion
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
        const svs: SortVector[] = woj.select_next_work_item_sort_vector_sequence == undefined 
                                ? [] 
                                : woj.select_next_work_item_sort_vector_sequence?.map(svj => sortVectorFromJson(svj))
        return new Worker(sys, woj.worker_id, svs) 
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

    // return the configured system
    return sys
}