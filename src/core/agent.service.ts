import { Injectable, NgZone } from '@angular/core'
import { BehaviorSubject, Observable } from 'rxjs'
import { AppService, ConfigService, NotificationsService, ProfilesService, PartialProfile, Profile } from 'tabby-core'
import { BaseTerminalTabComponent } from 'tabby-terminal'
import {
    ApprovalMode, AssistantMessage, NoteMessage, RunExitState, Session, SessionTerminal, ToolCallRecord, UserMessage,
} from '../types/session'
import { AiPanelConfig, CONFIG_KEY, DEFAULT_CONFIG } from '../types/config'
import { ChatMessage, ChatProvider, ToolSpec } from './llm/types'
import { OpenAICompatibleProvider } from './llm/openai-compatible'
import { describeConnection, matchScore, TerminalEntry, TerminalRegistryService, isTerminalTab } from './terminal-registry.service'
import { TerminalRunner } from './terminal-runner'
import { SessionStoreService } from './session-store.service'
import { autoTitle, createSession, isEmptySession } from './session-utils'
import { ALL_TOOLS, findTool } from './tools'
import { ResolvedTerminal, TerminalListing, ToolContext } from './tools/types'
import { isAutoApproved } from './util/risk'
import { newId, nowIso } from './util/ids'
import { buildMessages } from './prompt-builder'
import { isAbortError } from './util/sse'
import systemPromptTemplate from '../prompts/system.md'

export type AgentPhase = 'idle' | 'thinking' | 'tool' | 'awaiting_approval' | 'awaiting_user'

export interface SessionTerminalView {
    key: string
    label: string
    connection: string
    used: boolean
    entry: TerminalEntry | null
    status: string
    isActive: boolean
    canReconnect: boolean
}

export interface AgentState {
    session: Session
    phase: AgentPhase
    error: string | null
    /** Incremented on every change so views can cheaply detect updates. */
    rev: number
}

const MAX_TOOL_ROUNDS = 80

/**
 * Drives the conversation: builds the prompt, streams the model, executes
 * tools with approval gating, and keeps the session persisted.
 */
@Injectable({ providedIn: 'root' })
export class AgentService {
    session: Session
    phase: AgentPhase = 'idle'
    error: string | null = null

    private state = new BehaviorSubject<AgentState>({ session: createSession(), phase: 'idle', error: null, rev: 0 })
    private rev = 0
    private emitTimer: any = null
    /** session terminal key → registry entry id */
    private bindings = new Map<string, string>()
    private abortController: AbortController | null = null
    private turnPromise: Promise<void> | null = null
    private pendingApprovals = new Map<string, (approved: boolean) => void>()
    private pendingQuestion: { toolCallId: string, resolve: (answer: string) => void } | null = null
    private runner: TerminalRunner
    private profilesCache: PartialProfile<Profile>[] = []

    get state$ (): Observable<AgentState> {
        return this.state.asObservable()
    }

    get busy (): boolean {
        return this.phase !== 'idle'
    }

    constructor (
        private config: ConfigService,
        private registry: TerminalRegistryService,
        private store: SessionStoreService,
        private profiles: ProfilesService,
        private notifications: NotificationsService,
        private app: AppService,
        private zone: NgZone,
    ) {
        this.runner = new TerminalRunner(registry)
        this.session = this.state.value.session
        this.registry.changed$.subscribe(() => this.emitSoon())
        // profiles live in the config store, which is loaded asynchronously
        this.config.ready$.subscribe({ complete: () => { void this.refreshProfiles() } })
    }

    // ---------------------------------------------------------------- config

    get settings (): AiPanelConfig {
        return { ...DEFAULT_CONFIG, ...(this.config.store?.[CONFIG_KEY] ?? {}) }
    }

    get configured (): boolean {
        return !!this.settings.endpoint.trim()
    }

    get approvalMode (): ApprovalMode {
        return this.session.approvalMode ?? this.settings.approvalMode
    }

