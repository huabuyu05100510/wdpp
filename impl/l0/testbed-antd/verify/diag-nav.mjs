// diag-nav.mjs - 登录 + 查边 + 点导航抓 404/错误
import { chromium } from 'playwright';
const BASE = 'http://localhost:8000';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(`PAGEERROR: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errs.push(`console.error: ${m.text()}`); });

// 登录
await page.goto(`${BASE}/user/login`, { waitUntil: 'networkidle' });
await page.fill('input#username', 'admin');
await page.fill('input#password', 'ant.design');
await Promise.all([page.waitForURL((u) => !u.pathname.includes('/user/login'), { timeout: 20000 }), page.getByRole('button', { name: 'Login' }).click()]);
console.log('登录后 URL:', page.url());

// 去 table-list
await page.goto(`${BASE}/list/table-list`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await page.evaluate(() => window.__wdpp__?.scanHydration?.());
await page.waitForTimeout(1000);

// 查一个 name 单元格的边
const cellInfo = await page.evaluate(() => {
  const cells = [...document.querySelectorAll('.ant-table-tbody td')];
  const sample = [];
  for (const td of cells.slice(0, 10)) {
    const tn = td.querySelector('span') || td.firstChild;
    const text = (td.textContent || '').trim().slice(0, 20);
    const edges = tn ? window.__wdpp__.lookup(tn.nodeType === 3 ? tn : (td.querySelector('span')?.firstChild || tn)) : [];
    const confs = [...new Set(edges.map(e => e.confidence))];
    const fields = [...new Set(edges.map(e => e.fieldPath).filter(Boolean))].slice(0, 2);
    sample.push({ text, confs, fields, hasTitle: td.closest('[title]')?.getAttribute('title')?.slice(0, 30) || td.getAttribute('title')?.slice(0,30) });
  }
  return { edgeCount: window.__wdpp__.allEdges().length, sample };
}).catch(e => ({ evalErr: e.message }));
console.log('=== table-list 边 ===');
console.log(JSON.stringify(cellInfo, null, 2));

// 点导航:试几个菜单
console.log('=== 点击导航 ===');
for (const path of ['/account/center', '/list/card-list', '/404test']) {
  errs.length = 0;
  try {
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 15000 });
    const is404 = await page.evaluate(() => /404|Not Found/i.test(document.body.textContent || ''));
    console.log(`${path} -> URL=${page.url().replace(BASE,'')} 404页=${is404} 错误数=${errs.length}`);
    if (errs.length) console.log('  ', errs.slice(0, 4).join('\n   '));
  } catch (e) {
    console.log(`${path} -> 导航异常: ${e.message}`);
    if (errs.length) console.log('  ', errs.slice(0, 4).join('\n   '));
  }
}
await browser.close();
