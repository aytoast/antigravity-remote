import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, MessageSquare, Plus, Pin } from 'lucide-react';
import { apiUrl } from '../api';

export default function WorkspaceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [threads, setThreads] = useState([]);
  const [pinned, setPinned] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('pinnedThreads')) || [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    fetch(apiUrl('/api/pinned-threads'))
      .then(res => res.json())
      .then(data => {
        if (!data.success) return;
        const localPinned = JSON.parse(localStorage.getItem('pinnedThreads') || '[]');
        if (data.data.length || localPinned.length === 0) {
          setPinned(data.data);
          return;
        }
        fetch(apiUrl('/api/pinned-threads'), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ threadIds: localPinned })
        }).catch(err => console.error(err));
      })
      .catch(err => console.error(err));
  }, []);

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
    fetch(apiUrl('/api/pinned-threads'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadIds: newPinned })
    }).catch(err => console.error(err));
  };

  useEffect(() => {
    fetch(apiUrl(`/api/workspaces/${id}/threads`))
      .then(res => res.json())
      .then(data => {
        if (data.success) setThreads(data.data);
      })
      .catch(err => console.error(err));
  }, [id]);

  return (
    <div className="animate-fade-in">
      <nav className="navbar">
        <div style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }} onClick={() => navigate('/')}>
          <ChevronLeft size={24} style={{ marginRight: '8px' }} />
          <h1>{id}</h1>
        </div>
      </nav>
      <div className="container">
        {threads && threads.length > 0 ? [...threads].sort((a, b) => {
          const aPinned = pinned.includes(a.id);
          const bPinned = pinned.includes(b.id);
          if (aPinned === bPinned) return 0;
          return aPinned ? -1 : 1;
        }).map(t => (
          <div key={t.id} className="list-item" onClick={() => navigate(`/chat/${t.id}`)}>
            <div className="list-item-icon">
              <MessageSquare size={20} />
            </div>
            <div className="list-item-content">
              <div className="list-item-title">{t.title}</div>
              <div className="list-item-subtitle">{new Date(t.lastUpdated).toLocaleDateString()} • {t.messageCount} messages</div>
            </div>
            <div onClick={(e) => togglePin(e, t.id)} style={{ padding: '8px', color: pinned.includes(t.id) ? 'var(--accent-color)' : 'var(--text-secondary)' }}>
              <Pin size={20} fill={pinned.includes(t.id) ? 'currentColor' : 'none'} />
            </div>
          </div>
        )) : null}
      </div>
      <button className="fab" onClick={() => navigate(`/chat/new`)}>
        <Plus size={24} />
      </button>
    </div>
  );
}