    setApprovalMode (mode: ApprovalMode): void {
        this.session.approvalMode = mode
        this.touch()
    }

    makeProvider (): ChatProvider {
        const s = this.settings
        let extra: Record<string, any> = {}
        if (s.extraParamsText.trim()) {
            try {
                extra = JSON.parse(s.extraParamsText)
            } catch {
                this.notifications.error('AI panel: extra request parameters are not valid JSON')
            }
        }
        return new OpenAICompatibleProvider({ endpoint: s.endpoint, apiKey: s.apiKey, model: s.model, extraParams: extra })
    }

    // -------------------------------------------------------------- sessions

    async newSession (): Promise<Session> {
        await this.stopAndWait()
        if (isEmptySession(this.session) && !this.session.titleIsCustom) {
            // nothing worth keeping – just reset bindings
            this.bindings.clear()
            this.session = createSession()
            this.emit()
            return this.session
        }
        this.store.save(this.session)
        this.bindings.clear()
        this.session = createSession()
        this.error = null
        this.emit()
        return this.session
    }

    async openSession (id: string): Promise<boolean> {
        if (id === this.session.id) {
            return true
        }
        const loaded = this.store.load(id)
        if (!loaded) {
            this.notifications.error('AI panel: session not found')
            return false
        }
        await this.stopAndWait()
        if (!isEmptySession(this.session)) {
            this.store.save(this.session)
        }
        this.session = loaded
        this.error = null
        this.bindings.clear()
        const summary = this.rebindTerminals()
        if (summary) {
            this.addNote(summary, true)
        }
        this.emit()
        return true
    }

    renameSession (title: string): void {
        const t = title.trim()
        if (!t) return
        this.session.title = t
        this.session.titleIsCustom = true
        this.touch()
    }

    async deleteSession (id: string): Promise<void> {
        if (id === this.session.id) {
            await this.newSession()
        }
        this.store.delete(id)
    }

    // ------------------------------------------------------------- terminals

    /**
     * Key the model uses for this terminal; allocates one on first sight.
     * `null` when the terminal is bound to a key the user removed from the
     * session – such a terminal is invisible to the model.
     */
    keyFor (entry: TerminalEntry): string | null {
        for (const [key, id] of this.bindings) {
            if (id === entry.id) {
                // keep the stored label/descriptor in sync with renames and dynamic titles
                const t = this.session.terminals.find(x => x.key === key)
                if (t && (t.label !== entry.label || t.descriptor.title !== entry.descriptor.title || t.descriptor.customTitle !== entry.descriptor.customTitle)) {
                    t.label = entry.label
                    t.descriptor = { ...entry.descriptor }
                }
                return t?.removed ? null : key
            }
        }
        // a stored, currently unbound terminal that matches → reuse its key
        // (a removed one only when nothing the model may use matches as well)
        let best: { key: string, score: number } | null = null
        const stored = [...this.session.terminals].sort((a, b) => Number(!!a.removed) - Number(!!b.removed))
        for (const t of stored) {
            if (this.bindings.has(t.key)) continue
            const score = matchScore(t.descriptor, entry.descriptor)
            if (score >= 3 && (!best || score > best.score)) {
                best = { key: t.key, score }
            }
        }
        if (best) {
            this.bindings.set(best.key, entry.id)
            const t = this.session.terminals.find(x => x.key === best!.key)!
            t.label = entry.label
            t.descriptor = entry.descriptor
            return t.removed ? null : best.key
        }
        return this.allocateKey(entry)
    }

    /** Give the terminal a brand-new key, dropping any binding it had. */
    private allocateKey (entry: TerminalEntry): string {
        for (const [k, id] of [...this.bindings]) {
            if (id === entry.id) this.bindings.delete(k)
        }
        let n = this.session.terminals.length + 1
        while (this.session.terminals.some(t => t.key === `t${n}`)) n++
        const key = `t${n}`
        const now = nowIso()
        this.session.terminals.push({
            key,
            label: entry.label,
            descriptor: entry.descriptor,
            used: false,
            firstSeenAt: now,
            lastUsedAt: now,
        })
        this.bindings.set(key, entry.id)
        return key
    }

