//----------------------------------------------------------------------
/**
 *  SYSTEM
 */   
//----------------------------------------------------------------------
// last code cleaning: 04.01.2025

import { Clock } from './clock.js'
import { wiIdGenerator, wiTagGenerator, wiTags, WorkOrder, WorkItemFlowEventStats, WorkItem, WiExtInfoElem, LogEntryWorkItemMoved, LogEntryWorkItemWorked, WorkItemExtendedInfos } from './workitem.js'
import { duplicate, reshuffle } from './helpers.js'
import { ValueChain } from './valuechain.js'
import { ProcessStep, OutputBasket } from './workitembasketholder.js'
import { Worker, AssignmentSet, LearnAndAdaptParms } from './worker.js'
import { DebugShowOptions } from './io_config.js'
import { Timestamp, TimeUnit, Value, Effort, I_VcWorkOrders,
         I_SystemStatistics, I_ValueChainStatistics, I_ProcessStepStatistics, I_WorkItemStatistics, I_EndProductMoreStatistics, 
         I_IterationRequests, I_SystemState, I_ValueChain, I_ProcessStep, I_WorkItem, I_WorkerState, I_LearningStatsWorkers, 
         I_VcPsWipLimit, I_FrontendPresets} from './io_api_definitions.js'
import { environment } from './environment.js'
import { SearchLog, VectorDimensionMapper, VectorDimension, Position, Direction, PeakSearchParms, SearchState, nextSearchState, StringifyMode} from './optimize.js'


const debugShowOptionsDefaults: DebugShowOptions = { 
    clock:          false,
    workerChoices:  false,
    readFiles:      false  
}

/** work item with the value add of the work item's value chain and the elapsed time in the value chain */
interface WiElapTimeAndValAdd {
    wi:             WorkItem
    /** value add of the work item's value chain */
    valueAdd:       Value
    /** elapsed time of the work item in its value chain */
    elapsedTime:    Timestamp
}

export interface ToString {
    toString: () => string
}


//----------------------------------------------------------------------
/**
 *    LONELY LOBSTER SYSTEM
 */
//----------------------------------------------------------------------
export class LonelyLobsterSystem {
    public  valueChains:         ValueChain[]       = []
    public  workers:             Worker[]           = []
    public  assignmentSet!:      AssignmentSet
    public  outputBasket:        OutputBasket 

    public  clock:               Clock              = new Clock(this, -1)
    public  idGen                                   = wiIdGenerator()
    public  tagGen                                  = wiTagGenerator(wiTags)

    private frontendPresets!:    I_FrontendPresets	

    /** workers' work selection strategy learning */
    public  learnAndAdaptParms!: LearnAndAdaptParms

    /** system's wip limit optimization  */
    private searchParms!:       PeakSearchParms
    private vdm!:               VectorDimensionMapper<ProcessStep>
    private searchState!:       SearchState<ProcessStep>   
    public  wipLimitSearchLog                       = new SearchLog<ProcessStep>()

    constructor(public id:                  string,
                public debugShowOptions:    DebugShowOptions = debugShowOptionsDefaults) {
        this.outputBasket   = new OutputBasket(this)
    }


    private get allWorkItems(): WorkItem[] {
        return this.valueChains.flatMap(vc => vc.processSteps.flatMap(ps => ps.workItemBasket)).concat(this.outputBasket.workItemBasket) 
    }

    /**
     * Execute iteration requests i.e. iterate
     * @param iterRequests itertion requests
     */
    public doIterations(iterRequests: I_IterationRequests): void {
        this.setWipLimits(iterRequests[0].wipLimits) // we take the first iterations wip-limits as they don't change over time anyway
        //console.log("doIteration: searchState.temperature= " +  this.searchState?.temperature)
        if (iterRequests[0].optimizeWipLimits) { // frontend asks for optimization 
            if (!this.searchState || this.searchState.temperature < 0) this.initializeWipLimitOptimization()  // initialize wip limit optimization when frontend sends signal to optimize and no search parms yet or search parms but frozen
        } else // frontend doen't want optimization
            if (this.searchState) this.searchState.temperature = -1

        for (let req of iterRequests) {
            this.doOneIteration(this.workOrderList(req.vcsWorkOrders), req.optimizeWipLimits)
        }
    }

