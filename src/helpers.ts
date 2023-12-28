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
export type SortVectorSequence = SortVector[]  // export deprecated since V3.0.0

export function topElemAfterSort(arrArr: WiExtInfoTuple[], sest: SortVectorSequence): WiExtInfoTuple {
    if (arrArr.length     <  1) throw Error("topElemAfterSort(): received array w/o element") 
    if (arrArr.length     == 1) return arrArr[0]
    if (sest.length == 0) return arrArr[Math.floor(Math.random() * arrArr.length)]   // arrArr[0]

    const f = sest[0].selCrit == SelectionCriterion.maximum ? (a: number, b: number) => a > b ? a : b
                                                           : (a: number, b: number) => a < b ? a : b
    const v          = (<number[]>arrArr.map(arr => arr[sest[0].colIndex])).reduce(f)
    const arrArrTops = arrArr.filter(arr => arr[sest[0].colIndex] == v)

    return topElemAfterSort(arrArrTops, sest.slice(1))
}

// ------------------------------------------------------------
// funtions for an array of weighted elements
// ------------------------------------------------------------

export type WeightedElement<T> = {
    element: T
    weight:  number
}

type WeightDistributionElement<T> = {  
    weightedElement: WeightedElement<T>
    distFrom:        number // btw 0 and 1
    distTo:          number // btw 0 and 1  ... from-to covers a space with length of the weight on the range 0 to 1
}

// change weigth of an element; no normalization of weights of the array  

export function arrayWithModifiedWeightOfAnElement<T>(arr: WeightedElement<T>[], element: T, weightIncrease: number): WeightedElement<T>[] {
    return arr.map(we => {
        if (we.element == element) 
            return { weight: we.weight + weightIncrease, element: we.element } 
        else
            return we
    })       
}

// normalize the weights in the array proportionally so the sum of all weights == 1

export function arrayWithNormalizedWeights<T>(arr: WeightedElement<T>[], polished: (w: number) => number): WeightedElement<T>[] {
    const polishedArr = arr.map(we => { return { element: we.element, weight: polished(we.weight) } }) // safeguard against negative values
    const sumOfWeigths = polishedArr.map(we => we.weight).reduce((a, b) => a + b, 0)
    return polishedArr.map(we => { return { element: we.element, weight: we.weight / sumOfWeigths } })
}

// if weightedElements are [{ element: A, weight: 0,3 }, { element: B, weight: 0,2 }, { element: C, weight: 0,5 }], 
// then the result is [{{ element: A, weight: 0.3 }, distFrom: 0, distTo: 0.3}, {{element: B, weight: 0.2}, distFrom: 0.3, distTo: 0.5}, {{element: C, weight: 0.5 }, distFrom: 0.5, distTo: 1}] 

function arrayWithWeightDistribition<T>(arr: WeightedElement<T>[], from: number = 0): WeightDistributionElement<T>[] {
    if (arr.length == 0) return []
    return [{ weightedElement: arr[0], distFrom: from, distTo: from + arr[0].weight }].concat(arrayWithWeightDistribition<T>(arr.slice(1), from + arr[0].weight)) 
}

// Randomly pick element of an array of weighted elements where the likelihood of being picked is proportional to its weight

function randomlyPickedElement<T>(arr: WeightDistributionElement<T>[]): T {
    if (arr.length < 1) throw new Error("helpers.ts: randomlyPickedElement(): cannot pick element from empty array")
    const r = Math.random()
    return arr.filter(wde => wde.distFrom <= r && wde.distTo > r)[0].weightedElement.element
}

// Randomly pick element of an array of weighted elements where the likelihood of being picked is proportional to its weight

export function randomlyPickedByWeigths<T>(arr: WeightedElement<T>[], polished: (w: number) => number): T {
    return randomlyPickedElement(arrayWithWeightDistribition<T>(arrayWithNormalizedWeights<T>(arr, polished)))
}