    /** The open terminal behind a key – `null` once the user removed the key from the session. */
    entryFor (key: string): TerminalEntry | null {
        if (this.session.terminals.find(x => x.key === key)?.removed) return null
        return this.liveEntry(key)
    }

    private liveEntry (key: string): TerminalEntry | null {
        const id = this.bindings.get(key)
        if (!id) return null
        const entry = this.registry.byId(id)
        return entry && !entry.closed ? entry : null
    }

    /** Open terminals the model may see, with their keys, in tab order. */
    private visibleTerminals (): { entry: TerminalEntry, key: string }[] {
        const out: { entry: TerminalEntry, key: string }[] = []
        for (const entry of this.registry.list()) {
            const key = this.keyFor(entry)
            if (key) out.push({ entry, key })
        }
        return out
    }

    /** Terminals relevant to this session (used ones first) plus open, unused ones. */
    terminalViews (): SessionTerminalView[] {
        this.visibleTerminals()   // make sure every open tab has a key
        return this.session.terminals.filter(t => !t.removed).map(t => this.viewFor(t)).filter(v => v.used || v.entry)
    }

    /** Terminals the user removed from this session (for the strip's restore menu). */
    removedTerminalViews (): SessionTerminalView[] {
        return this.session.terminals.filter(t => t.removed).map(t => this.viewFor(t)).filter(v => v.used || v.entry)
    }

    private viewFor (t: SessionTerminal): SessionTerminalView {
        const entry = this.liveEntry(t.key)
        return {
            key: t.key,
            label: entry?.label ?? t.label,
            connection: describeConnection(entry?.descriptor ?? t.descriptor),
            used: t.used,
            entry,
            status: entry ? this.registry.status(entry) : 'disconnected',
            isActive: !!entry && entry === this.registry.getActive(),
            canReconnect: !entry && !!(t.descriptor.profileId || t.descriptor.profileName),
        }
    }

    /**
     * Take a terminal away from the agent for the rest of this session: it
     * disappears from listings and snapshots and no tool can resolve it.
     * The tab itself stays open and the key stays reserved.
     */
    removeTerminal (key: string): void {
        const t = this.session.terminals.find(x => x.key === key)
        if (!t || t.removed) return
        t.removed = true
        this.addNote(`Removed ${key} "${t.label}" from this session – the agent can no longer see or use it.`)
    }

    /** Undo removeTerminal. */
    restoreTerminal (key: string): void {
        const t = this.session.terminals.find(x => x.key === key)
        if (!t?.removed) return
        delete t.removed
        this.addNote(`${key} "${t.label}" is back in this session.`)
    }

    /** Attach a stored key to an open terminal (used when a closed chip is reconnected). */
    bindTerminal (key: string, entry: TerminalEntry): void {
        for (const [k, id] of [...this.bindings]) {
            if (id === entry.id && k !== key) this.bindings.delete(k)
        }
        this.bindings.set(key, entry.id)
        const t = this.session.terminals.find(x => x.key === key)
        if (t) {
            t.label = entry.label
            t.descriptor = entry.descriptor
        }
        this.addNote(`${key} is now attached to "${entry.label}" (${describeConnection(entry.descriptor)}).`, true)
        this.touch()
    }

    /** Re-open the profile a disconnected terminal came from and attach it. */
    async reconnectTerminal (key: string): Promise<boolean> {
        const t = this.session.terminals.find(x => x.key === key)
        if (!t) return false
        await this.refreshProfiles()
        const profile = this.profilesCache.find(p => p.id === t.descriptor.profileId)
            ?? this.profilesCache.find(p => p.name === t.descriptor.profileName)
        if (!profile) {
            this.notifications.error(`AI panel: profile for ${t.label} no longer exists`)
            return false
        }
        const entry = await this.openProfile(profile)
        if (!entry) return false
        if (t.descriptor.customTitle) {
            // keep the name the user gave the original tab (same steps as Tabby's rename)
            this.zone.run(() => {
                entry.tab.setTitle(t.descriptor.customTitle!)
                entry.tab.customTitle = t.descriptor.customTitle!
                this.app.emitTabsChanged()
            })
            this.registry.list()
        }
        this.bindTerminal(key, entry)
        return true
    }

