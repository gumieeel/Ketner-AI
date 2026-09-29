import { useEffect, useRef, useState } from 'react';
import { CheckIcon, CopyIcon } from '@/components/icons';
import { copyText } from '@/lib/clipboard';
import { useTranslation } from '@/i18n';
import { IconButton } from './icon-button';

const FEEDBACK_MS = 1600;

interface CopyButtonProps {
  /** Текст, который попадёт в буфер обмена. */
  value: string;
  label: string;
  size?: 'sm' | 'md';
  className?: string;
}

/** Кнопка копирования с подтверждением: состояние сбрасывается само. */
export function CopyButton({ value, label, size = 'md', className }: CopyButtonProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
    },
    [],
  );

  const onClick = async (): Promise<void> => {
    if (!(await copyText(value))) {
      return;
    }
    setCopied(true);
    if (timer.current !== null) {
      clearTimeout(timer.current);
    }
    timer.current = setTimeout(() => setCopied(false), FEEDBACK_MS);
  };

  return (
    <IconButton
      label={copied ? t('chat.copied') : label}
      size={size}
      className={className}
      onClick={onClick}
    >
      {copied ? <CheckIcon className="text-accent" /> : <CopyIcon />}
    </IconButton>
  );
}
