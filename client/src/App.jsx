import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import WorkspaceList from './screens/WorkspaceList';
import WorkspaceDetail from './screens/WorkspaceDetail';
import ChatView from './screens/ChatView';
import CodexChatView from './screens/CodexChatView';
import NewConversation from './screens/NewConversation';
import FileView from './screens/FileView';
import ScheduledTasks from './screens/ScheduledTasks';
import ScheduledTaskDetail from './screens/ScheduledTaskDetail';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<WorkspaceList />} />
        <Route path="/workspace/:id" element={<WorkspaceDetail />} />
        <Route path="/chat/new" element={<NewConversation />} />
        <Route path="/chat/codex/:id" element={<CodexChatView />} />
        <Route path="/chat/antigravity/:id" element={<ChatView />} />
        <Route path="/chat/:id" element={<ChatView />} />
        <Route path="/chat/:id/file" element={<FileView />} />
        <Route path="/tasks" element={<ScheduledTasks />} />
        <Route path="/tasks/:name" element={<ScheduledTaskDetail />} />
      </Routes>
    </Router>
  );
}

export default App;
