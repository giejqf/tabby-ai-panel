import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildMessages, fitContextBudget, messagesSize } from '../src/core/prompt-builder'
import type { Session } from '../src/types/session'
import type { ChatMessage } from '../src/core/llm/types'

function session (): Session {
    return {
        version: 1, id: 's1', title: 't', createdAt: '', updatedAt: '', terminals: [],
        stats: { turns: 0, toolCalls: 0, promptTokens: 0, completionTokens: 0 },
        messages: [
            { id: 'u1', role: 'user', content: 'check disk on @Linux-1', context: '<terminals>\nt1 "Linux-1"\n</terminals>', createdAt: '' },
            {
                id: 'a1', role: 'assistant', content: '', createdAt: '', toolCalls: [
                    { id: 'c1', name: 'run_command', args: { terminal: 't1', command: 'df -h' }, status: 'done', result: 'Filesystem  Size\n/dev/sda1   50G' },
                    { id: 'c2', name: 'read_terminal', args: { terminal: 't1' }, status: 'cancelled' },
                ],
            },
            { id: 'n1', role: 'note', content: 'Session resumed.', createdAt: '', forModel: true },
            { id: 'n2', role: 'note', content: 'ui only', createdAt: '' },
            { id: 'a2', role: 'assistant', content: 'Disk is fine.', createdAt: '', toolCalls: [] },
            { id: 'u2', role: 'user', content: 'thanks', createdAt: '' },
        ],
    }
}

test('buildMessages produces a well-formed transcript', () => {
    const msgs = buildMessages(session(), { systemPrompt: 'SYS', additionalSystemPrompt: 'EXTRA', maxToolResultChars: 1000, maxContextChars: 100000 })
    assert.equal(msgs[0].role, 'system')
    assert.equal(msgs[0].content, 'SYS\n\nEXTRA')
    assert.equal(msgs[1].role, 'user')
    assert.ok(msgs[1].content.startsWith('<terminals>'))
    assert.ok(msgs[1].content.endsWith('check disk on @Linux-1'))
    assert.equal(msgs[2].role, 'assistant')
    assert.equal((msgs[2] as any).toolCalls.length, 2)
    assert.equal((msgs[2] as any).toolCalls[0].arguments, '{"terminal":"t1","command":"df -h"}')
    assert.deepEqual(msgs[3], { role: 'tool', toolCallId: 'c1', name: 'run_command', content: 'Filesystem  Size\n/dev/sda1   50G' })
    assert.equal(msgs[4].role, 'tool')
    assert.match((msgs[4] as any).content, /Cancelled/)
    // forModel note merged as a user message; ui-only note skipped
    assert.equal(msgs[5].role, 'user')
    assert.equal(msgs[5].content, '[note] Session resumed.')
    assert.equal(msgs[6].role, 'assistant')
    assert.equal(msgs[6].content, 'Disk is fine.')
    assert.equal(msgs[7].role, 'user')
    assert.equal(msgs.length, 8)
})

test('tool results are truncated for the model and flagged', () => {
    const s = session()
    const call = (s.messages[1] as any).toolCalls[0]
    call.result = 'x'.repeat(5000)
    const msgs = buildMessages(s, { systemPrompt: 'SYS', maxToolResultChars: 500, maxContextChars: 100000 })
    assert.ok((msgs[3] as any).content.length < 700)
    assert.equal(call.truncatedForModel, true)
})

test('fitContextBudget elides old tool output before dropping turns', () => {
    const big = 'o'.repeat(5000)
    const msgs: ChatMessage[] = [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'first' },
        { role: 'assistant', content: null, toolCalls: [{ id: 'c1', name: 'run_command', arguments: '{}' }] },
        { role: 'tool', toolCallId: 'c1', name: 'run_command', content: big },
        { role: 'assistant', content: 'done' },
        { role: 'user', content: 'second' },
    ]
    const fitted = fitContextBudget(msgs, 2000)
    assert.equal(fitted.length, msgs.length)
    assert.match((fitted[3] as any).content, /elided/)
    assert.ok(messagesSize(fitted) <= 2000)
    // original untouched
    assert.equal((msgs[3] as any).content, big)
})

test('fitContextBudget drops oldest exchanges together with their tool results', () => {
    const msgs: ChatMessage[] = [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'a'.repeat(300) },
        { role: 'assistant', content: null, toolCalls: [{ id: 'c1', name: 'x', arguments: '{}' }] },
        { role: 'tool', toolCallId: 'c1', name: 'x', content: 'r'.repeat(300) },
        { role: 'assistant', content: 'b'.repeat(300) },
        { role: 'user', content: 'c'.repeat(300) },
        { role: 'assistant', content: 'd'.repeat(300) },
        { role: 'user', content: 'last' },
    ]
    const fitted = fitContextBudget(msgs, 900)
    assert.equal(fitted[0].role, 'system')
    assert.equal(fitted[fitted.length - 1].content, 'last')
    assert.ok(!fitted.some(m => m.role === 'tool'), 'orphan tool results must not remain')
    assert.match(fitted[1].content as string, /truncated/)
    assert.ok(messagesSize(fitted) <= 900 + 80)
})
