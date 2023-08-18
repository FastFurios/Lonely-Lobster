// ########################################################################################################
//                                  LONELY LOBSTER
// a simulation of colaboration of workers in a company with multiple value chains
//      depending upon individual worker's strategies what to work on next 
//                          Gerold Lindorfer, Dec 2022 ff.
// ########################################################################################################

import { Clock } from './clock.js'
import { systemCreatedFromConfigJson, DebugShowOptions, systemCreatedFromConfigFile } from './io_config.js'
import { processWorkOrderFile } from './io_workload.js'
import { nextSystemState, emptyIterationRequest } from './io_api.js'
import { workItemIdGenerator, wiTagGenerator, wiTags } from './workitem.js'
import { OutputBasket } from './workitembasketholder.js'
import { LonelyLobsterSystem, systemStatistics } from './system.js'

import express from 'express'

// set debug defauls in case the io_connfig.json does not contain any debug properties
const debugShowOptionsDefaults: DebugShowOptions = { 
    clock:          false,
    workerChoices:  false,
    readFiles:      false  
}
export var debugShowOptions: DebugShowOptions = debugShowOptionsDefaults 


// create a clock (it will be 'ticked' by the read rows of the workflow file)
export const clock = new Clock(-1)

// create the sink of all fully processed workitems
export const outputBasket = new OutputBasket()

// create a generator for the id and a (non-unique) tag for each new workitem
export const idGen = workItemIdGenerator()
export const tagGen = wiTagGenerator(wiTags)

function manual(): void {
    console.log("Run it in one of 2 modes:")
    console.log("$ node target/_main.js --batch <system-config-file> <work-order-file>")
    console.log("$ node target/_main.js --api &")
}

// define where to find the comand line arguments (e.g. $ node target/_main.js test/LonelyLobster_Testcase0037.json test/workload_50_blue_burst_15_green_burst_10.csv)
enum InputArgs {
    "Mode"              = 2,
    "SystemConfig"      = 3,
    "WorkOrders"        = 4
}

export let lonelyLobsterSystem: LonelyLobsterSystem

if(debugShowOptions.readFiles) console.log("argv[2]=" + process.argv[2] + ", " + "argv[3]=" + process.argv[3] + ", " + "argv[4]=" + process.argv[4] + "\n")

switch(process.argv[InputArgs.Mode]) {

    case "--batch": { 
        console.log("Running in batch mode ...")
        // create the system from the config JSON file
        lonelyLobsterSystem = systemCreatedFromConfigFile(process.argv[InputArgs.SystemConfig])

        // process the workload file
        console.log("processWorkOrderFile( " + process.argv[InputArgs.WorkOrders] + " , lonelyLobsterSystem")
        processWorkOrderFile(process.argv[InputArgs.WorkOrders], lonelyLobsterSystem)

        console.log("OutputBasket stats=")
        console.log(outputBasket.flowStats)

        break;
    } 

    case "--api": {
        console.log("Running in api mode ...")
        // listen to API and process incoming requests
        const app  = express()
        const port = 3000
        
        app.use(express.json()) // for parsing application/json
        app.use(express.urlencoded({ extended: true })) // for parsing application/x-www-form-urlencoded
        
        app.use(function (req, res, next) {
            // Enabling CORS
            res.header("Access-Control-Allow-Origin", "http://localhost:4200");
            res.header("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS,POST,PUT");
            res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, x-client-key, x-client-token, x-client-secret, Authorization");
            next();
            });
        
//3.7.23  let clockTime = 0

        app.post('/initialize', (req, res) => {
//              console.log("_main: app.post \"initialize\" : received request=")
                console.log("_main: app.post \"initialize\" : #############################################################################################")
//              console.log(req.body)
                lonelyLobsterSystem = systemCreatedFromConfigJson(req.body)
                outputBasket.emptyBasket()

                clock.setTo(0) // 0 = setup system and first empty iteration to produce systemState for the front end; 1 = first real iteration triggered by user
                res.send(nextSystemState(lonelyLobsterSystem, emptyIterationRequest(lonelyLobsterSystem)))
            })

        app.post('/iterate', (req, res) => {
//          console.log("_main: app.post \"iterate\" : received request=")
//          console.log(req.body)
            clock.tick()
            res.send(nextSystemState(lonelyLobsterSystem, req.body))
        })
        
        app.get('/statistics', (req, res) => {
            //console.log("_main: app.post \"statistics\" : received get request. fromTime= " + (clock.time - 10 < 0 ? 0 : clock.time - 10) + " > toTime= " + clock.time)
            console.log("_main: app.post \"statistics\" : received get request. --------------------------------") 
            console.log("       app.post \"statistics\" fromTime= " + req.query.fromTime + ", toTime= " + req.query.toTime)
            const interval = 10000
            res.send(systemStatistics(lonelyLobsterSystem, clock.time <= interval ? 1 : clock.time - interval, clock.time))  // events taken from fromTime including to toTime including
            //console.log("_main: app.post \"statistics\" : sent response")
        })
        
        app.listen(port, () => {
            return console.log(`Express is listening at http://localhost:${port}`)
        })

        break
    }

    default: manual()
}

