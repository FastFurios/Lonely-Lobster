// ########################################################################################################
//                                  LONELY LOBSTER
// a simulation of colaboration of workers in a company with multiple value chains
//      depending upon individual worker's strategies what to work on next 
//                          Gerold Lindorfer, Dec 2022 ff.
// ########################################################################################################

import { systemCreatedFromConfigJson, DebugShowOptions, systemCreatedFromConfigFile } from './io_config.js'
import { processWorkOrderFile } from './io_workload.js'
import { nextSystemState, emptyIterationRequest } from './io_api.js'
import { LonelyLobsterSystem, systemStatistics } from './system.js'

import express from 'express'
import session from "express-session" // Explanation of express-session: https://www.youtube.com/watch?v=isURb7HQkn8
import cors from "cors"
import { dirname } from 'path'
import { fileURLToPath } from 'url'


// -------------------------------------------------------------------
// COMMAND LINE HANDLING 
// -------------------------------------------------------------------

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

console.log("argv[2]=" + process.argv[2] + ", " + "argv[3]=" + process.argv[3] + ", " + "argv[4]=" + process.argv[4] + "\n")

// -------------------------------------------------------------------
// PREPARE SESSION HANDLING 
// -------------------------------------------------------------------

// add at least one user property that I can change once session data is to be kept 
declare module "express-session" { // expand the type of the session data by the index 
    interface SessionData {
      hasSessionObject: boolean // https://stackoverflow.com/questions/43367692/typescript-method-on-class-undefined
  }
}

const app  = express()
const port = process.env.PORT // 3000
if (!port) { 
    console.log("_main: port is undefined. Stopping...")
    process.exit()
}

app.use(session({
    secret: 'my-secret',        // a secret string used to sign the session ID cookie
    resave: false,              // don't save session if unmodified
    saveUninitialized: false    // don't create session until something stored
  }))

app.use(cors({ origin: ["http://localhost:4200" /* Anglar Frontend */, "http://localhost:3000" /* Lonely Lobster Backend */], // allow request from specific origin domains (* would do it for all origin, hoiwever credentials require explicit origins here): https://www.section.io/engineering-education/how-to-use-cors-in-nodejs-with-express/
               credentials: true })) // allow credentials, in this case the session cookie to be send to the Angular client  


type CookieSessionId = string

const webSessions = new Map<CookieSessionId, LonelyLobsterSystem>()  

// -------------------------------------------------------------------
// EXECUTING IN BATCH OR API MODE 
// -------------------------------------------------------------------


switch(process.argv[InputArgs.Mode]) {

    case "--batch": { 
        console.log("Running in batch mode ...")
        // create the system from the config JSON file
        let lonelyLobsterSystem = systemCreatedFromConfigFile(process.argv[InputArgs.SystemConfig])

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
        
        app.use(express.json()) // for parsing application/json
        app.use(express.urlencoded({ extended: true })) // for parsing application/x-www-form-urlencoded
        
        app.use(function (req, res, next) {
                // Enabling CORS
                res.header("Access-Control-Allow-Origin", "http://localhost:4200");
                res.header("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS,POST,PUT");
                res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, x-client-key, x-client-token, x-client-secret, Authorization");
                next();
            });
        
        app.use(express.static("frontend"))  // https://www.bing.com/videos/riverview/relatedvideo?q=how+to+serve+Angular+app+and+API+backend&mid=419E11BAD7F37C384CBD419E11BAD7F37C384CBD

/*
        app.get("/", (req, res) => {  // serve the web page
                console.log("\n_main: app.get / : #############################################################################################")
                const __dirname = dirname(fileURLToPath(import.meta.url))
                console.log("_main: app.get / : sessionID= " + req.sessionID + ", __dirname = " + __dirname)
//              const __filename = __dirname + "/../dist/my-first-project/index.html"
                const __filename = "/home/gerold/sw_projects/Angular-Testbed/dist/my-first-project/index.html"
                console.log("_main: app.get / : __filename= " + __filename)

                res.sendFile(__filename) 
            })
*/
        app.post('/initialize', (req, res) => {
//              console.log("_main: app.post \"initialize\" : received request=")
                console.log("\n_main: app.post /initialize : #############################################################################################")
//              console.log("       " + req.body.system_id)
                const lonelyLobsterSystem = systemCreatedFromConfigJson(req.body)
                console.log("_main: app.post /initialize : sessionID = " +  req.sessionID + ", lonelyLobsterSystem.id = " + lonelyLobsterSystem.id)
                webSessions.set(req.sessionID, lonelyLobsterSystem)
//              lonelyLobsterSystem.outputBasket.emptyBasket()
/* doggy */     lonelyLobsterSystem.clock.setTo(0) // 0 = setup system and first empty iteration to produce systemState for the front end; 1 = first real iteration triggered by user
                req.session.hasSessionObject = true // set the index in the session data: as the state of this property changed, express-session will now keep the sessionID constant 
                res.send(nextSystemState(lonelyLobsterSystem, emptyIterationRequest(lonelyLobsterSystem)))
            })

        app.post('/iterate', (req, res) => {
//          console.log("_main: app.post \"iterate\" : received request=")
//          console.log(req.body)
            console.log("_main: app.post /iterate : #############################################################################################")
            const lonelyLobsterSystem = webSessions.get(req.sessionID)
            if (!lonelyLobsterSystem) { 
                console.log("_main(): app.post /iterate: could not find a LonelyLobsterSystem for webSession = " + req.sessionID)
                res.send("error: _main(): app.post /iterate: could not find a LonelyLobsterSystem for webSession")
                return
            }
            console.log("_main: app.post /iterate : sessionID = " +  req.sessionID + ", lonelyLobsterSystem.id = " + lonelyLobsterSystem.id)
            lonelyLobsterSystem.clock.tick()
/* required? */ req.session.hasSessionObject = true // set the index in the session data: as the state of this property changed, express-session will now keep the sessionID constant 
            res.send(nextSystemState(lonelyLobsterSystem, req.body))
        })
        
        app.get('/statistics', (req, res) => {
            console.log("\n_main: app.post /statistics : #############################################################################################")
            const lonelyLobsterSystem = webSessions.get(req.sessionID)
            if (!lonelyLobsterSystem) { 
                console.log("_main(): app.post /statistics: could not find a LonelyLobsterSystem for webSession = " + req.sessionID)
                res.send("_main(): app.post /statistics: could not find a LonelyLobsterSystem for webSession")
                return
            }            
            console.log("_main: app.post /statistics : sessionID = " +  req.sessionID + ", lonelyLobsterSystem.id = " + lonelyLobsterSystem.id)
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

