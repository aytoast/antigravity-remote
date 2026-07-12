const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseTranscript } = require('./parser');

const HOME = process.env.USERPROFILE || os.homedir();
const ANTIGRAVITY_ROOT = path.join(HOME, '.gemini', 'antigravity');
const DOCUMENTS_ROOT = path.join(HOME, 'Documents');
const MAX_FILE_SIZE = 2 * 1024 * 1024;

const normalizeRequestedPath = requested => {
    let value = decodeURIComponent(String(requested || '')).trim();
    if (value.startsWith('file://')) {
        try { value = decodeURIComponent(new URL(value).pathname); } catch {}
    }
    if (/^\/[A-Za-z]:\//.test(value)) value = value.slice(1);
    return value.replace(/^file:\/\//, '');
};

const isWithin = (filePath, root) => {
    const relative = path.relative(path.resolve(root), path.resolve(filePath));
    return relative === '' || (relative && !relative.startsWith('..') && !path.isAbsolute(relative));
};

async function readConversationFile(conversationId, requestedPath) {
    const thread = await parseTranscript(conversationId);
    const requested = normalizeRequestedPath(requestedPath);
    if (!requested) throw new Error('File path is required');
    const workspaceRoot = thread?.workspacePath && path.resolve(thread.workspacePath);
    const brainRoot = path.join(ANTIGRAVITY_ROOT, 'brain', conversationId);
    const filePath = path.isAbsolute(requested)
        ? path.resolve(requested)
        : path.resolve(workspaceRoot || brainRoot, requested);
    const allowedRoots = [brainRoot, DOCUMENTS_ROOT];
    if (workspaceRoot) allowedRoots.push(workspaceRoot);
    if (!allowedRoots.some(root => isWithin(filePath, root))) throw new Error('File is outside allowed conversation locations');
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) throw new Error('Requested path is not a file');
    if (stat.size > MAX_FILE_SIZE) throw new Error('File is too large to display');
    return { path: filePath, content: await fs.promises.readFile(filePath, 'utf8') };
}

module.exports = { readConversationFile };
