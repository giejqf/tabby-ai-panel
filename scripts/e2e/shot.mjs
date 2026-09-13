import * as fs from 'fs'
const out = process.argv[2] ?? 'shot.png'
const targets = await (await fetch('http://localhost:9222/json')).json()
const page = targets.find(t => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0; const pending = new Map()
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
const send = (method, params) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
await new Promise(r => { ws.onopen = r })
const res = await send('Page.captureScreenshot', { format: 'png' })
fs.writeFileSync(out, Buffer.from(res.result.data, 'base64'))
console.log('saved', out)
ws.close()
