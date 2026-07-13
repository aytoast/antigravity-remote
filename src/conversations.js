const normalizeWorkspacePath = value => String(value || '')
    .replace(/^file:\/\//i, '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();

const workspaceName = value => String(value || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .pop() || 'No Project';

function buildConversationIndex({ antigravityWorkspaces = [], visibleThreads = [], localThreads = [], codexThreads = [] }) {
    const localById = new Map(localThreads.map(thread => [thread.id, thread]));
    const antigravityThreads = visibleThreads.map(item => ({
        ...(localById.get(item.id) || { id: item.id, workspacePath: null, lastUpdated: null, isScheduled: false }),
        title: item.title || localById.get(item.id)?.title || 'Untitled Thread',
        provider: 'antigravity',
        desktopOrder: item.order
    }));
    const workspaces = new Map();

    const addWorkspace = (path, name, provider) => {
        const key = normalizeWorkspacePath(path);
        if (!key) return;
        if (!workspaces.has(key)) {
            workspaces.set(key, {
                id: `workspace-${Buffer.from(key).toString('base64url')}`,
                name: name || workspaceName(path),
                path,
                providers: []
            });
        }
        const workspace = workspaces.get(key);
        if (!workspace.providers.includes(provider)) workspace.providers.push(provider);
    };

    for (const workspace of antigravityWorkspaces) addWorkspace(workspace.path, workspace.name, 'antigravity');
    for (const thread of antigravityThreads) addWorkspace(thread.workspacePath, workspaceName(thread.workspacePath), 'antigravity');
    for (const thread of codexThreads) addWorkspace(thread.workspacePath, workspaceName(thread.workspacePath), 'codex');

    return {
        workspaces: [...workspaces.values()].sort((a, b) => a.name.localeCompare(b.name)),
        threads: [...antigravityThreads, ...codexThreads]
    };
}

function createConversationLoader(loadSources, ttlMs = 1500) {
    let cache = { expiresAt: 0, data: null };
    let inflight = null;

    return async function loadConversations() {
        if (cache.data && cache.expiresAt > Date.now()) return cache.data;
        if (inflight) return inflight;
        inflight = loadSources()
            .then(buildConversationIndex)
            .then(data => {
                cache = { data, expiresAt: Date.now() + ttlMs };
                return data;
            })
            .finally(() => { inflight = null; });
        return inflight;
    };
}

module.exports = { buildConversationIndex, createConversationLoader, normalizeWorkspacePath, workspaceName };
