import { Injectable } from '@angular/core'
import { BaseTerminalTabComponent, TerminalDecorator } from 'tabby-terminal'
import { TerminalRegistryService } from './core/terminal-registry.service'

/** Registers every terminal tab with the registry as it starts. */
@Injectable()
export class AiPanelTerminalDecorator extends TerminalDecorator {
    constructor (private registry: TerminalRegistryService) {
        super()
    }

    attach (terminal: BaseTerminalTabComponent<any>): void {
        super.attach(terminal)
        this.registry.register(terminal)
    }

    detach (terminal: BaseTerminalTabComponent<any>): void {
        this.registry.unregister(terminal)
        super.detach(terminal)
    }
}
