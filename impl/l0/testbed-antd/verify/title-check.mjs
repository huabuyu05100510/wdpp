import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true });
const p = await b.newPage();
await p.goto('http://localhost:8000/user/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
await p.waitForTimeout(2000);
await p.locator('input#username').fill('admin');
await p.locator('input#password').fill('ant.design');
await p.getByRole('button', { name: 'Login' }).click({ force: true });
await p.waitForURL(u => !new URL(u).pathname.startsWith('/user/login'), { timeout: 20000 });
await p.goto('http://localhost:8000/list/table-list', { waitUntil: 'domcontentloaded', timeout: 30000 });
await p.waitForSelector('.ant-table-tbody tr', { timeout: 60000 });
await p.waitForTimeout(3500);
const r = await p.evaluate(() => {
  const row = document.querySelector('.ant-table-tbody tr');
  const tds = [...row.querySelectorAll('td')];
  const out = tds.map(td => {
    const c = td.cloneNode(true); c.querySelectorAll('.wdpp-badge').forEach(e=>e.remove());
    const t = td.getAttribute('title') || td.querySelector('[title^="WDPP"]')?.getAttribute('title') || '';
    const ep = (t.match(/来源接口:\n\s+(.+)/) || [])[1] || '';
    const path = (t.match(/字段路径:\n\s+(.+)/) || [])[1] || '';
    return { text: (c.textContent||'').trim().slice(0,16), hasTitle: !!t, ep: ep.slice(0,45), path: path.slice(0,55) };
  });
  return { out, total: document.querySelectorAll('.ant-table-tbody [title^="WDPP"]').length };
});
console.log('=== 第一行各列 title 覆盖 ===');
r.out.forEach((t,i) => console.log(`[col${i}] "${t.text}" ${t.hasTitle?'✓':'✗'} ${t.hasTitle? '→ '+t.path : ''}`));
console.log(`\n表体 WDPP title 元素总数: ${r.total}`);
await p.screenshot({ path: 'title-overlay.png' });
await b.close();
