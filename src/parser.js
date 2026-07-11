const fs = require('fs');
const path = require('path');
const readline = require('readline');
let Database;
try { Database = require('better-sqlite3'); } catch(e) {}

const BRAIN_DIR = path.join(process.env.USERPROFILE || process.env.HOME, '.gemini', 'antigravity', 'brain');
const CONV_DIR = path.join(process.env.USERPROFILE || process.env.HOME, '.gemini', 'antigravity', 'conversations');
const DOCS_DIR = path.join(process.env.USERPROFILE || process.env.HOME, 'Documents');
const SUMMARY_PROTO_PATH = path.join(process.env.USERPROFILE || process.env.HOME, '.gemini', 'antigravity', 'agyhub_summaries_proto.pb');
let canonicalTitles;

function getCanonicalTitles() {
    if (canonicalTitles) return canonicalTitles;
    canonicalTitles = new Map();
    if (!fs.existsSync(SUMMARY_PROTO_PATH)) return canonicalTitles;
    const text = fs.readFileSync(SUMMARY_PROTO_PATH).toString('latin1');
    const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
    for (const match of text.matchAll(uuidPattern)) {
        const window = text.slice(Math.max(0, match.index - 220), match.index);
        const titleMatches = [...window.matchAll(/([\x20-\x7e]{3,120})\x10/g)];
        const title = titleMatches.at(-1)?.[1]?.trim().replace(/^[^\p{L}\p{N}]+/u, '');
        if (title) canonicalTitles.set(match[0].toLowerCase(), title);
    }
    return canonicalTitles;
}

/**
 * Reads the workspace folder path and source type for a conversation
 * by inspecting its .db file.
 */
function getConversationMeta(conversationId) {
    if (!Database) return { workspacePath: null, source: null, trajectoryId: null };
    const dbPath = path.join(CONV_DIR, `${conversationId}.db`);
    if (!fs.existsSync(dbPath)) return { workspacePath: null, source: null };
    try {
        const db = new Database(dbPath, { readonly: true });
        const blobRow = db.prepare('SELECT data FROM trajectory_metadata_blob').get();
        const metaRow = db.prepare('SELECT source FROM trajectory_meta').get();
        const trajectoryId = db.prepare('SELECT trajectory_id FROM trajectory_meta').get()?.trajectory_id;
        db.close();
        let workspacePath = null;
        if (blobRow && blobRow.data) {
            const s = blobRow.data.toString();
            const match = s.match(/file:\/\/\/([^\x00-\x1f\r\n]+)/);
            if (match) workspacePath = decodeURIComponent(match[1].replace(/\/+$/, ''));
        }
        return { workspacePath, source: metaRow ? metaRow.source : null, trajectoryId };
    } catch (e) {
        return { workspacePath: null, source: null, trajectoryId: null };
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
    let firstUserRequest = '';

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
                if (!firstUserRequest) firstUserRequest = text;
                if (text) {
                    title = text.substring(0, 50) + (text.length > 50 ? '...' : '');
                }
            }
        } catch (e) {
            // Ignore parse errors
        }
    }

    const { workspacePath, source, trajectoryId } = getConversationMeta(conversationId);
    const canonicalTitle = trajectoryId ? getCanonicalTitles().get(trajectoryId.toLowerCase()) : null;
    const isScheduled = /^(?:\/schedule\b|(?:create|set up|schedule|run)\s+(?:a\s+)?(?:cron|scheduled task)\b)/i.test(firstUserRequest);

    return {
        id: conversationId,
        title: canonicalTitle || title,
        workspacePath,
        source,
        isScheduled,
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
                if (thread && thread.title !== 'Untitled Thread' && thread.source !== 19 && !thread.isScheduled) {
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
                if (text) {
                    messages.push({
                        id: data.step_index,
                        role: data.type === 'USER_INPUT' ? 'user' : 'ai',
                        content: text,
                        thinking: data.type === 'PLANNER_RESPONSE' ? data.thinking || '' : '',
                        created_at: data.created_at
                    });
                }
            } else if (['RUN_COMMAND', 'GENERIC', 'SYSTEM_MESSAGE'].includes(data.type)) {
                const event = parseTimelineEvent(data);
                if (event) messages.push(event);
            }
        } catch (e) {}
    }
    return messages;
}

function parseTimelineEvent(data) {
    const content = String(data.content || '').trim();
    const lines = content.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const taskDescription = lines.find(line => line.startsWith('Task Description:'))?.replace(/^Task Description:\s*/, '') || '';
    const timerMatch = taskDescription.match(/^Timer:\s*(\d+)s,\s*Prompt:\s*(.+)$/i);
    const taskMatch = lines.find(line => line.startsWith('Task:'))?.replace(/^Task:\s*/, '') || '';
    const systemContent = content.match(/content=([\s\S]*?)<\/SYSTEM_MESSAGE>/i)?.[1]?.trim() || '';

    if (data.type === 'RUN_COMMAND') {
        return {
            id: data.step_index,
            role: 'event',
            eventType: data.type,
            title: taskDescription ? `Ran ${taskDescription.replace(/\s+/g, ' ')}` : 'Ran command',
            detail: content,
            created_at: data.created_at
        };
    }

    if (timerMatch) {
        return {
            id: data.step_index,
            role: 'event',
            eventType: data.type,
            title: `Timed ${timerMatch[1]} seconds`,
            detail: timerMatch[2],
            created_at: data.created_at
        };
    }

    if (data.type === 'GENERIC') {
        return {
            id: data.step_index,
            role: 'event',
            eventType: data.type,
            title: taskMatch ? `Task ${taskMatch}` : 'Task update',
            detail: content,
            created_at: data.created_at
        };
    }

    if (systemContent) {
        const finished = systemContent.includes('finished with result');
        return {
            id: data.step_index,
            role: 'event',
            eventType: data.type,
            title: finished ? 'Command execution finished' : systemContent,
            detail: finished ? systemContent : '',
            created_at: data.created_at
        };
    }

    return null;
}

module.exports = {
    getWorkspaces,
    parseTranscript,
    getRecentThreads,
    getThreadMessages
};