    /**
     * execute one iteration
     * @param wos work orders
     * @param optimizeWipLimits current wip limits 
     */
    public doOneIteration(wos: WorkOrder[], optimizeWipLimits: boolean): void {
        wos.forEach(w => w.valueChain.createAndInjectNewWorkItem())

        // tick the clock to the next interval
        this.clock.tick()
//      console.log(`System.doOneIteration(): clock proceeded to ${this.clock.time}; about to process ${wos.length} new workorders`) // ##

        // inject new work orders        // measure system performance with current WIP limits and adjust them
        if (optimizeWipLimits && this.clock.time > 0 && this.clock.time % this.searchParms.measurementPeriod == 0) {
            this.optimizeWipLimits()
        }

        // workers select workitems and work them
        this.workers = reshuffle(this.workers) // avoid that work is assigned to workers always in the same worker sequence  
        this.workers.forEach(wo => wo.work(this.assignmentSet))

        // update workitem extended statistical infos after workers have done their work 
        this.valueChains.forEach(vc => vc.updateWorkItemsExtendedInfos())

        // update workers stats after having worked
        this.workers.forEach(wo => wo.utilization(this))

        // reset flow counters
        this.valueChains.forEach(vc => vc.processSteps.forEach(ps => ps.lastIterationFlowRate = 0))
        // move finished work items from process steps on to the next (or to the output basket)
        this.valueChains.forEach(vc => vc.letWorkItemsFlow())

        // ##
/*         console.log("System at end of doOneItertion(): show workitems:")
        this.allWorkItems.map(wi => console.log(`\t${wi}`))
        console.log("System at end of doOneItertion(): show workitem moved log entries:")
        this.allWorkItems.map(wi => wi.log.filter(le => le.logEntryType == LogEntryType.workItemMoved).flatMap(le => console.log(`\t${(<LogEntryWorkItemMoved>le)}`)))
 */    }    
//----------------------------------------------------------------------
//    API mode - Initialization
//----------------------------------------------------------------------

    /**
     * Generates an empty iteration request
     * @returns empty iteration request
     */
    public emptyIterationRequest(): I_IterationRequests {
        return [{
            vcsWorkOrders:      this.valueChains.map(vc => { return { valueChainId: vc.id, numWorkOrders: 0 }}),
            wipLimits:          this.valueChains.flatMap(vc => vc.processSteps.map(ps => { return {vc: vc.id, ps: ps.id, wipLimit: ps.wipLimit}})),
            optimizeWipLimits:  false  // default at start is "no optimization"
          }]
    }

    /**
     * add value chains to the system
     * @param vcs value chains to be added 
     */
    public addValueChains(vcs: ValueChain[]): void { this.valueChains = vcs }   // *** not sure if this works or if I need to copy the array into this.array

    /**
     * add workers and their assignments to the system
     * @param wos workers
     * @param asSet worker assigments to process steps
     */
    public addWorkersAndAssignments(wos: Worker[], asSet: AssignmentSet ) { this.workers = wos; this.assignmentSet = asSet }   // *** not sure if this works or if I need to copy the array into this.array

    /**
     * add learning parameters to the system
     * @param laps learning and adaption parameters
     */
    public addLearningParameters(laps: LearnAndAdaptParms) { this.learnAndAdaptParms = laps; Worker.sysStats = <any>undefined } // clear system 

    /**
     * add wip limit search parameters to the system
     * @param sp wip limit search parameters
     */
    public addWipLimitSearchParameters(sp: PeakSearchParms) { 
        this.searchParms = sp 
    }

    /**
     * add the frontend's preset parameters to the system 
     * @param feps 
     */
    public addFrontendPresets(feps: I_FrontendPresets) { 
        this.frontendPresets = feps
    }

//----------------------------------------------------------------------
//    API mode - Iteration
//----------------------------------------------------------------------

    /**
     * create individual work order items to be fed into the value chains  
     * @param vcsWos list of value chains with the number of wor orders 
     * @returns list of work orders for eaach value chain
     */
    private workOrderList(vcsWos: I_VcWorkOrders[]): WorkOrder[] {
        return vcsWos.flatMap(vcWos => duplicate<WorkOrder>(
                                                { timestamp:    this.clock.time,
                                                  valueChain:   this.valueChains.find(vc => vc.id == vcWos.valueChainId.trim())! },
                                                vcWos.numWorkOrders))
    }

