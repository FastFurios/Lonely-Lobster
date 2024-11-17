// ########################################################################################################
//                                  LONELY LOBSTER
// a simulation of colaboration of workers in a company with multiple value chains
//      depending upon individual worker's strategies what to work on next 
//                          Gerold Lindorfer, Dec 2022 ff.
// ########################################################################################################

import express, { Request, Response, NextFunction } from 'express';
import session  from "express-session" // Explanation of express-session: https://www.youtube.com/watch?v=isURb7HQkn8
import cors     from "cors"

import passport from 'passport'
import { BearerStrategy, IBearerStrategyOption, ITokenPayload } from 'passport-azure-ad'
import { VerifyCallback } from 'jsonwebtoken'
import pkg from 'jsonwebtoken'; const { JsonWebTokenError } = pkg;

import { systemCreatedFromConfigJson, systemCreatedFromConfigFile } from './io_config.js'
import { processWorkOrderFile } from './io_workload.js'
import { LonelyLobsterSystem } from './system.js'
import { ApplicationEvent, EventSeverity } from './io_api_definitions.js'
import { environment } from './environment.js'



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
// DEBUG 
// -------------------------------------------------------------------

const debugApiCalls         = true
const debugAuthentication   = true
const debugAutoDrop         = true

const debugTime = (): string => new Date().toTimeString().split(" ")[0]

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

    app.use(cors({  origin: ["http://localhost:4200" /* Anglar Frontend */, "http://localhost:3000" /* Lonely Lobster Backend */], // allow request from specific origin domains (* would do it for all origin, hoiwever credentials require explicit origins here): https://www.section.io/engineering-education/how-to-use-cors-in-nodejs-with-express/
        credentials: true })) // allow credentials, in this case the session cookie to be send to the Angular client  

    // ---- Passport --------------------------------------
    const options: IBearerStrategyOption = {
        identityMetadata:   "https://login.microsoftonline.com/49bf30a4-54b2-47ae-b9b1-ffa71ed3d475/v2.0/.well-known/openid-configuration",  // == Azure AD: directory (tenant) ID 
        clientID:           "api://5797aa9c-0703-46d9-9fba-934498b8e5d6", // == Azure AD: for the backend: manage / expose an API: Application ID URI  
        issuer:             "https://sts.windows.net/49bf30a4-54b2-47ae-b9b1-ffa71ed3d475/",   // use tenant ID
        audience:           "api://5797aa9c-0703-46d9-9fba-934498b8e5d6", // == Azure AD: for the backend: manage / expose an API: Application ID URI
        validateIssuer:     true,       // Validate the issuer of the token
        loggingLevel:       "error",    // optional: logging level for passport-azure-ad
        loggingNoPII:       true        // optional: hide sensitive data in log; if false log shows more details
    }

    function verifyToken(token: ITokenPayload, done: VerifyCallback) {
        if (token.scp != "system.run")
            return done(new JsonWebTokenError("not authorized: wrong scope requested"), token)
        return done(null, token) // If everything is OK, return the user object
    }

    passport.use(
        new BearerStrategy( options, 
                            (token: ITokenPayload, done: VerifyCallback): void  => { verifyToken(token, done) } )
    )

    app.use(passport.initialize())

    // Middleware to authenticate requests using the Bearer strategy
    const authenticateAzureAD = passport.authenticate('oauth-bearer', { session: false });  // "oauth-bearer" is a defined string by passport; do not confuse with the "Bearer" prefix to the token sent by the frontend  
//  const authenticateAzureAD = passport.authenticate('oauth-bearer', { session: true });  // "oauth-bearer" is a defined string by passport; do not confuse with the "Bearer" prefix to the token sent by the frontend  

    // ---- end Passport --------------------------------------

    app.use(express.json()) // for parsing application/json
    app.use(express.urlencoded({ extended: true })) // for parsing application/x-www-form-urlencoded
    // setup cors for development environment only:
    // configure session-express

    app.use(session({
        secret: 'my-secret',        // a secret string used to sign the session ID cookie
        resave: false,              // don't save session if unmodified
        saveUninitialized: false    // don't create session until something stored
    }))
    // set up API sessions store               
    type CookieSessionId = string
    type SystemLifecycle = {
        system?:    LonelyLobsterSystem
        created:    Date
        lastUsed?:  Date
        dropped?:   Date
    }
    //const webSessions = new Map<CookieSessionId, LonelyLobsterSystem>()  
    const webSessions = new Map<CookieSessionId, SystemLifecycle>()  

    // --- Error-handling middleware ------------------------
    class LonelyLobsterError extends Error {
        constructor(       message:     string,
                    public statusCode:  number, 
                    public description: string) { 
            super(message) 
        }
    } 

