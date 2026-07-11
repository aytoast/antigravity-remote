import React from 'react';

const Line = ({ className = '' }) => <span className={`skeleton-line ${className}`} />;

export function HomeSkeleton() {
  return <div className="skeleton-page" aria-busy="true" aria-label="Loading conversations">
    <section className="skeleton-section">
      <Line className="skeleton-heading" />
      <div className="skeleton-list-row"><Line className="skeleton-title" /><Line className="skeleton-time" /></div>
      <div className="skeleton-list-row"><Line className="skeleton-title short" /><Line className="skeleton-time" /></div>
    </section>
    <section className="skeleton-section">
      <Line className="skeleton-heading" />
      <div className="skeleton-project-row"><Line className="skeleton-icon" /><Line className="skeleton-title medium" /></div>
      <div className="skeleton-project-row"><Line className="skeleton-icon" /><Line className="skeleton-title" /></div>
      <div className="skeleton-project-row"><Line className="skeleton-icon" /><Line className="skeleton-title short" /></div>
    </section>
    <section className="skeleton-section">
      <Line className="skeleton-heading" />
      <div className="skeleton-list-row"><Line className="skeleton-title medium" /><Line className="skeleton-time" /></div>
      <div className="skeleton-list-row"><Line className="skeleton-title" /><Line className="skeleton-time" /></div>
    </section>
  </div>;
}

export function FolderSkeleton() {
  return <div className="skeleton-page skeleton-folder" aria-busy="true" aria-label="Loading conversations">
    {[0, 1, 2, 3, 4].map(index => <div className="skeleton-project-row" key={index}>
      <Line className="skeleton-icon" />
      <div className="skeleton-row-copy"><Line className={index % 2 ? 'skeleton-title short' : 'skeleton-title'} /><Line className="skeleton-subtitle" /></div>
    </div>)}
  </div>;
}

export function ChatSkeleton() {
  return <div className="chat-loading" aria-busy="true" aria-label="Loading conversation">
    <Line className="skeleton-message user" />
    <Line className="skeleton-message ai wide" />
    <Line className="skeleton-message ai" />
    <Line className="skeleton-message user short" />
  </div>;
}