    /**
     * create a work item data object for the new system state as long as the work item is in process in the value chain  
     * @param wi work item (must still be in the value chain)
     * @returns work item data object 
     */
    private i_workItem (wi: WorkItem): I_WorkItem { 
        return {
            id:                               wi.id,
            tag:                              wiTags[0],
            valueChainId:                     wi.valueChain.id,
            processStepId:                    wi.currentWorkItemBasketHolder.id,
            normEffort:                       (<ProcessStep>wi.currentWorkItemBasketHolder).normEffort,
            accumulatedEffort:                wi.extendedInfos!.workOrderExtendedInfos[WiExtInfoElem.accumulatedEffortInProcessStep],
            elapsedTime:                      wi.extendedInfos!.workOrderExtendedInfos[WiExtInfoElem.elapsedTimeInProcessStep]
        }
    }

    /**
     * create a process step data object for the new system state
     * @param ps process step
     * @returns process step data object
     */
    private i_processStep(ps: ProcessStep): I_ProcessStep {
        return {
            id:                 ps.id,
            normEffort:         ps.normEffort,
            wipLimit:           ps.wipLimit,            
            workItems:          ps.workItemBasket.map(wi => this.i_workItem(wi)),
            workItemFlow:       ps.lastIterationFlowRate
        }
    }

    /**
     * create a value chain data object for the new system state
     * @param vc value chain
     * @returns value chain data object
     */
    private i_valueChain(vc: ValueChain): I_ValueChain {
        return {
            id:                 vc.id,
            totalValueAdd:      vc.totalValueAdd,
            injection:          vc.injection,
            processSteps:       vc.processSteps.map(ps => this.i_processStep(ps))
        }
    }

    /**
     * return a work item data object in the output basket for the new system state
     * @param wi end product i.e. work item in the output basket 
     * @returns value chain data object
     */
    private i_endProduct (wi: WorkItem): I_WorkItem { 
        return {
            id:                 wi.id,
            tag:                wiTags[0],
            processStepId:      wi.currentWorkItemBasketHolder.id,
            valueChainId:       wi.valueChain.id,
            normEffort:         wi.valueChain.normEffort, 
            accumulatedEffort:  wi.valueChain.normEffort,
            elapsedTime:        wi.cycleTimeInValueChain()!
        }
    }

    /**
     * create a worker data object for the new system state
     * @param wo worker
     * @returns worker data object
     */
    private i_workerState(wo: Worker): I_WorkerState {
        const aux =  {
            worker: wo.id,
            utilization: wo.stats.utilization,
            assignments: wo.stats.assignments.map(a => {
                return {
                    valueChain:  a.valueChain.id,
                    processStep: a.processStep.id
                }
            }),
            weightedSelectionStrategies: wo.currentWeightedSelectionStrategies.map(sest => { 
                return {
                    id:     sest.element.id,
                    weight: sest.weight
            }})
        }
        return aux
    }

    /**
     * create the new system state data object as response to a frontend iteration request 
     * @returns system state data object
     */
    private i_systemState(): I_SystemState {
        return {
            id:                                     this.id,
            time:                                   this.clock.time,
            valueChains:                            this.valueChains.map(vc => this.i_valueChain(vc)),
            outputBasket:                           { workItems: this.outputBasket.workItemBasket.map(wi => this.i_endProduct(wi)) },
            workersState:                           this.workers.map(wo => this.i_workerState(wo)),
            version:                                environment.version,
            turnWipLimitOptimizationOnInFrontend:   this.clock.time == 0 ? this.searchParms.searchOnAtStart : undefined,   // when initializating, set the UI toggle to start WIP limit optimization or not
            isWipLimitOptimizationInBackendActive:  this.clock.time == 0 ? false : this.isWipLimitOptimizationStillActive, // default at start: optimization is off
            frontendPresets:                        this.frontendPresets
        }
    }

