import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, Send } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { apiUrl } from '../api';

export default function ChatView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [threadTitle, setThreadTitle] = useState('Thread');
  const [expandedEvents, setExpandedEvents] = useState(() => new Set());
  const chatScrollRef = useRef(null);
  const positionedInitialHistory = useRef(false);

  useEffect(() => {
    positionedInitialHistory.current = false;
    if (id === 'new') return;
    fetch(apiUrl(`/api/threads/${id}`))
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          if (data.thread?.title) setThreadTitle(data.thread.title);
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
    if (!messages.length || positionedInitialHistory.current) return;
    const frame = requestAnimationFrame(() => {
      if (chatScrollRef.current) chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
      positionedInitialHistory.current = true;
    });
    return () => cancelAnimationFrame(frame);
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

  const toggleEvent = (eventId) => {
    setExpandedEvents(previous => {
      const next = new Set(previous);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
  };

  return (
    <div className="chat-page">
      <nav className="navbar">
        <div style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }} onClick={() => navigate(-1)}>
          <ChevronLeft size={24} style={{ marginRight: '8px' }} />
          <h1>{id === 'new' ? 'New Thread' : threadTitle}</h1>
        </div>
      </nav>
      
      <div ref={chatScrollRef} className="container chat-scroll" style={{ overflowY: 'auto' }}>
        <div className="chat-container">
          {messages.map(m => (
            m.role === 'event' ? (
              <div key={m.id} className={`timeline-event${expandedEvents.has(m.id) ? ' is-expanded' : ''}`}>
                <button className="timeline-event-toggle" type="button" onClick={() => toggleEvent(m.id)} aria-expanded={expandedEvents.has(m.id)}>
                  <span>{m.title}</span>
                  <span className="timeline-chevron" aria-hidden="true">›</span>
                </button>
                <div className={`timeline-event-details${expandedEvents.has(m.id) ? ' is-expanded' : ''}`}>
                  <div className="timeline-event-detail">{m.detail && <ReactMarkdown>{m.detail}</ReactMarkdown>}</div>
                </div>
              </div>
            ) : (
              <div key={m.id} className={`chat-bubble ${m.role}`}>
                {m.role === 'ai' ? (
                  <>
                    {m.thinking && (
                      <div className={`thought-block${expandedEvents.has(`${m.id}-thinking`) ? ' is-expanded' : ''}`}>
                        <button className="timeline-event-toggle" type="button" onClick={() => toggleEvent(`${m.id}-thinking`)} aria-expanded={expandedEvents.has(`${m.id}-thinking`)}>
                          <span>Thought</span>
                          <span className="timeline-chevron" aria-hidden="true">›</span>
                        </button>
                        <div className={`timeline-event-details${expandedEvents.has(`${m.id}-thinking`) ? ' is-expanded' : ''}`}>
                          <div className="timeline-event-detail"><ReactMarkdown>{m.thinking}</ReactMarkdown></div>
                        </div>
                      </div>
                    )}
                    <ReactMarkdown>{m.content}</ReactMarkdown>
                  </>
                ) : m.content}
              </div>
            )
          ))}
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
