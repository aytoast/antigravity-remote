import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronLeft, ChevronUp, Folder, Mic, Plus, Send } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { apiUrl } from '../api';
import { ChatSkeleton } from '../components/LoadingSkeleton';

const builtinSlashCommands = [
  { name: 'btw', description: 'Ask a quick question without interrupting the main conversation.' },
  { name: 'goal', description: 'Run until the specified goal is completely finished' },
  { name: 'schedule', description: 'Run an instruction on a recurring schedule or as a one-time timer' },
  { name: 'browser', description: 'Invoke a browser agent for web tasks' },
  { name: 'grill-me', description: 'Interview me to align on a plan' },
  { name: 'teamwork-preview', description: 'Invoke a team of agents to autonomously tackle large projects' },
  { name: 'learn', description: 'Reflect on recent successes or corrections to capture reusable skills or rules' }
];

const addSourceSkill = { name: 'add-source', description: 'Add a source to this knowledge-base repo', scope: 'skill' };

export default function ChatView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const markdownComponents = {
    a: ({ href, children, ...props }) => {
      const isExternal = /^(?:https?:|mailto:)/i.test(href || '');
      const fileTarget = href || React.Children.toArray(children).join('');
      const isFile = !isExternal && (String(fileTarget).startsWith('file:') || /(?:\\|\/|^)[^/?#]+\.(?:md|markdown|txt|json|yaml|yml|csv|tsv|py|js|ts|tsx|jsx|css)$/i.test(String(fileTarget)));
      if (!isFile) return <a href={href} {...props}>{children}</a>;
      return <a href="#file" {...props} onMouseDown={event => event.preventDefault()} onClick={event => { event.preventDefault(); event.stopPropagation(); navigate(`/chat/${id}/file?path=${encodeURIComponent(fileTarget)}`); }}>{children}</a>;
    }
  };
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [threadTitle, setThreadTitle] = useState('Thread');
  const [desktopConversationId, setDesktopConversationId] = useState('');
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [bridgeError, setBridgeError] = useState('');
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState('');
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [expandedEvents, setExpandedEvents] = useState(() => new Set());
  const [slashSelection, setSlashSelection] = useState(0);
  const [skills, setSkills] = useState([addSourceSkill]);
  const chatScrollRef = useRef(null);
  const modelPickerRef = useRef(null);
  const positionedInitialHistory = useRef(false);
  const userScrolledAway = useRef(false);

  const scrollToBottom = () => {
    const container = chatScrollRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  };

  useEffect(() => {
    positionedInitialHistory.current = false;
    userScrolledAway.current = false;
    setModelMenuOpen(false);
    setProjectMenuOpen(false);
    setDesktopConversationId(id === 'new' ? '' : id);
    if (id === 'new') {
      setLoading(false);
      setMessages([]);
      fetch(apiUrl('/api/desktop/new/open'), { method: 'POST' })
        .then(res => res.json())
        .then(data => {
          if (!data.success) throw new Error(data.error || 'New Conversation is unavailable on desktop');
          setDesktopConversationId('new');
        })
        .catch(error => setBridgeError(error.message));
      fetch(apiUrl('/api/desktop/sidebar-projects'))
        .then(res => res.json())
        .then(data => { if (data.success) setProjects(data.data); })
        .catch(() => {});
      return;
    }
    setLoading(true);
    setMessages([]);
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
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    fetch(apiUrl('/api/skills'))
      .then(res => res.json())
      .then(data => { if (data.success) setSkills([addSourceSkill, ...data.data]); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!desktopConversationId) return;
    const openRequest = desktopConversationId === 'new'
      ? Promise.resolve()
      : fetch(apiUrl(`/api/desktop/${desktopConversationId}/open`), { method: 'POST' });
    openRequest.then(() => fetch(apiUrl(`/api/desktop/${desktopConversationId}/models`)))
      .then(res => res.json())
      .then(data => {
        if (!data.success) return;
        const available = (Array.isArray(data.data) ? data.data : data.data.models).filter(model => model !== 'Antigravity');
        setModels(available);
        const desktopSelected = Array.isArray(data.data) ? '' : data.data.selected;
        if (available.length) setSelectedModel(available.includes(desktopSelected) ? desktopSelected : available[0]);
      })
      .catch(() => {});
  }, [desktopConversationId]);

  useEffect(() => {
    if (!modelMenuOpen) return undefined;
    const closeMenu = (event) => {
      if (!modelPickerRef.current?.contains(event.target)) setModelMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeMenu);
    return () => document.removeEventListener('pointerdown', closeMenu);
  }, [modelMenuOpen]);

  useEffect(() => {
    if (!messages.length) return;
    const frame = requestAnimationFrame(() => {
      if (!positionedInitialHistory.current || !userScrolledAway.current) scrollToBottom();
      positionedInitialHistory.current = true;
    });
    return () => cancelAnimationFrame(frame);
  }, [messages]);

  const handleChatScroll = () => {
    const container = chatScrollRef.current;
    if (!container) return;
    userScrolledAway.current = container.scrollHeight - container.scrollTop - container.clientHeight > 40;
  };

  const keepBottomAnchored = () => {
    if (!userScrolledAway.current) requestAnimationFrame(scrollToBottom);
  };

  const handleSend = async () => {
    if (!input.trim() || !desktopConversationId) return;
    setSending(true);
    setBridgeError('');
    const prompt = input.trim();
    const targetId = desktopConversationId;
    setInput('');
    try {
      const response = await fetch(apiUrl(`/api/desktop/${targetId}/prompt`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Desktop prompt failed');
      const conversationId = data.data?.id || targetId;
      if (id === 'new' && conversationId !== 'new') setDesktopConversationId(conversationId);
      setMessages(previous => [...previous, { id: `mobile-${Date.now()}`, role: 'user', content: prompt }]);
      let attempts = 0;
      const refresh = async () => {
        attempts += 1;
        try {
          const history = await fetch(apiUrl(`/api/threads/${conversationId}`)).then(result => result.json());
          if (history.success) {
            const cleanMsgs = history.data.map(message => ({
              ...message,
              content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
            }));
            setMessages(cleanMsgs);
          }
        } catch {}
        if (attempts < 30) window.setTimeout(refresh, attempts < 12 ? 250 : 750);
      };
      window.setTimeout(refresh, 150);
    } catch (error) {
      setInput(prompt);
      setBridgeError(error.message);
    } finally {
      setSending(false);
    }
  };

  const handleModelChange = async (model) => {
    setSelectedModel(model);
    setModelMenuOpen(false);
    try {
      const response = await fetch(apiUrl(`/api/desktop/${desktopConversationId || id}/model`), {
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

  const handleProjectChange = async (project) => {
    setSelectedProject(project.name);
    setProjectMenuOpen(false);
    try {
      const response = await fetch(apiUrl('/api/desktop/new/project'), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: project.name })
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Project selection failed');
    } catch (error) { setBridgeError(error.message); }
  };

  const slashCommands = [...builtinSlashCommands, ...skills];
  const slashQuery = input.match(/^\/([^\s]*)$/)?.[1] ?? null;
  const visibleSlashCommands = slashQuery === null
    ? []
    : slashCommands.filter(command => `${command.name} ${command.description}`.toLowerCase().includes(slashQuery.toLowerCase()));

  useEffect(() => {
    setSlashSelection(0);
  }, [slashQuery]);

  const selectSlashCommand = (command) => {
    setInput(`/${command.name} `);
    setSlashSelection(0);
  };

  const handleComposerKeyDown = (event) => {
    if (visibleSlashCommands.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSlashSelection(index => (index + 1) % visibleSlashCommands.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSlashSelection(index => (index - 1 + visibleSlashCommands.length) % visibleSlashCommands.length);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setInput('');
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        selectSlashCommand(visibleSlashCommands[slashSelection]);
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) handleSend();
  };

  const submitDisabled = sending || !desktopConversationId || !input.trim();
  const submitDisabledReason = sending
    ? 'Message is sending'
    : !desktopConversationId
      ? 'Waiting for desktop conversation'
      : 'Enter a message to send';

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
        <div className="chat-heading-wrap">
          <div style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }} onClick={() => navigate(-1)}>
          <ChevronLeft size={24} style={{ marginRight: '8px' }} />
            <div><h1>{id === 'new' ? 'New Antigravity Conversation' : threadTitle}</h1><span className="provider-badge provider-antigravity">Antigravity</span></div>
          </div>
        </div>
      </nav>
      
      <div ref={chatScrollRef} className="container chat-scroll" style={{ overflowY: 'auto' }} onScroll={handleChatScroll}>
        <div className="chat-container">
          {loading ? <ChatSkeleton /> : messages.map(m => (
            m.role === 'event' ? (
              <div key={m.id} className={`timeline-event${expandedEvents.has(m.id) ? ' is-expanded' : ''}`}>
                <button className="timeline-event-toggle" type="button" onClick={() => toggleEvent(m.id)} aria-expanded={expandedEvents.has(m.id)}>
                  <span>{m.title}</span>
                  <span className="timeline-chevron" aria-hidden="true">›</span>
                </button>
                <div className={`timeline-event-details${expandedEvents.has(m.id) ? ' is-expanded' : ''}`}>
                  <div className="timeline-event-detail">{m.detail && <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={url => url} components={markdownComponents}>{m.detail}</ReactMarkdown>}</div>
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
                          <div className="timeline-event-detail"><ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={url => url} components={markdownComponents}>{m.thinking}</ReactMarkdown></div>
                        </div>
                      </div>
                    )}
                    <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={url => url} components={markdownComponents}>{m.content}</ReactMarkdown>
                  </>
                ) : m.content}
              </div>
            )
          ))}
        </div>
      </div>

      <div className="input-area">
        {id === 'new' && <div className="project-picker">
          <button className="project-picker-trigger" type="button" onClick={() => setProjectMenuOpen(open => !open)} aria-expanded={projectMenuOpen} aria-haspopup="listbox">
            <Folder size={15} /><span>{selectedProject || 'No Project'}</span><ChevronDown size={14} />
          </button>
          {projectMenuOpen && <div className="project-picker-menu" role="listbox" aria-label="Select project">
            {projects.map(project => <button key={project.id} type="button" role="option" aria-selected={project.name === selectedProject} onClick={() => handleProjectChange(project)}><Folder size={15} />{project.name}</button>)}
            <button type="button" role="option" aria-selected={!selectedProject} onClick={() => handleProjectChange({ name: 'No Project' })}><Folder size={15} />No Project</button>
          </div>}
        </div>}
        <div className="composer">
          <input
            type="text"
            className="input-box"
            placeholder="Ask anything, @ to mention, / for actions"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              keepBottomAnchored();
            }}
            onFocus={keepBottomAnchored}
            onKeyDown={handleComposerKeyDown}
            disabled={sending || !desktopConversationId}
          />
          {visibleSlashCommands.length > 0 && <div className="slash-menu" role="listbox" aria-label="Actions">
            {visibleSlashCommands.map((command, index) => (<React.Fragment key={command.name}>
              {index === builtinSlashCommands.length && <div className="slash-section-label">Skills</div>}
              <button
                type="button"
                role="option"
                aria-selected={index === slashSelection}
                className={`slash-option${index === slashSelection ? ' is-selected' : ''}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectSlashCommand(command)}
              >
                <span className="slash-command"><span aria-hidden="true">‹›</span>{command.name}</span>
                <span className="slash-description">{command.description}</span>
              </button>
            </React.Fragment>))}
          </div>}
          <div className="composer-footer">
            <span className="disabled-tooltip" data-tooltip="Attachments are unavailable on mobile" tabIndex={0}>
              <button className="composer-add" type="button" disabled aria-label="Attachments are unavailable">
                <Plus size={16} strokeWidth={1.8} />
              </button>
            </span>
            {models.length > 0 && <div className="model-picker" ref={modelPickerRef}>
              <button className="model-trigger" type="button" onClick={() => setModelMenuOpen(open => !open)} onKeyDown={(event) => event.key === 'Escape' && setModelMenuOpen(false)} aria-expanded={modelMenuOpen} aria-haspopup="listbox">
                <span>{selectedModel}</span>
                <ChevronUp size={14} aria-hidden="true" />
              </button>
              {modelMenuOpen && <div className="model-menu" role="listbox" aria-label="Select model">
                {models.map(model => <button key={model} type="button" className={`model-option${model === selectedModel ? ' is-selected' : ''}`} role="option" aria-selected={model === selectedModel} onClick={() => handleModelChange(model)}>
                  {model}
                </button>)}
              </div>}
            </div>}
          </div>
          {submitDisabled ? <span className="disabled-tooltip composer-submit-tooltip" data-tooltip={submitDisabledReason} tabIndex={0}>
            <button className="composer-submit" onClick={handleSend} disabled aria-label={submitDisabledReason}>
              {input.trim() ? <Send size={16} /> : <Mic size={16} />}
            </button>
          </span> : <button className="composer-submit" onClick={handleSend} aria-label="Send message" title="Send message">
            <Send size={16} />
          </button>}
        </div>
        {bridgeError && <div className="bridge-error" role="status">{bridgeError}</div>}
      </div>
    </div>
  );
}