    /**
     * set the wip limits in the system 
     * @param wipLimits  contains the current WIP limits sent in the request from the frontend
     */
    private setWipLimits(wipLimits: I_VcPsWipLimit[]): void { 
        for (let wl of wipLimits) {
            const vc = this.valueChains.find(vc => vc.id == wl.vc.trim())
            if (!vc) throw Error(`System: setWipLimits(): value-chain ${vc} not found`)
            const ps: ProcessStep = vc.processSteps.find(ps => ps.id == wl.ps.trim())!
            if (!ps) throw Error(`System: setWipLimits(): process-step ${ps} not found`)
            ps.wipLimit = wl.wipLimit ? wl.wipLimit : 0
        }
    }

    /**
     * Calculate the resulting system state after the iterations
     * @param iterReqs iteration requests
     * @return new system state
     */   
    public nextSystemState(iterReqs: I_IterationRequests): I_SystemState { 
        this.doIterations(iterReqs)
        const aux = this.i_systemState()
//      console.log(aux.valueChains)  // ##
        // console.log("system.i_systemState(): wis in Alpha.One = ")
        // console.log(aux.valueChains[0].processSteps[0].workItems)
        return aux         
    }

    /**
     * optimize wip limits on basis of current system statistics; calculate new peak search algorithm state
     */
    private optimizeWipLimits() {
        this.searchState.position = this.searchStatePositionFromWipLimits()
        const currPerf = this.systemStatistics(this.clock.time < this.searchParms.measurementPeriod ? this.clock.time : this.searchParms.measurementPeriod).outputBasket.economics.roceFix
        this.searchState = nextSearchState<ProcessStep>(this.wipLimitSearchLog, () => currPerf, this.searchParms, this.clock.time, this.searchState)
        this.setWipLimitsFromSearchStatePosition()
    }
//----------------------------------------------------------------------
//    API mode - System Statistics
//----------------------------------------------------------------------

    /**
     * Calculate the accumulated effort that has gone into all work items having been in the system until the given timestamp 
     * regardless if still in a value chain or already in the output basket
     * @param until timestamp (inclusive)   
     * @returns accumulated effort
     */
    public accumulatedEffortMade(fromTime: Timestamp, toTime: Timestamp): Effort {
        return this.valueChains.map(vc => vc.accumulatedEffortMade(fromTime, toTime)).reduce((ae1, ae2) => ae1 + ae2)
             + this.outputBasket.accumulatedEffortMade(fromTime, toTime)
    } 

    /**
     * Calculate the working capital at timestamp, i.e. the sum of the accumulated effort 
     * of all work items in the value chains at the timestamp 
     * @param t timestamp 
     * @returns working capital 
     */
    private workingCapitalAt = (t:Timestamp): Value => { // ## remove debug statements 
        return this
            // give me all work items in the system: 
            .valueChains
                .flatMap(vc => vc.processSteps
                    .flatMap(ps => ps.workItemBasket))
            .concat(this.outputBasket.workItemBasket)
            // then give me those that were still in a value chain i.e. unfinished work  
            .filter(wi => wi.wasInValueChainAt(t))
            // for those calculate the effort 
            .map(wi => wi.accumulatedEffort(0, t)).reduce((a, b) => a + b, 0)
    }

    /**
     * Calculates the statistics for work items over the last interval time units  
     * @param wisElapTimeAndValAdd work items with its value chain added value and the elapsed time   
     * @param interval interval length into the past from now, e.g. if time=15 and interval=7 then it is the interval [9-15] 
     * @returns work item statistics
     */
    private workItemsStatistics(wisElapTimeAndValAdd: WiElapTimeAndValAdd[], interval: TimeUnit): I_WorkItemStatistics {
        const elapsedTimes: TimeUnit[] = wisElapTimeAndValAdd.flatMap(el => el.elapsedTime)
        const hasCalculatedStats = elapsedTimes.length > 0
        return {
            hasCalculatedStats: hasCalculatedStats,
            throughput: {
                itemsPerTimeUnit: wisElapTimeAndValAdd.length / interval,
                valuePerTimeUnit: wisElapTimeAndValAdd.map(el => el.valueAdd).reduce((va1, va2) => va1 + va2, 0) / interval
            },
            cycleTime: {
                min: hasCalculatedStats ? elapsedTimes.reduce((a, b) => a < b ? a : b)               : undefined,
                avg: hasCalculatedStats ? elapsedTimes.reduce((a, b) => a + b) / elapsedTimes.length : undefined,
                max: hasCalculatedStats ? elapsedTimes.reduce((a, b) => a > b ? a : b)               : undefined
            }
        } 
    }

