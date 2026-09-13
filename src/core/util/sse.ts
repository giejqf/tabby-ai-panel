import * as http from 'http'
import * as https from 'https'
import { URL } from 'url'

export interface StreamRequestOptions {
    method?: string
    headers?: Record<string, string>
    body?: string
    signal?: AbortSignal
    timeoutMs?: number
}

export interface StreamResponse {
    status: number
    headers: Record<string, string | string[] | undefined>
    /** Decoded text chunks. */
    chunks: AsyncIterable<string>
}

export class HttpError extends Error {
    constructor (public status: number, public body: string, url: string) {
        super(`HTTP ${status} from ${url}${body ? `: ${body.slice(0, 600)}` : ''}`)
        this.name = 'HttpError'
    }
}

/**
 * Perform an HTTP request through Node's http/https (available in Tabby's
 * renderer) and expose the response body as an async iterable of text.
 * Using Node instead of `fetch` sidesteps CORS on self-hosted endpoints.
 */
export function streamRequest (url: string, options: StreamRequestOptions = {}): Promise<StreamResponse> {
    return new Promise((resolve, reject) => {
        let target: URL
        try {
            target = new URL(url)
        } catch {
            reject(new Error(`Invalid URL: ${url}`))
            return
        }
        const lib = target.protocol === 'https:' ? https : http
        const body = options.body ?? ''
        const headers: Record<string, string> = {
            ...(options.headers ?? {}),
        }
        if (body) {
            headers['Content-Length'] = String(Buffer.byteLength(body))
        }
        const req = lib.request(target, {
            method: options.method ?? 'GET',
            headers,
        }, res => {
            const status = res.statusCode ?? 0
            if (status >= 300 && status < 400 && res.headers.location && !(options as any).__redirected) {
                res.resume()
                const next = new URL(res.headers.location, target).toString()
                streamRequest(next, { ...options, __redirected: true } as any).then(resolve, reject)
                return
            }
            res.setEncoding('utf8')
            const chunks = iterateStream(res, options.signal)
            resolve({ status, headers: res.headers, chunks })
        })
        req.on('error', err => reject(err))
        if (options.timeoutMs) {
            req.setTimeout(options.timeoutMs, () => {
                req.destroy(new Error(`Request timed out after ${options.timeoutMs} ms`))
            })
        }
        if (options.signal) {
            if (options.signal.aborted) {
                req.destroy(abortError())
                reject(abortError())
                return
            }
            options.signal.addEventListener('abort', () => req.destroy(abortError()), { once: true })
        }
        if (body) {
            req.write(body)
        }
        req.end()
    })
}

async function* iterateStream (res: http.IncomingMessage, signal?: AbortSignal): AsyncGenerator<string> {
    const queue: string[] = []
    let done = false
    let error: Error | null = null
    let wake: (() => void) | null = null
    const notify = () => { if (wake) { const w = wake; wake = null; w() } }

    res.on('data', (chunk: string) => { queue.push(chunk); notify() })
    res.on('end', () => { done = true; notify() })
    res.on('error', err => { error = err; done = true; notify() })
    res.on('close', () => { done = true; notify() })

    while (true) {
        if (queue.length) {
            yield queue.shift()!
            continue
        }
        if (error) {
            throw error
        }
        if (done) {
            return
        }
        if (signal?.aborted) {
            throw abortError()
        }
        await new Promise<void>(r => { wake = r })
    }
}

export async function readAll (chunks: AsyncIterable<string>): Promise<string> {
    let out = ''
    for await (const c of chunks) {
        out += c
    }
    return out
}

export interface SSEEvent {
    event?: string
    data: string
}

/** Parse a text/event-stream body into events. Tolerates `\r\n` and comment lines. */
export async function* parseSSE (chunks: AsyncIterable<string>): AsyncGenerator<SSEEvent> {
    let buffer = ''
    for await (const chunk of chunks) {
        buffer += chunk
        let idx: number
        // events are separated by a blank line
        while ((idx = buffer.search(/\r?\n\r?\n/)) !== -1) {
            const sepLen = buffer[idx] === '\r' ? 4 : 2
            const raw = buffer.slice(0, idx)
            buffer = buffer.slice(idx + sepLen)
            const evt = parseEventBlock(raw)
            if (evt) {
                yield evt
            }
        }
    }
    const tail = parseEventBlock(buffer)
    if (tail) {
        yield tail
    }
}

function parseEventBlock (raw: string): SSEEvent | null {
    const dataLines: string[] = []
    let event: string | undefined
    for (const line of raw.split(/\r?\n/)) {
        if (!line || line.startsWith(':')) {
            continue
        }
        const colon = line.indexOf(':')
        const field = colon === -1 ? line : line.slice(0, colon)
        let value = colon === -1 ? '' : line.slice(colon + 1)
        if (value.startsWith(' ')) {
            value = value.slice(1)
        }
        if (field === 'data') {
            dataLines.push(value)
        } else if (field === 'event') {
            event = value
        }
    }
    if (!dataLines.length) {
        return null
    }
    return { event, data: dataLines.join('\n') }
}

export function abortError (): Error {
    const e = new Error('The operation was aborted')
    e.name = 'AbortError'
    return e
}

export function isAbortError (e: unknown): boolean {
    return !!e && typeof e === 'object' && (e as any).name === 'AbortError'
}
