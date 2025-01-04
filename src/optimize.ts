// ------------------------------------------------------------
/** 
 * MULTIDIMENSIONAL SEARCH FOR THE OPTIMUM 
 * a heuristic algorithm in a multidimensional space to search the peak value inspired by "simulated annealing",
 * see e.g. https://www.bing.com/search?q=simulated+annealing&form=ANNTH1&refig=7d005b93e9644fc49bd1c96a0871e7c7&pc=ACTS
 */
// ------------------------------------------------------------
// last code cleaning: 04.01.2025

import { randomPick, topPercentileValues } from './helpers.js'
import { Timestamp } from './io_api_definitions.js'

//----------------------------------------------------------------------------
// MULTIDIMENSIONAL SEARCH FOR OPTIMUM 
//----------------------------------------------------------------------------

export type infinite = undefined

/** mode that controls how verbose the stringify methods are */
export enum StringifyMode {
    concise,
    verbose
}

/** interface for a toString method */
interface Stringify {
    toString: (mode?: StringifyMode) => string
}

/** result of an operation with a vector dimension */
type VectorDimensionOperationResult = {
    /** resulting new value of a dimension */
    result:     number       
    /** indicates if jump was rebound at boundary */
    rebound:    boolean
}

/** result of an operation with a vector */
type VectorOperationResult<T extends Stringify> = {
    /** resulting new value of a vector */
    position:   Position<T>
    /** indicates if jump was rebound at boundary */
    rebound:    boolean
}

/** percentile of measured performances at a position to be taken for calculating an average */
const c_AvgPerformanceOfTopPercentile = 50

// --- VECTOR DIMENSION MAPPER --------------------------------------------------------------------
/**
 * A dimension of a multi-dimensional vector
 */
export class VectorDimension<T extends Stringify> {
    constructor(/** object that identifies a vector dimension */
                public dimension: T, 
                /** lower boundary of the vector dimension */
                public min:       number | infinite,
                /** upper boundary of the vector dimension */
                public max:       number | infinite ) { }

    toString(mode?: StringifyMode): string {
        return `${this.dimension.toString(mode)} from ${this.min} to ${this.max}`
    }
}

/**
 * Maps object references to dimensions in a vector
 */
export class VectorDimensionMapper<T extends Stringify> {  
    constructor(public vds: VectorDimension<T>[]) { }

    /**
     * returns the vector dimension of an element in the array of vector dimensions
     * @param idx index in the array of dimensions 
     * @returns the vector dimension 
     */
    public vectorDimension(idx: number): VectorDimension<T> { 
        return this.vds[idx] 
    }

    /**
     * returns the index in the array of vector dimensions
     * @param dim object that identifies an vector dimension 
     * @returns the index
     */
    public vectorDimensionIndex(dim: T): number { 
        return this.vds.findIndex(vd => vd.dimension == dim) 
    }

    /**
     * return the number of vector dimensions
     */
    get length() { 
        return this.vds.length
    }

    public toString(mode: StringifyMode): string {
        return `${this.vds.map(vd => vd.toString(mode))}\n`
    }

}

// --- VECTOR --------------------------------------------------------------------
/**
 * A vector
 */
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

// --- POSITION --------------------------------------------------
/**
 * A fixed location in space. There is only one position object per location or none. 
 * Positions objects are updated with data from the visits of the peak search algorithm. 
 */
export class Position<T extends Stringify> extends Vector<T> {
    /**
     * A map of positions: key is a location e.g. [4, 3, 2, 2, 5] => value: the position object 
     */
    static visitedPositions = new Map<string, any>() // "any" should actually be Position<T> but typescript complains

    /**
     * Looks up the location in the map and returns the Position object; if no Position object yet create one for the location
     * @param vdm vector dimension mapper
     * @param vec location
     * @returns position object
     */
    static new<T extends Stringify>(vdm: VectorDimensionMapper<T>, vec: number[]): Position<T> {
        const vecAsStringConcise = `[${vec}]` // location e.g. [4, 3, 2, 2, 5]
        const visitedPosition: Position<T> | undefined = this.visitedPositions.get(vecAsStringConcise)
        if (visitedPosition) {
            return visitedPosition 
        }
        else {
            const newPos = new Position<T>(vdm, vec)
            Position.visitedPositions.set(vecAsStringConcise, newPos) 
            return newPos
        }
    } 

    static visitedPositionsToString(): string {
        return [...this.visitedPositions.values()].map((vp: Position<any>) => `\n\t\t\t${vp.toString(StringifyMode.concise, true)}; top${c_AvgPerformanceOfTopPercentile}%-avg=${vp.avgPerformanceOfTopPercentile(c_AvgPerformanceOfTopPercentile)?.toPrecision(3)}`).reduce((a, b) => `${a} ${b}`, "")
    }

