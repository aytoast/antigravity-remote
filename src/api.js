const express = require('express');
const { getWorkspaces, getRecentThreads } = require('./parser');

const router = express.Router();

// GET /api/workspaces
router.get('/workspaces', (req, res) => {
    const workspaces = getWorkspaces();
    res.json({ success: true, data: workspaces });
});

// GET /api/threads/recent
router.get('/threads/recent', async (req, res) => {
    const limit = parseInt(req.query.limit) || 10;
    const threads = await getRecentThreads(limit);
    res.json({ success: true, data: threads });
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
