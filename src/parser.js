const fs = require('fs');
const path = require('path');
const readline = require('readline');
let Database;
try { Database = require('better-sqlite3'); } catch(e) {}

const BRAIN_DIR = path.join(process.env.USERPROFILE || process.env.HOME, '.gemini', 'antigravity', 'brain');
const CONV_DIR = path.join(process.env.USERPROFILE || process.env.HOME, '.gemini', 'antigravity', 'conversations');
const DOCS_DIR = path.join(process.env.USERPROFILE || process.env.HOME, 'Documents');

/**
 * Reads the workspace folder path and source type for a conversation
 * by inspecting its .db file.
 */
function getConversationMeta(conversationId) {
    if (!Database) return { workspacePath: null, source: null };
    const dbPath = path.join(CONV_DIR, `${conversationId}.db`);
    if (!fs.existsSync(dbPath)) return { workspacePath: null, source: null };
    try {
        const db = new Database(dbPath, { readonly: true });
        const blobRow = db.prepare('SELECT data FROM trajectory_metadata_blob').get();
        const metaRow = db.prepare('SELECT source FROM trajectory_meta').get();
        db.close();
        let workspacePath = null;
        if (blobRow && blobRow.data) {
            const s = blobRow.data.toString();
            const match = s.match(/file:\/\/\/([^\x00-\x1f\r\n]+)/);
            if (match) workspacePath = decodeURIComponent(match[1].replace(/\/+$/, ''));
        }
        return { workspacePath, source: metaRow ? metaRow.source : null };
    } catch (e) {
        return { workspacePath: null, source: null };
    }
}

/**
 * Scans for local workspaces.
 * For this implementation, we look for folders in Documents that contain a .git or .agents folder.
 */
function getWorkspaces() {
    const workspaces = [];
    try {
        const projectsDir = path.join(process.env.USERPROFILE || process.env.HOME, '.gemini', 'config', 'projects');
        if (!fs.existsSync(projectsDir)) return workspaces;
        
        const files = fs.readdirSync(projectsDir).filter(f => f.endsWith('.json'));
        for (const file of files) {
            const content = fs.readFileSync(path.join(projectsDir, file), 'utf8');
            try {
                const data = JSON.parse(content);
                if (data.name && data.projectResources && data.projectResources.resources) {
                    const resource = data.projectResources.resources[0];
                    if (!resource) continue;
                    
                    const folderUri = resource.gitFolder?.folderUri || resource.folderUri;
                    
                    if (folderUri) {
                        let folderPath = folderUri.replace('file:///', '');
                        folderPath = decodeURIComponent(folderPath); // e.g. c:/Users/...
                        workspaces.push({
                            id: data.id || path.basename(file, '.json'),
                            name: data.name,
                            path: folderPath
                        });
                    }
                }
            } catch (e) {}
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
                let text = data.content || '';
                const match = text.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
                if (match) {
                    text = match[1];
                }
                text = text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
                if (text) {
                    title = text.substring(0, 50) + (text.length > 50 ? '...' : '');
                }
            }
        } catch (e) {
            // Ignore parse errors
        }
    }

    const { workspacePath, source } = getConversationMeta(conversationId);

    return {
        id: conversationId,
        title,
        workspacePath,
        source,
        lastUpdated: messages.length > 0 ? messages[messages.length - 1].created_at : null,
        messageCount: messages.length
    };
}

/**
 * Fetches recent threads by scanning the brain directory.
 */
async function getRecentThreads(limit = 100) {
    const threads = [];
    try {
        if (!fs.existsSync(BRAIN_DIR)) return threads;
        
        const convDirs = fs.readdirSync(BRAIN_DIR, { withFileTypes: true })
            .filter(d => d.isDirectory() && d.name.length === 36);
            
        for (const dir of convDirs) {
            const archivePath = path.join(BRAIN_DIR, dir.name, 'scratch', 'archive.json');
            let isArchived = false;
            if (fs.existsSync(archivePath)) {
                try {
                    const archiveData = JSON.parse(fs.readFileSync(archivePath, 'utf8'));
                    if (archiveData.in_trash || archiveData.archived) isArchived = true;
                } catch (e) {}
            }

            if (!isArchived) {
                const thread = await parseTranscript(dir.name);
                if (thread && thread.title !== 'Untitled Thread' && thread.source !== 19) {
                    threads.push(thread);
                }
            }
        }
        
        threads.sort((a, b) => new Date(b.lastUpdated || 0) - new Date(a.lastUpdated || 0));
    } catch (err) {}
    
    return threads.slice(0, limit);
}

async function getThreadMessages(conversationId) {
    const transcriptPath = path.join(BRAIN_DIR, conversationId, '.system_generated', 'logs', 'transcript.jsonl');
    if (!fs.existsSync(transcriptPath)) return [];

    const fileStream = fs.createReadStream(transcriptPath);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    const messages = [];
    for await (const line of rl) {
        try {
            const data = JSON.parse(line);
            if (data.type === 'USER_INPUT' || data.type === 'PLANNER_RESPONSE') {
                let text = data.content || '';
                if (data.type === 'USER_INPUT') {
                    const match = text.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
                    if (match) {
                        text = match[1].trim();
                    } else {
                        // fallback to strip tags if no match
                        text = text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
                    }
                }
                messages.push({
                    id: data.step_index,
                    role: data.type === 'USER_INPUT' ? 'user' : 'ai',
                    content: text,
                    created_at: data.created_at
                });
            }
        } catch (e) {}
    }
    return messages;
}

module.exports = {
    getWorkspaces,
    parseTranscript,
    getRecentThreads,
    getThreadMessages
};
