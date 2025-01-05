//----------------------------------------------------------------------
/**
 *  SYSTEM
 */   
//----------------------------------------------------------------------
// last code cleaning: 04.01.2025

import { Clock } from './clock.js'
import { wiIdGenerator, wiTagGenerator, wiTags, WorkOrder, StatsEventForExitingAProcessStep, WorkItem, WiExtInfoElem, ElapsedTimeMode } from './workitem.js'
import { duplicate, reshuffle } from './helpers.js'
import { ValueChain } from './valuechain.js'
import { ProcessStep, OutputBasket } from './workitembasketholder.js'
import { Worker, AssignmentSet, LearnAndAdaptParms } from './worker.js'
import { DebugShowOptions } from './io_config.js'
import { Timestamp, TimeUnit, Value, I_VcWorkOrders,
         I_SystemStatistics, I_ValueChainStatistics, I_ProcessStepStatistics, I_WorkItemStatistics, I_EndProductMoreStatistics, 
         I_IterationRequests, I_SystemState, I_ValueChain, I_ProcessStep, I_WorkItem, I_WorkerState, I_LearningStatsWorkers, 
         I_VcPsWipLimit, I_WorkItemEvent, I_FrontendPresets} from './io_api_definitions.js'
import { environment } from './environment.js'
import { SearchLog, VectorDimensionMapper, VectorDimension, Position, Direction, PeakSearchParms, SearchState, nextSearchState, StringifyMode} from './optimize.js'


const debugShowOptionsDefaults: DebugShowOptions = { 
    clock:          false,
    workerChoices:  false,
    readFiles:      false  
}

/** work item with the value add of the work item's value chain and the elapsed time in the value chain */
interface WiElapTimeValAdd {
    wi:             WorkItem
    /** value add of the work item's value chain */
    valueAdd:       Value
    /** elapsed time of the work item in its value chain */
    elapsedTime:    Timestamp
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
        // populate process steps with work items (and first process steps with new work orders)
        this.valueChains.forEach(vc => vc.processSteps.forEach(ps => ps.lastIterationFlowRate = 0))  // reset flow counters
        this.valueChains.forEach(vc => vc.letWorkItemsFlow())
        if (wos.length > 0) wos.forEach(w => w.valueChain.createAndInjectNewWorkItem())

        // tick the clock to the next interval
        this.clock.tick()

        // measure system performance with current WIP limits and adjust them
        if (optimizeWipLimits && this.clock.time > 0 && this.clock.time % this.searchParms.measurementPeriod == 0) {
            this.optimizeWipLimits()
        }

        // prepare workitem extended statistical infos before workers make their choice 
        this.valueChains.forEach(vc => vc.processSteps.forEach(ps => ps.workItemBasket.forEach(wi => wi.updateExtendedInfos())))  // +++ seems duplicate to see below

        // workers select workitems and work them
        this.workers = reshuffle(this.workers) // avoid that work is assigned to workers always in the same worker sequence  
        this.workers.forEach(wo => wo.work(this.assignmentSet))

        // update workitem extended statistical infos after workers have done their work 
        this.valueChains.forEach(vc => vc.processSteps.forEach(ps => ps.workItemBasket.forEach(wi => wi.updateExtendedInfos())))

