/**
 * Cut a long tool result for the model while keeping the head and the tail,
 * which is where the useful information (command echo / final status) lives.
 */
export function truncateForModel (text: string, maxChars: number): { text: string, truncated: boolean } {
    if (!text || text.length <= maxChars) {
        return { text, truncated: false }
    }
    const headChars = Math.floor(maxChars * 0.45)
    const tailChars = Math.floor(maxChars * 0.45)
    const head = text.slice(0, headChars)
    const tail = text.slice(text.length - tailChars)
    const omitted = text.length - headChars - tailChars
    return {
        text: `${head}\n\n[… ${omitted.toLocaleString()} characters omitted — ask for a narrower command (grep/tail) if you need the middle …]\n\n${tail}`,
        truncated: true,
    }
}

/** Collapse runs of blank lines and strip trailing whitespace on every line. */
export function tidyOutput (text: string): string {
    if (!text) {
        return ''
    }
    const lines = text.replace(/\r\n?/g, '\n').split('\n').map(l => l.replace(/[ \t​]+$/g, ''))
    const out: string[] = []
    let blanks = 0
    for (const line of lines) {
        if (line.trim() === '') {
            blanks++
            if (blanks > 2) {
                continue
            }
        } else {
            blanks = 0
        }
        out.push(line)
    }
    while (out.length && out[out.length - 1].trim() === '') {
        out.pop()
    }
    while (out.length && out[0].trim() === '') {
        out.shift()
    }
    return out.join('\n')
}

export function lastNonEmptyLine (text: string): string {
    const lines = text.split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].trim()) {
            return lines[i]
        }
    }
    return ''
}

export function countLines (text: string): number {
    return text ? text.split('\n').length : 0
}

export function relativeTime (iso: string, now = Date.now()): string {
    const t = new Date(iso).getTime()
    if (Number.isNaN(t)) {
        return ''
    }
    const diff = Math.max(0, now - t)
    const s = Math.floor(diff / 1000)
    if (s < 45) return 'just now'
    const m = Math.floor(s / 60)
    if (m < 60) return `${m} min ago`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h} h ago`
    const d = Math.floor(h / 24)
    if (d < 7) return `${d} d ago`
    return new Date(iso).toLocaleDateString()
}

/** A one-line title derived from the first user message. */
export function deriveTitle (text: string, max = 60): string {
    const firstLine = (text || '').split('\n').map(l => l.trim()).find(l => l.length > 0) ?? ''
    const cleaned = firstLine.replace(/\s+/g, ' ')
    if (cleaned.length <= max) {
        return cleaned || 'New session'
    }
    return cleaned.slice(0, max - 1).trimEnd() + '…'
}

export function formatDuration (ms: number): string {
    if (ms < 1000) return `${Math.round(ms)} ms`
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
    const m = Math.floor(ms / 60_000)
    const s = Math.round((ms % 60_000) / 1000)
    return `${m}m ${s}s`
}
