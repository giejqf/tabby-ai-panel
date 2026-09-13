import { test } from 'node:test'
import assert from 'node:assert/strict'
import { learnPromptTerminator, looksLikeInputPrompt, looksLikePrompt, stripEchoAndPrompt } from '../src/core/util/prompt-detect'

test('learns the trailing prompt symbol', () => {
    assert.equal(learnPromptTerminator('ubuntu@linux1:~$ '), '$')
    assert.equal(learnPromptTerminator('root@box:/etc# '), '#')
    assert.equal(learnPromptTerminator('~/project ❯ '), '❯')
    assert.equal(learnPromptTerminator('PS C:\\Users\\me> '), '>')
    assert.equal(learnPromptTerminator(''), null)
    assert.equal(learnPromptTerminator('some output text'), null)
})

test('recognises prompts with learned and generic patterns', () => {
    assert.ok(looksLikePrompt('ubuntu@linux1:~$', '$'))
    assert.ok(looksLikePrompt('(venv) user@host:~/app$ ', null))
    assert.ok(looksLikePrompt('➜  app git:(main) ✗', null) === false)   // not a known terminator
    assert.ok(looksLikePrompt('➜  app', null) === false)
    assert.ok(looksLikePrompt('~ ❯', null))
    assert.ok(!looksLikePrompt('Reading package lists... Done', '$'))
    assert.ok(!looksLikePrompt('', '$'))
})

test('detects interactive input prompts', () => {
    assert.ok(looksLikeInputPrompt('[sudo] password for ubuntu:'))
    assert.ok(looksLikeInputPrompt('Do you want to continue? [Y/n]'))
    assert.ok(looksLikeInputPrompt('Are you sure you want to continue connecting (yes/no/[fingerprint])?'))
    assert.ok(looksLikeInputPrompt("Enter passphrase for key '/home/u/.ssh/id_ed25519':"))
    assert.ok(looksLikeInputPrompt('Press ENTER to continue'))
    assert.ok(!looksLikeInputPrompt('total 12'))
    assert.ok(!looksLikeInputPrompt('ubuntu@linux1:~$'))
})

test('strips the command echo and the returning prompt', () => {
    const lines = [
        'ubuntu@linux1:~$ ls -la /etc/wireguard',
        'total 12',
        '-rw------- 1 root root 200 wg0.conf',
        'ubuntu@linux1:~$',
    ]
    assert.deepEqual(stripEchoAndPrompt(lines, 'ls -la /etc/wireguard', '$'), ['total 12', '-rw------- 1 root root 200 wg0.conf'])
})

test('keeps an input prompt as the last line', () => {
    const lines = ['$ sudo apt install wireguard', 'Reading package lists...', 'Do you want to continue? [Y/n]']
    assert.deepEqual(stripEchoAndPrompt(lines, 'sudo apt install wireguard', '$'), ['Reading package lists...', 'Do you want to continue? [Y/n]'])
})
