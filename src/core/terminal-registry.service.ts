import { Injectable, NgZone } from '@angular/core'
import { BehaviorSubject, Observable, Subscription } from 'rxjs'
import { AppService, BaseTabComponent, SplitTabComponent } from 'tabby-core'
import { BaseTerminalTabComponent } from 'tabby-terminal'
import { TerminalDescriptor, TerminalKind } from '../types/session'
import { newId } from './util/ids'
import { looksLikeInputPrompt } from './util/prompt-detect'

/** An xterm.js marker: a line reference that follows the buffer as it scrolls/trims. */
export interface XtermMarker {
    line: number
    isDisposed: boolean
    dispose (): void
}

/** The subset of the xterm.js API we read from. */
interface XtermLike {
    rows: number
    cols: number
    registerMarker? (cursorYOffset?: number): XtermMarker | undefined
    buffer: {
        active: {
            type: 'normal' | 'alternate'
            baseY: number
            cursorY: number
            cursorX: number
            viewportY: number
            length: number
            getLine (y: number): { translateToString (trimRight?: boolean): string, isWrapped: boolean } | undefined
        }
    }
}

export type TerminalStatus = 'idle' | 'active' | 'running' | 'awaiting_input' | 'alt_screen' | 'not_started' | 'closed'

export interface TerminalEntry {
    id: string
    tab: BaseTerminalTabComponent<any>
    descriptor: TerminalDescriptor
    label: string
    /** Timestamp of the last output chunk from the session. */
    lastOutputAt: number
    /** Incremented on every output chunk – cheap change detection. */
    outputSeq: number
    /** Id of the tool call currently driving this terminal, if any. */
    busyWith: string | null
    /** Where the last capture ended (for "what's new since"). */
    readMarker: BufferPosition
    closed: boolean
}

/**
 * A position in the buffer. `row` is the absolute row at the time it was
 * taken; `marker` (when xterm provides one) keeps following that line as the
 * scrollback fills up and old rows are trimmed – absolute rows alone drift.
 */
export interface BufferPosition {
    row: number
    marker?: XtermMarker | null
}

export interface ResolvedPosition {
    /** Current absolute row of the anchored line (0 if it scrolled away). */
    row: number
    /** The anchored line is gone from the buffer. */
    trimmed: boolean
    /** The buffer was replaced/cleared since the position was taken. */
    reset: boolean
}

export interface BufferCapture {
    /** Logical lines (wrapped rows joined). */
    lines: string[]
    /** Absolute row index just past the captured region. */
    endRow: number
    isAlternate: boolean
}

/**
 * Knows about every terminal tab in the app, in tab order, with a stable
 * runtime id and a descriptor good enough to re-identify the tab later.
 */
@Injectable({ providedIn: 'root' })
export class TerminalRegistryService {
    private entries = new Map<string, TerminalEntry>()
    private byTab = new WeakMap<BaseTerminalTabComponent<any>, TerminalEntry>()
    private subs = new Map<string, Subscription[]>()
    private changed = new BehaviorSubject<TerminalEntry[]>([])

    /** Emits the ordered terminal list whenever tabs, titles or status change. */
    get changed$ (): Observable<TerminalEntry[]> {
        return this.changed.asObservable()
    }

    constructor (
        private app: AppService,
        private zone: NgZone,
    ) {
        this.app.tabsChanged$.subscribe(() => this.emit())
        this.app.activeTabChange$.subscribe(() => this.emit())
        // Tabs that already exist when the plugin loads (e.g. restored on startup)
        this.app.ready$.subscribe(() => this.scan())
        this.app.tabOpened$.subscribe(() => setTimeout(() => this.scan(), 50))
    }

    /** Pick up any terminal tabs that the decorator did not report (defensive). */
    scan (): void {
        for (const tab of this.iterateTerminalTabs()) {
            this.register(tab)
        }
        this.emit()
    }

