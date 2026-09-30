import { chromium, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import process from 'node:process';

// Browser contract tests use explicit in-memory API fixtures. No DB or live API proof.
const base = process.env.CONTRACT_BASE_URL ?? 'http://127.0.0.1:3000';
if (new URL(base).hostname !== '127.0.0.1') throw new Error('Loopback preview required');
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({ headless: true, ...(existsSync(executablePath) ? { executablePath } : {}) });
const core = { gender: 'female', age: 32, heightCm: 165, weightKg: 72, targetWeightKg: 62, goal: 'lose_weight', activityLevel: 'light', wellnessEligible: true };
let context;
async function fixture(overrides = {}, controls = {}) {
  if (context) await context.close();
  context = await browser.newContext();
  let saved = { sessionId: 'contract-fixture', version: 1, step: 10, nextStep: 9, state: 'draft', completed: false, healthDataConsent: true, missingFields: [], assessment: { ...core }, ...overrides };
  const writes = []; const payments = [];
  await context.addInitScript(() => localStorage.setItem('vitalpath-session-id', 'contract-fixture'));
  const page = await context.newPage();
  page.setDefaultTimeout(7000);
  await page.route('**/api/**', async route => {
    const req = route.request(); const path = new URL(req.url()).pathname;
    const send = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/sessions') return send({ sessionId: saved.sessionId }, 201);
    if (path === '/api/assessment' && req.method() === 'GET') return send(saved);
    if (path === '/api/assessment' && req.method() === 'PATCH') {
      const body = req.postDataJSON(); writes.push(body);
      if (controls.conflict || controls.conflictSameValue) {
        saved = { ...saved, version: saved.version + 1, assessment: { ...saved.assessment, age: controls.conflictSameValue ? body.data.age : 48 } };
        return send({ error: 'version_conflict', message: 'Version changed' }, 409);
      }
      saved = { ...saved, step: body.step, version: saved.version + 1, assessment: { ...saved.assessment, ...body.data }, healthDataConsent: body.data.healthDataConsent ?? saved.healthDataConsent };
      if (controls.dropPatch) { controls.dropPatch = false; return route.abort(); }
      return send(saved);
    }
    if (path === '/api/assessment/submit') {
      if (controls.issue) return send({ error: 'invalid_health_input', message: 'Review your answers', issues: [{ field: 'weightKg', message: 'Review the current weight' }], nextStep: 2, nextAction: 'review_assessment' }, 422);
      saved = { ...saved, completed: true, state: 'completed', nextStep: 10 };
      return send({ ok: true, resultId: 'fixture-report' });
    }
    if (path === '/api/pay') {
      payments.push(req.postDataJSON());
      if (controls.dropPay) { controls.dropPay = false; controls.paid = true; return route.abort(); }
      controls.paid = true;
      return send({ ok: true });
    }
    if (path === '/api/results') return send({ sessionId: saved.sessionId, needPaywall: !controls.paid, subscriptionStatus: controls.paid ? 'active' : 'free', report: { id: 'fixture-report', calculatedAt: '2026-09-30T00:00:00Z', algorithmVersion: 'contract-fixture-v1' }, result: { bmi: 26.4, bmiCategory: 'overweight', ...(controls.paid ? { recommendedCalories: 1600, targetDate: null, calculationDetails: { projectionStatus: 'not_projected' } } : { recommendedCaloriesRange: '1500–1700' }) } });
    return send({ ok: true });
  });
  await page.goto(base, { waitUntil: 'networkidle' });
  return { page, writes, payments, snapshot: () => saved };
}
try {
  let test = await fixture({ nextStep: 0, missingFields: ['gender'], assessment: { ...core, gender: null } });
  await test.page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(test.page.getByRole('heading', { name: /Which biological sex/ })).toBeVisible();
  console.log('PASS authoritative nextStep beats historical step');

  test = await fixture({ nextStep: 4 });
  await test.page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(test.page.getByText(/Optional/).first()).toBeVisible();
  await test.page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(test.page.getByRole('heading', { name: /How active/ })).toBeVisible();
  if (test.writes.some(write => 'pacePreference' in write.data)) throw new Error('Blank optional value sent');
  console.log('PASS optional pace omitted');

  test = await fixture({ nextStep: 1 }, { dropPatch: true });
  await test.page.getByRole('button', { name: 'Start', exact: true }).click();
  await test.page.getByLabel('Age').fill('33');
  await test.page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(test.page.getByRole('heading', { name: /Add your current/ })).toBeVisible();
  if (test.writes.length !== 1) throw new Error('Lost response repeated PATCH');
  console.log('PASS lost PATCH response recovered by matching read');

  test = await fixture({ nextStep: 1 }, { conflictSameValue: true });
  await test.page.getByRole('button', { name: 'Start', exact: true }).click();
  await test.page.getByLabel('Age').fill('33');
  await test.page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(test.page.getByRole('heading', { name: /Add your current/ })).toBeVisible();
  if (test.writes.length !== 1) throw new Error('Same-value conflict repeated PATCH');
  console.log('PASS same-value version conflict reconciles without rewriting');

  test = await fixture({ nextStep: 1 }, { conflict: true });
  await test.page.getByRole('button', { name: 'Start', exact: true }).click();
  await test.page.getByLabel('Age').fill('33');
  await test.page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(test.page.getByLabel('Age')).toHaveValue('33');
  await expect(test.page.getByRole('button', { name: /Load saved answers/ })).toBeVisible();
  console.log('PASS genuine conflict preserves local draft');

  test = await fixture({}, { issue: true });
  await test.page.getByRole('button', { name: 'Start', exact: true }).click();
  await test.page.getByRole('button', { name: 'Generate my plan', exact: true }).click();
  await expect(test.page.getByRole('heading', { name: /Add your current/ })).toBeVisible();
  await expect(test.page.getByText(/Review the current weight/)).toBeVisible();
  console.log('PASS structured issue locates field without dropping draft');

  test = await fixture({ state: 'stale', completed: true, nextStep: 5 });
  await expect(test.page.getByRole('heading', { name: /How active/ })).toBeVisible();
  await expect(test.page.getByText(/report is out of date/i)).toBeVisible();
  console.log('PASS stale report returns to authoritative next step');

  test = await fixture({ nextStep: 9, healthDataConsent: false, assessment: { ...core, wellnessEligible: false } });
  await test.page.getByRole('button', { name: 'Start', exact: true }).click();
  await test.page.getByRole('button', { name: 'Generate my plan', exact: true }).click();
  await expect(test.page.getByText(/Please accept health data use/).first()).toBeVisible();
  if (test.writes.length) throw new Error('Unconfirmed data was submitted');
  console.log('PASS confirmations remain required');

  test = await fixture({ completed: true, nextStep: 10, state: 'completed' }, { paid: true, issue: true });
  await test.page.getByRole('button', { name: 'Edit answers', exact: true }).click();
  for (let step = 0; step < 9; step++) await test.page.getByRole('button', { name: 'Continue', exact: true }).click();
  await test.page.getByRole('button', { name: 'Save and update plan', exact: true }).click();
  await expect(test.page.getByRole('heading', { name: /Add your current/ })).toBeVisible();
  await expect(test.page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
  await expect(test.page.getByText(/Review the current weight/)).toBeVisible();
  console.log('PASS edited submit issues unlock correction while preserving draft');

  test = await fixture({ completed: true, nextStep: 10, state: 'completed' }, { paid: true });
  await expect(test.page.getByText(/contract-fixture-v1/)).toBeVisible();
  console.log('PASS report metadata visible');

  test = await fixture({ completed: true, nextStep: 10, state: 'completed' }, { dropPay: true });
  await test.page.getByRole('button', { name: 'Get my plan', exact: true }).first().click();
  await expect(test.page.getByText('Plan unlocked', { exact: true })).toBeVisible();
  if (test.payments.length !== 2 || test.payments[0].plan !== test.payments[1].plan) throw new Error('Payment retry changed plan or repeated unexpectedly');
  console.log('PASS lost pay response replays the same plan');
  console.log('Contract fixtures passed; real new-backend integration remains pending.');
} finally { await browser.close(); }
