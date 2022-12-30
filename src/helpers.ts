import { createReadStream, readFileSync } from "fs"
import { Interface, createInterface } from "readline"
import { Timestamp } from "./clock.js"
import { LonelyLobsterSystem } from "./system.js"
import { DebugShowOptions, debugShowOptions } from "./_main.js"
import { ValueChain } from './valuechain.js'
import { ProcessStep } from "./workitembasketholder.js"
import { WorkOrder, WiExtInfoTuple, WiExtInfoElem } from './workitem.js'
import { Worker, AssignmentSet, Assignment } from './worker.js'

// ------------------------------------------------------------
//  nice little helper functions
// ------------------------------------------------------------

// --- create 2-tuples from two arrays
type Tuple<T, U> = [T, U]

function tupleBuilderFrom2Arrays<T, U>(a: T[], b: U[]): Tuple<T, U>[] {
    let tupleArray: Tuple<T, U>[] = []
    for (let i=0; i < Math.min(a.length, b.length); i++) tupleArray.push([a[i], b[i]]) 
    return tupleArray
}

// --- create array with n times an item
const duplicate = <T>(item: T, n: number): T[] => Array.from({length: n}).map(e => item)

// --- split an array at an index
interface I_SplitArray<T> {
    head:   T[] 
    middle: T
    tail:   T[]
}
export function reshuffle<T>(a: T[]): T[] {
    if (a.length == 0) return []
    const splitIndex = Math.floor(Math.random() * a.length)
    const sa: I_SplitArray<T> = split(a, splitIndex)
    return [a[splitIndex]].concat(reshuffle<T>(sa.head.concat(sa.tail)))
}

function split<T>(a: T[], splitIndex: number): I_SplitArray<T>  {
   return { head: a.slice(undefined, splitIndex),
            middle: a[splitIndex],
            tail: a.slice(splitIndex + 1, undefined)
          }
}

// --- sort rows and select top row of a table i.e. of an array of arrays (tuples) 
export enum SelectionCriterion {
    minimum = 0,
    maximum = 1
}
export interface SortVector {
    colIndex:  WiExtInfoElem,
    selCrit:   SelectionCriterion
}

export function topElemAfterSort(arrArr: WiExtInfoTuple[], sortVector: SortVector[]): WiExtInfoTuple {
    if (arrArr.length     <  1) throw Error("topElemAfterSort(): received array w/o element") 
    if (arrArr.length     == 1) return arrArr[0]
    if (sortVector.length == 0) return arrArr[Math.floor(Math.random() * arrArr.length)]   // arrArr[0]

    const f = sortVector[0].selCrit == SelectionCriterion.maximum ? (a: number, b: number) => a > b ? a : b
                                                              : (a: number, b: number) => a < b ? a : b
    const v          = (<number[]>arrArr.map(arr => arr[sortVector[0].colIndex])).reduce(f)
    const arrArrTops = arrArr.filter(arr => arr[sortVector[0].colIndex] == v)

    return topElemAfterSort(arrArrTops, sortVector.slice(1))
}

// ------------------------------------------------------------
//  read system configuration from JSON file
// ------------------------------------------------------------