    /**
     * calculates the statistics of the work items in the output basket 
     * @param sesFtt work item events of entering a work item basket holder (process step or output basket)
     * @param interval interval length into the past from now, e.g. if time=15 and interval=7 then it is the interval [9-15] 
     * @returns output basket statistics
     */
    private obStatistics(sesFtt: WorkItemFlowEventStats[], interval: TimeUnit): I_WorkItemStatistics { // "sesFtt" = Statistic EventS From-To Time
        const sesOfOb = sesFtt.filter(se => se.wibhEntered == this.outputBasket)
        const wisElapTimeAndValAdd: WiElapTimeAndValAdd[] = sesOfOb.map(se => { 
            return { 
                wi:          se.wi,
                valueAdd:    se.wi.materializedValue(),
                elapsedTime: se.finishedTime - se.injectionIntoValueChainTime 
            }
        })
        return this.workItemsStatistics(wisElapTimeAndValAdd, interval)
    }

    /**
     * calculates the statistics of the work items in a process step 
     * @param sesFtt work item events of entering a work item basket holder (process step or output basket)
     * @param interval interval length into the past from now, e.g. if time=15 and interval=7 then it is the interval [9-15] 
     * @returns process step statistics
     */
    private psStatistics(sesFtt: WorkItemFlowEventStats[], vc: ValueChain, ps: ProcessStep, interval: TimeUnit): I_ProcessStepStatistics { // "sesFtt" = Statistic EventS From-To Time
        const wiElapTimeValAddOfVcPs: WiElapTimeAndValAdd[] = sesFtt.filter(se => se.vc == vc && se.psExited == ps)
                                                .map(se => { return {
                                                    wi:          se.wi,
                                                    valueAdd:    se.vc.totalValueAdd,
                                                    elapsedTime: se.elapsedTime
                                                }})
        return {
            id: ps.id,
            stats: this.workItemsStatistics(wiElapTimeValAddOfVcPs, interval)
        }
    }

    /**
     * calculates the statistics of the work items in a value chain 
     * @param sesFtt work item events of entering a work item basket holder (process step or output basket)
     * @param interval interval length into the past from now, e.g. if time=15 and interval=7 then it is the interval [9-15] 
     * @returns value chain statistics
     */
    private vcStatistics(sesFtt: WorkItemFlowEventStats[], vc: ValueChain, interval: TimeUnit): I_ValueChainStatistics {  // "sesFtt" = Statistic EventS From-To Time
        const sesOfVc = sesFtt.filter(se => se.vc == vc && se.wibhEntered == this.outputBasket) // select only work item lifecycle events of the given value chain when the work item moved to the ouput basket
        const wiElapTimeValAddOfVc: WiElapTimeAndValAdd[] = sesOfVc.map(se => { // calculate the elapsed time for each selected work item lifecycle event 
            return {
                wi:          se.wi,
                valueAdd:    se.wi.materializedValue(),
                elapsedTime: se.finishedTime - se.injectionIntoValueChainTime // from injection to finished the process step of the work item lifecycle event i.e. it proceeded to the the next
            }
        })
        return {
            id: vc.id,
            stats: {
                vc:     this.workItemsStatistics(wiElapTimeValAddOfVc, interval),
                pss:    vc.processSteps.map(ps => this.psStatistics(sesFtt, vc, ps, interval))
            }
        }
    }

    /**
     * Calculate the integral of engaged working capital over the time interval 
     * @param fromTime interval's first timestamp (inclusive)
     * @param toTime interval's last timestamp (inclusive)
     * @returns integral of working capital
     */
    private workingCapitalBetween(fromTime: Timestamp, toTime: Timestamp): Value {
        let accumulatedWorkingCapital = 0
        for (let t = fromTime; t <= toTime; t++) {
            accumulatedWorkingCapital += this.workingCapitalAt(t)
        }
        return accumulatedWorkingCapital
    }

