'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github.css';

type Props = { content: string };

export default function ChatMarkdown({ content }: Props) {
  if (!content || content.trim() === '') {
    return <p className="text-gray-500">응답을 불러오는 중...</p>;
  }

  return (
    <div className="prose prose-sm prose-zinc dark:prose-invert max-w-none leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={[
          rehypeRaw,
          rehypeSanitize,
          rehypeHighlight,
        ]}
        components={{
          a: (props) => (
            <a {...props} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 underline" />
          ),
          code: ({ node, inline, className, children, ...props }: any) => {
            const match = /language-(\w+)/.exec(className || '');
            return !inline && match ? (
              <code className={className} {...props}>
                {children}
              </code>
            ) : (
              <code className="px-1 py-0.5 rounded bg-zinc-200 dark:bg-zinc-800 text-sm font-normal" {...props}>
                {children}
              </code>
            );
          },
          pre: (props) => (
            <pre className="rounded-md p-4 overflow-x-auto bg-zinc-950/90 text-zinc-100 font-normal" {...props} />
          ),
          table: (props) => (
            <div className="overflow-x-auto">
              <table {...props} />
            </div>
          ),
          h1: (props) => <h1 className="mt-6 mb-3 font-semibold" {...props} />,
          h2: (props) => <h2 className="mt-6 mb-2 font-semibold" {...props} />,
          h3: (props) => <h3 className="mt-4 mb-2 font-semibold" {...props} />,
          li: (props) => <li className="my-1 font-normal" {...props} />,
          p: (props) => <p className="font-normal" {...props} />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