export function systemCreatedFromConfigFile(filename : string) : LonelyLobsterSystem {

    // read system parameter JSON file
    let paramsAsString : string = ""
    try { paramsAsString  = readFileSync(filename, "utf8") } 
    catch (e: any) {
        switch (e.code) {
            case "ENOENT" : { throw new Error("System parameter file not found: " + e) }
            default       : { throw new Error("System parameter file: other error: " + e.message) }
        }   
    } 
    finally {}

    const paj = JSON.parse(paramsAsString)  // "paj" = parameters as JSON 

    // extract system id
    const systemId: string = paj.system_id

    // extract value chains
    interface I_process_step {
        process_step_id: string
        norm_effort:     number
        bar_length:      number
    } 
    interface I_value_chain {
        value_chain_id: string
        value_add:      number
        process_steps:  I_process_step[]  
    }

    const newProcessStep         = (psj:  I_process_step, vc: ValueChain)   : ProcessStep   => new ProcessStep(psj.process_step_id, vc, psj.norm_effort, psj.bar_length)
    const newEmptyValueChain     = (vcj:  I_value_chain)                    : ValueChain    => new ValueChain(vcj.value_chain_id, vcj.value_add)
    const addProcStepsToValChain = (pssj: I_process_step[], vc: ValueChain) : void          => pssj.forEach(psj => vc.processSteps.push(newProcessStep(psj, vc))) 
    const filledValueChain       = (vcj:  I_value_chain)                    : ValueChain    => {
        const newVc: ValueChain = newEmptyValueChain(vcj)
        addProcStepsToValChain(vcj.process_steps, newVc)
        return newVc
    }
    const valueChains: ValueChain[] = paj.value_chains.map((vcj: I_value_chain) => filledValueChain(vcj))

    // extract workers and assignments
    interface I_process_step_assignment {
        value_chain_id:     string
        process_steps_id:   string
    }
    interface I_worker {
        worker_id:                                  string
        select_next_work_item_sort_vector_sequence: I_SortVector[]
        process_step_assignments:                   I_process_step_assignment[]
    }
    interface I_SortVector {
        measure:             WiExtInfoElem
        selection_criterion: SelectionCriterion
    }
    
    const createNewWorker = (woj: I_worker): Worker => { 
        const sortVectorFromJson = (svj: I_SortVector): SortVector => {
            return {
                colIndex: Object.getOwnPropertyDescriptor(WiExtInfoElem, svj.measure)?.value,
                selCrit:  Object.getOwnPropertyDescriptor(SelectionCriterion, svj.selection_criterion)?.value
            } 
        }
        const svs: SortVector[] = woj.select_next_work_item_sort_vector_sequence == undefined 
                                ? [] 
                                : woj.select_next_work_item_sort_vector_sequence?.map(svj => sortVectorFromJson(svj))
        return new Worker(woj.worker_id, svs) 
    }

    const addWorkerAssignment = (psaj: I_process_step_assignment, newWorker: Worker, vcs: ValueChain[], asSet: AssignmentSet): void  => {
        const mayBeVc = vcs.find(vc => vc.id == psaj.value_chain_id)
        if (mayBeVc == undefined) { console.log(`Reading system parameters: try to assign worker=${newWorker} to value chain=${psaj.value_chain_id}: could not find value chain`); throw new Error() }
        const vc: ValueChain  = mayBeVc

        const mayBePs = vc.processSteps.find(ps => ps.id == psaj.process_steps_id)
        if (mayBePs == undefined) { console.log(`Reading system parameters: try to assign worker=${newWorker} to process step ${psaj.process_steps_id} in value chain=${psaj.value_chain_id}: could not find process step`); throw new Error() }
        const ps: ProcessStep = mayBePs

        const newAssignment: Assignment =  { worker:                 newWorker,            
                                             valueChainProcessStep:  { valueChain:  vc, 
                                                                       processStep: ps }}
        asSet.assignments.push(newAssignment)
    }

    const createAndAssignWorker = (woj: I_worker, workers: Worker[], valueChains: ValueChain[], asSet: AssignmentSet): void => { 
        //woj.select_next_work_item_sort_vector_sequence.map((sv: I_SortVector) => )

        const newWorker: Worker = createNewWorker(woj)
        workers.push(newWorker)
        woj.process_step_assignments.forEach(psaj => addWorkerAssignment(psaj, newWorker, valueChains, asSet))
    }
 
    const workers: Worker[] = [] 
    const asSet:   AssignmentSet = new AssignmentSet("default")
    paj.workers.forEach((woj: I_worker) => createAndAssignWorker(woj, workers, valueChains, asSet))
    
    // return the system
    return new LonelyLobsterSystem(systemId, valueChains, workers, asSet)
} 

// ------------------------------------------------------------
//  read work order inflow csv file and feed it to the LonelyLobster system
// ------------------------------------------------------------

type MaybeValueChain = ValueChain | undefined

interface CsvTableProcessorResult {
    time?:       Timestamp,
    workOrders: WorkOrder[] 
}

class CsvTableProcessor {
    headers: MaybeValueChain[] = []
    constructor(private sys: LonelyLobsterSystem) { }
 
    public workOrdersFromLine(line: string): CsvTableProcessorResult {
        if (line.substring(0, 2) == "//") 
            return { workOrders: [] }  // ignore
        if (line.substring(0, 2) == "##") { 
            this.headers =   line
                            .split(";")
                            .slice(1)
                            .map(s => this.sys.valueChains.find(vc => vc.id == s.trim()))
            return { workOrders: [] }  // ignore
        }
        if (line.substring(0, 2) == "??") { 
            this.sys.showFooter()
            return { workOrders: [] }  // ignore
        }
        if (this.headers.length == 0) throw Error("Reading csv-file for incoming work orders: values line w/o having read header line before")
        const timeAndnumWoPerVC: number[] = line  // timestamp and then number of work orders per value chain
                                           .split(";")
                                           .map(s => parseInt(s.trim()))
        const timestamp:  Timestamp = timeAndnumWoPerVC[0]
        const numWoPerVc: number[]  = timeAndnumWoPerVC.slice(1)

        const vcNumTplArr: Tuple<MaybeValueChain, number>[] = tupleBuilderFrom2Arrays(this.headers, numWoPerVc)

        const wosFromLine: WorkOrder[] = vcNumTplArr.flatMap(tpl => duplicate<WorkOrder>( { timestamp: timestamp, valueChain: <ValueChain>tpl[0] }, tpl[1]  ))
        return { time: timestamp, workOrders: wosFromLine }
    }
}

export function processWorkOrderFile(filename : string,sys: LonelyLobsterSystem): void {
    const ctp = new CsvTableProcessor(sys)

    function processWorkOrdersFromLine(line: string): void {
        const { time, workOrders } = ctp.workOrdersFromLine(line)
        if (time != undefined) sys.doNextIteration(time, workOrders)
    }

    const fileReaderConfig      = { input: createReadStream(filename), terminal: false }
    const lineReader: Interface = createInterface(fileReaderConfig)

    sys.showHeader()
    lineReader.on("line", line => processWorkOrdersFromLine(line))
}

