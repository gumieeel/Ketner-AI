import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '@/features/auth/auth-store';
import { useImages } from '@/features/images/images-store';
import type { GeneratedImage, ImageCapabilities } from '@/features/images/types';
import { installFakeApi } from './fake-api';
import { renderRoute, resetAuth, resetChat, resetPreferences } from './test-utils';
import { setProductSwitchesForTests } from '@/lib/product-switches';

// Закрытые возможности (lib/product-switches.ts): здесь проверяется их спящий код.
setProductSwitchesForTests({ chat: true, images: true });

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let credits: ImageCapabilities['credits'];

function capabilities(plan: 'free' | 'credits'): ImageCapabilities {
  return {
    available: true,
    plan,
    defaultModelId: 'flux-schnell',
    maxPromptChars: 1000,
    credits,
    models: [
      {
        id: 'flux-schnell',
        name: 'FLUX.1 schnell',
        aspects: ['1:1'],
        dailyLimit: plan === 'free' ? 5 : 200,
        usedToday: 1,
        priceCredits: 0.7,
      },
      {
        id: 'flux-2-klein',
        name: 'FLUX.2 klein',
        aspects: ['1:1', '4:3', '3:4', '16:9', '9:16'],
        dailyLimit: plan === 'free' ? 5 : 120,
        usedToday: 0,
        priceCredits: 4.6,
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
  plan: 'free' | 'credits',
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

function loginAs(plan: 'free' | 'credits'): void {
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
    credits = { balance: 300, exhausted: false, freePerDay: 5 };
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

  it('генерирует картинку на Free без замков на моделях и добавляет её в галерею', async () => {
    const fake = installImagesApi('free');
    loginAs('free');
    const user = userEvent.setup();
    renderRoute('/images');

    expect(await screen.findByAltText('старая картинка')).toBeInTheDocument();
    // Счётчик использования на странице не показывается: лимиты считает сервер
    expect(screen.queryByText(/Сегодня \d+ из \d+/)).toBeNull();
    // Free: все модели открыты, без замков и бейджей тарифов; у FLUX.1 только квадрат.
    const klein = screen.getByRole('button', { name: /FLUX\.2 klein/ });
    expect(klein).toBeEnabled();
    expect(klein).not.toHaveTextContent(/PLUS|PRO/i);
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

  it('показывает остаток кредитов и цену каждой модели, а после картинки уменьшает остаток', async () => {
    credits = { balance: 3000, exhausted: false, freePerDay: 5 };
    installImagesApi('credits');
    loginAs('credits');
    const user = userEvent.setup();
    renderRoute('/images');

    const line = await screen.findByTestId('images-credits');
    expect(line).toHaveTextContent('Кредиты: 3 000');
    expect(screen.getByRole('button', { name: /FLUX\.1 schnell/ })).toHaveTextContent('≈ 0,7 кр.');
    expect(screen.getByRole('button', { name: /FLUX\.2 klein/ })).toHaveTextContent('≈ 4,6 кр.');

    await user.type(screen.getByLabelText('Описание картинки'), 'кот в космосе');
    await user.click(screen.getByRole('button', { name: 'Создать' }));
    await screen.findByAltText('кот в космосе');
    expect(screen.getByTestId('images-credits')).toHaveTextContent('Кредиты: 2 999');
  });

  it('когда кредиты кончились, говорит, что рисует только FLUX.1 schnell, и ведёт к покупке', async () => {
    credits = { balance: 0, exhausted: true, freePerDay: 5 };
    installImagesApi('credits');
    loginAs('credits');
    renderRoute('/images');

    const line = await screen.findByTestId('images-credits');
    expect(line).toHaveTextContent('Кредиты: 0');
    expect(line).toHaveTextContent(
      'Кредиты закончились: рисует только FLUX.1 schnell, не больше 5 в сутки',
    );
    expect(within(line).getByRole('link', { name: 'Купить кредиты' })).toHaveAttribute(
      'href',
      '/pricing',
    );
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

  it('показывает отказ модерации и ссылку на покупку кредитов при исчерпанном лимите', async () => {
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
    // У каждой модели — цена картинки в кредитах, а не название тарифа
    expect(within(dialog).getByText('≈ 0,7 кр.')).toBeInTheDocument();
    expect(within(dialog).getByText('≈ 4,6 кр.')).toBeInTheDocument();
    expect(within(dialog).queryByText(/тариф/i)).toBeNull();
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
