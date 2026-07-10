const fs = require('fs');
const path = require('path');

const PINS_PATH = path.join(process.env.USERPROFILE || process.env.HOME, '.gemini', 'antigravity', 'remote-pinned-threads.json');
const THREAD_ID = /^[0-9a-f-]{36}$/i;

function getPinnedThreads() {
    try {
        const data = JSON.parse(fs.readFileSync(PINS_PATH, 'utf8'));
        return Array.isArray(data) ? data.filter(id => THREAD_ID.test(id)) : [];
    } catch (e) {
        return [];
    }
}

function setPinnedThreads(threadIds) {
    const pinned = [...new Set(threadIds)].filter(id => THREAD_ID.test(id));
    fs.mkdirSync(path.dirname(PINS_PATH), { recursive: true });
    fs.writeFileSync(PINS_PATH, JSON.stringify(pinned, null, 2));
    return pinned;
}

module.exports = { getPinnedThreads, setPinnedThreads };
