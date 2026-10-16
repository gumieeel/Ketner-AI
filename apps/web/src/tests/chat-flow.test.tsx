import { act } from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAuth } from '@/features/auth/auth-store';
import { useChat } from '@/features/chat/chat-store';
import { useUpgradeModal } from '@/features/billing/upgrade-modal-store';
import { usePreferences } from '@/features/preferences/preferences-store';
import type { Message } from '@/features/chat/types';
import { installFakeApi } from './fake-api';
import { renderRoute, resetAuth, resetChat, resetPreferences } from './test-utils';

const COMPOSER = 'Спросите что-нибудь…';
const SEND = 'Отправить';
const STOP = 'Остановить';
const EMPTY_TITLE = 'С чего начнём?';

function setupChat(): UserEvent {
  const user = userEvent.setup();
  renderRoute('/chat');
  return user;
}

async function sendMessage(user: UserEvent, text: string): Promise<void> {
  const field = await screen.findByLabelText(COMPOSER);
  await user.type(field, text);
  await user.click(screen.getByRole('button', { name: SEND }));
}

/** Текст последнего ответа ассистента — так читают ленту сами тесты. */
function lastAssistant(): Message {
  const messages = useChat.getState().messages;
  return messages[messages.length - 1];
}

describe('чат: отправка, стриминг и управление ответом', () => {
  beforeEach(() => {
    resetAuth();
    resetPreferences();
    resetChat();
  });

  it('отправляет сообщение, создаёт диалог и показывает потоковый ответ', async () => {
    const api = installFakeApi({ reply: 'Привет от Ketner AI' });
    const user = setupChat();

    await sendMessage(user, 'Как дела?');

    expect(await screen.findAllByText('Как дела?')).not.toHaveLength(0);
    expect(
      await screen.findByText('Привет от Ketner AI', {}, { timeout: 10000 }),
    ).toBeInTheDocument();
    // Ответ получает идентификатор с сервера: сохранённое сообщение и то, что
    // видно в ленте, — одна и та же сущность.
    expect(lastAssistant().id).toBe('assistant-1');

    // Диалог создан на сервере и получил адрес: на него ведёт ссылка в сайдбаре.
    await waitFor(() => expect(useChat.getState().activeId).toBe('conversation-1'));
    expect(screen.getByRole('link', { name: 'Как дела?' })).toHaveAttribute(
      'href',
      '/chat/conversation-1',
    );
    expect(useChat.getState().draft).toBe('');
    expect(useChat.getState().messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
    ]);

    // Контракт с сервером: уходит история целиком, а не одно сообщение.
    expect(api.completions).toBe(1);
    const body = api.completionBodies[0];
    expect(body.conversationId).toBe('conversation-1');
    expect(body.modelId).toBe('auto');
    expect(body.language).toBe('ru');
    expect((body.messages as Message[]).map((message) => message.content)).toEqual(['Как дела?']);
  });

  it('показывает индикатор «думает…», пока ответа нет', async () => {
    installFakeApi();
    renderRoute('/chat');
    await screen.findByRole('heading', { level: 2, name: EMPTY_TITLE });

    await act(async () => {
      useChat.setState({
        messages: [
          {
            id: 'assistant-pending',
            conversationId: 'conversation-1',
            role: 'assistant',
            content: '',
            createdAt: new Date().toISOString(),
            status: 'pending',
            modelId: 'ketner-mini',
          },
        ],
      });
    });

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Готовлю ответ…');
  });

  it('останавливает генерацию и сохраняет пришедшую часть ответа', async () => {
    const reply = 'раз два три четыре пять шесть семь восемь девять десять';
    installFakeApi({ reply, chunkDelayMs: 1000 });
    const user = setupChat();

    await sendMessage(user, 'Длинный ответ');
    await waitFor(() => expect(lastAssistant().content).not.toBe(''));

    await user.click(await screen.findByRole('button', { name: STOP }));

    await waitFor(() => expect(useChat.getState().streaming).toBe(false));
    const assistant = lastAssistant();
    expect(assistant.content).not.toBe('');
    // Остановка — не ошибка: остаётся префикс ответа, как в настоящем ChatGPT.
    expect(reply.startsWith(assistant.content)).toBe(true);
    expect(assistant.content.trim().length).toBeLessThan(reply.length);
    expect(assistant.status).toBe('complete');
    expect(screen.getByRole('button', { name: SEND })).toBeInTheDocument();
  });

  it('показывает ошибку генерации и повторяет запрос по кнопке', async () => {
    const api = installFakeApi({ reply: 'Ответ со второй попытки', failTimes: 1 });
    const user = setupChat();

    await sendMessage(user, 'Сломайся');

    expect(await screen.findByText('Не удалось получить ответ')).toBeInTheDocument();
    expect(lastAssistant().status).toBe('error');
    await waitFor(() => expect(useChat.getState().streaming).toBe(false));

    const retryBtn = await screen.findByRole('button', { name: 'Повторить' });
    await user.click(retryBtn);

    expect(
      await screen.findByText('Ответ со второй попытки', {}, { timeout: 8000 }),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Не удалось получить ответ')).toBeNull());
    expect(api.completions).toBe(2);
  });

  it('перегенерация заменяет последний ответ', async () => {
    const api = installFakeApi({ replies: ['Первый ответ', 'Второй ответ'] });
    const user = setupChat();

    await sendMessage(user, 'Вопрос');
    expect(await screen.findByText('Первый ответ')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Сгенерировать заново' }));

    expect(await screen.findByText('Второй ответ')).toBeInTheDocument();
    expect(screen.queryByText('Первый ответ')).toBeNull();
    expect(useChat.getState().messages).toHaveLength(2);
    expect(api.completions).toBe(2);
  });

  it('правка сообщения обрезает ленту и запускает новый ответ', async () => {
    const api = installFakeApi({ replies: ['Первый ответ', 'Второй ответ'] });
    const user = setupChat();

    await sendMessage(user, 'Первый вопрос');
    expect(await screen.findByText('Первый ответ')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Редактировать сообщение' }));
    const editor = screen.getByLabelText('Редактировать сообщение');
    await user.clear(editor);
    await user.type(editor, 'Уточнённый вопрос');
    await user.click(screen.getByRole('button', { name: 'Сохранить и отправить' }));

    expect(await screen.findByText('Второй ответ')).toBeInTheDocument();
    expect(screen.queryByText('Первый ответ')).toBeNull();
    // Заголовок диалога в шапке и сайдбаре сервер не меняет: важно, что в ленте
    // осталось только новое сообщение.
    const list = screen.getByRole('main');
    expect(within(list).queryByText('Первый вопрос')).toBeNull();
    expect(within(list).getByText('Уточнённый вопрос')).toBeInTheDocument();
    expect(useChat.getState().messages.map((message) => message.content)).toEqual([
      'Уточнённый вопрос',
      'Второй ответ',
    ]);
    // Правка переписывает историю: сервер получает уже изменённый контекст.
    const body = api.completionBodies[1];
    expect((body.messages as Message[]).map((message) => message.content)).toEqual([
      'Уточнённый вопрос',
    ]);
  });

  it('переключатель модели меняет модель в запросе', async () => {
    const api = installFakeApi({ reply: 'Готово', plan: 'ultra' });
    useAuth.setState({
      user: {
        id: 'demo-user',
        email: 'demo@ketner.ai',
        name: 'Демо Пользователь',
        plan: 'ultra',
        createdAt: new Date().toISOString(),
      },
      token: 'fake.jwt.token',
      status: 'authenticated',
    });
    const user = setupChat();
    await screen.findByRole('heading', { level: 2, name: EMPTY_TITLE });

    await user.click(screen.getByRole('button', { name: 'Выбрать модель' }));
    await user.click(await screen.findByRole('option', { name: /Ketner Pro/ }));
    expect(screen.getByRole('button', { name: 'Выбрать модель' })).toHaveTextContent(/Ketner Pro/);

    await sendMessage(user, 'Вопрос');
    expect(await screen.findByText('Готово')).toBeInTheDocument();
    expect(api.completionBodies[0].modelId).toBe('ketner-pro');
  });

  it('переход в другой диалог во время стриминга не прерывает генерацию, и ответ доступен при возврате', async () => {
    const api = installFakeApi({ reply: 'Фоновый ответ без прерывания', chunkDelayMs: 15 });
    api.seed({
      title: 'Второй чат',
      messages: [
        {
          id: 'u2',
          conversationId: 'conversation-1',
          role: 'user',
          content: 'Сообщение во втором',
          createdAt: new Date().toISOString(),
          status: 'complete',
        },
      ],
      updatedAt: new Date().toISOString(),
    });
    const user = setupChat();

    await sendMessage(user, 'Начало генерации в первом');
    // Не ждём полного ответа, а переключаемся на второй чат
    await user.click(await screen.findByRole('link', { name: 'Второй чат' }));
    expect(await screen.findByText('Сообщение во втором')).toBeInTheDocument();

    // Ждём, пока первый диалог в фоне завершит генерацию
    await waitFor(() =>
      expect(Object.keys(useChat.getState().streamingConversations)).toHaveLength(0),
    );

    // Возвращаемся в первый диалог
    await user.click(await screen.findByRole('link', { name: 'Начало генерации в первом' }));
    expect(await screen.findByText('Фоновый ответ без прерывания')).toBeInTheDocument();
  });

  it('показывает список моделей со звёздочками у платных и плашку апгрейда при выборе платной модели', async () => {
    installFakeApi();
    const user = setupChat();
    await screen.findByRole('heading', { level: 2, name: EMPTY_TITLE });

    await user.click(screen.getByRole('button', { name: 'Выбрать модель' }));
    // Проверяем наличие всех моделей каталога
    expect(await screen.findByRole('option', { name: /Ketner Mini/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Ketner Pro/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Claude Haiku 5\.5/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /DeepSeek V4\.1 Flash/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /GPT-6\.1 Sol/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Gemini 3\.8 Flash/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Grok 4\.7/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Claude Opus 5\.5/ })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    // Платная модель, выбранная раньше (например, под другим аккаунтом), на Free сбрасывается на Auto.
    act(() => {
      usePreferences.getState().setChatModelId('gpt-6.1-sol');
    });
    await waitFor(() => expect(usePreferences.getState().chatModelId).toBe('auto'));
  });

  it('на недоступной модели сообщение не отправляется: открывается предложение улучшить тариф', async () => {
    const api = installFakeApi({ enforcePlans: true });
    setupChat();
    await screen.findByRole('heading', { level: 2, name: EMPTY_TITLE });

    // Модель выбрана и сообщение отправлено в одном такте, до сброса выбора.
    await act(async () => {
      usePreferences.getState().setChatModelId('claude-opus-5.5');
      await useChat.getState().send('Тест платной модели', []);
    });

    expect(useUpgradeModal.getState().isOpen).toBe(true);
    expect(useUpgradeModal.getState().modelName).toMatch(/Claude Opus 5\.5/);
    expect(api.completions).toBe(0);
    useUpgradeModal.getState().close();
  });

  it('недоступные платные модели в списке заблокированы и полупрозрачны, а клик по полю ввода не открывает модалку', async () => {
    installFakeApi();
    const user = setupChat();
    await screen.findByRole('heading', { level: 2, name: EMPTY_TITLE });

    // Открываем селектор моделей
    await user.click(await screen.findByRole('button', { name: 'Выбрать модель' }));
    // Группа определяется тарифом из каталога: Sol открывается с Plus, Opus — с Pro
    const solOption = await screen.findByRole('option', { name: /GPT-6\.1 Sol/ });
    expect(solOption).toBeDisabled();
    expect(solOption).toHaveClass('opacity-40');
    expect(within(solOption).getByText('plus')).toBeInTheDocument();
    const opusOption = screen.getByRole('option', { name: /Claude Opus 5\.5/ });
    expect(opusOption).toBeDisabled();
    expect(opusOption).toHaveClass('opacity-40');
    expect(within(opusOption).getByText('pro')).toBeInTheDocument();
    // Бесплатная Ketner Mini доступна и без бейджа тарифа
    const miniOption = screen.getByRole('option', { name: /Ketner Mini/ });
    expect(miniOption).toBeEnabled();
    expect(within(miniOption).queryByText('plus')).toBeNull();
    expect(within(miniOption).queryByText('pro')).toBeNull();

    // Закрываем меню кликом по фокусу или esc
    await user.keyboard('{Escape}');

    // Кликаем в поле ввода — модалка не появляется
    const field = await screen.findByLabelText(COMPOSER);
    await user.click(field);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('после ответа в ленте видна модель, которая реально ответила, а не выбранная в переключателе', async () => {
    installFakeApi({ reply: 'Ответ рабочей модели', servedModelId: 'ketner-pro' });
    const user = setupChat();

    await sendMessage(user, 'Реши задачу');

    expect(
      await screen.findByText('Ответ рабочей модели', {}, { timeout: 10000 }),
    ).toBeInTheDocument();
    await waitFor(() => expect(lastAssistant().status).toBe('complete'));
    expect(usePreferences.getState().chatModelId).toBe('auto');
    expect(lastAssistant().modelId).toBe('ketner-pro');
  });

  it('доступ к моделям определяется рангом тарифа: Plus открывает Sol, но не Opus, устаревший gpt-pro равен Pro', async () => {
    installFakeApi({ plan: 'plus' });
    useAuth.setState({
      user: {
        id: 'demo-user',
        email: 'demo@ketner.ai',
        name: 'Демо Пользователь',
        plan: 'plus',
        createdAt: new Date().toISOString(),
      },
      token: 'fake.jwt.token',
      status: 'authenticated',
    });
    const user = setupChat();
    await screen.findByRole('heading', { level: 2, name: EMPTY_TITLE });

    await user.click(screen.getByRole('button', { name: 'Выбрать модель' }));
    expect(await screen.findByRole('option', { name: /GPT-6\.1 Sol/ })).toBeEnabled();
    expect(screen.getByRole('option', { name: /Ketner Pro/ })).toBeEnabled();
    expect(screen.getByRole('option', { name: /Claude Opus 5\.5/ })).toBeDisabled();
    expect(screen.getByRole('option', { name: /Grok 4\.7/ })).toBeDisabled();
    expect(screen.getByRole('option', { name: /Gemini 3\.8 Flash/ })).toBeDisabled();

    // Устаревший тариф gpt-pro приравнен к Pro: открыты и Plus-, и Pro-модели
    await user.keyboard('{Escape}');
    act(() => {
      useAuth.setState({
        user: {
          id: 'demo-user',
          email: 'demo@ketner.ai',
          name: 'Демо Пользователь',
          plan: 'gpt-pro',
          createdAt: new Date().toISOString(),
        },
      });
    });
    await user.click(screen.getByRole('button', { name: 'Выбрать модель' }));
    expect(await screen.findByRole('option', { name: /Claude Opus 5\.5/ })).toBeEnabled();
    expect(screen.getByRole('option', { name: /GPT-6\.1 Sol/ })).toBeEnabled();
  });

  it('сохранённая модель, которой нет в каталоге, после загрузки каталога сбрасывается на Auto', async () => {
    installFakeApi({ reply: 'Готово' });
    usePreferences.getState().setChatModelId('retired-model');
    const user = setupChat();
    await screen.findByRole('heading', { level: 2, name: EMPTY_TITLE });

    await waitFor(() => expect(usePreferences.getState().chatModelId).toBe('auto'));

    await sendMessage(user, 'Вопрос');
    expect(await screen.findByText('Готово')).toBeInTheDocument();
  });

  it('когда сервер отказывает бесплатному аккаунту, весь экран затемняется и открывается предложение тарифа', async () => {
    installFakeApi({ reply: 'Ответ модели', rateLimitAfter: 1 });
    useAuth.setState({
      user: {
        id: 'free-user',
        email: 'free@ketner.ai',
        name: 'Бесплатный Пользователь',
        plan: 'free',
        createdAt: new Date().toISOString(),
      },
      token: 'fake.jwt.token',
      status: 'authenticated',
    });
    const user = setupChat();
    await screen.findByRole('heading', { level: 2, name: EMPTY_TITLE });

    // Первое сообщение проходит: клиент сам ничего не считает
    await sendMessage(user, 'Первое сообщение');
    expect(await screen.findAllByText('Первое сообщение')).not.toHaveLength(0);
    await waitFor(() => expect(useChat.getState().streaming).toBe(false));
    expect(screen.queryByRole('dialog')).toBeNull();

    // Второе сервер отклоняет (429 rate_limited) — открывается модалка без цифр лимита
    await sendMessage(user, 'Второе сообщение');
    const modal = await screen.findByRole('dialog');
    expect(modal).toHaveClass('backdrop-blur-md');
    expect(within(modal).getByText('Продолжите на платном тарифе')).toBeInTheDocument();
    expect(within(modal).queryByText(/из 3/)).toBeNull();

    await user.click(within(modal).getAllByRole('button', { name: 'Закрыть' })[0]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('гости без аккаунта отправляют сообщения, клиент их не блокирует', async () => {
    installFakeApi({ reply: 'Ответ для гостя' });
    const user = setupChat();
    await screen.findByRole('heading', { level: 2, name: EMPTY_TITLE });

    for (let i = 1; i <= 4; i++) {
      await sendMessage(user, `Сообщение гостя ${i}`);
      expect(await screen.findAllByText(`Сообщение гостя ${i}`)).not.toHaveLength(0);
      await waitFor(() => expect(useChat.getState().streaming).toBe(false));
    }

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('поддерживает навигацию с клавиатуры в ModelPicker и закрытие по Esc', async () => {
    installFakeApi();
    const user = setupChat();
    await screen.findByRole('heading', { level: 2, name: EMPTY_TITLE });

    const trigger = screen.getByRole('button', { name: 'Выбрать модель' });
    await user.click(trigger);

    const listbox = await screen.findByRole('listbox');
    expect(listbox).toBeInTheDocument();

    const options = screen.getAllByRole('option');
    expect(options.length).toBeGreaterThan(1);

    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(trigger).toHaveFocus();
  });
});
