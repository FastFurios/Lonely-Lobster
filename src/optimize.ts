//----------------------------------------------------------------------------
// MULTIDIMENSIONAL SEARCH FOR OPTIMUM 
//----------------------------------------------------------------------------

import { randomPick } from './helpers.js'
import { Timestamp } from './io_api_definitions.js'

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

    protected inverted(): Vector<T> {
        return new Vector<T>(this.vdm, this.vec.map(vd => -vd))
    }

    public stretchedBy(stretchFactor: number): Vector<T> {
        return new Vector<T>(this.vdm, this.vec.map((vd, idx) => Math.round(vd * stretchFactor)))
    }

    public toString(mode?: StringifyMode): string {
        return mode == StringifyMode.concise ? `[${this.vec}]` 
                                             : this.vec.map((val, idx) => `${this.vdm.vectorDimension(idx).dimension.toString()}: ${val}`).reduce((a, b) => `${a}, ${b}`)
    }
}

// --- POSITION ---- a fixed location in space. There must be only one Position per location. Positions are updated with data from the visits ----------------------------------------------

export class Position<T extends Stringify> extends Vector<T> {
    // -- class properties ---- 
    static visitedPositions = new Map<string, any>() // should actually be Position<T>

    static new<T extends Stringify>(vdm: VectorDimensionMapper<T>, vec: number[]): Position<T> {
        const vecAsStringConcise = `[${vec}]`
        const visitedPosition: Position<T> | undefined = this.visitedPositions.get(vecAsStringConcise)
        if (visitedPosition) {
            console.log(`\tPosition.new(): ${visitedPosition.toString(StringifyMode.concise)}: have visited that place before`)
            return visitedPosition 
        }
        else {
            const newPos = new Position<T>(vdm, vec)
            Position.visitedPositions.set(vecAsStringConcise, newPos) 
            console.log(`\tPosition.new(): ${newPos.toString(StringifyMode.concise)}: have not been to this place yet`)
            return newPos
        }
    } 

    static visitedPositionsToString(): string {
        return [...this.visitedPositions.values()].map(vp => `\n\t\t\t${vp.toString(StringifyMode.concise, true)}`).reduce((a, b) => `${a} ${b}`, "")
    }

    // -- object properties ---- 
    private visitsOverTime: SearchLogEntry<T>[] = []

    constructor(vdm: VectorDimensionMapper<T>, vec: number[]) {
        super(vdm, vec)
    }

    get avgPerformance(): number {
        return this.visitsOverTime.map(sle => sle.performance).reduce((a, b) => a + b) / this.visitsOverTime.length
    }

    public recordNewVisit(sle: SearchLogEntry<T>): void {
        this.visitsOverTime.push(sle)
    }

    protected dimHandledRebound(idx: number, to: number): VectorDimensionOperationResult {
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

    protected dimPlus(idx: number, v: Vector<T>): VectorDimensionOperationResult {
        const r: number = this.vec[idx] + v.vec[idx] 
        return this.dimHandledRebound(idx, r)
    }

    public plus(v: Vector<T>): VectorOperationResult<T> {
        const vdors: VectorDimensionOperationResult[] = this.vec.map((_, idx) => this.dimPlus(idx, v))
        return { position: Position.new(this.vdm, vdors.map(vdor => vdor.result)),
                 rebound:  vdors.map(vdor => vdor.rebound).reduce((a, b) => (a || b), false) }
    }

    public toString(mode?: StringifyMode, visitHistory?: boolean): string {
        const basics  = (mode == StringifyMode.concise ? `[${this.vec}]` : this.vec.map((val, idx) => `${this.vdm.vectorDimension(idx).dimension.toString()}: ${val}`).reduce((a, b) => `${a}, ${b}`))
        const viHist  = ", visits=" + this.visitsOverTime.map(v => `(t=${v.timestamp}, perf=${v.performance.toPrecision(3)})`).reduce((a, b) => `${a} ${b}`, "")
        const avgPerf = ": avg perf= " + (this.visitsOverTime.map(v => v.performance).reduce((a, b) => a + b, 0) / this.visitsOverTime.length).toPrecision(3)
        return basics + viHist + avgPerf
    }
}

// --- DIRECTION --------------------------------------------------------------------
const randomizeDirectionRetries = 5

export class Direction<T extends Stringify> extends Vector<T> {
    constructor(vdm: VectorDimensionMapper<T>, vec: number[]) { 
        super(vdm, vec) 
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
                public bestPosPerf:         PositionPerformance<T> | undefined) { 
    }

    public toString(): string {
        return `${this.timestamp} [${this.position.vec}]:\t perf= ${this.performance} \ttemp= ${this.temperature} \tdir= [${this.direction.vec}] \tjumpDist=${Math.round(this.jumpDistance)} \tdownSteps= ${Math.round(this.downhillStepCount)}`
    }

    public stringified = (): string => this.toString()
}


type PositionPerformance<T extends Stringify> = {
    position: Position<T>
    performance: number
}

export class SearchLog<T extends Stringify> {
    log: SearchLogEntry<T>[] = []
    constructor() { }

    public appended(le: SearchLogEntry<T>): SearchLogEntry<T>  {
        this.log.push(le)
        return this.log[this.log.length -1]
    } 

    get last(): SearchLogEntry<T> | undefined {
        return this.log.length < 1 ? undefined : this.log[this.log.length - 1]
    }

    get secondLast(): SearchLogEntry<T> | undefined {
        return this.log.length < 2 ? undefined : this.log[this.log.length - 2]
    }

