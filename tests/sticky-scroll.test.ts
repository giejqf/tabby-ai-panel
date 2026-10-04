import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AT_BOTTOM_PX, distanceFromBottom, nextStuck } from '../src/ui/util/sticky-scroll'

const m = (scrollTop: number, scrollHeight: number, clientHeight = 500) => ({ scrollTop, scrollHeight, clientHeight })

test('distanceFromBottom', () => {
    assert.equal(distanceFromBottom(m(500, 1000)), 0)
    assert.equal(distanceFromBottom(m(300, 1000)), 200)
    // content shorter than the viewport
    assert.equal(distanceFromBottom(m(0, 200)), 0)
})

test('content growth never detaches', () => {
    // we scrolled to 500 (bottom of 1000), then 400px arrived before the scroll event
    assert.equal(nextStuck(true, 500, m(500, 1400)), true)
})

test('scrolling up detaches, even by a little more than the threshold', () => {
    assert.equal(nextStuck(true, 500, m(500 - AT_BOTTOM_PX - 2, 1000)), false)
    assert.equal(nextStuck(true, 500, m(100, 1000)), false)
})

test('tiny jitter at the bottom stays attached', () => {
    assert.equal(nextStuck(true, 500, m(497, 1000)), true)
    assert.equal(nextStuck(false, 400, m(499.5, 1000)), true)
})

test('reaching the bottom again re-attaches', () => {
    assert.equal(nextStuck(false, 200, m(500, 1000)), true)
})

test('scrolling down short of the bottom keeps the current mode', () => {
    assert.equal(nextStuck(false, 100, m(300, 1000)), false)
    // e.g. a smooth scroll toward the bottom started by the jump button
    assert.equal(nextStuck(true, 100, m(300, 1000)), true)
})

test('clamping after content shrank keeps following', () => {
    // at the bottom of 1000, content shrinks to 800: the browser clamps scrollTop to 300
    assert.equal(nextStuck(true, 500, m(300, 800)), true)
})

test('content that does not overflow always follows', () => {
    assert.equal(nextStuck(false, 0, m(0, 300)), true)
})
