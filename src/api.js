const express = require('express');
const { getWorkspaces, getRecentThreads } = require('./parser');
const { getPinnedThreads, setPinnedThreads } = require('./pins');
const desktopBridge = require('./desktopBridge');

const router = express.Router();

// GET /api/workspaces
router.get('/workspaces', (req, res) => {
    const workspaces = getWorkspaces();
    res.json({ success: true, data: workspaces });
});

router.get('/pinned-threads', (req, res) => {
    res.json({ success: true, data: getPinnedThreads() });
});

router.put('/pinned-threads', (req, res) => {
    if (!Array.isArray(req.body?.threadIds)) {
        return res.status(400).json({ success: false, error: 'threadIds must be an array' });
    }
    res.json({ success: true, data: setPinnedThreads(req.body.threadIds) });
});

router.get('/desktop/status', async (req, res) => {
    const targets = await desktopBridge.listTargets();
    res.json({ success: true, connected: targets.length > 0, targets: targets.map(target => ({ title: target.title, url: target.url })) });
});

router.get('/desktop/sidebar-options', async (req, res) => {
    try { res.json({ success: true, data: await desktopBridge.getSidebarOptions() }); }
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
    const threads = await getRecentThreads(limit);
    res.json({ success: true, data: threads });
});

// GET /api/workspaces/:id/threads — threads scoped to a single workspace
router.get('/workspaces/:id/threads', async (req, res) => {
    const workspaces = getWorkspaces();
    const workspace = workspaces.find(w => w.id === req.params.id);
    if (!workspace) return res.json({ success: true, data: [] });
    const { getRecentThreads } = require('./parser');
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
    const { getThreadMessages } = require('./parser');
    const messages = await getThreadMessages(req.params.id);
    const threads = await getRecentThreads(500);
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
