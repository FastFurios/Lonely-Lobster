// ########################################################################################################
//                                  LONELY LOBSTER
// a simulation of colaboration of workers in a company with multiple value chains
//      depending upon individual worker's strategies what to work on next 
//                          Gerold Lindorfer, Dec 2022 ff.
// ########################################################################################################

import { systemCreatedFromConfigJson, DebugShowOptions, systemCreatedFromConfigFile } from './io_config.js'
import { processWorkOrderFile } from './io_workload.js'
import { nextSystemState, emptyIterationRequest } from './io_api.js'
import { workItemIdGenerator, wiTagGenerator, wiTags } from './workitem.js'
import { OutputBasket } from './workitembasketholder.js'
import { LonelyLobsterSystem, systemStatistics } from './system.js'

import express from 'express'



// create a clock (it will be 'ticked' by the read rows of the workflow file)
//23.9. export const clock = new Clock(-1)

// create the sink of all fully processed workitems
//23.9. export const outputBasket = new OutputBasket()

// create a generator for the id and a (non-unique) tag for each new workitem
//23.9.export const idGen = workItemIdGenerator()
//23.9.export const tagGen = wiTagGenerator(wiTags)

function showManual(): void {
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

console.log("argv[2]=" + process.argv[2] + ", " + "argv[3]=" + process.argv[3] + ", " + "argv[4]=" + process.argv[4] + "\n")

switch(process.argv[InputArgs.Mode]) {

    case "--batch": { 
        console.log("Running in batch mode ...")
        // create the system from the config JSON file
        lonelyLobsterSystem = systemCreatedFromConfigFile(process.argv[InputArgs.SystemConfig])

        // process the workload file
        console.log("processWorkOrderFile( " + process.argv[InputArgs.WorkOrders] + " , lonelyLobsterSystem")
        processWorkOrderFile(process.argv[InputArgs.WorkOrders], lonelyLobsterSystem)

        console.log("OutputBasket stats=")
        console.log(lonelyLobsterSystem.outputBasket.flowStats)

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
                console.log("\n_main: app.post \"initialize\" : #############################################################################################")
//              console.log("       " + req.body.system_id)
                lonelyLobsterSystem = systemCreatedFromConfigJson(req.body)
//              lonelyLobsterSystem.outputBasket.emptyBasket()

/* doggy */     lonelyLobsterSystem.clock.setTo(0) // 0 = setup system and first empty iteration to produce systemState for the front end; 1 = first real iteration triggered by user
                res.send(nextSystemState(lonelyLobsterSystem, emptyIterationRequest(lonelyLobsterSystem)))
            })

        app.post('/iterate', (req, res) => {
//          console.log("_main: app.post \"iterate\" : received request=")
//          console.log(req.body)
            lonelyLobsterSystem.clock.tick()
            res.send(nextSystemState(lonelyLobsterSystem, req.body))
        })
        
        app.get('/statistics', (req, res) => {
            //console.log("_main: app.post \"statistics\" : received get request. fromTime= " + (clock.time - 10 < 0 ? 0 : clock.time - 10) + " > toTime= " + clock.time)
            const interval = req.query.interval ? parseInt(req.query.interval.toString()) : 10
//          console.log("_main: app.post \"statistics\" : received get request: req.query.interval= " + req.query.interval + ", interval= " + interval)
            res.send(systemStatistics(lonelyLobsterSystem, 
                                      interval <= 0 ? 1 // stats from the very beginning on
                                                    : lonelyLobsterSystem.clock.time <= interval ? 1 : lonelyLobsterSystem.clock.time - interval, // stats of the trailing time window of length "interval"
                                      lonelyLobsterSystem.clock.time))
            //console.log("_main: app.post \"statistics\" : sent response")
        })
        
        app.listen(port, () => {
            return console.log(`Express is listening at http://localhost:${port}`)
        })

        break
    }

    default: showManual()
}

