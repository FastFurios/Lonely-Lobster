//----------------------------------------------------------------------
// Lonely Lobster API and general type definitions 
//----------------------------------------------------------------------

import { SourceMap } from "module"

// the master of this file is located in the project "Lonely Lobster".
// Do not forget to copy the latest version over to the Angular frontend project (use the "$ sh getApiDefsFromBackend.sh") 

export type Effort         = number // measured in Worker Time Units
export type Value          = number // measured in Worker Time Units
export type ValueChainId   = string
export type ProcessStepId  = string
export type WorkItemId     = number
export type WorkItemTag    = [string, string]
export type WorkerName     = string
export type TimeUnit       = number
export type Timestamp      = number
export type RgbColor       = [number, number, number]
export type Injection      = { throughput: number, probability: number }
export type WipLimit       = number

//-------------------------
// system config JSON file 
//-------------------------

export interface I_LearnAndAdaptParamsAsJson {
    observation_period: number,
    success_measure_function: string,
    adjustment_factor: number
}

export interface I_ValueDegradationAsJson {
    function: string,
    argument: number
}

export interface I_InjectionAsJson {
    throughput: number,
    probability?: number
}

export interface I_ProcessStepAsJson {
    process_step_id: string,
    norm_effort: number,
    wip_limit: number,
    bar_length?: number // for backend stand-alone batch mode only 
}

export interface I_ValueChainAsJson {
    value_chain_id: string,
    value_add: number,
    value_degradation?: I_ValueDegradationAsJson,
    injection?: I_InjectionAsJson,
    process_steps: I_ProcessStepAsJson[]
}

export interface I_SortVectorAsJson {
    measure: string,
    selection_criterion: string
}

export interface I_GloballyDefinedWorkitemSelectionStrategyAsJson {
    id: string,
    strategy: I_SortVectorAsJson[]
}

export interface I_ValueChainAndProcessStepAsJson {
    value_chain_id: string,
    process_steps_id: string
}

export interface I_WorkerAsJson {
    worker_id: string,
    workitem_selection_strategies?: string[],
    process_step_assignments: I_ValueChainAndProcessStepAsJson[]
}

export interface I_FrontendPresetParametersAsJson {
    num_iterations_per_batch?: number,
    economics_stats_interval?: number
}

export interface I_WipLimitSearchParmsAsJson {
    initial_temperature: number,
    cooling_parm: number,
    degrees_per_downhill_step_tolerance: number,
    initial_jump_distance: number,
    measurement_period: number,
    wip_limit_upper_boundary_factor: number,
    search_on_at_start: boolean,
    verbose: boolean           
}

export type I_ConfigAsJson = {
    system_id: string,
    frontend_preset_parameters?: I_FrontendPresetParametersAsJson,
    learn_and_adapt_parms?: I_LearnAndAdaptParamsAsJson,
    wip_limit_search_parms?: I_WipLimitSearchParmsAsJson,
    value_chains: I_ValueChainAsJson[],
	globally_defined_workitem_selection_strategies?: I_GloballyDefinedWorkitemSelectionStrategyAsJson[]
    workers: I_WorkerAsJson[]
} | undefined

//-------------------------
// request to iterate
//-------------------------

export interface I_VcWorkOrders {
    valueChainId:  ValueChainId 
    numWorkOrders: number
}

export interface I_VcPsWipLimit {
    vc:         ValueChainId
    ps:         ProcessStepId
    wipLimit:   WipLimit | undefined
}

export interface I_IterationRequest {
    vcsWorkOrders:      I_VcWorkOrders[] 
    wipLimits:          I_VcPsWipLimit[]
    optimizeWipLimits:  boolean
}

export type I_IterationRequests = I_IterationRequest[]

