import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, CalendarClock, Clock3, Folder, Filter, Pin, Search, SquarePen } from 'lucide-react';
import { apiUrl } from '../api';
import { HomeSkeleton } from '../components/LoadingSkeleton';

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
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([
      fetch(apiUrl('/api/workspaces')).then(res => res.json()),
      fetch(apiUrl('/api/pinned-threads')).then(res => res.json())
    ]).then(([wsData, pinData]) => {
      if (wsData.success) setWorkspaces(wsData.data);
      if (pinData.success) setPinned(pinData.data);
    }).catch(err => console.error(err)).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetch(apiUrl(`/api/desktop/sidebar-threads${searchQuery.trim() ? `?search=${encodeURIComponent(searchQuery.trim())}` : ''}`))
        .then(res => res.json())
        .then(data => { if (data.success) setThreads(data.data); })
        .catch(() => {});
    }, searchQuery.trim() ? 180 : 0);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    fetch(apiUrl('/api/desktop/sidebar-options'))
      .then(res => res.json())
      .then(data => {
        if (!data.success) return;
        const selected = data.data.selected;
        scheduledServerRef.current = selected.includes('Scheduled');
        if (scheduledDesiredRef.current === null) setDisplaySelection(selected);
      })
      .catch(() => {});
  }, []);

  // Match thread to workspace using the workspacePath field the backend provides
  const getWorkspaceForThread = (thread) => {
    if (!thread.workspacePath) return null;
    const tp = thread.workspacePath.toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '');
    const ws = workspaces.find(w => {
      const wp = w.path.toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '');
      return tp === wp || tp.startsWith(wp + '/');
    });
    return ws ? ws.name : null;
  };

  const activeThreads = threads.filter(thread => displaySelection.includes('Scheduled') || !thread.isScheduled);
  const pinnedThreads = activeThreads.filter(t => pinned.includes(t.id));
  
  // Group threads by workspace using actual workspacePath
  const projectsMap = {};
  workspaces.forEach(ws => projectsMap[ws.name] = []);
  const looseThreads = [];

  activeThreads.forEach(t => {
    const wsName = getWorkspaceForThread(t);
    if (wsName && projectsMap[wsName] !== undefined) {
      projectsMap[wsName].push(t);
    } else if (!t.workspacePath && !pinned.includes(t.id)) {
      looseThreads.push(t);
    }
  });

  const sortThreads = (a, b) => displaySelection.includes('Alphabetical (A-Z)')
    ? a.title.localeCompare(b.title)
    : new Date(b.lastUpdated) - new Date(a.lastUpdated);
  Object.values(projectsMap).forEach(projectThreads => projectThreads.sort(sortThreads));
  looseThreads.sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated));
  const orderedWorkspaces = [...workspaces].sort((a, b) => {
    const aUpdated = projectsMap[a.name]?.[0]?.lastUpdated;
    const bUpdated = projectsMap[b.name]?.[0]?.lastUpdated;
    if (displaySelection.includes('Alphabetical (A-Z)')) return a.name.localeCompare(b.name);
    if (!aUpdated && !bUpdated) return a.name.localeCompare(b.name);
    if (!aUpdated) return 1;
    if (!bUpdated) return -1;
    return new Date(bUpdated) - new Date(aUpdated);
  });

  const handleThreadClick = (id) => navigate(`/chat/${id}`);

  const toggleWorkspace = (e, workspaceId) => {
    e.stopPropagation();
    setExpandedWorkspaces(previous => {
      const next = new Set(previous);
      if (next.has(workspaceId)) next.delete(workspaceId);
      else next.add(workspaceId);
      return next;
    });
  };

  const togglePin = async (e, threadId) => {
    e.stopPropagation();
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

  const archiveThread = async (e, threadId) => {
    e.stopPropagation();
    try {
      const response = await fetch(apiUrl(`/api/desktop/conversations/${threadId}`), { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Desktop archive failed');
      setThreads(current => current.filter(thread => thread.id !== threadId));
      setPinned(current => current.filter(id => id !== threadId));
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
  const flatThreads = activeThreads.filter(thread => !pinned.includes(thread.id)).sort(sortThreads);

  return (
    <div className="workspace-list-page animate-fade-in">
      <div className="container" style={{ paddingTop: '20px' }}>
        {loading ? <HomeSkeleton /> : <>
        {/* Pinned Section */}
        {pinnedThreads.length > 0 && (
          <div className="section">
            <div className="section-header">Pinned Conversations</div>
            {pinnedThreads.map(t => (
              <div key={t.id} className="list-item thread-item" onClick={() => handleThreadClick(t.id)}>
                <div className="list-item-content">
                  <div className="list-item-title">{t.title}</div>
                  <div className="list-item-subtitle">{getWorkspaceForThread(t) || 'global'}</div>
                </div>
                <div className="list-item-right">
                  <ThreadTime thread={t} />
                  <button className="thread-action" type="button" title="Unpin conversation" aria-label="Unpin conversation" onClick={(e) => togglePin(e, t.id)} style={{ color: 'var(--text-primary)' }}>
                    <Pin size={14} fill="currentColor" />
                  </button>
                  <button className="thread-action" type="button" title="Archive conversation" aria-label="Archive conversation" onClick={(e) => archiveThread(e, t.id)}>
                    <Archive size={14} />
                  </button>
                </div>
              </div>
            ))}
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
              <button className="sidebar-icon-button" type="button" onClick={() => navigate('/tasks')} aria-label="Open scheduled tasks" title="Scheduled Tasks">
                <CalendarClock size={16} />
              </button>
            </div>
          </div>
          {desktopNotice && <div className="desktop-notice" role="status">{desktopNotice}</div>}
          {!flatDisplay && orderedWorkspaces.map(ws => (
            <div key={ws.id} style={{ marginBottom: '8px' }}>
              <div className="list-item project-item" onClick={(e) => toggleWorkspace(e, ws.id)} role="button" tabIndex={0} aria-expanded={expandedWorkspaces.has(ws.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleWorkspace(e, ws.id); }}>
                <div className="list-item-icon">
                  <Folder size={18} />
                </div>
                <div className="list-item-content">{ws.name}</div>
              </div>
              <div className={`workspace-contents${expandedWorkspaces.has(ws.id) ? ' is-expanded' : ''}`}>
                {projectsMap[ws.name].length === 0 ? (
                  <div className="empty-text">No conversations yet</div>
                ) : (
                  projectsMap[ws.name].map(t => (
                    <div key={t.id} className="list-item nested-thread" onClick={() => handleThreadClick(t.id)}>
                      <div className="list-item-content">
                        <div className="list-item-title">{t.title}</div>
                      </div>
                      <div className="list-item-right">
                        <ThreadTime thread={t} />
                        <button className="thread-action" type="button" title={pinned.includes(t.id) ? 'Unpin conversation' : 'Pin conversation'} aria-label={pinned.includes(t.id) ? 'Unpin conversation' : 'Pin conversation'} onClick={(e) => togglePin(e, t.id)} style={{ color: pinned.includes(t.id) ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                          <Pin size={14} fill={pinned.includes(t.id) ? 'currentColor' : 'none'} />
                        </button>
                        <button className="thread-action" type="button" title="Archive conversation" aria-label="Archive conversation" onClick={(e) => archiveThread(e, t.id)}>
                          <Archive size={14} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
          {flatDisplay && flatThreads.map(t => (
            <div key={t.id} className="list-item thread-item" onClick={() => handleThreadClick(t.id)}>
              <div className="list-item-content"><div className="list-item-title">{t.title}</div></div>
              <div className="list-item-right"><ThreadTime thread={t} /></div>
            </div>
          ))}
        </div>

        {/* Recent unassigned conversations */}
        {!flatDisplay && <div className="section">
          <div className="section-header">Conversations</div>
          <div className="conversation-list">
            {looseThreads.length === 0 ? <div className="empty-text">No conversations yet</div> : looseThreads.map(t => (
              <div key={t.id} className="list-item thread-item" onClick={() => handleThreadClick(t.id)}>
                <div className="list-item-content"><div className="list-item-title">{t.title}</div></div>
                <div className="list-item-right">
                  <ThreadTime thread={t} />
                  <button className="thread-action" type="button" title={pinned.includes(t.id) ? 'Unpin conversation' : 'Pin conversation'} aria-label={pinned.includes(t.id) ? 'Unpin conversation' : 'Pin conversation'} onClick={(e) => togglePin(e, t.id)} style={{ color: pinned.includes(t.id) ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                    <Pin size={14} fill={pinned.includes(t.id) ? 'currentColor' : 'none'} />
                  </button>
                  <button className="thread-action" type="button" title="Archive conversation" aria-label="Archive conversation" onClick={(e) => archiveThread(e, t.id)}>
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
        <button className="workspace-new-conversation" type="button" onClick={() => navigate('/chat/new')}>
          <SquarePen size={20} aria-hidden="true" />
          <span>New Conversation</span>
        </button>
      </div>
    </div>
  );
}
