const fs = require('fs');
const path = require('path');
const readline = require('readline');

const BRAIN_DIR = path.join(process.env.USERPROFILE || process.env.HOME, '.gemini', 'antigravity', 'brain');
const DOCS_DIR = path.join(process.env.USERPROFILE || process.env.HOME, 'Documents');

/**
 * Scans for local workspaces.
 * For this implementation, we look for folders in Documents that contain a .git or .agents folder.
 */
function getWorkspaces() {
    const workspaces = [];
    try {
        const dirs = fs.readdirSync(DOCS_DIR, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory());
            
        for (const dir of dirs) {
            const fullPath = path.join(DOCS_DIR, dir.name);
            const hasGit = fs.existsSync(path.join(fullPath, '.git'));
            const hasAgents = fs.existsSync(path.join(fullPath, '.agents'));
            if (hasGit || hasAgents) {
                workspaces.push({
                    id: dir.name,
                    name: dir.name,
                    path: fullPath
                });
            }
        }
    } catch (err) {
        console.error('Error scanning workspaces:', err.message);
    }
    return workspaces;
}

/**
 * Parses the transcript.jsonl for a given conversation ID and returns the thread summary.
 */
async function parseTranscript(conversationId) {
    const transcriptPath = path.join(BRAIN_DIR, conversationId, '.system_generated', 'logs', 'transcript.jsonl');
    if (!fs.existsSync(transcriptPath)) return null;

    const fileStream = fs.createReadStream(transcriptPath);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    const messages = [];
    let title = 'Untitled Thread';

    for await (const line of rl) {
        try {
            const data = JSON.parse(line);
            messages.push(data);
            if (data.type === 'USER_INPUT' && title === 'Untitled Thread') {
                // Use the first user input as the thread title
                title = data.content.substring(0, 50) + (data.content.length > 50 ? '...' : '');
            }
        } catch (e) {
            // Ignore parse errors
        }
    }

    return {
        id: conversationId,
        title,
        lastUpdated: messages.length > 0 ? messages[messages.length - 1].created_at : null,
        messageCount: messages.length
    };
}

/**
 * Fetches recent threads by scanning the brain directory.
 */
async function getRecentThreads(limit = 10) {
    const threads = [];
    try {
        if (!fs.existsSync(BRAIN_DIR)) return threads;
        
        const convDirs = fs.readdirSync(BRAIN_DIR, { withFileTypes: true })
            .filter(d => d.isDirectory() && d.name.length === 36); // UUID length
            
        for (const dir of convDirs) {
            const thread = await parseTranscript(dir.name);
            if (thread) {
                threads.push(thread);
            }
        }
        
        threads.sort((a, b) => new Date(b.lastUpdated || 0) - new Date(a.lastUpdated || 0));
    } catch (err) {
        console.error('Error reading recent threads:', err.message);
    }
    
    return threads.slice(0, limit);
}

module.exports = {
    getWorkspaces,
    parseTranscript,
    getRecentThreads
};
