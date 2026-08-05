import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true });
const p = await b.newPage();
await p.goto('http://localhost:8000/user/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
await p.waitForTimeout(2000);
await p.locator('input#username').fill('admin');
await p.locator('input#password').fill('ant.design');
await p.getByRole('button', { name: 'Login' }).click({ force: true });
await p.waitForURL(u => !new URL(u).pathname.startsWith('/user/login'), { timeout: 20000 });
await p.waitForTimeout(1500);
await p.goto('http://localhost:8000/list/table-list', { waitUntil: 'domcontentloaded', timeout: 30000 });
await p.waitForSelector('.ant-table-tbody tr', { timeout: 60000 });
await p.waitForTimeout(3000);
const diag = await p.evaluate(() => {
  const w = window.__wdpp__;
  const rows = [...document.querySelectorAll('.ant-table-tbody tr')];
  const tds = [...rows[0].querySelectorAll('td')];
  const pureText = td => { const c=td.cloneNode(true); c.querySelectorAll('.wdpp-badge').forEach(e=>e.remove()); return (c.textContent||'').trim(); };
  let nameIdx = -1;
  for (let i=0;i<tds.length;i++){ if(pureText(tds[i]).startsWith('TradeCode')){nameIdx=i;break;} }
  const statusTd = tds[nameIdx+3];
  const fkey = Object.keys(statusTd).find(k => k.startsWith('__reactFiber$'));
  let f = statusTd[fkey]; let d = 0;
  let ds = null, idx = null, recInfo = null;
  while (f && d < 80) {
    const props = f.memoizedProps;
    if (props) {
      if (!recInfo && props.record && typeof props.record === 'object') recInfo = { d, status: props.record.status, dataIndex: props.column?.dataIndex ?? props.dataIndex };
      if (ds === null && Array.isArray(props.dataSource)) ds = props.dataSource;
      if (idx === null && props.index != null) idx = props.index;
    }
    f = f.return; d++;
  }
  const orig = (ds != null && idx != null) ? ds[idx] : null;
  const smOrig = (orig && w._smGet) ? w._smGet(orig, 'status') : 0n;
  return { recInfo, hasDs: ds !== null, dsLen: ds?.length, idx, origStatus: orig?.status, smOrigHas: smOrig > 0n };
});
console.log(JSON.stringify(diag, null, 1));
await b.close();
