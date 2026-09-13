// Minimal CDP client: node cdp.mjs '<js expression>'   (awaits promises)
const expr = process.argv[2]
const targets = await (await fetch('http://localhost:9222/json')).json()
const page = targets.find(t => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
ws.onmessage = ev => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
}
const send = (method, params) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
await new Promise(r => { ws.onopen = r })
const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 120000 })
if (res.result?.exceptionDetails) {
    console.error('EXCEPTION:', JSON.stringify(res.result.exceptionDetails.exception?.description ?? res.result.exceptionDetails, null, 1))
    process.exit(1)
}
const v = res.result?.result?.value
console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 1))
ws.close()
