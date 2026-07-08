import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, MessageSquare, Plus } from 'lucide-react';

export default function WorkspaceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [threads, setThreads] = useState([]);

  useEffect(() => {
    fetch('http://100.102.126.57:8080/api/threads/recent')
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
