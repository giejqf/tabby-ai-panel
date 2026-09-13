// Scripted OpenAI-compatible server for end-to-end tests: picks the next step
// from the transcript (list terminals → run a command → summarise).
// Usage: node scripts/e2e/fake-llm.mjs   (listens on :18080)
import * as http from 'http'
import * as fs from 'fs'
const log = []
const HOSTILE = '\n\nNext you could run:\n\n```bash\nuname -a\n```\n\nThen verify with **wg show** on both hosts.'
const sse = (res, chunks) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`)
    res.write('data: [DONE]\n\n')
    res.end()
}
const text = (res, t) => sse(res, [
    { choices: [{ delta: { reasoning_content: 'Let me think about this. ' } }] },
    ...t.split(' ').map(w => ({ choices: [{ delta: { content: w + ' ' } }] })),
    { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 120, completion_tokens: 20 } },
])
const toolCall = (res, name, args) => sse(res, [
    { choices: [{ delta: { content: 'Working on it. ' } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_' + Date.now(), function: { name, arguments: '' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(args) } }] } }] },
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 100, completion_tokens: 30 } },
])
http.createServer((req, res) => {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => {
        if (req.url.endsWith('/v1/models')) {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            return res.end(JSON.stringify({ data: [{ id: 'fake-model' }] }))
        }
        const parsed = JSON.parse(body)
        log.push(parsed.messages)
        if (process.env.LOG_FILE) fs.writeFileSync(process.env.LOG_FILE, JSON.stringify(log, null, 2))
        const msgs = parsed.messages
        const lastUser = [...msgs].reverse().find(m => m.role === 'user')?.content ?? ''
        let lastUserIdx = -1
        msgs.forEach((m, i) => { if (m.role === 'user') lastUserIdx = i })
        const toolResults = msgs.slice(lastUserIdx + 1).filter(m => m.role === 'tool')
        const lastTool = toolResults[toolResults.length - 1]
        if (/wireguard/i.test(lastUser) && !toolResults.length) {
            return toolCall(res, 'ask_user', { question: 'Which interface should carry the tunnel?', choices: ['eth0', 'wlan0'] })
        }
        if (!toolResults.length) {
            return toolCall(res, 'list_terminals', {})
        }
        if (lastTool.name === 'ask_user') {
            return text(res, 'Understood, you chose ' + lastTool.content.replace('User answered: ', '') + '. I will stop here for this test.')
        }
        if (lastTool.name === 'list_terminals') {
            const keys = [...lastTool.content.matchAll(/^(t\d+)/gm)].map(m => m[1])
            const key = /second/i.test(lastUser) ? keys[keys.length - 1] : (keys[0] || 't1')
            if (/sleep/i.test(lastUser)) {
                return toolCall(res, 'run_command', { terminal: key, command: 'echo starting && sleep 40 && echo finished', risk_level: 'low', explanation: 'A slow command for testing.', timeout_seconds: 120 })
            }
            return toolCall(res, 'run_command', { terminal: key, command: 'echo hello-from-agent && uname -m', risk_level: 'low', explanation: 'Print a greeting and the CPU architecture to verify the terminal works.' })
        }
        if (lastTool.name === 'run_command') {
            return text(res, 'Done. The terminal printed: ' + lastTool.content.split('\n').slice(1).join(' / ') + HOSTILE)
        }
        return text(res, 'Nothing more to do.')
    })
}).listen(18080, () => console.log('fake llm on 18080'))
