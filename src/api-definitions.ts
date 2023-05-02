// ######################################################################
// ## Lonely Lobster API definitions 
// ######################################################################

// to-do: share these definitions as project references wth backend and frontend
// see: https://wallis.dev/blog/typescript-project-references

type Effort         = number // measured in Worker Time Units
type Value          = number // measured in Worker Time Units
type ValueChainId   = string
type ProcessStepId  = string
type WorkItemId     = number
type WorkItemTag    = [string, string]
type WorkerName     = string


// request to iterate

interface I_IterationRequest {
    time?: number
    newWorkOrders: {
        valueChainId:ValueChainId 
        numWorkOrders: number
    }[]
}

// response on "iterate" request

interface I_WorkItem {
    id:                             WorkItemId
    tag:                            WorkItemTag
    accumulatedEffortInProcessStep: number
    elapsedTimeInProcessStep:       number
}

interface I_ProcessStep {
    id:                             ProcessStepId
    normEffort:                     Effort
    workItems:                      I_WorkItem[]
    workItemFlow:                   number
}

interface I_ValueChain {
    id:                             ValueChainId
    totalValueAdd:                  Value
    processSteps:                   I_ProcessStep[]
}

interface I_EndProduct {
    id:                             WorkItemId
    tag:                            WorkItemTag
    accumulatedEffortInValueChain:  number
    valueOfValueChain:              Value
    elapsedTimeInValueChain:        number
}

interface I_OutputBasket {
    workItems:                      I_EndProduct[]
}

interface I_WorkerState {
    worker:                         WorkerName
    utilization:                    number
}


interface I_SystemState {
    id:                             string,
    valueChains:                    I_ValueChain[]
    outputBasket:                   I_OutputBasket
    workerUtilization:              I_WorkerState[]
}


// mock data

let systemStates: I_SystemState[] = [
    // clock == 0
    {
        id: "Mock-Machine",
        valueChains: [
            {
                id: "blue",
                totalValueAdd: 20,
                processSteps: [
                    {
                        id:          "first",
                        normEffort:  4,
                        workItems:   [
                            {
                                id:                             1,
                                tag:                            ["a", "A"],
                                accumulatedEffortInProcessStep: 0,
                                elapsedTimeInProcessStep:       0
                            },
                            {
                                id:                             2,
                                tag:                            ["b", "B"],
                                accumulatedEffortInProcessStep: 1,
                                elapsedTimeInProcessStep:       1
                            }
                        ],
                        workItemFlow: 0
                    },
                    {
                        id:          "second",
                        normEffort:  5,
                        workItems:   [
                            {
                                id:                             3,
                                tag:                            ["c", "C"],
                                accumulatedEffortInProcessStep: 2,
                                elapsedTimeInProcessStep:       3
                            }
                        ],
                        workItemFlow: 0
                    }
                ]
            }
        ],
        outputBasket: {
            workItems: [] 
        },
        workerUtilization: [
            {
                worker: "Harry",
                utilization: 80
            }
        ]
    },
// clock == 1
    {
        id: "Mock-Machine",
        valueChains: [
            {
                id: "blue",
                totalValueAdd: 20,
                processSteps: [
                    {
                        id:          "first",
                        normEffort:  1,
                        workItems:   [
                            {
                                id:                             2,
                                tag:                            ["b", "B"],
                                accumulatedEffortInProcessStep: 1,
                                elapsedTimeInProcessStep:       2
                            }
                        ],
                        workItemFlow: 1
                    },
                    {
                        id:          "second",
                        normEffort:  5,
                        workItems:   [
                            {
                                id:                             1,
                                tag:                            ["a", "A"],
                                accumulatedEffortInProcessStep: 0,
                                elapsedTimeInProcessStep:       0
                            },
                            {
                                id:                             3,
                                tag:                            ["c", "C"],
                                accumulatedEffortInProcessStep: 3,
                                elapsedTimeInProcessStep:       4
                            }
                        ],
                        workItemFlow: 0
                    }
                ]
            }
        ],
        outputBasket: {
            workItems: [] 
        },
        workerUtilization: [
            {
                worker: "Harry",
                utilization: 100
            },
            {
                worker: "Sally",
                utilization: 50
            }
        ]
    },
// clock == 1
    {
        id: "Mock-Machine",
        valueChains: [
            {
                id: "blue",
                totalValueAdd: 20,
                processSteps: [
                    {
                        id:          "first",
                        normEffort:  1,
                        workItems:   [
                            {
                                id:                             2,
                                tag:                            ["b", "B"],
                                accumulatedEffortInProcessStep: 1,
                                elapsedTimeInProcessStep:       2
                            }
                        ],
                        workItemFlow: 1
                    },
                    {
                        id:          "second",
                        normEffort:  5,
                        workItems:   [
                            {
                                id:                             1,
                                tag:                            ["a", "A"],
                                accumulatedEffortInProcessStep: 0,
                                elapsedTimeInProcessStep:       0
                            },
                            {
                                id:                             3,
                                tag:                            ["c", "C"],
                                accumulatedEffortInProcessStep: 3,
                                elapsedTimeInProcessStep:       4
                            }
                        ],
                        workItemFlow: 0
                    }
                ]
            }
        ],
        outputBasket: {
            workItems: [] 
        },
        workerUtilization: [
            {
                worker: "Harry",
                utilization: 100
            },
            {
                worker: "Sally",
                utilization: 40
            }
        ]
    },
// clock == 2
    {
        id: "Mock-Machine",
        valueChains: [
            {
                id: "blue",
                totalValueAdd: 20,
                processSteps: [
                    {
                        id:          "first",
                        normEffort:  1,
                        workItems:   [],
                        workItemFlow: 1
                    },
                    {
                        id:          "second",
                        normEffort:  5,
                        workItems:   [
                            {
                                id:                             1,
                                tag:                            ["a", "A"],
                                accumulatedEffortInProcessStep: 1,
                                elapsedTimeInProcessStep:       1
                            },
                            {
                                id:                             2,
                                tag:                            ["b", "B"],
                                accumulatedEffortInProcessStep: 3,
                                elapsedTimeInProcessStep:       3
                            }
                        ],
                        workItemFlow: 0
                    }
                ]
            }
        ],
        outputBasket: {
            workItems: [
                {
                    id:                             3,
                    tag:                            ["c", "C"],
                    accumulatedEffortInValueChain:  5,
                    valueOfValueChain:              20,
                    elapsedTimeInValueChain:        6                }
            ]
        },
        workerUtilization: [
            {
                worker: "Harry",
                utilization: 100
            },
            {
                worker: "Sally",
                utilization: 20
            }
        ]
    }
]

