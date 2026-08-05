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
  let f = statusTd[fkey]; let d=0; let rec=null, dataIndex=null;
  while (f && d<80 && !rec) { const props=f.memoizedProps; if (props?.record && typeof props.record==='object') { rec=props.record; dataIndex = props.column?.dataIndex ?? props.dataIndex; } f=f.return; d++; }
  const recWdpp = rec?.__wdpp_fields;
  const bound = typeof w._bindFiberAll === 'function' ? w._bindFiberAll(document) : 'no _bindFiberAll';
  const w2 = document.createTreeWalker(statusTd, NodeFilter.SHOW_TEXT);
  const edges = [];
  while(w2.nextNode()){ const n=w2.currentNode; if(!n.nodeValue.trim())continue; if(n.parentElement?.closest('.wdpp-badge'))continue; edges.push({text:n.nodeValue.trim(), fp: w.lookup(n).map(e=>e.fieldPath).slice(0,2)}); }
  return { recFound: !!rec, dataIndex, recHasWdpp: !!recWdpp, statusPass: recWdpp?.status ? 'HAS_BIGINT' : 'NO', recOwnKeys: rec ? Object.keys(rec).slice(0,12) : [], bound, statusTdEdges: edges };
});
console.log(JSON.stringify(diag, null, 1));
await b.close();
