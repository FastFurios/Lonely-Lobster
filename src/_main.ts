// ########################################################################################################
//                                  LONELY LOBSTER
// a simulation of colaboration of workers in a company with multiple value chains
//      depending upon individual worker's strategies what to work on next 
//                          Gerold Lindorfer, Dec 2022 ff.
// ########################################################################################################

//-------------------------------------------------------------------
/** 
 * _MAIN - server main program
 */
//-------------------------------------------------------------------
// last code cleaning: 04.01.2025

import express, { NextFunction } from 'express';
import session  from "express-session"
import cors     from "cors"

import passport from 'passport'
import { BearerStrategy, IBearerStrategyOption, ITokenPayload } from 'passport-azure-ad'
import { VerifyCallback } from 'jsonwebtoken'
import pkg from 'jsonwebtoken'; const { JsonWebTokenError } = pkg;

import { environment } from './environment.js'

import { systemCreatedFromConfigJson, systemCreatedFromConfigFile } from './io_config.js'
import { ApplicationEvent, EventSeverity, EventTypeId } from './io_api_definitions.js'
import { LonelyLobsterSystem } from './system.js'
import { processWorkOrderFile } from './io_workload.js'

/**
 * comand line arguments
 */ 
enum InputArgs {
    /** "--batch" or "--api" */
    "Mode"              = 2,
    /** system configuration file */
    "SystemConfig"      = 3,
    /** file of workorders to be fed into the value chains */
    "WorkOrders"        = 4
}
//console.log("argv[2]=" + process.argv[2] + ", " + "argv[3]=" + process.argv[3] + ", " + "argv[4]=" + process.argv[4] + "\n")

/** 
 * for API mode only: add at least one user property in the session data that I can change so express-session knows to set a session cookie in the response from then on 
 */
declare module "express-session" { // expand the type of the session data by my indicator that a Lonely Lobster session exists  
    interface SessionData {
        hasLonelyLobsterSession: boolean //https://stackoverflow.com/questions/43367692/typescript-method-on-class-undefined
    }
}

// -------------------------------------------------------------------
/**
 *  DEBUG settings
 */  
// -------------------------------------------------------------------

const debugApiCalls         = false
const debugAuthentication   = false
const debugAutoDrop         = false

/** printing debug logging timestamp as hh:mm:ss  */
const debugTime = (): string => new Date().toTimeString().split(" ")[0]

// -------------------------------------------------------------------
/**
 * SHOW HELP
 */ 
// -------------------------------------------------------------------
function showManual(): void {
    console.log("Run it in one of 2 modes:")
    console.log("$ node target/_main.js --batch <system-config-file> <work-order-file>")
    console.log("$ node target/_main.js --api &")
}

// -------------------------------------------------------------------
/**
 * BATCH MODE
 */ 
// -------------------------------------------------------------------
function batchMode(): void {
    console.log("Running in batch mode ...")

    // create the system from the config JSON file
    let lonelyLobsterSystem = systemCreatedFromConfigFile(process.argv[InputArgs.SystemConfig])
    processWorkOrderFile(process.argv[InputArgs.WorkOrders], lonelyLobsterSystem)
}

// -------------------------------------------------------------------
/**
 * API MODE
 */ 
