import React, { useEffect, useState } from 'react';
import { ChevronLeft, Clock3, Folder } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { requestApi } from '../api';
import { TaskToggle } from '../components/TaskToggle';

export default function ScheduledTaskDetail() {
  const { name } = useParams();
  const navigate = useNavigate();
  const [task, setTask] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    requestApi(`/api/desktop/scheduled-tasks/${encodeURIComponent(name)}`, undefined, 'Scheduled task is unavailable')
      .then(setTask)
      .catch(loadError => setError(loadError.message));
  }, [name]);

  const toggleTask = async () => {
    if (!task || task.enabled === null) return;
    const previous = task;
    setTask(current => ({ ...current, enabled: !current.enabled }));
    try {
      const updatedTask = await requestApi(`/api/desktop/scheduled-tasks/${encodeURIComponent(task.name)}`, {
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
            <div>{event.title}</div>
            <small>Triggered {event.triggeredAt}</small>
          </div>)}
        </section>
      </>}
    </main>
  </div>;
}
