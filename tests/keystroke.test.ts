import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findHotkey, matchKeystroke } from '../src/core/util/keystroke'

const ev = (key: string, code: string, mods: Partial<{ ctrl: boolean, alt: boolean, shift: boolean, meta: boolean }> = {}) => ({
    key, code, ctrlKey: !!mods.ctrl, altKey: !!mods.alt, shiftKey: !!mods.shift, metaKey: !!mods.meta,
})

test('matchKeystroke handles modifiers and key names', () => {
    assert.ok(matchKeystroke('Ctrl-Alt-A', ev('a', 'KeyA', { ctrl: true, alt: true })))
    assert.ok(matchKeystroke('Ctrl-Alt-A', ev('å', 'KeyA', { ctrl: true, alt: true })), 'matches by code when key is transformed')
    assert.ok(!matchKeystroke('Ctrl-Alt-A', ev('a', 'KeyA', { ctrl: true })), 'missing modifier')
    assert.ok(!matchKeystroke('Ctrl-Alt-A', ev('a', 'KeyA', { ctrl: true, alt: true, shift: true })), 'extra modifier')
    assert.ok(matchKeystroke('⌘-Shift-Y', ev('Y', 'KeyY', { meta: true, shift: true })))
    assert.ok(matchKeystroke('Ctrl-Alt-Enter', ev('Enter', 'Enter', { ctrl: true, alt: true })))
    assert.ok(matchKeystroke('Ctrl-Space', ev(' ', 'Space', { ctrl: true })))
    assert.ok(!matchKeystroke('', ev('a', 'KeyA')))
})

test('findHotkey resolves ids from Tabby bindings', () => {
    const bindings = {
        'ai-panel-approve': ['Ctrl-Alt-Y'],
        'ai-panel-deny': ['Ctrl-Alt-X', ['Ctrl-Alt-D']],
        'ai-panel-stop': [['Ctrl-K', 'S']],   // sequence – unsupported, ignored
        'paste': ['Ctrl-Shift-V'],
    }
    const ids = ['ai-panel-approve', 'ai-panel-deny', 'ai-panel-stop']
    assert.equal(findHotkey(bindings, ids, ev('y', 'KeyY', { ctrl: true, alt: true })), 'ai-panel-approve')
    assert.equal(findHotkey(bindings, ids, ev('d', 'KeyD', { ctrl: true, alt: true })), 'ai-panel-deny')
    assert.equal(findHotkey(bindings, ids, ev('s', 'KeyS')), null)
    assert.equal(findHotkey(bindings, ids, ev('v', 'KeyV', { ctrl: true, shift: true })), null, 'not one of ours')
    assert.equal(findHotkey(undefined, ids, ev('y', 'KeyY', { ctrl: true, alt: true })), null)
})
