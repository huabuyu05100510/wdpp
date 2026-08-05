// server.js — 真实 mock API + 静态文件服务
// 同时提供 /api/* JSON 接口(被 WDPP fetch 拦截盖戳)
// 和 demo 静态资源

import { createServer } from 'http';
import { readFileSync, statSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PORT = 8080;

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

// ============ 真实 Mock API 数据 ============
const DB = {
  'GET /api/user': {
    id: 1,
    name: 'Alice Chen',
    email: 'alice@example.com',
    city: 'Shanghai',
    isVIP: true,
    memberSince: '2024-03-15',
  },
  'GET /api/orders': [
    { id: 101, product: 'Laptop Pro 14', price: 1299, status: 'shipped', qty: 1 },
    { id: 102, product: 'Wireless Mouse', price: 29, status: 'pending', qty: 2 },
    { id: 103, product: 'USB-C Hub', price: 79, status: 'delivered', qty: 1 },
  ],
  'GET /api/products': [
    { id: 201, name: 'Widget A', price: 49.99, stock: 120 },
    { id: 202, name: 'Widget B', price: 29.99, stock: 85 },
    { id: 203, name: 'Widget C', price: 89.99, stock: 42 },
  ],
  'GET /api/stats': {
    totalUsers: 1234,
    totalOrders: 567,
    revenue: 89012,
  },
};

function routeApi(method, pathname) {
  const key = `${method} ${pathname}`;
  const data = DB[key];
  if (data !== undefined) {
    return { status: 200, body: JSON.stringify(data) };
  }
  return { status: 404, body: JSON.stringify({ error: 'Not found', key }) };
}

// ============ HTTP 服务器 ============
const server = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // CORS 头(允许 dev 环境跨域)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API 路由
  if (pathname.startsWith('/api/')) {
    const { status, body } = routeApi(req.method, pathname);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(body);
    return;
  }

  // 静态文件
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = join(__dirname, filePath);

  try {
    const stat = statSync(filePath);
    if (!stat.isFile()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = extname(filePath);
    const mime = MIME[ext] || 'text/plain';
    const content = readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': mime });
    res.end(content);
  } catch (e) {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`🌐 WDPP Graph Engine Demo running at:`);
  console.log(`   http://localhost:${PORT}/`);
  console.log(``);
  console.log(`📡 Real Mock APIs (will be intercepted by WDPP):`);
  console.log(`   - GET /api/user    → user profile`);
  console.log(`   - GET /api/orders  → order list`);
  console.log(`   - GET /api/products→ product list`);
  console.log(`   - GET /api/stats   → dashboard stats`);
  console.log(``);
  console.log(`🎯 Open browser to see provenance graph:`);
  console.log(`   - Hover any element with 📡 icon to see its APIs`);
  console.log(`   - Click "Update Status" to test field mutation taint`);
  console.log(`   - Open DevTools console for graph inspection`);
});