    private rebindTerminals (): string | null {
        const open = this.registry.list()
        const taken = new Set<string>()
        const reconnected: string[] = []
        const missing: string[] = []
        // removed terminals bind last (so they stay hidden without stealing a tab from a usable key)
        const candidates = [...this.session.terminals]
            .sort((a, b) => Number(!!a.removed) - Number(!!b.removed) || Number(b.used) - Number(a.used))
        for (const t of candidates) {
            let best: { entry: TerminalEntry, score: number } | null = null
            for (const e of open) {
                if (taken.has(e.id)) continue
                const score = matchScore(t.descriptor, e.descriptor)
                if (score >= 3 && (!best || score > best.score)) best = { entry: e, score }
            }
            if (best) {
                taken.add(best.entry.id)
                this.bindings.set(t.key, best.entry.id)
                t.label = best.entry.label
                if (t.used && !t.removed) reconnected.push(`${t.key} → "${best.entry.label}"`)
            } else if (t.used && !t.removed) {
                missing.push(`${t.key} "${t.label}" (${describeConnection(t.descriptor)})`)
            }
        }
        if (!reconnected.length && !missing.length) {
            return null
        }
        const parts = ['Session resumed.']
        if (reconnected.length) parts.push(`Re-attached: ${reconnected.join(', ')}.`)
        if (missing.length) parts.push(`Not open right now: ${missing.join(', ')} – reconnect them from the terminal bar or open_terminal before using them.`)
        return parts.join(' ')
    }

    private async openProfile (profile: PartialProfile<Profile>): Promise<TerminalEntry | null> {
        let tab: any = null
        try {
            tab = await this.zone.run(() => this.profiles.openNewTabForProfile(profile))
        } catch (e) {
            this.notifications.error(`AI panel: could not open ${profile.name}: ${(e as Error).message}`)
            return null
        }
        if (!tab) return null
        const terminalTab = isTerminalTab(tab) ? tab : (tab.getAllTabs?.() ?? []).find(isTerminalTab)
        if (!terminalTab) return null
        for (let i = 0; i < 40; i++) {
            const entry = this.registry.forTab(terminalTab as BaseTerminalTabComponent<any>) ?? this.registry.register(terminalTab)
            if (entry) {
                this.registry.list()   // assign labels
                return entry
            }
            await new Promise(r => setTimeout(r, 50))
        }
        return null
    }

    private async refreshProfiles (): Promise<void> {
        try {
            this.profilesCache = (await this.profiles.getProfiles()).filter(p => !p.isTemplate)
        } catch {
            this.profilesCache = []
        }
    }

    private terminalSnapshot (): string {
        const visible = this.visibleTerminals()
        if (!visible.length) {
            return '<terminals>\n(no terminal tabs open)\n</terminals>'
        }
        const active = this.registry.getActive()
        const lines = visible.map(({ entry: e, key }) => {
            const bits = [`${key} "${e.label}" — ${describeConnection(e.descriptor)} — ${this.registry.status(e)}`]
            if (e === active) bits.push('— active tab')
            return bits.join(' ')
        })
        return `<terminals>\n${lines.join('\n')}\n</terminals>`
    }

    // ---------------------------------------------------------- conversation

