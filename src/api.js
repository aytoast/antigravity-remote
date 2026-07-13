const express = require('express');
const { getWorkspaces, getRecentThreads, getThreadMessages, getPinnedThreadIds } = require('./parser');
const desktopBridge = require('./desktopBridge');
const codexBridge = require('./codexBridge');
const { getSkills } = require('./skills');
const { readConversationFile } = require('./files');

const router = express.Router();

const normalizeWorkspacePath = value => String(value || '').replace(/^file:\/\//i, '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const workspaceName = value => String(value || '').replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'No Project';

router.get('/conversations', async (req, res) => {
    try {
        const [visible, local, codexThreads] = await Promise.all([
            desktopBridge.listSidebarThreads().catch(() => []),
            getRecentThreads(500, { includeScheduled: true }),
            codexBridge.listThreads({ limit: 500 }).catch(() => [])
        ]);
        const localById = new Map(local.map(thread => [thread.id, thread]));
        const antigravityThreads = visible.map(item => ({
            ...(localById.get(item.id) || { id: item.id, workspacePath: null, lastUpdated: null, isScheduled: false }),
            title: item.title || localById.get(item.id)?.title || 'Untitled Thread',
            provider: 'antigravity',
            desktopOrder: item.order
        }));
        const workspaces = new Map();
        const addWorkspace = (path, name, provider) => {
            const key = normalizeWorkspacePath(path) || `unassigned:${provider}`;
            if (!workspaces.has(key)) workspaces.set(key, { id: `workspace-${Buffer.from(key).toString('base64url')}`, name: name || workspaceName(path), path: path || null, providers: [] });
            const workspace = workspaces.get(key);
            if (!workspace.providers.includes(provider)) workspace.providers.push(provider);
        };
        for (const thread of antigravityThreads) if (thread.workspacePath) addWorkspace(thread.workspacePath, workspaceName(thread.workspacePath), 'antigravity');
        for (const thread of codexThreads) if (thread.workspacePath) addWorkspace(thread.workspacePath, workspaceName(thread.workspacePath), 'codex');
        res.json({ success: true, data: {
            workspaces: [...workspaces.values()].sort((a, b) => a.name.localeCompare(b.name)),
            threads: [...antigravityThreads, ...codexThreads]
        } });
    } catch (error) { res.status(503).json({ success: false, error: error.message }); }
});

// GET /api/workspaces
router.get('/workspaces', (req, res) => {
    const workspaces = getWorkspaces();
    res.json({ success: true, data: workspaces });
});

router.get('/desktop/sidebar-projects', async (req, res) => {
    try {
        const [visible, local] = await Promise.all([desktopBridge.listSidebarProjects(), getWorkspaces()]);
        const byName = new Map(local.map(workspace => [workspace.name.toLowerCase(), workspace]));
        const projects = visible.map((project, index) => {
            const metadata = byName.get(project.name.toLowerCase());
            return metadata ? { ...metadata, expanded: project.expanded, desktopOrder: index } : {
                id: `desktop-${project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
                name: project.name,
                path: null,
                expanded: project.expanded,
                desktopOrder: index
            };
        });
        res.json({ success: true, data: projects });
    } catch (error) { res.status(503).json({ success: false, error: error.message }); }
});

router.put('/desktop/sidebar-projects/:name', async (req, res) => {
    if (typeof req.body?.expanded !== 'boolean') return res.status(400).json({ success: false, error: 'expanded is required' });
    try {
        const data = await desktopBridge.setSidebarProjectExpanded(req.params.name, req.body.expanded);
        res.json({ success: true, data });
    } catch (error) { res.status(503).json({ success: false, error: error.message }); }
});

router.get('/skills', (req, res) => {
    res.json({ success: true, data: getSkills() });
});

router.get('/codex/threads', async (req, res) => {
    try { res.json({ success: true, data: await codexBridge.listThreads({ cwd: req.query.cwd, searchTerm: req.query.search }) }); }
    catch (error) { res.status(503).json({ success: false, error: error.message }); }
});

router.get('/codex/threads/:id', async (req, res) => {
    try { res.json({ success: true, data: await codexBridge.readThread(req.params.id) }); }
    catch (error) { res.status(503).json({ success: false, error: error.message }); }
});

router.post('/codex/threads', async (req, res) => {
    try { res.json({ success: true, data: await codexBridge.startThread(req.body || {}) }); }
    catch (error) { res.status(503).json({ success: false, error: error.message }); }
});

router.post('/codex/threads/:id/prompt', async (req, res) => {
    if (typeof req.body?.prompt !== 'string' || !req.body.prompt.trim()) return res.status(400).json({ success: false, error: 'prompt is required' });
    try { res.json({ success: true, data: await codexBridge.sendPrompt(req.params.id, { ...req.body, prompt: req.body.prompt.trim() }) }); }
    catch (error) { res.status(503).json({ success: false, error: error.message }); }
});

router.delete('/codex/threads/:id', async (req, res) => {
    try { await codexBridge.archiveThread(req.params.id); res.json({ success: true }); }
    catch (error) { res.status(503).json({ success: false, error: error.message }); }
});

router.get('/codex/models', async (req, res) => {
    try { res.json({ success: true, data: await codexBridge.listModels() }); }
    catch (error) { res.status(503).json({ success: false, error: error.message }); }
});

router.get('/threads/:id/file', async (req, res) => {
    try { res.json({ success: true, data: await readConversationFile(req.params.id, req.query.path) }); }
    catch (error) { res.status(404).json({ success: false, error: error.message }); }
});

router.get('/pinned-threads', (req, res) => {
    res.json({ success: true, data: getPinnedThreadIds() });
});

router.put('/pinned-threads/:id', async (req, res) => {
    if (typeof req.body?.pinned !== 'boolean') return res.status(400).json({ success: false, error: 'pinned is required' });
    const current = getPinnedThreadIds().includes(req.params.id);
    if (current === req.body.pinned) return res.json({ success: true, data: getPinnedThreadIds() });
    try {
        await desktopBridge.setThreadPinned(req.params.id);
        for (let attempt = 0; attempt < 20; attempt += 1) {
            await new Promise(resolve => setTimeout(resolve, 50));
            const pinned = getPinnedThreadIds();
            if (pinned.includes(req.params.id) === req.body.pinned) return res.json({ success: true, data: pinned });
        }
        throw new Error('Desktop pin state did not update');
    } catch (error) {
        res.status(503).json({ success: false, error: error.message });
    }
});

router.delete('/desktop/conversations/:id', async (req, res) => {
    try { res.json({ success: true, data: await desktopBridge.archiveConversation(req.params.id) }); }
    catch (error) { res.status(503).json({ success: false, error: error.message }); }
});

router.get('/desktop/status', async (req, res) => {
    const targets = await desktopBridge.listTargets();
    res.json({ success: true, connected: targets.length > 0, targets: targets.map(target => ({ title: target.title, url: target.url })) });
});

router.get('/desktop/sidebar-options', async (req, res) => {
    try { res.json({ success: true, data: await desktopBridge.getSidebarOptions() }); }
    catch (error) { res.status(503).json({ success: false, error: error.message }); }
});

router.get('/desktop/sidebar-threads', async (req, res) => {
    try {
        const visible = await desktopBridge.listSidebarThreads();
        const localThreads = await getRecentThreads(500, { includeScheduled: true });
        const byId = new Map(localThreads.map(thread => [thread.id, thread]));
        const query = String(req.query.search || '').trim().toLowerCase();
        const results = [];
        for (const item of visible) {
            const thread = byId.get(item.id) || { id: item.id, workspacePath: null, source: null, isScheduled: false, isSyntheticTask: false, isArchived: false, isPinned: false, lastUpdated: null, messageCount: 0 };
            if (query) {
                const metadata = `${item.title} ${thread.workspacePath || ''}`.toLowerCase();
                let matches = metadata.includes(query);
                if (!matches) {
                    const messages = await getThreadMessages(item.id);
                    matches = messages.some(message => `${message.content || ''} ${message.thinking || ''} ${message.detail || ''} ${message.title || ''}`.toLowerCase().includes(query));
                }
                if (!matches) continue;
            }
            results.push({
            ...thread,
            title: item.title || byId.get(item.id)?.title || 'Untitled Thread',
            desktopOrder: item.order
            });
        }
        res.json({ success: true, data: results });
    } catch (error) { res.status(503).json({ success: false, error: error.message }); }
});

router.post('/desktop/new/open', async (req, res) => {
    try { res.json({ success: true, data: await desktopBridge.openNewConversation() }); }
    catch (error) { res.status(503).json({ success: false, error: error.message }); }
});

router.put('/desktop/new/project', async (req, res) => {
    if (typeof req.body?.project !== 'string' || !req.body.project.trim()) return res.status(400).json({ success: false, error: 'project is required' });
    try { res.json({ success: true, data: await desktopBridge.selectNewConversationProject(req.body.project.trim()) }); }
    catch (error) { res.status(503).json({ success: false, error: error.message }); }
});

router.post('/desktop/:id/open', async (req, res) => {
    try { res.json({ success: true, data: await desktopBridge.openConversation(req.params.id) }); }
    catch (error) { res.status(503).json({ success: false, error: error.message }); }
});

router.put('/desktop/sidebar-options', async (req, res) => {
    if (typeof req.body?.option !== 'string') return res.status(400).json({ success: false, error: 'option is required' });
    try { res.json({ success: true, data: await desktopBridge.setSidebarOption(req.body.option) }); }
    catch (error) { res.status(503).json({ success: false, error: error.message }); }
});

router.post('/desktop/scheduled-tasks/open', async (req, res) => {
    try { res.json({ success: true, data: await desktopBridge.openScheduledTasks() }); }
    catch (error) { res.status(503).json({ success: false, error: error.message }); }
});

router.get('/desktop/scheduled-tasks', async (req, res) => {
    try { res.json({ success: true, data: await desktopBridge.listScheduledTasks() }); }
    catch (error) { res.status(503).json({ success: false, error: error.message }); }
});

router.get('/desktop/scheduled-tasks/:name', async (req, res) => {
    try { res.json({ success: true, data: await desktopBridge.getScheduledTaskDetail(req.params.name) }); }
    catch (error) { res.status(503).json({ success: false, error: error.message }); }
});

router.put('/desktop/scheduled-tasks/:name', async (req, res) => {
    if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ success: false, error: 'enabled is required' });
    try { res.json({ success: true, data: await desktopBridge.setScheduledTaskEnabled(req.params.name, req.body.enabled) }); }
    catch (error) { res.status(503).json({ success: false, error: error.message }); }
});

router.get('/desktop/:id/models', async (req, res) => {
    try { res.json({ success: true, data: await desktopBridge.listModels(req.params.id) }); }
    catch (error) { res.status(503).json({ success: false, error: error.message }); }
});

router.put('/desktop/:id/model', async (req, res) => {
    if (typeof req.body?.model !== 'string' || !req.body.model.trim()) return res.status(400).json({ success: false, error: 'model is required' });
    try { res.json({ success: true, data: await desktopBridge.selectModel(req.params.id, req.body.model.trim()) }); }
    catch (error) { res.status(503).json({ success: false, error: error.message }); }
});

router.post('/desktop/:id/prompt', async (req, res) => {
    if (typeof req.body?.prompt !== 'string' || !req.body.prompt.trim()) return res.status(400).json({ success: false, error: 'prompt is required' });
    try { res.json({ success: true, data: await desktopBridge.sendPrompt(req.params.id, req.body.prompt) }); }
    catch (error) { res.status(503).json({ success: false, error: error.message }); }
});

// GET /api/threads/recent
router.get('/threads/recent', async (req, res) => {
    const limit = parseInt(req.query.limit) || 100;
    const threads = await getRecentThreads(limit, { includeScheduled: req.query.includeScheduled === 'true' });
    res.json({ success: true, data: threads });
});

// GET /api/workspaces/:id/threads — threads scoped to a single workspace
router.get('/workspaces/:id/threads', async (req, res) => {
    const workspaces = getWorkspaces();
    const workspace = workspaces.find(w => w.id === req.params.id);
    if (!workspace) return res.json({ success: true, data: [] });
    const all = await getRecentThreads(500);
    const wPath = workspace.path.toLowerCase().replace(/\\/g, '/');
    const scoped = all.filter(t => {
        if (!t.workspacePath) return false;
        const tp = t.workspacePath.toLowerCase().replace(/\\/g, '/');
        return tp === wPath || tp.startsWith(wPath + '/');
    });
    res.json({ success: true, data: scoped });
});

// GET /api/threads/:id
router.get('/threads/:id', async (req, res) => {
    const messages = await getThreadMessages(req.params.id);
    const threads = await getRecentThreads(500, { includeScheduled: true });
    const thread = threads.find(item => item.id === req.params.id) || null;
    res.json({ success: true, data: messages, thread });
});

// GET /api/pairing/qr
router.get('/pairing/qr', (req, res) => {
    // In a real implementation, this generates a secure JWT or token
    // and returns the QR code string for the mobile client to scan.
    const pairingData = {
        token: 'mock-secure-pairing-token-1234',
        relayEndpoint: process.env.RELAY_WS_URL || 'wss://relay.antigravity.dev',
        host: require('os').hostname()
    };
    res.json({ success: true, data: pairingData });
});

module.exports = router;
