import { RiskLevel } from '../../types/session'
import { ToolSpec } from '../llm/types'
import { BufferCapture, BufferPosition, TerminalEntry } from '../terminal-registry.service'
import { TerminalRunner } from '../terminal-runner'

export interface ResolvedTerminal {
    entry: TerminalEntry
    key: string
    label: string
}

export interface TerminalListing {
    key: string
    label: string
    connection: string
    status: string
    isActive: boolean
    lastLine: string
    cwd?: string
}

/** Everything a tool may touch. Provided by the agent service per call. */
export interface ToolContext {
    signal: AbortSignal
    toolCallId: string
    runner: TerminalRunner
    defaultTimeoutSeconds: number
    resolveTerminal (ref: unknown): ResolvedTerminal
    listTerminals (): TerminalListing[]
    captureLast (entry: TerminalEntry, lines: number): BufferCapture
    mark (entry: TerminalEntry): BufferPosition
    isAlternateScreen (entry: TerminalEntry): boolean
    markUsed (key: string, cwd?: string): void
    /** Bring the tab into view (respects the user's setting). */
    reveal (entry: TerminalEntry): void
    /** Start a dormant (restored, never shown) tab; resolves false if it cannot be started. */
    ensureReady (entry: TerminalEntry): Promise<boolean>
    focus (entry: TerminalEntry): void
    progress (text: string): void
    setExitState (state: string): void
    askUser (question: string, choices?: string[]): Promise<string>
    openTerminal (profileRef: string): Promise<ResolvedTerminal>
    listProfiles (): { name: string, kind: string, detail: string }[]
}

export interface ApprovalRequirement {
    level: RiskLevel
    hardBlock: boolean
    reason?: string
}

export interface AgentTool {
    spec: ToolSpec
    /** `null` when the call never needs approval (read-only tools). */
    approval (args: Record<string, any>): ApprovalRequirement | null
    /** Arg that names the target terminal, for display. */
    terminalArg?: string
    execute (args: Record<string, any>, ctx: ToolContext): Promise<string>
}
