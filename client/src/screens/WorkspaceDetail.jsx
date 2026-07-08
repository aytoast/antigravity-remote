import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, MessageSquare, Plus } from 'lucide-react';

export default function WorkspaceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [threads, setThreads] = useState([]);

  useEffect(() => {
    // Mocking threads
    setThreads([
      { id: 't1', title: 'Implement proxy server logic', date: '2 hours ago', count: 14 },
      { id: 't2', title: 'Setup github repository and ignore files', date: '5 hours ago', count: 8 },
      { id: 't3', title: 'Initial project planning', date: '1 day ago', count: 32 }
    ]);
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
        {threads && threads.length > 0 ? threads.map(t => (
          <div key={t.id} className="list-item" onClick={() => navigate(`/chat/${t.id}`)}>
            <div className="list-item-icon">
              <MessageSquare size={20} />
            </div>
            <div className="list-item-content">
              <div className="list-item-title">{t.title}</div>
              <div className="list-item-subtitle">{t.date} • {t.count} messages</div>
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
