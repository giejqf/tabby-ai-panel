import { test } from 'node:test'
import assert from 'node:assert/strict'
import { truncateForModel, tidyOutput, deriveTitle, relativeTime } from '../src/core/util/text'

test('truncateForModel keeps head and tail', () => {
    const text = 'a'.repeat(5000) + 'MIDDLE' + 'b'.repeat(5000)
    const cut = truncateForModel(text, 2000)
    assert.ok(cut.truncated)
    assert.ok(cut.text.startsWith('aaaa'))
    assert.ok(cut.text.endsWith('bbbb'))
    assert.ok(cut.text.includes('characters omitted'))
    assert.ok(!cut.text.includes('MIDDLE'))
    assert.ok(cut.text.length < 2400)
    assert.deepEqual(truncateForModel('short', 100), { text: 'short', truncated: false })
})

test('tidyOutput collapses blank runs and trailing whitespace', () => {
    assert.equal(tidyOutput('a   \n\n\n\n\nb  \n\n'), 'a\n\n\nb')
    assert.equal(tidyOutput('\r\n\r\nx\r\n'), 'x')
})

test('deriveTitle shortens the first line', () => {
    assert.equal(deriveTitle('  set up wireguard\nbetween hosts'), 'set up wireguard')
    assert.equal(deriveTitle('x'.repeat(100)).length, 60)
    assert.equal(deriveTitle(''), 'New session')
})

test('relativeTime', () => {
    const now = Date.now()
    assert.equal(relativeTime(new Date(now - 10_000).toISOString(), now), 'just now')
    assert.equal(relativeTime(new Date(now - 5 * 60_000).toISOString(), now), '5 min ago')
    assert.equal(relativeTime(new Date(now - 3 * 3600_000).toISOString(), now), '3 h ago')
})