// -------------------------------------------------------------------
function apiMode(): void {
    console.log("Running in api mode ...")

    const app  = express()
    const port = process.env.PORT || 3000

    /** cors settings for runnning on local machine */
    app.use(cors({  origin: ["http://localhost:4200" /* Anglar Frontend */, "http://localhost:3000" /* Lonely Lobster Backend */], // allow request from specific origin domains (* would do it for all origin, hoiwever credentials require explicit origins here): https://www.section.io/engineering-education/how-to-use-cors-in-nodejs-with-express/
        credentials: true })) // allow credentials, in this case the session cookie to be send to the Angular client  

    // ---- Passport --------------------------------------
    /** set up passport with Azure Entra ID token: settings, connection URLs, ... */    
    const options: IBearerStrategyOption = {
        identityMetadata:   "https://login.microsoftonline.com/49bf30a4-54b2-47ae-b9b1-ffa71ed3d475/v2.0/.well-known/openid-configuration",  // == Azure AD: directory (tenant) ID 
        clientID:           "api://5797aa9c-0703-46d9-9fba-934498b8e5d6", // == Azure AD: for the backend: manage / expose an API: Application ID URI  
        issuer:             "https://sts.windows.net/49bf30a4-54b2-47ae-b9b1-ffa71ed3d475/",   // use tenant ID
        audience:           "api://5797aa9c-0703-46d9-9fba-934498b8e5d6", // == Azure AD: for the backend: manage / expose an API: Application ID URI
        validateIssuer:     true,       // Validate the issuer of the token
        loggingLevel:       "error",    // optional: logging level for passport-azure-ad
        loggingNoPII:       true        // optional: hide sensitive data in log; if false log shows more details
    }

    /** verify scope of Azure Entra ID token if it allows to run the Lonely Lobster system (instance) */    
    function verifyToken(token: ITokenPayload, done: VerifyCallback) {
        if (token.scp != "system.run")
            return done(new JsonWebTokenError("not authorized: wrong scope requested"), token)
        return done(null, token) // If everything is OK, return the user object
    }

    /** add passport middleware to Express stack */    
    passport.use(
        new BearerStrategy( options, 
                            (token: ITokenPayload, done: VerifyCallback): void  => { verifyToken(token, done) }))
    app.use(passport.initialize())

    /** Passport middleware to authenticate requests using the Bearer strategy */
    const authenticateAzureAD = passport.authenticate('oauth-bearer', { session: false });  // "oauth-bearer" is a defined string by passport; do not confuse with the "Bearer" prefix to the token sent by the frontend  

    // ---- end Passport --------------------------------------

    /** parse application/json */
    app.use(express.json())
    /** parse application/x-www-form-urlencoded */
    app.use(express.urlencoded({ extended: true })) 

    /** configure session-express */ 
    app.use(session({
        secret: 'my-secret',        // a secret string used to sign the session ID cookie
        resave: false,              // don't save session if unmodified
        saveUninitialized: false    // don't create session until something stored
    }))
    /** set up API sessions store */               
    type CookieSessionId = string
    /** @enum */
    type SystemLifecycle = {
        /** system instance if any */
        system?:    LonelyLobsterSystem
        /** when the system instance was brought to life */
        created:    Date
        /**  when the system instance was called the last time */
        lastUsed?:  Date
        /**  when the system instance was dropped due too long inactive */
        dropped?:   Date
    }
    /** map that maps session cookies to a system life cycle object */
    type WebSessions  = Map<CookieSessionId, SystemLifecycle>
    const webSessions: WebSessions = new Map<CookieSessionId, SystemLifecycle>()  

    //------------------------------
    /**
     * SERVE ANGULAR FRONTEND 
     */
    //------------------------------
    /** add route to the Lonely Lobster Angular dist package which is served to the client browser  */
    app.use(express.static("frontend"))

    //------------------------------
    /**
     * API call - INITIALIZE  
     * add route to the Lonely Lobster Angular dist package which is served to the client browser  
     */ 
    //------------------------------
    app.post('/initialize', authenticateAzureAD, (req, res, next) => {
        if (debugApiCalls) console.log(`\n${debugTime()} _main: app.post /initialize -------- webSession = ${req.sessionID} ----------------------------`)
        if (debugAuthentication) console.log("\n_main: app.post /initialize: req.headers.authorization= " + req.headers.authorization)

        // build the system
        let lonelyLobsterSystem: LonelyLobsterSystem
        try {
            lonelyLobsterSystem = systemCreatedFromConfigJson(req.body) 
        } catch(exception) {
            next(applicationEventFrom("_main/initialize", mask(req.sessionID), EventTypeId.configCorrupt, EventSeverity.critical, (<Error>exception).message))
            return // dead line of code but that way the compiler realized that lonelyLobsterSystem is definitely already created below this code block      
        }
        updateSystemLifecycle(webSessions, req.sessionID, LifeCycleActions.created, lonelyLobsterSystem)
        if (!autoDroppingIsInAction) autoDropApparentlyAbandonedSystems(webSessions) // if not yet active activate auto dropping of abandoned system instances
        if (debugAutoDrop) console.log(`${debugTime()} _main(): app.post /initialize: webSession = ${req.sessionID}; Lonely-Lobster System ist defined= ${lonelyLobsterSystem != undefined}; name= ${lonelyLobsterSystem.id}`)
            // handle web session
        req.session.hasLonelyLobsterSession = true // set the "change indicator" in the session data: once the state of this property changed, express-session will now keep the sessionID constant and send it to the client

        // initialize system
        lonelyLobsterSystem.clock.setTo(-1) // -1 = system is set up but has not yet done an initial iteration; 0 = first empty iteration to produce systemState for the front end; 1 = first real iteration triggered by user
        res.status(201).send(lonelyLobsterSystem.nextSystemState(lonelyLobsterSystem.emptyIterationRequest()))
    })

    //------------------------------
    /**
     * API call - ITERATE
     * calculate the next state of the system instance
     */
    //------------------------------
    app.post('/iterate', authenticateAzureAD, (req, res, next) => {
        // if (debugApiCalls) console.log(`\n${debugTime()} _main: app.post /iterate -------- webSession = ${req.sessionID} ----------------------------`)
        console.log(`\n${debugTime()} _main: app.post /iterate -------- webSession = ${req.sessionID} ----------------------------`)
            try {       
            // handle web session
            const lonelyLobsterSystemLifecycle = webSessions.get(req.sessionID)
            if (!lonelyLobsterSystemLifecycle?.system) { 
                if (debugApiCalls) console.log("_main(): app.post /iterate: could not find a LonelyLobsterSystem for webSession = " + req.sessionID)
                next(applicationEventFrom("_main/iterate", mask(req.sessionID), EventTypeId.sessionNotFound, EventSeverity.critical))
                return
            }
            updateSystemLifecycle(webSessions, req.sessionID, LifeCycleActions.used)
            if (!autoDroppingIsInAction) autoDropApparentlyAbandonedSystems(webSessions)

            // return next system state to frontend
            res.status(200).send(lonelyLobsterSystemLifecycle.system.nextSystemState(req.body))
        } catch(exception) {
            next(applicationEventFrom("_main/iterate", mask(req.sessionID), EventTypeId.configCorrupt, EventSeverity.critical, (<Error>exception).message))
            console.log(<Error>exception)
            return // dead line of code but that way the compiler realized that lonelyLobsterSystem is definitely defined below this code block      
        }
    })

    //-------------------------------------
    /** 
     * API call - provide SYSTEM STATISTICS
     * calculate the statistics for the system instance
     */
    //-------------------------------------
    app.get('/statistics', authenticateAzureAD, (req, res, next) => {
//        if (debugApiCalls) console.log(`\n${debugTime()} _main: app.get /statistics -------- webSession = ${req.sessionID} ----------------------------`)
        console.log(`\n${debugTime()} _main: app.get /statistics -------- webSession = ${req.sessionID} ----------------------------`)
        try {       
            // handle web session
            const lonelyLobsterSystemLifecycle = webSessions.get(req.sessionID)
            if (!lonelyLobsterSystemLifecycle?.system) { 
                if (debugApiCalls) console.log("_main(): app.post /system statistics: could not find a LonelyLobsterSystem for webSession = " + req.sessionID)
                next(applicationEventFrom("_main/statistics", mask(req.sessionID), EventTypeId.sessionNotFound, EventSeverity.critical))
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
        } catch(exception) {
            next(applicationEventFrom("_main/statitsics", mask(req.sessionID), EventTypeId.configCorrupt, EventSeverity.critical, (<Error>exception).message))
            return // dead line of code but that way the compiler realized that lonelyLobsterSystem is definitely defined below this code block      
        }
    })

    //-------------------------------------
    /**
     * API call - provide WORKITEM EVENTS
     * fetch all lifecycle events of all workitems in a system instance
     */ 
    //-------------------------------------
    app.get('/workitem-events', authenticateAzureAD, (req, res, next) => {
        if (debugApiCalls) console.log(`\n${debugTime()} _main: app.get /workitem-events -------- webSession = ${req.sessionID} ----------------------------`)
        try {
            // handle web session
            const lonelyLobsterSystemLifecycle = webSessions.get(req.sessionID) // webSessions.values().next().value
            if (!lonelyLobsterSystemLifecycle?.system) { 
                if (debugApiCalls) console.log("_main(): app.post /system workitem-events: could not find a LonelyLobsterSystem for webSession = " + req.sessionID)
                next(applicationEventFrom("_main/workitem-events", mask(req.sessionID), EventTypeId.sessionNotFound, EventSeverity.critical))
                return
            }            
            updateSystemLifecycle(webSessions, req.sessionID, LifeCycleActions.used)
            if (!autoDroppingIsInAction) autoDropApparentlyAbandonedSystems(webSessions)

            // return workitem events to frontend
            res.status(200).send(lonelyLobsterSystemLifecycle.system.allWorkitemLifecycleEvents)
        } catch(exception) {
            next(applicationEventFrom("_main/workitem-events", mask(req.sessionID), EventTypeId.configCorrupt, EventSeverity.critical, (<Error>exception).message))
            return // dead line of code but that way the compiler realized that lonelyLobsterSystem is definitely defined below this code block      
        }
    })

    //-------------------------------------
    /**
     * API call - provide LEARNING STATISTICS
     * i.e. workitem selection strategies realtive weights of workers over time in a system instance 
     */
    //-------------------------------------
    app.get('/learn-stats', authenticateAzureAD, (req, res, next) => {
        if (debugApiCalls) console.log(`\n${debugTime()} _main: app.get /learning statistics -------- webSession = ${req.sessionID} ----------------------------`)
        try {
            // handle web session
            const lonelyLobsterSystemLifecycle = webSessions.get(req.sessionID)
            if (!lonelyLobsterSystemLifecycle?.system) { 
                if (debugApiCalls) console.log("_main(): app.post /learning statistics: could not find a LonelyLobsterSystem for webSession = " + req.sessionID)
                next(applicationEventFrom("_main/learn-stats", mask(req.sessionID), EventTypeId.sessionNotFound, EventSeverity.critical))
                return
            }            
            updateSystemLifecycle(webSessions, req.sessionID, LifeCycleActions.used)
            if (!autoDroppingIsInAction) autoDropApparentlyAbandonedSystems(webSessions)

            // return workers' selection strategies learning statistics to frontend
            res.status(200).send(lonelyLobsterSystemLifecycle.system.learningStatistics)
        } catch(exception) {
            next(applicationEventFrom("_main/learn-stats", mask(req.sessionID), EventTypeId.configCorrupt, EventSeverity.critical, (<Error>exception).message))
            return // dead line of code but that way the compiler realized that lonelyLobsterSystem is definitely defined below this code block      
        }
    })

    //-------------------------------------
    /**
     * API call - DROP system
     * explicitely drop the system instance
     */
    //-------------------------------------
    app.get('/drop', authenticateAzureAD, (req, res, next) => {
        if (debugApiCalls) console.log(`\n${debugTime()} _main: app.get /drop system -------- webSession = ${req.sessionID} ----------------------------`)
        // handle web session
        try {
            const lonelyLobsterSystemLifecycle = webSessions.get(req.sessionID)
            if (!lonelyLobsterSystemLifecycle?.system) { 
                if (debugApiCalls) console.log("_main(): app.post /drop system: could not find a LonelyLobsterSystem for webSession = " + req.sessionID)
                next(applicationEventFrom("_main/drop", mask(req.sessionID), EventTypeId.sessionNotFound, EventSeverity.critical))
                return
            }            
            updateSystemLifecycle(webSessions, req.sessionID, LifeCycleActions.dropped)

            // return workers' selection strategies learning statistics to frontend
            res.status(200).send()
        } catch(exception) {
            next(applicationEventFrom("_main/drop", mask(mask(req.sessionID)), EventTypeId.configCorrupt, EventSeverity.warning, (<Error>exception).message))
            return // dead line of code but that way the compiler realized that lonelyLobsterSystem is definitely defined below this code block      
        }
    })

    //-------------------------------------
    /**
     * ERROR HANDLING middleware
     * central Express error handler
     */
    //-------------------------------------

    /** mask a string but the last 4 characters
     * @param s - the string to be masked
     * @returns the masked string 8 characters long
     */
    function mask(s: string): string {
        return "****" + s.slice(-4)
    }

    /** create an Lonely Lobster aplication event
     * @param at - approximate location in the code
     * @param moreContext - additional context
     * @param typeId - application event type
     * @param sev - severity
     * @param desc - description
     * @returns - application event
     */
    function applicationEventFrom(at: string, moreContext: string, typeId: EventTypeId, sev: EventSeverity, desc?: string): ApplicationEvent {
        return {
            dateAndtime:    new Date(),
            source:         "backend",
            sourceVersion:  environment.version,
            severity:       sev,
            typeId:         typeId,
            description:    desc ? desc : typeId,  // use detail description or if not available then standard text of event type
            context:        `${at}: ${moreContext}`
        }
    }

    /** map application events to http status error codes */
    type HttpStatusCode = number
    const eventTypeIdToHttpStatusCodes = new Map<EventTypeId, HttpStatusCode>([
        [EventTypeId.authorizationError,    403],
        [EventTypeId.configFileNotFound,    404],
        [EventTypeId.configCorrupt,         500],
        [EventTypeId.valueOutOfRange,       500],
        [EventTypeId.sessionNotFound,       500]
    ])
    /**
     * map application events to http status error codes
     * @param eti - application event type 
     * @returns http status error code
     */
    function httpStatusCodeFrom(eti: EventTypeId): HttpStatusCode {
        return eventTypeIdToHttpStatusCodes.get(eti) || 500
    }

    app.use((err: any, req: any, res: any, next: NextFunction) => {
        if (debugApiCalls) console.error("Gerolds error handling middleware: "); // Log the error for debugging purposes
        if (debugApiCalls) console.error(err)
        // Set the status code and send a generic error message to the client
        res.status(httpStatusCodeFrom(err.typeId)).json(err)
    })

    //---------------------------------
    /** listening for incoming API calls  */ 
    //---------------------------------
    app.listen(port, () => {0
        return console.log(`Express is listening at http://localhost:${port}`)
    })

    //---------------------------------
    /** garbage collection: clean-up apparently abandoned Lonely-Lobster system instances (allow node.js garbage collection free the memory for unused system instances) */
    //---------------------------------

    type Minutes                                = number
    const autoDropCheckInterval: Minutes        = 1
    const autoDropThreshold: Minutes            = 2
    enum LifeCycleActions { created, used, dropped }
    let autoDroppingIsInAction                  = false  // global "semaphore"

    /**
     * update lifecycle data of the systen instance
     * @param webSessions - session and associated life cycle data incl. the system instance 
     * @param sessionID - session ID
     * @param action - life cycle event 
     * @param createdSys - the created system instance
     * @returns nothing
     */
    function updateSystemLifecycle(webSessions: WebSessions, sessionID: string, action: LifeCycleActions, createdSys?: LonelyLobsterSystem): void {
        switch (action) {
            case LifeCycleActions.created: { 
                webSessions.set(sessionID, { system: createdSys, created: new Date() })
                break 
            }
            case LifeCycleActions.used: { 
                const slc: SystemLifecycle | undefined = webSessions.get(sessionID)
                if (!slc) {
                    if (debugAutoDrop) console.log("_main.updateSystemLifecycle(): switch case lastUsed: no system lifecycle for sessionID =" + sessionID)
                    return
                }
                slc.lastUsed = new Date()
                break 
            }
            case LifeCycleActions.dropped: {
                const slc: SystemLifecycle | undefined = webSessions.get(sessionID)
                if (!slc) {
                    if (debugAutoDrop) console.log("_main.updateSystemLifecycle(): switch case dropped: no system lifecycle for sessionID =" + sessionID)
                    return
                }
                webSessions.delete(sessionID)
                slc.system  = undefined    
                slc.dropped = new Date()
                if (debugAutoDrop) console.log("_main.updateSystemLifecycle(): system dropped. SessionID= " + sessionID)
                break 
            }
            default: {
                if (debugAutoDrop) console.log("_main.updateSystemLifecycle(): action unknown =" + action + "; SessionID= " + sessionID)
            }
        } 
    }

    /**
     * drop i.e. garbage collect system instances not called for a long time
     * @param webSessions 
     * @returns nothing
     */
    function autoDropApparentlyAbandonedSystems(webSessions: WebSessions): void {
        type NumSessionsByLifecycleState = {
            initializedOnly:            number
            inititalizedAndIterated:   number
            dropped:                    number
        }
        /** calculate the number of web session in the life cycle states */
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
                if (debugAutoDrop) console.log("_main: autoDropApparentlyAbandonedSystems(): found entry in webSessions map that had neither a created nor a lastUsed timestamp!?!")
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
        if (debugAutoDrop) console.log(`${debugTime()} _main: autoDropApparentlyAbandonedSystems(): not continued`)
    }
}

// -------------------------------------------------------------------
/**
 *  CHOOSE MODE
 */ 
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
