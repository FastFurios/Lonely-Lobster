//-------------------------------------------------------------------
// API AND OTHER GENERAL TYPE DEFINITIONS 
//-------------------------------------------------------------------
// last code cleaning: 24.12.2024

/**
 * All relevant type definitions shared between the backend and the frontend.
 * The master of this file is located in the backend project "Lonely Lobster".
 * Do not forget to copy the latest version to the Angular frontend project (use there "$ sh getApiDefsFromBackend.sh") 
 */

// -----------------------------------------------------------
/** Basic types */
// -----------------------------------------------------------

/** The discrete unit the time progresses in Lonely Lobster: 0, 1, 2 ... */
export type TimeUnit       = number 
/** A specific point in the discrete range of Lonely Lobster time units */
export type Timestamp      = number
/** Number of discrete time units */
       type TimeUnits      = number
/** The discrete duration between 2 timestamps */
/** Accumulated effort that has gone into a workitem; measured as count of all timestamps any worker has worked the workitem */
export type Effort         = TimeUnits // measured in Worker Time Units
/** Value the workitem generates once reached the output basket i.e. it is an endproduct; measured in Worker Time Units */
export type Value          = TimeUnits

export type ValueChainId   = string
export type ProcessStepId  = string
export type WorkItemId     = number
/** Workitem display tag (used for console display in batch mode only) */
export type WorkItemTag    = [string, string]
export type WorkerName     = string
export type RgbColor       = [number, number, number]
/**
 * The rate and distribution by which new work orders are injected into a value chain on average.
 * Throughput is the average number of new workorders over time, probability controls how often the virtually accumulated number of workorders are injected as bulk.
 * Here how it works: at every timestamp "throughput" workorders are added to the virtual list of new workorders. At every timestamp the system rolls a dice with the probability "probability"
 * if the so far accumulated vitual new workorders are to be injected now or later. Examples:
 * @example If throughput is 2 and probability is 1 then 2 new workorders are injected into the value chain at every timestamp.
 * @example If throughput is 0.5 and probability is 1 then 1 new workorders is injected into the value chain every other timestamp.
 * @example If throughput is 0.4 and probability is 1 then 1 new workorders is injected at the third timestamp leaving a remainder of 0.4+0.4+0.4-1.0=0.2 in the accumulated vitual new workorders.
 * after 2 more time units the accumulated virtual workorders is 0.2+0.4+0.4 =1.0 and the next workorder is injected. 
 * @example If throughput is 1 and probability is 0.5 then the systems adds 1 new workorder to the accumulated number of new workorders until the rolled dice at the end of every timestamp decides to flush out the accumulated new workorders and inject them.
 * A remainder < 1 may be left over. The system continues to ad another new workorder to the accumulated number of new workorders and rolls the dice and so on...   
 */
export type Injection      = { 
    throughput: number, 
    probability: number
}
/** Work in progress limit: if 0 then no limit, if > 0 then the wip limit restricts the number of workitems allowed in a process step at any given time. */
export type WipLimit       = number

// -----------------------------------------------------------
/** Types of system config JSON file contents */
// -----------------------------------------------------------

/** worker learning and adaption parameters */
interface I_LearnAndAdaptParamsAsJson {
    observation_period: number,
    success_measure_function: string,
    adjustment_factor: number
}

/** value degradation function and argument */
export interface I_ValueDegradationAsJson {
    function: string,
    argument: number
}

/** value chain injection parameters */
export interface I_InjectionAsJson {
    throughput: number,
    probability?: number
}

/** process step definition */
export interface I_ProcessStepAsJson { // frontend
    process_step_id: string,
    norm_effort: number,
    wip_limit: number,
    bar_length?: number // for backend stand-alone batch mode only 
}

/** value chain definition  */
export interface I_ValueChainAsJson {  // frontend
    value_chain_id: string,
    value_add: number,
    value_degradation?: I_ValueDegradationAsJson,
    injection?: I_InjectionAsJson,
    process_steps: I_ProcessStepAsJson[]
}

