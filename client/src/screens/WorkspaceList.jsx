import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Folder, Plus } from 'lucide-react';

export default function WorkspaceList() {
  const [workspaces, setWorkspaces] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    // In real app, fetch from local daemon via relay
    // Mocking for now to show the UI
    setWorkspaces([
      { id: 'antigravity-remote', name: 'antigravity-remote', path: 'C:/Users/fokae/Documents/antigravity/antigravity-remote' },
      { id: 'wechat-crm', name: 'wechat-crm', path: 'C:/Users/fokae/Documents/Codex/wechat-crm' },
      { id: 'knowledge-base', name: 'knowledge-base', path: 'C:/Users/fokae/Documents/Codex/knowledge-base' },
    ]);
  }, []);

  return (
    <div className="animate-fade-in">
      <nav className="navbar">
        <h1>Workspaces</h1>
      </nav>
      <div className="container">
        {workspaces.map(ws => (
          <div key={ws.id} className="list-item" onClick={() => navigate(`/workspace/${ws.id}`)}>
            <div className="list-item-icon">
              <Folder size={20} />
            </div>
            <div className="list-item-content">
              <div className="list-item-title">{ws.name}</div>
              <div className="list-item-subtitle">{ws.path}</div>
            </div>
          </div>
        ))}
      </div>
      <button className="fab" onClick={() => {}}>
        <Plus size={24} />
      </button>
    </div>
  );
}
