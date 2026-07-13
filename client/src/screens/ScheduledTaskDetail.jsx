import React, { useEffect, useState } from 'react';
import { ChevronLeft, Clock3, Folder } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { requestApi } from '../api';
import { TaskToggle } from '../components/TaskToggle';
import { ProviderBadge } from '../components/ProviderBadge';

const formatTriggeredAt = value => {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return value;
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
};

export default function ScheduledTaskDetail() {
  const { provider = 'antigravity', name } = useParams();
  const navigate = useNavigate();
  const [task, setTask] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const endpoint = provider === 'codex'
      ? `/api/codex/scheduled-tasks/${encodeURIComponent(name)}`
      : `/api/desktop/scheduled-tasks/${encodeURIComponent(name)}`;
    requestApi(endpoint, undefined, 'Scheduled task is unavailable')
      .then(setTask)
      .catch(loadError => setError(loadError.message));
  }, [name, provider]);

  const toggleTask = async () => {
    if (!task || task.enabled === null) return;
    const previous = task;
    setTask(current => ({ ...current, enabled: !current.enabled }));
    try {
      const endpoint = provider === 'codex'
        ? `/api/codex/scheduled-tasks/${encodeURIComponent(task.id)}`
        : `/api/desktop/scheduled-tasks/${encodeURIComponent(task.name)}`;
      const updatedTask = await requestApi(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !task.enabled })
      }, 'Task state did not update');
      setTask(updatedTask);
    } catch (toggleError) {
      setTask(previous);
      setError(toggleError.message);
    }
  };

  return <div className="task-detail-page animate-fade-in">
    <nav className="navbar">
      <button className="back-button" type="button" onClick={() => navigate('/tasks')} aria-label="Back to scheduled tasks"><ChevronLeft size={22} /></button>
      <h1>{task?.name || name}</h1>
      <ProviderBadge provider={provider} compact />
      {task && <TaskToggle task={task} onToggle={toggleTask} className="detail-toggle" />}
    </nav>
    <main className="task-detail-content">
      {error && <div className="tasks-error" role="status">{error}</div>}
      {!task && !error && <div className="task-detail-skeleton"><span /><span /><span /></div>}
      {task && <>
        {task.workspace && <div className="task-workspace"><Folder size={16} /><span>{task.workspace}</span></div>}
        <section className="task-detail-section">
          <h2>Prompt</h2>
          <pre className="task-prompt">{task.prompt}</pre>
        </section>
        <section className="task-detail-section">
          <h2>Schedule</h2>
          <div className="task-schedule"><Clock3 size={15} /><span>{task.schedule}</span></div>
        </section>
        <section className="task-detail-section task-events">
          <h2>Events</h2>
          {task.events.map((event, index) => <div className="task-event" key={`${event.title}-${event.triggeredAt}-${index}`}>
            <div className="task-event-heading"><span>{event.title}</span>{event.workspace && <small>{event.workspace}</small>}</div>
            <small>Triggered {formatTriggeredAt(event.triggeredAt)}</small>
          </div>)}
        </section>
      </>}
    </main>
  </div>;
}
