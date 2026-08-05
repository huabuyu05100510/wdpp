// login-debug.mjs — 正确选择器(input#username / button "Login")+ 完整 API 捕获
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8000';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const api = [];
page.on('request', (r) => {
  if (/\/api\/(login|currentUser|notices|captcha)/.test(r.url())) {
    let body = '';
    try { body = r.postData() ? ' body=' + r.postData().slice(0, 120) : ''; } catch {}
    api.push(`REQ ${r.method()} ${r.url()}${body}`);
  }
});
page.on('response', async (r) => {
  if (/\/api\/(login|currentUser|notices|captcha)/.test(r.url())) api.push(`RES ${r.status()} ${r.url()} :: ${(await r.text().catch(() => '')).slice(0, 160)}`);
});

await page.goto(`${BASE}/user/login`, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(1500);

await page.locator('input#username').fill('admin');
await page.locator('input#password').fill('ant.design');
console.log('username val:', await page.locator('input#username').inputValue());
console.log('password val:', await page.locator('input#password').inputValue());

await Promise.all([
  page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {}),
  page.getByRole('button', { name: 'Login' }).click(),
]);
await page.waitForTimeout(3000);
console.log('after submit url:', page.url());

console.log('=== API CALLS ===');
console.log(api.join('\n') || '(none)');
await browser.close();