    // -- object properties ---- 
    /** log of the location visits */
    private visitsOverTime: SearchLogEntry<T>[] = []

    constructor(vdm: VectorDimensionMapper<T>, vec: number[]) {
        super(vdm, vec)
    }

    /**
     * Calculate the average performance of the best performances measured at this position 
     * @param topPercentile determines which portion of all performances measured are taken into the calculation  
     * @returns average performance measured so far at this position
     */
    public avgPerformanceOfTopPercentile(topPercentile: number): number | undefined {
        if (this.visitsOverTime.length < 1) return undefined
        const tpv = topPercentileValues(this.visitsOverTime.map(sle => sle.performance), topPercentile) 
        return tpv.reduce((a, b) => a + b) / tpv.length
    }

    /**
     * Record a new visit of the peak search algorithm at this position in the search log
     * @param sle the current search log entry
     */
    public recordNewVisit(sle: SearchLogEntry<T>): void {
        this.visitsOverTime.push(sle)
    }

    /**
     * Calculate new value for a dimension. If value is beyond of the dimension boundaries the function calculates 
     * the new position after deflection at the dimension boundary  
     * @param idx index of the dimension
     * @param to value for , may well be outside the boundaries a dimension
     * @returns value after potential deflection  
     */
    protected dimHandledRebound(idx: number, to: number): VectorDimensionOperationResult {
        if (this.vdm.vectorDimension(idx).min != undefined) {  // if a lower boundary is defined
            if (to < this.vdm.vectorDimension(idx).min!) { // if "to" is below lower boundary
                return { result:  2 * this.vdm.vectorDimension(idx).min! - to,
                         rebound: true }
            }
        }
        if (this.vdm.vectorDimension(idx).max != undefined) { // if a upper boundary is defined 
            if (to > this.vdm.vectorDimension(idx).max!) { // if "to" is above upper boundary
                return { result:  2 * this.vdm.vectorDimension(idx).max! - to,
                         rebound: true } 
            }
        }
        // if "to" was already inside the boundaries, than no rebound and the "to" value can be taken unchanged 
    	return { result: to, rebound: false }
    }

    /**
     * Calculate the dimension value when adding a vector to this position  
     * @param idx dimesion index
     * @param v vector being added
     * @returns the result for the dimension, possibly after rebound 
     */
    protected dimPlus(idx: number, v: Vector<T>): VectorDimensionOperationResult {
        const r: number = this.vec[idx] + v.vec[idx] 
        return this.dimHandledRebound(idx, r)
    }

    /**
     * Creates a new position after adding a vector to this position 
     * @param v vector to be added
     * @returns new position
     */
    public plus(v: Vector<T>): VectorOperationResult<T> {
        const vdors: VectorDimensionOperationResult[] = this.vec.map((_, idx) => this.dimPlus(idx, v))
        return { position: Position.new(this.vdm, vdors.map(vdor => vdor.result)),
                 rebound:  vdors.map(vdor => vdor.rebound).reduce((a, b) => (a || b), false) }
    }

    /**
     * Creates a string for the current state of the position
     * @param mode 
     * @param visitHistory 
     * @returns 
     */
    public toString(mode?: StringifyMode, visitHistory?: boolean): string {
        const basics  = (mode == StringifyMode.concise ? `[${this.vec}]` : this.vec.map((val, idx) => `${this.vdm.vectorDimension(idx).dimension.toString()}: ${val}`).reduce((a, b) => `${a}, ${b}`))
        const viHist  = ", visits=" + this.visitsOverTime.map(v => `(t=${v.timestamp}, perf=${v.performance.toPrecision(3)})`).reduce((a, b) => `${a} ${b}`, "")
        const avgPerf = ": avg perf= " + (this.visitsOverTime.map(v => v.performance).reduce((a, b) => a + b, 0) / this.visitsOverTime.length).toPrecision(3)
        return basics + (visitHistory ? viHist + avgPerf : "")
    }
}

// --- DIRECTION --------------------------------------------------------------------
const randomizeDirectionRetries = 5

/**
 * Direction vector with dimension values -1, 0 or 1
 */
export class Direction<T extends Stringify> extends Vector<T> {

    /**
     * set direction to neutral i.e. all dimension values are 0
     * @param vdm vector dimension mapper
     * @returns neutral direction
     */
    static noDirection<T extends Stringify>(vdm: VectorDimensionMapper<T>): Direction<T> {
        return new Direction<T>(vdm, vdm.vds.map(_ => 0))  // Direction = [0, 0, ...0]
    }

