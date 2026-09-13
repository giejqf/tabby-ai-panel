import { AfterViewInit, Component, ElementRef, EventEmitter, Input, OnDestroy, OnInit, Output, ViewChild } from '@angular/core'
import { Subscription } from 'rxjs'
import { PlatformService, NotificationsService } from 'tabby-core'
import { AgentService, AgentPhase } from '../../core/agent.service'
import { TerminalRegistryService } from '../../core/terminal-registry.service'
import { AssistantMessage, SessionMessage } from '../../types/session'

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

    expandedReasoning = new Set<string>()
    private nearBottom = true
    private sub = new Subscription()
    private pendingScroll = false

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
    ) {}

    ngOnInit (): void {
        this.sub.add(this.agent.state$.subscribe(() => this.scheduleScroll()))
    }

    ngAfterViewInit (): void {
        this.scrollToBottom(true)
    }

    ngOnDestroy (): void {
        this.sub.unsubscribe()
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

    onScroll (): void {
        const el = this.scroller?.nativeElement
        if (!el) return
        this.nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    }

    /** Copy / insert buttons inside rendered markdown code blocks. */
    onClick (event: MouseEvent): void {
        const target = event.target as HTMLElement | null
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

    private scheduleScroll (): void {
        if (this.pendingScroll) return
        this.pendingScroll = true
        requestAnimationFrame(() => {
            this.pendingScroll = false
            this.scrollToBottom(false)
        })
    }

    private scrollToBottom (force: boolean): void {
        const el = this.scroller?.nativeElement
        if (!el) return
        if (force || this.nearBottom) {
            el.scrollTop = el.scrollHeight
        }
    }
}
