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
    workItemMoved                     = "moved",
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

    constructor (public timestamp:    Timestamp,
                 public logEntryType: LogEntryType) {  
    }

    public abstract toString: () => string

    public stringifiedLe = (): string => `t = ${this.timestamp} ${this.logEntryType}` 
}
