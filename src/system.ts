//----------------------------------------------------------------------
//    SYSTEM
//----------------------------------------------------------------------

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
         I_VcPsWipLimit } from './io_api_definitions.js'
import { environment } from './environment.js'
import { SearchLog, VectorDimensionMapper, VectorDimension, Position, Direction, PeakSearchParms, SearchState, nextSearchState, StringifyMode} from './optimize.js'


const debugShowOptionsDefaults: DebugShowOptions = { 
    clock:          false,
    workerChoices:  false,
    readFiles:      false  
}

interface WiElapTimeValAdd {
    wi:             WorkItem
    valueAdd:       Value
    elapsedTime:    Timestamp
}




//----------------------------------------------------------------------
//    WIP LIMITS AND SYSTEM PERFORMANCE LOG
//----------------------------------------------------------------------

function performanceAt(): number { return 0 }

const searchParms:        PeakSearchParms     = {
    initTemperature:                 10,     // initial temperature; need to be > 0
    temperatureCoolingGradient:      10,      // cooling with every search iteration
    degreesPerDownhillStepTolerance: 10,      // downhill step sequences tolerance
    initJumpDistance:                1,       // jump distances [#steps] in choosen direction; reduces when temperature cools
    verbose:                         true     // outputs debug data if true
   }

const wipLimitOptimizationObservationPeriod = 100

//----------------------------------------------------------------------
//    LONELY LOBSTER SYSTEM
//----------------------------------------------------------------------
export class LonelyLobsterSystem {
    public  valueChains:         ValueChain[]       = []
    public  workers:             Worker[]           = []
    public  assignmentSet!:      AssignmentSet
    public  workOrderInFlow:     WorkOrder[]        = []
    public  outputBasket:        OutputBasket 

    public  clock:               Clock              = new Clock(this, -1)
    public  idGen                                   = wiIdGenerator()
    public  tagGen                                  = wiTagGenerator(wiTags)

    // workers' work selection strategy learning:
    public  learnAndAdaptParms!: LearnAndAdaptParms

    // system's wip limit optimization:
    private vdm!:               VectorDimensionMapper<ProcessStep>
    public  wipLimitSearchLog                       = new SearchLog<ProcessStep>()
    private searchState!:       SearchState<ProcessStep>   


    constructor(public id:                  string,
                public debugShowOptions:    DebugShowOptions = debugShowOptionsDefaults) {
        this.outputBasket   = new OutputBasket(this)
    }

    public doIterations(iterRequests: I_IterationRequests): void {
        console.log("doIteration: iterRequest=" +  iterRequests[0].wipLimits.map(wl => { return `${wl.vc}.${wl.ps} ${wl.wipLimit}`}))
        this.setWipLimits(iterRequests[0].wipLimits) // we take the first iterations wip-limits as they don't change over time anyway
        for (let req of iterRequests) {
            this.doOneIteration(this.workOrderList(req.vcsWorkOrders), req.optimizeWipLimits)
        }
    }

