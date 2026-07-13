export function TaskToggle({ task, onToggle, className = '' }) {
  if (task.enabled === null) {
    return <span className="disabled-tooltip" data-tooltip="Desktop task state is unavailable while desktop is closed" tabIndex={0}>
      <button className={`task-toggle ${className}`.trim()} type="button" role="switch" disabled aria-label={`${task.name} state unavailable while desktop is closed`}><span /></button>
    </span>;
  }

  return <button className={`task-toggle${task.enabled ? ' is-enabled' : ''} ${className}`.trim()} type="button" role="switch" aria-checked={task.enabled} aria-label={`${task.enabled ? 'Disable' : 'Enable'} ${task.name}`} onClick={onToggle}>
    <span />
  </button>;
}
