/**
 * Match a Tabby hotkey string (e.g. "Ctrl-Alt-A", "⌘-Shift-Y") against a
 * keyboard event. Used while Tabby's own hotkey service is suspended because
 * the user is typing in the panel.
 */

export interface KeyEventLike {
    key: string
    code: string
    ctrlKey: boolean
    altKey: boolean
    shiftKey: boolean
    metaKey: boolean
}

const META_TOKENS = ['⌘', 'cmd', 'meta', 'win', 'super']
const ALT_TOKENS = ['alt', '⌥', 'option']

export function matchKeystroke (keystroke: string, event: KeyEventLike): boolean {
    const parts = keystroke.split('-').map(p => p.trim()).filter(Boolean)
    if (!parts.length) {
        return false
    }
    const key = parts.pop()!.toLowerCase()
    const mods = parts.map(p => p.toLowerCase())
    const wantCtrl = mods.includes('ctrl') || mods.includes('control')
    const wantAlt = mods.some(m => ALT_TOKENS.includes(m))
    const wantShift = mods.includes('shift')
    const wantMeta = mods.some(m => META_TOKENS.includes(m))
    if (event.ctrlKey !== wantCtrl || event.altKey !== wantAlt || event.shiftKey !== wantShift || event.metaKey !== wantMeta) {
        return false
    }
    const eventKey = (event.key ?? '').toLowerCase()
    const codeKey = (event.code ?? '').replace(/^(Key|Digit|Arrow)/, '').toLowerCase()
    return key === eventKey || key === codeKey || (key === 'space' && eventKey === ' ')
}

/**
 * Find which of `ids` is bound to the event. `bindings` is Tabby's
 * `config.store.hotkeys` (id → list of keystrokes, or keystroke sequences).
 */
export function findHotkey (bindings: Record<string, unknown> | undefined, ids: string[], event: KeyEventLike): string | null {
    if (!bindings) {
        return null
    }
    for (const id of ids) {
        const list = bindings[id]
        if (!Array.isArray(list)) continue
        for (const binding of list) {
            // multi-keystroke sequences are not supported here; only single chords
            const keystroke = Array.isArray(binding) ? (binding.length === 1 ? binding[0] : null) : binding
            if (typeof keystroke === 'string' && matchKeystroke(keystroke, event)) {
                return id
            }
        }
    }
    return null
}
