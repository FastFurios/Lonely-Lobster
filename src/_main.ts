// ########################################################################################################
//                                  LONELY LOBSTER
// a simulation of colaboration of workers in a company with multiple value chains
//      depending upon individual worker's strategies what to work on next 
//                          Gerold Lindorfer, Dec 2022 ff.
// ########################################################################################################

import express  from 'express'
import session  from "express-session" // Explanation of express-session: https://www.youtube.com/watch?v=isURb7HQkn8
import cors     from "cors"

import { systemCreatedFromConfigJson, systemCreatedFromConfigFile } from './io_config.js'
import { processWorkOrderFile } from './io_workload.js'
import { LonelyLobsterSystem } from './system.js'

// define where to find the comand line arguments (e.g. $ node target/_main.js test/LonelyLobster_Testcase0037.json test/workload_50_blue_burst_15_green_burst_10.csv)
enum InputArgs {
    "Mode"              = 2,
    "SystemConfig"      = 3,
    "WorkOrders"        = 4
}
console.log("argv[2]=" + process.argv[2] + ", " + "argv[3]=" + process.argv[3] + ", " + "argv[4]=" + process.argv[4] + "\n")

// for API mode only: add at least one user property in the session data that I can change so express-session knows to set a session cookie in the response from then on 
declare module "express-session" { // expand the type of the session data by my indicator that a Lonely Lobster session exists  
    interface SessionData {
        hasLonelyLobsterSession: boolean //https://stackoverflow.com/questions/43367692/typescript-method-on-class-undefined
    }
}

// -------------------------------------------------------------------
// SHOW HELP 
// -------------------------------------------------------------------
function showManual(): void {
    console.log("Run it in one of 2 modes:")
    console.log("$ node target/_main.js --batch <system-config-file> <work-order-file>")
    console.log("$ node target/_main.js --api &")
}

// -------------------------------------------------------------------
// BATCH MODE 
// -------------------------------------------------------------------
function batchMode(): void {
    console.log("Running in batch mode ...")

    // create the system from the config JSON file
    let lonelyLobsterSystem = systemCreatedFromConfigFile(process.argv[InputArgs.SystemConfig])
    processWorkOrderFile(process.argv[InputArgs.WorkOrders], lonelyLobsterSystem)
}

// -------------------------------------------------------------------
// API MODE 
// -------------------------------------------------------------------
function apiMode(): void {
    console.log("Running in api mode ...")

    const app  = express()
    const port = process.env.PORT || 3000
    if (!port) { 
        console.log("_main: port is undefined. Stopping...")
        process.exit()
    }
    app.use(express.json()) // for parsing application/json
    app.use(express.urlencoded({ extended: true })) // for parsing application/x-www-form-urlencoded
    // setup cors for development environment only:
    app.use(cors({  origin: ["http://localhost:4200" /* Anglar Frontend */, "http://localhost:3000" /* Lonely Lobster Backend */], // allow request from specific origin domains (* would do it for all origin, hoiwever credentials require explicit origins here): https://www.section.io/engineering-education/how-to-use-cors-in-nodejs-with-express/
                    credentials: true })) // allow credentials, in this case the session cookie to be send to the Angular client  

    // configure session-express
    app.use(session({
        secret: 'my-secret',        // a secret string used to sign the session ID cookie
        resave: false,              // don't save session if unmodified
        saveUninitialized: false    // don't create session until something stored
    }))
    // set up API sessions store               
    type CookieSessionId = string
    const webSessions = new Map<CookieSessionId, LonelyLobsterSystem>()  

    //------------------------------
    // SERVE ANGULAR FRONTEND 
    //------------------------------
    // add route to the Lonely Lobster Angular dist package which is served to the client browser
    app.use(express.static("frontend"))  // https://www.bing.com/videos/riverview/relatedvideo?q=how+to+serve+Angular+app+and+API+backend&mid=419E11BAD7F37C384CBD419E11BAD7F37C384CBD

    //------------------------------
    // API call - INITIALIZE 
    //------------------------------
    app.post('/initialize', (req, res) => {
        console.log("\n_main: app.post /initialize ------------------------------------")

        let lonelyLobsterSystem: LonelyLobsterSystem 
        try { lonelyLobsterSystem = systemCreatedFromConfigJson(req.body) }
        catch(error: any) {
            console.log("_main: app.post /initialize: ERROR interpreting system configuration")
            res.status(400).json({ message: error.message })
            return 
        }

        console.log("_main: app.post /initialize : sessionID = " +  req.sessionID + ", lonelyLobsterSystem.id = " + lonelyLobsterSystem.id)
        webSessions.set(req.sessionID, lonelyLobsterSystem!)
        lonelyLobsterSystem.clock.setTo(-1) // 0 = setup system and first empty iteration to produce systemState for the front end; 1 = first real iteration triggered by user
        req.session.hasLonelyLobsterSession = true // set the "change indicator" in the session data: once the state of this property changed, express-session will now keep the sessionID constant and send it to the client
        res.send(lonelyLobsterSystem.nextSystemState(lonelyLobsterSystem.emptyIterationRequest()))
    })

    //------------------------------
    // API call - ITERATE
    //------------------------------
    app.post('/iterate', (req, res) => {
        console.log("_main: app.post /iterate ------------------------------------")
        const lonelyLobsterSystem = webSessions.get(req.sessionID)
        if (!lonelyLobsterSystem) { 
            console.log("_main(): app.post /iterate: could not find a LonelyLobsterSystem for webSession = " + req.sessionID)
            res.send("error: _main(): app.post /iterate: could not find a LonelyLobsterSystem for webSession")
            return
        }
        console.log("_main: app.post /iterate : sessionID = " +  req.sessionID + ", lonelyLobsterSystem.id = " + lonelyLobsterSystem.id)
//      lonelyLobsterSystem.clock.tick()
        req.session.hasLonelyLobsterSession = true // probably not required as express-session knows already it is a session
        res.send(lonelyLobsterSystem.nextSystemState(req.body))
    })

    //------------------------------
    // API call - provide STATISTICS 
    //------------------------------
    app.get('/statistics', (req, res) => {
        console.log("\n_main: app.post /statistics ------------------------------------")
        const lonelyLobsterSystem = webSessions.get(req.sessionID)
        if (!lonelyLobsterSystem) { 
            console.log("_main(): app.post /statistics: could not find a LonelyLobsterSystem for webSession = " + req.sessionID)
            res.send("_main(): app.post /statistics: could not find a LonelyLobsterSystem for webSession")
            return
        }            
        console.log("_main: app.post /statistics : sessionID = " +  req.sessionID + ", lonelyLobsterSystem.id = " + lonelyLobsterSystem.id)
        const interval = req.query.interval ? parseInt(req.query.interval.toString()) : 10
        res.send(lonelyLobsterSystem.systemStatistics( 
                                interval <= 0 ? 0 // stats from the very beginning on
                                                : lonelyLobsterSystem.clock.time <= interval ? 0 : lonelyLobsterSystem.clock.time - interval, // stats of the trailing time window of length "interval"
                                lonelyLobsterSystem.clock.time))
    })

    //---------------------------------
    // listening for incoming API calls
    //---------------------------------
    app.listen(port, () => {0
        return console.log(`Express is listening at http://localhost:${port}`)
    })
}

// -------------------------------------------------------------------
// CHOOSE MODE
// -------------------------------------------------------------------
switch(process.argv[InputArgs.Mode]) {

    case "--batch": {
        batchMode()
        break
    }
    case "--api": {
        apiMode()
        break
    }
    default: showManual()
}
