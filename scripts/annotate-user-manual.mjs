// Creates annotated screenshots (arrows / boxes / labels) by reopening each page
// in Playwright, locating the real UI elements, and drawing an SVG overlay on top.
// Usage: node scripts/annotate-user-manual.mjs
import { chromium } from 'playwright-chromium';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.CAPTURE_BASE || 'http://localhost:3000';
const OUT = path.resolve('docs/user-manual/screenshots/annotated');
fs.mkdirSync(OUT, { recursive: true });

const ACCOUNTS = {
  admin: { email: 'admin@iave.local', password: 'password123' },
  staff: { email: 'coronelcassandria@gmail.com', password: 'password123' },
  customer: { email: 'juan.delacruz@email.com', password: 'password123' },
};

const viewport = { width: 1440, height: 900 };

async function settle(page, ms = 1500) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(ms);
}

async function loginToken(acct) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(acct),
  });
  const j = await r.json();
  if (!j?.data?.accessToken) throw new Error('login ' + JSON.stringify(j));
  return j.data.accessToken;
}

// marks: [{ selector?, nth?, label, labelPos?: 'above'|'below', arrow?: bool }]
async function annotate(page, marks, fileName) {
  const items = [];
  for (const m of marks) {
    if (!m.selector) continue;
    const loc = page.locator(m.selector);
    const idx = m.nth || 0;
    if ((await loc.count()) <= idx) continue;
    const box = await loc.nth(idx).boundingBox();
    if (!box) continue;
    items.push({ ...m, box });
  }

  const drawn = await page.evaluate((items) => {
    const NS = 'http://www.w3.org/2000/svg';
    const w = window.innerWidth;
    const h = window.innerHeight;
    const root = document.createElementNS(NS, 'svg');
    root.setAttribute('width', w);
    root.setAttribute('height', h);
    root.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none';
    const ACCENT = '#e11d48';
    const defs = document.createElementNS(NS, 'defs');
    defs.innerHTML =
      `<marker id="ah" markerWidth="10" markerHeight="10" refX="7" refY="3" orient="auto" markerUnits="strokeWidth">` +
      `<path d="M0,0 L7,3 L0,6 z" fill="${ACCENT}"/></marker>`;
    root.appendChild(defs);

    let count = 0;
    for (const it of items) {
      const b = it.box;
      if (!b) continue;
      const pad = 4;
      const x = Math.max(0, b.x - pad);
      const y = Math.max(0, b.y - pad);
      const bw = Math.min(w - x, b.width + pad * 2);
      const bh = Math.min(h - y, b.height + pad * 2);
      count++;

      const r = document.createElementNS(NS, 'rect');
      r.setAttribute('x', x);
      r.setAttribute('y', y);
      r.setAttribute('width', bw);
      r.setAttribute('height', bh);
      r.setAttribute('rx', 6);
      r.setAttribute('fill', 'none');
      r.setAttribute('stroke', ACCENT);
      r.setAttribute('stroke-width', 2.5);
      root.appendChild(r);

      const labelText = it.label;
      const fontSize = 15;
      const tw = labelText.length * fontSize * 0.6 + 22;
      const th = 28;
      let lx = Math.min(Math.max(8, x), w - tw - 8);
      const placeAbove = (it.labelPos || 'above') === 'above';
      let ly = placeAbove ? y - th - 10 : y + bh + 10;
      if (ly < 8) ly = y + bh + 10;
      if (ly + th > h - 8) ly = y - th - 10;

      const rect = document.createElementNS(NS, 'rect');
      rect.setAttribute('x', lx);
      rect.setAttribute('y', ly);
      rect.setAttribute('width', tw);
      rect.setAttribute('height', th);
      rect.setAttribute('rx', 6);
      rect.setAttribute('fill', ACCENT);
      root.appendChild(rect);

      const text = document.createElementNS(NS, 'text');
      text.setAttribute('x', lx + 11);
      text.setAttribute('y', ly + 19);
      text.setAttribute('fill', '#fff');
      text.setAttribute('font-family', 'Arial, Helvetica, sans-serif');
      text.setAttribute('font-size', fontSize);
      text.setAttribute('font-weight', '700');
      text.textContent = labelText;
      root.appendChild(text);

      if (it.arrow !== false) {
        const fromX = lx + tw / 2;
        const fromY = placeAbove ? ly + th : ly;
        const toX = x + bw / 2;
        const toY = placeAbove ? y : y + bh;
        const line = document.createElementNS(NS, 'path');
        line.setAttribute('d', `M ${fromX} ${fromY} L ${toX} ${toY}`);
        line.setAttribute('stroke', ACCENT);
        line.setAttribute('stroke-width', 2.5);
        line.setAttribute('fill', 'none');
        line.setAttribute('marker-end', 'url(#ah)');
        root.appendChild(line);
      }
    }
    document.body.appendChild(root);
    return count;
  }, items);

  await page.screenshot({ path: path.join(OUT, `${fileName}.png`), fullPage: false });
  await page.evaluate(() => {
    document.querySelectorAll('svg[style*="2147483647"]').forEach((e) => e.remove());
  });
  console.log(`  annotated ${fileName}.png (${drawn} marks)`);
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, locale: 'en-US', timezoneId: 'Asia/Manila' });

  // ---------- PUBLIC ----------
  const pub = await context.newPage();
  await pub.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await settle(pub, 1800);
  await annotate(pub, [
    { selector: 'nav a[href="/services"]', label: 'Navigation Menu', labelPos: 'below' },
    { selector: 'nav a[href="/contact"]', label: 'Contact', labelPos: 'below' },
    { selector: 'nav a[href="/booking"]', label: 'Book Appointment', labelPos: 'below' },
    { selector: 'nav a[href="/login"]', label: 'Sign In', labelPos: 'below' },
    { selector: 'header img, nav img', label: 'Clinic Logo', labelPos: 'below' },
  ], 'A01-public-homepage');

  await pub.goto(`${BASE}/services`, { waitUntil: 'domcontentloaded' });
  await settle(pub);
  await annotate(pub, [
    { selector: 'h1', label: 'Browse Services', labelPos: 'below' },
    { selector: 'a[href^="/services/"]', label: 'Open Service Details', labelPos: 'below' },
  ], 'A02-services');

  await pub.goto(`${BASE}/booking`, { waitUntil: 'domcontentloaded' });
  await settle(pub, 1800);
  await annotate(pub, [
    { selector: 'h1', label: 'Book an Appointment', labelPos: 'below' },
  ], 'A03-booking-service');
  await pub.close();

  // ---------- CUSTOMER ----------
  const custToken = await loginToken(ACCOUNTS.customer);
  const cust = await context.newPage();
  await cust.addInitScript((t) => window.localStorage.setItem('auth_token', t), custToken);

  await cust.goto(`${BASE}/customer`, { waitUntil: 'domcontentloaded' });
  await settle(cust, 1800);
  await annotate(cust, [
    { selector: 'h1', nth: 1, label: 'Customer Dashboard', labelPos: 'below' },
    { selector: 'h2', label: 'Upcoming Appointment', labelPos: 'below' },
    { selector: 'a[href="/customer/book"]', label: 'Book Appointment', labelPos: 'below' },
    { selector: 'a[href="/customer/appointments"]', label: 'My Appointments', labelPos: 'below' },
  ], 'A04-customer-dashboard');

  await cust.goto(`${BASE}/customer/appointments`, { waitUntil: 'domcontentloaded' });
  await settle(cust);
  await annotate(cust, [
    { selector: 'h1', nth: 1, label: 'Appointment List', labelPos: 'below' },
    { selector: 'table', label: 'Status and Actions', labelPos: 'below' },
  ], 'A05-customer-appointments');

  await cust.goto(`${BASE}/customer/transactions`, { waitUntil: 'domcontentloaded' });
  await settle(cust);
  await annotate(cust, [
    { selector: 'button:has-text("Transactions")', label: 'Transactions Tab', labelPos: 'below' },
    { selector: 'button:has-text("Treatment History")', label: 'Treatment History Tab', labelPos: 'below' },
  ], 'A06-customer-transactions');

  await cust.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await settle(cust, 1500);
  const bubble = cust.locator('button[aria-label="Open chat"]').first();
  if (await bubble.count()) { await bubble.click(); await settle(cust, 1400); }
  await annotate(cust, [
    { selector: 'text=Clinic Assistant', label: 'AI Chatbot', labelPos: 'below' },
    { selector: 'input[placeholder="Type a message..."]', label: 'Type a Message', labelPos: 'above' },
    { selector: 'button[aria-label="Send message"]', label: 'Send Button', labelPos: 'above' },
  ], 'A07-chatbot');
  await cust.close();

  // ---------- STAFF ----------
  const staffToken = await loginToken(ACCOUNTS.staff);
  const stf = await context.newPage();
  await stf.addInitScript((t) => window.localStorage.setItem('auth_token', t), staffToken);

  await stf.goto(`${BASE}/staff`, { waitUntil: 'domcontentloaded' });
  await settle(stf, 1800);
  await annotate(stf, [
    { selector: 'h1', nth: 1, label: 'Staff Dashboard', labelPos: 'below' },
    { selector: 'text=Today\'s Schedule', label: "Today's Schedule", labelPos: 'below' },
    { selector: 'a[href="/staff/calendar"]', label: 'Calendar', labelPos: 'below' },
    { selector: 'a[href="/staff/appointments"]', label: 'Appointments', labelPos: 'below' },
  ], 'A08-staff-dashboard');

  await stf.goto(`${BASE}/staff/calendar`, { waitUntil: 'domcontentloaded' });
  await settle(stf, 1800);
  await annotate(stf, [
    { selector: 'h1', nth: 1, label: 'Appointment Calendar', labelPos: 'below' },
    { selector: 'button:has-text("New Appointment")', label: 'Create Booking', labelPos: 'below' },
  ], 'A09-staff-calendar');
  await stf.close();

  // ---------- ADMIN ----------
  const adminToken = await loginToken(ACCOUNTS.admin);
  const adm = await context.newPage();
  await adm.addInitScript((t) => window.localStorage.setItem('auth_token', t), adminToken);

  await adm.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await settle(adm, 2000);
  await annotate(adm, [
    { selector: 'h1', nth: 1, label: 'Administrator Dashboard', labelPos: 'below' },
    { selector: 'text=Revenue (This Month)', label: 'Key Statistics', labelPos: 'below' },
    { selector: 'text=Sales — Revenue Over Time', label: 'Revenue Chart', labelPos: 'below' },
    { selector: 'text=Low Stock Alerts', label: 'Low Stock Alerts', labelPos: 'below' },
  ], 'A10-admin-dashboard');

  await adm.goto(`${BASE}/admin/analytics`, { waitUntil: 'domcontentloaded' });
  await settle(adm, 2200);
  await annotate(adm, [
    { selector: 'h1', nth: 1, label: 'Descriptive Analytics', labelPos: 'below' },
    { selector: 'select[aria-label="Date range preset"]', label: 'Date Range Filter', labelPos: 'below' },
    { selector: 'text=Total Revenue', label: 'Revenue Summary', labelPos: 'below' },
    { selector: 'text=Top Services', label: 'Popular Services', labelPos: 'below' },
  ], 'A11-admin-analytics');

  await adm.goto(`${BASE}/admin/inventory`, { waitUntil: 'domcontentloaded' });
  await settle(adm, 1800);
  await annotate(adm, [
    { selector: 'h1', nth: 1, label: 'Inventory Management', labelPos: 'below' },
    { selector: 'button:has-text("Adjust Stock")', label: 'Adjust Stock', labelPos: 'below' },
    { selector: 'button:has-text("Record Purchase")', label: 'Record Purchase', labelPos: 'below' },
    { selector: 'text=Low Stock Alert', label: 'Low Stock Indicator', labelPos: 'below' },
  ], 'A12-admin-inventory');

  await adm.goto(`${BASE}/admin/services`, { waitUntil: 'domcontentloaded' });
  await settle(adm);
  await annotate(adm, [
    { selector: 'h1', nth: 1, label: 'Services Management', labelPos: 'below' },
    { selector: 'button:has-text("Add Service")', label: 'Add New Service', labelPos: 'below' },
  ], 'A13-admin-services');

  await adm.goto(`${BASE}/admin/products`, { waitUntil: 'domcontentloaded' });
  await settle(adm);
  await annotate(adm, [
    { selector: 'h1', nth: 1, label: 'Products Management', labelPos: 'below' },
    { selector: 'button:has-text("Add Product")', label: 'Add New Product', labelPos: 'below' },
  ], 'A14-admin-products');

  await adm.goto(`${BASE}/admin/staff`, { waitUntil: 'domcontentloaded' });
  await settle(adm);
  await annotate(adm, [
    { selector: 'h1', nth: 1, label: 'Team Management', labelPos: 'below' },
    { selector: 'button:has-text("Add Staff")', label: 'Add Staff Member', labelPos: 'below' },
  ], 'A15-admin-staff');

  await adm.goto(`${BASE}/admin/customers`, { waitUntil: 'domcontentloaded' });
  await settle(adm);
  await annotate(adm, [
    { selector: 'h1', nth: 1, label: 'Customer Management', labelPos: 'below' },
    { selector: 'button:has-text("Add Customer")', label: 'Add Customer', labelPos: 'below' },
  ], 'A16-admin-customers');

  await adm.goto(`${BASE}/admin/transactions`, { waitUntil: 'domcontentloaded' });
  await settle(adm);
  await annotate(adm, [
    { selector: 'h1', nth: 1, label: 'Transactions', labelPos: 'below' },
    { selector: 'button:has-text("Export PDF")', label: 'Export PDF', labelPos: 'below' },
    { selector: 'button:has-text("Export Excel")', label: 'Export Excel', labelPos: 'below' },
  ], 'A17-admin-transactions');

  await adm.goto(`${BASE}/admin/settings`, { waitUntil: 'domcontentloaded' });
  await settle(adm);
  await annotate(adm, [
    { selector: 'h1', nth: 1, label: 'System Settings', labelPos: 'below' },
    { selector: 'text=Business Hours', label: 'Business Hours', labelPos: 'below' },
    { selector: 'text=Days We Are Open', label: 'Open Days', labelPos: 'below' },
  ], 'A18-admin-settings');
  await adm.close();

  await browser.close();
  console.log('\nAnnotated screenshots in', OUT);
}

main().catch((e) => { console.error(e); process.exit(1); });
