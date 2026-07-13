const test = require('node:test');
const assert = require('node:assert/strict');
const { getRecentThreads, getWorkspaces } = require('../src/parser');
const { normalizeWorkspacePath } = require('../src/conversations');

test('default sidebar excludes scheduled and synthetic task conversations', async () => {
    const threads = await getRecentThreads(500);
    assert.ok(threads.every(thread => !thread.isScheduled), 'scheduled run leaked into default sidebar');
    assert.ok(threads.every(thread => !thread.isSyntheticTask), 'synthetic task prompt leaked into default sidebar');
    assert.ok(threads.every(thread => thread.id && thread.title), 'sidebar thread is missing identity');
});

test('scheduled filter preserves default threads and only adds source-19 runs', async () => {
    const [normal, inclusive] = await Promise.all([
        getRecentThreads(500),
        getRecentThreads(500, { includeScheduled: true })
    ]);
    const inclusiveIds = new Set(inclusive.map(thread => thread.id));
    assert.ok(normal.every(thread => inclusiveIds.has(thread.id)), 'scheduled view dropped default conversation');
    assert.ok(inclusive.filter(thread => thread.isScheduled).every(thread => thread.source === 19), 'non-source-19 conversation marked scheduled');
    assert.ok(inclusive.every(thread => !thread.isSyntheticTask), 'synthetic task prompt leaked into scheduled filter');
});

test('Antigravity project paths have stable normalized identities', () => {
    const workspaces = getWorkspaces();
    const paths = workspaces.map(workspace => normalizeWorkspacePath(workspace.path)).filter(Boolean);
    assert.equal(new Set(paths).size, paths.length, 'duplicate Antigravity project path');
    assert.ok(workspaces.every(workspace => workspace.id && workspace.name && workspace.path), 'project metadata is incomplete');
});
