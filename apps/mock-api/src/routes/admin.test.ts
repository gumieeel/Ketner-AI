import assert from 'node:assert/strict';
import test from 'node:test';
import { config } from '../config.js';
import { startTestServer, readSseEvents } from '../testing/server.js';

test('admin: проверка доступа по API ключу', async () => {
  const server = await startTestServer();

  try {
    // 1. Без ключа -> 403
    const denied = await fetch(`${server.baseUrl}/api/admin/models`);
    assert.equal(denied.status, 403);
    const deniedBody = (await denied.json()) as { error: { code: string } };
    assert.equal(deniedBody.error.code, 'admin_access_denied');

    // 2. С валидным ключом -> 200
    const allowed = await fetch(`${server.baseUrl}/api/admin/models`, {
      headers: {
        'x-admin-key': config.adminApiKey,
      },
    });
    assert.equal(allowed.status, 200);
    const modelsBody = (await allowed.json()) as { models: Array<{ id: string; name: string }> };
    assert.ok(Array.isArray(modelsBody.models));
    assert.ok(modelsBody.models.some((m) => m.id === 'gpt-6-astra'));
  } finally {
    await server.close();
  }
});

test('admin: обновление модели (PATCH /api/admin/models/:id)', async () => {
  const server = await startTestServer();

  try {
    const updateRes = await fetch(`${server.baseUrl}/api/admin/models/gpt-6-astra`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': config.adminApiKey,
      },
      body: JSON.stringify({
        enabled: true,
        pricing: {
          inputPricePerMillion: 3.0,
          outputPricePerMillion: 12.0,
          cachedInputPricePerMillion: 1.5,
          effectiveFrom: new Date().toISOString(),
          effectiveTo: null,
        },
      }),
    });

    assert.equal(updateRes.status, 200);
    const updated = (await updateRes.json()) as {
      success: boolean;
      model: { pricing: { inputPricePerMillion: number } };
    };
    assert.equal(updated.success, true);
    assert.equal(updated.model.pricing.inputPricePerMillion, 3.0);
  } finally {
    await server.close();
  }
});

test('admin: метрики провайдеров, статистика и рентабельность', async () => {
  const server = await startTestServer();

  try {
    const headers = { 'x-admin-key': config.adminApiKey };

    // Providers
    const provRes = await fetch(`${server.baseUrl}/api/admin/providers`, { headers });
    assert.equal(provRes.status, 200);
    const provBody = (await provRes.json()) as { providers: Array<{ provider: string }> };
    assert.ok(Array.isArray(provBody.providers));
    assert.ok(provBody.providers.some((p) => p.provider === 'openai'));

    // Global Usage
    const usageRes = await fetch(`${server.baseUrl}/api/admin/usage`, { headers });
    assert.equal(usageRes.status, 200);
    const usageBody = (await usageRes.json()) as { stats: { totalRequests: number } };
    assert.ok(typeof usageBody.stats.totalRequests === 'number');

    // Profitability with manual override
    const profRes = await fetch(`${server.baseUrl}/api/admin/profitability/demo-user?planPrice=39.99`, {
      headers,
    });
    assert.equal(profRes.status, 200);
    const profBody = (await profRes.json()) as {
      profitability: { userId: string; subscriptionRevenue: number; status: string; plan: string };
    };
    assert.equal(profBody.profitability.userId, 'demo-user');
    assert.equal(profBody.profitability.subscriptionRevenue, 39.99);
    assert.ok(profBody.profitability.status);

    // Profitability with automatic resolution (demo-user is free -> $0)
    const autoProfRes = await fetch(`${server.baseUrl}/api/admin/profitability/demo-user`, {
      headers,
    });
    assert.equal(autoProfRes.status, 200);
    const autoProfBody = (await autoProfRes.json()) as {
      profitability: { userId: string; subscriptionRevenue: number; plan: string; priceRub: number };
    };
    assert.equal(autoProfBody.profitability.userId, 'demo-user');
    assert.equal(autoProfBody.profitability.plan, 'free');
    assert.equal(autoProfBody.profitability.priceRub, 0);
    assert.equal(autoProfBody.profitability.subscriptionRevenue, 0);
  } finally {
    await server.close();
  }
});

