const test = require('node:test');
const assert = require('node:assert/strict');
const { commandInvocation, desktopModelLabelFromId, formatAutomationSchedule, modelFromRolloutText, modelIdFromDesktopLabel, normalizeAutomation, normalizeDesktopState, normalizeMessages, normalizeThread, parseAutomationToml, updatePinnedProjectIds, updatePinnedThreadIds } = require('../src/codexBridge');

test('Codex bridge uses repo-pinned App Server', () => {
    const invocation = commandInvocation();
    assert.equal(invocation.executable, process.execPath);
    assert.equal(invocation.args[0], require.resolve('@openai/codex/bin/codex.js'));
    assert.deepEqual(invocation.args.slice(1), ['app-server', '--listen', 'stdio://']);
});

test('Codex desktop state identifies projects, projectless tasks, and pins', () => {
    const state = normalizeDesktopState({
        'electron-persisted-atom-state': {
            'electron-saved-workspace-roots': ['C:\\stale']
        },
        'electron-saved-workspace-roots': ['C:\\work\\repo', 'C:\\work\\empty'],
        'project-order': ['C:\\work\\repo'],
        'pinned-project-ids': ['C:\\work\\repo'],
        'sidebar-project-expanded-v1-codex:C:\\work\\repo': true,
        'projectless-thread-ids': ['task-thread', 'assigned-thread'],
        'pinned-thread-ids': ['pinned-thread'],
        'thread-project-assignments': {
            'assigned-thread': { path: 'C:\\work\\repo' }
        }
    });

    assert.equal(state.workspaces.length, 2);
    assert.equal(state.workspaces[0].isPinned, true);
    assert.equal(state.workspaces[0].expanded, true);
    assert.equal(state.workspaces[1].expanded, false);
    assert.equal(state.workspaces[1].desktopOrder, 2);
    assert.equal(normalizeThread({ id: 'task-thread' }, state).isProjectless, true);
    assert.equal(normalizeThread({ id: 'pinned-thread' }, state).isPinned, true);
    assert.equal(normalizeThread({ id: 'assigned-thread', cwd: 'C:\\captured' }, state).isProjectless, false);
    assert.equal(normalizeThread({ id: 'assigned-thread', cwd: 'C:\\captured' }, state).workspacePath, 'C:\\work\\repo');
});

test('Codex pin state updates without dropping desktop state', () => {
    const raw = {
        'pinned-thread-ids': ['existing'],
        'electron-persisted-atom-state': { 'pinned-thread-ids': ['existing'] },
        untouched: { value: 1 }
    };
    const pinned = updatePinnedThreadIds(raw, 'new-thread', true);
    const unpinned = updatePinnedThreadIds(pinned, 'existing', false);

    assert.deepEqual(pinned['pinned-thread-ids'], ['existing', 'new-thread']);
    assert.deepEqual(unpinned['pinned-thread-ids'], ['new-thread']);
    assert.deepEqual(unpinned['electron-persisted-atom-state']['pinned-thread-ids'], ['new-thread']);
    assert.deepEqual(unpinned.untouched, { value: 1 });
    assert.deepEqual(raw['pinned-thread-ids'], ['existing']);
    assert.deepEqual(raw['electron-persisted-atom-state']['pinned-thread-ids'], ['existing']);
});

test('Codex pin state restores top-level state from persisted desktop state', () => {
    const next = updatePinnedThreadIds({
        'electron-persisted-atom-state': { 'pinned-thread-ids': ['existing'] }
    }, 'existing', false);

    assert.deepEqual(next['pinned-thread-ids'], []);
    assert.deepEqual(next['electron-persisted-atom-state']['pinned-thread-ids'], []);
});

test('Codex project pin state updates desktop persistence', () => {
    const raw = {
        'electron-persisted-atom-state': { 'pinned-project-ids': ['C:\\work\\existing'] }
    };
    const pinned = updatePinnedProjectIds(raw, 'C:\\work\\new', true);
    const unpinned = updatePinnedProjectIds(pinned, 'C:\\work\\existing', false);

    assert.deepEqual(pinned['pinned-project-ids'], ['C:\\work\\existing', 'C:\\work\\new']);
    assert.deepEqual(unpinned['pinned-project-ids'], ['C:\\work\\new']);
    assert.deepEqual(unpinned['electron-persisted-atom-state']['pinned-project-ids'], ['C:\\work\\new']);
});

test('Codex automation metadata maps to scheduled task shape', () => {
    const automation = parseAutomationToml(`version = 1\nid = "follow-up-monitor"\nname = "Follow-up monitor"\nkind = "cron"\nprompt = "Review recent activity."\nstatus = "ACTIVE"\nrrule = "RRULE:FREQ=WEEKLY;BYHOUR=9;BYMINUTE=0;BYDAY=MO,TU,WE,TH,FR"\ntarget = { type = "projectless" }`);
    const task = normalizeAutomation(automation);

    assert.equal(task.provider, 'codex');
    assert.equal(task.id, 'follow-up-monitor');
    assert.equal(task.enabled, true);
    assert.equal(task.workspace, 'global');
    assert.equal(task.schedule, 'Weekly · Mon, Tue, Wed, Thu, Fri · 09:00');
    assert.equal(formatAutomationSchedule(automation.rrule), task.schedule);
});

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

test('Codex active thread exposes active turn state', () => {
    const thread = normalizeThread({
        id: 'thread-active',
        status: { type: 'active' },
        turns: [{ id: 'turn-active', status: 'inProgress', items: [] }]
    });

    assert.equal(thread.isTurnActive, true);
    assert.equal(thread.activeTurnId, 'turn-active');
});

test('Codex desktop model wins over mobile bridge model', () => {
    const rollout = [
        { type: 'turn_context', payload: { model: 'gpt-5.6-terra', approval_policy: 'never', collaboration_mode: { settings: { developer_instructions: 'desktop' } } } },
        { type: 'turn_context', payload: { model: 'gpt-5.6-sol', approval_policy: 'on-request', collaboration_mode: { settings: { developer_instructions: null } } } }
    ].map(entry => JSON.stringify(entry)).join('\n');

    assert.equal(modelFromRolloutText(rollout), 'gpt-5.6-terra');
});

test('Codex desktop model label maps to App Server model ID', () => {
    assert.equal(modelIdFromDesktopLabel('5.6 Luna Medium'), 'gpt-5.6-luna');
    assert.equal(modelIdFromDesktopLabel('5.6 Terra High'), 'gpt-5.6-terra');
    assert.equal(modelIdFromDesktopLabel('GPT-5.4 Mini'), 'gpt-5.4-mini');
});

test('Codex App Server model ID maps to desktop model label', () => {
    assert.equal(desktopModelLabelFromId('gpt-5.6-terra'), '5.6 Terra');
    assert.equal(desktopModelLabelFromId('gpt-5.4-mini'), '5.4 Mini');
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