//-------------------------
// response on "iterate" request
//-------------------------
export interface I_WorkItem {
    id:                             WorkItemId
    tag:                            WorkItemTag
    rgbColor?:                      RgbColor // not assigned at backend but by the frontend after having received system-state data
    valueChainId:                   ValueChainId
    value:                          Value
    maxEffort:                      Effort
    processStepId:                  ProcessStepId
    accumulatedEffort:              number // ... in process step or overall when in the Output basket
    elapsedTime:                    number // ... in process step or overall when in the Output basket
}

export interface I_ProcessStep {
    id:                             ProcessStepId
    normEffort:                     Effort
    wipLimit:                       WipLimit,
    workItems:                      I_WorkItem[]
    workItemFlow:                   number
}

export type I_Injection = Injection

export interface I_ValueChain {
    id:                             ValueChainId
    totalValueAdd:                  Value
    injection:                      I_Injection,
    processSteps:                   I_ProcessStep[]
}

export interface I_OutputBasket {
    workItems:                      I_WorkItem[]
}

export interface I_ValueChainProcessStep {
    valueChain:  ValueChainId
    processStep: ProcessStepId
}

export interface I_WeightedSelectionStrategy {
    id: string
    weight: number
}

export interface I_WorkerState {
    worker:                         WorkerName
    utilization:                    number
    assignments:                    I_ValueChainProcessStep[]
    weightedSelectionStrategies:    I_WeightedSelectionStrategy[]
}

export interface I_FrontendPresets {
    numIterationPerBatch:           number
    economicsStatsInterval:         number
}

export interface I_SystemState {
    id:                             string,
    time:                           Timestamp,
    valueChains:                    I_ValueChain[]
    outputBasket:                   I_OutputBasket
    workersState:                   I_WorkerState[]
    version:                        string  // code version of this Lonely Lobster backend service 
    turnWipLimitOptimizationOnInFrontend:    boolean | undefined // if true then the frontend should turn on WIP limits optimization; if undefined or false, ignored
    isWipLimitOptimizationInBackendActive:   boolean // true if still optimizing, false if optimization finished in the backend
    frontendPresets:                I_FrontendPresets // just used at initialization to preset the iteration batch size and the statistics interval in the frontend 
}

//-----------------------------------------
// response to system statistics request
//-----------------------------------------
interface WorkItemStatsCycleTime {
    min: number | undefined,
    avg: number | undefined,
    max: number | undefined
}

interface WorkItemStatsThroughput {
    itemsPerTimeUnit:    number | undefined,
    valuePerTimeUnit:    number | undefined
}

export interface I_WorkItemStatistics {
    hasCalculatedStats: boolean,
    throughput:         WorkItemStatsThroughput,
    cycleTime:          WorkItemStatsCycleTime
}

export interface I_ProcessStepStatistics {
    id:     ProcessStepId
    stats:  I_WorkItemStatistics
} 

export interface I_ValueChainStatistics {
    id: ValueChainId
    stats: {
        vc:  I_WorkItemStatistics,
        pss: I_ProcessStepStatistics[]
    }
} 

export interface I_EndProductStatistics {
    numWis:             number,
    normEffort:         number
    elapsedTime:        number
    netValueAdd:        number
    discountedValueAdd: number
}

export type I_EndProductMoreStatistics = I_EndProductStatistics & {
    avgElapsedTime: number
}

type I_Economics = I_EndProductMoreStatistics & {
    avgWorkingCapital:  Effort,
    roceVar:            number, // ROCE with returns based on variable cost only
    roceFix:            number, // ROCE with returns based on total cost by fix staff
}

interface I_OutputBasketStatistics {
    flow:        I_WorkItemStatistics
    economics:   I_Economics
}

export interface I_SystemStatistics {
    timestamp:    Timestamp
    valueChains:  I_ValueChainStatistics[]
    outputBasket: I_OutputBasketStatistics
}

//-------------------------------
// workitem event retrieval (for export for external statistical analysis)
//-------------------------------

export interface I_WorkItemEvent {
    system:         string
    timestamp:      Timestamp
    workitem:       WorkItemId
    eventType:      string
    valueChain:     ValueChainId
    processStep:    ProcessStepId  // if eventType == movedTo then this is the target process-step
    worker?:        WorkerName     // if eventType == workedOn then this is filled
}

