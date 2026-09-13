import { ChatMessage, ChatProvider, ChatStreamEvent, ProviderConfig, ToolSpec } from './types'
import { HttpError, parseSSE, readAll, streamRequest } from '../util/sse'

/** `https://host/v1/chat/completions` | `https://host/v1` | `https://host` → `https://host` */
export function normalizeBaseUrl (endpoint: string): string {
    let base = (endpoint ?? '').trim()
    base = base.replace(/\/chat\/completions\/?$/i, '')
    base = base.replace(/\/v1\/?$/i, '')
    return base.replace(/\/+$/, '')
}

export function chatCompletionsUrl (endpoint: string): string {
    return `${normalizeBaseUrl(endpoint)}/v1/chat/completions`
}

export function modelsUrl (endpoint: string): string {
    return `${normalizeBaseUrl(endpoint)}/v1/models`
}

export function toOpenAIMessages (messages: ChatMessage[]): any[] {
    return messages.map(m => {
        switch (m.role) {
            case 'system':
                return { role: 'system', content: m.content }
            case 'user':
                return { role: 'user', content: m.content }
            case 'assistant': {
                const out: any = { role: 'assistant', content: m.content ?? '' }
                if (m.toolCalls?.length) {
                    out.tool_calls = m.toolCalls.map(tc => ({
                        id: tc.id,
                        type: 'function',
                        function: { name: tc.name, arguments: tc.arguments || '{}' },
                    }))
                    if (!m.content) {
                        out.content = null
                    }
                }
                return out
            }
            case 'tool':
                return { role: 'tool', tool_call_id: m.toolCallId, name: m.name, content: m.content }
        }
    })
}

export function toOpenAITools (tools: ToolSpec[]): any[] {
    return tools.map(t => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
    }))
}

/**
 * Translate one streamed `chat.completion.chunk` into provider events.
 * Exported for unit tests.
 */
export function chunkToEvents (parsed: any): ChatStreamEvent[] {
    const events: ChatStreamEvent[] = []
    if (parsed?.usage && (parsed.usage.prompt_tokens != null || parsed.usage.completion_tokens != null)) {
        events.push({ type: 'usage', prompt: parsed.usage.prompt_tokens ?? 0, completion: parsed.usage.completion_tokens ?? 0 })
    }
    const choice = parsed?.choices?.[0]
    if (!choice) {
        return events
    }
    const delta = choice.delta ?? choice.message ?? {}
    const reasoning = delta.reasoning_content ?? delta.reasoning
    if (typeof reasoning === 'string' && reasoning) {
        events.push({ type: 'reasoning', delta: reasoning })
    }
    if (typeof delta.content === 'string' && delta.content) {
        events.push({ type: 'text', delta: delta.content })
    }
    if (Array.isArray(delta.tool_calls)) {
        delta.tool_calls.forEach((tc: any, i: number) => {
            events.push({
                type: 'tool_call',
                index: typeof tc.index === 'number' ? tc.index : i,
                id: tc.id || undefined,
                name: tc.function?.name || undefined,
                argumentsDelta: tc.function?.arguments || undefined,
            })
        })
    }
    if (choice.finish_reason) {
        events.push({ type: 'done', finishReason: choice.finish_reason })
    }
    return events
}

export class OpenAICompatibleProvider implements ChatProvider {
    constructor (private config: ProviderConfig) {}

    private headers (): Record<string, string> {
        const h: Record<string, string> = {
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream',
        }
        const key = this.config.apiKey?.trim()
        if (key) {
            h.Authorization = `Bearer ${key}`
        }
        return h
    }

    async* stream (messages: ChatMessage[], tools: ToolSpec[], signal?: AbortSignal): AsyncGenerator<ChatStreamEvent> {
        const url = chatCompletionsUrl(this.config.endpoint)
        const body: any = {
            model: this.config.model || 'default',
            messages: toOpenAIMessages(messages),
            stream: true,
            ...(this.config.extraParams ?? {}),
        }
        if (tools.length) {
            body.tools = toOpenAITools(tools)
            body.tool_choice = body.tool_choice ?? 'auto'
        }
        const res = await streamRequest(url, {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify(body),
            signal,
        })
        if (res.status < 200 || res.status >= 300) {
            const text = await readAll(res.chunks)
            throw new HttpError(res.status, extractErrorMessage(text), url)
        }
        const contentType = String(res.headers['content-type'] ?? '')
        if (!contentType.includes('text/event-stream')) {
            // Some servers ignore `stream: true` and answer with a plain JSON completion.
            const text = await readAll(res.chunks)
            let parsed: any
            try {
                parsed = JSON.parse(text)
            } catch {
                throw new Error(`Unexpected non-JSON response from ${url}: ${text.slice(0, 300)}`)
            }
            for (const e of chunkToEvents(parsed)) {
                yield e
            }
            return
        }
        let sawDone = false
        for await (const evt of parseSSE(res.chunks)) {
            if (evt.data === '[DONE]') {
                break
            }
            let parsed: any
            try {
                parsed = JSON.parse(evt.data)
            } catch {
                continue
            }
            if (parsed?.error) {
                throw new Error(typeof parsed.error === 'string' ? parsed.error : (parsed.error.message ?? JSON.stringify(parsed.error)))
            }
            for (const e of chunkToEvents(parsed)) {
                if (e.type === 'done') {
                    sawDone = true
                }
                yield e
            }
        }
        if (!sawDone) {
            yield { type: 'done', finishReason: null }
        }
    }

    async ping (): Promise<{ ok: true, models?: string[] }> {
        const url = modelsUrl(this.config.endpoint)
        try {
            const res = await streamRequest(url, { method: 'GET', headers: this.headers(), timeoutMs: 10000 })
            const text = await readAll(res.chunks)
            if (res.status >= 200 && res.status < 300) {
                try {
                    const parsed = JSON.parse(text)
                    const models = (parsed?.data ?? parsed?.models ?? []).map((m: any) => m.id ?? m.name).filter(Boolean)
                    return { ok: true, models }
                } catch {
                    return { ok: true }
                }
            }
            // /v1/models is optional; fall back to a 1-token completion
            if (res.status !== 404 && res.status !== 405) {
                throw new HttpError(res.status, extractErrorMessage(text), url)
            }
        } catch (e) {
            if (e instanceof HttpError) {
                throw e
            }
            throw new Error(`Cannot reach ${url}: ${(e as Error).message}`)
        }
        const completions = chatCompletionsUrl(this.config.endpoint)
        const res = await streamRequest(completions, {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify({ model: this.config.model || 'default', messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, stream: false }),
            timeoutMs: 20000,
        })
        const text = await readAll(res.chunks)
        if (res.status < 200 || res.status >= 300) {
            throw new HttpError(res.status, extractErrorMessage(text), completions)
        }
        return { ok: true }
    }
}

function extractErrorMessage (text: string): string {
    try {
        const parsed = JSON.parse(text)
        const msg = parsed?.error?.message ?? parsed?.message ?? parsed?.error ?? parsed?.detail
        if (msg) {
            return typeof msg === 'string' ? msg : JSON.stringify(msg)
        }
    } catch {
        // not JSON
    }
    return text
}
