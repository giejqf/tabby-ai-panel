import { Component, Input, OnChanges, SimpleChanges, ElementRef, ViewChild, AfterViewChecked } from '@angular/core'
import { ConfigService } from 'tabby-core'
import { AgentService } from '../../core/agent.service'
import { TerminalRegistryService } from '../../core/terminal-registry.service'
import { ToolCallRecord } from '../../types/session'
import { HOTKEY_IDS } from '../../types/config'
import { countLines } from '../../core/util/text'

@Component({
    selector: 'ai-tool-call',
    templateUrl: './tool-call.component.html',
    styleUrls: ['./tool-call.component.scss'],
})
export class ToolCallComponent implements OnChanges, AfterViewChecked {
    @Input() call!: ToolCallRecord
    @ViewChild('outputBox') outputBox?: ElementRef<HTMLElement>

    expanded: boolean | null = null    // null = automatic
    answerDraft = ''
    showApproveMenu = false
    private lastProgressLength = 0

    constructor (
        private agent: AgentService,
        private registry: TerminalRegistryService,
        private config: ConfigService,
    ) {}

    ngOnChanges (_changes: SimpleChanges): void {
        this.lastProgressLength = 0
    }

    ngAfterViewChecked (): void {
        // keep the live output tail in view while a command is running
        const box = this.outputBox?.nativeElement
        if (box && this.isRunning) {
            const len = this.call.progress?.length ?? 0
            if (len !== this.lastProgressLength) {
                this.lastProgressLength = len
                box.scrollTop = box.scrollHeight
            }
        }
    }

    // ---- derived display data

    get icon (): string {
        switch (this.call.name) {
            case 'run_command': return 'fa-terminal'
            case 'send_keys': return 'fa-keyboard'
            case 'read_terminal': return 'fa-eye'
            case 'wait_for_output': return 'fa-hourglass-half'
            case 'list_terminals': return 'fa-list'
            case 'ask_user': return 'fa-question-circle'
            case 'open_terminal': return 'fa-plus-square'
            case 'focus_terminal': return 'fa-crosshairs'
            default: return 'fa-cog'
        }
    }

    get title (): string {
        const t = this.call.terminalLabel
        switch (this.call.name) {
            case 'run_command': return t ? `Run in ${t}` : 'Run command'
            case 'send_keys': return t ? `Send keys to ${t}` : 'Send keys'
            case 'read_terminal': return t ? `Read ${t}` : 'Read terminal'
            case 'wait_for_output': return t ? `Wait on ${t}` : 'Wait for output'
            case 'list_terminals': return 'List terminals'
            case 'ask_user': return 'Question for you'
            case 'open_terminal': return `Open "${this.call.args?.profile ?? ''}"`
            case 'focus_terminal': return t ? `Focus ${t}` : 'Focus terminal'
            default: return this.call.name
        }
    }

    /** The command / keys line shown in monospace. */
    get commandText (): string | null {
        switch (this.call.name) {
            case 'run_command': return String(this.call.args?.command ?? '')
            case 'send_keys': {
                const keys = this.call.args?.keys
                return Array.isArray(keys) ? keys.map(k => /^[a-z]+(-[a-z])?$/i.test(k) && k.length > 1 ? `⟨${k}⟩` : k).join(' ') : String(keys ?? '')
            }
            case 'wait_for_output':
                return this.call.args?.until_regex ? `until /${this.call.args.until_regex}/` : null
            default: return null
        }
    }

    get explanation (): string | null {
        const e = this.call.args?.explanation
        return typeof e === 'string' && e.trim() ? e : null
    }

    get statusLabel (): string {
        switch (this.call.status) {
            case 'pending_approval': return 'Needs approval'
            case 'awaiting_user': return 'Waiting for you'
            case 'running': return this.runningLabel
            case 'done': return this.doneLabel
            case 'declined': return 'Declined'
            case 'error': return 'Error'
            case 'cancelled': return 'Cancelled'
            default: return this.call.status
        }
    }

    private get runningLabel (): string {
        if (this.call.name === 'wait_for_output') return 'Waiting…'
        if (this.call.name === 'run_command' || this.call.name === 'send_keys') return 'Running…'
        return 'Working…'
    }

