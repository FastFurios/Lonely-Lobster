// ------------------------------------------------------------
/** 
 * LOGGING - central definitions for system internal logging of events e.g. for work items and workers
 */
// ------------------------------------------------------------
// last code cleaning: 04.01.2025

import { Timestamp } from './io_api_definitions'
import { LonelyLobsterSystem } from './system.js'

/** log entry types in a Lonely Lobster system */
export enum LogEntryType {
    workItemMovedTo                   = "movedTo",
    workItemWorkedOn                  = "workedOn",
    workerWorked                      = "workerWorked",
    workerLearnedAndAdapted           = "workerLearnedAndAdapted",
    wipLimitsVector                   = "WIP limit vector",
    wipLimitsOptimization             = "system WIP limits and performance"
}

/**
 * common defintions of all log types
 */
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