export type I_WorkItemEvents = I_WorkItemEvent[] 

//-------------------------------
// worker utilization
//-------------------------------

export type WorkerWithUtilization = {
    worker:                         WorkerName,
    utilization:                    number
}

export type PsWorkerUtilization = WorkerWithUtilization & {
        assignedProcessSteps:           ProcessStepId[]
    }
      
export interface VcExtended {
    vc:         I_ValueChain
    wosUtil:    PsWorkerUtilization[]
    flowStats?: I_ValueChainStatistics
}  

export interface ObExtended {
    ob: I_OutputBasket
    flowStats?: I_WorkItemStatistics
}

export interface PsExtended {
    ps:         I_ProcessStep
    vcId:       ValueChainId
    wosUtil:    WorkerWithUtilization[]
    flowStats?: I_ProcessStepStatistics
}  

//-----------------------------------------
// response to Learning statistics request
//-----------------------------------------

export type I_WeightedSelectionStrategyAtTimestamp = {
    timestamp:                          Timestamp,
    selectionStrategyNamesWithWeights:  I_WeightedSelectionStrategy[]
}

export type I_LearningStatsWorker = { 
    worker: WorkerName,
    series: I_WeightedSelectionStrategyAtTimestamp[]
}

export type I_LearningStatsWorkers = I_LearningStatsWorker[]

//-----------------------------------------
// types and value lists for the editor 
//-----------------------------------------

export interface I_sortVector {
    measure:             string
    selection_criterion: string
}
export interface I_selectionStrategy {
    id:         string
    strategy:   I_sortVector[]
}

export const valueDegradationFunctionNames = [
    "discounted",  // wired with discounted()
    "expired",     // wired with expired()
    "net"          // default, not explicitely wired
]

export const successMeasureFunctionNames = [
    "ivc",         // wired with successMeasureIvc()
    "roce",        // wired with successMeasureRoce()
    "none"         // wired with successMeasureNone()
]

export enum workItemSelectionStrategyMeasureNames {
    accumulatedEffortInProcessStep  = "accumulated effort in process step",
    remainingEffortInProcessStep    = "remaining effort in process step",
    accumulatedEffortInValueChain   = "accumulated effort in value chain",
    remainingEffortInValueChain     = "remaining effort in value chain",

    visitedProcessSteps             = "visited process steps",
    remainingProcessSteps           = "remaining process steps",

    valueOfValueChain               = "value-add of value chain",
    totalEffortInValueChain         = "total effort in value chain",
    contributionOfValueChain        = "contribution of value chain",

    sizeOfInventoryInProcessStep    = "size of inventory in process step",

    elapsedTimeInProcessStep        = "elapsed time in process step",
    elapsedTimeInValueChain         = "elapsed time in value chain"
}

export const selectionCriterionNames = [ // for workItemSelectionStrategyMeasureNames
    "maximum",
    "minimum"
]

//-----------------------------------------
// event messages for user and/or application logging purposes
//-----------------------------------------

export enum EventTypeId {
    configFileLoaded    = "Configuration File loaded",
    configFileNotFound  = "Configuration File not found",
    configCorrupt       = "Configuration is corrupt",
    valueOutOfRange     = "Some system internal value is out of range",    
    authorizationError  = "Request not authorized",
    sessionNotFound     = "Session not found (possibly expired)",
    networkProblems     = "Cannot reach resource due to network problems (probably on frontend-side).",
    configJsonError     = "JSON of configuration file is corrupt."
} 

export enum EventSeverity {
    info,
    warning,
    critical,
    fatal
}

export interface ApplicationEvent {
    dateAndtime:    Date
    source:         string
    sourceVersion:  string
    severity:       EventSeverity
    typeId:         EventTypeId
    description:    string  // explain to user what happened and what to do
    context:        string  // any additional data e.g. username or session token or ...
}





