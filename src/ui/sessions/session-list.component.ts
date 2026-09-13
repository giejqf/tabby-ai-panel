import { Component, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core'
import { Subscription } from 'rxjs'
import { SessionStoreService } from '../../core/session-store.service'
import { AgentService } from '../../core/agent.service'
import { SessionSummary } from '../../types/session'

@Component({
    selector: 'ai-session-list',
    templateUrl: './session-list.component.html',
    styleUrls: ['./session-list.component.scss'],
})
export class SessionListComponent implements OnInit, OnDestroy {
    @Input() currentId = ''
    @Output() open = new EventEmitter<string>()
    @Output() create = new EventEmitter<void>()
    @Output() close = new EventEmitter<void>()
    @Output() openFolder = new EventEmitter<void>()

    query = ''
    sessions: SessionSummary[] = []
    renamingId: string | null = null
    renameDraft = ''
    private sub = new Subscription()

    constructor (
        private store: SessionStoreService,
        private agent: AgentService,
    ) {}

    ngOnInit (): void {
        this.sub.add(this.store.summaries$.subscribe(list => { this.sessions = list }))
        this.sessions = this.store.list()
    }

    ngOnDestroy (): void {
        this.sub.unsubscribe()
    }

    get filtered (): SessionSummary[] {
        const q = this.query.trim().toLowerCase()
        if (!q) return this.sessions
        return this.sessions.filter(s =>
            s.title.toLowerCase().includes(q) ||
            s.preview.toLowerCase().includes(q) ||
            s.terminalLabels.some(l => l.toLowerCase().includes(q)))
    }

    trackSession (_i: number, s: SessionSummary): string {
        return s.id
    }

    startRename (s: SessionSummary, event: Event): void {
        event.stopPropagation()
        this.renamingId = s.id
        this.renameDraft = s.title
    }

    commitRename (s: SessionSummary): void {
        if (this.renamingId !== s.id) return
        const title = this.renameDraft.trim()
        this.renamingId = null
        if (!title || title === s.title) return
        if (s.id === this.currentId) {
            this.agent.renameSession(title)
        } else {
            const session = this.store.load(s.id)
            if (session) {
                session.title = title
                session.titleIsCustom = true
                this.store.save(session)
            }
        }
    }

    remove (s: SessionSummary, event: Event): void {
        event.stopPropagation()
        if (!confirm(`Delete session "${s.title}"? This cannot be undone.`)) return
        void this.agent.deleteSession(s.id)
    }
}
