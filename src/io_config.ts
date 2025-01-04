// ------------------------------------------------------------
/** 
 * READ SYSTEM CONFIGURATION FROM JSON FILE OR JSON OBJECT
 */
// ------------------------------------------------------------
// last code cleaning: 04.01.2025

import { readFileSync } from "fs"
import { SortVector, SelectionCriterion, arrayWithNormalizedWeights} from "./helpers.js"
import { LonelyLobsterSystem } from "./system.js"
import { Injection, I_FrontendPresets, valueDegradationFunctionNames, successMeasureFunctionNames, I_SortVectorAsJson, I_GloballyDefinedWorkitemSelectionStrategyAsJson, I_ConfigAsJson, I_ValueChainAsJson, I_ProcessStepAsJson, I_InjectionAsJson, I_ValueDegradationAsJson, I_WorkerAsJson } from "./io_api_definitions.js"
import { Worker, AssignmentSet, Assignment, WeightedSelectionStrategy, LearnAndAdaptParms, SuccessMeasureFunction, successMeasureIvc, successMeasureRoce, successMeasureNone } from './worker.js'
import { WiExtInfoElem } from './workitem.js'
import { ProcessStep } from "./workitembasketholder.js"
import { ValueChain, TimeValuationFct, discounted, expired, net } from './valuechain.js'
import { PeakSearchParms } from "./optimize.js"

/** parameters what should be logged to the console */
export interface DebugShowOptions  {
    clock:          boolean,
    workerChoices:  boolean,
    readFiles:      boolean
}


// -------------------------------------------------------------------------
/**
 * Create system configuration from json config FILE (when running in batch mode)
 * @param filename read a json system configuration file (in batch mode)
 * @returns the system instance
 */
// -------------------------------------------------------------------------
export function systemCreatedFromConfigFile(filename : string) : LonelyLobsterSystem {
    // read system parameter JSON file
    let paramsAsString : string = ""
    try { paramsAsString  = readFileSync(filename, "utf8") } 
    catch (e: any) {
        switch (e.code) {
            case "ENOENT" : { throw new Error("io_config: System config file not found: " + e) }
            default       : { throw new Error("io_config: System config file: other error: " + e.message) }
        }   
    } 
    finally {}

    const paj: I_ConfigAsJson = JSON.parse(paramsAsString)  // "paj" = parameters as JSON 
    return systemCreatedFromConfigJson(paj)
}

// -----------------------------------------------------------------------------------------------------------
/** 
 * Create system from a json config OBJECT provided by the frontend (when in api mode)
 * @param paj Parameter AsJson - the system configuration
 * @returns the system instance
 */