    /**
     * Calculated the system statistics
     * @param interval interval length into the past from now, e.g. if time=15 and interval=7 then it is the interval [9-15] 
     * @returns the system statitiscs
     */
    public systemStatistics(interval: TimeUnit): I_SystemStatistics {
        const toTime   = this.clock.time
        const fromTime = toTime - interval + 1  
        console.log(`\n-------- System.systemStatistics(): about to calculate and return system stats at time= ${this.clock.time} ...`)
        // collect a list of all work item lifecycle events in the system where the work items have proceeded to a new work item basket holder 
        // within the from-to-interval. Every work item lifecycle event in the list contains e.g. its cycle time in the process step it moved out.  
        const statEventsFromToTime: WorkItemFlowEventStats[] = this.valueChains.flatMap(vc => vc.processSteps.flatMap(ps => ps.flowStats(fromTime, toTime)))
                                                                   .concat(this.outputBasket.flowStats(fromTime, toTime))
        // calculate economics statistics for the overall system
        const endProductMoreStatistics: I_EndProductMoreStatistics  = this.outputBasket.statsOfArrivedWorkitemsBetween(fromTime, toTime)
        const fixStaffCost      = this.workers.length * interval                            // cost is incurred by the fixed permanent number of workers
        const workingCapital    = this.workingCapitalBetween(fromTime, toTime) 
        const roceVar           =  (endProductMoreStatistics.discountedValueAdd - this.accumulatedEffortMade(fromTime, toTime)) / workingCapital
        const roceFix           =  (endProductMoreStatistics.discountedValueAdd - fixStaffCost) / workingCapital

        return {
            timestamp:          this.clock.time,
            valueChains:        this.valueChains.map(vc => this.vcStatistics(statEventsFromToTime, vc, interval)), // flow statistics i.e. cycle times and throughputs of value chains and process steps
            outputBasket: {
                flow:           this.obStatistics(statEventsFromToTime, interval), // flow statistics i.e. cycle times and throughputs of the overall system output i.e. the end products
                economics:   {
                    ...endProductMoreStatistics,
                    avgWorkingCapital: workingCapital / interval,
                    roceVar:           roceVar,
                    roceFix:           roceFix           
                }
            }
        } 
    }

//----------------------------------------------------------------------
//    API mode - retrieve all workitem events (for export for external statistical analysis)
//----------------------------------------------------------------------

    /**
     * retrieve all lifecycle events of the work items in the system (for export for external statistical analysis)
     * @returns all work item lifecycle events in the system 
     */
    public get allWorkitemLifecycleEvents() {
        return this.valueChains.flatMap(vc => vc.allWorkitemLifecycleEvents).concat(this.outputBasket.allWorkitemLifecycleEvents)
    }
    
//----------------------------------------------------------------------
//    API mode - Learning Statistics (= workers' weighted workitem selection strategies over time)
//----------------------------------------------------------------------

    /**
     * @returns learning statistics (= workers' weighted workitem selection strategies over time)
     */
    get learningStatistics(): I_LearningStatsWorkers {
        return this.workers.map(wo => wo.statsOverTime)
    }

//----------------------------------------------------------------------
//    API mode - WIP limit optimization 
//----------------------------------------------------------------------

    /**
     * Creates a optimization position from wip limits
     * @returns position
     */
    private searchStatePositionFromWipLimits(): Position<ProcessStep> { 
        return Position.new(this.vdm, this.vdm.vds.map(vd => vd.dimension?.wipLimit > 0 ? vd.dimension.wipLimit : 1 ))
    }

    /**
     * set wip limits from the results of the peak search algorithm 
     */
    private setWipLimitsFromSearchStatePosition(): void { 
        this.vdm.vds.forEach((vd, idx) => vd.dimension.wipLimit = this.searchState.position.vec[idx])
    }

    /**
     * Calculate the upper boundary of an undefined wip limit on basis of the norm effort and assigned workers 
     * @param ps process step 
     * @returns wip limit
     */
    private wipLimitUpperBoundary(ps: ProcessStep): number {
        const assignedWorkers = this.assignmentSet.assignedWorkersToProcessStep(ps)
        return Math.ceil(Math.max(ps.wipLimit, Math.ceil(assignedWorkers ? assignedWorkers.length / ps.normEffort : 1)) * this.searchParms.wipLimitUpperBoundaryFactor)
    } 

