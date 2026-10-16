import { Fragment, useMemo, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { safeHref } from '@/lib/safe-url';
import { CodeBlock } from './code-block';
import { parseInline, parseMarkdown, type InlineToken, type TableAlign } from './parse';

const HEADING_CLASSES: Record<number, string> = {
  1: 'mb-3 mt-7 text-xl font-semibold leading-8 tracking-tight text-text',
  2: 'mb-2.5 mt-6 text-lg font-semibold leading-7 tracking-tight text-text',
  3: 'mb-2 mt-5 text-base font-semibold tracking-tight text-text',
  4: 'mb-1.5 mt-4 text-[15px] font-semibold text-text',
  5: 'mb-1 mt-3 text-sm font-semibold text-text',
  6: 'mb-1 mt-3 text-xs font-semibold uppercase tracking-wider text-muted',
};

const ALIGN_CLASSES: Record<TableAlign, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
};

function toInlineNode(token: InlineToken): ReactNode {
  switch (token.kind) {
    case 'bold':
      return <strong className="font-semibold text-text">{token.text}</strong>;
    case 'italic':
      return <em>{token.text}</em>;
    case 'strike':
      return <s>{token.text}</s>;
    case 'code':
      return (
        <code className="rounded-md border border-stroke bg-surface-2 px-1.5 py-0.5 font-mono text-[0.88em] break-words text-text">
          {token.text}
        </code>
      );
    case 'link': {
      const href = safeHref(token.href);
      // Опасная схема (javascript:, data: …) — показываем просто текст, без ссылки.
      if (!href) return token.text;
      return (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="text-accent underline decoration-accent/40 underline-offset-[3px] transition-colors hover:decoration-accent"
        >
          {token.text}
        </a>
      );
    }
    default:
      return token.text;
  }
}

/** Разметка внутри строки: жирный, курсив, код, ссылки. */
function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((token, index) => (
        <Fragment key={index}>{toInlineNode(token)}</Fragment>
      ))}
    </>
  );
}

function MarkdownList({ ordered, items }: { ordered: boolean; items: string[] }) {
  const className = cn(
    'my-3 flex max-w-[68ch] flex-col gap-1.5 pl-6 marker:text-accent/70',
    ordered ? 'list-decimal' : 'list-disc',
  );
  const content = items.map((item, index) => (
    <li key={index}>
      <Inline text={item} />
    </li>
  ));

  return ordered ? (
    <ol className={className}>{content}</ol>
  ) : (
    <ul className={className}>{content}</ul>
  );
}

/**
 * Рендер ответа ассистента.
 *
 * Компонент загружается лениво (см. assistant-message.tsx): парсер и подсветка
 * не нужны, пока в диалоге нет ни одного ответа.
 */
export default function Markdown({ content }: { content: string }) {
  const blocks = useMemo(() => parseMarkdown(content), [content]);

  return (
    <div className="text-base leading-7 text-text">
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'heading':
            return (
              <p key={index} className={cn('max-w-[68ch] first:mt-0', HEADING_CLASSES[block.level])}>
                <Inline text={block.text} />
              </p>
            );
          case 'code':
            return <CodeBlock key={index} code={block.code} language={block.language} />;
          case 'list':
            return <MarkdownList key={index} ordered={block.ordered} items={block.items} />;
          case 'quote':
            return (
              <blockquote
                key={index}
                className="my-3 max-w-[68ch] rounded-r-lg border-l-2 border-accent/50 bg-surface-2/40 py-1.5 pr-3 pl-4 text-muted"
              >
                <Inline text={block.text} />
              </blockquote>
            );
          case 'table':
            return (
              <div
                key={index}
                className="my-4 overflow-x-auto rounded-xl border border-stroke bg-surface shadow-xs"
              >
                <table className="w-full border-collapse text-sm text-text">
                  <thead className="border-b border-stroke bg-surface-2/80">
                    <tr>
                      {block.header.map((cell, cellIndex) => (
                        <th
                          key={cellIndex}
                          className={cn(
                            'px-3.5 py-2.5 text-left font-semibold whitespace-nowrap text-text',
                            ALIGN_CLASSES[block.align[cellIndex]],
                          )}
                        >
                          <Inline text={cell} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stroke">
                    {block.rows.map((row, rowIndex) => (
                      <tr key={rowIndex} className="transition-colors hover:bg-surface-2/40">
                        {row.map((cell, cellIndex) => (
                          <td
                            key={cellIndex}
                            className={cn(
                              'px-3.5 py-2.5 align-top text-text',
                              ALIGN_CLASSES[block.align[cellIndex]],
                            )}
                          >
                            <Inline text={cell} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case 'divider':
            return <hr key={index} className="my-6 border-stroke" />;
          default:
            return (
              <p key={index} className="my-3 max-w-[68ch] first:mt-0 last:mb-0">
                <Inline text={block.text} />
              </p>
            );
        }
      })}
    </div>
  );
}
