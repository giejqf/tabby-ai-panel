import { AfterViewInit, Component, ElementRef, EventEmitter, Input, NgZone, OnDestroy, OnInit, Output, ViewChild } from '@angular/core'
import { Subscription } from 'rxjs'
import { PlatformService, NotificationsService } from 'tabby-core'
import { AgentService, AgentPhase } from '../../core/agent.service'
import { TerminalRegistryService } from '../../core/terminal-registry.service'
import { AssistantMessage, SessionMessage } from '../../types/session'
import { StickyScroll } from '../util/sticky-scroll'

@Component({
    selector: 'ai-transcript',
    templateUrl: './transcript.component.html',
    styleUrls: ['./transcript.component.scss'],
})
export class TranscriptComponent implements OnInit, AfterViewInit, OnDestroy {
    @Input() messages: SessionMessage[] = []
    @Input() phase: AgentPhase = 'idle'
    @Input() showReasoning = true
    @Input() configured = false
    @Output() openSettings = new EventEmitter<void>()
    @ViewChild('scroller') scroller?: ElementRef<HTMLElement>
    @ViewChild('content') content?: ElementRef<HTMLElement>

    expandedReasoning = new Set<string>()
    /** Scrolled up, away from the newest content. */
    detached = false
    /** Content arrived below while detached. */
    unseen = false
    private sticky?: StickyScroll
    private sub = new Subscription()
    private sessionId?: string
    private lastMessageId?: string

    readonly examples = [
        'What is running on port 8080 in @Linux-1?',
        'Set up a WireGuard tunnel between @Linux-1 and @Linux-2',
        'Copy ~/app/config.yaml from Linux-1 to the same path on Linux-2',
        'Why did the last command fail?',
    ]

    constructor (
        private agent: AgentService,
        private registry: TerminalRegistryService,
        private platform: PlatformService,
        private notifications: NotificationsService,
        private zone: NgZone,
    ) {}

    ngOnInit (): void {
        this.sub.add(this.agent.state$.subscribe(s => {
            const messages = s.session.messages
            const last = messages[messages.length - 1] as SessionMessage | undefined
            const switched = this.sessionId !== undefined && s.session.id !== this.sessionId
            // the user's own new message always brings the view back to the live end
            const sent = !switched && !!last && last.id !== this.lastMessageId && last.role === 'user'
            this.sessionId = s.session.id
            this.lastMessageId = last?.id
            if (switched || sent) {
                // after change detection has rendered the new messages
                requestAnimationFrame(() => this.sticky?.scrollToBottom())
            }
        }))
    }

    ngAfterViewInit (): void {
        const scroller = this.scroller!.nativeElement
        // scroll and resize callbacks fire constantly while streaming; only
        // re-enter Angular when the jump button has to change
        this.zone.runOutsideAngular(() => {
            this.sticky = new StickyScroll(scroller, {
                content: this.content!.nativeElement,
                onChange: state => this.zone.run(() => {
                    this.detached = !state.stuck
                    this.unseen = state.unseen
                }),
            })
        })
        this.sticky!.scrollToBottom()
    }

    ngOnDestroy (): void {
        this.sub.unsubscribe()
        this.sticky?.destroy()
    }

    /** Label for the jump button: what is waiting at the bottom, if anything. */
    get jumpLabel (): string {
        if (this.phase === 'awaiting_approval') return 'Approval needed'
        if (this.phase === 'awaiting_user') return 'Question for you'
        if (this.unseen) return 'New output'
        return ''
    }

    get jumpNeedsAttention (): boolean {
        return this.phase === 'awaiting_approval' || this.phase === 'awaiting_user'
    }

    jumpToBottom (): void {
        this.sticky?.scrollToBottom(true)
    }

    trackMessage (_i: number, m: SessionMessage): string {
        return m.id
    }

    isStreaming (m: SessionMessage): boolean {
        return m.role === 'assistant' && this.phase === 'thinking' && m === this.messages[this.messages.length - 1]
    }

    isLastAssistant (m: SessionMessage): boolean {
        return m === [...this.messages].reverse().find(x => x.role === 'assistant')
    }

    reasoningExpanded (m: AssistantMessage): boolean {
        if (this.expandedReasoning.has(m.id)) return true
        // while the model is still thinking (no answer text yet) show what it is doing
        return this.isStreaming(m) && !m.content && !m.toolCalls.length
    }

    toggleReasoning (m: AssistantMessage): void {
        if (this.expandedReasoning.has(m.id)) {
            this.expandedReasoning.delete(m.id)
        } else {
            this.expandedReasoning.add(m.id)
        }
    }

    useExample (text: string): void {
        this.agent.send(text)
    }

    /** Expand/collapse toggles, and copy / insert buttons inside rendered markdown code blocks. */
    onClick (event: MouseEvent): void {
        const target = event.target as HTMLElement | null
        if (target?.closest('.reasoning-toggle, .tc-output-toggle')) {
            // expanding/collapsing a block: keep it where it is rather than following the bottom
            this.sticky?.holdPosition()
            return
        }
        const button = target?.closest('[data-action]') as HTMLElement | null
        if (!button) return
        const block = button.closest('.code-block')
        const code = block?.querySelector('pre code')?.textContent ?? ''
        event.preventDefault()
        event.stopPropagation()
        if (button.dataset.action === 'copy') {
            this.platform.setClipboard({ text: code })
            this.flash(button, 'Copied')
        } else if (button.dataset.action === 'insert') {
            const active = this.registry.getActive()
            if (!active) {
                this.notifications.error('No active terminal to insert into')
                return
            }
            this.registry.sendInput(active, code.replace(/\n$/, ''))
            this.registry.focus(active)
            this.flash(button, 'Inserted')
        }
    }

    private flash (button: HTMLElement, text: string): void {
        const original = button.textContent
        button.textContent = text
        setTimeout(() => { button.textContent = original }, 1200)
    }
}
