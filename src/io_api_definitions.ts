//-------------------------------------------------------------------
// API AND OTHER GENERAL TYPE DEFINITIONS 
//-------------------------------------------------------------------
// last code cleaning: 15.12.2024

/**
 * All relevant type definitions shared between the backend and the frontend.
 * The master of this file is located in the backend project "Lonely Lobster".
 * Do not forget to copy the latest version over to the Angular frontend project (use the "$ sh getApiDefsFromBackend.sh") 
 */


/**
 * Basic types
 */

/**
 * The discrete unit the time progresses in Lonely Lobster: 0, 1, 2 ...     
 */
export type TimeUnit       = number 
/**
 * A specific point in the discrete range of Lonely Lobster time units  
 */
export type Timestamp      = number
/**
 * Number of discrete time units     
 */
export type TimeUnits      = number
/**
 * The discrete duration between 2 timestamps    
 */
export type TimeInterval   = number
/**
 * Accumulated effort that has gone into a workitem; measured as count of all timestamps any worker has worked the workitem  
 */
export type Effort         = TimeUnits // measured in Worker Time Units
/**
 * value the workitem generates once reached the output basket i.e. it is an endproduct; measured in Worker Time Units 
 */
export type Value          = TimeUnits

export type ValueChainId   = string
export type ProcessStepId  = string
export type WorkItemId     = number
/**
 * Workitem display tag (used for console display in batch mode only) 
 */
export type WorkItemTag    = [string, string]
export type WorkerName     = string
export type RgbColor       = [number, number, number]
/**
 * The rate and distribution by which new work orders are injected into a value chain on average.
 * Throughput is the average number of new workorders over time, probability controls how often the virtually accumulated number of workorders are injected as bulk.
 * Here how it works: at every timestamp "throughput" workorders are added to the virtual list of new workorders. At every timestamp the system rolls a dice with the probability "probability"
 * if the so far accumulated vitual new workorders are to be injected now or later. Examples:
 * If throughput is 2 and probability is 1 then 2 new workorders are injected into the value chain at every timestamp.
 * If throughput is 0.5 and probability is 1 then 1 new workorders is injected into the value chain every other timestamp.
 * If throughput is 0.4 and probability is 1 then 1 new workorders is injected at the third timestamp leaving a remainder of 0.4+0.4+0.4-1.0=0.2 in the accumulated vitual new workorders.
 * after 2 more time units the accumulated virtual workorders is 0.2+0.4+0.4 =1.0 and the next workorder is injected. 
 * If throughput is 1 and probability is 0.5 then the systems adds 1 new workorder to the accumulated number of new workorders until the rolled dice at the end of every timestamp decides to flush out the accumulated new workorders and inject them.
 * A remainder < 1 may be left over. The system continues to ad another new workorder to the accumulated number of new workorders and rolls the dice and so on...   
 */
export type Injection      = { throughput: number, probability: number }
/**
 * Work in progress limit: if 0 then no limit, if > 0 then the wip limit restricts the number of workitems allowed in a process step at any given time.  
 */
export type WipLimit       = number

/**
 * types of system config JSON file contents  
 */

/**
 * worker learning and adaption parameters
 */
export interface I_LearnAndAdaptParamsAsJson {
    observation_period: number,
    success_measure_function: string,
    adjustment_factor: number
}

/**
 * value degradation function and argument
 */
export interface I_ValueDegradationAsJson {
    function: string,
    argument: number
}

/**
 * value chain injection parameters
 */
export interface I_InjectionAsJson {
    throughput: number,
    probability?: number
}

/**
 * process step definition
 */
export interface I_ProcessStepAsJson {
    process_step_id: string,
    norm_effort: number,
    wip_limit: number,
    bar_length?: number // for backend stand-alone batch mode only 
}

/**
 * value chain definition
 */
export interface I_ValueChainAsJson {
    value_chain_id: string,
    value_add: number,
    value_degradation?: I_ValueDegradationAsJson,
    injection?: I_InjectionAsJson,
    process_steps: I_ProcessStepAsJson[]
}

/**
 * sorting dimension
 */
export interface I_SortVectorAsJson {
    measure: string,
    selection_criterion: string
}

/**
 * workitem selection strategy
 */
export interface I_GloballyDefinedWorkitemSelectionStrategyAsJson {
    id: string,
    strategy: I_SortVectorAsJson[]
}

/**
 * value chain and process step ids
 */
export interface I_ValueChainAndProcessStepAsJson {
    value_chain_id: string,
    process_steps_id: string
}

/**
 * worker with his workitem selection strategies at hand and his assignments to process steps
 */
export interface I_WorkerAsJson {
    worker_id: string,
    workitem_selection_strategies?: string[],
    process_step_assignments: I_ValueChainAndProcessStepAsJson[]
}

/**
 * frontend iteration preset values 
 */
export interface I_FrontendPresetParametersAsJson {
    num_iterations_per_batch?: number,
    economics_stats_interval?: number
}

/**
 * wip limit auto optimization search parameters 
 */
export interface I_WipLimitSearchParmsAsJson {
    /**
     * initial temperature; the higher the temperature the further the jumps in the multi-dimensional wip space and 
     * the higher the tolerance if performance degrades in the choosen direction.   
     */
    initial_temperature: number,
    /**
     * factor between 0 and 1 by which the current temperature is multiplied to get the next iterations's new temperature    
     */
    cooling_parm: number,
    /**
     * the degrees difference that reduces the tolerance of steps in one direction without performance improvement by 1      
     */
    degrees_per_downhill_step_tolerance: number,
    /**
     * number of steps to jump initially          
     */
    initial_jump_distance: number,
    // /**
    //  * trailing time interval in which the performance is measured       
    //  */
    // measurement_period: number,
    /**
     * will be multiplied with the lower boundary which is #assigned-workers divided by norm-effort        
     */
    wip_limit_upper_boundary_factor: number,
    /**
     * search is on from first iteration if true        
     */
    search_on_at_start: boolean,
    /**
     * outputs debug data if true       
     */
    verbose: boolean           
}

/**
 * system configuration
 */
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

    valueOutOfRange     = "Some system internal value is out of range",    
    authorizationError  = "Request not authorized",
    sessionNotFound     = "Session not found (possibly expired)",
    networkProblems     = "Cannot reach resource due to network problems (probably on frontend-side).",
    
    loggedIn            = "logged in.",
    loggedOut           = "logged out.",

    configFileLoaded    = "Configuration File loaded",
    configFileNotFound  = "Configuration File not found",
    configJsonError     = "JSON of configuration file is corrupt.",
    configCorrupt       = "Configuration is corrupt",
    
    configEdited        = "Configuration edited.",
    configSaved         = "Configuration changes saved.",

    systemInOperation   = "System in operation.",
    systemFailed        = "System failed.",

    configDownloaded    = "Configuration downloaded.",
    statsEventsDownloaded= "Statistic events downloaded.",
    configDropped       = "Configuration discarded.",
    systemDropped       = "Backend system discarded."

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