/** sorting dimension */
export interface I_SortVectorAsJson { // frontend
    measure: string,
    selection_criterion: string
}

/** workitem selection strategy */
export interface I_GloballyDefinedWorkitemSelectionStrategyAsJson { // frontend
    id: string,
    strategy: I_SortVectorAsJson[]
}

/** value chain and process step ids */
export interface I_ValueChainAndProcessStepAsJson { // frontend
    value_chain_id: string,
    process_steps_id: string
}

/** worker with his workitem selection strategies at hand and his assignments to process steps */
export interface I_WorkerAsJson { // frontend
    worker_id: string,
    workitem_selection_strategies?: string[],
    process_step_assignments: I_ValueChainAndProcessStepAsJson[]
}

/** frontend iteration preset values */
interface I_FrontendPresetParametersAsJson {
    num_iterations_per_batch?: number,
    economics_stats_interval?: number
}

/** wip limit auto optimization search parameters */
interface I_WipLimitSearchParmsAsJson {
    /**initial temperature; the higher the temperature the further the jumps in the multi-dimensional wip space and 
     * the higher the tolerance if performance degrades in the choosen direction. */
    initial_temperature: number,
    /** factor between 0 and 1 by which the current temperature is multiplied to get the next iterations's new temperature */
    cooling_parm: number,
    /** the degrees difference that reduces the tolerance of steps in one direction without performance improvement by 1 */
    degrees_per_downhill_step_tolerance: number,
    /** number of steps to jump initially */
    initial_jump_distance: number,
    /** trailing time interval in which the performance is measured */
    measurement_period: number,
    /** will be multiplied with the lower boundary which is #assigned-workers divided by norm-effort */
    wip_limit_upper_boundary_factor: number,
    /** search is on from first iteration if true */
    search_on_at_start: boolean,
    /** outputs debug data if true */
    verbose: boolean           
}

/** system configuration as provided by the JSON file ??? */
export type I_ConfigAsJson = {  // frontend
    system_id: string,
    frontend_preset_parameters?: I_FrontendPresetParametersAsJson,
    learn_and_adapt_parms?: I_LearnAndAdaptParamsAsJson,
    wip_limit_search_parms?: I_WipLimitSearchParmsAsJson,
    value_chains: I_ValueChainAsJson[],
	globally_defined_workitem_selection_strategies?: I_GloballyDefinedWorkitemSelectionStrategyAsJson[]
    workers: I_WorkerAsJson[]
} // | undefined

// -----------------------------------------------------------
/** Request to iterate */
// -----------------------------------------------------------

/** number of workorders to be injected to a value chain */
export interface I_VcWorkOrders {
    valueChainId:  ValueChainId 
    numWorkOrders: number
}

/** work in progress limit of a process step */
export interface I_VcPsWipLimit {
    vc:         ValueChainId
    ps:         ProcessStepId
    wipLimit:   WipLimit | undefined
}

/** iteration request sent to the backend */
export interface I_IterationRequest {
    vcsWorkOrders:      I_VcWorkOrders[] 
    wipLimits:          I_VcPsWipLimit[]
    /** true if the backend is supposed to search a optimized wip limits */
    optimizeWipLimits:  boolean
}

export type I_IterationRequests = I_IterationRequest[]

// -----------------------------------------------------------
/** Backend response on "iterate" request */ 
// -----------------------------------------------------------

/** work item */ 
export interface I_WorkItem {
    id:                             WorkItemId
    tag:                            WorkItemTag
    /** not assigned at backend but by the frontend after having received system-state data */
    rgbColor?:                      RgbColor 
    valueChainId:                   ValueChainId
    value:                          Value
    /** total effort required to make a workorder to an end product i.e. the sum of norm efforts of the process steps in a value chain */
    maxEffort:                      Effort
    processStepId:                  ProcessStepId
    /** accumulated effort in process step or overall when in the Output basket */
    accumulatedEffort:              number 
    /** elapsed time in process step or when in the Output basket overall since injection as workorder */
    elapsedTime:                    number 
}
/** process step */
export interface I_ProcessStep {
    id:                             ProcessStepId
    normEffort:                     Effort
    wipLimit:                       WipLimit,
    workItems:                      I_WorkItem[]
    workItemFlow:                   number
}

