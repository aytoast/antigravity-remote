import React, { useEffect, useState } from 'react';
import { ChevronLeft, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { requestApi } from '../api';
import { TaskToggle } from '../components/TaskToggle';

export default function ScheduledTasks() {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');

  const loadTasks = async () => {
    setLoading(true);
    setError('');
    try {
      setTasks(await requestApi('/api/desktop/scheduled-tasks', undefined, 'Scheduled Tasks is unavailable'));
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadTasks(); }, []);

  const toggleTask = async (task) => {
    if (task.enabled === null) return;
    const previous = tasks;
    setTasks(current => current.map(item => item.name === task.name ? { ...item, enabled: !item.enabled } : item));
    try {
      const updatedTasks = await requestApi(`/api/desktop/scheduled-tasks/${encodeURIComponent(task.name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !task.enabled })
      }, 'Task state did not update');
      setTasks(updatedTasks);
    } catch (toggleError) {
      setTasks(previous);
      setError(toggleError.message);
    }
  };

  const visibleTasks = tasks.filter(task => `${task.name} ${task.schedule}`.toLowerCase().includes(query.toLowerCase()));

  return <div className="tasks-page animate-fade-in">
    <nav className="navbar">
      <button className="back-button" type="button" onClick={() => navigate('/')} aria-label="Back to conversations">
        <ChevronLeft size={22} />
      </button>
      <h1>Scheduled Tasks</h1>
    </nav>
    <main className="tasks-content">
      <label className="task-search">
        <Search size={16} aria-hidden="true" />
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search tasks..." aria-label="Search tasks" />
      </label>
      {error && <div className="tasks-error" role="status">{error}</div>}
      {loading ? <div className="tasks-skeleton" aria-busy="true"><span /><span /><span /><span /><span /></div> : <div className="tasks-list">
        {visibleTasks.map(task => <div className="task-row" key={task.name} role="button" tabIndex={0} onClick={() => navigate(`/tasks/${encodeURIComponent(task.name)}`)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') navigate(`/tasks/${encodeURIComponent(task.name)}`); }}>
          <div className="task-copy"><div>{task.name}</div><small>{task.schedule}</small></div>
          <TaskToggle task={task} onToggle={event => { event.stopPropagation(); toggleTask(task); }} />
        </div>)}
      </div>}
    </main>
  </div>;
}
