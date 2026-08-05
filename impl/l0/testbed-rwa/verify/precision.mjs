// precision.mjs — rwa(cypress-realworld-app)交易流 precision/recall 测量
// oracle: data-test="transaction-<token>-<id>" 直接声明字段(token→field 映射)。
// 不依赖值匹配:每个带字段 data-test 的元素,期望字段由 token 决定,查 __wdpp__.lookup 校验。
// 四态:correct / wrong / missed;avatar(action 派生)不计入(M3)。
// react-virtualized:只测 DOM 中实际渲染的行(屏外行诚实排除)。
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:3000';
// data-test token → 响应字段(叶子)。avatar/action 是派生/属性,本轮不计。
const TOKEN_FIELD = {
  sender: 'senderName',
  receiver: 'receiverName',
  amount: 'amount',
  description: 'description',
  'like-count': 'likes',
  'comment-count': 'comments',
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (/error/i.test(m.type())) errors.push(`console.${m.type()}: ${m.text().slice(0,120)}`); });

// 捕获 transactions 响应(sanity:确认字段在响应里)
const records = [];
page.on('response', async (resp) => {
  try {
    const u = resp.url();
    if (u.includes('/transactions') && resp.request().method() === 'GET' && /json/.test(resp.headers()['content-type'] || '')) {
      const j = await resp.json();
      const arr = j && (j.results || j.transaction || j);
      if (Array.isArray(arr)) records.push(...arr);
      else if (arr) records.push(arr);
    }
  } catch {}
});

