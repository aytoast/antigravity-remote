import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Folder, Filter, FolderPlus, Pin } from 'lucide-react';
import { apiUrl } from '../api';

// Format date relative (e.g. 1d, 4h)
const formatRelativeDate = (dateString) => {
  if (!dateString) return '';
  const diffMs = Date.now() - new Date(dateString).getTime();
  const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffHrs < 24) return `${diffHrs}h`;
  return `${Math.floor(diffHrs / 24)}d`;
};

export default function WorkspaceList() {
  const [workspaces, setWorkspaces] = useState([]);
  const [threads, setThreads] = useState([]);
  const [workspaceOrder, setWorkspaceOrder] = useState([]);
  const [pinned, setPinned] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('pinnedThreads')) || [];
    } catch {
      return [];
    }
  });
  const [expandedWorkspaces, setExpandedWorkspaces] = useState(() => new Set());
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([
      fetch(apiUrl('/api/workspaces')).then(res => res.json()),
      fetch(apiUrl('/api/sidebar-threads')).then(res => res.json()),
      fetch(apiUrl('/api/pinned-threads')).then(res => res.json())
    ]).then(([wsData, threadData, pinData]) => {
      if (wsData.success) setWorkspaces(wsData.data);
      if (threadData.success) {
        setThreads(threadData.data.threads);
        setWorkspaceOrder(threadData.data.workspaceOrder);
        localStorage.removeItem('archivedThreads');
      }
      if (pinData.success) {
        const localPinned = JSON.parse(localStorage.getItem('pinnedThreads') || '[]');
        if (pinData.data.length || localPinned.length === 0) {
          setPinned(pinData.data);
        } else {
          fetch(apiUrl('/api/pinned-threads'), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ threadIds: localPinned })
          }).catch(err => console.error(err));
        }
      }
    }).catch(err => console.error(err));
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

  const activeThreads = threads;
  const pinnedThreads = activeThreads.filter(t => pinned.includes(t.id));
  
  // Group threads by workspace using actual workspacePath
  const projectsMap = {};
  workspaces.forEach(ws => projectsMap[ws.name] = []);
  const looseThreads = [];

  activeThreads.forEach(t => {
    const wsName = getWorkspaceForThread(t);
    if (wsName && projectsMap[wsName] !== undefined) {
      projectsMap[wsName].push(t);
    } else if (!pinned.includes(t.id)) {
      looseThreads.push(t);
    }
  });

  Object.values(projectsMap).forEach(projectThreads => {
    projectThreads.sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated));
  });
  looseThreads.sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated));

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

  const togglePin = (e, threadId) => {
    e.stopPropagation();
    const newPinned = pinned.includes(threadId)
      ? pinned.filter(id => id !== threadId)
      : [...pinned, threadId];
    setPinned(newPinned);
    localStorage.setItem('pinnedThreads', JSON.stringify(newPinned));
    fetch(apiUrl('/api/pinned-threads'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadIds: newPinned })
    }).catch(err => console.error(err));
  };

  return (
    <div className="animate-fade-in">
      <div className="container" style={{ paddingTop: '20px' }}>
        
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
                  <div>{formatRelativeDate(t.lastUpdated)}</div>
                  <button className="thread-action" type="button" title="Unpin conversation" aria-label="Unpin conversation" onClick={(e) => togglePin(e, t.id)} style={{ color: 'var(--text-primary)' }}>
                    <Pin size={14} fill="currentColor" />
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
            <div style={{ display: 'flex', gap: '16px' }}>
              <Filter size={16} />
              <FolderPlus size={16} />
            </div>
          </div>
          {[...workspaces].sort((a, b) => workspaceOrder.indexOf(a.name) - workspaceOrder.indexOf(b.name)).map(ws => (
            <div key={ws.id} style={{ marginBottom: '16px' }}>
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
                        <div>{formatRelativeDate(t.lastUpdated)}</div>
                        <button className="thread-action" type="button" title={pinned.includes(t.id) ? 'Unpin conversation' : 'Pin conversation'} aria-label={pinned.includes(t.id) ? 'Unpin conversation' : 'Pin conversation'} onClick={(e) => togglePin(e, t.id)} style={{ color: pinned.includes(t.id) ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                          <Pin size={14} fill={pinned.includes(t.id) ? 'currentColor' : 'none'} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Loose Conversations Section */}
        <div className="section">
          <div className="section-header">Conversations</div>
          {looseThreads.map(t => (
            <div key={t.id} className="list-item thread-item" onClick={() => handleThreadClick(t.id)}>
              <div className="list-item-content">
                <div className="list-item-title">{t.title}</div>
              </div>
              <div className="list-item-right">
                <div>{formatRelativeDate(t.lastUpdated)}</div>
                <button className="thread-action" type="button" title={pinned.includes(t.id) ? 'Unpin conversation' : 'Pin conversation'} aria-label={pinned.includes(t.id) ? 'Unpin conversation' : 'Pin conversation'} onClick={(e) => togglePin(e, t.id)} style={{ color: pinned.includes(t.id) ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                  <Pin size={14} fill={pinned.includes(t.id) ? 'currentColor' : 'none'} />
                </button>
              </div>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}
