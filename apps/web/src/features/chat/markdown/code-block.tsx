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
    <div className="my-3 overflow-hidden rounded-lg border border-stroke bg-surface">
      <div className="h-9 border-b border-stroke bg-surface-2 px-3 flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-muted">
          {language ?? t('chat.codePlain')}
        </span>
        <CopyButton value={code} label={t('chat.copyCode')} size="sm" />
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[13px] leading-[22px] text-text">
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