// 登录 Heath93 / s3cret(seed 用户,密码统一 s3cret)
await page.goto(`${BASE}/signin`, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(1500);
await page.locator('[data-test="signin-username"] input').fill('Heath93');
await page.locator('[data-test="signin-password"] input').fill('s3cret');
await page.locator('[data-test="signin-submit"]').click({ force: true });
// 登录后跳到 /(交易流)
await page.waitForURL((u) => !new URL(u).pathname.startsWith('/signin'), { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(2500);
console.log('after login:', page.url());

// 诊断:盖戳/边状态 + scanHydration
const diag = await page.evaluate(() => {
  const w = window.__wdpp__;
  const before = { edges: w?.allEdges?.()?.length, fields: w?.fieldCount?.() };
  w?.scanHydration?.();
  // 直接查一个已知值(响应里 senderName)
  const probe = w?.lookup ? (() => { const ns = document.querySelectorAll('[data-test^="transaction-sender"]'); for (const n of ns) { const t=n.innerText.trim(); if(t) return {text:t, edges: w.lookup(n).map(e=>e.fieldPath).slice(0,2)}; } return null; })() : null;
  return { before, afterScan: { edges: w?.allEdges?.()?.length, fields: w?.fieldCount?.() }, probe };
}).catch((e) => ({ err: e.message }));
console.log('=== diag ===', JSON.stringify(diag, null, 1));
await page.waitForTimeout(800);

const result = await page.evaluate((args) => {
  const { tokenField } = args;
  const wdpp = window.__wdpp__;
  const wdppOk = !!wdpp;
  const leaf = (fp) => { const m = String(fp).match(/"([^"]+)"\]$/); return m ? m[1] : String(fp).replace(/.*[,\[]/, ''); };
  const attrOf = (el) => {
    const s = new Set();
    if (!wdpp) return s;
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      const n = w.currentNode;
      if ((n.nodeValue || '').trim().length < 1) continue;
      wdpp.lookup(n).forEach((e) => s.add(leaf(e.fieldPath)));
    }
    // 也查 src 属性(avatar)
    return s;
  };

  let correct = 0, wrong = 0, missed = 0, skipped = 0;
  const perField = {}; Object.values(tokenField).forEach((f) => perField[f] = { correct: 0, wrong: 0, missed: 0 });
  const samples = { correct: [], wrong: [], missed: [] };

  // 找所有 transaction-* data-test 元素,按 token 归类
  const elems = [...document.querySelectorAll('[data-test]')];
  for (const el of elems) {
    const val = el.getAttribute('data-test') || '';
    if (!val.startsWith('transaction-')) continue;
    const rest = val.slice('transaction-'.length);
    // 匹配已知 token(精确 或 token-<id>)
    let token = null;
    for (const t of Object.keys(tokenField)) {
      if (rest === t || rest.startsWith(t + '-')) { token = t; break; }
    }
    if (!token) { skipped++; continue; } // avatar/action/item-header 等不计
    const expected = tokenField[token];
    const text = (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 32);
    if (!text) { skipped++; continue; } // 空文本(如 count=0 不渲染)
    const attributed = attrOf(el);
    let cls;
    if (attributed.has(expected)) { cls = 'correct'; correct++; perField[expected].correct++; }
    else if (attributed.size) { cls = 'wrong'; wrong++; perField[expected].wrong++; }
    else { cls = 'missed'; missed++; perField[expected].missed++; }
    if (samples[cls].length < 6) samples[cls].push({ token, expected, text, attributed: [...attributed] });
  }
  // M3:avatar 属性绑定(列表 item 内 img.src,期望 senderAvatar/receiverAvatar;无 data-test→靠属性通道)
  let avatarTotal = 0, avatarBound = 0, avatarMissed = 0;
  const avatarSamples = [];
  for (const item of document.querySelectorAll('[data-test^="transaction-item-"]')) {
    for (const img of item.querySelectorAll('img')) {
      const src = img.getAttribute('src') || '';
      if (!src || src.startsWith('data:')) continue; // 跳 base64/空
      avatarTotal++;
      const fields = new Set();
      (wdpp.lookup(img) || []).forEach((e) => fields.add(leaf(e.fieldPath)));
      const hit = [...fields].some((f) => /avatar/i.test(f));
      if (hit) avatarBound++; else avatarMissed++;
      if (avatarSamples.length < 6) avatarSamples.push({ src: src.slice(0, 40), fields: [...fields] });
    }
  }
  return { wdppOk, correct, wrong, missed, skipped, perField, samples, rowCount: document.querySelectorAll('[data-test^="transaction-item-"]').length, avatar: { total: avatarTotal, bound: avatarBound, missed: avatarMissed, samples: avatarSamples } };
}, { tokenField: TOKEN_FIELD });

const precision = (result.correct + result.wrong) ? (result.correct / (result.correct + result.wrong) * 100).toFixed(1) : 'n/a';
const recall = (result.correct + result.missed) ? (result.correct / (result.correct + result.missed) * 100).toFixed(1) : 'n/a';

console.log('=== rwa precision baseline ===');
console.log(`__wdpp__ present: ${result.wdppOk} | transactions captured: ${records.length} | rendered rows: ${result.rowCount} | skipped(avatar/action/empty): ${result.skipped}`);
console.log(`\nDATA CELLS  correct=${result.correct}  wrong=${result.wrong}  missed=${result.missed}`);
console.log(`\n>>> precision = ${precision}%   recall = ${recall}% <<<`);
console.log('\n--- 按 token→字段拆解 ---');
for (const [tok, fld] of Object.entries(TOKEN_FIELD)) {
  const p = result.perField[fld];
  const tot = p.correct + p.wrong + p.missed;
  console.log(`  ${tok.padEnd(14)} → ${fld.padEnd(12)} ${p.correct}/${tot}${p.wrong ? `  wrong=${p.wrong}` : ''}${p.missed ? `  missed=${p.missed}` : ''}${!tot ? '  (n/a)' : ''}`);
}
console.log('\n--- 样本 ---');
for (const cls of ['correct', 'wrong', 'missed']) {
  if (result.samples[cls].length) {
    console.log(`  [${cls}]`);
    result.samples[cls].forEach((s) => console.log(`     ${s.token}(${s.expected}): "${s.text}" → [${s.attributed.join(',')}]`));
  }
}

console.log('\n--- M3 avatar 属性绑定(img.src → senderAvatar/receiverAvatar) ---');
const av = result.avatar;
console.log(`  avatar imgs: ${av.total}  bound=${av.bound}  missed=${av.missed}`);
if (av.samples.length) {
  console.log(`  [${av.missed ? '样本(src→fields)' : 'bound 样本'}]`);
  av.samples.slice(0, 4).forEach((s) => console.log(`     src="${s.src}" fields=[${s.fields.join(',') || '(none)'}]`));
}

console.log('\nerrors:', errors.slice(-8).join('\n') || '(none)');
await browser.close();
