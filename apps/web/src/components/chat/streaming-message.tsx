import { Suspense, lazy } from 'react';

const Markdown = lazy(() => import('@/features/chat/markdown/markdown'));

interface StreamingMessageProps {
  content: string;
  isStreaming: boolean;
}

export function StreamingMessage({ content, isStreaming }: StreamingMessageProps) {
  return (
    <div className="relative text-base leading-[27px] text-text [&>*:not(pre):not(table):not(.code-block)]:max-w-[66ch]">
      <Suspense fallback={<p className="whitespace-pre-wrap">{content}</p>}>
        <Markdown content={content} />
      </Suspense>
      {isStreaming && (
        <span
          className="inline-block w-2 h-4 ml-1 align-middle bg-accent animate-pulse"
          aria-hidden="true"
        />
      )}
    </div>
  );
}
