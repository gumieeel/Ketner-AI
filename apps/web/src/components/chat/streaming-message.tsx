import { Suspense, lazy } from 'react';

const Markdown = lazy(() => import('@/features/chat/markdown/markdown'));

interface StreamingMessageProps {
  content: string;
  isStreaming: boolean;
}

export function StreamingMessage({ content, isStreaming }: StreamingMessageProps) {
  return (
    <div className="relative text-[15px] leading-[26px] text-text [&>*:not(pre):not(table):not(.code-block)]:max-w-[66ch]">
      <Suspense fallback={<p className="whitespace-pre-wrap">{content}</p>}>
        <Markdown content={content} />
      </Suspense>
      {isStreaming && (
        <span className="caret text-accent ml-1" aria-hidden="true" />
      )}
    </div>
  );
}
