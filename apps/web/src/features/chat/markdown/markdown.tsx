import { Fragment, useMemo, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { CodeBlock } from './code-block';
import { parseInline, parseMarkdown, type InlineToken, type TableAlign } from './parse';

const HEADING_CLASSES: Record<number, string> = {
  1: 'mb-2 mt-6 text-lg font-semibold tracking-tight text-text',
  2: 'mb-2 mt-5 text-base font-semibold tracking-tight text-text',
  3: 'mb-2 mt-4 text-sm font-semibold tracking-tight text-text',
  4: 'mb-1 mt-3 text-sm font-semibold text-text',
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
        <code className="rounded-sm border border-stroke bg-surface-2 px-1 py-0.5 font-mono text-[0.9em] text-text">
          {token.text}
        </code>
      );
    case 'link':
      return (
        <a
          href={token.href}
          target="_blank"
          rel="noreferrer"
          className="text-accent underline underline-offset-2 hover:opacity-85 transition-opacity"
        >
          {token.text}
        </a>
      );
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
    'my-2 flex flex-col gap-1 pl-5 marker:text-subtle',
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
    <div className="text-base leading-[27px] text-text">
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'heading':
            return (
              <p key={index} className={cn('first:mt-0', HEADING_CLASSES[block.level])}>
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
                className="my-2 border-l-2 border-accent/50 pl-3 text-muted"
              >
                <Inline text={block.text} />
              </blockquote>
            );
          case 'table':
            return (
              <div
                key={index}
                className="my-3 overflow-x-auto rounded-lg border border-stroke bg-surface"
              >
                <table className="w-full border-collapse text-sm text-text">
                  <thead className="bg-surface-2 border-b border-stroke">
                    <tr>
                      {block.header.map((cell, cellIndex) => (
                        <th
                          key={cellIndex}
                          className={cn(
                            'px-3 py-2 font-semibold text-text text-left',
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
                              'px-3 py-2 align-top text-text',
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
            return <hr key={index} className="my-4 border-stroke" />;
          default:
            return (
              <p key={index} className="my-2 first:mt-0 last:mb-0">
                <Inline text={block.text} />
              </p>
            );
        }
      })}
    </div>
  );
}
