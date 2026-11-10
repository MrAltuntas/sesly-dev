import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownBlockProps {
  content: string;
}

/**
 * Renders backend-delivered markdown (the legal pages) in the site's dark
 * murekkep look. Styles live in index.css under `.md`.
 */
export const MarkdownBlock: React.FC<MarkdownBlockProps> = ({ content }) => (
  <article className="md">
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
  </article>
);

export default MarkdownBlock;