test('admin: доступ по роли пользователя — VIP изолирован от Admin', async () => {
  const vipList = config.vipEmails as unknown as string[];
  const testVipEmail = 'vip-tester-no-admin@example.com';
  vipList.push(testVipEmail);

  const server = await startTestServer();

  try {
    // 1. Создаём пользователя-администратора (artemsinyakov09@gmail.com входит в config.adminEmails)
    const adminSignupRes = await fetch(`${server.baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'artemsinyakov09@gmail.com',
        password: 'password123',
        name: 'Artem Admin',
      }),
    });
    // Может быть 200 (если VIP перезапись) или 201
    assert.ok(adminSignupRes.status === 200 || adminSignupRes.status === 201);
    const { token: adminToken } = (await adminSignupRes.json()) as { token: string };

    // Проверяем доступ админа по Bearer токену без x-admin-key -> 200
    const adminAccess = await fetch(`${server.baseUrl}/api/admin/models`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    assert.equal(adminAccess.status, 200);

    // 2. Создаём VIP-пользователя (входит в vipEmails, но НЕ в adminEmails)
    const vipSignupRes = await fetch(`${server.baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testVipEmail,
        password: 'password123',
        name: 'VIP User Only',
      }),
    });
    assert.ok(vipSignupRes.status === 200 || vipSignupRes.status === 201);
    const { token: vipToken, user: vipUser } = (await vipSignupRes.json()) as {
      token: string;
      user: { plan: string; isVip?: boolean; isAdmin?: boolean };
    };
    // VIP статус получен (Ultra-план)
    assert.equal(vipUser.plan, 'ultra');
    assert.equal(vipUser.isVip, true);
    assert.equal(vipUser.isAdmin, false);

    // Но доступ к Admin API запрещён -> 403
    const vipAccess = await fetch(`${server.baseUrl}/api/admin/models`, {
      headers: {
        Authorization: `Bearer ${vipToken}`,
      },
    });
    assert.equal(vipAccess.status, 403);
    const vipDeniedBody = (await vipAccess.json()) as { error: { code: string } };
    assert.equal(vipDeniedBody.error.code, 'admin_access_denied');

    // 3. Обычный пользователь без VIP и Admin -> 403
    const normalSignupRes = await fetch(`${server.baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'regular-user@example.com',
        password: 'password123',
      }),
    });
    assert.equal(normalSignupRes.status, 201);
    const { token: normalToken } = (await normalSignupRes.json()) as { token: string };

    const normalAccess = await fetch(`${server.baseUrl}/api/admin/models`, {
      headers: {
        Authorization: `Bearer ${normalToken}`,
      },
    });
    assert.equal(normalAccess.status, 403);
  } finally {
    const idx = vipList.indexOf(testVipEmail);
    if (idx !== -1) vipList.splice(idx, 1);
    await server.close();
  }
});

test('admin: GET /api/admin/users — список, пагинация, фильтрация и лимиты', async () => {
  const server = await startTestServer();

  try {
    const headers = { 'x-admin-key': config.adminApiKey };

    // 1. Без ключа -> 403
    const denied = await fetch(`${server.baseUrl}/api/admin/users`);
    assert.equal(denied.status, 403);

    // 2. Создадим нескольких пользователей
    await fetch(`${server.baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'alice@example.com',
        password: 'password123',
        name: 'Alice Wonder',
      }),
    });

    const bobRes = await fetch(`${server.baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'bob@example.com',
        password: 'password123',
        name: 'Bob Builder',
      }),
    });
    const { user: bobUser } = (await bobRes.json()) as { user: { id: string } };

    // Установим Bob план 'pro'
    await fetch(`${server.baseUrl}/api/admin/users/${bobUser.id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'pro' }),
    });

    // 3. Получение списка пользователей по умолчанию (дефолтная пагинация pageSize=50)
    const listRes = await fetch(`${server.baseUrl}/api/admin/users`, { headers });
    assert.equal(listRes.status, 200);
    const listBody = (await listRes.json()) as {
      users: Array<{
        id: string;
        email: string;
        name: string;
        plan: string;
        isVip: boolean;
        isAdmin: boolean;
        createdAt: string;
        usage: { requestsToday: number; tokensToday: number; costToday: number; costThisMonth: number };
        limits: { requestsPerDay: number | null; tokensPerDay: number | null; maxDailyCost: number | null; costBudget: number | null };
        remaining: { requestsToday: number | null; tokensToday: number | null; costToday: number | null; costThisMonth: number | null };
        budgetUsedPct: number;
      }>;
      total: number;
      page: number;
      pageSize: number;
      totalPages: number;
    };

    assert.ok(listBody.total >= 3); // demo-user + alice + bob
    assert.equal(listBody.page, 1);
    assert.equal(listBody.pageSize, 50);

    // Проверяем карточку demo-user (новый пользователь без usage, нули)
    const demoCard = listBody.users.find((u) => u.email === 'demo@ketner.ai');
    assert.ok(demoCard);
    assert.equal(demoCard.usage.requestsToday, 0);
    assert.equal(demoCard.usage.tokensToday, 0);
    assert.equal(demoCard.usage.costToday, 0);
    assert.equal(demoCard.usage.costThisMonth, 0);
    assert.equal(demoCard.budgetUsedPct, 0);
    assert.equal(typeof demoCard.remaining.tokensToday, 'number');
    assert.ok(!Number.isNaN(demoCard.budgetUsedPct));

    // 4. Поиск по подстроке `search=alice`
    const searchRes = await fetch(`${server.baseUrl}/api/admin/users?search=alice`, { headers });
    assert.equal(searchRes.status, 200);
    const searchBody = (await searchRes.json()) as { users: Array<{ email: string }>; total: number };
    assert.equal(searchBody.total, 1);
    assert.equal(searchBody.users[0].email, 'alice@example.com');

    // 5. Фильтр по тарифу `plan=pro`
    const planRes = await fetch(`${server.baseUrl}/api/admin/users?plan=pro`, { headers });
    assert.equal(planRes.status, 200);
    const planBody = (await planRes.json()) as { users: Array<{ email: string; plan: string }>; total: number };
    assert.ok(planBody.users.every((u) => u.plan === 'pro'));
    assert.ok(planBody.users.some((u) => u.email === 'bob@example.com'));

    // 6. Пагинация `page=1&pageSize=2`
    const pageRes = await fetch(`${server.baseUrl}/api/admin/users?page=1&pageSize=2`, { headers });
    assert.equal(pageRes.status, 200);
    const pageBody = (await pageRes.json()) as { users: Array<unknown>; total: number; pageSize: number; totalPages: number };
    assert.equal(pageBody.users.length, 2);
    assert.equal(pageBody.pageSize, 2);
    assert.ok(pageBody.totalPages >= 2);
  } finally {
    await server.close();
  }
});

