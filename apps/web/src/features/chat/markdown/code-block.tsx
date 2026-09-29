import { useMemo } from 'react';
import { CopyButton } from '@/components/ui/copy-button';
import { useTranslation } from '@/i18n';
import { highlight, type TokenKind } from './highlight';

const TOKEN_CLASSES: Record<TokenKind, string> = {
  plain: '',
  keyword: 'text-violet-700 dark:text-violet-300',
  string: 'text-emerald-700 dark:text-emerald-300',
  comment: 'text-zinc-500 italic dark:text-zinc-400',
  number: 'text-sky-700 dark:text-sky-300',
  function: 'text-brand-700 dark:text-brand-300',
  punctuation: 'text-zinc-500 dark:text-zinc-400',
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
    <div className="my-3 overflow-hidden rounded-md border border-stroke bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-stroke px-3 py-1.5">
        <span className="text-xs text-muted">{language ?? t('chat.codePlain')}</span>
        <CopyButton value={code} label={t('chat.copyCode')} size="sm" />
      </div>
      <pre className="overflow-x-auto p-3 text-sm leading-[22px] text-text">
        <code className="font-mono">
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