    public positionWithBestAvgPerformance(vdm: VectorDimensionMapper<T>): PositionPerformance<T> | undefined { // checks all log entries and calculates the avg performance of each position an returns the position and the avg. performance
        let bestPosPerf: PositionPerformance<T> | undefined = undefined
        for (let le of this.log)
            if (!bestPosPerf || le.performance > bestPosPerf.performance) 
                bestPosPerf = { position: le.position, performance: le.performance }
        return bestPosPerf
    }

    public toString(): string {
        return this.log.map(le =>`${le.toString()}`).reduce((a, b) => `${a}\n${b}`) 
    }
}

//--------------------------------------
// SEARCH FOR MAXIMUM 
//--------------------------------------

type Temperature                        = number // as in "Simulated Annealing"
type Tolerance                          = number // the higher the temperature the higher the tolerance for continued downhill steps 
type DegreesPerDownhillStepTolerance    = number // e.g. 20 = for every 20 degree of cooling it tolerates 1 step downhill less

export type PeakSearchParms = {    // parameter set for the search algorithm 
    initTemperature:                 Temperature                        // initial temperature; need to be > 0
    temperatureCoolingGradient:      Temperature                        // cooling with every search iteration
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
    	    vdm:                VectorDimensionMapper<T>,
            log:                SearchLog<T>,
            performanceAt:      (p: Position<T>) => number, 
            psp:                PeakSearchParms,
            timestamp:          Timestamp,
            curr:               SearchState<T>       ): SearchState<T> {

    const jumpDistance      = (temp: Temperature): number => Math.max(1, (psp.initJumpDistance * temp / psp.initTemperature))
    const downhillTolerance = (temp: Temperature, dpdhst: DegreesPerDownhillStepTolerance): Tolerance =>  Math.floor(temp / dpdhst)

    const perf                  = performanceAt(curr.position)                                                                                                                          
    const jumpDist              = jumpDistance(curr.temperature)                                                                                                    ; if (psp.verbose) console.log(`\n\ntime=${timestamp}\t${curr.position.toString(StringifyMode.concise)} with perf= ${perf.toPrecision(3)}, tolerance= ${downhillTolerance(curr.temperature, psp.degreesPerDownhillStepTolerance).toPrecision(3)}, downhillStepCount= ${curr.downhillStepsCount}, jump distance= ${jumpDist}, dir= ${curr.direction.toString(StringifyMode.concise)}  -------------------------------------------------`)
    const bestAvgPerfPosition   = log.positionWithBestAvgPerformance(vdm)                                                                                              ; if (psp.verbose) console.log(`\tnextSearchState: position with best avg perf seen had been so far=${bestAvgPerfPosition?.position.toString(StringifyMode.concise)} with perf=${bestAvgPerfPosition?.performance.toPrecision(3)}`)
    if (!bestAvgPerfPosition) console.log("\t** WARNING: nextSearchState: bestAvgPerfPosition == undefined")
//  curr.position.recordNewVisit(log.appended(new SearchLogEntry<T>(timestamp, curr.position, curr.direction, jumpDist, perf, curr.temperature, curr.downhillStepsCount, bestAvgPerfPosition))) 
    const le = log.appended(new SearchLogEntry<T>(timestamp, curr.position, curr.direction, jumpDist, perf, curr.temperature, curr.downhillStepsCount, bestAvgPerfPosition))
    if (!le) console.log("*** no reference to log entry from search log.appended()")
    curr.position.recordNewVisit(le)
    console.log("\t\tPosition.visitedPositions: " + Position.visitedPositionsToString())

    const newTemperature        = Math.max(0, curr.temperature - psp.temperatureCoolingGradient)
    let   newDownhillStepsCount: number 

    if (!bestAvgPerfPosition)  // it is the first iteration so there is no log entry yet
        newDownhillStepsCount = 0
    else                    // it is the first iteration so there is already a log entry 
        if (perf < bestAvgPerfPosition.performance) { // current performance lower as highest point so far
            if (curr.downhillStepsCount > downhillTolerance(curr.temperature, psp.degreesPerDownhillStepTolerance)) { // too many steps with lower performance in a row
                                                                                                                                                                    ; if (psp.verbose) console.log(`\t\ttoo many downhill steps. Retreat from ${log.last?.position.toString(StringifyMode.concise)} with avg. perf=${log.last?.performance.toPrecision(3)} to ${bestAvgPerfPosition.position.toString(StringifyMode.concise)} with perf=${bestAvgPerfPosition.performance.toPrecision(3)}. Setting new course`)
                return {
                    position:           bestAvgPerfPosition.position,                               // retreat to a position that showed best performance
                    direction:          curr.direction.newRandomDirection(),                                                                                                  
                    temperature:        newTemperature,
                    downhillStepsCount: 0
                }
            }
            // continue going forward even if current performance is still under the best observed so far
            newDownhillStepsCount = curr.downhillStepsCount + 1                                                                                                     ; if (psp.verbose) console.log(`\t\tGoing downhill: ${newDownhillStepsCount} steps gone`)
        } else // performance >= best performance observed so far
            newDownhillStepsCount = 0
    
    // current performance is at least as good as best observed so far: continue journey in current direction 
    const vor = curr.position.plus(curr.direction.stretchedBy(jumpDist))                                                                                            ; if (psp.verbose && vor.rebound) console.log(`\t\tSetting new course after rebound `)
 
    return {
        position:           vor.position,
        direction:          vor.rebound ? curr.direction.newRandomDirection() : curr.direction,
        temperature:        newTemperature,
        downhillStepsCount: newDownhillStepsCount
    }
}
