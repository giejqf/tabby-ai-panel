import * as fs from 'fs'
const targets = await (await fetch('http://localhost:9222/json')).json()
const page = targets.find(t => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0; const pending = new Map()
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
const send = (method, params) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
await new Promise(r => { ws.onopen = r })
const evaluate = async expr => {
    const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
    if (res.result?.exceptionDetails) throw new Error(res.result.exceptionDetails.exception?.description ?? JSON.stringify(res.result.exceptionDetails))
    return res.result?.result?.value
}
const shot = async name => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(name, Buffer.from(r.result.data, 'base64')) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const waitFor = async (expr, timeout = 20000) => {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
        const v = await evaluate(expr)
        if (v) return v
        await sleep(250)
    }
    throw new Error('timeout waiting for ' + expr)
}
const step = process.argv[2]
const out = {}

if (step === 'send') {
    const text = process.argv[3]
    await evaluate(`(() => {
        const ta = document.querySelector('ai-composer textarea')
        ta.focus()
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
        setter.call(ta, ${JSON.stringify(text)})
        ta.dispatchEvent(new Event('input', { bubbles: true }))
        return ta.value
    })()`)
    await sleep(200)
    await evaluate(`document.querySelector('ai-composer .send-btn').click()`)
    out.sent = text
}
if (step === 'wait-approval') {
    out.card = await waitFor(`(() => { const c = document.querySelector('ai-tool-call .tool-call.pending'); return c ? c.innerText.replace(/\\s+/g, ' ') : null })()`)
    await shot(process.argv[3] ?? 'approval.png')
}
if (step === 'approve') {
    await evaluate(`document.querySelector('ai-tool-call .tool-call.pending .ai-btn.primary').click()`)
    out.approved = true
}
if (step === 'answer') {
    await evaluate(`Array.from(document.querySelectorAll('ai-tool-call .choices .ai-btn')).find(b => b.innerText.trim() === ${JSON.stringify(process.argv[3])}).click()`)
    out.answered = process.argv[3]
}
if (step === 'wait-idle') {
    await waitFor(`!document.querySelector('ai-composer .send-btn.stop')`, 60000)
    out.transcript = await evaluate(`document.querySelector('ai-transcript').innerText`)
    out.chips = await evaluate(`Array.from(document.querySelectorAll('ai-terminal-strip .chip')).map(c => c.innerText.replace(/\\s+/g,' ') + ' [' + c.className.replace('chip','').trim() + ']')`)
    out.cards = await evaluate(`Array.from(document.querySelectorAll('ai-tool-call .tool-call')).map(c => ({ cls: c.className, head: c.querySelector('.tc-header').innerText.replace(/\\s+/g,' '), out: c.querySelector('.tc-output')?.innerText ?? null }))`)
    out.terminalText = await evaluate(`Array.from(document.querySelectorAll('.xterm-rows > div')).map(r => r.innerText).filter(t => t.trim()).join('\\n')`)
    await shot(process.argv[3] ?? 'idle.png')
}
if (step === 'eval') {
    out.value = await evaluate(process.argv[3])
}
if (step === 'shot') { await shot(process.argv[3]) }
console.log(JSON.stringify(out, null, 1))
ws.close()
