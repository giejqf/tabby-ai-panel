/**
 * Persistent session model.
 *
 * A session is a provider-agnostic transcript plus the set of terminals the
 * agent has worked with. It is stored as one JSON file per session and is
 * what the user browses/resumes from the session drawer.
 */

export const SESSION_SCHEMA_VERSION = 1

export type TerminalKind = 'ssh' | 'local' | 'serial' | 'telnet' | 'other'

/** Enough information to re-identify a terminal tab after a restart. */
export interface TerminalDescriptor {
    kind: TerminalKind
    profileId?: string
    profileName?: string
    host?: string
    port?: number
    user?: string
    title?: string
}

/** A terminal as the model knows it: a short stable key (`t1`, `t2`, …). */
export interface SessionTerminal {
    key: string
    label: string
    descriptor: TerminalDescriptor
    /** True once the agent actually ran/read something here (vs. merely listed). */
    used: boolean
    lastCwd?: string
    firstSeenAt: string
    lastUsedAt: string
}

export type RiskLevel = 'low' | 'medium' | 'high'

export type ToolCallStatus =
    | 'pending_approval'
    | 'awaiting_user'
    | 'running'
    | 'done'
    | 'declined'
    | 'error'
    | 'cancelled'

export type RunExitState =
    | 'prompt'          // shell prompt came back – command finished
    | 'awaiting_input'  // looks like the program is waiting for input
    | 'alt_screen'      // full-screen app (vim/htop/less) is active
    | 'idle'            // no output for a while, no prompt detected
    | 'timeout'         // still running when the time budget ran out
    | 'matched'         // wait_for_output pattern matched
    | 'reset'           // the terminal was reset/reconnected while waiting
    | 'cancelled'

export interface ToolCallRecord {
    id: string
    name: string
    args: Record<string, any>
    status: ToolCallStatus
    /** Full result as shown in the UI. */
    result?: string
    /** Human readable progress/status line while running. */
    progress?: string
    error?: string
    terminalKey?: string
    terminalLabel?: string
    riskLevel?: RiskLevel
    startedAt?: string
    finishedAt?: string
    exitState?: RunExitState
    /** Result was cut before being sent to the model. */
    truncatedForModel?: boolean
    /** Free-text question / choices for ask_user. */
    question?: string
    choices?: string[]
    answer?: string
}

export interface TokenUsage {
    prompt: number
    completion: number
}

export interface UserMessage {
    id: string
    role: 'user'
    content: string
    /** Live terminal snapshot attached when the message was sent (sent to the model, hidden in UI). */
    context?: string
    createdAt: string
}

export interface AssistantMessage {
    id: string
    role: 'assistant'
    content: string
    reasoning?: string
    toolCalls: ToolCallRecord[]
    createdAt: string
    model?: string
    usage?: TokenUsage
    /** Turn was interrupted by the user or an error. */
    interrupted?: boolean
    error?: string
}

/** System-generated note shown inline (e.g. "resumed session, Linux-2 reconnected"). */
export interface NoteMessage {
    id: string
    role: 'note'
    content: string
    createdAt: string
    /** Also sent to the model as context. */
    forModel?: boolean
}

export type SessionMessage = UserMessage | AssistantMessage | NoteMessage

export type ApprovalMode = 'ask' | 'auto_low' | 'auto_medium' | 'auto_all'

export interface SessionStats {
    turns: number
    toolCalls: number
    promptTokens: number
    completionTokens: number
}

export interface Session {
    version: typeof SESSION_SCHEMA_VERSION
    id: string
    title: string
    titleIsCustom?: boolean
    createdAt: string
    updatedAt: string
    terminals: SessionTerminal[]
    messages: SessionMessage[]
    approvalMode?: ApprovalMode
    model?: string
    stats: SessionStats
}

/** Lightweight listing entry (what the session drawer shows). */
export interface SessionSummary {
    id: string
    title: string
    createdAt: string
    updatedAt: string
    messageCount: number
    terminalLabels: string[]
    preview: string
}
