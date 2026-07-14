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
  const [isTurnActive, setIsTurnActive] = useState(false);
  const [queuedPrompts, setQueuedPrompts] = useState([]);
  const [sendMode, setSendMode] = useState('queue');
  const scrollRef = useRef(null);
  const pendingMessagesRef = useRef([]);
  const modelPickerRef = useRef(null);
  const inputRef = useRef(null);
  const queueLockRef = useRef(false);
  const submitPromptRef = useRef(null);

  const handleModelChange = async nextModel => {
    const previousModel = model;
    setModel(nextModel);
    setModelOpen(false);
    try {
      const response = await fetch(apiUrl(`/api/codex/threads/${id}/model`), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: nextModel }) });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Desktop model selection failed');
    } catch (error) {
      setModel(previousModel);
      setError(error.message);
    }
  };

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
    if (data.data.thread.model) setModel(data.data.thread.model);
    reconcileMessages(data.data.messages, threadId);
  };

  const refreshDesktopActivity = async () => {
    const response = await fetch(apiUrl('/api/codex/desktop/activity'));
    const data = await response.json();
    if (!data.success) throw new Error(data.error || 'Codex Desktop activity is unavailable');
    setIsTurnActive(Boolean(data.data.active));
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
    if (id === 'new') { setLoading(false); setMessages([]); setQueuedPrompts([]); setIsTurnActive(false); setTitle('New Codex Task'); return; }
    setLoading(true);
    setMessages(pendingMessagesRef.current.filter(message => message.threadId === id));
    Promise.all([loadThread(id), refreshDesktopActivity()]).catch(error => setError(error.message)).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (id === 'new') return;
    fetch(apiUrl(`/api/codex/desktop/threads/${id}/open`), { method: 'POST' }).catch(() => {});
  }, [id]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, queuedPrompts]);

  useEffect(() => {
    if (id === 'new' || (!isTurnActive && queuedPrompts.length === 0)) return undefined;
    const interval = window.setInterval(() => Promise.all([loadThread(id), refreshDesktopActivity()]).catch(() => {}), 750);
    return () => window.clearInterval(interval);
  }, [id, isTurnActive, queuedPrompts.length]);

  useEffect(() => {
    if (id === 'new') return undefined;
    const syncModel = () => fetch(apiUrl(`/api/codex/threads/${id}/model`)).then(response => response.json()).then(data => {
      if (data.success && data.data.model) setModel(data.data.model);
    }).catch(() => {});
    syncModel();
    const interval = window.setInterval(syncModel, 1500);
    return () => window.clearInterval(interval);
  }, [id]);

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

  const submitPrompt = async (prompt, mode = 'queue') => {
    if (!prompt || sending) return;
    setSending(true);
    setError('');
    try {
      let threadId = id;
      if (mode === 'steer' && id === 'new') throw new Error('Start a Codex task before steering it');
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
      if (id !== 'new' && mode === 'steer') {
        const stopResponse = await fetch(apiUrl('/api/codex/desktop/stop'), { method: 'POST' });
        const stopData = await stopResponse.json();
        if (!stopResponse.ok || !stopData.success) throw new Error(stopData.error || 'Codex Desktop did not stop current turn');
      }
      const response = id === 'new'
        ? await fetch(apiUrl(`/api/codex/threads/${threadId}/prompt`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, cwd: workspace?.path, model }) })
        : await fetch(apiUrl(`/api/codex/desktop/threads/${threadId}/prompt`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }) });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Codex prompt failed');
      setIsTurnActive(true);
      if (id === 'new') navigate(`/chat/codex/${threadId}`);
    } catch (requestError) {
      pendingMessagesRef.current = pendingMessagesRef.current.filter(message => message.content !== prompt);
      setMessages(current => current.filter(message => message.content !== prompt || !String(message.id).startsWith('local-')));
      setInput(prompt);
      setError(requestError.message);
    }
    finally { setSending(false); }
  };
  submitPromptRef.current = submitPrompt;

  const send = async () => {
    const prompt = input.trim();
    if (!prompt || sending) return;
    if (isTurnActive && sendMode === 'queue') {
      setQueuedPrompts(current => [...current, { id: `queued-${Date.now()}`, role: 'user', content: prompt, isQueued: true }]);
      setInput('');
      return;
    }
    await submitPrompt(prompt, isTurnActive ? 'steer' : 'queue');
  };

  useEffect(() => {
    if (isTurnActive || sending || queuedPrompts.length === 0 || queueLockRef.current) return;
    const [next] = queuedPrompts;
    queueLockRef.current = true;
    setQueuedPrompts(current => current.slice(1));
    submitPromptRef.current(next.content).finally(() => { queueLockRef.current = false; });
  }, [isTurnActive, sending, queuedPrompts]);

  const displayMessages = [...messages, ...queuedPrompts];

  return <div className="chat-page">
    <nav className="navbar">
      <div className="chat-heading-wrap"><button className="back-button" type="button" onClick={() => navigate(-1)} aria-label="Back"><ChevronLeft size={22} /></button><div className="chat-heading-meta"><h1>{title}</h1><ProviderBadge provider="codex" /></div></div>
    </nav>
    <div ref={scrollRef} className="container chat-scroll" style={{ overflowY: 'auto' }}><div className="chat-container">
      {loading ? <ChatSkeleton /> : displayMessages.map(message => message.role === 'event' ? <div key={message.id} className="timeline-event"><span>{message.title}</span></div> : <div key={message.id} className={`chat-bubble ${message.role}${String(message.id).startsWith('local-') ? ' is-new-message' : ''}${message.isQueued ? ' is-queued' : ''}`}>
        {message.role === 'ai' ? <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={url => url}>{message.content}</ReactMarkdown> : <>{message.content}{message.isQueued && <span className="queued-message-label">Queued</span>}</>}
      </div>)}
    </div></div>
    <div className="input-area">
      {id === 'new' && <div className="project-picker">
        <button className="project-picker-trigger" type="button" onClick={() => setWorkspaceOpen(open => !open)} aria-expanded={workspaceOpen}><Folder size={15} /><span>{workspace?.name || 'No Project'}</span><ChevronDown size={14} /></button>
        {workspaceOpen && <div className="project-picker-menu" role="listbox">{workspaces.map(item => <button key={item.id} type="button" onClick={() => { setWorkspace(item); setWorkspaceOpen(false); }}><Folder size={15} />{item.name}</button>)}</div>}
      </div>}
      <div className="composer">{isTurnActive && <div className="turn-actions" role="group" aria-label="Prompt mode"><button type="button" className={sendMode === 'queue' ? 'is-selected' : ''} onClick={() => setSendMode('queue')}>Queue</button><button type="button" className={sendMode === 'steer' ? 'is-selected' : ''} onClick={() => setSendMode('steer')}>Steer</button></div>}<textarea ref={inputRef} rows={1} className="input-box" placeholder="Prompt Codex" value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } }} disabled={sending} />
        <div className="composer-footer"><div className="model-picker" ref={modelPickerRef}><button className="model-trigger" type="button" onClick={() => setModelOpen(open => !open)} onKeyDown={event => event.key === 'Escape' && setModelOpen(false)} aria-expanded={modelOpen} aria-haspopup="listbox"><span>{models.find(item => item.id === model)?.name || 'Model'}</span><ChevronUp size={14} /></button>{modelOpen && <div className="model-menu" role="listbox" aria-label="Select model">{models.map(item => <button key={item.id} type="button" role="option" aria-selected={item.id === model} className={`model-option${item.id === model ? ' is-selected' : ''}`} onClick={() => handleModelChange(item.id)}>{item.name}</button>)}</div>}</div></div>
        <button className="composer-submit" type="button" onClick={send} disabled={sending || !input.trim()} aria-label="Send prompt"><Send size={16} /></button>
      </div>
      {error && <div className="bridge-error" role="status">{error}</div>}
    </div>
  </div>;
}