    public doOneIteration(wos: WorkOrder[], optimizeWipLimits: boolean): void {
        //console.log("\t\t\t\tSystem: doOneIteration():  clock = " + this.clock.time)
        //if (this.clock.time < 1) this.showHeader()

        // populate process steps with work items (and first process steps with new work orders)
        this.valueChains.forEach(vc => vc.processSteps.forEach(ps => ps.lastIterationFlowRate = 0))  // reset flow counters
        this.valueChains.forEach(vc => vc.letWorkItemsFlow())
        if (wos.length > 0) wos.forEach(w => w.valueChain.createAndInjectNewWorkItem())

        // tick the clock to the next interval
        this.clock.tick()

        // measure system performance with current WIP limits and adjust them
            if (optimizeWipLimits && this.clock.time > 0 && this.clock.time % wipLimitOptimizationObservationPeriod == 0) {
                this.optimizeWipLimits()
///* !! */      this.outputBasket.purgeWorkitemsUpto(this.clock.time - wipLimitOptimizationObservationPeriod - 50)  // #### shortens the output basket; stats will be corrupt if going into the past too deep #####
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

        // show valuechains line for current timestamp on console
        //this.showLine()
    }
    
//----------------------------------------------------------------------
//    API mode - Initialization
//----------------------------------------------------------------------

    public emptyIterationRequest(): I_IterationRequests {
        return [{
            vcsWorkOrders:      this.valueChains.map(vc => { return { valueChainId: vc.id, numWorkOrders: 0 }}),
            wipLimits:          this.valueChains.flatMap(vc => vc.processSteps.map(ps => { return {vc: vc.id, ps: ps.id, wipLimit: ps.wipLimit}})),
            optimizeWipLimits:  false
          }]
    }

    public addValueChains(vcs: ValueChain[]) { this.valueChains = vcs }   // *** not sure if this works or if I need to copy the array into this.array

    public addWorkersAndAssignments(wos: Worker[], asSet: AssignmentSet ) { this.workers = wos; this.assignmentSet = asSet }   // *** not sure if this works or if I need to copy the array into this.array

    public addLearningParameters(laps: LearnAndAdaptParms) { this.learnAndAdaptParms = laps; Worker.sysStats = <any>undefined } // clear system 

//----------------------------------------------------------------------
//    API mode - Iteration
//----------------------------------------------------------------------

    private workOrderList(vcsWos: I_VcWorkOrders[]): WorkOrder[] {
        return vcsWos.flatMap(vcWos => duplicate<WorkOrder>(
                                                { timestamp:    this.clock.time,
                                                  valueChain:   this.valueChains.find(vc => vc.id == vcWos.valueChainId.trim())! },
                                                vcWos.numWorkOrders))
    }

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

    private i_processStep(ps: ProcessStep): I_ProcessStep {
        return {
            id:                 ps.id,
            normEffort:         ps.normEffort,
            wipLimit:           ps.wipLimit,            
            workItems:          ps.workItemBasket.map(wi => this.i_workItem(wi)),
            workItemFlow:       ps.lastIterationFlowRate
        }
    }

    private i_valueChain(vc: ValueChain): I_ValueChain {
        return {
            id:                 vc.id,
            totalValueAdd:      vc.totalValueAdd,
            injection:          vc.injection,
            processSteps:       vc.processSteps.map(ps => this.i_processStep(ps))
        }
    }

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

    private i_systemState(): I_SystemState {
        return {
            id:           this.id,
            time:         this.clock.time,
            valueChains:  this.valueChains.map(vc => this.i_valueChain(vc)),
            outputBasket: { workItems: this.outputBasket.workItemBasket.map(wi => this.i_endProduct(wi)) },
            workersState: this.workers.map(wo => this.i_workerState(wo)),
            version:      environment.version
        }
      }

/*
      private wipLimits(): I_VcPsWipLimit[] {          
        return this.valueChains.flatMap(vc => vc.processSteps.map(ps => {return {vc: vc.id, ps: ps.id, wipLimit: ps.wipLimit}}))
    }
*/
    private setWipLimits(wipLimits: I_VcPsWipLimit[]): void {  // I_VcPsWipLimit contains the current WIP limits sent in the frontend request
        for (let wl of wipLimits) {
            const vc = this.valueChains.find(vc => vc.id == wl.vc.trim())
            if (!vc) throw Error(`System: setWipLimits(): value-chain ${vc} not found`)
            const ps: ProcessStep = vc.processSteps.find(ps => ps.id == wl.ps.trim())!
            if (!ps) throw Error(`System: setWipLimits(): process-step ${ps} not found`)
            ps.wipLimit = wl.wipLimit ? wl.wipLimit : 0
            console.log("system.setWIPlimits() to " + wl.ps + "=" + wl.wipLimit)
        }
    }

    public nextSystemState(iterReqs: I_IterationRequests) { 
        //console.log("\tSystem: nextSystemState(): iterReq.batchSize = " + iterReqs.length)
        this.doIterations(iterReqs)
        //console.log("\tSystem: nextSystemState(): doIterations done; returning i_systemState")
        return this.i_systemState()        
    }

    private optimizeWipLimits() {
        this.searchState.position = this.searchStatePositionFromWipLimits()
        const currPerf = this.systemStatistics(this.clock.time - wipLimitOptimizationObservationPeriod < 1 ? 1 : this.clock.time - wipLimitOptimizationObservationPeriod, this.clock.time).outputBasket.economics.roceFix
        this.searchState = nextSearchState<ProcessStep>(this.vdm, this.wipLimitSearchLog, () => currPerf, searchParms, this.clock.time, this.searchState)
                                                                console.log(`system.doOneIteration: nextSearchState() result:  position= ${this.searchState.position.toString(StringifyMode.concise)}, direction= ${this.searchState.direction.toString(StringifyMode.concise)}, temperature= ${this.searchState.temperature}, downhillStepsCount= ${this.searchState.downhillStepsCount}`)
        this.setWipLimitsFromSearchStatePosition()
                                                                console.log(`system.doOneIteration: new WIP limits set to ${this.valueChains.flatMap(vc => vc.processSteps.map(ps => ps.valueChain.id + "." + ps.id + ": " + ps.wipLimit))}`)
    }
//----------------------------------------------------------------------
//    API mode - System Statistics
//----------------------------------------------------------------------

    private workingCapitalAt = (t:Timestamp): Value => { 
        const aux = this
            .valueChains
                .flatMap(vc => vc.processSteps
                    .flatMap(ps => ps.workItemBasket))
            .concat(this.outputBasket.workItemBasket)
            .filter(wi => wi.wasInValueChainAt(t))
            .map(wi => wi.accumulatedEffort(t))
            .reduce((a, b) => a + b, 0)
        return aux
    }

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

    private obStatistics(ses: StatsEventForExitingAProcessStep[], interval: TimeUnit): I_WorkItemStatistics {
        const sesOfOb = ses.filter(se => se.psEntered == this.outputBasket)
        const wiElapTimeValAdd: WiElapTimeValAdd[] = sesOfOb.map(se => { 
            return { 
                wi:          se.wi,
                valueAdd:    se.vc.totalValueAdd,
                elapsedTime: se.finishedTime - se.injectionIntoValueChainTime 
            }
        })
        return this.workItemStatistics(wiElapTimeValAdd, interval)
    }

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

    private avgWorkingCapitalBetween(fromTime: Timestamp, toTime: Timestamp): Value {
        const interval: TimeUnit = toTime - fromTime
        let accumulatedWorkingCapital = 0
        for (let t = fromTime + 1; t <= toTime; t++) {
            accumulatedWorkingCapital += this.workingCapitalAt(t)
        }
        return accumulatedWorkingCapital / interval
    }

    private avgDiscountedValueAdd(endProductMoreStatistics: I_EndProductMoreStatistics, fromTime: Timestamp, toTime: Timestamp): Value {
        const interval: TimeUnit = toTime - fromTime
        return endProductMoreStatistics.discountedValueAdd / interval
    }

    private avgNormEffort(endProductMoreStatistics: I_EndProductMoreStatistics, fromTime: Timestamp, toTime: Timestamp): Value {
        const interval: TimeUnit = toTime - fromTime
        return endProductMoreStatistics.normEffort / interval
    }

    private avgFixStaffCost(endProductMoreStatistics?: I_EndProductMoreStatistics, fromTime?: Timestamp, toTime?: Timestamp): Value {
       return this.workers.length
    }

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
//    API mode - Learning Statistics (= workers' weighted workitem selection strategies over time)
//----------------------------------------------------------------------

    public get learningStatistics(): I_LearningStatsWorkers {
        return this.workers.map(wo => wo.statsOverTime)
    }

//----------------------------------------------------------------------
//    API mode - WIP limit optimization 
//----------------------------------------------------------------------


    private searchStatePositionFromWipLimits(): Position<ProcessStep> { 
        return Position.new(this.vdm, this.vdm.vds.map(vd => vd.dimension?.wipLimit > 0 ? vd.dimension.wipLimit : 1 ))
    }

    private setWipLimitsFromSearchStatePosition(): void { 
        this.vdm.vds.forEach((vd, idx) => vd.dimension.wipLimit = this.searchState.position.vec[idx])
    }

    public initializeWipLimitOptimization(): void {
        Position.visitedPositions.clear()
        this.vdm                = new VectorDimensionMapper<ProcessStep>(this.valueChains.flatMap(vc => vc.processSteps.map(ps => new VectorDimension<ProcessStep>(ps, 1, undefined))))
        this.searchState        = {
                                    position:           this.searchStatePositionFromWipLimits(), // inital values set as in process steps defined; if null there then set 1; will be (partially) overwritten by potentially manually set WIP limits of the process steps at each iteration
                                    direction:          new Direction<ProcessStep>(this.vdm, this.vdm.vds.map(_ => 1)),  // initial direction is [1, 1, ..., 1]
                                    temperature:        searchParms.initTemperature,
                                    downhillStepsCount: 0
                                }
        console.log(`system.initializeWipLimitOptimization(): this.searchState.direction = ${this.searchState.direction}; this.vdm.vds.length= ${this.vdm.vds.length}`)
        this.setWipLimitsFromSearchStatePosition()
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