test('admin: GET /api/admin/users/:id — детальная карточка пользователя и пустые карточки', async () => {
  const server = await startTestServer();

  try {
    const headers = { 'x-admin-key': config.adminApiKey };

    // 1. Несуществующий пользователь -> 404
    const notFoundRes = await fetch(`${server.baseUrl}/api/admin/users/non-existent-user-123`, { headers });
    assert.equal(notFoundRes.status, 404);
    const notFoundBody = (await notFoundRes.json()) as { error: { code: string } };
    assert.equal(notFoundBody.error.code, 'user_not_found');

    // 2. Существующий пользователь без истории запросов -> 200 (нули, не 404/500)
    const emptyUserRes = await fetch(`${server.baseUrl}/api/admin/users/demo-user`, { headers });
    assert.equal(emptyUserRes.status, 200);
    const emptyBody = (await emptyUserRes.json()) as {
      id: string;
      email: string;
      name: string;
      plan: string;
      isVip: boolean;
      isAdmin: boolean;
      createdAt: string;
      usage: {
        requestsLastHour: number;
        requestsToday: number;
        tokensLastHour: number;
        tokensToday: number;
        costToday: number;
        costThisMonth: number;
      };
      limits: {
        requestsPerHour: number | null;
        requestsPerDay: number | null;
        tokensPerHour: number | null;
        tokensPerDay: number | null;
        maxDailyCost: number | null;
        costBudget: number | null;
      };
      remaining: {
        requestsLastHour: number | null;
        requestsToday: number | null;
        tokensLastHour: number | null;
        tokensToday: number | null;
        costToday: number | null;
        costThisMonth: number | null;
      };
      budgetUsedPct: number;
      profitability: { userId: string; subscriptionRevenue: number; aiCost: number; status: string };
      recentRequests: unknown[];
    };

    assert.equal(emptyBody.id, 'demo-user');
    assert.equal(emptyBody.email, 'demo@ketner.ai');
    assert.equal(emptyBody.usage.requestsLastHour, 0);
    assert.equal(emptyBody.usage.requestsToday, 0);
    assert.equal(emptyBody.usage.tokensLastHour, 0);
    assert.equal(emptyBody.usage.tokensToday, 0);
    assert.equal(emptyBody.usage.costToday, 0);
    assert.equal(emptyBody.usage.costThisMonth, 0);
    assert.equal(emptyBody.budgetUsedPct, 0);
    assert.ok(Array.isArray(emptyBody.recentRequests));
    assert.equal(emptyBody.recentRequests.length, 0);
    assert.equal(emptyBody.profitability.userId, 'demo-user');
    assert.equal(emptyBody.profitability.aiCost, 0);

    // 3. Создадим пользователя и выполним запрос к AI
    const signupRes = await fetch(`${server.baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'active-ai-user@example.com',
        password: 'password123',
        name: 'Active User',
      }),
    });
    const { token: userToken, user: createdUser } = (await signupRes.json()) as {
      token: string;
      user: { id: string };
    };

    // Создаём диалог и отправляем сообщение
    const convRes = await fetch(`${server.baseUrl}/api/conversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({ title: 'Test Conv' }),
    });
    const convData = (await convRes.json()) as { conversation: { id: string } };

    const chatRes = await fetch(`${server.baseUrl}/api/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        conversationId: convData.conversation.id,
        modelId: 'gpt-4o-mini',
        language: 'ru',
        messages: [{ role: 'user', content: 'Привет' }],
      }),
    });
    assert.equal(chatRes.status, 200);
    const events = await readSseEvents(chatRes);
    assert.ok(events.length > 0);

    // Проверяем детальную карточку активного пользователя
    const activeRes = await fetch(`${server.baseUrl}/api/admin/users/${createdUser.id}`, { headers });
    assert.equal(activeRes.status, 200);
    const activeBody = (await activeRes.json()) as {
      usage: { requestsToday: number; tokensToday: number; costToday: number };
      recentRequests: Array<{ id: string; userId: string; inputTokens: number; outputTokens: number }>;
    };

    assert.ok(activeBody.usage.requestsToday >= 1);
    assert.ok(activeBody.usage.tokensToday > 0);
    assert.ok(activeBody.recentRequests.length >= 1);
    assert.equal(activeBody.recentRequests[0].userId, createdUser.id);
  } finally {
    await server.close();
  }
});

test('admin: PATCH /api/admin/users/:id — обновление плана, VIP, Admin и защита от снятия с себя прав', async () => {
  const server = await startTestServer();

  try {
    const headers = { 'x-admin-key': config.adminApiKey };

    // 1. Создаём целевого пользователя
    const userRes = await fetch(`${server.baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'target-user@example.com',
        password: 'password123',
        name: 'Target User',
      }),
    });
    const { user: targetUser } = (await userRes.json()) as { user: { id: string; plan: string } };

    // 2. Обновление тарифа на 'pro'
    const patchPlanRes = await fetch(`${server.baseUrl}/api/admin/users/${targetUser.id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'pro' }),
    });
    assert.equal(patchPlanRes.status, 200);
    const patchPlanBody = (await patchPlanRes.json()) as { success: boolean; user: { plan: string } };
    assert.equal(patchPlanBody.success, true);
    assert.equal(patchPlanBody.user.plan, 'pro');

    // 3. Обновление флага isVip
    const patchVipRes = await fetch(`${server.baseUrl}/api/admin/users/${targetUser.id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ isVip: true }),
    });
    assert.equal(patchVipRes.status, 200);
    const patchVipBody = (await patchVipRes.json()) as { user: { isVip: boolean; plan: string } };
    assert.equal(patchVipBody.user.isVip, true);
    assert.equal(patchVipBody.user.plan, 'ultra'); // VIP автоматически получает тариф ultra

    // 4. Обновление флага isAdmin
    const patchAdminRes = await fetch(`${server.baseUrl}/api/admin/users/${targetUser.id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ isAdmin: true }),
    });
    assert.equal(patchAdminRes.status, 200);
    const patchAdminBody = (await patchAdminRes.json()) as { user: { isAdmin: boolean } };
    assert.equal(patchAdminBody.user.isAdmin, true);

    // 5. Проверяем, что изменения отражаются в GET /api/admin/users/:id
    const getRes = await fetch(`${server.baseUrl}/api/admin/users/${targetUser.id}`, { headers });
    assert.equal(getRes.status, 200);
    const getBody = (await getRes.json()) as { isVip: boolean; isAdmin: boolean; plan: string };
    assert.equal(getBody.isVip, true);
    assert.equal(getBody.isAdmin, true);
    assert.equal(getBody.plan, 'ultra');

    // 6. Валидация: некорректный план -> 400
    const invalidPlanRes = await fetch(`${server.baseUrl}/api/admin/users/${targetUser.id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'non-existing-plan' }),
    });
    assert.equal(invalidPlanRes.status, 400);

    // 7. Валидация: защита от снятия isAdmin с самого себя
    // Авторизуемся под администратором (email из config.adminEmails)
    const adminSignupRes = await fetch(`${server.baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'artemsinyakov09@gmail.com',
        password: 'password123',
        name: 'Admin Self',
      }),
    });
    const { token: adminToken, user: loggedAdmin } = (await adminSignupRes.json()) as {
      token: string;
      user: { id: string };
    };

    // Попытка администратора снять isAdmin с самого себя через свой токен -> 400 cannot_demote_self
    const selfDemoteRes = await fetch(`${server.baseUrl}/api/admin/users/${loggedAdmin.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ isAdmin: false }),
    });
    assert.equal(selfDemoteRes.status, 400);
    const selfDemoteBody = (await selfDemoteRes.json()) as { error: { code: string } };
    assert.equal(selfDemoteBody.error.code, 'cannot_demote_self');

    // Снятие isAdmin с другого пользователя тем же администратором -> 200 (разрешено)
    const otherDemoteRes = await fetch(`${server.baseUrl}/api/admin/users/${targetUser.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ isAdmin: false }),
    });
    assert.equal(otherDemoteRes.status, 200);
    const otherDemoteBody = (await otherDemoteRes.json()) as { user: { isAdmin: boolean } };
    assert.equal(otherDemoteBody.user.isAdmin, false);
  } finally {
    await server.close();
  }
});