    register (tab: BaseTerminalTabComponent<any>): TerminalEntry {
        const existing = this.byTab.get(tab)
        if (existing) {
            // a destroyed tab is never registered again (it can linger in the tab tree briefly)
            return existing
        }
        const entry: TerminalEntry = {
            id: newId('term'),
            tab,
            descriptor: describeTab(tab),
            label: '',
            lastOutputAt: 0,
            outputSeq: 0,
            busyWith: null,
            readMarker: { row: 0 },
            closed: false,
        }
        this.entries.set(entry.id, entry)
        this.byTab.set(tab, entry)
        const subs: Subscription[] = []
        try {
            subs.push(tab.output$.subscribe(() => {
                entry.lastOutputAt = Date.now()
                entry.outputSeq++
            }))
        } catch {
            // frontend not ready yet – output$ getter can throw; retry when ready
            subs.push(tab.frontendReady$.subscribe(() => {
                subs.push(tab.output$.subscribe(() => {
                    entry.lastOutputAt = Date.now()
                    entry.outputSeq++
                }))
            }))
        }
        subs.push(tab.titleChange$.subscribe(() => {
            entry.descriptor = describeTab(tab)
            this.emit()
        }))
        subs.push(tab.destroyed$.subscribe(() => this.unregister(tab)))
        this.subs.set(entry.id, subs)
        this.emit()
        return entry
    }

    unregister (tab: BaseTerminalTabComponent<any>): void {
        const entry = this.byTab.get(tab)
        if (!entry || entry.closed) {
            return
        }
        this.close(entry)
        this.emit()
    }

    private close (entry: TerminalEntry): void {
        entry.closed = true
        entry.busyWith = null
        this.entries.delete(entry.id)
        // keep the byTab mapping so a lingering destroyed tab is not re-registered
        for (const s of this.subs.get(entry.id) ?? []) {
            s.unsubscribe()
        }
        this.subs.delete(entry.id)
    }

    /**
     * All open terminals in visual tab order. Entries whose tab has vanished
     * from the tab tree are closed here, so this is also the garbage collector.
     */
    list (): TerminalEntry[] {
        const ordered: TerminalEntry[] = []
        const seen = new Set<string>()
        for (const tab of this.iterateTerminalTabs()) {
            const entry = this.byTab.get(tab) ?? this.register(tab)
            if (entry.closed) {
                continue
            }
            seen.add(entry.id)
            ordered.push(entry)
        }
        let removed = false
        for (const entry of [...this.entries.values()]) {
            if (!seen.has(entry.id)) {
                this.close(entry)
                removed = true
            }
        }
        this.assignLabels(ordered)
        if (removed) {
            this.emitSoon()
        }
        return ordered
    }

    byId (id: string): TerminalEntry | null {
        const entry = this.entries.get(id)
        return entry && !entry.closed ? entry : null
    }

    forTab (tab: BaseTabComponent): TerminalEntry | null {
        const entry = this.byTab.get(tab as any)
        return entry && !entry.closed ? entry : null
    }

    /** The terminal that currently has (or last had) focus. */
    getActive (): TerminalEntry | null {
        const active = this.app.activeTab
        if (!active) {
            return null
        }
        if (active instanceof SplitTabComponent) {
            const focused = active.getFocusedTab()
            if (focused && isTerminalTab(focused)) {
                return this.forTab(focused)
            }
            for (const child of active.getAllTabs()) {
                if (isTerminalTab(child)) {
                    return this.forTab(child)
                }
            }
            return null
        }
        if (isTerminalTab(active)) {
            return this.forTab(active)
        }
        return null
    }

    status (entry: TerminalEntry): TerminalStatus {
        if (entry.closed) return 'closed'
        if (!this.isReady(entry)) return 'not_started'
        if (entry.busyWith) return 'running'
        if (this.isAlternateScreen(entry)) return 'alt_screen'
        if (Date.now() - entry.lastOutputAt < 1500) return 'active'
        const last = this.lastLine(entry)
        if (last && looksLikeInputPrompt(last)) return 'awaiting_input'
        return 'idle'
    }

    /**
     * Tabs restored on startup stay dormant (no session, no xterm) until they
     * are shown once. Typing into such a tab is silently dropped.
     */
    isReady (entry: TerminalEntry): boolean {
        const tab: any = entry.tab
        return !entry.closed && !!tab.session?.open && !!tab.frontendIsReady && !!this.xterm(entry)
    }