/*     interface LoLoError {
        runtimeError:           string
        loloErrorCode:          number
        loloErrorDescription:   string        
    }
 */
    //------------------------------
    // SERVE ANGULAR FRONTEND 
    //------------------------------
    // add route to the Lonely Lobster Angular dist package which is served to the client browser
    app.use(express.static("frontend"))  // https://www.bing.com/videos/riverview/relatedvideo?q=how+to+serve+Angular+app+and+API+backend&mid=419E11BAD7F37C384CBD419E11BAD7F37C384CBD

    //------------------------------
    // API call - INITIALIZE 
    //------------------------------
    app.post('/initialize', authenticateAzureAD, (req, res, next) => {
        console.log(`\n${debugTime()} _main: app.post /initialize -------- webSession = ${req.sessionID} ----------------------------`)
        if (debugAuthentication) console.log("\n_main: app.post /initialize: req.headers.authorization= " + req.headers.authorization)

        // build the system
        let lonelyLobsterSystem: LonelyLobsterSystem
        try { lonelyLobsterSystem = systemCreatedFromConfigJson(req.body) }
        catch(exception) {
            // console.error("_main: app.post(initialize): exception = ")
            // console.error(exception)
            const appEvent: ApplicationEvent = {
                dateAndtime:    new Date(),
                source:         "backend",
                sourceVersion:  environment.version,
                severity:       EventSeverity.critical,
                typeId:         100,
                description:    (<Error>exception).message,
                context:        req.sessionID
            }
            // console.error("_main: app.post(initialize): exception caught: new app event = ")
            // console.error(appEvent)
            next(appEvent)
            return // dead line of code but that way the compiler realized that lonelyLobsterSystem is definitely defined below this code block      
        }
        updateSystemLifecycle(webSessions, req.sessionID, LifeCycleActions.created, lonelyLobsterSystem)
        if (!autoDroppingIsInAction) autoDropApparentlyAbandonedSystems(webSessions)
        // handle web session
        if (debugAutoDrop) console.log(`${debugTime()} _main(): app.post /initialize: webSession = ${req.sessionID}; Lonely-Lobster System ist defined= ${lonelyLobsterSystem != undefined}; name= ${lonelyLobsterSystem.id}`)
        req.session.hasLonelyLobsterSession = true // set the "change indicator" in the session data: once the state of this property changed, express-session will now keep the sessionID constant and send it to the client

        // initialize system
        lonelyLobsterSystem.clock.setTo(-1) // 0 = setup system and first empty iteration to produce systemState for the front end; 1 = first real iteration triggered by user
        res.status(201).send(lonelyLobsterSystem.nextSystemState(lonelyLobsterSystem.emptyIterationRequest()))
    })

    //------------------------------
    // API call - ITERATE
    //------------------------------
    app.post('/iterate', authenticateAzureAD, (req, res) => {
        if (debugApiCalls) console.log(`\n${debugTime()} _main: app.post /iterate -------- webSession = ${req.sessionID} ----------------------------`)
        
        // handle web session
        const lonelyLobsterSystemLifecycle = webSessions.get(req.sessionID)
        if (!lonelyLobsterSystemLifecycle?.system) { 
            console.log("_main(): app.post /iterate: could not find a LonelyLobsterSystem for webSession = " + req.sessionID)
            res.status(404).send("error: _main(): app.post /iterate: could not find a LonelyLobsterSystem for webSession")
            return
        }
        updateSystemLifecycle(webSessions, req.sessionID, LifeCycleActions.used)
        if (!autoDroppingIsInAction) autoDropApparentlyAbandonedSystems(webSessions)

        req.session.hasLonelyLobsterSession = true // probably not required as express-session knows already it is a session
        // return next system state to frontend
        res.status(200).send(lonelyLobsterSystemLifecycle.system.nextSystemState(req.body))
    })

    //-------------------------------------
    // API call - provide SYSTEM STATISTICS 
    //-------------------------------------
    app.get('/statistics', authenticateAzureAD, (req, res) => {
        if (debugApiCalls) console.log(`\n${debugTime()} _main: app.get /statistics -------- webSession = ${req.sessionID} ----------------------------`)
        // handle web session
        const lonelyLobsterSystemLifecycle = webSessions.get(req.sessionID)
        if (!lonelyLobsterSystemLifecycle?.system) { 
            console.log("_main(): app.post /system statistics: could not find a LonelyLobsterSystem for webSession = " + req.sessionID)
            res.status(404).send("_main(): app.post /system statistics: could not find a LonelyLobsterSystem for webSession")
            return
        }            
        updateSystemLifecycle(webSessions, req.sessionID, LifeCycleActions.used)
        if (!autoDroppingIsInAction) autoDropApparentlyAbandonedSystems(webSessions)

        // return system statistics to frontend
        const interval = req.query.interval ? parseInt(req.query.interval.toString()) : 10
        res.status(200).send(lonelyLobsterSystemLifecycle.system.systemStatistics( 
                                interval <= 0 ? 0 // stats from the very beginning on
                                                : lonelyLobsterSystemLifecycle.system.clock.time <= interval ? 0 : lonelyLobsterSystemLifecycle.system.clock.time - interval, // stats of the trailing time window of length "interval"
                                lonelyLobsterSystemLifecycle.system.clock.time))
    })

    //-------------------------------------
    // API call - provide WORKITEM EVENTS 
    //-------------------------------------
    app.get('/workitem-events', authenticateAzureAD, (req, res) => {
        if (debugApiCalls) console.log(`\n${debugTime()} _main: app.get /workitem-events -------- webSession = ${req.sessionID} ----------------------------`)
        // handle web session
        const lonelyLobsterSystemLifecycle = webSessions.get(req.sessionID) // webSessions.values().next().value
        if (!lonelyLobsterSystemLifecycle?.system) { 
            console.log("_main(): app.post /system workitem-events: could not find a LonelyLobsterSystem for webSession = " + req.sessionID)
            res.status(404).send("_main(): app.post /system workitem-events: could not find a LonelyLobsterSystem for webSession")
            return
        }            
        updateSystemLifecycle(webSessions, req.sessionID, LifeCycleActions.used)
        if (!autoDroppingIsInAction) autoDropApparentlyAbandonedSystems(webSessions)

        // return workitem events to frontend
        res.status(200).send(lonelyLobsterSystemLifecycle.system.workitemEvents)
    })

    //-------------------------------------
    // API call - provide LEARNING STATISTICS - workitem selection strategies weights of workers over time
    //-------------------------------------
    app.get('/learn-stats', authenticateAzureAD, (req, res) => {
        if (debugApiCalls) console.log(`\n${debugTime()} _main: app.get /learning statistics -------- webSession = ${req.sessionID} ----------------------------`)
        // handle web session
        const lonelyLobsterSystemLifecycle = webSessions.get(req.sessionID)
        if (!lonelyLobsterSystemLifecycle?.system) { 
            console.log("_main(): app.post /learning statistics: could not find a LonelyLobsterSystem for webSession = " + req.sessionID)
            res.status(404).send("_main(): app.post /learning statistics: could not find a LonelyLobsterSystem for webSession")
            return
        }            
        updateSystemLifecycle(webSessions, req.sessionID, LifeCycleActions.used)
        if (!autoDroppingIsInAction) autoDropApparentlyAbandonedSystems(webSessions)

        // return workers' selection strategies learning statistics to frontend
        res.status(200).send(lonelyLobsterSystemLifecycle.system.learningStatistics)
    })

    //-------------------------------------
    // API call - DROP system
    //-------------------------------------
    app.get('/drop', authenticateAzureAD, (req, res) => {
        console.log(`\n${debugTime()} _main: app.get /drop system -------- webSession = ${req.sessionID} ----------------------------`)
        // handle web session
        const lonelyLobsterSystemLifecycle = webSessions.get(req.sessionID)
        if (!lonelyLobsterSystemLifecycle?.system) { 
            console.log("_main(): app.post /drop system: could not find a LonelyLobsterSystem for webSession = " + req.sessionID)
            res.status(404).send("_main(): app.post /drop system: could not find a LonelyLobsterSystem for webSession")
            return
        }            
        updateSystemLifecycle(webSessions, req.sessionID, LifeCycleActions.dropped)

        // return workers' selection strategies learning statistics to frontend
        res.status(200).send()
    })
