// main.jsx — React 入口
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { installWDPP } from './wdpp.js';

// 1. 安装 WDPP(必须在 React render 之前)
installWDPP({ expose: true });

// 2. React render
ReactDOM.createRoot(document.getElementById('root')).render(<App />);

// 3. 全局错误处理(让 WDPP 调试友好)
window.addEventListener('error', (e) => {
  console.error('[WDPP] Global error:', e.error?.message || e.message);
});