/** injection parameters */
export type I_Injection = Injection

/** value chain */
export interface I_ValueChain {
    id:                             ValueChainId
    totalValueAdd:                  Value
    injection:                      I_Injection,
    processSteps:                   I_ProcessStep[]
}

/** output basket */
export interface I_OutputBasket {
    workItems:                      I_WorkItem[]
}

/** process step and its value chain */
interface I_ValueChainProcessStep {
    valueChain:  ValueChainId
    processStep: ProcessStepId
}

/** work item selection strategy with its relative weight to all strategies available to a worker */
export interface I_WeightedSelectionStrategy {
    id: string
    weight: number
}

/** statistics of a worker */
export interface I_WorkerState {
    worker:                         WorkerName
    utilization:                    number
    assignments:                    I_ValueChainProcessStep[]
    weightedSelectionStrategies:    I_WeightedSelectionStrategy[]
}

/** settings just used at initialization to preset the iteration batch size and the statistics interval in the frontend */
export interface I_FrontendPresets {
    numIterationPerBatch:           number
    economicsStatsInterval:         number
}

/** new system state calculated by the backend */
export interface I_SystemState {
    id:                             string,
    time:                           Timestamp,
    valueChains:                    I_ValueChain[]
    outputBasket:                   I_OutputBasket
    workersState:                   I_WorkerState[]
    /** not yet used: code version of this Lonely Lobster backend service */
    version:                        string   
    /** after having interpreted the system configuration instruct the frontend to either turn the wip limit optimization toggle on or off */
    turnWipLimitOptimizationOnInFrontend:    boolean | undefined
    /** instruct the frontend to either let wip limit optimization on or turn it off when the optimization process is over ("temperature" reached zero) */
    isWipLimitOptimizationInBackendActive:   boolean // true if still optimizing, false if optimization finished in the backend
    frontendPresets:                I_FrontendPresets // just used at initialization to preset the iteration batch size and the statistics interval in the frontend 
}

// -----------------------------------------------------------
/** response to system statistics request */
// -----------------------------------------------------------

/** work item cycle times statitics */
interface WorkItemStatsCycleTime {
    min: number | undefined,
    avg: number | undefined,
    max: number | undefined
}

/** throughput statitics for process steps, value chains or the entire system */
interface WorkItemStatsThroughput {
    itemsPerTimeUnit:    number | undefined,
    valuePerTimeUnit:    number | undefined
}

/** work item based statitics for process steps, value chains or the entire system */
export interface I_WorkItemStatistics {
    hasCalculatedStats: boolean,
    throughput:         WorkItemStatsThroughput,
    cycleTime:          WorkItemStatsCycleTime
}

/** work item based statistics for a process step */
export interface I_ProcessStepStatistics {
    id:     ProcessStepId
    stats:  I_WorkItemStatistics
} 

/** work item based statistics for a value chain */
export interface I_ValueChainStatistics {
    id: ValueChainId
    stats: {
        vc:  I_WorkItemStatistics,
        pss: I_ProcessStepStatistics[]
    }
} 

/** work item based statistics for the output basket, i.e. for the entire system */
export interface I_EndProductStatistics {
    numWis:             number,
    normEffort:         number
    elapsedTime:        number
    netValueAdd:        number
    discountedValueAdd: number
}

/** extended work item based statistics for the output basket, i.e. for the entire system */
export type I_EndProductMoreStatistics = I_EndProductStatistics & {
    avgElapsedTime: number
}

