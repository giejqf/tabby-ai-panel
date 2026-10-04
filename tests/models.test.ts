import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filterModels, formatContextLength, parseModelList } from '../src/core/llm/models'

test('parseModelList: OpenAI shape, sorted and deduplicated', () => {
    const models = parseModelList({ object: 'list', data: [{ id: 'gpt-4.1' }, { id: 'GPT-3.5-turbo' }, { id: 'gpt-4.1' }, { id: 'qwen3-8b' }, { id: 'qwen3-32b' }] })
    assert.deepEqual(models.map(m => m.id), ['GPT-3.5-turbo', 'gpt-4.1', 'qwen3-8b', 'qwen3-32b'])
    assert.equal(models[0].name, undefined)
    assert.equal(models[0].tools, undefined)
})

test('parseModelList: OpenRouter metadata', () => {
    const [m] = parseModelList({
        data: [{
            id: 'anthropic/claude-sonnet-4.5',
            name: 'Anthropic: Claude Sonnet 4.5',
            context_length: 1000000,
            supported_parameters: ['tools', 'temperature'],
        }, {
            id: 'some/plain-model',
            name: 'some/plain-model',
            top_provider: { context_length: 32768 },
            supported_parameters: ['temperature'],
        }],
    })
    assert.deepEqual(m, { id: 'anthropic/claude-sonnet-4.5', name: 'Anthropic: Claude Sonnet 4.5', contextLength: 1000000, tools: true })
    const plain = parseModelList({ data: [{ id: 'x', name: 'x', top_provider: { context_length: 32768 }, supported_parameters: [] }] })[0]
    assert.deepEqual(plain, { id: 'x', contextLength: 32768, tools: false })
})

test('parseModelList: Ollama, bare arrays and junk', () => {
    assert.deepEqual(parseModelList({ models: [{ name: 'llama3:8b', model: 'llama3:8b' }] }).map(m => m.id), ['llama3:8b'])
    assert.deepEqual(parseModelList(['a', 'b']).map(m => m.id), ['a', 'b'])
    assert.deepEqual(parseModelList({ data: [null, {}, { id: '' }, { id: 42 }, { id: 'ok' }] }).map(m => m.id), ['ok'])
    assert.deepEqual(parseModelList(null), [])
    assert.deepEqual(parseModelList({ error: 'nope' }), [])
})

test('filterModels matches every word against id and name', () => {
    const models = parseModelList({ data: [
        { id: 'anthropic/claude-sonnet-4.5', name: 'Anthropic: Claude Sonnet 4.5' },
        { id: 'openai/gpt-4.1' },
        { id: 'qwen/qwen3-coder', name: 'Qwen3 Coder' },
    ] })
    assert.equal(filterModels(models, '').length, 3)
    assert.deepEqual(filterModels(models, 'sonnet').map(m => m.id), ['anthropic/claude-sonnet-4.5'])
    assert.deepEqual(filterModels(models, '  QWEN   coder ').map(m => m.id), ['qwen/qwen3-coder'])
    assert.deepEqual(filterModels(models, 'claude gpt'), [])
})

test('formatContextLength', () => {
    assert.equal(formatContextLength(131072), '128k')
    assert.equal(formatContextLength(128000), '128k')
    assert.equal(formatContextLength(200000), '200k')
    assert.equal(formatContextLength(32768), '32k')
    assert.equal(formatContextLength(1048576), '1M')
    assert.equal(formatContextLength(1000000), '1M')
    assert.equal(formatContextLength(2500000), '2.5M')
    assert.equal(formatContextLength(196608), '192k')
    assert.equal(formatContextLength(512), '512')
})
