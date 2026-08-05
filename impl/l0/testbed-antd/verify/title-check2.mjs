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
  const cells = row ? [...row.querySelectorAll('[data-wdpp-rec]')] : [];
  const dataTitles = cells.map(c => {
    const t = c.getAttribute('title') || '';
    return { text: c.textContent.trim().slice(0,14), rec: c.getAttribute('data-wdpp-rec'), path: (t.match(/字段路径:\n\s+(.+)/)||[])[1] || '(无 title)' };
  });
  const ui = { badge: document.querySelectorAll('.wdpp-badge').length, panel: !!document.getElementById('wdpp-panel'), outlined: document.querySelectorAll('[data-wdpp]').length };
  return { dataTitles, ui, recCount: document.querySelectorAll('[data-wdpp-rec]').length };
});
console.log('=== 数据格 title(data-wdpp-rec)===');
r.dataTitles.forEach(t => console.log(`  "${t.text}" [${t.rec}] → ${t.path}`));
console.log('\n=== UI 残留(应全 0/false)===');
console.log(JSON.stringify(r.ui));
console.log('data-wdpp-rec 总数:', r.recCount);
await p.screenshot({ path: 'title-only.png' });
await b.close();
