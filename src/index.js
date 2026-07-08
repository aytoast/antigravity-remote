require('dotenv').config();
const express = require('express');
const httpProxy = require('http-proxy');
const WebSocket = require('ws');
const http = require('http');

const ANTIGRAVITY_PORT = process.env.ANTIGRAVITY_PORT || 3000;
const PROXY_PORT = process.env.PROXY_PORT || 8080;
const RELAY_WS_URL = process.env.RELAY_WS_URL || 'wss://relay.antigravity.dev';

const app = express();
const server = http.createServer(app);

// API Middleware
const cors = require('cors');
app.use(cors());
app.use(express.json());

// API Routes
const apiRouter = require('./api');
app.use('/api', apiRouter);

// Initialize Proxy
const proxy = httpProxy.createProxyServer({
    target: `http://127.0.0.1:${ANTIGRAVITY_PORT}`,
    ws: true
});

// Relay Connection
let relaySocket = null;
function connectToRelay() {
    relaySocket = new WebSocket(RELAY_WS_URL);
    relaySocket.on('open', () => console.log('Connected to Cloud Relay'));
    relaySocket.on('error', (err) => console.error('Relay error:', err.message));
    relaySocket.on('close', () => {
        console.log('Relay disconnected. Reconnecting in 5s...');
        setTimeout(connectToRelay, 5000);
    });
}
connectToRelay();

// Route all HTTP traffic
app.all('/*', (req, res) => {
    proxy.web(req, res, (err) => {
        console.error('HTTP Proxy Error:', err.message);
        res.status(502).send('Bad Gateway');
    });
});

// Route and Duplicate WebSocket traffic
server.on('upgrade', (req, socket, head) => {
    // We can intercept the raw socket here, but http-proxy handles WS upgrading well.
    // To duplicate frames, we attach event listeners to the proxy's websocket events.
    proxy.ws(req, socket, head, (err) => {
        console.error('WS Proxy Error:', err.message);
    });
});

// Inspect WebSocket frames emitted from the engine to the desktop UI
proxy.on('proxySocket', (proxySocket) => {
    proxySocket.on('data', (data) => {
        // Here we duplicate the payload and push to the cloud relay
        // Ensuring it only forwards token streams or relevant events
        if (relaySocket && relaySocket.readyState === WebSocket.OPEN) {
            try {
                // Wrap in payload envelope to signify it's a proxy forward
                relaySocket.send(JSON.stringify({
                    type: 'stream_forward',
                    timestamp: Date.now(),
                    payload: data.toString('utf8')
                }));
            } catch (e) {
                // Ignore parsing errors for binary frames
            }
        }
    });
});

server.listen(PROXY_PORT, () => {
    console.log(`Antigravity Remote Proxy running on port ${PROXY_PORT}`);
    console.log(`Forwarding to Engine on port ${ANTIGRAVITY_PORT}`);
});
