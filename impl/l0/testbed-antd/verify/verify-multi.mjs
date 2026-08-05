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
async function checkPage(path) {
  await p.goto('http://localhost:8000' + path, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(()=>{});
  await p.waitForTimeout(3500);
  await p.evaluate(() => window.__wdpp__?.scanHydration?.()).catch(()=>{});
  await p.waitForTimeout(800);
  const r = await p.evaluate(() => {
    const titled = [...document.querySelectorAll('[title^="WDPP"]')];
    return { count: titled.length, samples: titled.slice(0,4).map(e => {
      const t = e.getAttribute('title')||'';
      return { text: (e.textContent||'').trim().slice(0,14), path: (t.match(/字段路径:\n\s+(.+)/)||[])[1]?.slice(0,50) || '(无)' };
    })};
  });
  console.log(`\n=== ${path} : ${r.count} 个 title ===`);
  r.samples.forEach(s => console.log(`  "${s.text}" → ${s.path}`));
}
await checkPage('/list/table-list');
await checkPage('/list/card-list');
await checkPage('/list/basic-list');
await checkPage('/profile/basic');
await b.close();
