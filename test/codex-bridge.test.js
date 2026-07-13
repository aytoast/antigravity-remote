const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeMessages, normalizeThread } = require('../src/codexBridge');

test('Codex thread maps to shared conversation shape', () => {
    const thread = normalizeThread({
        id: 'thread-1',
        name: 'Fix auth',
        cwd: 'C:\\work\\repo',
        updatedAt: 1_700_000_000,
        status: { type: 'idle' },
        turns: [{ items: [] }]
    });
    assert.equal(thread.provider, 'codex');
    assert.equal(thread.title, 'Fix auth');
    assert.equal(thread.workspacePath, 'C:\\work\\repo');
    assert.equal(thread.status, 'idle');
});

test('Codex messages map user, assistant, and command items', () => {
    const messages = normalizeMessages({ turns: [{ items: [
        { id: 'u1', type: 'userMessage', content: 'Fix it' },
        { id: 'a1', type: 'agentMessage', text: 'Done' },
        { id: 'c1', type: 'commandExecution', command: 'npm test', aggregatedOutput: 'passed' },
        { id: 'ignored', type: 'reasoning' }
    ] }] });
    assert.deepEqual(messages.map(message => message.role), ['user', 'ai', 'event']);
    assert.equal(messages[2].title, 'npm test');
    assert.equal(messages[2].detail, 'passed');
});

test('Codex structured user content renders as text', () => {
    const messages = normalizeMessages({
        turns: [{ items: [{
            id: 'structured-user',
            type: 'userMessage',
            content: [
                { type: 'text', text: 'Review this image' },
                { type: 'localImage', path: 'C:\\Temp\\image.png' }
            ]
        }] }]
    });

    assert.equal(messages[0].content, 'Review this image\nAttached image: C:\\Temp\\image.png');
});
