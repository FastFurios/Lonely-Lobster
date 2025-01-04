// ------------------------------------------------------------
/**
 *  nice little HELPER FUNCTIONS
 *  collection of helper functions that could be of general use also in other projects
 */ 
// ------------------------------------------------------------
// last code cleaning: 04.01.2025

import { WiExtInfoTuple, WiExtInfoElem } from './workitem.js'

// ------------------------------------------------------------
//  some array helpers
// ------------------------------------------------------------

/**
 * pick a random member of an array
 * @param a an array with elements of type T
 * @returns randomly selected element of @see {@link a}
 */
export function randomPick<T>(a: Array<T>): T {
    return a[Math.floor(Math.random() * a.length)]
}

/**
 * create array of 2 element tuples from two arrays
 * @param a an array with elements of type T
 * @param b an array with elements of type U
 * @returns an array of tuples from the two arrays ignoring any excess elements in the longer array
 * @example a = [1, 2, 3], b = [10, 20, 30, 40]: result is [[1, 10], [2, 20], [3, 30]] 
 */ 
export function tupleBuilderFrom2Arrays<T, U>(a: T[], b: U[]): Tuple<T, U>[] {
    const tupleArray: Tuple<T, U>[] = []
    for (let i=0; i < Math.min(a.length, b.length); i++) tupleArray.push([a[i], b[i]]) 
    return tupleArray
}

export type Tuple<T, U> = [T, U]

/**
 * create array with n times an item
 * @param item an object of type T
 * @param n length of resulting array
 * @example duplicate<number>(1, 5) results in [1, 1, 1, 1, 1]
 */ 
export const duplicate = <T>(item: T, n: number): T[] => Array.from({length: n}).map(e => item)

/** 
 * split an array at an index
 * @param a array with elements of type T
 * @param splitIndex index where to split the array
 * @returns object with the subarray left of the @see {@link splitIndex}, the element at the @see {@link splitIndex} and the subarray right of the @see {@link splitIndex}   
 * @example split<number>([1, 2, 3, 4, 5], 3) results in { head: [1, 2, 3], middle: 4, tail: [5] } 
 */
function split<T>(a: T[], splitIndex: number): I_SplitArray<T>  {
    return { head: a.slice(undefined, splitIndex),
             middle: a[splitIndex],
             tail: a.slice(splitIndex + 1, undefined)
           }
}

interface I_SplitArray<T> {
    head:   T[] 
    middle: T
    tail:   T[]
}

/**
 * reshuffles an array
 * @param a array with elements of type T
 * @returns array with elements of type T in a reshuffled order
 */
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

/** an index of a table column and its sort order asc or desc */
export interface SortVector {
    colIndex:  WiExtInfoElem,
    selCrit:   SelectionCriterion
}

/** asc or desc */
export enum SelectionCriterion {
    /** pick the minimum i.e. the top element when sorted ascending */
    minimum = 0,
    /** pick the maximum i.e. the top element when sorted descending */
    maximum = 1
}

/** the ordered list of columns by which the table should be sorted  */
export type SortVectorSequence = SortVector[]

/**
 * Sorts the table of workitems with their statistical data by a given multi-column sort order and picks the workitem that ends up at the top   
 * @param arrArr represents a table with rows made of the @see {@link WiExtInfoTuple}
 * @param svs the array of columns each with sort order (asc/desc) by which the table should be sorted 
 * @returns returns the row in the table that is at top after the sorting 
 * @example with the first column being the workitem ids, may the table be 
 * [[17, 1, 2, 3, ...],
 *  [21, 2, 5, 1, ...],
 *  [15, 3, 2, 1, ...]] 
 * and the sort vector sequence be 
 * [{ colIndex: 3, selCrit: 0 }, 
 *  { colIndex: 1, selCrit: 1 }]
 * then the function would sort the rows into 
 * [[15, 3, 2, 1, ...], 
 *  [21, 2, 5, 1, ...], 
 *  [17, 1, 2, 3, ...]] 
 * and thus return the first row after the sort i.e. [15, 3, 2, 1, ...].
 * If an empty sort vector sequence is provided return a randomly choosen row.
 */
export function topElemAfterSort(arrArr: WiExtInfoTuple[], svs: SortVectorSequence): WiExtInfoTuple {
    if (arrArr.length     <  1) throw Error("topElemAfterSort(): received array w/o element") 
    if (arrArr.length     == 1) return arrArr[0]
    if (svs.length == 0) return arrArr[Math.floor(Math.random() * arrArr.length)] // no sort vectors, return a randomly selected row

    const f = svs[0].selCrit == SelectionCriterion.maximum ? (a: number, b: number) => a > b ? a : b
                                                           : (a: number, b: number) => a < b ? a : b
    const v          = (<number[]>arrArr.map(arr => arr[svs[0].colIndex])).reduce(f)
    const arrArrTops = arrArr.filter(arr => arr[svs[0].colIndex] == v)

    return topElemAfterSort(arrArrTops, svs.slice(1))
}

// ------------------------------------------------------------
// functions for an array of weighted elements
// ------------------------------------------------------------

