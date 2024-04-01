
//----------------------------------------------------------------------------
// MULTIDIMENSIONAL SEARCH FOR OPTIMUM 
//----------------------------------------------------------------------------

import { randomPick } from './helpers.js'
import { Timestamp } from './io_api_definitions.js'
import { LogEntry, LogEntryType } from './logging.js'
import { LonelyLobsterSystem } from './system.js'


//----------------------------------------------------------------------------
// MULTIDIMENSIONAL SEARCH FOR OPTIMUM 
//----------------------------------------------------------------------------

export type infinite = undefined

export enum StringifyMode {
    concise,
    verbose
}

interface Stringify {
    toString: (mode?: StringifyMode) => string
}

type VectorDimensionOperationResult = {
    result:     number      // resulting new value of a dimension 
    rebound:    boolean     // indicates if jump was rebound at boundary
}

type VectorOperationResult<T extends Stringify> = {
    position:   Position<T>
    rebound:    boolean
}

// --- VECTOR DIMENSION MAPPER --------------------------------------------------------------------

export class VectorDimension<T extends Stringify> {
    constructor(public dimension: T, 
                public min:       number | infinite,        // boundary für dimension values
                public max:       number | infinite ) { }   // boundary für dimension values

    toString(mode?: StringifyMode): string {
        return `${this.dimension.toString(mode)} from ${this.min} to ${this.max}`
    }
}

export class VectorDimensionMapper<T extends Stringify> {  // maps object references to dimensions in a vector 
    constructor(public vds: VectorDimension<T>[]) { }

    public vectorDimension(idx: number): VectorDimension<T> { 
        return this.vds[idx] 
    }

    public vectorDimensionIndex(dim: T): number { 
        return this.vds.findIndex(vd => vd.dimension == dim) 
    }

    get length() { 
        return this.vds.length
    }

    public toString(mode: StringifyMode): string {
        return `${this.vds.map(vd => vd.toString(mode))}\n`
    }

}

// --- VECTOR --------------------------------------------------------------------

class Vector<T extends Stringify> {
    constructor(public vdm: VectorDimensionMapper<T>, public vec: number[]) {
        if (vec.length != vdm.length) throw Error("Class Vector.constructor: mismatching number of vector dimensions")
    }

    public isEqual(v: Vector<T>): boolean {
        return this.toString(StringifyMode.concise) == v.toString(StringifyMode.concise)
    }

    public dimHandledRebound(idx: number, to: number): VectorDimensionOperationResult {
        if (this.vdm.vectorDimension(idx).min != undefined) {
            if (to < this.vdm.vectorDimension(idx).min!) {
                return { result:  2 * this.vdm.vectorDimension(idx).min! - to,
                         rebound: true }
            }
        }
        if (this.vdm.vectorDimension(idx).max != undefined) {
            if (to > this.vdm.vectorDimension(idx).max!) { 
                return { result:  2 * this.vdm.vectorDimension(idx).max! - to,
                         rebound: true } 
            }
        }
    	return { result: to, rebound: false }
    }

    private dimPlus(idx: number, v: Vector<T>): VectorDimensionOperationResult {
        const r: number = this.vec[idx] + v.vec[idx] 
        return this.dimHandledRebound(idx, r)
    }

    public plus(v: Direction<T>): VectorOperationResult<T> {
        const vdors: VectorDimensionOperationResult[] = this.vec.map((_, idx) => this.dimPlus(idx, v))
        return { position: new Position<T>(this.vdm, vdors.map(vdor => vdor.result)),
                 rebound:  vdors.map(vdor => vdor.rebound).reduce((a, b) => (a || b), false) }
    }

    public toString(mode?: StringifyMode): string {
        return mode == StringifyMode.concise ? `[${this.vec}]` 
                                             : this.vec.map((val, idx) => `${this.vdm.vectorDimension(idx).dimension.toString()}: ${val}`).reduce((a, b) => `${a}, ${b}`)
    }
}

// --- POSITION --------------------------------------------------------------------
export class Position<T extends Stringify> extends Vector<T> {
    constructor(vdm: VectorDimensionMapper<T>, vec: number[]) {
        super(vdm, vec)
    }
}

// --- DIRECTION --------------------------------------------------------------------
const randomizeDirectionRetries = 5

export class Direction<T extends Stringify> extends Vector<T> {
    constructor(vdm: VectorDimensionMapper<T>, vec: number[]) { 
        super(vdm, vec) 
    }

