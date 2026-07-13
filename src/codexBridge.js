const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const path = require('path');

const command = process.env.CODEX_COMMAND || (process.platform === 'win32'
    ? path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
    : 'codex');
let child;
let nextId = 1;
let buffer = '';
let started;
const pending = new Map();
const events = new EventEmitter();

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
        const executable = process.platform === 'win32' && !process.env.CODEX_COMMAND ? process.execPath : command;
        const args = process.platform === 'win32' && !process.env.CODEX_COMMAND
            ? [command, 'app-server', '--listen', 'stdio://']
            : ['app-server', '--listen', 'stdio://'];
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

function normalizeThread(thread) {
    return {
        id: thread.id,
        provider: 'codex',
        title: thread.name || thread.preview || 'Untitled Thread',
        workspacePath: thread.cwd || null,
        lastUpdated: thread.updatedAt ? new Date(thread.updatedAt * 1000).toISOString() : null,
        status: thread.status?.type || 'notLoaded',
        model: thread.model || null,
        messageCount: thread.turns?.length || 0
    };
}

async function listThreads({ limit = 500, cwd, searchTerm } = {}) {
    const result = await request('thread/list', { limit, sortKey: 'updated_at', cwd, searchTerm });
    return (result.data || []).map(normalizeThread);
}

async function readThread(id) {
    const result = await request('thread/read', { threadId: id, includeTurns: true });
    const thread = result.thread;
    const messages = (thread.turns || []).flatMap(turn => (turn.items || []).flatMap(item => {
        if (item.type === 'userMessage') return [{ id: item.id, role: 'user', content: item.content || '', created_at: item.createdAt }];
        if (item.type === 'agentMessage') return [{ id: item.id, role: 'ai', content: item.text || item.content || '', created_at: item.createdAt }];
        if (item.type === 'commandExecution') return [{ id: item.id, role: 'event', title: item.command || 'Ran command', detail: item.aggregatedOutput || '', created_at: item.createdAt }];
        return [];
    }));
    return { thread: normalizeThread(thread), messages };
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

module.exports = { archiveThread, events, listModels, listThreads, readThread, sendPrompt, startThread };
