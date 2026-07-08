import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import WorkspaceList from './screens/WorkspaceList';
import WorkspaceDetail from './screens/WorkspaceDetail';
import ChatView from './screens/ChatView';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<WorkspaceList />} />
        <Route path="/workspace/:id" element={<WorkspaceDetail />} />
        <Route path="/chat/:id" element={<ChatView />} />
      </Routes>
    </Router>
  );
}

export default App;