/* 
    //-------------------------------------
    // API call - test api  
    //-------------------------------------
    app.get('/apiTest', (req, res) => {
        console.log("\n_main: app.get /apiTest ------------------------------------")
        console.log("received header: authorization = " + req.headers.authorization)
        res.send({ message: "Hi there, I am the API test endpoint with best regards! The bearer tokem is: " + req.headers.authorization })
    }) */

    //-------------------------------------
    // ERROR HANDLING middleware
    //-------------------------------------
    app.use((err: any, req: any, res: any, next: NextFunction) => {
        console.error("Gerolds error handling middleware: "); // Log the error for debugging purposes
        console.error(err)
        // Set the status code and send a generic error message to the client
        res.status(403).json(err)
    })
          
    
    //---------------------------------
    // listening for incoming API calls
    //---------------------------------
    app.listen(port, () => {0
        return console.log(`Express is listening at http://localhost:${port}`)
    })

    //---------------------------------
    // clean-up apparently abandoned Lonely-Lobster system instances (allow node.js garbage collection free the memory for unused system instances) 
    //---------------------------------

    type Minutes                                = number
    const autoDropCheckInterval: Minutes        = 1
    const autoDropThreshold: Minutes            = 2
    enum LifeCycleActions { created, used, dropped }
    let autoDroppingIsInAction                  = false  // global "semaphore"

    function updateSystemLifecycle(webSessions: WebSessions, sessionID: string, action: LifeCycleActions, createdSys?: LonelyLobsterSystem) {
        switch (action) {
            case LifeCycleActions.created: { 
                webSessions.set(sessionID, { system: createdSys, created: new Date() })
                //if (debugAutoDrop) console.log("_main.updateSystemLifecycle(): new system created. SessionID= " + sessionID)
                break 
            }
            case LifeCycleActions.used: { 
                const slc: SystemLifecycle | undefined = webSessions.get(sessionID)
                if (!slc) {
                    if (debugAutoDrop) console.log("_main.updateSystemLifecycle(): switch case lastUsed: no system lifecycle for sessionID =" + sessionID)
                    return
                }
                slc.lastUsed = new Date()
                //if (debugAutoDrop) console.log("_main.updateSystemLifecycle(): system used. SessionID= " + sessionID)
                break 
            }
            case LifeCycleActions.dropped: {
                const slc: SystemLifecycle | undefined = webSessions.get(sessionID)
                if (!slc) {
                    console.log("_main.updateSystemLifecycle(): switch case dropped: no system lifecycle for sessionID =" + sessionID)
                    return
                }
                webSessions.delete(sessionID)
                slc.system  = undefined    
                slc.dropped = new Date()
                if (debugAutoDrop) console.log("_main.updateSystemLifecycle(): system dropped. SessionID= " + sessionID)
                break }
            default: {
                console.log("_main.updateSystemLifecycle(): action unknown =" + action + "; SessionID= " + sessionID)
            }
        } 
    }

    type WebSessions = Map<CookieSessionId, SystemLifecycle>

    function autoDropApparentlyAbandonedSystems(webSessions: WebSessions): void {
        type NumSessionsByLifecycleState = {
            initializedOnly:            number
            inititalizedAndIterated:   number
            dropped:                    number
        }
        function numSessionsByLifecycleState(webSessions: WebSessions): NumSessionsByLifecycleState {
            const mapAsArrayofKeyValueTuples = Array.from(webSessions)
            return {
                initializedOnly:            mapAsArrayofKeyValueTuples.filter(([_, sysLc]) => sysLc.created && !sysLc.lastUsed).length,
                inititalizedAndIterated:    mapAsArrayofKeyValueTuples.filter(([_, sysLc]) => sysLc.lastUsed).length,
                dropped:                    mapAsArrayofKeyValueTuples.filter(([_, sysLc]) => sysLc.dropped).length
            }
        } 

        if (debugAutoDrop) {
            const _numSessionsByLifecycleState = numSessionsByLifecycleState(webSessions)         
            console.log(`${debugTime()} _main: autoDropApparentlyAbandonedSystems(): autoDroppingIsInAction = ${autoDroppingIsInAction}; #sessions=${webSessions.size}: only initialized=${_numSessionsByLifecycleState.initializedOnly}, iterated=${_numSessionsByLifecycleState.inititalizedAndIterated}, dropped=${_numSessionsByLifecycleState.dropped}`)
        } 
        autoDroppingIsInAction  = true 
        // check and sweep apparently abandoned sessions
        for (let [sessionID, sysLifecycle] of webSessions.entries()) {
            const lastActionTime: Minutes = (Math.round (Math.max(sysLifecycle.created  ? sysLifecycle.created.getTime()  : -1, 
                                                                  sysLifecycle.lastUsed ? sysLifecycle.lastUsed.getTime() : -1)) / 60000)
            if (lastActionTime <= 0) {
                console.log("_main: autoDropApparentlyAbandonedSystems(): found entry in webSessions map that had neither a created nor a lastUsed timestamp!?!")
                continue
            }
            if ((Date.now() / 60000) - lastActionTime > autoDropThreshold) 
                updateSystemLifecycle(webSessions, sessionID, LifeCycleActions.dropped)
        }
        // check if any active sessions left; if so then schedule the next autoDropApparentlyAbandonedSystems() run
        for (let sysLifecycle of webSessions.values())
            if (sysLifecycle.system) { // if at least one still active system instance found  
                setTimeout(autoDropApparentlyAbandonedSystems, autoDropCheckInterval * 60000, webSessions) // continue checking the map in intervals ...
                autoDroppingIsInAction = true    
                if (debugAutoDrop) console.log(`${debugTime()} _main: autoDropApparentlyAbandonedSystems(): next check is scheduled and continued ...`)
                return
            }
        // no longer any active system instance; turn auto dropping off
        autoDroppingIsInAction  = false   
        console.log(`${debugTime()} _main: autoDropApparentlyAbandonedSystems(): not continued`)
    }
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
