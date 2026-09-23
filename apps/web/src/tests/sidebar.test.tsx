import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useChat } from '@/features/chat/chat-store';
import type { Message } from '@/features/chat/types';
import { installFakeApi } from './fake-api';
import { renderRoute, resetChat, resetPreferences } from './test-utils';

const DAY_MS = 86_400_000;

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

function message(role: Message['role'], content: string): Message {
  return {
    id: `${role}-1`,
    conversationId: 'conversation-1',
    role,
    content,
    createdAt: isoDaysAgo(0),
    status: 'complete',
  };
}

describe('сайдбар: история диалогов', () => {
  beforeEach(() => {
    resetPreferences();
    resetChat();
  });

  it('разбивает диалоги на группы по датам', async () => {
    const api = installFakeApi();
    api.seed({ title: 'Сегодняшний диалог', updatedAt: isoDaysAgo(0) });
    api.seed({ title: 'Вчерашний диалог', updatedAt: isoDaysAgo(1) });
    api.seed({ title: 'Старый диалог', updatedAt: isoDaysAgo(30) });
    renderRoute('/chat');

    expect(await screen.findByRole('link', { name: 'Сегодняшний диалог' })).toBeInTheDocument();
    expect(screen.getByText('Сегодня')).toBeInTheDocument();
    expect(screen.getByText('Вчера')).toBeInTheDocument();
    expect(screen.getByText('Ранее')).toBeInTheDocument();
    // Пустые группы не показываются: в списке нет диалогов за последнюю неделю.
    expect(screen.queryByText('Предыдущие 7 дней')).toBeNull();
  });

  it('ищет диалоги по названию и сообщает, когда ничего не найдено', async () => {
    const api = installFakeApi();
    api.seed({ title: 'Сегодняшний диалог', updatedAt: isoDaysAgo(0) });
    api.seed({ title: 'Вчерашний диалог', updatedAt: isoDaysAgo(1) });
    const user = userEvent.setup();
    renderRoute('/chat');
    await screen.findByRole('link', { name: 'Сегодняшний диалог' });

    const field = screen.getByLabelText('Поиск по чатам');
    await user.type(field, 'Вчерашний');

    expect(screen.getByRole('link', { name: 'Вчерашний диалог' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Сегодняшний диалог' })).toBeNull();

    await user.clear(field);
    await user.type(field, 'такого диалога нет');
    expect(screen.getByText('Ничего не найдено')).toBeInTheDocument();
  });

  it('переименовывает диалог через сервер', async () => {
    const api = installFakeApi();
    api.seed({ title: 'Черновик', updatedAt: isoDaysAgo(0) });
    const user = userEvent.setup();
    renderRoute('/chat');
    await screen.findByRole('link', { name: 'Черновик' });

    await user.click(screen.getByRole('button', { name: 'Переименовать' }));
    const input = screen.getByLabelText('Переименовать');
    await user.clear(input);
    await user.type(input, 'Новое имя');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(await screen.findByRole('link', { name: 'Новое имя' })).toBeInTheDocument();
    expect(useChat.getState().conversations.map((item) => item.title)).toEqual(['Новое имя']);
  });

  it('удаляет диалог после подтверждения', async () => {
    const api = installFakeApi();
    api.seed({ title: 'Ненужный диалог', updatedAt: isoDaysAgo(0) });
    const user = userEvent.setup();
    renderRoute('/chat');
    await screen.findByRole('link', { name: 'Ненужный диалог' });

    await user.click(screen.getByRole('button', { name: 'Удалить' }));
    expect(screen.getByText('Удалить чат?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Удалить' }));

    expect(screen.queryByRole('link', { name: 'Ненужный диалог' })).toBeNull();
    expect(screen.getByText('История пока пуста')).toBeInTheDocument();
    expect(useChat.getState().conversations).toHaveLength(0);
  });

  it('открывает диалог из списка и показывает его сообщения', async () => {
    const api = installFakeApi();
    api.seed({
      title: 'Диалог про код',
      messages: [message('user', 'Покажи пример'), message('assistant', 'Вот пример')],
      updatedAt: isoDaysAgo(0),
    });
    const user = userEvent.setup();
    renderRoute('/chat');

    const link = await screen.findByRole('link', { name: 'Диалог про код' });
    expect(link).toHaveAttribute('href', '/chat/conversation-1');

    await user.click(link);

    expect(await screen.findByText('Покажи пример')).toBeInTheDocument();
    expect(await screen.findByText('Вот пример')).toBeInTheDocument();
    // Диалог открыт как активный: он подсвечен и лежит в ленте целиком.
    expect(useChat.getState().activeId).toBe('conversation-1');
    expect(useChat.getState().messages).toHaveLength(2);
  });

  it('клик на «Новый чат» сбрасывает активный диалог и возвращает на пустой экран', async () => {
    const api = installFakeApi();
    api.seed({
      title: 'Активный чат',
      messages: [message('user', 'Вопрос'), message('assistant', 'Ответ')],
      updatedAt: isoDaysAgo(0),
    });
    const user = userEvent.setup();
    renderRoute('/chat/conversation-1');

    expect(await screen.findByText('Вопрос')).toBeInTheDocument();
    expect(useChat.getState().activeId).toBe('conversation-1');

    await user.click(screen.getByRole('link', { name: 'Новый чат' }));

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Чем помочь сегодня?' }),
    ).toBeInTheDocument();
    expect(useChat.getState().activeId).toBeNull();
    expect(useChat.getState().messages).toHaveLength(0);
  });
});
