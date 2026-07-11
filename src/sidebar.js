const fs = require('fs');
const path = require('path');
const { getRecentThreads } = require('./parser');

const MANIFEST_PATH = path.join(__dirname, '..', 'config', 'sidebar-live.json');

function getSidebarManifest() {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

async function getSidebarThreads() {
    const manifest = getSidebarManifest();
    const threads = await getRecentThreads(500);
    const byId = new Map(threads.map(thread => [thread.id, thread]));
    return {
        workspaceOrder: manifest.workspaceOrder,
        threads: manifest.threadIds.map(id => byId.get(id)).filter(Boolean)
    };
}

module.exports = { getSidebarManifest, getSidebarThreads };
