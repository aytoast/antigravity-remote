const test = require('node:test');
const assert = require('node:assert/strict');
const { buildConversationIndex, createConversationLoader, normalizeWorkspacePath } = require('../src/conversations');

test('same folder path merges Codex and Antigravity into one project', () => {
    const result = buildConversationIndex({
        antigravityWorkspaces: [{ id: 'ag-project', name: 'Repo', path: 'C:\\Work\\Repo' }],
        visibleThreads: [{ id: 'ag-thread', title: 'Antigravity task', order: 0 }],
        localThreads: [{ id: 'ag-thread', workspacePath: 'c:/work/repo/', lastUpdated: '2026-01-01' }],
        codexThreads: [{ id: 'codex-thread', provider: 'codex', title: 'Codex task', workspacePath: 'C:/WORK/REPO' }]
    });

    assert.equal(result.workspaces.length, 1);
    assert.deepEqual(result.workspaces[0].providers, ['antigravity', 'codex']);
    assert.equal(result.threads.find(thread => thread.id === 'ag-thread').provider, 'antigravity');
    assert.equal(result.threads.find(thread => thread.id === 'codex-thread').provider, 'codex');
});

test('same folder name at different paths stays separate', () => {
    const result = buildConversationIndex({
        antigravityWorkspaces: [{ name: 'Repo', path: 'C:/work/repo' }],
        codexThreads: [{ id: 'codex-thread', provider: 'codex', title: 'Task', workspacePath: 'D:/work/repo' }]
    });
    assert.equal(result.workspaces.length, 2);
    assert.equal(new Set(result.workspaces.map(workspace => normalizeWorkspacePath(workspace.path))).size, 2);
});

test('conversation loader coalesces concurrent requests and caches result', async () => {
    let calls = 0;
    let release;
    const source = new Promise(resolve => { release = resolve; });
    const load = createConversationLoader(async () => {
        calls += 1;
        await source;
        return { codexThreads: [] };
    }, 10_000);

    const first = load();
    const second = load();
    release();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    const cached = await load();

    assert.equal(calls, 1);
    assert.strictEqual(firstResult, secondResult);
    assert.strictEqual(firstResult, cached);
});