    async send (text: string): Promise<void> {
        const content = text.trim()
        if (!content || this.busy) {
            return
        }
        if (!this.configured) {
            this.error = 'Set the LLM endpoint in Settings → AI Panel first.'
            this.emit()
            return
        }
        const msg: UserMessage = {
            id: newId('m'),
            role: 'user',
            content,
            context: this.terminalSnapshot(),
            createdAt: nowIso(),
        }
        this.session.messages.push(msg)
        this.session.stats.turns++
        if (this.settings.autoTitle && !this.session.titleIsCustom && this.session.title === 'New session') {
            this.session.title = autoTitle(this.session)
        }
        this.error = null
        this.touch()
        void this.refreshProfiles()
        this.turnPromise = this.runTurn()
        try {
            await this.turnPromise
        } finally {
            this.turnPromise = null
        }
    }

    stop (): void {
        if (!this.busy) return
        for (const [id, resolve] of this.pendingApprovals) {
            resolve(false)
            this.pendingApprovals.delete(id)
        }
        this.abortController?.abort()
    }

    /** Abort the current turn and wait until it has fully unwound. */
    async stopAndWait (): Promise<void> {
        if (!this.busy) return
        this.stop()
        try {
            await this.turnPromise
        } catch {
            // the turn handles its own errors
        }
    }

    approve (toolCallId: string, options: { autoApproveLow?: boolean } = {}): void {
        const resolve = this.pendingApprovals.get(toolCallId)
        if (!resolve) return
        if (options.autoApproveLow && this.approvalMode === 'ask') {
            this.session.approvalMode = 'auto_low'
        }
        this.pendingApprovals.delete(toolCallId)
        resolve(true)
    }

    deny (toolCallId: string): void {
        const resolve = this.pendingApprovals.get(toolCallId)
        if (!resolve) return
        this.pendingApprovals.delete(toolCallId)
        resolve(false)
    }

    approveFirstPending (): void {
        const first = this.pendingApprovals.keys().next()
        if (!first.done) this.approve(first.value)
    }

    denyFirstPending (): void {
        const first = this.pendingApprovals.keys().next()
        if (!first.done) this.deny(first.value)
    }

    answer (toolCallId: string, text: string): void {
        if (!this.pendingQuestion || this.pendingQuestion.toolCallId !== toolCallId) return
        const q = this.pendingQuestion
        this.pendingQuestion = null
        q.resolve(text)
    }

    clearError (): void {
        this.error = null
        this.emit()
    }

    /** Insert a plain assistant-visible note (e.g. after resuming). */
    addNote (content: string, forModel = false): void {
        const note: NoteMessage = { id: newId('n'), role: 'note', content, createdAt: nowIso(), forModel }
        this.session.messages.push(note)
        this.touch()
    }

    // --------------------------------------------------------------- the loop

    private async runTurn (): Promise<void> {
        this.abortController = new AbortController()
        const signal = this.abortController.signal
        const provider = this.makeProvider()
        const toolSpecs: ToolSpec[] = ALL_TOOLS.map(t => t.spec)
        let assistant: AssistantMessage | null = null
        this.setPhase('thinking')
        try {
            let round = 0
            for (; round < MAX_TOOL_ROUNDS; round++) {
                assistant = {
                    id: newId('m'),
                    role: 'assistant',
                    content: '',
                    reasoning: '',
                    toolCalls: [],
                    createdAt: nowIso(),
                    model: this.settings.model || undefined,
                }
                this.session.messages.push(assistant)
                this.setPhase('thinking')
                const calls = await this.streamAssistant(provider, assistant, toolSpecs, signal)
                if (!assistant.reasoning) delete assistant.reasoning
                this.touch()
                if (!calls.length) {
                    break
                }
                this.setPhase('tool')
                for (const record of calls) {
                    signal.throwIfAborted()
                    await this.executeToolCall(record, signal)
                    this.touch()
                }
            }
            if (round >= MAX_TOOL_ROUNDS) {
                this.addNote(`Paused after ${MAX_TOOL_ROUNDS} tool rounds in one turn. Send a message to let the agent continue.`)
            }
        } catch (e) {
            if (isAbortError(e) || signal.aborted) {
                if (assistant) {
                    assistant.interrupted = true
                    for (const tc of assistant.toolCalls) {
                        if (tc.status === 'pending_approval' || tc.status === 'running' || tc.status === 'awaiting_user') {
                            tc.status = 'cancelled'
                            tc.finishedAt = nowIso()
                        }
                    }
                }
            } else {
                const message = (e as Error).message ?? String(e)
                this.error = message
                if (assistant) {
                    assistant.error = message
                }
                console.error('[ai-panel] turn failed', e)
            }
        } finally {
            // drop an assistant message that never produced anything
            if (assistant && !assistant.content && !assistant.toolCalls.length && !assistant.error && !assistant.interrupted) {
                const i = this.session.messages.indexOf(assistant)
                if (i >= 0) this.session.messages.splice(i, 1)
            }
            this.abortController = null
            this.pendingQuestion = null
            this.setPhase('idle')
            this.touch()
        }
    }

