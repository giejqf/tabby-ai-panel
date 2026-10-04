/** A model as listed by the server's `/v1/models`. */
export interface ModelInfo {
    id: string
    /** Display name when the server provides one that differs from the id (OpenRouter). */
    name?: string
    contextLength?: number
    /** Whether the model supports tool calling, when the server says so (OpenRouter). */
    tools?: boolean
}

/**
 * Parse a `/v1/models` response. Accepts the OpenAI shape (`{ data: [...] }`),
 * Ollama's `{ models: [...] }` and a bare array. Sorted by id, deduplicated.
 */
export function parseModelList (json: any): ModelInfo[] {
    const raw: any[] = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : []
    const byId = new Map<string, ModelInfo>()
    for (const m of raw) {
        const id = typeof m === 'string' ? m : m?.id ?? m?.model ?? m?.name
        if (typeof id !== 'string' || !id.trim() || byId.has(id)) continue
        const info: ModelInfo = { id }
        if (typeof m === 'object') {
            if (typeof m.name === 'string' && m.name.trim() && m.name !== id) info.name = m.name
            const ctx = [m.context_length, m.context_window, m.max_context_length, m.top_provider?.context_length]
                .find(v => typeof v === 'number' && v > 0)
            if (ctx) info.contextLength = ctx
            if (Array.isArray(m.supported_parameters)) info.tools = m.supported_parameters.includes('tools')
        }
        byId.set(id, info)
    }
    return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' }))
}

/** Every whitespace-separated word of the query must occur in the id or name. */
export function filterModels (models: ModelInfo[], query: string): ModelInfo[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (!words.length) return models
    return models.filter(m => {
        const hay = `${m.id} ${m.name ?? ''}`.toLowerCase()
        return words.every(w => hay.includes(w))
    })
}

/** 131072 → "128k", 1000000 → "1M" */
export function formatContextLength (n: number): string {
    if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`
    // binary sizes (32768, 131072) are meant as 32k, 128k; round ones (128000) as written
    const binary = n % 1024 === 0 && n % 1000 !== 0
    if (n >= 1000) return `${Math.round(binary ? n / 1024 : n / 1000)}k`
    return String(n)
}
