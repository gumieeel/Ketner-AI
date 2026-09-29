import { act } from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useChat } from '@/features/chat/chat-store';
import type { Message } from '@/features/chat/types';
import { installFakeApi } from './fake-api';
import { renderRoute, resetChat, resetPreferences } from './test-utils';

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
    resetPreferences();
    resetChat();
  });

  it('отправляет сообщение, создаёт диалог и показывает потоковый ответ', async () => {
    const api = installFakeApi({ reply: 'Привет из демо-модели' });
    const user = setupChat();

    await sendMessage(user, 'Как дела?');

    expect(await screen.findAllByText('Как дела?')).not.toHaveLength(0);
    expect(await screen.findByText('Привет из демо-модели')).toBeInTheDocument();
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

    await user.click(screen.getByRole('button', { name: 'Повторить' }));

    expect(await screen.findByText('Ответ со второй попытки', {}, { timeout: 4000 })).toBeInTheDocument();
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
    const api = installFakeApi({ reply: 'Готово' });
    const user = setupChat();
    await screen.findByRole('heading', { level: 2, name: EMPTY_TITLE });

    await user.click(screen.getByRole('button', { name: 'Выбрать модель' }));
    await user.click(await screen.findByRole('option', { name: /Qwen 2\.5 Max/ }));
    expect(screen.getByRole('button', { name: 'Выбрать модель' })).toHaveTextContent(
      'Qwen 2.5 Max',
    );

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
    // Проверяем наличие всех моделей, платные со звёздочкой
    expect(await screen.findByRole('option', { name: /Qwen 2\.5 Coder/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /GPT-6 Astra \*/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Claude Fable 5\.5 \*/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Gemini 3\.8 (Flash|Pro) \*/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Qwen 2\.5 Max \*/ })).toBeInTheDocument();

    // Выбираем платную модель GPT-6 Astra *
    await user.click(screen.getByRole('option', { name: /GPT-6 Astra \*/ }));

    // Появляется плашка с предупреждением об апгрейде и ссылкой на тарифы
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/GPT-6 Astra \*/);
    expect(alert).toHaveTextContent(/GPT Pro/);
    const upgradeLink = within(alert).getByRole('link', { name: /Улучшить план/ });
    expect(upgradeLink).toHaveAttribute('href', '/pricing');
  });

  it('при попытке генерации на платной модели без подписки показывает ошибку апгрейда со ссылкой на тарифы', async () => {
    installFakeApi({ enforcePlans: true });
    const user = setupChat();
    await screen.findByRole('heading', { level: 2, name: EMPTY_TITLE });

    // Выбираем платную модель
    await user.click(await screen.findByRole('button', { name: 'Выбрать модель' }));
    await user.click(await screen.findByRole('option', { name: /Claude Fable 5\.5 \*/ }));

    // Отправляем сообщение
    await sendMessage(user, 'Тест платной модели');

    // Проверяем, что появилось сообщение об ошибке с требованием апгрейда
    expect(await screen.findByText('Требуется подписка (Upgrade your plan)')).toBeInTheDocument();
    expect(screen.getAllByText(/Claude Fable 5\.5 \*/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: /Улучшить план/ })[0]).toHaveAttribute(
      'href',
      '/pricing',
    );
  });

  it('при попытке написать с платной моделью весь экран затемняется и появляется модалка перехода на PRO', async () => {
    installFakeApi();
    const user = setupChat();
    await screen.findByRole('heading', { level: 2, name: EMPTY_TITLE });

    // Выбираем платную модель GPT-6 Astra *
    await user.click(await screen.findByRole('button', { name: 'Выбрать модель' }));
    await user.click(await screen.findByRole('option', { name: /GPT-6 Astra \*/ }));

    // Пытаемся кликнуть в поле ввода или написать
    const field = await screen.findByLabelText(COMPOSER);
    await user.click(field);

    // Весь экран затемняется: появляется модальное окно с ролью dialog и затемняющим фоном
    const modal = await screen.findByRole('dialog');
    expect(modal).toBeInTheDocument();
    expect(modal).toHaveClass('backdrop-blur-md');
    expect(within(modal).getAllByText(/Модель GPT-6 Astra \* доступна на PRO/).length).toBeGreaterThan(0);
    expect(within(modal).getAllByText(/GPT Pro/).length).toBeGreaterThan(0);
    expect(within(modal).getAllByText(/Ultra/).length).toBeGreaterThan(0);

    // Кнопка переключения на бесплатную модель Qwen 2.5 Coder
    const switchBtn = within(modal).getByRole('button', {
      name: /Переключиться на бесплатную Qwen 2\.5 Coder/,
    });
    await user.click(switchBtn);

    // Модалка закрылась, активной стала бесплатная модель
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: 'Выбрать модель' })).toHaveTextContent(
      'Qwen 2.5 Coder',
    );
  });

  it('после 3 сообщений на бесплатном плане весь экран затемняется и выскакивает модалка исчерпания лимита', async () => {
    installFakeApi({ reply: 'Ответ модели' });
    const user = setupChat();
    await screen.findByRole('heading', { level: 2, name: EMPTY_TITLE });

    // Отправляем 1-е сообщение
    await sendMessage(user, 'Первое сообщение');
    expect(await screen.findAllByText('Первое сообщение')).not.toHaveLength(0);
    await waitFor(() => expect(useChat.getState().streaming).toBe(false));

    // Отправляем 2-е сообщение
    await sendMessage(user, 'Второе сообщение');
    expect(await screen.findAllByText('Второе сообщение')).not.toHaveLength(0);
    await waitFor(() => expect(useChat.getState().streaming).toBe(false));

    // Отправляем 3-е сообщение
    await sendMessage(user, 'Третье сообщение');
    expect(await screen.findAllByText('Третье сообщение')).not.toHaveLength(0);
    await waitFor(() => expect(useChat.getState().streaming).toBe(false));

    // После 3-го сообщения весь экран затемняется и открывается модалка лимита
    const modal = await screen.findByRole('dialog');
    expect(modal).toBeInTheDocument();
    expect(modal).toHaveClass('backdrop-blur-md');
    expect(within(modal).getByText('Лимит бесплатного плана исчерпан')).toBeInTheDocument();
    expect(within(modal).getByText('3 из 3 сообщений использовано')).toBeInTheDocument();

    // Закрываем модалку по кнопке закрытия
    await user.click(within(modal).getAllByRole('button', { name: 'Закрыть' })[0]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // Пытаемся отправить 4-е сообщение — поле блокируется, модалка снова открывается
    const field = screen.getByLabelText(COMPOSER);
    await user.click(field);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
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