    private async streamAssistant (provider: ChatProvider, assistant: AssistantMessage, tools: ToolSpec[], signal: AbortSignal): Promise<ToolCallRecord[]> {
        const messages = this.buildMessages()
        const acc = new Map<number, { id: string, name: string, args: string }>()
        for await (const evt of provider.stream(messages, tools, signal)) {
            switch (evt.type) {
                case 'text':
                    assistant.content += evt.delta
                    this.emitSoon()
                    break
                case 'reasoning':
                    assistant.reasoning = (assistant.reasoning ?? '') + evt.delta
                    this.emitSoon()
                    break
                case 'tool_call': {
                    let slot = acc.get(evt.index)
                    if (!slot) {
                        slot = { id: evt.id ?? '', name: evt.name ?? '', args: '' }
                        acc.set(evt.index, slot)
                    }
                    if (evt.id) slot.id = evt.id
                    if (evt.name) slot.name = slot.name ? slot.name : evt.name
                    if (evt.argumentsDelta) slot.args += evt.argumentsDelta
                    break
                }
                case 'usage':
                    assistant.usage = { prompt: evt.prompt, completion: evt.completion }
                    this.session.stats.promptTokens += evt.prompt
                    this.session.stats.completionTokens += evt.completion
                    break
                case 'done':
                    break
            }
        }
        assistant.content = assistant.content.trim()
        const records: ToolCallRecord[] = [...acc.entries()].sort((a, b) => a[0] - b[0]).map(([, slot]) => {
            let args: Record<string, any> = {}
            let parseError: string | undefined
            try {
                args = slot.args.trim() ? JSON.parse(slot.args) : {}
            } catch (e) {
                parseError = `Could not parse tool arguments as JSON: ${(e as Error).message}. Raw: ${slot.args.slice(0, 400)}`
            }
            const record: ToolCallRecord = {
                id: slot.id || newId('call'),
                name: slot.name || 'unknown',
                args,
                status: 'pending_approval',
            }
            if (parseError) {
                record.status = 'error'
                record.error = parseError
            }
            return record
        })
        assistant.toolCalls = records
        this.session.stats.toolCalls += records.length
        return records
    }

