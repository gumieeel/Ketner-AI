import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAuth } from '@/features/auth/auth-store';
import { useUpgradeModal } from '@/features/billing/upgrade-modal-store';
import { useChat } from '@/features/chat/chat-store';
import {
  defaultCompareModelIds,
  fastestSlot,
  maxCompareModels,
} from '@/features/chat/compare-policy';
import { useCompare } from '@/features/chat/compare-store';
import { DEFAULT_MODELS } from '@/features/chat/can-access-model';
import { installFakeApi } from './fake-api';
import { renderRoute, resetAuth, resetChat, resetPreferences } from './test-utils';

const COMPOSER = 'Спросите что-нибудь…';

function loginAs(plan: 'free' | 'plus' | 'pro' | 'ultra'): void {
  useAuth.setState({
    user: {
      id: 'demo-user',
      email: 'demo@ketner.ai',
      name: 'Демо',
      plan,
      createdAt: new Date().toISOString(),
    },
    token: 'fake.jwt.token',
    status: 'authenticated',
  });
}

describe('правила сравнения на клиенте', () => {
  it('число моделей по тарифам совпадает с сервером', () => {
    expect(maxCompareModels('free')).toBe(0);
    expect(maxCompareModels(undefined)).toBe(0);
    expect(maxCompareModels('plus')).toBe(2);
    expect(maxCompareModels('pro')).toBe(3);
    expect(maxCompareModels('gpt-pro')).toBe(3);
    expect(maxCompareModels('ultra')).toBe(4);
  });

  it('набор по умолчанию: только доступные модели, не больше трёх и не больше тарифа', () => {
    const plus = defaultCompareModelIds(DEFAULT_MODELS, 'plus');
    expect(plus.length).toBeGreaterThanOrEqual(2);
    expect(plus).not.toContain('claude-opus-5.5');
    expect(plus).not.toContain('auto');
    const ultra = defaultCompareModelIds(DEFAULT_MODELS, 'ultra');
    expect(ultra.length).toBeLessThanOrEqual(3);
  });

  it('самый быстрый ответ определяется только при двух и более завершённых', () => {
    const slot = (n: number, latencyMs: number, status: 'done' | 'streaming' = 'done') => ({
      slot: n,
      requestedModelId: 'm',
      modelId: 'm',
      modelName: 'M',
      content: 'x',
      status,
      latencyMs,
    });
    expect(fastestSlot([slot(0, 2000), slot(1, 900)])).toBe(1);
    expect(fastestSlot([slot(0, 2000), slot(1, 900, 'streaming')])).toBeNull();
    expect(fastestSlot([slot(0, 2000)])).toBeNull();
  });
});

