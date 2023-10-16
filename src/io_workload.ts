// ------------------------------------------------------------
//  read work order inflow csv file and feed it to the LonelyLobster system
// ------------------------------------------------------------

import { createReadStream } from "fs"
import { Interface, createInterface } from "readline"
import { Timestamp } from './io_api_definitions'
import { Tuple, duplicate, tupleBuilderFrom2Arrays } from "./helpers.js"
import { LonelyLobsterSystem } from "./system.js"
import { ValueChain } from './valuechain.js'
import { WorkOrder } from './workitem.js'


type MaybeValueChain = ValueChain | undefined

interface CsvTableProcessorResult {
    time?:       Timestamp,
    workOrders: WorkOrder[] 
}

class CsvTableProcessor {  // is actually a function however needs to hold state (i.e. the header once it is read)
    headers: MaybeValueChain[] = []
    constructor(private sys: LonelyLobsterSystem) { }
 
    public workedOrdersFromLine(line: string): CsvTableProcessorResult {
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

export function processWorkOrderFile(filename : string, sys: LonelyLobsterSystem): void {
    const ctp = new CsvTableProcessor(sys)

    function processWorkOrdersFromLine(line: string): void {
        const { time, workOrders } = ctp.workedOrdersFromLine(line)
        if (time != undefined) sys.doNextIteration(time, workOrders)
    }
    const fileReaderConfig      = { input: createReadStream(filename), terminal: false }
    const lineReader: Interface = createInterface(fileReaderConfig)

    //sys.showHeader()
    
    lineReader.on('line', line => processWorkOrdersFromLine(line))
}
