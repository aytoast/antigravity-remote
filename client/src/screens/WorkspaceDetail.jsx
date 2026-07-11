import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, MessageSquare, Plus, Pin } from 'lucide-react';
import { apiUrl } from '../api';
import { FolderSkeleton } from '../components/LoadingSkeleton';

export default function WorkspaceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pinned, setPinned] = useState([]);
  const [pinError, setPinError] = useState('');

  useEffect(() => {
    fetch(apiUrl('/api/pinned-threads'))
      .then(res => res.json())
      .then(data => {
        if (data.success) setPinned(data.data);
      })
      .catch(err => console.error(err));
  }, []);

  const togglePin = async (e, threadId) => {
    e.stopPropagation();
    const previous = pinned;
    const shouldPin = !pinned.includes(threadId);
    const newPinned = shouldPin ? [...pinned, threadId] : pinned.filter(id => id !== threadId);
    setPinned(newPinned);
    setPinError('');
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
      setPinError(error.message);
    }
  };

  useEffect(() => {
    setLoading(true);
    fetch(apiUrl(`/api/workspaces/${id}/threads`))
      .then(res => res.json())
      .then(data => {
        if (data.success) setThreads(data.data);
      })
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
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
        {pinError && <div className="desktop-notice" role="status">{pinError}</div>}
        {loading ? <FolderSkeleton /> : threads.length > 0 ? [...threads].sort((a, b) => {
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