        // update workers stats after having worked
        this.workers.forEach(wo => wo.utilization(this))
    }
    
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
     * create a work item data object for the new system state 
     * @param wi work item 
     * @returns work item data object 
     */
    private i_workItem (wi: WorkItem): I_WorkItem { 
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
     * create a work item data object in the output basket for the new system state
     * @param wi end product i.e. work item in the output basket 
     * @returns value chain data object
     */
    private i_endProduct (wi: WorkItem): I_WorkItem { 
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
        return this.i_systemState()        
    }

    /**
     * optimize wip limits on basis of current system statistics; calculate new peak search algorithm state
     */
    private optimizeWipLimits() {
        this.searchState.position = this.searchStatePositionFromWipLimits()
        const currPerf = this.systemStatistics(this.clock.time - this.searchParms.measurementPeriod < 1 ? 1 : this.clock.time - this.searchParms.measurementPeriod, this.clock.time).outputBasket.economics.roceFix
        this.searchState = nextSearchState<ProcessStep>(this.wipLimitSearchLog, () => currPerf, this.searchParms, this.clock.time, this.searchState)
        this.setWipLimitsFromSearchStatePosition()
    }
//----------------------------------------------------------------------
//    API mode - System Statistics
//----------------------------------------------------------------------

    /**
     * Calculate the working capital at timestamp, i.e. the sum of the accumulated effort 
     * of all work items in the value chains at the timestamp 
     * @param t timestamp 
     * @returns working capital 
     */
    private workingCapitalAt = (t:Timestamp): Value => { 
        return this
            .valueChains
                .flatMap(vc => vc.processSteps
                    .flatMap(ps => ps.workItemBasket))
            .concat(this.outputBasket.workItemBasket)
            .filter(wi => wi.wasInValueChainAt(t))
            .map(wi => wi.accumulatedEffort(t))
            .reduce((a, b) => a + b, 0)
    }

    /**
     * Calculates the statistics for a work item over the last intervall time units  
     * @param wiElapTimeValAdd work item with its value chain added value and the elapsed time   
     * @param interval interval into the past from now 
     * @returns work item statistics
     */
    private workItemStatistics(wiElapTimeValAdd: WiElapTimeValAdd[], interval: TimeUnit): I_WorkItemStatistics {
        const elapsedTimes: TimeUnit[] = wiElapTimeValAdd.flatMap(el => el.elapsedTime)
        const hasCalculatedStats = elapsedTimes.length > 0
        return {
            hasCalculatedStats: hasCalculatedStats,
            throughput: {
                itemsPerTimeUnit: wiElapTimeValAdd.length / interval,
                valuePerTimeUnit: wiElapTimeValAdd.map(el => el.valueAdd).reduce((va1, va2) => va1 + va2, 0) / interval
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
     * @param ses work item events of entering a work item basket holder (process step or output basket)
     * @param interval interval into the past from now
     * @returns output basket statistics
     */
    private obStatistics(ses: StatsEventForExitingAProcessStep[], interval: TimeUnit): I_WorkItemStatistics {
        const sesOfOb = ses.filter(se => se.psEntered == this.outputBasket)
        const wisElapTimeValAdd: WiElapTimeValAdd[] = sesOfOb.map(se => { 
            return { 
                wi:          se.wi,
                valueAdd:    se.vc.totalValueAdd,
                elapsedTime: se.finishedTime - se.injectionIntoValueChainTime 
            }
        })
        return this.workItemStatistics(wisElapTimeValAdd, interval)
    }

    /**
     * calculates the statistics of the work items in a process step 
     * @param ses work item events of entering a work item basket holder (process step or output basket)
     * @param interval interval into the past from now
     * @returns process step statistics
     */
    private psStatistics(ses: StatsEventForExitingAProcessStep[], vc: ValueChain, ps: ProcessStep, interval: TimeUnit): I_ProcessStepStatistics {
        const wiElapTimeValAddOfVcPs: WiElapTimeValAdd[] = ses.filter(se => se.vc == vc && se.psExited == ps)
                                                .map(se => { return {
                                                    wi:          se.wi,
                                                    valueAdd:    se.vc.totalValueAdd,
                                                    elapsedTime: se.elapsedTime
                                                }})
        return {
            id: ps.id,
            stats: this.workItemStatistics(wiElapTimeValAddOfVcPs, interval)
        }
    }

    /**
     * calculates the statistics of the work items in a value chain 
     * @param ses work item events of entering a work item basket holder (process step or output basket)
     * @param interval interval into the past from now
     * @returns value chain statistics
     */
    private vcStatistics(ses: StatsEventForExitingAProcessStep[], vc: ValueChain, interval: TimeUnit): I_ValueChainStatistics {
        const sesOfVc = ses.filter(se => se.vc == vc && se.psEntered == this.outputBasket)
        const wiElapTimeValAddOfVc: WiElapTimeValAdd[] = sesOfVc.map(se => { 
            return {
                wi:          se.wi,
                valueAdd:    se.vc.totalValueAdd,
                elapsedTime: se.finishedTime - se.injectionIntoValueChainTime
            }
        })
        return {
            id: vc.id,
            stats: {
                vc:     this.workItemStatistics(wiElapTimeValAddOfVc, interval),
                pss:    vc.processSteps.map(ps => this.psStatistics(ses, vc, ps, interval))
            }
        }
    }

    /**
     * Calculate the average working capital in the time interval 
     * @param fromTime interval's first timestamp 
     * @param toTime interval's last timestamp
     * @returns average working capital
     */
    private avgWorkingCapitalBetween(fromTime: Timestamp, toTime: Timestamp): Value {
        const interval: TimeUnit = toTime - fromTime
        let accumulatedWorkingCapital = 0
        for (let t = fromTime + 1; t <= toTime; t++) {
            accumulatedWorkingCapital += this.workingCapitalAt(t)
        }
        return accumulatedWorkingCapital / interval
    }

    /**
     * Calculates average discounted value add
     * @param endProductMoreStatistics work items in the output basket with their work item statistics
     * @param fromTime interval's first timestamp 
     * @param toTime interval's last timestamp
     * @returns average discounted value add
     */
    private avgDiscountedValueAdd(endProductMoreStatistics: I_EndProductMoreStatistics, fromTime: Timestamp, toTime: Timestamp): Value {
        const interval: TimeUnit = toTime - fromTime
        return endProductMoreStatistics.discountedValueAdd / interval
    }

    /**
     * Calcutates the average norm effort
     * @param endProductMoreStatistics 
     * @param fromTime interval's first timestamp 
     * @param toTime interval's last timestamp
     * @returns average norm effort
     */
    private avgNormEffort(endProductMoreStatistics: I_EndProductMoreStatistics, fromTime: Timestamp, toTime: Timestamp): Value {
        const interval: TimeUnit = toTime - fromTime
        return endProductMoreStatistics.normEffort / interval
    }

    /**
     * Calculates the average cost of a fixed employed staff
     * @param endProductMoreStatistics not used
     * @param fromTime not used as staffing is time invariant
     * @param toTime not used as staffing is time invariant
     * @returns cost of a fixed staff
     */
    private avgFixStaffCost(endProductMoreStatistics?: I_EndProductMoreStatistics, fromTime?: Timestamp, toTime?: Timestamp): Value {
       return this.workers.length
    }

    /**
     * Calculated the system statistics
     * @param fromTime interval's first timestamp 
     * @param toTime interval's last timestamp
     * @returns the system statitiscs
     */
    public systemStatistics(fromTime: Timestamp, toTime: Timestamp): I_SystemStatistics {
        //console.log("system.systemStatistics(" +  fromTime + ", " + toTime + ")")
        const interval:TimeUnit = toTime - fromTime
        const statEvents: StatsEventForExitingAProcessStep[] = this.valueChains.flatMap(vc => vc.processSteps.flatMap(ps => ps.flowStats(fromTime, toTime)))
                                                              .concat(this.outputBasket.flowStats(fromTime, toTime))
        const endProductMoreStatistics: I_EndProductMoreStatistics  = this.outputBasket.endProductMoreStatistics(fromTime, toTime)
        const avgWorkingCapital = this.avgWorkingCapitalBetween(fromTime, toTime)
        const avgDiscValueAdd   = this.avgDiscountedValueAdd(endProductMoreStatistics, fromTime, toTime)
        const avgVarCost        = this.avgNormEffort(endProductMoreStatistics, fromTime, toTime)
        const avgFixStaffCost   = this.avgFixStaffCost(endProductMoreStatistics, fromTime, toTime)

        const roceVar           =  (avgDiscValueAdd - avgVarCost)      / avgWorkingCapital
        const roceFix           =  (avgDiscValueAdd - avgFixStaffCost) / avgWorkingCapital

        //console.log("system.systemStatistics(" +  fromTime + ", " + toTime + "): avgWorkCap= " + avgWorkingCapital.toPrecision(2) + ", avgDiscValueAdd= " + avgDiscValueAdd.toPrecision(2) + ", avgVarCost= " + avgVarCost.toPrecision(2) + ", avgFixStaffCost= " + avgFixStaffCost.toPrecision(2))
        return {
            timestamp:          this.clock.time,
            valueChains:        this.valueChains.map(vc => this.vcStatistics(statEvents, vc, interval)),
            outputBasket: {
                flow:           this.obStatistics(statEvents, interval),
                economics:   {
                    ...endProductMoreStatistics,
                    avgWorkingCapital: avgWorkingCapital,
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
     * retrieve all workitem events (for export for external statistical analysis)
     * @returns work item events of all end products
     */
    get workitemEvents(): I_WorkItemEvent[] {
        return this.outputBasket.workItemBasket.flatMap(wi => wi.log.map(le => le.workItemEvent))
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
     * CReates a optimization position from wip limits
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
        console.log(`\t\t total elap.time=${wi.elapsedTime(ps ? ElapsedTimeMode.firstEntryToNow : ElapsedTimeMode.firstToLastEntryFound, ps)}`) 
        console.log(`\t\t total effort=${wi.accumulatedEffort(now, ps)}`)
        console.log(`\t\t log:`)
        wi.log.forEach(le => console.log(`\t\t\t${le.stringified()}`))
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


