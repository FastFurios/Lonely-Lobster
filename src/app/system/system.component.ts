import { Component, OnInit, OnChanges, HostListener } from '@angular/core';
import { Observable } from "rxjs"
import { WorkitemsInventoryService } from '../shared/workitems-inventory.service'
import { I_SystemState, I_SystemStatistics, I_ValueChainStatistics, PsWorkerUtilization, ValueChainId, VcExtended } from '../shared/io_api_definitions'
import { WorkorderFeederService } from '../shared/workorder-feeder.service';
import { UiBoxSize, UiBoxMarginToWindow, UiSystemHeaderHeight, UiWorkerStatsHeight } from '../shared/ui-boxes-definitions';

// =======================================================================================
// SYSTEM COMPONENT
// =======================================================================================

@Component({
  selector: 'app-system',
  templateUrl: './system.component.html',
  styleUrls: ['./system.component.css']
})
export class SystemComponent implements OnInit, OnChanges {
  systemState$:       Observable<I_SystemState> 
  systemState:        I_SystemState
  systemStatistics$:  Observable<I_SystemStatistics>
  systemStatistics:   I_SystemStatistics
  vcsExtended:        VcExtended[] 
          
  numValueChains:     number

  numIterationsToExecute: number = 1
  numIterationsToGo: number
  
  constructor( private wiInvSrv: WorkitemsInventoryService,
               private wof:      WorkorderFeederService   ) { }

  ngOnInit(): void {
    this.calcSizeOfUiBoxes()
  }
 
  ngOnChanges(): void {
    this.calcSizeOfUiBoxes()
  }

  // ---------------------------------------------------------------------------------------
  // iterating, reseting, stopping
  // ---------------------------------------------------------------------------------------

  private updateVcsExtended() {
    this.vcsExtended = this.systemState.valueChains
                              .map(vc => { 
                                return {
                                  vc:       vc,
                                  wosUtil:  this.workersUtilOfValueChain(vc.id),
                                  flowStats:this.flowStatsOfValueChain(vc.id)
                                }
                              })

  }


  private nextIterationSubscriber(systemState: I_SystemState) {
    this.systemState = systemState 
    this.calcSizeOfUiBoxes()
    // add to valuechains data also the corresponding workers with their process step asignments and utilization plus the flow statistics  
    this.updateVcsExtended()

    console.log("SystemComponent.nextIterationSubscriber(): this.vcsExtended=")                          
    console.log(this.vcsExtended)  

    this.numIterationsToGo--
    if (this.numIterationsToGo > 0)
      this.nextIterationStates()
  }

  public nextIterationStates(): void {
    this.systemState$ = this.wiInvSrv.nextSystemStateOnInput(this.wof.iterationRequest4AllVcs())
    this.systemState$.subscribe(systemState => this.nextIterationSubscriber(systemState))
  }

  // ---------------------------------------------------------------------------------------
  // <button> handlers
  // ---------------------------------------------------------------------------------------

  public nextIterationHandler() {
    this.numIterationsToGo = this.numIterationsToExecute
    this.nextIterationStates()
  }
  
  public stopIterationHandler() {
    this.numIterationsToGo = 0
  }

  public resetSystemHandler() {
    this.setOrResetSystem()
  }

  public fetchStatisticsHandler() {
    this.fetchSystemStatistics()
  }

  // ---------------------------------------------------------------------------------------
  // read system config file  
  // ---------------------------------------------------------------------------------------
  
  filename:         string = ""
  systemId:         string = "- empty -"
  objFromJsonFile:  any 

  public onFileSelected(e: any) { 
    const file: File = e.target.files[0] 
    this.filename = file.name
    const obs$ = this.readFileContentObs(file)
    obs$.subscribe((fileContent: string) => this.parseAndInititalize(fileContent))
  }

  private readFileContentObs(file: File): Observable<string> {
    return new Observable((subscriber) => {
      if (!file) subscriber.error("no file selected")
      if (file.size == 0) subscriber.error("selected file is empty")

      const reader = new FileReader()
      reader.onload = (e) => {
        if (!reader.result) subscriber.error("no result from reading")
        else subscriber.next(reader.result.toString())
      }
      reader.onerror = (error) => {
        subscriber.error(error);
      }
      reader.readAsText(file)
    })
  }

