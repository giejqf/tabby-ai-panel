import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core'
import { Subscription } from 'rxjs'
import { ConfigService } from 'tabby-core'
import { AgentService, AgentState } from '../../core/agent.service'
import { TerminalRegistryService } from '../../core/terminal-registry.service'
import { ApprovalMode } from '../../types/session'
import { CONFIG_KEY, HOTKEY_IDS } from '../../types/config'

interface MentionOption {
    key: string
    label: string
    connection: string
}

@Component({
    selector: 'ai-composer',
    templateUrl: './composer.component.html',
    styleUrls: ['./composer.component.scss'],
})
export class ComposerComponent implements OnInit, OnDestroy {
    @ViewChild('textarea') textarea?: ElementRef<HTMLTextAreaElement>
    draft = ''
    state!: AgentState
    mentionOptions: MentionOption[] = []
    mentionIndex = 0
    private mentionStart = -1
    private sub = new Subscription()

    readonly approvalModes: { value: ApprovalMode, label: string, hint: string }[] = [
        { value: 'ask', label: 'Ask for every action', hint: 'Every command needs your approval' },
        { value: 'auto_low', label: 'Auto-approve low-risk', hint: 'Read-only commands run without asking' },
        { value: 'auto_medium', label: 'Auto-approve low + medium', hint: 'Only destructive actions ask' },
        { value: 'auto_all', label: 'Auto-approve everything', hint: 'Only catastrophic patterns ask – use with care' },
    ]

    constructor (
        public agent: AgentService,
        private registry: TerminalRegistryService,
        private config: ConfigService,
    ) {}

    ngOnInit (): void {
        this.sub.add(this.agent.state$.subscribe(s => { this.state = s }))
    }

    ngOnDestroy (): void {
        this.sub.unsubscribe()
    }

    get busy (): boolean {
        return this.state?.phase !== 'idle'
    }

    get canSend (): boolean {
        return !this.busy && this.draft.trim().length > 0 && this.agent.configured
    }

    get model (): string {
        return this.config.store[CONFIG_KEY]?.model || 'default model'
    }

    get approvalMode (): ApprovalMode {
        return this.agent.approvalMode
    }

    get approvalHint (): string {
        return this.approvalModes.find(m => m.value === this.approvalMode)?.hint ?? ''
    }

    get tokenSummary (): string {
        const s = this.state?.session.stats
        if (!s || (!s.promptTokens && !s.completionTokens)) return ''
        return `${fmt(s.promptTokens)} in · ${fmt(s.completionTokens)} out`
    }

    get stopHotkey (): string {
        const keys: string[] | undefined = this.config.store.hotkeys?.[HOTKEY_IDS.stop]
        return keys?.length ? keys[0].replace(/-/g, '+') : ''
    }

    setApprovalMode (value: string): void {
        this.agent.setApprovalMode(value as ApprovalMode)
    }

    focus (): void {
        this.textarea?.nativeElement.focus()
    }

    send (): void {
        if (!this.canSend) return
        const text = this.draft
        this.draft = ''
        this.closeMentions()
        this.resize()
        void this.agent.send(text)
    }

    stop (): void {
        this.agent.stop()
    }

    onKeydown (event: KeyboardEvent): void {
        if (this.mentionOptions.length) {
            if (event.key === 'ArrowDown') {
                event.preventDefault()
                this.mentionIndex = (this.mentionIndex + 1) % this.mentionOptions.length
                return
            }
            if (event.key === 'ArrowUp') {
                event.preventDefault()
                this.mentionIndex = (this.mentionIndex - 1 + this.mentionOptions.length) % this.mentionOptions.length
                return
            }
            if (event.key === 'Enter' || event.key === 'Tab') {
                event.preventDefault()
                this.pickMention(this.mentionOptions[this.mentionIndex])
                return
            }
            if (event.key === 'Escape') {
                event.preventDefault()
                this.closeMentions()
                return
            }
        }
        if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey && !event.isComposing) {
            event.preventDefault()
            if (this.busy) return
            this.send()
        }
    }

    onInput (): void {
        this.resize()
        this.updateMentions()
    }

    pickMention (option: MentionOption): void {
        const ta = this.textarea?.nativeElement
        if (!ta || this.mentionStart < 0) return
        const before = this.draft.slice(0, this.mentionStart)
        const after = this.draft.slice(ta.selectionStart)
        const insert = `@${option.label} `
        this.draft = before + insert + after
        this.closeMentions()
        setTimeout(() => {
            const pos = before.length + insert.length
            ta.focus()
            ta.setSelectionRange(pos, pos)
            this.resize()
        })
    }

    closeMentions (): void {
        this.mentionOptions = []
        this.mentionStart = -1
        this.mentionIndex = 0
    }

    private updateMentions (): void {
        const ta = this.textarea?.nativeElement
        if (!ta) return
        const caret = ta.selectionStart
        const before = this.draft.slice(0, caret)
        const match = /(^|\s)@([^\s@]*)$/.exec(before)
        if (!match) {
            this.closeMentions()
            return
        }
        const query = match[2].toLowerCase()
        this.mentionStart = caret - match[2].length - 1
        const open = this.registry.list()
        this.mentionOptions = open
            .map(e => ({ key: this.agent.keyFor(e), label: e.label, connection: describe(e.descriptor) }))
            // terminals removed from the session have no key and cannot be mentioned
            .filter((o): o is MentionOption => !!o.key)
            .filter(o => !query || o.label.toLowerCase().includes(query) || o.key === query)
            .slice(0, 8)
        this.mentionIndex = 0
    }

    private resize (): void {
        const ta = this.textarea?.nativeElement
        if (!ta) return
        ta.style.height = 'auto'
        const needed = this.draft ? ta.scrollHeight : 0
        ta.style.height = needed ? `${Math.min(needed, 180)}px` : ''
        ta.classList.toggle('scrollable', needed > 180)
    }
}

function describe (d: { kind: string, host?: string, user?: string }): string {
    if (d.kind === 'ssh') return `${d.user ? d.user + '@' : ''}${d.host ?? ''}`
    return d.kind
}

function fmt (n: number): string {
    return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}
