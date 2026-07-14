import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, CalendarClock, Clock3, Folder, Filter, Pin, Search, SquarePen } from 'lucide-react';
import { apiUrl } from '../api';
import { HomeSkeleton } from '../components/LoadingSkeleton';
import { ProviderBadge } from '../components/ProviderBadge';

// Format date relative (e.g. 1d, 4h)
const formatRelativeDate = (dateString) => {
  if (!dateString) return '';
  const diffMs = Date.now() - new Date(dateString).getTime();
  const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffHrs < 24) return `${diffHrs}h`;
  return `${Math.floor(diffHrs / 24)}d`;
};

const ThreadTime = ({ thread }) => <div className="thread-time">
  {thread.isScheduled && <Clock3 size={12} aria-label="Scheduled conversation" />}
  <span>{formatRelativeDate(thread.lastUpdated)}</span>
</div>;

export default function WorkspaceList() {
  const [workspaces, setWorkspaces] = useState([]);
  const [threads, setThreads] = useState([]);
  const [threadsLoading, setThreadsLoading] = useState(true);
  const [pinned, setPinned] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedWorkspaces, setExpandedWorkspaces] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [displayOptionsOpen, setDisplayOptionsOpen] = useState(false);
  const [displaySelection, setDisplaySelection] = useState(['Project', 'Last Updated', 'No Subtitle']);
  const [desktopNotice, setDesktopNotice] = useState('');
  const scheduledDesiredRef = useRef(null);
  const scheduledServerRef = useRef(null);
  const scheduledSyncRunningRef = useRef(false);
  const workspaceSyncRef = useRef(new Map());
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    let firstLoad = true;
    const refresh = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const [conversationResponse, pinResponse] = await Promise.all([
          fetch(apiUrl('/api/conversations')),
          fetch(apiUrl('/api/pinned-threads'))
        ]);
        const [conversationData, pinData] = await Promise.all([conversationResponse.json(), pinResponse.json()]);
        if (!active) return;
        if (conversationData.success) {
          setWorkspaces(conversationData.data.workspaces);
          setThreads(conversationData.data.threads);
          setExpandedWorkspaces(current => {
            if (firstLoad) return new Set(conversationData.data.workspaces.map(workspace => workspace.id));
            const available = new Set(conversationData.data.workspaces.map(workspace => workspace.id));
            return new Set([...current].filter(id => available.has(id)));
          });
        }
        if (pinData.success) setPinned(pinData.data);
      } catch (error) {
        if (firstLoad) console.error(error);
      } finally {
        if (active && firstLoad) {
          setLoading(false);
          setThreadsLoading(false);
        }
        firstLoad = false;
      }
    };
    const handleVisibilityChange = () => { if (document.visibilityState === 'visible') refresh(); };
    refresh();
    const interval = window.setInterval(refresh, 5000);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    fetch(apiUrl('/api/desktop/sidebar-options'))
      .then(res => res.json())
      .then(data => {
        if (!data.success) return;
        const selected = data.data.selected;
        const mobileSelection = selected.includes('Project')
          ? selected
          : ['Project', ...selected.filter(option => option !== 'None')];
        scheduledServerRef.current = selected.includes('Scheduled');
        if (scheduledDesiredRef.current === null) setDisplaySelection(mobileSelection);
      })
      .catch(() => {});
  }, []);

  // Match thread to workspace using the workspacePath field the backend provides
  const getWorkspaceForThread = (thread) => {
    if (thread.isProjectless || !thread.workspacePath) return null;
    const tp = thread.workspacePath.toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '');
    const ws = workspaces.find(w => {
      if (!w.path) return false;
      const wp = w.path.toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '');
      return tp === wp || tp.startsWith(wp + '/');
    });
    return ws ? ws.name : null;
  };

  const query = searchQuery.trim().toLowerCase();
  const activeThreads = threads.filter(thread =>
    (displaySelection.includes('Scheduled') || !thread.isScheduled)
    && (!query || `${thread.title} ${thread.workspacePath || ''} ${thread.provider || ''}`.toLowerCase().includes(query))
  );
  const isThreadPinned = thread => thread.isPinned || (thread.provider === 'antigravity' && pinned.includes(thread.id));
  const pinnedThreads = activeThreads.filter(isThreadPinned);
  
  // Group threads by workspace using actual workspacePath
  const projectsMap = {};
  workspaces.forEach(ws => projectsMap[ws.name] = []);
  const looseThreads = [];

  activeThreads.forEach(t => {
    if (isThreadPinned(t)) return;
    const wsName = getWorkspaceForThread(t);
    if (wsName && projectsMap[wsName] !== undefined) {
      projectsMap[wsName].push(t);
    } else if (t.isProjectless || !t.workspacePath) {
      looseThreads.push(t);
    }
  });

  const sortThreads = (a, b) => displaySelection.includes('Alphabetical (A-Z)')
    ? a.title.localeCompare(b.title)
    : new Date(b.lastUpdated) - new Date(a.lastUpdated);
  Object.values(projectsMap).forEach(projectThreads => projectThreads.sort(sortThreads));
  looseThreads.sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated));
  const orderedWorkspaces = [...workspaces].sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    if (!displaySelection.includes('Alphabetical (A-Z)') && Number.isFinite(a.desktopOrder) && Number.isFinite(b.desktopOrder)) return a.desktopOrder - b.desktopOrder;
    const aUpdated = projectsMap[a.name]?.[0]?.lastUpdated;
    const bUpdated = projectsMap[b.name]?.[0]?.lastUpdated;
    if (displaySelection.includes('Alphabetical (A-Z)')) return a.name.localeCompare(b.name);
    if (!aUpdated && !bUpdated) return a.name.localeCompare(b.name);
    if (!aUpdated) return 1;
    if (!bUpdated) return -1;
    return new Date(bUpdated) - new Date(aUpdated);
  });

  const handleThreadClick = (thread) => navigate(`/chat/${thread.provider || 'antigravity'}/${thread.id}`);

  const toggleWorkspace = async (e, workspaceId, workspaceName) => {
    e.stopPropagation();
    setExpandedWorkspaces(previous => {
      const next = new Set(previous);
      if (next.has(workspaceId)) next.delete(workspaceId);
      else next.add(workspaceId);
      return next;
    });
    const expanded = !expandedWorkspaces.has(workspaceId);
    const requestId = (workspaceSyncRef.current.get(workspaceId) || 0) + 1;
    workspaceSyncRef.current.set(workspaceId, requestId);
    try {
      if (!workspaces.find(workspace => workspace.id === workspaceId)?.providers?.includes('antigravity')) return;
      const response = await fetch(apiUrl(`/api/desktop/sidebar-projects/${encodeURIComponent(workspaceName)}`), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expanded })
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Desktop folder sync failed');
    } catch (error) {
      if (workspaceSyncRef.current.get(workspaceId) === requestId) {
        setExpandedWorkspaces(previous => {
          const next = new Set(previous);
          if (expanded) next.delete(workspaceId); else next.add(workspaceId);
          return next;
        });
        setDesktopNotice(error.message);
      }
    }
  };

  const toggleWorkspacePin = async (e, workspace) => {
    e.stopPropagation();
    if (!workspace.providers.includes('codex')) return;
    const previous = workspace.isPinned;
    const shouldPin = !previous;
    setWorkspaces(current => current.map(item => item.id === workspace.id ? { ...item, isPinned: shouldPin } : item));
    setDesktopNotice('');
    try {
      const response = await fetch(apiUrl('/api/codex/workspaces/pin'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: workspace.path, pinned: shouldPin })
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Codex project pin state did not update');
      setWorkspaces(current => current.map(item => item.id === workspace.id ? { ...item, isPinned: data.data.isPinned } : item));
    } catch (error) {
      setWorkspaces(current => current.map(item => item.id === workspace.id ? { ...item, isPinned: previous } : item));
      setDesktopNotice(error.message);
    }
  };

  const togglePin = async (e, thread) => {
    e.stopPropagation();
    const threadId = thread.id;
    if (thread.provider === 'codex') {
      const shouldPin = !thread.isPinned;
      setThreads(current => current.map(item => item.provider === 'codex' && item.id === threadId ? { ...item, isPinned: shouldPin } : item));
      try {
        const response = await fetch(apiUrl(`/api/codex/threads/${threadId}/pin`), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pinned: shouldPin })
        });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || 'Codex pin state did not update');
        setThreads(current => current.map(item => item.provider === 'codex' && item.id === threadId ? { ...item, isPinned: data.data.isPinned } : item));
      } catch (error) {
        setThreads(current => current.map(item => item.provider === 'codex' && item.id === threadId ? { ...item, isPinned: thread.isPinned } : item));
        setDesktopNotice(error.message);
      }
      return;
    }
    const previous = pinned;
    const shouldPin = !pinned.includes(threadId);
    const newPinned = pinned.includes(threadId)
      ? pinned.filter(id => id !== threadId)
      : [...pinned, threadId];
    setPinned(newPinned);
    try {
      const response = await fetch(apiUrl(`/api/pinned-threads/${threadId}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned: shouldPin })
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Desktop pin state did not update');
      setPinned(data.data);
    } catch (error) {
      setPinned(previous);
      setDesktopNotice(error.message);
    }
  };

  const archiveThread = async (e, thread) => {
    e.stopPropagation();
    try {
      const response = await fetch(apiUrl(thread.provider === 'codex' ? `/api/codex/threads/${thread.id}` : `/api/desktop/conversations/${thread.id}`), { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Desktop archive failed');
      setThreads(current => current.filter(item => item.id !== thread.id || item.provider !== thread.provider));
      if (thread.provider !== 'codex') setPinned(current => current.filter(id => id !== thread.id));
    } catch (error) {
      setDesktopNotice(error.message);
    }
  };

  const setDesktopDisplayOption = async (option) => {
    try {
      const response = await fetch(apiUrl('/api/desktop/sidebar-options'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ option })
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Desktop display option failed');
      setDisplaySelection(data.data.selected);
      setDisplayOptionsOpen(false);
      setDesktopNotice('Desktop display updated');
    } catch (error) {
      setDesktopNotice(error.message);
    }
  };

  const toggleScheduled = () => {
    const current = displaySelection.includes('Scheduled');
    const desired = !current;
    if (scheduledServerRef.current === null) scheduledServerRef.current = current;
    scheduledDesiredRef.current = desired;
    setDisplaySelection(previous => desired
      ? [...previous.filter(value => value !== 'Scheduled'), 'Scheduled']
      : previous.filter(value => value !== 'Scheduled'));
    setDesktopNotice('');

    if (scheduledSyncRunningRef.current) return;
    scheduledSyncRunningRef.current = true;
    (async () => {
      try {
        while (scheduledServerRef.current !== scheduledDesiredRef.current) {
          const response = await fetch(apiUrl('/api/desktop/sidebar-options'), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ option: 'Scheduled' })
          });
          const data = await response.json();
          if (!response.ok || !data.success) throw new Error(data.error || 'Desktop scheduled filter failed');
          scheduledServerRef.current = data.data.selected.includes('Scheduled');
        }
      } catch (error) {
        const serverState = scheduledServerRef.current;
        scheduledDesiredRef.current = serverState;
        setDisplaySelection(previous => serverState
          ? [...previous.filter(value => value !== 'Scheduled'), 'Scheduled']
          : previous.filter(value => value !== 'Scheduled'));
        setDesktopNotice(error.message);
      } finally {
        scheduledSyncRunningRef.current = false;
        if (scheduledServerRef.current !== scheduledDesiredRef.current) toggleScheduled();
      }
    })();
  };

  const flatDisplay = displaySelection.includes('None');
  const flatThreads = activeThreads.filter(thread => !isThreadPinned(thread)).sort(sortThreads);
  const pinnedWorkspaces = orderedWorkspaces.filter(workspace => workspace.isPinned);
  const projectWorkspaces = orderedWorkspaces.filter(workspace => !workspace.isPinned);

  return (
    <div className="workspace-list-page">
      <div className="container animate-fade-in" style={{ paddingTop: '20px' }}>
        {loading ? <HomeSkeleton /> : <>
        {/* Pinned Section */}
        {(pinnedThreads.length > 0 || (!flatDisplay && pinnedWorkspaces.length > 0)) && (
          <div className="section">
            <div className="section-header">Pinned</div>
            {pinnedThreads.map(t => (
              <div key={t.id} className="list-item thread-item" onClick={() => handleThreadClick(t)}>
                <div className="list-item-content">
                  <div className="list-item-title">{t.title}</div>
                  <div className="list-item-subtitle provider-subtitle"><ProviderBadge provider={t.provider || 'antigravity'} compact />{getWorkspaceForThread(t) || 'global'}</div>
                </div>
                <div className="list-item-right">
                  <ThreadTime thread={t} />
                  <button className="thread-action" type="button" title="Unpin conversation" aria-label="Unpin conversation" onClick={(e) => togglePin(e, t)} style={{ color: 'var(--text-primary)' }}>
                    <Pin size={14} fill="currentColor" />
                  </button>
                  <button className="thread-action" type="button" title="Archive conversation" aria-label="Archive conversation" onClick={(e) => archiveThread(e, t)}>
                    <Archive size={14} />
                  </button>
                </div>
              </div>
            ))}
          {!flatDisplay && pinnedWorkspaces.length > 0 && <>
            {pinnedWorkspaces.map((ws, index) => (
              <div key={ws.id} className="workspace-section-enter" style={{ marginBottom: '8px', '--stagger': `${index * 35}ms` }}>
                <div className="list-item project-item" onClick={(e) => toggleWorkspace(e, ws.id, ws.name)} role="button" tabIndex={0} aria-expanded={expandedWorkspaces.has(ws.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleWorkspace(e, ws.id, ws.name); }}>
                  <div className="list-item-icon"><Folder size={18} /></div>
                  <div className="list-item-content">{ws.name}<span className="workspace-providers">{ws.providers.map(provider => <ProviderBadge key={provider} provider={provider} compact />)}</span></div>
                  <button className="thread-action" type="button" title="Unpin project" aria-label="Unpin project" onClick={(e) => toggleWorkspacePin(e, ws)} style={{ color: 'var(--text-primary)' }}><Pin size={14} fill="currentColor" /></button>
                </div>
                <div className={`workspace-contents${expandedWorkspaces.has(ws.id) ? ' is-expanded' : ''}`}>
                  {threadsLoading ? <div className="inline-thread-skeleton" aria-busy="true" aria-label="Loading conversations"><span /><span /></div> : projectsMap[ws.name].length === 0 ? <div className="empty-text">No conversations yet</div> : projectsMap[ws.name].map((t, threadIndex) => (
                    <div key={`${t.provider}-${t.id}`} className="list-item nested-thread conversation-enter" style={{ '--stagger': `${threadIndex * 25}ms` }} onClick={() => handleThreadClick(t)}>
                      <div className="list-item-content"><div className="conversation-title-line"><ProviderBadge provider={t.provider || 'antigravity'} compact /><div className="list-item-title">{t.title}</div></div></div>
                      <div className="list-item-right"><ThreadTime thread={t} /><button className="thread-action" type="button" title={isThreadPinned(t) ? 'Unpin conversation' : 'Pin conversation'} aria-label={isThreadPinned(t) ? 'Unpin conversation' : 'Pin conversation'} onClick={(e) => togglePin(e, t)} style={{ color: isThreadPinned(t) ? 'var(--text-primary)' : 'var(--text-secondary)' }}><Pin size={14} fill={isThreadPinned(t) ? 'currentColor' : 'none'} /></button><button className="thread-action" type="button" title="Archive conversation" aria-label="Archive conversation" onClick={(e) => archiveThread(e, t)}><Archive size={14} /></button></div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </>}
          </div>
        )}

        {/* Projects Section */}
        <div className="section">
          <div className="section-header">
            <span>Projects</span>
            <div className="project-actions">
              <div className="display-options-control">
                <button className="sidebar-icon-button" type="button" onClick={() => setDisplayOptionsOpen(open => !open)} aria-label="Display options" aria-expanded={displayOptionsOpen}>
                  <Filter size={16} />
                </button>
                {displayOptionsOpen && <div className="display-options-menu">
                  <span>Group By</span>
                  <button type="button" className={displaySelection.includes('Project') ? 'is-selected' : ''} onClick={() => setDesktopDisplayOption('Project')}>Project</button>
                  <button type="button" className={displaySelection.includes('None') ? 'is-selected' : ''} onClick={() => setDesktopDisplayOption('None')}>None</button>
                  <span>Sort Conversations</span>
                  <button type="button" className={displaySelection.includes('Last Updated') ? 'is-selected' : ''} onClick={() => setDesktopDisplayOption('Last Updated')}>Last Updated</button>
                  <button type="button" className={displaySelection.includes('Alphabetical (A-Z)') ? 'is-selected' : ''} onClick={() => setDesktopDisplayOption('Alphabetical (A-Z)')}>Alphabetical (A-Z)</button>
                  <span>Filter</span>
                  <button type="button" className="display-toggle-row" role="switch" aria-checked={displaySelection.includes('Scheduled')} onClick={toggleScheduled}>
                    <span>Scheduled</span>
                    <span className={`display-toggle${displaySelection.includes('Scheduled') ? ' is-enabled' : ''}`} aria-hidden="true"><span /></span>
                  </button>
                </div>}
              </div>
            </div>
          </div>
          {desktopNotice && <div className="desktop-notice" role="status">{desktopNotice}</div>}
          {!flatDisplay && projectWorkspaces.map((ws, index) => (
            <div key={ws.id} className="workspace-section-enter" style={{ marginBottom: '8px', '--stagger': `${index * 35}ms` }}>
              <div className="list-item project-item" onClick={(e) => toggleWorkspace(e, ws.id, ws.name)} role="button" tabIndex={0} aria-expanded={expandedWorkspaces.has(ws.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleWorkspace(e, ws.id, ws.name); }}>
                <div className="list-item-icon">
                  <Folder size={18} />
                </div>
                <div className="list-item-content">{ws.name}<span className="workspace-providers">{ws.providers.map(provider => <ProviderBadge key={provider} provider={provider} compact />)}</span></div>
                {ws.providers.includes('codex') && <button className="thread-action" type="button" title={ws.isPinned ? 'Unpin project' : 'Pin project'} aria-label={ws.isPinned ? 'Unpin project' : 'Pin project'} onClick={(e) => toggleWorkspacePin(e, ws)} style={{ color: ws.isPinned ? 'var(--text-primary)' : 'var(--text-secondary)' }}><Pin size={14} fill={ws.isPinned ? 'currentColor' : 'none'} /></button>}
              </div>
              <div className={`workspace-contents${expandedWorkspaces.has(ws.id) ? ' is-expanded' : ''}`}>
                {threadsLoading ? (
                  <div className="inline-thread-skeleton" aria-busy="true" aria-label="Loading conversations"><span /><span /></div>
                ) : projectsMap[ws.name].length === 0 ? (
                  <div className="empty-text">No conversations yet</div>
                ) : (
                  projectsMap[ws.name].map((t, index) => (
                      <div key={`${t.provider}-${t.id}`} className="list-item nested-thread conversation-enter" style={{ '--stagger': `${index * 25}ms` }} onClick={() => handleThreadClick(t)}>
                      <div className="list-item-content">
                        <div className="conversation-title-line"><ProviderBadge provider={t.provider || 'antigravity'} compact /><div className="list-item-title">{t.title}</div></div>
                      </div>
                      <div className="list-item-right">
                        <ThreadTime thread={t} />
                        <button className="thread-action" type="button" title={isThreadPinned(t) ? 'Unpin conversation' : 'Pin conversation'} aria-label={isThreadPinned(t) ? 'Unpin conversation' : 'Pin conversation'} onClick={(e) => togglePin(e, t)} style={{ color: isThreadPinned(t) ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                          <Pin size={14} fill={isThreadPinned(t) ? 'currentColor' : 'none'} />
                        </button>
                        <button className="thread-action" type="button" title="Archive conversation" aria-label="Archive conversation" onClick={(e) => archiveThread(e, t)}>
                          <Archive size={14} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
          {flatDisplay && flatThreads.map((t, index) => (
            <div key={`${t.provider}-${t.id}`} className="list-item thread-item conversation-enter" style={{ '--stagger': `${index * 25}ms` }} onClick={() => handleThreadClick(t)}>
              <div className="list-item-content"><div className="conversation-title-line"><ProviderBadge provider={t.provider || 'antigravity'} compact /><div className="list-item-title">{t.title}</div></div></div>
              <div className="list-item-right"><ThreadTime thread={t} /><button className="thread-action" type="button" title={isThreadPinned(t) ? 'Unpin conversation' : 'Pin conversation'} aria-label={isThreadPinned(t) ? 'Unpin conversation' : 'Pin conversation'} onClick={(e) => togglePin(e, t)}><Pin size={14} fill={isThreadPinned(t) ? 'currentColor' : 'none'} /></button></div>
            </div>
          ))}
        </div>

        {/* Recent unassigned conversations */}
        {!flatDisplay && <div className="section">
          <div className="section-header">Conversations</div>
          <div className="conversation-list">
            {threadsLoading ? <div className="inline-thread-skeleton" aria-busy="true" aria-label="Loading conversations"><span /><span /></div> : looseThreads.length === 0 ? <div className="empty-text">No conversations yet</div> : looseThreads.map((t, index) => (
              <div key={`${t.provider}-${t.id}`} className="list-item thread-item conversation-enter" style={{ '--stagger': `${index * 25}ms` }} onClick={() => handleThreadClick(t)}>
                <div className="list-item-content"><div className="conversation-title-line"><ProviderBadge provider={t.provider || 'antigravity'} compact /><div className="list-item-title">{t.title}</div></div></div>
                <div className="list-item-right">
                  <ThreadTime thread={t} />
                  <button className="thread-action" type="button" title={isThreadPinned(t) ? 'Unpin conversation' : 'Pin conversation'} aria-label={isThreadPinned(t) ? 'Unpin conversation' : 'Pin conversation'} onClick={(e) => togglePin(e, t)} style={{ color: isThreadPinned(t) ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                    <Pin size={14} fill={isThreadPinned(t) ? 'currentColor' : 'none'} />
                  </button>
                  <button className="thread-action" type="button" title="Archive conversation" aria-label="Archive conversation" onClick={(e) => archiveThread(e, t)}>
                    <Archive size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>}

        </>}
      </div>
      <div className="workspace-floating-actions">
        <label className="workspace-search">
          <Search size={21} aria-hidden="true" />
          <input value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="Search conversations" aria-label="Search conversations" />
        </label>
        <button className="workspace-scheduled-tasks" type="button" onClick={() => navigate('/tasks')} aria-label="Open scheduled tasks" title="Scheduled Tasks">
          <CalendarClock size={20} aria-hidden="true" />
        </button>
        <button className="workspace-new-conversation" type="button" onClick={() => navigate('/chat/new')}>
          <SquarePen size={20} aria-hidden="true" />
          <span>New Conversation</span>
        </button>
      </div>
    </div>
  );
}