describe('сравнение ответов в чате', () => {
  beforeEach(() => {
    resetAuth();
    resetPreferences();
    resetChat();
  });

  it('на Free кнопка с замком открывает переход на Plus, а вопрос уходит обычным запросом', async () => {
    const api = installFakeApi({ reply: 'Обычный ответ', plan: 'free' });
    loginAs('free');
    const user = userEvent.setup();
    renderRoute('/chat');

    const toggle = await screen.findByRole('button', { name: /^Сравнить:.*Plus/ });
    expect(toggle).not.toHaveAttribute('aria-pressed');
    await user.click(toggle);
    expect(useUpgradeModal.getState().isOpen).toBe(true);
    expect(useUpgradeModal.getState().reason).toBe('compare');
    expect(useCompare.getState().enabled).toBe(false);
    useUpgradeModal.getState().close();

    await user.type(await screen.findByLabelText(COMPOSER), 'Привет');
    await user.click(screen.getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(api.completionBodies.length).toBe(1));
    expect(api.compareBodies.length).toBe(0);
  });

  it('на Plus вопрос уходит выбранным моделям, колонки показывают ответы, выбор заменяет ответ', async () => {
    const api = installFakeApi({
      plan: 'plus',
      compareReplies: {
        'ketner-pro': 'Ответ Ketner Pro',
        'claude-haiku-5.5': 'Ответ Haiku',
      },
    });
    loginAs('plus');
    useCompare.setState({ modelIds: ['ketner-pro', 'claude-haiku-5.5'] });
    const user = userEvent.setup();
    renderRoute('/chat');

    const toggle = await screen.findByRole('button', { name: /^Сравнить:/ });
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(window.localStorage.getItem('ketner.compareMode')).toBe('1');
    expect(screen.getByTestId('compare-bar')).toBeInTheDocument();

    await user.type(await screen.findByLabelText(COMPOSER), 'Что лучше?');
    await user.click(screen.getByRole('button', { name: 'Отправить' }));

    await waitFor(() => expect(api.compareBodies.length).toBe(1));
    expect(api.completionBodies.length).toBe(0);
    expect(api.compareBodies[0].modelIds).toEqual(['ketner-pro', 'claude-haiku-5.5']);

    const columns = await screen.findByTestId('compare-columns');
    await waitFor(() => expect(within(columns).getByText('Ответ Ketner Pro')).toBeInTheDocument(), {
      timeout: 10000,
    });
    await waitFor(() => expect(within(columns).getByText('Ответ Haiku')).toBeInTheDocument(), {
      timeout: 10000,
    });
    // Быстрее всех — первая колонка (1.0 с против 1.5 с).
    await waitFor(() => expect(within(columns).getByText('Быстрее всех')).toBeInTheDocument());

    // Сервер сохранил в диалог ответ первой колонки.
    await waitFor(() => expect(useChat.getState().messages.at(-1)?.id).toBe('assistant-1'));
    expect(useChat.getState().messages.at(-1)?.content).toBe('Ответ Ketner Pro');

    // Выбор второй колонки заменяет ответ в диалоге и отправляет на сервер только номер колонки.
    const buttons = await within(columns).findAllByRole('button', { name: 'Выбрать этот ответ' });
    await user.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(api.pickBodies.length).toBe(1));
    expect(api.pickBodies[0]).toEqual({ runId: 'run-1', slot: 1 });
    await waitFor(() => expect(useChat.getState().messages.at(-1)?.content).toBe('Ответ Haiku'));
    expect(useChat.getState().messages.at(-1)?.id).toBe('picked-1');
    expect(useCompare.getState().runs['conversation-1']?.pickedSlot).toBe(1);

    // Свернуть: в ленте остаётся выбранный ответ.
    await user.click(screen.getByRole('button', { name: 'Свернуть сравнение' }));
    expect(screen.queryByTestId('compare-columns')).not.toBeInTheDocument();
    expect(await screen.findByText('Ответ Haiku', {}, { timeout: 10000 })).toBeInTheDocument();
  });

  it('колонка с исчерпанным лимитом показывает причину, остальные отвечают', async () => {
    installFakeApi({
      plan: 'plus',
      compareReplies: { 'claude-haiku-5.5': 'Ответ Haiku' },
      compareFailModels: ['ketner-pro'],
    });
    loginAs('plus');
    useCompare.setState({ enabled: true, modelIds: ['ketner-pro', 'claude-haiku-5.5'] });
    const user = userEvent.setup();
    renderRoute('/chat');

    await user.type(await screen.findByLabelText(COMPOSER), 'Вопрос');
    await user.click(screen.getByRole('button', { name: 'Отправить' }));

    const columns = await screen.findByTestId('compare-columns');
    expect(
      await within(columns).findByText('Лимит модели ketner-pro исчерпан'),
    ).toBeInTheDocument();
    await waitFor(() => expect(within(columns).getByText('Ответ Haiku')).toBeInTheDocument(), {
      timeout: 10000,
    });
    // В диалоге сохранён ответ колонки без ошибки.
    await waitFor(() => expect(useChat.getState().messages.at(-1)?.content).toBe('Ответ Haiku'));
  });

  it('с одной моделью отправка заблокирована и просит выбрать минимум две', async () => {
    const api = installFakeApi({ plan: 'plus' });
    loginAs('plus');
    useCompare.setState({ enabled: true, modelIds: ['ketner-pro'] });
    const user = userEvent.setup();
    renderRoute('/chat');

    expect(await screen.findByText('Выберите минимум 2 модели')).toBeInTheDocument();
    await user.type(await screen.findByLabelText(COMPOSER), 'Вопрос');
    expect(screen.getByRole('button', { name: 'Отправить' })).toBeDisabled();
    expect(api.compareBodies.length).toBe(0);
  });

  it('модели из чужого тарифа отсеиваются: на Plus нельзя оставить Opus', async () => {
    installFakeApi({ plan: 'plus' });
    loginAs('plus');
    useCompare.setState({
      enabled: true,
      modelIds: ['claude-opus-5.5', 'ketner-pro', 'claude-haiku-5.5'],
    });
    renderRoute('/chat');

    const bar = await screen.findByTestId('compare-bar');
    expect(within(bar).queryByText('Claude Opus 5.5')).not.toBeInTheDocument();
    expect(within(bar).getByText('Ketner Pro')).toBeInTheDocument();
    expect(within(bar).getByText('Claude Haiku 5.5')).toBeInTheDocument();
  });
});
