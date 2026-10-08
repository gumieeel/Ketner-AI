import { useMemo } from 'react';
import { CopyButton } from '@/components/ui/copy-button';
import { useTranslation } from '@/i18n';
import { highlight, type TokenKind } from './highlight';

const TOKEN_CLASSES: Record<TokenKind, string> = {
  plain: '',
  keyword: 'text-[color:var(--syn-keyword)]',
  string: 'text-[color:var(--syn-string)]',
  comment: 'text-[color:var(--syn-comment)] italic',
  number: 'text-[color:var(--syn-number)]',
  function: 'text-[color:var(--syn-function)]',
  punctuation: 'text-[color:var(--syn-punct)]',
};

interface CodeBlockProps {
  code: string;
  language: string | null;
}

/** Блок кода с подписью языка и кнопкой «Копировать». */
export function CodeBlock({ code, language }: CodeBlockProps) {
  const { t } = useTranslation();
  const tokens = useMemo(() => highlight(code, language), [code, language]);

  return (
    <div className="code-block my-4 overflow-hidden rounded-xl border border-stroke bg-surface shadow-xs">
      <div className="flex h-10 items-center justify-between gap-2 border-b border-stroke bg-surface-2/80 pr-1.5 pl-3.5">
        <span className="flex items-center gap-2 font-mono text-xs text-muted">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-accent/70" />
          {language ?? t('chat.codePlain')}
        </span>
        <CopyButton value={code} label={t('chat.copyCode')} size="sm" />
      </div>
      <pre
        tabIndex={0}
        className="overflow-x-auto p-4 font-mono text-[13px] leading-[22px] text-text focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
      >
        <code>
          {tokens.map((token, index) => (
            <span key={index} className={TOKEN_CLASSES[token.kind]}>
              {token.text}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