    private get doneLabel (): string {
        switch (this.call.exitState) {
            case 'prompt': return 'Done'
            case 'matched': return 'Matched'
            case 'awaiting_input': return 'Needs input'
            case 'alt_screen': return 'Full-screen app'
            case 'idle': return 'No new output'
            case 'timeout': return 'Still running'
            case 'reset': return 'Terminal reset'
            case 'cancelled': return 'Cancelled'
            default: return 'Done'
        }
    }

    get statusClass (): string {
        if (this.call.status === 'done') {
            if (['awaiting_input', 'timeout', 'idle', 'reset'].includes(this.call.exitState ?? '')) return 'attention'
            return 'ok'
        }
        return this.call.status
    }

    get isRunning (): boolean {
        return this.call.status === 'running'
    }

    get isPending (): boolean {
        return this.call.status === 'pending_approval'
    }

    get hardBlocked (): boolean {
        return !!this.call.progress && this.call.status === 'pending_approval'
    }

    /** Result body without the bracketed status header line. */
    get outputText (): string {
        if (this.call.status === 'declined' || this.call.status === 'cancelled') return ''
        const src = this.isRunning ? (this.call.progress ?? '') : (this.call.result ?? '')
        if (!src) return ''
        const lines = src.split('\n')
        if (lines[0].startsWith('[') && lines[0].endsWith(']')) {
            lines.shift()
            // drop the hint line that follows a non-prompt state
            if (lines.length && /^(The program is waiting|Interact with|Use wait_for_output|Check the current state)/.test(lines[0])) {
                lines.shift()
            }
        }
        return lines.join('\n').replace(/^\(no output\)$/, '')
    }

    get outputLines (): number {
        return countLines(this.outputText)
    }

    get hasOutput (): boolean {
        return this.outputText.trim().length > 0
    }

    get showOutput (): boolean {
        if (!this.hasOutput) return false
        if (this.expanded !== null) return this.expanded
        if (this.isRunning) return true
        if (this.call.status === 'error') return true
        if (this.call.name === 'ask_user') return false
        return this.outputLines <= 8 && this.outputText.length < 800
    }

    toggleOutput (): void {
        this.expanded = !this.showOutput
    }

    get terminalOpen (): boolean {
        return !!this.call.terminalKey && !!this.agent.entryFor(this.call.terminalKey)
    }

    /** The command may still be running in the terminal – offer an interrupt. */
    get canInterrupt (): boolean {
        if (!this.terminalOpen) return false
        if (!['run_command', 'send_keys', 'wait_for_output'].includes(this.call.name)) return false
        if (this.call.status === 'cancelled') return true
        return this.call.status === 'done' && ['timeout', 'idle', 'awaiting_input'].includes(this.call.exitState ?? '')
    }

    focusTerminal (): void {
        const entry = this.call.terminalKey ? this.agent.entryFor(this.call.terminalKey) : null
        if (entry) this.registry.focus(entry)
    }

    interrupt (): void {
        const entry = this.call.terminalKey ? this.agent.entryFor(this.call.terminalKey) : null
        if (entry) {
            this.registry.sendInput(entry, '\x03')
            this.registry.reveal(entry)
        }
    }

    hotkey (id: 'approve' | 'deny'): string {
        const keys: string[] | undefined = this.config.store.hotkeys?.[HOTKEY_IDS[id]]
        return keys?.length ? keys[0].replace(/-/g, '+') : ''
    }

    // ---- actions

    approve (): void {
        this.showApproveMenu = false
        this.agent.approve(this.call.id)
    }

    approveAndAutoLow (): void {
        this.showApproveMenu = false
        this.agent.approve(this.call.id, { autoApproveLow: true })
    }

    deny (): void {
        this.showApproveMenu = false
        this.agent.deny(this.call.id)
    }

    answer (text?: string): void {
        const value = (text ?? this.answerDraft).trim()
        if (!value) return
        this.agent.answer(this.call.id, value)
        this.answerDraft = ''
    }
}
