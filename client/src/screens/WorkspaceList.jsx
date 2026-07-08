import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Folder, Plus } from 'lucide-react';

export default function WorkspaceList() {
  const [workspaces, setWorkspaces] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    fetch('http://100.102.126.57:8080/api/workspaces')
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setWorkspaces(data.data);
        }
      })
      .catch(err => console.error('Failed to fetch workspaces:', err));
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