    /**
     * initialize wip limit optimization
     */
    public initializeWipLimitOptimization(): void {
        Position.visitedPositions.clear()
        this.vdm                = new VectorDimensionMapper<ProcessStep>(this.valueChains.flatMap(vc => vc.processSteps.map(ps => new VectorDimension<ProcessStep>(ps, 1, this.wipLimitUpperBoundary(ps)))))
        this.wipLimitSearchLog  = this.wipLimitSearchLog ? this.wipLimitSearchLog : new SearchLog<ProcessStep>()
        this.searchState        = {
                                    position:           this.searchStatePositionFromWipLimits(), // inital values set as in process steps defined; if null there then set 1; will be (partially) overwritten by potentially manually set WIP limits of the process steps at each iteration
                                    direction:          new Direction<ProcessStep>(this.vdm, this.vdm.vds.map(_ => -1)),  // initial direction is [1, 1, ..., 1]
                                    temperature:        this.searchParms.initTemperature,
                                    downhillStepsCount: 0 
                                }
        this.setWipLimitsFromSearchStatePosition()
    }

    /**
     * @returns true if wip limit optimization is still active 
     */
    get isWipLimitOptimizationStillActive(): boolean { 
        return this.searchState ? !(this.searchState.temperature < 0) : false  
    }

//----------------------------------------------------------------------
//    BATCH mode - Output
//----------------------------------------------------------------------

    private headerForValueChains = ():string => "_t_||" + this.valueChains.map(vc => vc.stringifiedHeader()).reduce((a, b) => a + "| |" + b) +"| "

    public showHeader = () => console.log(this.headerForValueChains() + "_#outs__CT:[min___avg___max]_TP:[__#______$]") 

    private showLine = () => console.log(this.clock.time.toString().padStart(3, ' ') + "||" 
                                    + this.valueChains.map(vc => vc.stringifiedRow()).reduce((a, b) => a + "| |" + b) + "| " 
                                    + this.outputBasket.workItemBasket.length.toString().padStart(6, " ") + " " 
                                    + this.obStatsAsString())

    public showFooter = () => { 
        console.log(this.headerForValueChains()
        + this.outputBasket.workItemBasket.length.toString().padStart(6, " ") + " " 
        + this.obStatsAsString())
        console.log("Utilization of:")
        this.workers.forEach(wo => wo.utilization(this))
        this.workers.forEach(wo => console.log(`${wo.id.padEnd(10, " ")} ${wo.stats.utilization.toFixed(1).padStart(4, ' ')}%\t` 
            + wo.stats.assignments.map(a => a.valueChain.id + "." + a.processStep.id).reduce((a, b) => a + " / " + b)))
    }                               

    private obStatsAsString(): string {
        return"system.obStatsAsString() - left empty"  /* needs to be fixed */
    }

//----------------------------------------------------------------------
//    DEBUGGING
//----------------------------------------------------------------------

    private showWorkitemDebuggingDetails(now: Timestamp, wi: WorkItem, ps?: ProcessStep): void {
        console.log(`\t\tWI id=${wi.id}`)
//        console.log(`\t\t total elap.time=${wi.elapsedTime(ps ? ElapsedTimeMode.firstEntryToNow : ElapsedTimeMode.firstToLastEntryFound, ElapsedTimeFor.currentProcess)}`) 
        console.log(`\t\t total effort=${wi.accumulatedEffort(0, now, ps)}`)
        console.log(`\t\t log:`)
        wi.log.forEach(le => console.log(`\t\t\t${le}`))
    }

    private showDebugWorkitemData(): void {
        // for debugging only: show state of all workitems 
        this.valueChains.forEach(vc => {
            console.log(`VC=${vc.id}:`)
            vc.processSteps.forEach(ps => {
                console.log(`\tPS=${ps.id}:`)
                ps.workItemBasket.forEach(wi => this.showWorkitemDebuggingDetails(this.clock.time, wi, ps))
            })
        })

        console.log(`\tOB:`)
        this.outputBasket.workItemBasket.forEach((wi: WorkItem) => this.showWorkitemDebuggingDetails(this.clock.time, wi))
    }
}


