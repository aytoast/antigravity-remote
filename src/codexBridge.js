const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

const command = process.env.CODEX_COMMAND || require.resolve('@openai/codex/bin/codex.js');
const codexHome = process.env.CODEX_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '', '.codex');
const desktopStatePath = path.join(codexHome, '.codex-global-state.json');
let child;
let nextId = 1;
let buffer = '';
let started;
const pending = new Map();
const events = new EventEmitter();
let desktopStateCache = { mtimeMs: -1, data: null };

function normalizeDesktopState(raw = {}) {
    const state = { ...(raw['electron-persisted-atom-state'] || {}), ...raw };
    const roots = state['electron-saved-workspace-roots'] || [];
    const projectOrder = state['project-order'] || [];
    const pinnedProjects = new Set(state['pinned-project-ids'] || []);
    const threadWorkspacePaths = new Map(Object.entries(state['thread-project-assignments'] || {}).map(([threadId, assignment]) => [
        threadId,
        assignment?.path || assignment?.cwd || assignment?.projectId
    ]).filter(([, workspacePath]) => workspacePath));
    return {
        projectlessThreadIds: new Set(state['projectless-thread-ids'] || []),
        pinnedThreadIds: new Set(state['pinned-thread-ids'] || []),
        threadWorkspacePaths,
        workspaces: roots.map((workspacePath, index) => {
            const orderedIndex = projectOrder.indexOf(workspacePath);
            return {
                id: `codex-workspace-${Buffer.from(workspacePath.toLowerCase()).toString('base64url')}`,
                name: path.basename(workspacePath),
                path: workspacePath,
                desktopOrder: orderedIndex >= 0 ? orderedIndex : projectOrder.length + index,
                isPinned: pinnedProjects.has(workspacePath)
            };
        })
    };
}

function getDesktopState() {
    try {
        const mtimeMs = fs.statSync(desktopStatePath).mtimeMs;
        if (desktopStateCache.data && desktopStateCache.mtimeMs === mtimeMs) return desktopStateCache.data;
        const data = normalizeDesktopState(JSON.parse(fs.readFileSync(desktopStatePath, 'utf8')));
        desktopStateCache = { mtimeMs, data };
        return data;
    } catch {
        return normalizeDesktopState();
    }
}

function updatePinnedThreadIds(raw, threadId, pinned) {
    const pinnedThreadIds = new Set(raw['pinned-thread-ids'] || []);
    if (pinned) pinnedThreadIds.add(threadId);
    else pinnedThreadIds.delete(threadId);
    return { ...raw, 'pinned-thread-ids': [...pinnedThreadIds] };
}

function setThreadPinned(threadId, pinned) {
    const raw = JSON.parse(fs.readFileSync(desktopStatePath, 'utf8'));
    const next = updatePinnedThreadIds(raw, threadId, pinned);
    const temporaryPath = `${desktopStatePath}.${process.pid}.${Date.now()}.tmp`;
    try {
        fs.writeFileSync(temporaryPath, JSON.stringify(next), 'utf8');
        fs.renameSync(temporaryPath, desktopStatePath);
    } finally {
        if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    }
    desktopStateCache = { mtimeMs: -1, data: null };
    return { id: threadId, isPinned: getDesktopState().pinnedThreadIds.has(threadId) };
}

function commandInvocation(value = command) {
    const useNode = value.endsWith('.js');
    return {
        executable: useNode ? process.execPath : value,
        args: useNode ? [value, 'app-server', '--listen', 'stdio://'] : ['app-server', '--listen', 'stdio://']
    };
}

function reset(error) {
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
    child = undefined;
    started = undefined;
}

function handleMessage(message) {
    if (message.id !== undefined && pending.has(message.id)) {
        const request = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) request.reject(new Error(message.error.message || 'Codex App Server request failed'));
        else request.resolve(message.result);
        return;
    }

    if (message.method && message.id !== undefined) {
        // Mobile UI cannot safely approve host commands yet. Reject requests rather
        // than leaving Codex turns blocked indefinitely.
        send({ id: message.id, result: { decision: 'decline' } });
        return;
    }

    if (message.method) events.emit('notification', message);
}

function send(message) {
    if (!child?.stdin?.writable) throw new Error('Codex App Server is unavailable');
    child.stdin.write(`${JSON.stringify(message)}\n`);
}

function call(method, params = {}) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        try { send({ id, method, params }); }
        catch (error) { pending.delete(id); reject(error); }
    });
}

