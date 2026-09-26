import assert from 'node:assert/strict';
import test from 'node:test';
import { isVipEmail, isVipUser, isAdminEmail, isAdminUser } from './vip.js';
import { config } from '../config.js';

test('vip: isVipEmail and isVipUser correctly recognize VIP accounts', () => {
  // 1. Default VIP email
  assert.equal(isVipEmail('artemsinyakov09@gmail.com'), true);
  assert.equal(isVipEmail('  ARTEMSINYAKOV09@GMAIL.COM  '), true);
  assert.equal(isVipEmail('stranger@example.com'), false);
  assert.equal(isVipEmail(''), false);
  assert.equal(isVipEmail(null), false);
  assert.equal(isVipEmail(undefined), false);

  // 2. User object with isVip: true
  assert.equal(isVipUser({ isVip: true, email: 'stranger@example.com' }), true);

  // 3. User object with VIP email
  assert.equal(isVipUser({ email: 'artemsinyakov09@gmail.com' }), true);

  // 4. Regular user
  assert.equal(isVipUser({ email: 'user@example.com', isVip: false }), false);
  assert.equal(isVipUser(null), false);
  assert.equal(isVipUser(undefined), false);
});

test('vip: isAdminEmail and isAdminUser correctly isolate admin privileges', () => {
  // 1. Default admin email
  assert.equal(isAdminEmail('artemsinyakov09@gmail.com'), true);
  assert.equal(isAdminEmail('  ARTEMSINYAKOV09@GMAIL.COM '), true);
  assert.equal(isAdminEmail('vip-guest@example.com'), false);
  assert.equal(isAdminEmail(''), false);
  assert.equal(isAdminEmail(null), false);
  assert.equal(isAdminEmail(undefined), false);

  // 2. User object with isAdmin: true
  assert.equal(isAdminUser({ isAdmin: true, email: 'guest@example.com' }), true);

  // 3. User object with admin email
  assert.equal(isAdminUser({ email: 'artemsinyakov09@gmail.com' }), true);

  // 4. Decoupling: a user with isVip=true is NOT an admin unless isAdmin=true or admin email matches
  const vipOnlyUser = {
    email: 'vip-tester@example.com',
    isVip: true,
    isAdmin: false,
  };
  assert.equal(isVipUser(vipOnlyUser), true);
  assert.equal(isAdminUser(vipOnlyUser), false);

  // 5. Regular user
  assert.equal(isAdminUser({ email: 'user@example.com', isAdmin: false }), false);
  assert.equal(isAdminUser(null), false);
  assert.equal(isAdminUser(undefined), false);
});

test('vip: runtime configuration respects custom lists', () => {
  const vipList = config.vipEmails as unknown as string[];
  const adminList = config.adminEmails as unknown as string[];

  const customVip = 'custom-vip@domain.com';
  const customAdmin = 'custom-admin@domain.com';

  vipList.push(customVip);
  adminList.push(customAdmin);

  try {
    // custom-vip is VIP but not Admin
    assert.equal(isVipEmail(customVip), true);
    assert.equal(isAdminEmail(customVip), false);
    assert.equal(isVipUser({ email: customVip }), true);
    assert.equal(isAdminUser({ email: customVip }), false);

    // custom-admin is Admin
    assert.equal(isAdminEmail(customAdmin), true);
    assert.equal(isAdminUser({ email: customAdmin }), true);
  } finally {
    const vipIdx = vipList.indexOf(customVip);
    if (vipIdx !== -1) vipList.splice(vipIdx, 1);
    const adminIdx = adminList.indexOf(customAdmin);
    if (adminIdx !== -1) adminList.splice(adminIdx, 1);
  }
});
