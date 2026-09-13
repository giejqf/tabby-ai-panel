import { Component, HostListener, OnDestroy, OnInit } from '@angular/core'
import { Subscription } from 'rxjs'
import { AgentService, SessionTerminalView } from '../../core/agent.service'
import { TerminalEntry, TerminalRegistryService } from '../../core/terminal-registry.service'

@Component({
    selector: 'ai-terminal-strip',
    templateUrl: './terminal-strip.component.html',
    styleUrls: ['./terminal-strip.component.scss'],
})
export class TerminalStripComponent implements OnInit, OnDestroy {
    views: SessionTerminalView[] = []
    menuFor: string | null = null
    candidates: TerminalEntry[] = []
    private sub = new Subscription()

    constructor (
        private agent: AgentService,
        private registry: TerminalRegistryService,
    ) {}

    ngOnInit (): void {
        this.sub.add(this.agent.state$.subscribe(() => this.refresh()))
        this.sub.add(this.registry.changed$.subscribe(() => this.refresh()))
        // status dots depend on time (recent output) – tick gently
        const timer = setInterval(() => this.refresh(), 1500)
        this.sub.add({ unsubscribe: () => clearInterval(timer) } as Subscription)
    }

    ngOnDestroy (): void {
        this.sub.unsubscribe()
    }

    trackView (_i: number, v: SessionTerminalView): string {
        return v.key
    }

    statusTitle (v: SessionTerminalView): string {
        const s = v.status.replace('_', ' ')
        return `${v.key} · ${v.connection} · ${s}${v.used ? '' : ' · not used in this session yet'}`
    }

    click (v: SessionTerminalView, event: MouseEvent): void {
        event.stopPropagation()
        if (v.entry) {
            this.registry.focus(v.entry)
            this.menuFor = null
        } else {
            this.toggleMenu(v.key)
        }
    }

    openMenu (v: SessionTerminalView, event: MouseEvent): void {
        event.preventDefault()
        event.stopPropagation()
        this.toggleMenu(v.key)
    }

    private toggleMenu (key: string): void {
        if (this.menuFor === key) {
            this.menuFor = null
            return
        }
        // open terminals that could be attached to this key
        this.candidates = this.registry.list()
        this.menuFor = key
    }

    attach (key: string, entry: TerminalEntry): void {
        this.agent.bindTerminal(key, entry)
        this.menuFor = null
    }

    async reconnect (v: SessionTerminalView): Promise<void> {
        this.menuFor = null
        await this.agent.reconnectTerminal(v.key)
    }

    @HostListener('document:click')
    closeMenu (): void {
        this.menuFor = null
    }

    private refresh (): void {
        this.views = this.agent.terminalViews()
    }
}
