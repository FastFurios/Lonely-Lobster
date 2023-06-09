import { Component, OnInit, HostListener } from '@angular/core';
//import { Options } from '@angular-slider/ngx-slider';
import { WorkitemsInventoryService } from '../shared/workitems-inventory.service'
import { I_IterationRequest,I_SystemState } from '../shared/io_api_definitions'
import { Observable } from "rxjs"
import { WorkorderFeederService } from '../shared/workorder-feeder.service';


type UiBoxSize = {
  width:  number
  height: number
}
const UiSystemHeaderHeight = 200  // px
const UiWorkerStatsHeight  = 200  // px


@Component({
  selector: 'app-system',
  templateUrl: './system.component.html',
  styleUrls: ['./system.component.css']
})
export class SystemComponent implements OnInit {
  systemState$: Observable<I_SystemState> 
  systemState: I_SystemState
  systemStateStatic: I_SystemState

  numValueChains: number

  numIterationsToExecute: number = 1
  numIterationsToGo: number

  vcsBoxSize: UiBoxSize // = { width: 0, height: 0 }   // all Value Chains
  vcBoxSize:  UiBoxSize // = { width: 0, height: 0 }   // a single Value Chain
  obBoxSize:  UiBoxSize // = { width: 0, height: 0 }   // Output Basket
  

  constructor( private wiInvSrv: WorkitemsInventoryService,
               private wof:      WorkorderFeederService ) { 
    this.nextIterationStates()
    this.systemState$.subscribe(systemState => { this.numValueChains = systemState.valueChains.length; this.calcSizeOfUiBoxes() })
  }

  ngOnInit(): void {
    this.calcSizeOfUiBoxes()
  }
 
  @HostListener('window:resize', ['$event'])
  onResize(event: Event) {
    this.calcSizeOfUiBoxes()
  }

  private calcSizeOfUiBoxes(): void {
    this.vcsBoxSize = { 
      width:  Math.round( window.innerWidth / 2), 
      height: Math.round(window.innerHeight - UiSystemHeaderHeight - UiWorkerStatsHeight)
    }
    this.vcBoxSize = { 
      width:  this.vcsBoxSize.width, 
      height: this.vcsBoxSize.height / this.numValueChains
    }
    this.obBoxSize = { 
      width:  Math.round( window.innerWidth  - this.vcBoxSize.width), 
      //heigth: Math.round((window.innerHeight - UiSystemHeaderHeight - UiWorkerStatsHeight))
      height: this.vcsBoxSize.height
    }
  }

  private nextIterationSubscriber(syst: I_SystemState) {
    this.systemState = syst 
    console.log("SystemComponent.nextIterationSubscriber(): systemState.outputBasket.workitems.length=" + this.systemState.outputBasket.workItems.length)
    this.numIterationsToGo--
    if (this.numIterationsToGo > 0)
      this.nextIterationStates()
  }

  public nextIterationStates(): void {
    //console.log(this.systemState$)
    this.systemState$ = this.wiInvSrv.nextSystemStateOnInput(this.wof.iterationRequest4AllVcs())
    this.systemState$.subscribe(syst => this.nextIterationSubscriber(syst))
  }

  public nextIterationHandler() {
    this.numIterationsToGo = this.numIterationsToExecute
    this.nextIterationStates()
  }

}
