import { Bot, ChevronLeft, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function NewConversation() {
  const navigate = useNavigate();
  return <div className="new-conversation-page">
    <nav className="navbar">
      <button className="back-button" type="button" onClick={() => navigate(-1)} aria-label="Back"><ChevronLeft size={22} /></button>
      <h1>New Conversation</h1>
    </nav>
    <main className="provider-choice">
      <p>Choose runtime</p>
      <button type="button" className="provider-choice-card provider-antigravity" onClick={() => navigate('/chat/antigravity/new')}>
        <Sparkles size={22} /><span>Antigravity</span><small>Use running Antigravity desktop conversation</small>
      </button>
      <button type="button" className="provider-choice-card provider-codex" onClick={() => navigate('/chat/codex/new')}>
        <Bot size={22} /><span>Codex</span><small>Start local Codex task through App Server</small>
      </button>
    </main>
  </div>;
}
