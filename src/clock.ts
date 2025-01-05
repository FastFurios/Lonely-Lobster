//----------------------------------------------------------------------
/**
 * CLOCK & TIME 
 */
 //----------------------------------------------------------------------
// last code cleaning: 04.01.2025

import { LonelyLobsterSystem } from "./system"
import { Timestamp, TimeUnit } from './io_api_definitions'

/** intervall by which time progresses in the clock */
const timeUnit: TimeUnit = 1

//----------------------------------------------------------------------
/**
 *  CLOCK
 */  
//----------------------------------------------------------------------

/** provides the clock time to the Lonely Lobster system instances; every instance runs its own clock; time progresses in descrete TimeUnit steps */
export class Clock {
    /** current time
     * @example -1 when starting setup of a system instance
     * @example 0 after initialization incl. first empty iteration finished
     * @example >=1 after further iterations 
     */
    public time: Timestamp

    constructor(public sys: LonelyLobsterSystem,
                /** time when initialization starts */
                public startTime: Timestamp = -1) { 
        this.time = startTime
    }

    /** timestamp after first iteration i.e. after initialization finished */
    get firstIteration() { return this.startTime + 1 }

    /** set clock time to @param time */
    public setTo = (time: Timestamp): void => { 
        if(this.sys.debugShowOptions.clock) console.log("\n---- new time is " + time + " -----------------------------------------------\n")
        this.time = time
        return 
    } 

    /** progress time by timeUnit */
    public tick(): Timestamp {
        this.time += timeUnit
        return this.time            
    }
}