    constructor(vdm: VectorDimensionMapper<T>, vec: number[]) { 
        super(vdm, vec) 
    }

    /**
     * Creates a new random direction
     * @returns new random direction
     */
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

/**
 * Log entry for an iteration of the peak search algorithm
 */
export class SearchLogEntry<T extends Stringify> {
    constructor(/** time */
                public timestamp:           number,
                /** current position */
                public position:            Position<T>,
                /** direction currently pursued */
                public direction:           Direction<T>,
                /** current jump distance */
                public jumpDistance:        number,
                /** currently measured performance */
                public performance:         number,
                /** current performance */
                public temperature:         number,
                /** current number of steps went downhill in direct sequence */
                public downhillStepCount:   number,
                /** best performance mearured at the position */
                public bestPosPerf:         PositionPerformance<T> | undefined) { 
    }

    public toString(): string {
        return `${this.timestamp} [${this.position.vec}]:\t perf= ${this.performance} \ttemp= ${this.temperature} \tdir= [${this.direction.vec}] \tjumpDist=${Math.round(this.jumpDistance)} \tdownSteps= ${Math.round(this.downhillStepCount)}`
    }

    public stringified = (): string => this.toString()
}

/** position and its performance */
type PositionPerformance<T extends Stringify> = {
    position: Position<T>
    performance: number
}

/**
 * the peak search algorithm's log of search entries 
 */
export class SearchLog<T extends Stringify> {
    log: SearchLogEntry<T>[] = []
    constructor() { }

    /**
     * Append another log entry
     * @param le log entry
     * @returns the last log entry i.e. @see {@link le}
     */
    public appended(le: SearchLogEntry<T>): SearchLogEntry<T>  {
        this.log.push(le)
        return this.log[this.log.length -1]
    } 

    /**
     * return last log entry or undefined
     */
    get last(): SearchLogEntry<T> | undefined {
        return this.log.length < 1 ? undefined : this.log[this.log.length - 1]
    }

    /** the last but one log entry */
    get secondLast(): SearchLogEntry<T> | undefined {
        return this.log.length < 2 ? undefined : this.log[this.log.length - 2]
    }

