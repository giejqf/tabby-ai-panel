import { Component, HostListener, OnDestroy, OnInit } from '@angular/core'
import { Subscription } from 'rxjs'
import { AgentService, SessionTerminalView } from '../../core/agent.service'
import { TerminalRegistryService } from '../../core/terminal-registry.service'

@Component({
    selector: 'ai-terminal-strip',
    templateUrl: './terminal-strip.component.html',
    styleUrls: ['./terminal-strip.component.scss'],
})
export class TerminalStripComponent implements OnInit, OnDestroy {
    views: SessionTerminalView[] = []
    hidden: SessionTerminalView[] = []
    hiddenMenu = false
    /** Viewport position of the hidden-terminals menu (position: fixed, so the strip's scroll clipping cannot hide it). */
    menuPos = { top: 0, left: 0 }
    reconnecting = new Set<string>()
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
        if (this.reconnecting.has(v.key)) {
            return `${v.key} · reconnecting…`
        }
        if (!v.entry) {
            return `${v.key} · ${v.connection} · closed${v.canReconnect ? ' · click to reopen it' : ''}`
        }
        const s = v.status.replace('_', ' ')
        return `${v.key} · ${v.connection} · ${s}${v.used ? '' : ' · not used in this session yet'}`
    }

    async click (v: SessionTerminalView, event: MouseEvent): Promise<void> {
        event.stopPropagation()
        this.closeMenu()
        if (v.entry) {
            this.registry.focus(v.entry)
            return
        }
        if (v.canReconnect && !this.reconnecting.has(v.key)) {
            // a closed tab: reopen its profile straight away
            this.reconnecting.add(v.key)
            try {
                await this.agent.reconnectTerminal(v.key)
            } finally {
                this.reconnecting.delete(v.key)
                this.refresh()
            }
        }
    }

    remove (v: SessionTerminalView, event: MouseEvent): void {
        event.stopPropagation()
        this.closeMenu()
        this.agent.removeTerminal(v.key)
        this.refresh()
    }

    toggleHiddenMenu (event: MouseEvent): void {
        event.stopPropagation()
        if (!this.hiddenMenu) {
            // place the menu just under the chip, kept inside the window
            const chip = (event.target as HTMLElement | null)?.closest('.chip-wrap') as HTMLElement | null
            const rect = chip?.getBoundingClientRect()
            if (rect) {
                this.menuPos = { top: rect.bottom + 4, left: Math.max(4, Math.min(rect.left, window.innerWidth - 300)) }
            }
        }
        this.hiddenMenu = !this.hiddenMenu
    }

    restore (v: SessionTerminalView): void {
        this.agent.restoreTerminal(v.key)
        this.refresh()
        if (!this.hidden.length) this.hiddenMenu = false
    }

    @HostListener('document:click')
    closeMenu (): void {
        this.hiddenMenu = false
    }

    private refresh (): void {
        this.views = this.agent.terminalViews()
        this.hidden = this.agent.removedTerminalViews()
    }
}