/** economical performance statistics for the output basket, i.e. for the entire system */
type I_Economics = I_EndProductMoreStatistics & {
    avgWorkingCapital:  Effort,
    /** Return On Capital Employed if workers are paid only for effort put into work items */
    roceVar:            number, 
    /** Return On Capital Employed if workers are paid a fix pay independent on how busy they are */
    roceFix:            number
}

/** output basket statistics */
interface I_OutputBasketStatistics {
    flow:        I_WorkItemStatistics
    economics:   I_Economics
}

/** all system statistics */
export interface I_SystemStatistics {
    timestamp:    Timestamp
    valueChains:  I_ValueChainStatistics[]
    outputBasket: I_OutputBasketStatistics
}

// -----------------------------------------------------------
/** workitem event retrieval (for export for external statistical analysis) */
// -----------------------------------------------------------

export interface I_WorkItemEvent {
    system:         string
    timestamp:      Timestamp
    workitem:       WorkItemId
    eventType:      string
    valueChain:     ValueChainId
    processStep:    ProcessStepId  // if eventType == movedTo then this is the target process-step
    worker?:        WorkerName     // if eventType == workedOn then this is filled
}

// -----------------------------------------------------------
/** response to Learning statistics request */
// -----------------------------------------------------------

/** a worker's available work item selection strategies and their relative weights at a given timestamp */
export type I_WeightedSelectionStrategyAtTimestamp = {
    timestamp:                          Timestamp,
    selectionStrategyNamesWithWeights:  I_WeightedSelectionStrategy[]
}

/** a worker's available work item selection strategies and their relative weights */
export type I_LearningStatsWorker = { 
    worker: WorkerName,
    series: I_WeightedSelectionStrategyAtTimestamp[]
}

/** workers' available work item selection strategies and their relative weights */
export type I_LearningStatsWorkers = I_LearningStatsWorker[]

// -----------------------------------------------------------
/** types and value lists for the editor */ 
// -----------------------------------------------------------

/** sort vector i.e. a measurement kpi (measure) and the sort order (ascending/descending) */ 
export interface I_sortVector {
    measure:             string
    selection_criterion: string
}

/** a list of sort vectors ordered by the sequence the multi-columnar sort takes place */ 
export interface I_SelectionStrategy {
    id:         string
    strategy:   I_sortVector[]
}

/** function that calculates the discounting of the value of the end product dependent on the elapsed time beyond the minimum cycle time */ 
export const valueDegradationFunctionNames = [
    /** value degradation per time unit */ 
    "discounted",  // wired with discounted()
    /** loses all value after a number of time units */ 
    "expired",     // wired with expired()
    /** no value degradation */ 
    "net"          // default, not explicitely wired
]

/** system measurement kpi */ 
export const successMeasureFunctionNames = [
    /** individual value contribution of a worker to a work item i.e. the portion of the end product's value proportional to his/her contribution to the overall work effort */ 
    "ivc",         // wired with successMeasureIvc()
    /** system return on capital employed */ 
    "roce",        // wired with successMeasureRoce()
    /** none */ 
    "none"         // wired with successMeasureNone()
]

// -----------------------------------------------------------
/** event messages for user and/or application logging purposes */ 
// -----------------------------------------------------------

export enum EventTypeId {

    valueOutOfRange     = "Some system internal value is out of range",    
    authorizationError  = "Request not authorized",
    sessionNotFound     = "Session not found (possibly expired)",
    networkProblems     = "Cannot reach resource due to network problems (probably on frontend-side).",
    
    loggedIn            = "logged in.",
    loggedOut           = "logged out.",

    configFileLoaded    = "Configuration File loaded",
    configFileLoadError = "Configuration File loading error",
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

/** Lonely Lobster application event data structure */
export interface ApplicationEvent {
    dateAndtime:    Date
    source:         string
    sourceVersion:  string
    severity:       EventSeverity
    typeId:         EventTypeId
    /** explain to user what happened and what to do */
    description:    string  
    /** any additional data e.g. username or session token etc. */
    context:        string 
}