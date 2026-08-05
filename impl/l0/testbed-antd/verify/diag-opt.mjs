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
  const optEl = document.querySelector('.ant-table-tbody tr [data-wdpp-rec="rec"]');
  if (!optEl) return { err: 'no rec el' };
  const fkey = Object.keys(optEl).find(k => k.startsWith('__reactFiber$'));
  let f = optEl[fkey]; const chain = []; let d = 0;
  while (f && d < 50) {
    const props = f.memoizedProps;
    if (props && (props.column || props.record)) chain.push({ d, type: typeof f.type==='function'?(f.type.name||'fn'):(typeof f.type), vt: props.column?.valueType, di: props.column?.dataIndex, hasRec: !!props.record });
    f = f.return; d++;
  }
  return { chain };
});
console.log(JSON.stringify(r, null, 1));
await b.close();