    /**
     * Wake a dormant tab by showing it, wait for its shell to come up, and
     * optionally switch back to the tab the user was on.
     */
    async ensureReady (entry: TerminalEntry, options: { restoreActiveTab?: boolean, timeoutMs?: number } = {}): Promise<boolean> {
        if (entry.closed) return false
        if (this.isReady(entry)) return true
        const previous = this.app.activeTab
        const top = entry.tab.topmostParent ?? entry.tab
        this.reveal(entry)
        const timeout = options.timeoutMs ?? 8000
        const t0 = Date.now()
        while (!this.isReady(entry) && Date.now() - t0 < timeout) {
            await new Promise(r => setTimeout(r, 100))
        }
        const ready = this.isReady(entry)
        if (ready) {
            // give the shell a moment to print its first prompt
            const t1 = Date.now()
            while (Date.now() - t1 < 4000) {
                await new Promise(r => setTimeout(r, 150))
                if (entry.lastOutputAt && Date.now() - entry.lastOutputAt > 600 && this.lastLine(entry).trim()) break
            }
        }
        if (options.restoreActiveTab && previous && previous !== top && this.app.tabs.includes(previous)) {
            const focusedBefore = document.activeElement as HTMLElement | null
            this.zone.run(() => this.app.selectTab(previous))
            if (focusedBefore && focusedBefore.closest('ai-panel')) {
                setTimeout(() => focusedBefore.focus(), 40)
            }
        }
        return ready
    }

    /** Make the tab visible without stealing keyboard focus from the panel. */
    reveal (entry: TerminalEntry): void {
        const focusedBefore = document.activeElement as HTMLElement | null
        const top = entry.tab.topmostParent ?? entry.tab
        this.zone.run(() => {
            if (this.app.activeTab !== top) {
                this.app.selectTab(top)
            }
            const parent = entry.tab.parent
            if (parent instanceof SplitTabComponent && parent.getFocusedTab() !== entry.tab) {
                parent.focus(entry.tab)
            }
        })
        if (focusedBefore && focusedBefore.closest('ai-panel')) {
            setTimeout(() => focusedBefore.focus(), 40)
        }
    }

    /** Switch to the tab and give it keyboard focus. */
    focus (entry: TerminalEntry): void {
        const top = entry.tab.topmostParent ?? entry.tab
        this.zone.run(() => {
            this.app.selectTab(top)
            const parent = entry.tab.parent
            if (parent instanceof SplitTabComponent) {
                parent.focus(entry.tab)
            }
            entry.tab.frontend?.focus()
        })
    }

    sendInput (entry: TerminalEntry, data: string): void {
        if (entry.closed) {
            throw new Error(`Terminal "${entry.label}" is closed.`)
        }
        this.zone.run(() => entry.tab.sendInput(data))
    }

    // ---- buffer access -------------------------------------------------

    xterm (entry: TerminalEntry): XtermLike | null {
        const fe: any = entry.tab.frontend
        return fe?.xterm ?? null
    }

    isAlternateScreen (entry: TerminalEntry): boolean {
        const x = this.xterm(entry)
        return x?.buffer.active.type === 'alternate'
    }

    /** Absolute row of the cursor (scrollback + viewport). */
    cursorRow (entry: TerminalEntry): number {
        const x = this.xterm(entry)
        if (!x) return 0
        return x.buffer.active.baseY + x.buffer.active.cursorY
    }

    /** The text of the line under the cursor (typically the prompt). */
    cursorLine (entry: TerminalEntry): string {
        const x = this.xterm(entry)
        if (!x) return ''
        const row = x.buffer.active.baseY + x.buffer.active.cursorY
        return this.logicalLineAt(x, row)
    }

    lastLine (entry: TerminalEntry): string {
        const cap = this.captureLast(entry, 3)
        for (let i = cap.lines.length - 1; i >= 0; i--) {
            if (cap.lines[i].trim()) return cap.lines[i]
        }
        return ''
    }

