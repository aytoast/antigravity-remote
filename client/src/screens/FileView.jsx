import React, { useEffect, useState } from 'react';
import { ChevronLeft, FileText } from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { apiUrl } from '../api';
import { ChatSkeleton } from '../components/LoadingSkeleton';

const fileName = value => decodeURIComponent(value || '').split(/[\\/]/).pop() || 'File';

export default function FileView() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const requestedPath = searchParams.get('path') || '';
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setFile(null);
    setError('');
    fetch(apiUrl(`/api/threads/${id}/file?path=${encodeURIComponent(requestedPath)}`))
      .then(res => res.json())
      .then(data => {
        if (!data.success) throw new Error(data.error || 'File could not be opened');
        setFile(data.data);
      })
      .catch(loadError => setError(loadError.message));
  }, [id, requestedPath]);

  return <div className="file-page animate-fade-in">
    <nav className="navbar file-navbar">
      <button className="back-button" type="button" onClick={() => navigate(-1)} aria-label="Back to conversation">
        <ChevronLeft size={22} />
      </button>
      <div className="file-heading"><FileText size={17} /><h1>{fileName(file?.path || requestedPath)}</h1></div>
    </nav>
    <main className="file-content">
      {!file && !error && <ChatSkeleton />}
      {error && <div className="bridge-error file-error" role="status">{error}</div>}
      {file && <article className="file-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{file.content}</ReactMarkdown></article>}
    </main>
  </div>;
}
