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
const diag = await p.evaluate(async () => {
  // 手动 fetch(经 fetch patch → stampOrigin)
  const r = await fetch('/api/rule?current=1&pageSize=5');
  const d = await r.json();
  const rec0 = d?.data?.[0];
  // ProTable 的 record(fiber)
  await new Promise(rr => setTimeout(rr, 500));
  const rows = [...document.querySelectorAll('.ant-table-tbody tr')];
  const tds = [...rows[0].querySelectorAll('td')];
  const pureText = td => { const c=td.cloneNode(true); c.querySelectorAll('.wdpp-badge').forEach(e=>e.remove()); return (c.textContent||'').trim(); };
  let nameIdx = -1;
  for (let i=0;i<tds.length;i++){ if(pureText(tds[i]).startsWith('TradeCode')){nameIdx=i;break;} }
  const statusTd = tds[nameIdx+3];
  const fkey = Object.keys(statusTd).find(k => k.startsWith('__reactFiber$'));
  let f = statusTd[fkey]; let dd=0; let frec=null;
  while (f && dd<80 && !frec) { const props=f.memoizedProps; if (props?.record && typeof props.record==='object') frec=props.record; f=f.return; dd++; }
  // 找 fetch rec 中 status===frec.status 的(同 record)
  const matchFetch = d?.data?.find(x => x.status === frec?.status && x.name === frec?.name);
  return {
    fetchRec0Has: !!rec0?.__wdpp_fields,
    fetchRec0OwnKeys: rec0 ? Object.keys(rec0).slice(0,15) : [],
    fiberRecHas: !!frec?.__wdpp_fields,
    matchFetchHas: !!matchFetch?.__wdpp_fields,
    matchFetchSameRef: matchFetch && frec ? matchFetch === frec : false,
    frecStatus: frec?.status, frecName: frec?.name,
  };
});
console.log(JSON.stringify(diag, null, 1));
await b.close();
