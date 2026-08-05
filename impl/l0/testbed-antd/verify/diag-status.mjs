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
  const bitCnt = (p) => { let c=0; while(p){c+=Number(p&1n);p>>=1n;} return c; };
  const statusCell = document.querySelector('[data-wdpp-rec="status"]');
  const fkey = Object.keys(statusCell).find(k => k.startsWith('__reactFiber$'));
  let f = statusCell[fkey], rec=null, dataIndex=null;
  while (f) { const props = f.memoizedProps; if (props?.record) { rec = props.record; dataIndex = props.column?.dataIndex ?? props.dataIndex; break; } f = f.return; }
  const byVal = globalThis.__wdpp_byVal;
  const src = [];
  let mergedStatus = 0n;
  for (const k of Object.keys(rec)) {
    const v = rec[k];
    if (v==null||typeof v==='object') continue;
    const fm = byVal[v];
    if (fm) { src.push({k, v:String(v).slice(0,16), statusCnt: bitCnt(fm.status||0n), keysCnt: Object.keys(fm).length}); mergedStatus |= fm.status||0n; }
  }
  return { dataIndex, recStatusType: typeof rec.status, recStatusVal: rec.status, mergedStatusCnt: bitCnt(mergedStatus), src: src.slice(0,6) };
});
console.log(JSON.stringify(r, null, 1));
await b.close();
