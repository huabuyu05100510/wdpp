// diag-title.mjs - 验证 overlay title 是否加到规则表 cell
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8000';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(`${BASE}/user/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(1500);
await page.locator('input#username').fill('admin');
await page.locator('input#password').fill('ant.design');
await page.getByRole('button', { name: 'Login' }).click({ force: true });
await page.waitForURL((u) => !new URL(u).pathname.startsWith('/user/login'), { timeout: 20000 });
await page.waitForTimeout(1500);
await page.goto(`${BASE}/list/table-list`, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForSelector('.ant-table-tbody tr', { timeout: 60000 });
await page.waitForTimeout(2500);
await page.evaluate(() => window.__wdpp__?.scanHydration?.());
await page.waitForTimeout(3500); // 等 overlay paint(3s 周期)

const info = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.ant-table-tbody tr')];
  const row1 = rows[0];
  if (!row1) return { error: 'no row' };
  const tds = [...row1.querySelectorAll('td')];
  const cells = tds.slice(0, 6).map((td, i) => ({
    col: i,
    text: (td.innerText || '').trim().slice(0, 24),
    tdTitle: td.getAttribute('title')?.slice(0, 90) || null,
    childWithTitle: [...td.querySelectorAll('[title]')].map((e) => ({ tag: e.tagName, cls: (e.className || '').slice(0, 30), title: (e.getAttribute('title') || '').slice(0, 70) })),
  }));
  const allTitled = document.querySelectorAll('.ant-table-tbody [title]').length;
  return { cells, totalTitledInTbody: allTitled };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
