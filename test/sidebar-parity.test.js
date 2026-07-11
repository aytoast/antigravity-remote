const test = require('node:test');
const assert = require('node:assert/strict');
const { getRecentThreads, getWorkspaces } = require('../src/parser');

const screenshotTitles = {
    'knowledge-base': [
        'Refresh YouTube Feeds and Build Notes'
    ],
    'notion-skills': ['Syncing Notion Skills Repositories'],
    'prompting-guide': ['Exploring Prompting Guide Repository'],
    'antigravity-remote': [],
    chats: [
        'Testing System Functionality',
        'Reviewing NDA For Aetos',
        'Analyzing Gemini Cron Jobs',
        'Tidying Notion Resource Database',
        'Launching Premium Swim Goggles'
    ]
};

function normalize(value) {
    return value.toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '');
}

test('mobile sidebar contains screenshot conversations and excludes standalone cron threads', async () => {
    const [workspaces, threads] = await Promise.all([getWorkspaces(), getRecentThreads(500)]);
    const grouped = Object.fromEntries(workspaces.map(workspace => [workspace.name, []]));
    const chats = [];

    for (const thread of threads) {
        const workspace = workspaces.find(item => {
            if (!thread.workspacePath) return false;
            const threadPath = normalize(thread.workspacePath);
            const workspacePath = normalize(item.path);
            return threadPath === workspacePath || threadPath.startsWith(`${workspacePath}/`);
        });
        if (workspace) grouped[workspace.name].push(thread.title);
        else if (!thread.workspacePath && !thread.isScheduled) chats.push(thread.title);
    }

    for (const [workspace, titles] of Object.entries(screenshotTitles)) {
        const actual = workspace === 'chats' ? chats : grouped[workspace] || [];
        for (const title of titles) assert.ok(actual.includes(title), `${title} missing from ${workspace}`);
    }

    assert.ok(!threads.some(thread => thread.isScheduled), 'standalone scheduled-task conversation leaked into sidebar');
    assert.ok(!threads.some(thread => /^create a cron\b/i.test(thread.title)), 'cron setup conversation leaked into sidebar');
});

test('dynamic Antigravity annotations match screenshot exactly', async () => {
    const [workspaces, threads] = await Promise.all([getWorkspaces(), getRecentThreads(500)]);
    const grouped = Object.fromEntries(workspaces.map(workspace => [workspace.name, []]));
    const chats = [];

    for (const thread of threads) {
        const workspace = workspaces.find(item => thread.workspacePath && normalize(thread.workspacePath) === normalize(item.path));
        if (workspace) grouped[workspace.name].push(thread.title);
        else if (!thread.workspacePath) chats.push(thread.title);
    }

    assert.deepEqual(grouped['knowledge-base'], screenshotTitles['knowledge-base']);
    assert.deepEqual(grouped['notion-skills'], screenshotTitles['notion-skills']);
    assert.deepEqual(grouped['prompting-guide'], screenshotTitles['prompting-guide']);
    assert.deepEqual(grouped['antigravity-remote'], []);
    assert.deepEqual(chats, screenshotTitles.chats);
});

test('scheduled filter reveals source-19 runs without synthetic task prompts', async () => {
    const [normal, inclusive] = await Promise.all([
        getRecentThreads(500),
        getRecentThreads(500, { includeScheduled: true })
    ]);
    const scheduled = inclusive.filter(thread => thread.isScheduled);

    assert.ok(scheduled.length > 0, 'scheduled filter returned no source-19 runs');
    assert.ok(scheduled.every(thread => thread.source === 19), 'non-source-19 conversation marked scheduled');
    assert.ok(normal.every(thread => !thread.isScheduled), 'scheduled run leaked into default sidebar');
    assert.ok(inclusive.every(thread => !thread.isSyntheticTask), 'synthetic task prompt leaked into scheduled filter');
});