    /** Anchor the current cursor line so later captures survive scrollback trimming. */
    mark (entry: TerminalEntry): BufferPosition {
        const x = this.xterm(entry)
        if (!x) {
            return { row: 0 }
        }
        const row = x.buffer.active.baseY + x.buffer.active.cursorY
        let marker: XtermMarker | null = null
        try {
            marker = x.registerMarker?.(0) ?? null
        } catch {
            marker = null
        }
        return { row, marker }
    }

    resolve (entry: TerminalEntry, pos: BufferPosition): ResolvedPosition {
        const x = this.xterm(entry)
        if (!x) {
            return { row: 0, trimmed: true, reset: false }
        }
        const buf = x.buffer.active
        const marker = pos.marker
        if (marker && !marker.isDisposed && marker.line >= 0) {
            return { row: marker.line, trimmed: false, reset: false }
        }
        if (marker) {
            // the anchored line is gone: either trimmed by a full scrollback or the buffer was replaced
            const reset = buf.length < pos.row
            return { row: 0, trimmed: true, reset }
        }
        // no marker support: fall back to the absolute row
        const cursorRow = buf.baseY + buf.cursorY
        const reset = cursorRow < pos.row - 1 && buf.length < pos.row
        return { row: Math.max(0, Math.min(pos.row, cursorRow + 1)), trimmed: false, reset }
    }

    /** Rows from `from` (inclusive) to the cursor row (inclusive), joined into logical lines. */
    captureSince (entry: TerminalEntry, from: BufferPosition | number, maxLines = 2000): BufferCapture {
        const x = this.xterm(entry)
        if (!x) {
            return { lines: [], endRow: 0, isAlternate: false }
        }
        const buf = x.buffer.active
        const endRow = buf.baseY + buf.cursorY
        const fromRow = typeof from === 'number' ? from : this.resolve(entry, from).row
        const start = Math.max(0, Math.min(fromRow, endRow + 1))
        const lines = this.logicalLines(x, start, endRow, maxLines)
        return { lines, endRow: endRow + 1, isAlternate: buf.type === 'alternate' }
    }

    /** The last `n` logical lines of the buffer. */
    captureLast (entry: TerminalEntry, n: number): BufferCapture {
        const x = this.xterm(entry)
        if (!x) {
            return { lines: [], endRow: 0, isAlternate: false }
        }
        const buf = x.buffer.active
        const endRow = buf.baseY + buf.cursorY
        // rows are cheap to read; over-fetch to account for wrapped rows then trim
        const start = Math.max(0, endRow - n * 2 - 2)
        let lines = this.logicalLines(x, start, endRow, n * 3)
        if (lines.length > n) {
            lines = lines.slice(lines.length - n)
        }
        return { lines, endRow: endRow + 1, isAlternate: buf.type === 'alternate' }
    }

    /** What's currently visible on screen (useful for alternate-screen apps). */
    captureScreen (entry: TerminalEntry): BufferCapture {
        const x = this.xterm(entry)
        if (!x) {
            return { lines: [], endRow: 0, isAlternate: false }
        }
        const buf = x.buffer.active
        const start = buf.viewportY
        const end = Math.min(buf.length - 1, start + x.rows - 1)
        return { lines: this.logicalLines(x, start, end, x.rows * 2), endRow: end + 1, isAlternate: buf.type === 'alternate' }
    }

    private logicalLines (x: XtermLike, start: number, end: number, maxLines: number): string[] {
        const buf = x.buffer.active
        const out: string[] = []
        // walk back to the start of a wrapped logical line so we don't cut it
        let s = start
        while (s > 0 && buf.getLine(s)?.isWrapped) {
            s--
        }
        for (let i = s; i <= end; i++) {
            const line = buf.getLine(i)
            if (!line) continue
            const text = line.translateToString(true)
            if (line.isWrapped && out.length) {
                out[out.length - 1] += text
            } else {
                out.push(text)
            }
            if (out.length > maxLines) {
                out.shift()
            }
        }
        return out
    }

    private logicalLineAt (x: XtermLike, row: number): string {
        const buf = x.buffer.active
        let s = row
        while (s > 0 && buf.getLine(s)?.isWrapped) {
            s--
        }
        let text = ''
        for (let i = s; i <= row; i++) {
            text += buf.getLine(i)?.translateToString(true) ?? ''
        }
        return text
    }

