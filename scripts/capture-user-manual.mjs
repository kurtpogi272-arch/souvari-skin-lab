// Captures user-manual screenshots from the locally running Souvari Skin Lab app.
// Usage: node scripts/capture-user-manual.mjs
import { chromium } from 'playwright-chromium';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.CAPTURE_BASE || 'http://localhost:3000';
const OUT = path.resolve('docs/user-manual/screenshots');
fs.mkdirSync(OUT, { recursive: true });

const ACCOUNTS = {
  admin: { email: 'admin@iave.local', password: 'password123' },
  staff: { email: 'coronelcassandria@gmail.com', password: 'password123' },
  customer: { email: 'juan.delacruz@email.com', password: 'password123' },
};

const viewport = { width: 1440, height: 900 };

async function settle(page, ms = 1200) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(ms);
}

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  if (process.env.SKIP_EXISTING === '1' && fs.existsSync(file) && fs.statSync(file).size > 1000) {
    console.log(`  skip ${name}.png (exists)`);
    return;
  }
  await page.screenshot({ path: file, fullPage: false });
  console.log(`  saved ${name}.png`);
}

// Log in through the API and inject the token so protected routes work.
async function loginState(request, role) {
  const res = await request.post(`${BASE}/api/auth/login`, {
    data: ACCOUNTS[role],
  });
  const body = await res.json();
  const token = body?.data?.accessToken;
  if (!token) throw new Error(`Login failed for ${role}: ${JSON.stringify(body)}`);
  return token;
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    locale: 'en-US',
    timezoneId: 'Asia/Manila',
  });

  // Warm a request context for API logins.
  const api = context.request;

  // ---- PUBLIC (no auth) ----
  const page = await context.newPage();
  console.log('Public pages');

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await settle(page, 1500);
  await shot(page, '01-public-homepage');

  await page.goto(`${BASE}/services`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  await shot(page, '02-services');

  // Open the first service detail by clicking a service row.
  try {
    await page.goto(`${BASE}/services`, { waitUntil: 'domcontentloaded' });
    await settle(page);
    const firstService = page.locator('a[href^="/services/"]').first();
    if (await firstService.count()) {
      await firstService.click();
      await settle(page);
      await shot(page, '03-service-detail');
    }
  } catch (e) {
    console.log('  service detail skipped:', e.message);
  }

  await page.goto(`${BASE}/about`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  await shot(page, '04-about');

  await page.goto(`${BASE}/contact`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  await shot(page, '05-contact');

  // Register: fill the form but DO NOT submit.
  await page.goto(`${BASE}/register`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  await page.fill('input[name="first_name"], input#first_name', 'Sample').catch(() => {});
  await page.fill('input[placeholder="+63 917 123 4567"]', '+63 917 000 0000').catch(() => {});
  await shot(page, '06-register');

  // Login: fill email + password (password masked).
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  await page.fill('input[type="email"]', ACCOUNTS.customer.email).catch(() => {});
  await page.fill('input[type="password"]', ACCOUNTS.customer.password).catch(() => {});
  await shot(page, '07-login');

  await page.close();

  // ---- CUSTOMER ----
  console.log('Customer pages');
  const customerToken = await loginState(api, 'customer');
  const cust = await context.newPage();
  await cust.addInitScript((token) => {
    window.localStorage.setItem('auth_token', token);
  }, customerToken);

  // Booking flow (public, no auth needed to view steps).
  await cust.goto(`${BASE}/booking`, { waitUntil: 'domcontentloaded' });
  await settle(cust, 1500);
  await shot(cust, '08-booking-service');

  // Step: choose first category/service.
  try {
    const cat = cust.locator('button').filter({ hasText: /treatment/i }).first();
    if (await cat.count()) { await cat.click(); await settle(cust); }
    const svc = cust.locator('button').filter({ hasText: /min|₱|Free/i }).first();
    if (await svc.count()) { await svc.click(); await settle(cust); }
    await shot(cust, '09-booking-treatment');
    const cont = cust.getByRole('button', { name: /^Continue$/i }).first();
    if (await cont.count()) { await cont.click(); await settle(cust); }
    await shot(cust, '10-booking-schedule');
  } catch (e) { console.log('  booking steps note:', e.message); }

  // Customer app pages.
  const custPages = [
    ['/customer', '14-customer-dashboard'],
    ['/customer/appointments', '15-customer-appointments'],
    ['/customer/transactions', '17-customer-transactions'],
    ['/customer/membership', '19-customer-membership'],
    ['/customer/notifications', '20-customer-notifications'],
    ['/customer/profile', '21-customer-profile'],
    ['/customer/chat', '23-chatbot-conversation'],
  ];
  for (const [route, name] of custPages) {
    await cust.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
    await settle(cust, 1400);
    await shot(cust, name);
  }

  // Treatment history tab.
  try {
    await cust.goto(`${BASE}/customer/transactions`, { waitUntil: 'domcontentloaded' });
    await settle(cust);
    const tab = cust.getByRole('button', { name: /Treatment History/i }).first();
    if (await tab.count()) { await tab.click(); await settle(cust); await shot(cust, '18-customer-treatment-history'); }
  } catch (e) { console.log('  treatment history note:', e.message); }

  // Chatbot widget on the public homepage.
  try {
    await cust.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await settle(cust, 1200);
    const bubble = cust.locator('button[aria-label="Open chat"]').first();
    if (await bubble.count()) { await bubble.click(); await settle(cust, 1200); await shot(cust, '22-chatbot-widget'); }
  } catch (e) { console.log('  chatbot widget note:', e.message); }

  await cust.close();

  // ---- STAFF ----
  console.log('Staff pages');
  const staffToken = await loginState(api, 'staff');
  const stf = await context.newPage();
  await stf.addInitScript((token) => window.localStorage.setItem('auth_token', token), staffToken);
  const staffPages = [
    ['/staff', '24-staff-dashboard'],
    ['/staff/calendar', '25-staff-calendar'],
    ['/staff/appointments', '26-staff-appointments'],
    ['/staff/schedule', '27-staff-schedule'],
    ['/staff/products', '28-staff-products-pos'],
  ];
  for (const [route, name] of staffPages) {
    await stf.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
    await settle(stf, 1500);
    await shot(stf, name);
  }
  await stf.close();

  // ---- ADMIN ----
  console.log('Admin pages');
  const adminToken = await loginState(api, 'admin');
  const adm = await context.newPage();
  await adm.addInitScript((token) => window.localStorage.setItem('auth_token', token), adminToken);
  const adminPages = [
    ['/admin', '29-admin-dashboard'],
    ['/admin/calendar', '30-admin-calendar'],
    ['/admin/appointments', '31-admin-appointments'],
    ['/admin/customers', '32-admin-customers'],
    ['/admin/staff', '33-admin-staff'],
    ['/admin/shifts', '34-admin-shifts'],
    ['/admin/services', '35-admin-services'],
    ['/admin/services/new', '36-admin-new-service'],
    ['/admin/products', '37-admin-products'],
    ['/admin/inventory', '38-admin-inventory'],
    ['/admin/transactions', '39-admin-transactions'],
    ['/admin/analytics', '40-admin-analytics'],
    ['/admin/reviews', '41-admin-reviews'],
    ['/admin/settings', '42-admin-settings'],
  ];
  for (const [route, name] of adminPages) {
    await adm.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
    await settle(adm, 1600);
    await shot(adm, name);
  }
  await adm.close();

  await browser.close();
  console.log('\nDone. Screenshots in', OUT);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
