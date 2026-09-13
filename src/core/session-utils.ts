import { AssistantMessage, Session, SessionMessage, SessionSummary, SESSION_SCHEMA_VERSION } from '../types/session'
import { newId, nowIso } from './util/ids'
import { deriveTitle } from './util/text'

export function createSession (): Session {
    const now = nowIso()
    return {
        version: SESSION_SCHEMA_VERSION,
        id: newId('s'),
        title: 'New session',
        createdAt: now,
        updatedAt: now,
        terminals: [],
        messages: [],
        stats: { turns: 0, toolCalls: 0, promptTokens: 0, completionTokens: 0 },
    }
}

export function summarizeSession (session: Session): SessionSummary {
    const firstUser = session.messages.find(m => m.role === 'user')
    const lastAssistant = [...session.messages].reverse().find(m => m.role === 'assistant') as AssistantMessage | undefined
    const preview = (lastAssistant?.content || firstUser?.content || '').replace(/\s+/g, ' ').trim().slice(0, 140)
    return {
        id: session.id,
        title: session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        messageCount: session.messages.filter(m => m.role !== 'note').length,
        terminalLabels: session.terminals.filter(t => t.used).map(t => t.label),
        preview,
    }
}

export function autoTitle (session: Session): string {
    const firstUser = session.messages.find(m => m.role === 'user')
    return firstUser ? deriveTitle(firstUser.content) : 'New session'
}

export function isEmptySession (session: Session): boolean {
    return !session.messages.some(m => m.role !== 'note')
}

export function lastMessage (session: Session): SessionMessage | undefined {
    return session.messages[session.messages.length - 1]
}
