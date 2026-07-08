import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Folder, Filter, FolderPlus, MoreHorizontal } from 'lucide-react';

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
  const [pinned, setPinned] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('pinnedThreads')) || [];
    } catch {
      return [];
    }
  });
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([
      fetch('http://100.102.126.57:8080/api/workspaces').then(res => res.json()),
      fetch('http://100.102.126.57:8080/api/threads/recent?limit=100').then(res => res.json())
    ]).then(([wsData, threadData]) => {
      if (wsData.success) setWorkspaces(wsData.data);
      if (threadData.success) setThreads(threadData.data);
    }).catch(err => console.error(err));
  }, []);

  // Extremely basic heuristic to assign threads to workspaces for MVP display
  const getWorkspaceForThread = (thread) => {
    const title = thread.title.toLowerCase();
    if (title.includes('antigravity') || title.includes('remote')) return 'antigravity-remote';
    if (title.includes('wechat') || title.includes('crm')) return 'wechat-crm';
    if (title.includes('half') || title.includes('repository')) return 'half.ceo';
    if (title.includes('telegram') || title.includes('knowledge')) return 'knowledge-base';
    if (title.includes('notion') || title.includes('skill')) return 'notion-skills';
    if (title.includes('prompt')) return 'prompting-guide';
    return null;
  };

  const pinnedThreads = threads.filter(t => pinned.includes(t.id));
  
  // Group threads
  const projectsMap = {};
  workspaces.forEach(ws => projectsMap[ws.name] = []);
  const looseThreads = [];

  threads.forEach(t => {
    const ws = getWorkspaceForThread(t);
    if (ws && projectsMap[ws] !== undefined) {
      projectsMap[ws].push(t);
    } else {
      looseThreads.push(t);
    }
  });

  const handleThreadClick = (id) => navigate(`/chat/${id}`);

  const togglePin = (e, threadId) => {
    e.stopPropagation();
    let newPinned;
    if (pinned.includes(threadId)) {
      newPinned = pinned.filter(id => id !== threadId);
    } else {
      newPinned = [...pinned, threadId];
    }
    setPinned(newPinned);
    localStorage.setItem('pinnedThreads', JSON.stringify(newPinned));
  };

  const renderPinButton = (t) => (
    <div onClick={(e) => togglePin(e, t.id)} style={{ padding: '8px', color: pinned.includes(t.id) ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
      <Filter size={16} /> {/* Placeholder for Pin until imported */}
    </div>
  );

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
                <div className="list-item-right" onClick={(e) => togglePin(e, t.id)} style={{color: 'var(--text-primary)'}}>
                  {formatRelativeDate(t.lastUpdated)}
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
          {workspaces.map(ws => (
            <div key={ws.id} style={{ marginBottom: '16px' }}>
              <div className="list-item project-item">
                <div className="list-item-icon">
                  <Folder size={18} />
                </div>
                <div className="list-item-content">{ws.name}</div>
              </div>
              {projectsMap[ws.name].length === 0 ? (
                <div className="empty-text">No conversations yet</div>
              ) : (
                projectsMap[ws.name].map(t => (
                  <div key={t.id} className="list-item nested-thread" onClick={() => handleThreadClick(t.id)} style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                    <div className="list-item-content">
                      <div className="list-item-title">{t.title}</div>
                    </div>
                    <div className="list-item-right" onClick={(e) => togglePin(e, t.id)} style={{color: pinned.includes(t.id) ? 'var(--text-primary)' : 'inherit'}}>
                      {formatRelativeDate(t.lastUpdated)}
                    </div>
                  </div>
                ))
              )}
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
              <div className="list-item-right" onClick={(e) => togglePin(e, t.id)} style={{color: pinned.includes(t.id) ? 'var(--text-primary)' : 'inherit'}}>
                {formatRelativeDate(t.lastUpdated)}
              </div>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}
