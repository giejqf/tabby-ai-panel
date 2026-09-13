// dispatch a hotkey chord: node keys.mjs y ctrl alt
const [key, ...mods] = process.argv.slice(2)
const targets = await (await fetch('http://localhost:9222/json')).json()
const page = targets.find(t => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0; const pending = new Map()
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
const send = (method, params) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
await new Promise(r => { ws.onopen = r })
let modifiers = 0
if (mods.includes('alt')) modifiers |= 1
if (mods.includes('ctrl')) modifiers |= 2
if (mods.includes('meta')) modifiers |= 4
if (mods.includes('shift')) modifiers |= 8
const codeFor = k => k.length === 1 ? 'Key' + k.toUpperCase() : k
const down = async (k, code, m) => send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, modifiers: m, windowsVirtualKeyCode: k.length === 1 ? k.toUpperCase().charCodeAt(0) : 0 })
const up = async (k, code, m) => send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, modifiers: m })
if (mods.includes('ctrl')) await down('Control', 'ControlLeft', 2)
if (mods.includes('alt')) await down('Alt', 'AltLeft', modifiers)
await down(key, codeFor(key), modifiers)
await up(key, codeFor(key), modifiers)
if (mods.includes('alt')) await up('Alt', 'AltLeft', 2)
if (mods.includes('ctrl')) await up('Control', 'ControlLeft', 0)
console.log('sent', key, mods.join('+'))
ws.close()
