import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '@/features/auth/auth-store';
import { useImages } from '@/features/images/images-store';
import type { GeneratedImage, ImageCapabilities } from '@/features/images/types';
import { installFakeApi } from './fake-api';
import { renderRoute, resetAuth, resetChat, resetPreferences } from './test-utils';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function capabilities(plan: 'free' | 'plus'): ImageCapabilities {
  return {
    available: true,
    plan,
    defaultModelId: 'flux-schnell',
    maxPromptChars: 1000,
    models: [
      {
        id: 'flux-schnell',
        name: 'FLUX.1 schnell',
        aspects: ['1:1'],
        requiredPlan: 'free',
        locked: false,
        dailyLimit: plan === 'free' ? 5 : 50,
        usedToday: 1,
      },
      {
        id: 'flux-2-klein',
        name: 'FLUX.2 klein',
        aspects: ['1:1', '4:3', '3:4', '16:9', '9:16'],
        requiredPlan: 'plus',
        locked: plan === 'free',
        dailyLimit: plan === 'free' ? 0 : 20,
        usedToday: 0,
      },
    ],
  };
}

function image(id: string, prompt: string, modelName = 'FLUX.1 schnell'): GeneratedImage {
  return {
    id,
    prompt,
    modelId: 'flux-schnell',
    modelName,
    width: 1024,
    height: 1024,
    createdAt: new Date().toISOString(),
    url: `/api/images/${id}/file?exp=1&sig=x`,
    downloadUrl: `/api/images/${id}/file?exp=1&sig=x&download=1`,
  };
}

interface ImagesFake {
  generateBodies: Record<string, unknown>[];
}

function installImagesApi(
  plan: 'free' | 'plus',
  options: { generate?: () => Response } = {},
): ImagesFake {
  installFakeApi({ reply: 'ok', plan });
  const base = globalThis.fetch;
  const fake: ImagesFake = { generateBodies: [] };
  vi.stubGlobal(
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/images/capabilities') return json(capabilities(plan));
      if (url === '/api/images' && method === 'GET')
        return json({ images: [image('old', 'старая картинка')] });
      if (url === '/api/images/generate' && method === 'POST') {
        fake.generateBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return (
          options.generate?.() ??
          json({ image: image('new', 'кот в космосе'), replacedBy: null }, 201)
        );
      }
      return base(input, init);
    },
  );
  return fake;
}

function loginAs(plan: 'free' | 'plus'): void {
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

describe('страница «Изображения»', () => {
  beforeEach(() => {
    resetAuth();
    resetPreferences();
    resetChat();
    useImages.setState({
      capabilities: null,
      images: [],
      status: 'idle',
      authRequired: false,
      prompt: '',
      modelId: 'flux-schnell',
      aspect: '1:1',
      style: 'none',
      generating: false,
      pendingAspect: null,
      notice: null,
    });
  });

  it('генерирует картинку на Free и добавляет её в галерею', async () => {
    const fake = installImagesApi('free');
    loginAs('free');
    const user = userEvent.setup();
    renderRoute('/images');

    expect(await screen.findByAltText('старая картинка')).toBeInTheDocument();
    // Счётчик использования на странице не показывается: лимиты считает сервер
    expect(screen.queryByText(/Сегодня \d+ из \d+/)).toBeNull();
    // Free: FLUX.2 закрыта, у FLUX.1 только квадрат.
    expect(screen.getByRole('button', { name: /FLUX\.2 klein/ })).toHaveTextContent('PLUS');
    expect(screen.getByRole('button', { name: /16:9/ })).toBeDisabled();

    await user.type(screen.getByLabelText('Описание картинки'), 'кот в космосе');
    await user.click(screen.getByRole('button', { name: 'Создать' }));
    await waitFor(() => expect(fake.generateBodies).toHaveLength(1));
    expect(fake.generateBodies[0]).toMatchObject({
      prompt: 'кот в космосе',
      modelId: 'flux-schnell',
      aspect: '1:1',
      style: 'none',
    });
    expect(await screen.findByAltText('кот в космосе')).toBeInTheDocument();
  });

  it('выбранный стиль уходит на сервер и запоминается', async () => {
    const fake = installImagesApi('free');
    loginAs('free');
    const user = userEvent.setup();
    renderRoute('/images');

    const watercolor = await screen.findByRole('button', { name: 'Акварель' });
    expect(screen.getByRole('button', { name: 'Без стиля' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(watercolor);
    expect(watercolor).toHaveAttribute('aria-pressed', 'true');
    expect(window.localStorage.getItem('ketner.imageStyle')).toBe('watercolor');

    await user.type(screen.getByLabelText('Описание картинки'), 'кот в космосе');
    await user.click(screen.getByRole('button', { name: 'Создать' }));
    await waitFor(() => expect(fake.generateBodies).toHaveLength(1));
    expect(fake.generateBodies[0]).toMatchObject({ prompt: 'кот в космосе', style: 'watercolor' });
  });

  it('показывает отказ модерации и ссылку на тариф при исчерпанном лимите', async () => {
    let call = 0;
    installImagesApi('free', {
      generate: () => {
        call += 1;
        return call === 1
          ? json(
              { error: { code: 'moderation_blocked', message: 'Такой запрос нельзя выполнить' } },
              422,
            )
          : json(
              { error: { code: 'image_limit', message: 'Лимит картинок на сегодня исчерпан' } },
              429,
            );
      },
    });
    loginAs('free');
    const user = userEvent.setup();
    renderRoute('/images');

    const prompt = await screen.findByLabelText('Описание картинки');
    await user.type(prompt, 'что-то');
    await user.click(screen.getByRole('button', { name: 'Создать' }));
    const blocked = await screen.findByRole('alert');
    expect(blocked).toHaveTextContent('Такой запрос нельзя выполнить');
    expect(within(blocked).queryByRole('link')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Создать' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Лимит картинок'));
    expect(within(screen.getByRole('alert')).getByRole('link')).toHaveAttribute('href', '/pricing');
  });

  it('справка «О моделях» описывает модели без лимитов и закрывается по Escape', async () => {
    installImagesApi('free');
    loginAs('free');
    const user = userEvent.setup();
    renderRoute('/images');

    await user.click(await screen.findByRole('button', { name: 'О моделях' }));
    const dialog = screen.getByRole('dialog', { name: 'О моделях' });
    expect(
      within(dialog).getByText('Самая быстрая модель: картинка готова за несколько секунд.'),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText(/лимит/i)).toBeNull();
    expect(within(dialog).getByText('Доступна с тарифа Plus')).toBeInTheDocument();
    expect(within(dialog).getByText('Только квадрат 1:1')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('просит войти, если сервер ответил 401', async () => {
    installFakeApi({ reply: 'ok' });
    const base = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).startsWith('/api/images')
        ? json({ error: { code: 'unauthorized', message: 'Войдите' } }, 401)
        : base(input, init),
    );
    renderRoute('/images');
    expect(await screen.findByText('Войдите, чтобы создавать картинки')).toBeInTheDocument();
  });

  it('поле поиска чатов не принимает автозаполнение', async () => {
    installFakeApi({ reply: 'ok' });
    renderRoute('/chat');
    const search = await screen.findByRole('searchbox', { name: 'Поиск по чатам' });
    expect(search).toHaveAttribute('autocomplete', 'off');
    expect(search).toHaveAttribute('name', 'ketner-chat-search');
  });
});
