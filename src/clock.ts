//----------------------------------------------------------------------
//    CLOCK / TIME 
//----------------------------------------------------------------------

import { LonelyLobsterSystem } from "./system"
import { Timestamp, TimeUnit } from './io_api_definitions'

const timeUnit: TimeUnit = 1

//----------------------------------------------------------------------
// CLOCK 
//----------------------------------------------------------------------

export class Clock {
    public time: Timestamp

    constructor(public sys: LonelyLobsterSystem,
                public startTime: Timestamp = 0) { 
        this.time = startTime
    }

    get firstIteration() { return this.startTime + 1 }

    public setTo = (time: Timestamp): void => { 
        if(this.sys.debugShowOptions.clock) console.log("\n---- new time is " + time + " -----------------------------------------------\n")
        this.time = time
        return 
    } 

    public tick(): Timestamp {
        this.time += timeUnit
        return this.time            
    }
}
