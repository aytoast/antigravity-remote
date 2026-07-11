const fs = require('fs');
const path = require('path');
const readline = require('readline');
let Database;
try { Database = require('better-sqlite3'); } catch(e) {}

const BRAIN_DIR = path.join(process.env.USERPROFILE || process.env.HOME, '.gemini', 'antigravity', 'brain');
const CONV_DIR = path.join(process.env.USERPROFILE || process.env.HOME, '.gemini', 'antigravity', 'conversations');
const DOCS_DIR = path.join(process.env.USERPROFILE || process.env.HOME, 'Documents');
const SUMMARY_PROTO_PATH = path.join(process.env.USERPROFILE || process.env.HOME, '.gemini', 'antigravity', 'agyhub_summaries_proto.pb');
let summaryCache = { mtimeMs: -1, data: new Map() };

function readVarint(buffer, offset) {
    let value = 0;
    let shift = 0;
    let cursor = offset;
    while (cursor < buffer.length) {
        const byte = buffer[cursor++];
        value += (byte & 0x7f) * (2 ** shift);
        if ((byte & 0x80) === 0) return [value, cursor];
        shift += 7;
    }
    throw new Error('Unexpected end of protobuf varint');
}

function readProtoFields(buffer) {
    const fields = [];
    let offset = 0;
    while (offset < buffer.length) {
        let tag;
        [tag, offset] = readVarint(buffer, offset);
        const field = tag >> 3;
        const wireType = tag & 7;
        let value;
        if (wireType === 0) {
            [value, offset] = readVarint(buffer, offset);
        } else if (wireType === 2) {
            let length;
            [length, offset] = readVarint(buffer, offset);
            value = buffer.subarray(offset, offset + length);
            offset += length;
        } else if (wireType === 1) {
            value = buffer.subarray(offset, offset + 8);
            offset += 8;
        } else if (wireType === 5) {
            value = buffer.subarray(offset, offset + 4);
            offset += 4;
        } else {
            throw new Error(`Unsupported protobuf wire type ${wireType}`);
        }
        fields.push({ field, wireType, value });
    }
    return fields;
}

function getSummaryMetadata() {
    if (!fs.existsSync(SUMMARY_PROTO_PATH)) return new Map();
    const mtimeMs = fs.statSync(SUMMARY_PROTO_PATH).mtimeMs;
    if (summaryCache.mtimeMs === mtimeMs) return summaryCache.data;

    const summaries = new Map();
    const rootFields = readProtoFields(fs.readFileSync(SUMMARY_PROTO_PATH));
    for (const entryField of rootFields.filter(item => item.field === 1 && item.wireType === 2)) {
        const entry = readProtoFields(entryField.value);
        const cascadeId = entry.find(item => item.field === 1)?.value?.toString();
        const summaryBuffer = entry.find(item => item.field === 2)?.value;
        if (!cascadeId || !summaryBuffer) continue;

        const summary = readProtoFields(summaryBuffer);
        const title = summary.find(item => item.field === 1)?.value?.toString().trim();
        const trajectoryId = summary.find(item => item.field === 4)?.value?.toString();
        const annotationsBuffer = summary.find(item => item.field === 15)?.value;
        const annotations = annotationsBuffer ? readProtoFields(annotationsBuffer) : [];
        const archived = annotations.find(item => item.field === 4)?.value === 1;
        const pinned = annotations.find(item => item.field === 12)?.value === 1;
        summaries.set(cascadeId, { title, trajectoryId, archived, pinned });
    }

    summaryCache = { mtimeMs, data: summaries };
    return summaries;
}

function getPinnedThreadIds() {
    return [...getSummaryMetadata().entries()]
        .filter(([, metadata]) => metadata.pinned && !metadata.archived)
        .map(([cascadeId]) => cascadeId);
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

    const { workspacePath, source } = getConversationMeta(conversationId);
    const summary = getSummaryMetadata().get(conversationId);
    const isScheduled = /^(?:\/schedule\b|your task is\b|(?:create|set up|schedule|run)\s+(?:a\s+)?(?:cron|scheduled task)\b)/i.test(firstUserRequest);

    return {
        id: conversationId,
        title: summary?.title || title,
        workspacePath,
        source,
        isScheduled,
        isArchived: summary?.archived || false,
        isPinned: summary?.pinned || false,
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
                if (thread && thread.title !== 'Untitled Thread' && thread.source !== 19 && !thread.isScheduled && !thread.isArchived) {
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
    getThreadMessages,
    getPinnedThreadIds
};
