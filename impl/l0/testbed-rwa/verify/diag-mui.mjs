import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true });
const p = await b.newPage();
await p.goto('http://localhost:3000/signin', { waitUntil: 'domcontentloaded', timeout: 30000 });
await p.waitForTimeout(1500);
await p.locator('[data-test="signin-username"] input').fill('Heath93');
await p.locator('[data-test="signin-password"] input').fill('s3cret');
await p.locator('[data-test="signin-submit"]').click({ force: true });
await p.waitForURL(u => !new URL(u).pathname.startsWith('/signin'), { timeout: 20000 }).catch(()=>{});
await p.waitForTimeout(3000);
const diag = await p.evaluate(() => {
  const DATA_KEYS = ['senderName','receiverName','amount','likes','comments','transactionId'];
  const spans = [...document.querySelectorAll('[data-test="transaction-like-count"]')];
  const span = spans[0];
  const fkey = Object.keys(span).find(k => k.startsWith('__reactFiber$'));
  let f = span[fkey]; let depth = 0;
  const found = [];
  while (f && depth < 80) {
    const props = f.memoizedProps;
    const ftype = typeof f.type === 'function' ? (f.type.name || f.type.displayName || 'fn') : (typeof f.type === 'string' ? f.type : '?');
    if (props && typeof props === 'object') {
      for (const k of Object.keys(props)) {
        const v = props[k];
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          const keys = Object.keys(v);
          if (DATA_KEYS.some(dk => keys.includes(dk))) {
            found.push({ depth, fiberType: ftype, propKey: k, recKeys: keys.slice(0,12), hasWdpp: !!v.__wdpp_fields, inByVal: globalThis.__wdpp_byVal && keys.some(k2 => globalThis.__wdpp_byVal[v[k2]]) });
          }
        }
      }
    }
    f = f.return; depth++;
  }
  return { found };
});
console.log(JSON.stringify(diag, null, 1));
await b.close();