    /**  returns the position with the best average performance so far */
    get positionWithBestAvgPerformance(): PositionPerformance<T> | undefined { // checks all log entries and calculates the avg performance of each position and returns the position with the best avg. performance
        let bestPosAvgPerf: PositionPerformance<T> | undefined = undefined
        for (let le of this.log) {
            const lePosAvgPerf = le.position.avgPerformanceOfTopPercentile(c_AvgPerformanceOfTopPercentile)
            if (!bestPosAvgPerf || lePosAvgPerf! > bestPosAvgPerf.performance) 
                bestPosAvgPerf = { position: le.position, performance: lePosAvgPerf! }
        }
        return bestPosAvgPerf
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

/** parameters for the peak search algoritm */
export type PeakSearchParms = { 
    /** initial temperature; need to be > 0 */
    initTemperature:                 Temperature                        
    /** cooling down parameter for cooling function */
    temperatureCoolingParm:          number                              
    /** downhill step sequences tolerance */
    degreesPerDownhillStepTolerance: DegreesPerDownhillStepTolerance    
    /** jump distances in choosen direction; reduces when temperature cools */
    initJumpDistance:                number                             
    /** number of iterations after which the performance is measured */
    measurementPeriod:               number                             
    /** will be multiplied with the lower boundary which is (#assigned-workers / norm-effort) */
    wipLimitUpperBoundaryFactor:     number                               
    /** search is on from first iteration if true */
    searchOnAtStart:                 boolean                            
    /** outputs debug data if true */
    verbose:                         boolean                            
}

/** current state of the search algorithm */
export type SearchState<T extends Stringify> = {
    position:           Position<T>,
    direction:          Direction<T>,
    temperature:        Temperature,
    downhillStepsCount: number
}

// --- SEARCH ALGORITHM --------------------------------------------------------------------

/**
 * Peak search algorithm 
 * @param log search log
 * @param performanceAt function that measures the performance at a position 
 * @param psp peak search algorithm parameters
 * @param timestamp current time 
 * @param curr current search state
 * @returns new search state
 */
export function nextSearchState<T extends Stringify> (
            log:                SearchLog<T>,
            performanceAt:      (p: Position<T>) => number, 
            psp:                PeakSearchParms,
            timestamp:          Timestamp,
            curr:               SearchState<T>): SearchState<T> {

    const jumpDistance      = (temp: Temperature): number => Math.max(1, Math.round(psp.initJumpDistance * temp / psp.initTemperature))
    const downhillTolerance = (temp: Temperature, dpdhst: DegreesPerDownhillStepTolerance): Tolerance =>  Math.floor(temp / dpdhst)
    const newTemperature    = (temp: Temperature, coolingParm: number) => Math.round(coolingParm * temp) - 1

    const perf                  = performanceAt(curr.position)                                                                                                                          
    const jumpDist              = jumpDistance(curr.temperature)                                                                                                    ; if (psp.verbose) console.log(`\n\n****** time=${timestamp}\t${curr.position.toString(StringifyMode.concise)} with perf= ${perf.toPrecision(3)}, tolerance= ${downhillTolerance(curr.temperature, psp.degreesPerDownhillStepTolerance).toPrecision(3)}, temperature=${curr.temperature}, downhillStepCount= ${curr.downhillStepsCount}, jump distance= ${jumpDist}, dir= ${curr.direction.toString(StringifyMode.concise)}  ----------------------`)
    const bestAvgPerfPosition   = log.positionWithBestAvgPerformance                                                                                                ; if (psp.verbose) console.log(`\tnextSearchState: position with best avg perf seen had been so far=${bestAvgPerfPosition?.position.toString(StringifyMode.concise)} with perf=${bestAvgPerfPosition?.performance.toPrecision(3)}`)
    if (!bestAvgPerfPosition) console.log("\t** WARNING: nextSearchState: bestAvgPerfPosition == undefined")
    const le = log.appended(new SearchLogEntry<T>(timestamp, curr.position, curr.direction, jumpDist, perf, curr.temperature, curr.downhillStepsCount, bestAvgPerfPosition))
    if (!le) console.log("*** no reference to log entry from search log.appended()")
    curr.position.recordNewVisit(le)
    
    console.log(`${Position.visitedPositionsToString()}`)

    // if cooled down to below 0 degree, i.e. it's "frozen", go to position that has performed best on average and stay there
    if (curr.temperature <= 0 && bestAvgPerfPosition) {                                                                                                             ; if (psp.verbose) console.log(`\tnow frozen at best performing position observed so far: ${bestAvgPerfPosition?.position.toString(StringifyMode.concise)} with perf=${bestAvgPerfPosition?.performance.toPrecision(3)}`)
        return {
            position:           bestAvgPerfPosition!.position,
            direction:          Direction.noDirection(curr.direction.vdm),                                                                                                  
            temperature:        newTemperature(curr.temperature, psp.temperatureCoolingParm),
            downhillStepsCount: 0
        }
    }

    // if it is yet warm continue exploring
    let newDownhillStepsCount: number = 0

    if (!bestAvgPerfPosition)  // it is the first iteration so there is no log entry yet
        newDownhillStepsCount = 0
    else                    // it is the first iteration so there is already a log entry 
        if (perf < bestAvgPerfPosition.performance) { // current performance lower as highest point so far
            if (curr.downhillStepsCount > downhillTolerance(curr.temperature, psp.degreesPerDownhillStepTolerance)) { // too many steps with lower performance in a row
                                                                                                                                                                    ; if (psp.verbose) console.log(`\t\t${curr.downhillStepsCount} are too many steps downhill. Retreat from ${log.last?.position.toString(StringifyMode.concise)} with avg. perf=${log.last?.performance.toPrecision(3)} to ${bestAvgPerfPosition.position.toString(StringifyMode.concise)} with perf=${bestAvgPerfPosition.performance.toPrecision(3)}. Setting new course`)
                return {
                    position:           bestAvgPerfPosition.position,                               // retreat to a position that has showed best performance
                    direction:          curr.direction.newRandomDirection(),                                                                                                  
                    temperature:        newTemperature(curr.temperature, psp.temperatureCoolingParm), 
                    downhillStepsCount: 0
                }
            }
            // continue going forward even if current performance is still under the best observed so far
            newDownhillStepsCount = curr.downhillStepsCount + 1                                                                                                      ; if (psp.verbose) console.log(`\t\tGoing downhill: ${newDownhillStepsCount} steps gone`)
        } else // performance >= best performance observed so far
            newDownhillStepsCount = 0
    
    // current performance is at least as good as best observed so far: continue journey in current direction 
    const vor = curr.position.plus(curr.direction.stretchedBy(jumpDist))                                                                                            ; if (psp.verbose && vor.rebound) console.log(`\t\tSetting new course after rebound `)
 
    return {
        position:           vor.position,
        direction:          vor.rebound ? curr.direction.newRandomDirection() : curr.direction,
        temperature:        newTemperature(curr.temperature, psp.temperatureCoolingParm), 
        downhillStepsCount: newDownhillStepsCount
    }
}