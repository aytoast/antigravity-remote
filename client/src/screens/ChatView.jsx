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
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [bridgeError, setBridgeError] = useState('');
  const [sending, setSending] = useState(false);
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
    if (id === 'new') return;
    fetch(apiUrl(`/api/desktop/${id}/models`))
      .then(res => res.json())
      .then(data => {
        if (!data.success) return;
        const available = data.data.filter(model => model !== 'Antigravity');
        setModels(available);
        if (available.length) setSelectedModel(available[0]);
      })
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    if (!messages.length || positionedInitialHistory.current) return;
    const frame = requestAnimationFrame(() => {
      if (chatScrollRef.current) chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
      positionedInitialHistory.current = true;
    });
    return () => cancelAnimationFrame(frame);
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim()) return;
    setSending(true);
    setBridgeError('');
    const prompt = input.trim();
    setInput('');
    try {
      const response = await fetch(apiUrl(`/api/desktop/${id}/prompt`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Desktop prompt failed');
      setMessages(previous => [...previous, { id: `mobile-${Date.now()}`, role: 'user', content: prompt }]);
      let attempts = 0;
      const refresh = async () => {
        attempts += 1;
        try {
          const history = await fetch(apiUrl(`/api/threads/${id}`)).then(result => result.json());
          if (history.success) {
            const cleanMsgs = history.data.map(message => ({
              ...message,
              content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
            }));
            setMessages(cleanMsgs);
          }
        } catch {}
        if (attempts < 30) window.setTimeout(refresh, 1000);
      };
      window.setTimeout(refresh, 1000);
    } catch (error) {
      setInput(prompt);
      setBridgeError(error.message);
    } finally {
      setSending(false);
    }
  };

  const handleModelChange = async (event) => {
    const model = event.target.value;
    setSelectedModel(model);
    try {
      const response = await fetch(apiUrl(`/api/desktop/${id}/model`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model })
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Model selection failed');
    } catch (error) {
      setBridgeError(error.message);
    }
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
              <div key={m.id} className={`chat-bubble ${m.role}${String(m.id).startsWith('mobile-') ? ' is-new-message' : ''}`}>
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
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
          disabled={sending || id === 'new'}
        />
        <button className="send-btn" onClick={handleSend} disabled={sending || id === 'new'}>
          <Send size={20} />
        </button>
        {models.length > 0 && <select className="model-select" value={selectedModel} onChange={handleModelChange} aria-label="Select model">
          {models.map(model => <option key={model} value={model}>{model}</option>)}
        </select>}
        {bridgeError && <div className="bridge-error" role="status">{bridgeError}</div>}
      </div>
    </div>
  );
}
