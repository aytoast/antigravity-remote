const express = require('express');
const { getWorkspaces, getRecentThreads } = require('./parser');
const { getPinnedThreads, setPinnedThreads } = require('./pins');

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