// -----------------------------------------------------------------------------------------------------------
export function systemCreatedFromConfigJson(paj: I_ConfigAsJson) : LonelyLobsterSystem {
    // extract system id
    const systemId: string = paj.system_id

    const c_barLength = 20 // for display on console in batch mode 

    /**
     * Read the configuration definition name of a value degradation function and create a system's @see {@link TimeValuationFct} 
     * @param valueDegradationFunctionAndArgument configuration definition of a value degradation function; values: {@see {@link valueDegradationFunctionNames}}
     * @returns a @see {@link TimeValuationFct} of the system instance
     */
    function valueDegradationFct(valueDegradationFunctionAndArgument: I_ValueDegradationAsJson | undefined): TimeValuationFct {
            switch (valueDegradationFunctionAndArgument?.function) {
            case valueDegradationFunctionNames[0]: { return discounted.bind(null, valueDegradationFunctionAndArgument.argument) }
            case valueDegradationFunctionNames[1]: { return expired.bind(null, valueDegradationFunctionAndArgument.argument)    }
            default: { 
                console.log(`WARNING: io_config: Reading system parameters: value degration function \"${valueDegradationFunctionAndArgument?.function}\" not known to Lonely Lobster; resorting to \"net()\"`)
                return net
            }
        }
    }

    /** name of a success measure function */
    type I_SuccessMeasureFct = string
    /**
     * Read the configuration definition of a success measure function and create a system's @see {@link SuccessMeasureFunction} 
     * @param smf configuration definition name of a success measure function; values: @see {@link successMeasureFunctionNames}
     * @returns a @see {@link SuccessMeasureFunction} of the system instance
     */
    function successMeasureFct(smf: I_SuccessMeasureFct): SuccessMeasureFunction  {
        // console.log("io_config: successMeasureFct(\"" + smf + "\")")
        switch (smf) {
            case successMeasureFunctionNames[0]: { return successMeasureIvc  } // ivc = individual value contribution (how much realized value is attributed to my effort?)
            case successMeasureFunctionNames[1]: { return successMeasureRoce } // roce = system's return on capital employed 
            case successMeasureFunctionNames[2]: { return successMeasureNone } // no measurement 
            default: { 
                console.log(`WARNING: io_config: Reading system parameters: learn & adapt success function \"${smf}\" not known to Lonely Lobster; resorting to \"successMeasureNone()\"`)
                return successMeasureNone
            }
        }
    }

    /** the created system */
    const sys = new LonelyLobsterSystem(systemId)

    /**
     * fill the injection parameters, use defaults if undefined in configuration
     * @param inj injection parameters if any 
     * @returns a @see {@link Injection} of the system instance
     */
    function filledInjectionParms(inj?: I_InjectionAsJson): Injection {
        return inj ? { "throughput":  inj!.throughput  ? inj!.throughput  : 1, "probability": inj!.probability ? inj!.probability : 1 }
                   : { "throughput":  1,                                       "probability": 1 } 
    }                                                

    /**
     * Create new process step
     * @param psj process step definition in the configuration 
     * @param vc value chain in the configuration
     * @returns a system value chain's process step 
     */
    const newProcessStep         = (psj:  I_ProcessStepAsJson, vc: ValueChain)   : ProcessStep   => new ProcessStep(sys, psj.process_step_id, vc, psj.norm_effort, psj.wip_limit, c_barLength)
    /**
     * Create an empty system value chain 
     * @param vcj value chain definition in the configuration
     * @returns a system's value chain
     */
    const newEmptyValueChain     = (vcj:  I_ValueChainAsJson)                    : ValueChain    => new ValueChain(sys, vcj.value_chain_id, vcj.value_add, filledInjectionParms(vcj.injection), valueDegradationFct(vcj.value_degradation))
    /**
     * Add process step from the configuration to a system value chain
     * @param pssj process step definition from the configuration
     * @param vc a value chain of the system
     * @returns empty value chain
     */
    const addProcStepsToValChain = (pssj: I_ProcessStepAsJson[], vc: ValueChain) : void          => pssj.forEach(psj => vc.processSteps.push(newProcessStep(psj, vc))) 
    /**
     * Create a system value chain from the configuration definition 
     * @param vcj value chain configuration definition
     * @returns value chain 
     */
    const filledValueChain       = (vcj:  I_ValueChainAsJson)                    : ValueChain    => {
        const newVc: ValueChain = newEmptyValueChain(vcj)
        addProcStepsToValChain(vcj.process_steps, newVc)
        return newVc
    }
    const valueChains: ValueChain[] = paj.value_chains.map((vcj: I_ValueChainAsJson) => filledValueChain(vcj))
    sys.addValueChains(valueChains)

    // extract workers and assignments
    interface I_process_step_assignment {
        value_chain_id:     string
        process_steps_id:   string
    }
   
    /**
     * Create a new system worker from the configuration definition
     * @param woj configuration definition of the worker
     * @returns worker for the system
     */
    const createdNewWorker = (woj: I_WorkerAsJson): Worker => {
        // console.log("createdNewWorker() param="); console.log(woj)

        /**
         * Create a sort vector from the configuration definition
         * @param svj sort vector definition in the configuration
         * @returns sort vector
         */
        function sortVectorFromJson(svj: I_SortVectorAsJson): SortVector {
            if (Object.getOwnPropertyDescriptor(WiExtInfoElem, svj.measure) == undefined) { 
                console.log(`io_config: Reading system parameters: selecting next workitem by \"${svj.measure}\" is an unknown measure`)
                throw new Error(`Reading system parameters: selecting next workitem by \"${svj.measure}\" is an unknown measure`)
            }
            if (Object.getOwnPropertyDescriptor(SelectionCriterion, svj.selection_criterion) == undefined) { 
                console.log(`io_config: Reading system parameters: selecting next workitem by \"${svj.measure}\" has unknown sort order \"${svj.selection_criterion}\"`)
                throw new Error(`Reading system parameters: selecting next workitem by \"${svj.measure}\" has unknown sort order \"${svj.selection_criterion}\"`)
            }
            return {
                colIndex: Object.getOwnPropertyDescriptor(WiExtInfoElem, svj.measure)!.value,
                selCrit:  Object.getOwnPropertyDescriptor(SelectionCriterion, svj.selection_criterion)!.value
            } 
        }

        /**
         * Find the globally defined workitem selection strategyin the configuration by its name 
         * @param sId name of the strategy
         * @returns the configuration definiton of the strategy 
         */    
        function globallyDefinedStrategy(sId: string): I_GloballyDefinedWorkitemSelectionStrategyAsJson | undefined {
            return (<I_GloballyDefinedWorkitemSelectionStrategyAsJson[]>paj.globally_defined_workitem_selection_strategies).find(s => s.id == sId)
        } 
        let weightedSelStrategies: WeightedSelectionStrategy[] = woj.workitem_selection_strategies == undefined || woj.workitem_selection_strategies.length == 0
                                        ? [ { element: { id: "random", strategy: [] }, weight: 1 }] // random ("[]") is the only available selection strategy 
                                        : arrayWithNormalizedWeights(woj.workitem_selection_strategies
                                                .map(sId => globallyDefinedStrategy(sId))
                                                .filter(strat => strat != undefined)
                                                .map(strat => { return { 
                                                                    element: { 
                                                                        id:         strat!.id,
                                                                        strategy:   strat!.strategy.map(svj => sortVectorFromJson(svj)) 
                                                                    },
                                                                    weight: 1
                                                                }}), (x => x) /* take numbers as is */)       
            return new Worker(sys, woj.worker_id, weightedSelStrategies) 
    }

    /**
     * Adds a worker's assignment to a process step to the system's workers assignment set
     * @param psaj process step assigment in the configuration
     * @param newWorker the worker who is assigned
     * @param vcs the list of value chains in the system that hold all the process steps in the system
     * @param asSet the list of process step assignments of all workers in the system
     */
    const addWorkerAssignment = (psaj: I_process_step_assignment, newWorker: Worker, vcs: ValueChain[], asSet: AssignmentSet): void  => {
        const mayBeVc = vcs.find(vc => vc.id == psaj.value_chain_id)
        if (mayBeVc == undefined) { 
            console.log(`io_config: Reading system parameters: tried to assign worker \"${newWorker.id}\" to value chain \"${psaj.value_chain_id}\": could not find value chain`)
            throw new Error(`Reading system parameters: tried to assign worker \"${newWorker.id}\" to value chain \"${psaj.value_chain_id}\": could not find value chain`)
        }
        const vc: ValueChain  = mayBeVc

        const mayBePs = vc.processSteps.find(ps => ps.id == psaj.process_steps_id)
        if (mayBePs == undefined) { 
            console.log(`io_config: Reading system parameters: tried to assign worker \"${newWorker.id}\" to process step "\${psaj.process_steps_id}"\ in value chain=${psaj.value_chain_id}: could not find process step`)
            throw new Error(`Reading system parameters: tried to assign worker \"${newWorker.id}\" to process step "\${psaj.process_steps_id}"\ in value chain=${psaj.value_chain_id}: could not find process step`) 
        }
        const ps: ProcessStep = mayBePs
        const newAssignment: Assignment =  { worker:                 newWorker,            
                                             valueChainProcessStep:  { valueChain:  vc, 
                                                                       processStep: ps }}
        asSet.assignments.push(newAssignment)
    }

    /**
     * Create a worker and assign him to the process steps according the configuration definitions  
     * @param woj configuration definition of the worker
     * @param workers system's list of all workers
     * @param valueChains system's list of all value chains
     * @param asSet system's list of all worker assignments
     */
    const createAndAssignWorker = (woj: I_WorkerAsJson, workers: Worker[], valueChains: ValueChain[], asSet: AssignmentSet): void => { 
        const newWorker: Worker = createdNewWorker(woj)
        workers.push(newWorker)
        woj.process_step_assignments.forEach(psaj => addWorkerAssignment(psaj, newWorker, valueChains, asSet))
    }
 
    const workers: Worker[] = [] 
    /** system's global set of assigments of workers to process steps */
    const asSet:   AssignmentSet = new AssignmentSet("default")
    paj.workers.forEach((woj: I_WorkerAsJson) => createAndAssignWorker(woj, workers, valueChains, asSet))
    
    sys.addWorkersAndAssignments(workers, asSet)

    const learnAndAdaptParms: LearnAndAdaptParms = paj.learn_and_adapt_parms ? 
        {
            observationPeriod: paj.learn_and_adapt_parms.observation_period ? paj.learn_and_adapt_parms.observation_period : 20,
            successMeasureFct: successMeasureFct(paj.learn_and_adapt_parms.success_measure_function ? paj.learn_and_adapt_parms.success_measure_function : "none"),
            adjustmentFactor:  paj.learn_and_adapt_parms.adjustment_factor  ? paj.learn_and_adapt_parms.adjustment_factor  : 0.3 
        } : {
            observationPeriod: 20,
            successMeasureFct: successMeasureFct("none"),
            adjustmentFactor:  0.3 
        }
    // console.log("io_config: learn&adapt: successMeasureFct = " + learnAndAdaptParms.successMeasureFct)

    sys.addLearningParameters(learnAndAdaptParms)

    /** parameters for WIP limit optimization */
    const searchParms: PeakSearchParms = {
            initTemperature:                    paj.wip_limit_search_parms?.initial_temperature                 ? paj.wip_limit_search_parms.initial_temperature                    : 100,
            temperatureCoolingParm:             paj.wip_limit_search_parms?.cooling_parm                        ? paj.wip_limit_search_parms.cooling_parm                           : 0.95,
            degreesPerDownhillStepTolerance:    paj.wip_limit_search_parms?.degrees_per_downhill_step_tolerance ? paj.wip_limit_search_parms.degrees_per_downhill_step_tolerance    : 50,
            initJumpDistance:                   paj.wip_limit_search_parms?.initial_jump_distance               ? paj.wip_limit_search_parms.initial_jump_distance                  : 1,
            measurementPeriod:                  paj.wip_limit_search_parms?.measurement_period                  ? paj.wip_limit_search_parms.measurement_period                     : 100,
            wipLimitUpperBoundaryFactor:        paj.wip_limit_search_parms?.wip_limit_upper_boundary_factor     ? paj.wip_limit_search_parms?.wip_limit_upper_boundary_factor       : 2,
            searchOnAtStart:                    paj.wip_limit_search_parms?.search_on_at_start                  ? paj.wip_limit_search_parms.search_on_at_start                     : false,
            verbose:                            paj.wip_limit_search_parms?.verbose                             ? paj.wip_limit_search_parms.verbose                                : true 
        }
    sys.addWipLimitSearchParameters(searchParms)

4   /** parameters of frontend presets */
    const feps: I_FrontendPresets = {
        numIterationPerBatch:                   paj.frontend_preset_parameters?.num_iterations_per_batch ? paj.frontend_preset_parameters.num_iterations_per_batch : 1,
        economicsStatsInterval:                 paj.frontend_preset_parameters?.economics_stats_interval ? paj.frontend_preset_parameters.economics_stats_interval : 0
    }
    sys.addFrontendPresets(feps)

    // return the configured system
    return sys
}