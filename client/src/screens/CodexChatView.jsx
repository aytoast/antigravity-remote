import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronUp, Folder, Send } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { apiUrl } from '../api';
import { ChatSkeleton } from '../components/LoadingSkeleton';
import { ProviderBadge } from '../components/ProviderBadge';

export default function CodexChatView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [messages, setMessages] = useState([]);
  const [title, setTitle] = useState('New Codex Task');
  const [models, setModels] = useState([]);
  const [model, setModel] = useState('');
  const [workspaces, setWorkspaces] = useState([]);
  const [workspace, setWorkspace] = useState(null);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(id !== 'new');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [modelOpen, setModelOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const scrollRef = useRef(null);
  const pendingMessagesRef = useRef([]);
  const modelPickerRef = useRef(null);
  const inputRef = useRef(null);

  const reconcileMessages = (serverMessages, threadId) => {
    const matchedServerMessages = new Set();
    const pending = pendingMessagesRef.current.filter(message => message.threadId === threadId);
    const remaining = pending.filter(message => {
      const matchIndex = serverMessages.findIndex((item, index) => !matchedServerMessages.has(index) && item.role === 'user' && item.content === message.content);
      if (matchIndex < 0) return true;
      matchedServerMessages.add(matchIndex);
      return false;
    });
    pendingMessagesRef.current = [...pendingMessagesRef.current.filter(message => message.threadId !== threadId), ...remaining];
    setMessages([...serverMessages, ...remaining]);
  };

  const loadThread = async threadId => {
    const response = await fetch(apiUrl(`/api/codex/threads/${threadId}`));
    const data = await response.json();
    if (!data.success) throw new Error(data.error || 'Codex task is unavailable');
    setTitle(data.data.thread.title);
    reconcileMessages(data.data.messages, threadId);
  };

  useEffect(() => {
    fetch(apiUrl('/api/codex/models')).then(result => result.json()).then(data => {
      if (!data.success) return;
      setModels(data.data);
      setModel(data.data.find(item => item.isDefault)?.id || data.data[0]?.id || '');
    }).catch(error => setError(error.message));
    fetch(apiUrl('/api/conversations')).then(result => result.json()).then(data => {
      if (data.success) setWorkspaces(data.data.workspaces.filter(item => item.path));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    setError('');
    if (id === 'new') { setLoading(false); setMessages([]); setTitle('New Codex Task'); return; }
    setLoading(true);
    setMessages(pendingMessagesRef.current.filter(message => message.threadId === id));
    loadThread(id).catch(error => setError(error.message)).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const inputElement = inputRef.current;
    if (!inputElement) return;
    inputElement.style.height = '0px';
    inputElement.style.height = `${Math.min(inputElement.scrollHeight, 160)}px`;
  }, [input]);

  useEffect(() => {
    if (!modelOpen) return undefined;
    const closeModelMenu = event => {
      if (!modelPickerRef.current?.contains(event.target)) setModelOpen(false);
    };
    document.addEventListener('pointerdown', closeModelMenu);
    return () => document.removeEventListener('pointerdown', closeModelMenu);
  }, [modelOpen]);

  const send = async () => {
    const prompt = input.trim();
    if (!prompt || sending) return;
    setSending(true);
    setError('');
    try {
      let threadId = id;
      if (id === 'new') {
        const response = await fetch(apiUrl('/api/codex/threads'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cwd: workspace?.path, model }) });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || 'Codex task failed to start');
        threadId = data.data.id;
      }
      const optimistic = { id: `local-${Date.now()}`, role: 'user', content: prompt, threadId };
      pendingMessagesRef.current.push(optimistic);
      setMessages(current => [...current, optimistic]);
      setInput('');
      const response = await fetch(apiUrl(`/api/codex/threads/${threadId}/prompt`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, cwd: workspace?.path, model }) });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Codex prompt failed');
      if (id === 'new') navigate(`/chat/codex/${threadId}`);
      else {
        let attempts = 0;
        const refresh = async () => {
          attempts += 1;
          try { await loadThread(threadId); } catch {}
          if (attempts < 30) window.setTimeout(refresh, attempts < 10 ? 350 : 900);
        };
        window.setTimeout(refresh, 250);
      }
    } catch (requestError) {
      pendingMessagesRef.current = pendingMessagesRef.current.filter(message => message.content !== prompt);
      setMessages(current => current.filter(message => message.content !== prompt || !String(message.id).startsWith('local-')));
      setInput(prompt);
      setError(requestError.message);
    }
    finally { setSending(false); }
  };

  return <div className="chat-page">
    <nav className="navbar">
      <div className="chat-heading-wrap"><button className="back-button" type="button" onClick={() => navigate(-1)} aria-label="Back"><ChevronLeft size={22} /></button><div className="chat-heading-meta"><h1>{title}</h1><ProviderBadge provider="codex" /></div></div>
    </nav>
    <div ref={scrollRef} className="container chat-scroll" style={{ overflowY: 'auto' }}><div className="chat-container">
      {loading ? <ChatSkeleton /> : messages.map(message => message.role === 'event' ? <div key={message.id} className="timeline-event"><span>{message.title}</span></div> : <div key={message.id} className={`chat-bubble ${message.role}${String(message.id).startsWith('local-') ? ' is-new-message' : ''}`}>
        {message.role === 'ai' ? <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={url => url}>{message.content}</ReactMarkdown> : message.content}
      </div>)}
    </div></div>
    <div className="input-area">
      {id === 'new' && <div className="project-picker">
        <button className="project-picker-trigger" type="button" onClick={() => setWorkspaceOpen(open => !open)} aria-expanded={workspaceOpen}><Folder size={15} /><span>{workspace?.name || 'No Project'}</span><ChevronDown size={14} /></button>
        {workspaceOpen && <div className="project-picker-menu" role="listbox">{workspaces.map(item => <button key={item.id} type="button" onClick={() => { setWorkspace(item); setWorkspaceOpen(false); }}><Folder size={15} />{item.name}</button>)}</div>}
      </div>}
      <div className="composer"><textarea ref={inputRef} rows={1} className="input-box" placeholder="Prompt Codex" value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } }} disabled={sending} />
        <div className="composer-footer"><div className="model-picker" ref={modelPickerRef}><button className="model-trigger" type="button" onClick={() => setModelOpen(open => !open)} onKeyDown={event => event.key === 'Escape' && setModelOpen(false)} aria-expanded={modelOpen} aria-haspopup="listbox"><span>{models.find(item => item.id === model)?.name || 'Model'}</span><ChevronUp size={14} /></button>{modelOpen && <div className="model-menu" role="listbox" aria-label="Select model">{models.map(item => <button key={item.id} type="button" role="option" aria-selected={item.id === model} className={`model-option${item.id === model ? ' is-selected' : ''}`} onClick={() => { setModel(item.id); setModelOpen(false); }}>{item.name}</button>)}</div>}</div></div>
        <button className="composer-submit" type="button" onClick={send} disabled={sending || !input.trim()} aria-label="Send prompt"><Send size={16} /></button>
      </div>
      {error && <div className="bridge-error" role="status">{error}</div>}
    </div>
  </div>;
}
