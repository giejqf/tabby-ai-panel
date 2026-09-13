import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as http from 'node:http'
import { parseSSE, streamRequest, readAll } from '../src/core/util/sse'
import { chunkToEvents, normalizeBaseUrl, chatCompletionsUrl, OpenAICompatibleProvider } from '../src/core/llm/openai-compatible'

async function* chunks (parts: string[]) {
    for (const p of parts) yield p
}

test('parseSSE handles split chunks and CRLF', async () => {
    const events = []
    for await (const e of parseSSE(chunks(['data: {"a":1}\n\nda', 'ta: {"a":2}\r\n\r\n: comment\n\nevent: x\ndata: 1\ndata: 2\n\n']))) {
        events.push(e)
    }
    assert.deepEqual(events, [
        { event: undefined, data: '{"a":1}' },
        { event: undefined, data: '{"a":2}' },
        { event: 'x', data: '1\n2' },
    ])
})

test('url normalisation', () => {
    assert.equal(normalizeBaseUrl('http://localhost:8080/v1/chat/completions'), 'http://localhost:8080')
    assert.equal(normalizeBaseUrl('http://localhost:8080/v1/'), 'http://localhost:8080')
    assert.equal(chatCompletionsUrl('https://openrouter.ai/api/v1'), 'https://openrouter.ai/api/v1/chat/completions')
})

test('chunkToEvents maps deltas', () => {
    const evts = chunkToEvents({ choices: [{ delta: { content: 'hi', reasoning_content: 'think' }, finish_reason: null }] })
    assert.deepEqual(evts, [{ type: 'reasoning', delta: 'think' }, { type: 'text', delta: 'hi' }])
    const tc = chunkToEvents({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'run_command', arguments: '{"te' } }] } }] })
    assert.deepEqual(tc, [{ type: 'tool_call', index: 0, id: 'c1', name: 'run_command', argumentsDelta: '{"te' }])
    const done = chunkToEvents({ choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 5 } })
    assert.deepEqual(done, [{ type: 'usage', prompt: 10, completion: 5 }, { type: 'done', finishReason: 'tool_calls' }])
})

test('provider streams a fake OpenAI-compatible server end to end', async () => {
    const server = http.createServer((req, res) => {
        let body = ''
        req.on('data', c => { body += c })
        req.on('end', () => {
            const parsed = JSON.parse(body)
            assert.equal(parsed.stream, true)
            assert.equal(parsed.messages[0].role, 'system')
            assert.ok(Array.isArray(parsed.tools))
            res.writeHead(200, { 'Content-Type': 'text/event-stream' })
            res.write('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n')
            res.write('data: {"choices":[{"delta":{"content":"lo"}}]}\n\n')
            res.write('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"list_terminals","arguments":""}}]}}]}\n\n')
            res.write('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{}"}}]},"finish_reason":"tool_calls"}]}\n\n')
            res.write('data: [DONE]\n\n')
            res.end()
        })
    })
    await new Promise<void>(r => server.listen(0, r))
    const port = (server.address() as any).port
    try {
        const provider = new OpenAICompatibleProvider({ endpoint: `http://127.0.0.1:${port}`, model: 'test' })
        const events = []
        for await (const e of provider.stream([{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }], [{ name: 'list_terminals', description: 'd', parameters: { type: 'object', properties: {} } }])) {
            events.push(e)
        }
        assert.deepEqual(events[0], { type: 'text', delta: 'Hel' })
        assert.deepEqual(events[1], { type: 'text', delta: 'lo' })
        assert.equal(events[2].type, 'tool_call')
        assert.equal(events.at(-1)!.type, 'done')
    } finally {
        server.close()
    }
})

test('non-2xx responses throw with the server message', async () => {
    const server = http.createServer((_req, res) => {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'bad key' } }))
    })
    await new Promise<void>(r => server.listen(0, r))
    const port = (server.address() as any).port
    try {
        const provider = new OpenAICompatibleProvider({ endpoint: `http://127.0.0.1:${port}`, model: 'test' })
        await assert.rejects(async () => {
            for await (const _ of provider.stream([{ role: 'user', content: 'hi' }], [])) { /* drain */ }
        }, /401.*bad key/)
    } finally {
        server.close()
    }
})

test('streamRequest aborts', async () => {
    const server = http.createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.write('data: 1\n\n')
        // never ends
    })
    await new Promise<void>(r => server.listen(0, r))
    const port = (server.address() as any).port
    try {
        const ac = new AbortController()
        const res = await streamRequest(`http://127.0.0.1:${port}/`, { signal: ac.signal })
        setTimeout(() => ac.abort(), 50)
        await assert.rejects(() => readAll(res.chunks))
    } finally {
        server.closeAllConnections?.()
        server.close()
    }
})