/** element and its relative weight (to others) */
export type WeightedElement<T> = {
    element: T
    weight:  number
}

/** A group of weighted elements may be given each with its individual weight. The weights might add up to any number. 
 * Elements of this type have assigned their intervals on an axis from 0 to 1, so that 
 * a) the relative weights within the group add up to 1 and
 * b) the relations betewen the weights of the elements is preserved and
 * c) each element covers a section of the interval from 0 to 1 */
type WeightDistributionElement<T> = {  
    weightedElement: WeightedElement<T>
    distFrom:        number // btw 0 and 1
    distTo:          number // btw 0 and 1  ... from-to covers a space with length of the weight on the range 0 to 1
}

//   
/**
 * change weigth of an element; no normalization of weights of the array
 * @param arr an array of @see {@link WeightedElement} 
 * @param element a specific element for which the weight is changed 
 * @param weightIncrease the absolut weight increase
 * @returns an array with all elements, however the weight of the @see {@link element} is changed 
 */
export function arrayWithModifiedWeightOfAnElement<T>(arr: WeightedElement<T>[], element: T, weightIncrease: number): WeightedElement<T>[] {
    return arr.map(we => {
        if (we.element == element) 
            return { weight: we.weight + weightIncrease, element: we.element } 
        else
            return we
    })       
}

/**
 * normalize the weights in the array proportionally so the sum of all weights is 1
 * @param arr an array of @see {@link WeightedElement} with sum of their weights be any number
 * @param polished a function that may manipulate the weights before the normalization starts  
 * @returns an array of @see {@link WeightedElement} with sum of their weights be exactly 1
 */
export function arrayWithNormalizedWeights<T>(arr: WeightedElement<T>[], polished: (w: number) => number): WeightedElement<T>[] {
    const polishedArr = arr.map(we => { return { element: we.element, weight: polished(we.weight) } }) // safeguard against negative values
    const sumOfWeigths = polishedArr.map(we => we.weight).reduce((a, b) => a + b, 0)
    return polishedArr.map(we => { return { element: we.element, weight: we.weight / sumOfWeigths } })
}

/**
 * takes a list of elements with normalized weights, i.e. their sum is 1, and assigns them an interval of proportional length on the axis from 0 to 1     
 * @param arr an array of @see {@link WeightedElement} with sum of their weights be any number
 * @param from 
 * @returns 
 * @example if weightedElements are 
 * [{ element: A, weight: 0,3 }, 
 *  { element: B, weight: 0,2 }, 
 *  { element: C, weight: 0,5 }]
 * then the result is 
 * [{{ element: A, weight: 0.3 }, distFrom: 0,   distTo: 0.3}, 
 *  {{ element: B, weight: 0.2 }, distFrom: 0.3, distTo: 0.5}, 
 *  {{ element: C, weight: 0.5 }, distFrom: 0.5, distTo: 1  }]  
*/
function arrayWithWeightDistribition<T>(arr: WeightedElement<T>[], from: number = 0): WeightDistributionElement<T>[] {
    if (arr.length == 0) return []
    return [{ weightedElement: arr[0], distFrom: from, distTo: from + arr[0].weight }].concat(arrayWithWeightDistribition<T>(arr.slice(1), from + arr[0].weight)) 
}

/**
 * Randomly pick element of an array of weighted elements with assigned intervals on the stretch from 0 to 1 with the likelihood of being picked is proportional to its weight
 * @param arr an array of @see {@link WeightDistributionElement} with sum of their weights be 1
 * @returns a randomly picked element
 */
function randomlyPickedElement<T>(arr: WeightDistributionElement<T>[]): T {
    if (arr.length < 1) throw new Error("helpers.ts: randomlyPickedElement(): cannot pick element from empty array")
    const r = Math.random()
    return arr.filter(wde => wde.distFrom <= r && wde.distTo > r)[0].weightedElement.element
}

/**
 * Randomly pick element of an array of weighted elements where the likelihood of being picked is proportional to its weight
 * @param arr an array of @see {@link WeightedElement} with sum of their weights be any number
 * @param polished any function that might manipulate the weights before their normalization 
 * @returns a randomly picked element
 */
export function randomlyPickedByWeigths<T>(arr: WeightedElement<T>[], polished: (w: number) => number): T {
    return randomlyPickedElement(arrayWithWeightDistribition<T>(arrayWithNormalizedWeights<T>(arr, polished)))
}
 
/**
 * filter the x% array elements with the highest value (by ChatGPT 3.5)
 * @param arr array of numbers
 * @param x the percentage with the highest values to be filtered   
 * @returns array elements with the highest value
 */
export function topPercentileValues(arr: number[], x: number): number[] {
    if (x <= 0 || x > 100) throw new Error("helpers.getTopPercentileValues(): Percentage must be between 0 and 100.")
    const sortedArr = [...arr].sort((a, b) => b - a)        // Sort the array in descending order
    const count = Math.ceil((x / 100) * sortedArr.length);  // Calculate the number of elements to return    
    return sortedArr.slice(0, count)                        // Return the top x% values
}

