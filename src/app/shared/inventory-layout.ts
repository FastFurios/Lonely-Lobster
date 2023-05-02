// helper functions to build a proper PsInventory from a list of workitems and their stats  
import { I_WorkItem } from "./api-definitions"


export type PsInventoryWi = {
    id:                             number,
    accumulatedEffortInProcessStep: number,
    elapsedTimeInProcessStep:       number    
  }
  
  export type PsInventoryColumn = {
    colNr:  number,
    wis:    PsInventoryWi[]      
  }
  
  export type PsInventory = PsInventoryColumn[]     
  
  export type PsInventoryShow = { 
    cols: PsInventory;
    excessColsWiNum: number
  }
  

  export function workitemsAsPsInventory(wiList: I_WorkItem[]): PsInventory {
    const max = <T>(a:T, b:T): T => a > b ? a : b
    const maxEt = (wis: I_WorkItem[]): number => 
            wis.length == 0 ? 0 
                            : wis.reduce((wi1, wi2) => wi1.elapsedTimeInProcessStep > wi2.elapsedTimeInProcessStep ? wi1 : wi2).elapsedTimeInProcessStep 
//    console.log("maxEt = " + maxEt(wiList))
    let psInventory: PsInventory = [] 
    for (let col = 0; col <= max<number>(maxEt(wiList), 5); col++) {
        psInventory.push(
            { colNr: col, 
              wis: wiList.filter(wi => wi.elapsedTimeInProcessStep == col)
                         .sort((wi1, wi2) => wi2.accumulatedEffortInProcessStep - wi1.accumulatedEffortInProcessStep)
            }
        )
    }

//    console.log("inventory-layout/workitemsAsPsInventory")
//    console.log(wiList)
//    console.log(psInventory)
    
    return psInventory
}