  // ---------------------------------------------------------------------------------------
  // initialize and reset system;
  // fetch statistics  
  // ---------------------------------------------------------------------------------------
  
  private parseAndInititalize(fileContent: string): void {
      this.objFromJsonFile = JSON.parse(fileContent) 
      this.systemId  = this.objFromJsonFile.system_id
      this.setOrResetSystem()
  }

  private setOrResetSystem() {
      this.numIterationsToGo = 0
      this.wof.initialize()
      this.systemState$ = this.wiInvSrv.systemStateOnInitialization(this.objFromJsonFile)
      this.systemState$.subscribe(systemState => this.nextIterationSubscriber(systemState))
      this.systemState$.subscribe(systemState => { this.numValueChains = systemState.valueChains.length; this.calcSizeOfUiBoxes() })
  }

  private fetchSystemStatistics() {
//  console.log("systemComponent.fetchSystemStatistics()")
    this.systemStatistics$ = this.wiInvSrv.currentSystemStats()
    this.systemStatistics$.subscribe(systemStatistics => {
      this.systemStatistics = systemStatistics
      this.updateVcsExtended()

      console.log("received system statistics response= ")
      console.log(this.systemStatistics)
/*
      this.systemStatistics.cycleTime.avg               = Math.round(this.systemStatistics.cycleTime.avg * 10) / 10
      this.systemStatistics.cycleTime.min               = Math.round(this.systemStatistics.cycleTime.min * 10) / 10
      this.systemStatistics.cycleTime.max               = Math.round(this.systemStatistics.cycleTime.max * 10) / 10
      this.systemStatistics.throughput.itemsPerTimeUnit  = Math.round(this.systemStatistics.throughput.itemsPerTimeUnit  * 10) / 10
      this.systemStatistics.throughput.valuePerTimeUnit = Math.round(this.systemStatistics.throughput.valuePerTimeUnit * 10) / 10
*/
    })
  }

  // ---------------------------------------------------------------------------------------
  // prepare workers shown for each value chain;
  // attach value-chain flow statistics to value chains
  // ---------------------------------------------------------------------------------------

  private workersUtilOfValueChain(vcId: ValueChainId): PsWorkerUtilization[] {
    return this.systemState.workersState.filter(woSt => woSt.assignments.some(vcPs => vcPs.valueChain == vcId))
                                        .map(woSt => { return { worker:               woSt.worker, 
                                                                utilization:          woSt.utilization,
                                                                assignedProcessSteps: woSt.assignments.map(vcPs => vcPs.processStep)}})
  }

  private flowStatsOfValueChain(vcId: ValueChainId): I_ValueChainStatistics | undefined {
    const aux = this.systemStatistics?.valueChains.find(vcFlowStats => vcFlowStats.id == vcId)
    console.log("SystemComponent.flowStatsOfValueChain(" + vcId + ")")
    console.log(aux)
    
    return aux
  }
  // ---------------------------------------------------------------------------------------
  // (re-)sizing of childs' UI boxes  
  // ---------------------------------------------------------------------------------------
  
  @HostListener('window:resize', ['$event'])
  onResize(/*event: Event*/) {
    this.calcSizeOfUiBoxes()
  }

  vcsBoxSize: UiBoxSize // all Value Chains
  vcBoxSize:  UiBoxSize // a single Value Chain
  obBoxSize:  UiBoxSize // Output Basket
  
  private calcSizeOfUiBoxes(): void {
    this.vcsBoxSize = { 
      width:  Math.round(window.innerWidth / 2 - UiBoxMarginToWindow), 
      height: window.innerHeight - UiSystemHeaderHeight - UiWorkerStatsHeight
    }
    this.vcBoxSize = { 
      width:  this.vcsBoxSize.width, 
      height: Math.round(this.vcsBoxSize.height / this.numValueChains)
    }
    this.obBoxSize = { 
      width:  window.innerWidth - this.vcBoxSize.width - UiBoxMarginToWindow,
      height: this.vcsBoxSize.height -20
    }
  }
}
