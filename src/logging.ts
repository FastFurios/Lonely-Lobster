//----------------------------------------------------------------------
//    LOGGING 
//----------------------------------------------------------------------
import { Timestamp } from './io_api_definitions'
import { LonelyLobsterSystem } from './system.js'

export enum LogEntryType {
    workItemMovedTo                   = "movedTo",
    workItemWorkedOn                  = "workedOn",
    workerWorked                      = "workerWorked",
    workerLearnedAndAdapted           = "workerLearnedAndAdapted",
    wipLimitsVector                   = "WIP limit vector",
    wipLimitsAndPerformance           = "system WIP limits and performance"
}

export abstract class LogEntry { // records state at end of time unit
    public timestamp: Timestamp
    constructor (
        public sys: LonelyLobsterSystem,
        public logEntryType: LogEntryType) {  
        this.timestamp = sys.clock.time
    }

    public abstract stringified: () => string
    public stringifiedLe = (): string => `t = ${this.timestamp} ${this.logEntryType}` 
}
