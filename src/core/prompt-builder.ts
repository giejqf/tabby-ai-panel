import { Session } from '../types/session'
import { ChatMessage } from './llm/types'
import { truncateForModel } from './util/text'

export interface PromptOptions {
    systemPrompt: string
    additionalSystemPrompt?: string
    maxToolResultChars: number
    maxContextChars: number
}

/**
 * Turn the stored session transcript into provider-agnostic chat messages.
 * Tool calls that never finished get a synthetic result so the transcript
 * stays well-formed (every tool call must be answered).
 */
export function buildMessages (session: Session, options: PromptOptions): ChatMessage[] {
    const system = [options.systemPrompt.trim(), (options.additionalSystemPrompt ?? '').trim()].filter(Boolean).join('\n\n')
    const out: ChatMessage[] = [{ role: 'system', content: system }]
    const pushUser = (content: string) => {
        const last = out[out.length - 1]
        if (last && last.role === 'user') {
            last.content += `\n\n${content}`
        } else {
            out.push({ role: 'user', content })
        }
    }
    for (const m of session.messages) {
        if (m.role === 'user') {
            pushUser(m.context ? `${m.context}\n\n${m.content}` : m.content)
        } else if (m.role === 'note') {
            if (m.forModel) pushUser(`[note] ${m.content}`)
        } else if (m.role === 'assistant') {
            if (!m.content && !m.toolCalls.length) continue
            const toolCalls = m.toolCalls.map(tc => ({ id: tc.id, name: tc.name, arguments: JSON.stringify(tc.args ?? {}) }))
            out.push({ role: 'assistant', content: m.content || null, toolCalls: toolCalls.length ? toolCalls : undefined })
            for (const tc of m.toolCalls) {
                let content: string
                if (tc.status === 'cancelled') {
                    content = 'Cancelled by the user before it completed.'
                } else if (tc.status === 'pending_approval' || tc.status === 'running' || tc.status === 'awaiting_user') {
                    content = 'Interrupted before completion.'
                } else {
                    content = tc.result ?? tc.error ?? '(no result)'
                }
                const cut = truncateForModel(content, options.maxToolResultChars)
                tc.truncatedForModel = cut.truncated
                out.push({ role: 'tool', toolCallId: tc.id, name: tc.name, content: cut.text })
            }
        }
    }
    return fitContextBudget(out, options.maxContextChars)
}

export function messagesSize (list: ChatMessage[]): number {
    return list.reduce((n, m) => n + (typeof m.content === 'string' ? m.content.length : 0) + 40, 0)
}

/**
 * Keep the prompt under a character budget: elide old tool output first,
 * then drop the oldest exchanges (never the system prompt or the last user turn).
 */
export function fitContextBudget (messages: ChatMessage[], maxChars: number): ChatMessage[] {
    if (messagesSize(messages) <= maxChars) {
        return messages
    }
    const out: ChatMessage[] = messages.map(m => ({ ...m }))
    const lastUserIdx = (() => {
        for (let i = out.length - 1; i >= 0; i--) if (out[i].role === 'user') return i
        return out.length
    })()
    // 1. elide old tool results, oldest first
    for (let i = 1; i < lastUserIdx && messagesSize(out) > maxChars; i++) {
        const m = out[i]
        if (m.role === 'tool' && m.content.length > 200) {
            out[i] = { ...m, content: `[earlier output elided to save context – ${m.content.length} chars]` }
        }
    }
    // 2. drop the oldest exchanges, keeping tool results together with their call
    let dropped = false
    while (messagesSize(out) > maxChars) {
        const idx = 1
        // never drop the last user message
        const lastUser = (() => {
            for (let i = out.length - 1; i >= 0; i--) if (out[i].role === 'user') return i
            return -1
        })()
        if (idx >= lastUser) break
        const m = out[idx]
        out.splice(idx, 1)
        if (m.role === 'assistant' && m.toolCalls?.length) {
            while (out[idx] && out[idx].role === 'tool') out.splice(idx, 1)
        }
        dropped = true
    }
    if (dropped) {
        const notice = '[earlier conversation truncated to fit the context window]'
        const first = out[1]
        if (first && first.role === 'user') {
            out[1] = { ...first, content: `${notice}\n\n${first.content}` }
        } else {
            out.splice(1, 0, { role: 'user', content: notice })
        }
    }
    return out
}
