import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, Send } from 'lucide-react';
import { apiUrl } from '../api';

export default function ChatView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const endRef = useRef(null);

  useEffect(() => {
    if (id === 'new') return;
    fetch(apiUrl(`/api/threads/${id}`))
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          // ensure data is clean text since content might be XML/JSON strings
          const cleanMsgs = data.data.map(m => ({
            ...m,
            content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
          }));
          setMessages(cleanMsgs);
        }
      })
      .catch(err => console.error(err));
  }, [id]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    if (!input.trim()) return;
    setMessages([...messages, { id: Date.now(), role: 'user', content: input }]);
    setInput('');
    // Mock AI response
    setTimeout(() => {
      setMessages(prev => [...prev, { id: Date.now(), role: 'ai', content: 'Processing your request...' }]);
    }, 1000);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <nav className="navbar">
        <div style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }} onClick={() => navigate(-1)}>
          <ChevronLeft size={24} style={{ marginRight: '8px' }} />
          <h1>{id === 'new' ? 'New Thread' : 'Thread'}</h1>
        </div>
      </nav>
      
      <div className="container" style={{ overflowY: 'auto' }}>
        <div className="chat-container">
          {messages.map(m => (
            <div key={m.id} className={`chat-bubble ${m.role}`}>
              {m.content}
            </div>
          ))}
          <div ref={endRef} />
        </div>
      </div>

      <div className="input-area">
        <input 
          type="text" 
          className="input-box" 
          placeholder="Ask Antigravity..." 
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
        />
        <button className="send-btn" onClick={handleSend}>
          <Send size={20} />
        </button>
      </div>
    </div>
  );
}