    private async executeToolCall (record: ToolCallRecord, signal: AbortSignal): Promise<void> {
        if (record.status === 'error') {
            record.result = record.error
            return
        }
        const tool = findTool(record.name)
        if (!tool) {
            record.status = 'error'
            record.error = `Unknown tool "${record.name}". Available: ${ALL_TOOLS.map(t => t.spec.name).join(', ')}.`
            record.result = record.error
            return
        }
        // display metadata
        if (tool.terminalArg && record.args[tool.terminalArg] != null) {
            try {
                const t = this.resolveTerminal(record.args[tool.terminalArg])
                record.terminalKey = t.key
                record.terminalLabel = t.label
            } catch {
                record.terminalLabel = String(record.args[tool.terminalArg])
            }
        }
        const requirement = tool.approval(record.args)
        if (requirement) {
            record.riskLevel = requirement.level
            const auto = isAutoApproved(requirement.level, this.approvalMode, requirement.hardBlock)
            if (!auto) {
                record.status = 'pending_approval'
                if (requirement.hardBlock) {
                    record.progress = `Flagged as destructive (${requirement.reason}) – always requires confirmation.`
                }
                this.setPhase('awaiting_approval')
                this.touch()
                const approved = await new Promise<boolean>(resolve => {
                    this.pendingApprovals.set(record.id, resolve)
                    signal.addEventListener('abort', () => resolve(false), { once: true })
                })
                if (signal.aborted) {
                    record.status = 'cancelled'
                    record.finishedAt = nowIso()
                    return
                }
                if (!approved) {
                    record.status = 'declined'
                    record.finishedAt = nowIso()
                    record.result = 'The user declined this action. Do not retry it as-is; explain what you would need or ask how they want to proceed.'
                    this.setPhase('tool')
                    return
                }
                this.setPhase('tool')
            }
        }
        record.status = record.name === 'ask_user' ? 'awaiting_user' : 'running'
        record.startedAt = nowIso()
        record.progress = undefined
        this.touch()
        const ctx = this.makeToolContext(record, signal)
        try {
            const result = await tool.execute(record.args, ctx)
            record.result = result
            record.status = signal.aborted || record.exitState === 'cancelled' ? 'cancelled' : 'done'
        } catch (e) {
            if (isAbortError(e) || signal.aborted) {
                record.status = 'cancelled'
                record.finishedAt = nowIso()
                throw e
            }
            record.status = 'error'
            record.error = (e as Error).message ?? String(e)
            record.result = `Error: ${record.error}`
        } finally {
            record.finishedAt = nowIso()
            record.progress = undefined
            if (this.phase !== 'idle') this.setPhase('tool')
        }
    }