async function start() {
    if (started) return started;

    started = new Promise((resolve, reject) => {
        const { executable, args } = commandInvocation();
        child = spawn(executable, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true
        });

        child.once('error', error => {
            reset(error);
            reject(new Error(`Codex App Server failed to start: ${error.message}`));
        });
        child.once('exit', (code, signal) => reset(new Error(`Codex App Server stopped (${signal || code || 'unknown'})`)));
        child.stdout.on('data', chunk => {
            buffer += chunk.toString('utf8');
            let newline;
            while ((newline = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, newline).trim();
                buffer = buffer.slice(newline + 1);
                if (!line) continue;
                try { handleMessage(JSON.parse(line)); } catch {}
            }
        });

        call('initialize', {
            clientInfo: { name: 'antigravity_remote', title: 'Antigravity Remote', version: '1.0.0' }
        }).then(() => {
            send({ method: 'initialized', params: {} });
            resolve();
        }).catch(error => {
            reset(error);
            reject(error);
        });
    });

    try { await started; }
    catch (error) { started = undefined; throw error; }
}

async function request(method, params) {
    await start();
    return call(method, params);
}

function normalizeThread(thread, desktopState = {}) {
    const assignedWorkspacePath = desktopState.threadWorkspacePaths?.get(thread.id);
    return {
        id: thread.id,
        provider: 'codex',
        title: thread.name || thread.preview || 'Untitled Thread',
        workspacePath: assignedWorkspacePath || thread.cwd || null,
        lastUpdated: thread.updatedAt ? new Date(thread.updatedAt * 1000).toISOString() : null,
        status: thread.status?.type || 'notLoaded',
        model: thread.model || null,
        messageCount: thread.turns?.length || 0,
        isProjectless: !assignedWorkspacePath && (desktopState.projectlessThreadIds?.has(thread.id) || false),
        isPinned: desktopState.pinnedThreadIds?.has(thread.id) || false
    };
}

function normalizeContent(content) {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return content == null ? '' : String(content);
    return content.map(part => {
        if (typeof part === 'string') return part;
        if (part?.type === 'localImage') return part.path ? `Attached image: ${part.path}` : 'Attached image';
        return part?.text || part?.content || '';
    }).filter(Boolean).join('\n');
}

function normalizeMessages(thread) {
    return (thread.turns || []).flatMap(turn => (turn.items || []).flatMap(item => {
        if (item.type === 'userMessage') return [{ id: item.id, role: 'user', content: normalizeContent(item.content), created_at: item.createdAt }];
        if (item.type === 'agentMessage') return [{ id: item.id, role: 'ai', content: normalizeContent(item.text || item.content), created_at: item.createdAt }];
        if (item.type === 'commandExecution') return [{ id: item.id, role: 'event', title: item.command || 'Ran command', detail: item.aggregatedOutput || '', created_at: item.createdAt }];
        return [];
    }));
}

async function listThreads({ limit = 500, cwd, searchTerm } = {}) {
    const result = await request('thread/list', { limit, sortKey: 'updated_at', cwd, searchTerm });
    const desktopState = getDesktopState();
    return (result.data || []).map(thread => normalizeThread(thread, desktopState));
}

function listWorkspaces() {
    return getDesktopState().workspaces;
}

async function readThread(id) {
    const result = await request('thread/read', { threadId: id, includeTurns: true });
    const thread = result.thread;
    const messages = normalizeMessages(thread);
    return { thread: normalizeThread(thread, getDesktopState()), messages };
}

async function listModels() {
    const result = await request('model/list', { limit: 100, includeHidden: false });
    return (result.data || []).map(model => ({ id: model.id || model.model, name: model.displayName || model.model || model.id, isDefault: model.isDefault }));
}

async function startThread({ cwd, model } = {}) {
    const result = await request('thread/start', { cwd: cwd || null, model: model || null, approvalPolicy: 'on-request' });
    return normalizeThread(result.thread);
}

async function sendPrompt(id, { prompt, cwd, model } = {}) {
    await request('thread/resume', { threadId: id, cwd: cwd || null, model: model || null, approvalPolicy: 'on-request' });
    return request('turn/start', {
        threadId: id,
        cwd: cwd || null,
        model: model || null,
        input: [{ type: 'text', text: prompt }]
    });
}

async function archiveThread(id) {
    await request('thread/archive', { threadId: id });
}

module.exports = { archiveThread, commandInvocation, events, listModels, listThreads, listWorkspaces, normalizeContent, normalizeDesktopState, normalizeMessages, normalizeThread, readThread, sendPrompt, setThreadPinned, startThread, updatePinnedThreadIds };
