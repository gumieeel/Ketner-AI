import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FeedbackButtons } from '@/components/chat/feedback-buttons';
import { useChat } from '@/features/chat/chat-store';
import type { Message } from '@/features/chat/types';
import * as api from '@/features/chat/api';

vi.mock('@/features/chat/api', () => ({
  sendFeedback: vi.fn().mockResolvedValue({ success: true }),
}));

describe('FeedbackButtons: лайки и дизлайки ответов', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChat.setState({
      activeId: 'conv-123',
      messages: [],
      conversationMessages: {},
    });
  });

  const sampleMessage: Message = {
    id: 'msg-1',
    conversationId: 'conv-123',
    role: 'assistant',
    content: 'Отличный ответ',
    createdAt: new Date().toISOString(),
    status: 'complete',
    modelId: 'gpt-6.1-sol',
  };

  it('отображает кнопки лайка и дизлайка', () => {
    render(<FeedbackButtons message={sampleMessage} />);
    expect(screen.getByRole('button', { name: 'Хороший ответ' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Плохой ответ' })).toBeInTheDocument();
  });

  it('при клике на лайк отправляет feedback и обновляет статус', async () => {
    const user = userEvent.setup();
    useChat.setState({
      activeId: 'conv-123',
      messages: [sampleMessage],
    });

    render(<FeedbackButtons message={sampleMessage} />);
    const likeBtn = screen.getByRole('button', { name: 'Хороший ответ' });
    await user.click(likeBtn);

    expect(api.sendFeedback).toHaveBeenCalledWith({
      conversationId: 'conv-123',
      messageId: 'msg-1',
      rating: 'like',
      modelId: 'gpt-6.1-sol',
    });

    const currentMsg = useChat.getState().messages.find((m) => m.id === 'msg-1');
    expect(currentMsg?.feedback).toBe('like');
    expect(screen.getByText('Спасибо за оценку!')).toBeInTheDocument();
  });

  it('при клике на дизлайк отправляет feedback с rating=dislike', async () => {
    const user = userEvent.setup();
    useChat.setState({
      activeId: 'conv-123',
      messages: [sampleMessage],
    });

    render(<FeedbackButtons message={sampleMessage} />);
    const dislikeBtn = screen.getByRole('button', { name: 'Плохой ответ' });
    await user.click(dislikeBtn);

    expect(api.sendFeedback).toHaveBeenCalledWith({
      conversationId: 'conv-123',
      messageId: 'msg-1',
      rating: 'dislike',
      modelId: 'gpt-6.1-sol',
    });

    const currentMsg = useChat.getState().messages.find((m) => m.id === 'msg-1');
    expect(currentMsg?.feedback).toBe('dislike');
  });

  it('повторный клик по активному лайку сбрасывает оценку (toggle)', async () => {
    const user = userEvent.setup();
    const likedMessage: Message = { ...sampleMessage, feedback: 'like' };
    useChat.setState({
      activeId: 'conv-123',
      messages: [likedMessage],
    });

    render(<FeedbackButtons message={likedMessage} />);
    const likeBtn = screen.getByRole('button', { name: 'Хороший ответ' });
    await user.click(likeBtn);

    expect(api.sendFeedback).toHaveBeenCalledWith({
      conversationId: 'conv-123',
      messageId: 'msg-1',
      rating: null,
      modelId: 'gpt-6.1-sol',
    });

    const currentMsg = useChat.getState().messages.find((m) => m.id === 'msg-1');
    expect(currentMsg?.feedback).toBeUndefined();
  });

  it('блокирует кнопки, если передан флаг disabled', async () => {
    const user = userEvent.setup();
    render(<FeedbackButtons message={sampleMessage} disabled={true} />);

    const likeBtn = screen.getByRole('button', { name: 'Хороший ответ' });
    expect(likeBtn).toBeDisabled();
    await user.click(likeBtn);

    expect(api.sendFeedback).not.toHaveBeenCalled();
  });
});
