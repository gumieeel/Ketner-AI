import { Fragment, useMemo, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { CodeBlock } from './code-block';
import { parseInline, parseMarkdown, type InlineToken, type TableAlign } from './parse';

const HEADING_CLASSES: Record<number, string> = {
  1: 'mb-2 mt-4 text-xl font-semibold',
  2: 'mb-2 mt-4 text-lg font-semibold',
  3: 'mb-2 mt-3 text-base font-semibold',
  4: 'mb-1 mt-3 text-sm font-semibold',
  5: 'mb-1 mt-3 text-sm font-semibold',
  6: 'mb-1 mt-3 text-xs font-semibold uppercase tracking-wide',
};

const ALIGN_CLASSES: Record<TableAlign, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
};

const CELL_BORDER = 'border-b border-zinc-200 px-2 py-1 dark:border-zinc-700';

function toInlineNode(token: InlineToken): ReactNode {
  switch (token.kind) {
    case 'bold':
      return <strong className="font-semibold">{token.text}</strong>;
    case 'italic':
      return <em>{token.text}</em>;
    case 'strike':
      return <s>{token.text}</s>;
    case 'code':
      return (
        <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.9em] dark:bg-zinc-700">
          {token.text}
        </code>
      );
    case 'link':
      return (
        <a
          href={token.href}
          target="_blank"
          rel="noreferrer"
          className="text-brand-700 underline dark:text-brand-300"
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
  const className = cn('my-2 flex flex-col gap-1 pl-5', ordered ? 'list-decimal' : 'list-disc');
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
    <div className="text-sm leading-relaxed text-zinc-800 dark:text-zinc-100">
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
                className="my-2 border-l-2 border-zinc-300 pl-3 text-zinc-600 dark:border-zinc-600 dark:text-zinc-300"
              >
                <Inline text={block.text} />
              </blockquote>
            );
          case 'table':
            return (
              <div key={index} className="my-3 overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      {block.header.map((cell, cellIndex) => (
                        <th
                          key={cellIndex}
                          className={cn(
                            CELL_BORDER,
                            'font-semibold',
                            ALIGN_CLASSES[block.align[cellIndex]],
                          )}
                        >
                          <Inline text={cell} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {row.map((cell, cellIndex) => (
                          <td
                            key={cellIndex}
                            className={cn(
                              CELL_BORDER,
                              'align-top',
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
            return <hr key={index} className="my-3 border-zinc-200 dark:border-zinc-700" />;
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
