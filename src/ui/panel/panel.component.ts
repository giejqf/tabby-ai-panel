import { Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core'
import { Subscription } from 'rxjs'
import { AppService, ConfigService, HotkeysService, PlatformService } from 'tabby-core'
import { SettingsTabComponent } from 'tabby-settings'
import { AgentService, AgentState } from '../../core/agent.service'
import { PanelHostService } from '../panel-host.service'
import { SessionStoreService } from '../../core/session-store.service'
import { ComposerComponent } from '../composer/composer.component'
import { CONFIG_KEY, DEFAULT_CONFIG, HOTKEY_IDS } from '../../types/config'
import { Session } from '../../types/session'
import { findHotkey } from '../../core/util/keystroke'

const PANEL_HOTKEY_IDS = Object.values(HOTKEY_IDS)

@Component({
    selector: 'ai-panel',
    templateUrl: './panel.component.html',
    styleUrls: ['./panel.component.scss'],
})
export class AiPanelComponent implements OnInit, OnDestroy {
    state!: AgentState
    session!: Session
    showSessions = false
    editingTitle = false
    titleDraft = ''
    @ViewChild(ComposerComponent) composer?: ComposerComponent
    @ViewChild('titleInput') titleInput?: ElementRef<HTMLInputElement>

    private sub = new Subscription()
    private dragging = false
    private hotkeysSuspended = false

    constructor (
        public agent: AgentService,
        public host: PanelHostService,
        public store: SessionStoreService,
        private app: AppService,
        private config: ConfigService,
        private platform: PlatformService,
        private hotkeys: HotkeysService,
        private element: ElementRef<HTMLElement>,
    ) {}

    ngOnInit (): void {
        this.sub.add(this.agent.state$.subscribe(s => {
            this.state = s
            this.session = s.session
        }))
    }

    ngOnDestroy (): void {
        this.sub.unsubscribe()
        this.resumeTabbyHotkeys()
    }

    // ---- keyboard
    //
    // Tabby routes hotkeys to the terminal tab that is logically focused, and
    // that stays true while the user types in this panel: Ctrl+V/Ctrl+Shift+V
    // would paste into the shell as well, Ctrl+C would send SIGINT to it.
    // So while DOM focus is inside the panel, Tabby's hotkeys are suspended
    // and the panel's own hotkeys are matched here instead.

    @HostListener('focusin')
    onFocusIn (): void {
        this.suspendTabbyHotkeys()
    }

    @HostListener('focusout', ['$event'])
    onFocusOut (event: FocusEvent): void {
        const next = event.relatedTarget as Node | null
        if (next && this.element.nativeElement.contains(next)) {
            return
        }
        this.resumeTabbyHotkeys()
    }

    @HostListener('keydown', ['$event'])
    onKeydown (event: KeyboardEvent): void {
        const id = findHotkey(this.config.store.hotkeys, PANEL_HOTKEY_IDS, event)
        if (id) {
            event.preventDefault()
            event.stopPropagation()
            this.host.runHotkey(id)
        }
    }

    private suspendTabbyHotkeys (): void {
        if (this.hotkeysSuspended) return
        this.hotkeysSuspended = true
        this.hotkeys.disable()
    }

    private resumeTabbyHotkeys (): void {
        if (!this.hotkeysSuspended) return
        this.hotkeysSuspended = false
        this.hotkeys.enable()
    }

    get side (): 'left' | 'right' {
        return this.host.currentSide
    }

    get configured (): boolean {
        return this.agent.configured
    }

    get showReasoning (): boolean {
        return this.config.store[CONFIG_KEY]?.showReasoning ?? DEFAULT_CONFIG.showReasoning
    }

    get sessionCount (): number {
        return this.store.list().length
    }

    get phaseLabel (): string {
        switch (this.state?.phase) {
            case 'thinking': return 'Thinking…'
            case 'tool': return 'Working…'
            case 'awaiting_approval': return 'Waiting for your approval'
            case 'awaiting_user': return 'Waiting for your answer'
            default: return ''
        }
    }

    hotkeyLabel (id: keyof typeof HOTKEY_IDS): string {
        const keys: string[] | undefined = this.config.store.hotkeys?.[HOTKEY_IDS[id]]
        return keys?.length ? keys[0].replace(/-/g, '+') : ''
    }

    focusComposer (): void {
        this.composer?.focus()
    }

    // ---- header actions

    async newSession (): Promise<void> {
        if (this.agent.busy && !confirm('The agent is still working. Stop it and start a new session?')) {
            return
        }
        await this.agent.newSession()
        this.showSessions = false
        this.focusComposer()
    }

    toggleSessions (): void {
        this.showSessions = !this.showSessions
    }

    async openSession (id: string): Promise<void> {
        if (this.agent.busy && !confirm('The agent is still working. Stop it and switch sessions?')) {
            return
        }
        if (await this.agent.openSession(id)) {
            this.showSessions = false
            this.focusComposer()
        }
    }

    openSettings (): void {
        this.app.openNewTabRaw({ type: SettingsTabComponent, inputs: { activeTab: 'ai-panel' } })
    }

    openDataFolder (): void {
        this.platform.openPath(this.store.rootDir)
    }

    close (): void {
        this.host.hide()
    }

    startEditTitle (): void {
        this.titleDraft = this.session.title
        this.editingTitle = true
        setTimeout(() => {
            this.titleInput?.nativeElement.focus()
            this.titleInput?.nativeElement.select()
        })
    }

    commitTitle (): void {
        if (this.editingTitle && this.titleDraft.trim() && this.titleDraft.trim() !== this.session.title) {
            this.agent.renameSession(this.titleDraft)
        }
        this.editingTitle = false
    }

    cancelEditTitle (): void {
        this.editingTitle = false
    }

    // ---- resize handle

    startResize (event: MouseEvent): void {
        event.preventDefault()
        this.dragging = true
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'
    }

    @HostListener('document:mousemove', ['$event'])
    onMouseMove (event: MouseEvent): void {
        if (!this.dragging) return
        const width = this.side === 'right' ? window.innerWidth - event.clientX : event.clientX
        this.host.setWidth(width)
    }

    @HostListener('document:mouseup')
    onMouseUp (): void {
        if (!this.dragging) return
        this.dragging = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        this.host.commitWidth()
    }
}