    private makeToolContext (record: ToolCallRecord, signal: AbortSignal): ToolContext {
        const s = this.settings
        return {
            signal,
            toolCallId: record.id,
            runner: this.runner,
            defaultTimeoutSeconds: s.defaultCommandTimeout,
            resolveTerminal: ref => this.resolveTerminal(ref),
            listTerminals: () => this.listTerminals(),
            captureLast: (entry, n) => this.registry.captureLast(entry, n),
            mark: entry => this.registry.mark(entry),
            isAlternateScreen: entry => this.registry.isAlternateScreen(entry),
            markUsed: key => {
                const t = this.session.terminals.find(x => x.key === key)
                if (t) {
                    t.used = true
                    t.lastUsedAt = nowIso()
                }
            },
            reveal: entry => {
                if (s.focusTerminalOnRun) this.registry.reveal(entry)
            },
            ensureReady: entry => this.registry.ensureReady(entry, { restoreActiveTab: !s.focusTerminalOnRun }),
            focus: entry => this.registry.focus(entry),
            progress: text => {
                record.progress = text
                this.emitSoon()
            },
            setExitState: state => {
                record.exitState = state as RunExitState
            },
            askUser: (question, choices) => {
                record.question = question
                record.choices = choices
                record.status = 'awaiting_user'
                this.setPhase('awaiting_user')
                this.touch()
                return new Promise<string>((resolve, reject) => {
                    this.pendingQuestion = {
                        toolCallId: record.id,
                        resolve: answer => {
                            record.answer = answer
                            this.setPhase('tool')
                            resolve(answer)
                        },
                    }
                    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true })
                })
            },
            openTerminal: async ref => {
                await this.refreshProfiles()
                const needle = ref.toLowerCase()
                const profile = this.profilesCache.find(p => p.name.toLowerCase() === needle)
                    ?? this.profilesCache.find(p => String((p.options as any)?.host ?? '').toLowerCase() === needle)
                    ?? this.profilesCache.find(p => p.name.toLowerCase().includes(needle))
                if (!profile) {
                    throw new Error(`No profile matches "${ref}". Available: ${this.profilesCache.map(p => p.name).join(', ') || '(none)'}`)
                }
                const entry = await this.openProfile(profile)
                if (!entry) {
                    throw new Error(`Failed to open a tab for profile "${profile.name}".`)
                }
                // the new tab may look like a terminal the user removed – the agent opened this one, so it gets a fresh key
                const key = this.keyFor(entry) ?? this.allocateKey(entry)
                return { entry, key, label: entry.label }
            },
            listProfiles: () => this.profilesCache.map(p => ({
                name: p.name,
                kind: p.type,
                detail: (p.options as any)?.host ? `${(p.options as any).user ? (p.options as any).user + '@' : ''}${(p.options as any).host}` : '',
            })),
        }
    }

    private resolveTerminal (ref: unknown): ResolvedTerminal {
        const raw = String(ref ?? '').trim().replace(/^@/, '')
        if (!raw) {
            throw new Error('terminal is required – use a key like "t1" from list_terminals.')
        }
        // removed terminals are absent from every lookup below, as if the tab did not exist
        const visible = this.visibleTerminals()
        const lower = raw.toLowerCase()
        let found: { entry: TerminalEntry, key: string } | undefined
        if (lower === 'active') {
            const active = this.registry.getActive()
            found = visible.find(v => v.entry === active)
            if (!found) throw new Error('No terminal tab is active.')
        } else if (/^t\d+$/i.test(raw)) {
            found = visible.find(v => v.key === lower)
            if (!found) {
                const stored = this.session.terminals.find(t => t.key === lower)
                if (stored && !stored.removed) {
                    throw new Error(`Terminal ${lower} "${stored.label}" is not open right now. Ask the user to reconnect it, or use open_terminal / list_terminals.`)
                }
                throw new Error(`Unknown terminal "${raw}". Call list_terminals for valid keys.`)
            }
        } else {
            found = visible.find(v => v.entry.label.toLowerCase() === lower)
                ?? visible.find(v => v.entry.label.toLowerCase().startsWith(lower))
                ?? visible.find(v => (v.entry.descriptor.host ?? '').toLowerCase() === lower)
            if (!found) {
                throw new Error(`No open terminal is labelled "${raw}". Open terminals: ${visible.map(v => `${v.key} "${v.entry.label}"`).join(', ') || '(none)'}.`)
            }
        }
        return { entry: found.entry, key: found.key, label: found.entry.label }
    }

    private listTerminals (): TerminalListing[] {
        const active = this.registry.getActive()
        return this.visibleTerminals().map(({ entry: e, key }) => ({
            key,
            label: e.label,
            connection: describeConnection(e.descriptor),
            status: this.registry.status(e),
            isActive: e === active,
            lastLine: this.registry.lastLine(e),
        }))
    }

    // ------------------------------------------------------- prompt building

    buildMessages (): ChatMessage[] {
        const s = this.settings
        return buildMessages(this.session, {
            systemPrompt: systemPromptTemplate,
            additionalSystemPrompt: s.additionalSystemPrompt,
            maxToolResultChars: s.maxToolResultChars,
            maxContextChars: s.maxContextChars,
        })
    }

    // ------------------------------------------------------------- plumbing

    private setPhase (phase: AgentPhase): void {
        if (this.phase !== phase) {
            this.phase = phase
            this.emit()
        }
    }

    /** Persist + notify. */
    private touch (): void {
        this.session.updatedAt = nowIso()
        this.store.save(this.session)
        this.emit()
    }

    private emit (): void {
        if (this.emitTimer) {
            clearTimeout(this.emitTimer)
            this.emitTimer = null
        }
        this.rev++
        this.zone.run(() => this.state.next({ session: this.session, phase: this.phase, error: this.error, rev: this.rev }))
    }

    /** Coalesce bursts (streaming tokens) into ~25 updates per second. */
    private emitSoon (): void {
        if (this.emitTimer) return
        this.emitTimer = setTimeout(() => {
            this.emitTimer = null
            this.emit()
        }, 40)
    }
}
