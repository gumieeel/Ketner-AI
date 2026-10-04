import { useState } from 'react';
import { ThumbsUpIcon, ThumbsDownIcon } from '@/components/icons';
import { IconButton } from '@/components/ui/icon-button';
import { useChat } from '@/features/chat/chat-store';
import type { Message } from '@/features/chat/types';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

interface FeedbackButtonsProps {
  message: Message;
  disabled?: boolean;
}

/**
 * Кнопки оценки ответа ассистента: лайк и дизлайк.
 * Оценка фиксируется на сообщении и передаётся на сервер для анализа качества
 * и автоматической эскалации запросов при деградации лёгких моделей.
 */
export function FeedbackButtons({ message, disabled = false }: FeedbackButtonsProps) {
  const { t } = useTranslation();
  const sendFeedback = useChat((state) => state.sendFeedback);
  const [justSubmitted, setJustSubmitted] = useState<string | null>(null);

  const isLiked = message.feedback === 'like';
  const isDisliked = message.feedback === 'dislike';

  const handleLike = () => {
    if (disabled) return;
    void sendFeedback(message.id, 'like');
    setJustSubmitted('like');
    setTimeout(() => setJustSubmitted(null), 2500);
  };

  const handleDislike = () => {
    if (disabled) return;
    void sendFeedback(message.id, 'dislike');
    setJustSubmitted('dislike');
    setTimeout(() => setJustSubmitted(null), 2500);
  };

  return (
    <div className="flex items-center gap-0.5" role="group" aria-label="Оценка ответа">
      <IconButton
        label={t('chat.like')}
        size="sm"
        disabled={disabled}
        onClick={handleLike}
        className={cn(
          'transition-colors',
          isLiked
            ? 'text-emerald-500 bg-emerald-500/10 hover:bg-emerald-500/20 hover:text-emerald-400'
            : 'text-muted hover:text-text hover:bg-surface-raised',
        )}
      >
        <ThumbsUpIcon className={cn('size-3.5', isLiked && 'fill-current')} />
      </IconButton>

      <IconButton
        label={t('chat.dislike')}
        size="sm"
        disabled={disabled}
        onClick={handleDislike}
        className={cn(
          'transition-colors',
          isDisliked
            ? 'text-red-500 bg-red-500/10 hover:bg-red-500/20 hover:text-red-400'
            : 'text-muted hover:text-text hover:bg-surface-raised',
        )}
      >
        <ThumbsDownIcon className={cn('size-3.5', isDisliked && 'fill-current')} />
      </IconButton>

      {justSubmitted && (
        <span className="ml-1 text-[11px] font-medium text-muted transition-opacity animate-fade-in">
          {t('chat.feedbackSaved')}
        </span>
      )}
    </div>
  );
}
