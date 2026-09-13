import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assessCommand, isAutoApproved } from '../src/core/util/risk'

test('catastrophic commands are hard-blocked regardless of the claim', () => {
    for (const cmd of ['rm -rf /', 'sudo rm -rf / --no-preserve-root', 'mkfs.ext4 /dev/sda1', 'dd if=/dev/zero of=/dev/nvme0n1', ':(){ :|:& };:', 'sudo reboot', 'iptables -F']) {
        const a = assessCommand(cmd, 'low')
        assert.equal(a.level, 'high', cmd)
        assert.ok(a.hardBlock, cmd)
    }
})

test('mutating commands are at least medium', () => {
    assert.equal(assessCommand('sudo apt install -y wireguard', 'low').level, 'medium')
    assert.equal(assessCommand('rm -r build', 'low').level, 'medium')
    assert.equal(assessCommand('ip addr show', 'low').level, 'medium')   // network tool – conservative
    assert.equal(assessCommand('ls -la', 'low').level, 'low')
    assert.equal(assessCommand('cat /etc/os-release', 'medium').level, 'medium')  // model may raise
    assert.equal(assessCommand('ls', 'high').level, 'high')
})

test('auto-approval respects mode and hard blocks', () => {
    assert.ok(isAutoApproved('low', 'auto_low', false))
    assert.ok(!isAutoApproved('medium', 'auto_low', false))
    assert.ok(isAutoApproved('medium', 'auto_medium', false))
    assert.ok(!isAutoApproved('high', 'auto_medium', false))
    assert.ok(isAutoApproved('high', 'auto_all', false))
    assert.ok(!isAutoApproved('high', 'auto_all', true))
    assert.ok(!isAutoApproved('low', 'ask', false))
})