    private inverted(): Direction<T> {
        return new Direction<T>(this.vdm, this.vec.map(vd => -vd))
    }

    public stretchedBy(stretchFactor: number): Direction<T> {
        return new Direction<T>(this.vdm, this.vec.map((vd, idx) => Math.round(vd * stretchFactor)))
    }

    public newRandomDirection(): Direction<T> {
        let newDirVec = new Direction<T>(this.vdm, Array(this.vdm.length))
        for (let attempts = 0; attempts < randomizeDirectionRetries; attempts++) {
            for (let vd = 0; vd < this.vdm.length; vd++) {
                const r = Math.random()
                newDirVec.vec[vd] = r < 0.34 ? -1 : r < 0.66 ? 0 : 1 
            }
            if (!newDirVec.isEqual(this) && !newDirVec.isEqual(this.inverted())) 
                break  // have a new direction differing from the current direction or its reverse
        }
        // failsave if no dimension has a value != 0: set a value for one random dimension:
        if (newDirVec.vec.reduce((a, b) => Math.abs(a) + Math.abs(b)) == 0) {
            newDirVec.vec[randomPick<number>(newDirVec.vec)] = Math.random() < 0.5 ? -1 : 1
        }
        console.log("Motion.newRandomDirection: vec = " + newDirVec)
        return newDirVec
    }
}

// --- SEARCH LOG --------------------------------------------------------------------

export class SearchLogEntry<T extends Stringify> {
    constructor(public timestamp:           number,
                public position:            Position<T>,
                public direction:           Direction<T>,
                public jumpDistance:        number,
                public performance:         number,
                public temperature:         number,
                public downhillStepCount:   number,
                public bestPerfLogEntry:    SearchLogEntry<T> | undefined) { 
    }

    public toString(): string {
        return `${this.timestamp} [${this.position.vec}]:\t perf= ${this.performance} \ttemp= ${this.temperature} \tdir= [${this.direction.vec}] \tjumpDist=${Math.round(this.jumpDistance)} \tdownSteps= ${Math.round(this.downhillStepCount)} \tbest past position= ${this.bestPerfLogEntry?.position.toString(StringifyMode.concise)} with perf= ${this.bestPerfLogEntry?.performance}`
    }

    public stringified = (): string => this.toString()
}

export class SearchLog<T extends Stringify> {
    log: SearchLogEntry<T>[] = []
    constructor() { }

    public append(le: SearchLogEntry<T>) {
        this.log.push(le)
    } 

    get last(): SearchLogEntry<T> | undefined {
        return this.log.length < 1 ? undefined : this.log[this.log.length - 1]
    }

    get secondLast(): SearchLogEntry<T> | undefined {
        return this.log.length < 2 ? undefined : this.log[this.log.length - 2]
    }

    get entryWithBestObservedPerformance(): SearchLogEntry<T> | undefined { // checks all log entries of last visits to every position and returns the one with highest performance
        const lastPositionVisitsMap = new Map<string, SearchLogEntry<T>>()
        let lpv: SearchLogEntry<T> | undefined
        for (let le of this.log) {
            lpv = lastPositionVisitsMap.get(le.position.toString(StringifyMode.concise))
            if (lpv == undefined || le.timestamp > lpv.timestamp) 
                lastPositionVisitsMap.set(le.position.toString(StringifyMode.concise), le)
        }                                                                                                                                                           //; if (psp.verbose) [...lastPositionVisitsMap].sort((a, b) => a[1].time - b[1].time).forEach(e => console.log(`\t\t${e[1].toString(true)}`))
        const lastPositionVisitsLesArr: SearchLogEntry<T>[] | undefined = [...lastPositionVisitsMap.entries()].map(e => e[1])
        const bestPerformance: number = Math.max(...lastPositionVisitsLesArr.map(le => le.performance)) 
        const lastPositionVisitsLesWithBestPerfArr: SearchLogEntry<T>[] | undefined = lastPositionVisitsLesArr.filter(le => le.performance == bestPerformance )
        return randomPick<SearchLogEntry<T>>(lastPositionVisitsLesWithBestPerfArr)
    }

    public toString(): string {
        return this.log.map(le =>`${le.toString()}`).reduce((a, b) => `${a}\n${b}`) 
    }
}

//--------------------------------------
// SEARCH FOR MAXIMUM 
//--------------------------------------

type Number0to1                         = number
type Temperature                        = number // as in "Simulated Annealing"
type Tolerance                          = number // the higher the temperature the higher the tolerance for continued downhill steps 
type DegreesPerDownhillStepTolerance    = number // e.g. 20 = for every 20 degree of cooling it tolerates 1 step downhill less

