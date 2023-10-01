//----------------------------------------------------------------------
//    LOGGING 
//----------------------------------------------------------------------
import { Timestamp } from './clock.js'
//24.9 import { clock } from './_main.js'
import { LonelyLobsterSystem } from './system.js'

export enum LogEntryType {
    workItemMovedTo   = "movedTo",
    workItemWorkedOn  = "workedOn",
    workerWorked      = "workerWorked"
}

export abstract class LogEntry { // records state at end of time unit
    public timestamp: Timestamp
    constructor (
        public sys: LonelyLobsterSystem,
        public logEntryType: LogEntryType) {  
        this.timestamp = sys.clock.time
    }

    public abstract stringified: () => string
    public stringifiedLe = (): string => `t = ${this.timestamp}` 
}
