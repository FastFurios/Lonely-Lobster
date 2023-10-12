// ------------------------------------------------------------
//  nice little HELPER FUNCTIONS
// ------------------------------------------------------------

import { WiExtInfoTuple, WiExtInfoElem } from './workitem.js'

// ------------------------------------------------------------
//  some array helpers
// ------------------------------------------------------------

// --- create array of 2 element tuples from two arrays
export type Tuple<T, U> = [T, U]

export function tupleBuilderFrom2Arrays<T, U>(a: T[], b: U[]): Tuple<T, U>[] {
    const tupleArray: Tuple<T, U>[] = []
    for (let i=0; i < Math.min(a.length, b.length); i++) tupleArray.push([a[i], b[i]]) 
    return tupleArray
}

// --- create array with n times an item
export const duplicate = <T>(item: T, n: number): T[] => Array.from({length: n}).map(e => item)

// --- split an array at an index
interface I_SplitArray<T> {
    head:   T[] 
    middle: T
    tail:   T[]
}

function split<T>(a: T[], splitIndex: number): I_SplitArray<T>  {
    return { head: a.slice(undefined, splitIndex),
             middle: a[splitIndex],
             tail: a.slice(splitIndex + 1, undefined)
           }
}

export function reshuffle<T>(a: T[]): T[] {
    if (a.length == 0) return []
    const splitIndex = Math.floor(Math.random() * a.length)
    const sa: I_SplitArray<T> = split(a, splitIndex)
    return [a[splitIndex]].concat(reshuffle<T>(sa.head.concat(sa.tail)))
}


// ------------------------------------------------------------
//  sort rows and select top row of a table i.e. of an array of arrays (tuples); 
//  if no sortVector provided, choose a row by random
// ------------------------------------------------------------

export enum SelectionCriterion {
    minimum = 0,
    maximum = 1
}
export interface SortVector {
    colIndex:  WiExtInfoElem,
    selCrit:   SelectionCriterion
}

export function topElemAfterSort(arrArr: WiExtInfoTuple[], sortVector: SortVector[]): WiExtInfoTuple {
    if (arrArr.length     <  1) throw Error("topElemAfterSort(): received array w/o element") 
    if (arrArr.length     == 1) return arrArr[0]
    if (sortVector.length == 0) return arrArr[Math.floor(Math.random() * arrArr.length)]   // arrArr[0]

    const f = sortVector[0].selCrit == SelectionCriterion.maximum ? (a: number, b: number) => a > b ? a : b
                                                              : (a: number, b: number) => a < b ? a : b
    const v          = (<number[]>arrArr.map(arr => arr[sortVector[0].colIndex])).reduce(f)
    const arrArrTops = arrArr.filter(arr => arr[sortVector[0].colIndex] == v)

    return topElemAfterSort(arrArrTops, sortVector.slice(1))
}