export type PeakSearchParms = {    // parameter set for the search algorithm 
    initTemperature:                 Temperature                        // initial temperature; need to be > 0
    temperatureCoolingGradient:      Temperature                        // cooling with every search iteration
    onLevelPatience:                 Number0to1                         // chance that a move on same level is accepted
    degreesPerDownhillStepTolerance: DegreesPerDownhillStepTolerance    // downhill step sequences tolerance
    initJumpDistance:                number                             // jump distances in choosen direction; reduces when temperature cools
    verbose:                         boolean                            // outputs debug data if true
}

export type SearchState<T extends Stringify> = {
    position:           Position<T>,
    direction:          Direction<T>,
    temperature:        Temperature,
    downhillStepsCount: number
}

// --- SEARCH ALGORITHM --------------------------------------------------------------------

export function nextSearchState<T extends Stringify> (
            log:                SearchLog<T>,
            performanceAt:      (p: Position<T>) => number, 
            psp:                PeakSearchParms,
            timestamp:          Timestamp,
            curr:               SearchState<T>       ): SearchState<T> {

    const jumpDistance      = (temp: Temperature): number => Math.max(1, (psp.initJumpDistance * temp / psp.initTemperature))
    const downhillTolerance = (temp: Temperature, dpdhst: DegreesPerDownhillStepTolerance): Tolerance =>  Math.floor(temp / dpdhst)

    const perf                  = performanceAt(curr.position)                                                                                                                          
    const jumpDist              = jumpDistance(curr.temperature)                                                                                                    ; if (psp.verbose) console.log(`\n\ntime=${timestamp}\t${curr.position.toString(StringifyMode.concise)} with perf= ${perf}, tolerance= ${downhillTolerance(curr.temperature, psp.degreesPerDownhillStepTolerance)}, downhillStepCount= ${curr.downhillStepsCount}, jump distance= ${jumpDist}, dir= ${curr.direction.toString(StringifyMode.concise)}  -------------------------------------------------`)
    const bestPerfLogEntry      = log.entryWithBestObservedPerformance                                                                                              ; if (psp.verbose) console.log(`\t\t\tlog entry with best perf had been so far=${bestPerfLogEntry?.toString()}`)
    log.append(new SearchLogEntry<T>(timestamp, curr.position, curr.direction, jumpDist, perf, curr.temperature, curr.downhillStepsCount, bestPerfLogEntry))

    const newTemperature        = Math.max(0, curr.temperature - psp.temperatureCoolingGradient)
    let   newDownhillStepsCount: number 

    if (!bestPerfLogEntry)  // it is the first iteration so there is no log entry yet
        newDownhillStepsCount = 0
    else                    // it is the first iteration so there is already a log entry 
        if (perf < bestPerfLogEntry.performance) { // current performance lower as highest point so far
            if (curr.downhillStepsCount > downhillTolerance(curr.temperature, psp.degreesPerDownhillStepTolerance)) { // too many steps with lower performance in a row
                                                                                                                                                                    ; if (psp.verbose) console.log(`\t\ttoo many downhill steps. Withdraw from ${log.last?.position.toString(StringifyMode.concise)} with perf=${log.last?.performance} to ${bestPerfLogEntry.position.toString(StringifyMode.concise)} with perf=${bestPerfLogEntry.performance}. Setting new course`)
                return {
                    position:           bestPerfLogEntry.position,                               // retreat to a position that showed best performance
                    direction:          curr.direction.newRandomDirection(),                                                                                                  
                    temperature:        newTemperature,
                    downhillStepsCount: 0
                }
            }
            // continue going forward even if current performance is still under the best observed so far
            newDownhillStepsCount = curr.downhillStepsCount + 1                                                                                                     ; if (psp.verbose) console.log(`\t\tGoing downhill: ${newDownhillStepsCount} steps gone`)
        } else // performance >= best performance observed so far
            newDownhillStepsCount = 0
    
    // current performance at least as good as best oobserved so far: continue journey in current direction 
    const vor = curr.position.plus(curr.direction.stretchedBy(jumpDist))                                                                                            ; if (psp.verbose && vor.rebound) console.log(`\t\tSetting new course after rebound `)
 
    return {
        position:           vor.position,
        direction:          vor.rebound ? curr.direction.newRandomDirection() : curr.direction,
        temperature:        newTemperature,
        downhillStepsCount: newDownhillStepsCount
    }
}
