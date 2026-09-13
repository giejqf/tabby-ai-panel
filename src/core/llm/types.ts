/** Wire-format-agnostic chat messages fed to a provider. */
export type ChatMessage =
    | { role: 'system', content: string }
    | { role: 'user', content: string }
    | { role: 'assistant', content: string | null, toolCalls?: ChatToolCall[] }
    | { role: 'tool', toolCallId: string, name: string, content: string }

export interface ChatToolCall {
    id: string
    name: string
    /** JSON string as produced by the model. */
    arguments: string
}

export interface ToolSpec {
    name: string
    description: string
    parameters: Record<string, any>   // JSON schema
}

export type ChatStreamEvent =
    | { type: 'text', delta: string }
    | { type: 'reasoning', delta: string }
    | { type: 'tool_call', index: number, id?: string, name?: string, argumentsDelta?: string }
    | { type: 'usage', prompt: number, completion: number }
    | { type: 'done', finishReason: string | null }

export interface ProviderConfig {
    endpoint: string
    apiKey?: string
    model: string
    extraParams?: Record<string, any>
}

export interface ChatProvider {
    stream (messages: ChatMessage[], tools: ToolSpec[], signal?: AbortSignal): AsyncGenerator<ChatStreamEvent>
    /** Quick connectivity check; throws with a readable message on failure. */
    ping (): Promise<{ ok: true, models?: string[] }>
}