    // ---- internals -----------------------------------------------------

    private* iterateTerminalTabs (): Generator<BaseTerminalTabComponent<any>> {
        for (const tab of this.app.tabs ?? []) {
            if (tab instanceof SplitTabComponent) {
                for (const child of tab.getAllTabs()) {
                    if (isTerminalTab(child)) {
                        yield child
                    }
                }
            } else if (isTerminalTab(tab)) {
                yield tab
            }
        }
    }

    private assignLabels (ordered: TerminalEntry[]): void {
        const seen = new Map<string, number>()
        for (const e of ordered) {
            const base = baseLabel(e.tab, e.descriptor)
            const n = (seen.get(base) ?? 0) + 1
            seen.set(base, n)
            e.label = n === 1 ? base : `${base} #${n}`
        }
    }

    private emitTimer: any = null

    private emit (): void {
        this.changed.next(this.list())
    }

    private emitSoon (): void {
        if (this.emitTimer) return
        this.emitTimer = setTimeout(() => {
            this.emitTimer = null
            this.emit()
        }, 0)
    }
}

export function isTerminalTab (tab: any): tab is BaseTerminalTabComponent<any> {
    if (!tab) return false
    if (tab instanceof BaseTerminalTabComponent) return true
    // duck typing in case the plugin was bundled with its own copy of tabby-terminal
    return typeof tab.sendInput === 'function' && 'frontend' in tab && 'profile' in tab
}

const KNOWN_KINDS: TerminalKind[] = ['ssh', 'local', 'serial', 'telnet']

export function describeTab (tab: BaseTerminalTabComponent<any>): TerminalDescriptor {
    const profile: any = tab.profile ?? {}
    const options: any = profile.options ?? {}
    const type = String(profile.type ?? 'other')
    const kind: TerminalKind = (KNOWN_KINDS as string[]).includes(type) ? type as TerminalKind : 'other'
    const d: TerminalDescriptor = {
        kind,
        profileId: profile.id || undefined,
        profileName: profile.name || undefined,
        title: tab.customTitle || tab.title || undefined,
    }
    if (kind === 'ssh' || kind === 'telnet') {
        d.host = options.host || undefined
        d.port = options.port || undefined
        d.user = options.user || undefined
    }
    if (kind === 'serial') {
        d.host = options.port || undefined
    }
    return d
}

function baseLabel (tab: BaseTerminalTabComponent<any>, d: TerminalDescriptor): string {
    if (tab.customTitle) {
        return tab.customTitle
    }
    if (d.kind !== 'local' && d.profileName) {
        return d.profileName
    }
    return tab.title || d.profileName || 'Terminal'
}

/** "ssh ubuntu@10.0.0.11:22" / "local" – used in the model-facing listing. */
export function describeConnection (d: TerminalDescriptor): string {
    switch (d.kind) {
        case 'ssh':
        case 'telnet': {
            const userPart = d.user ? `${d.user}@` : ''
            const portPart = d.port && d.port !== 22 ? `:${d.port}` : ''
            return `${d.kind} ${userPart}${d.host ?? '?'}${portPart}`
        }
        case 'serial':
            return `serial ${d.host ?? ''}`.trim()
        case 'local':
            return 'local shell'
        default:
            return d.kind
    }
}

/**
 * How well does an open terminal match a descriptor stored in a session?
 * 0 = no match; higher is better.
 */
export function matchScore (stored: TerminalDescriptor, open: TerminalDescriptor): number {
    let score = 0
    if (stored.kind !== open.kind) {
        return 0
    }
    if (stored.profileId && stored.profileId === open.profileId) score += 6
    if (stored.host && stored.host === open.host) {
        score += 3
        if (stored.user && stored.user === open.user) score += 1
        if ((stored.port ?? 22) === (open.port ?? 22)) score += 1
    }
    if (stored.profileName && stored.profileName === open.profileName) score += 2
    if (stored.title && stored.title === open.title) score += 1
    return score
}
