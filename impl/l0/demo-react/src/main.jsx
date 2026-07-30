// main.jsx - React 应用,验证 L0+L1 在真实 React 下工作
import React from 'react';
import { createRoot } from 'react-dom/client';
import './runtime.js'; // 注入 L0 runtime + L1 helper(必须在 app 逻辑前)

// mock fetch(无后端也能跑)
globalThis.fetch = async (url) => {
  const data = { user: { name: 'Ada-Lovelace', level: 7, isVip: true, avatar: 'ada.png' } };
  return {
    json: async () => {
      // stampOrigin 由 L0 runtime 的 fetch patch 自动调用;mock 直接调
      const { stampOrigin } = await import('@wdpp/stamp-origin.js');
      stampOrigin(data, `GET ${url}`);
      return data;
    },
    clone() { return this; },
  };
};

function Profile({ data }) {
  return (
    <div>
      {/* 数据边:textContent 主通道 */}
      <h1>{data.user.name}</h1>
      {/* 变换:L1 插桩 toUpperCase,大写值出边 */}
      <h2>{data.user.name.toUpperCase()}</h2>
      {/* 相邻文本拼接:LV.{level} 两文本节点 */}
      <span>LV.{data.user.level}</span>
      {/* 属性边:src */}
      <img src={data.user.avatar} alt="" style={{ width: 40 }} />
      {/* 控制边:isVip && <em>VIP</em> -- 内联 JSX,L1 controlIndex 闭环 */}
      {data.user.isVip && <em>VIP</em>}
      {/* 反例:字面量无边 */}
      <p>写死的字面量</p>
    </div>
  );
}

async function main() {
  const res = await fetch('/users/42');
  const data = await res.json();
  const root = createRoot(document.getElementById('app'));
  root.render(<Profile data={data} />);

  // 延迟一帧让 React commit + DOM 写入完成
  setTimeout(() => {
    console.log('=== 全图 ===');
    console.log(window.__wdpp__.allEdges().map(e => ({
      field: e.fieldPath, attr: e.attr, type: e.type, conf: e.confidence,
    })));
  }, 100);
}

main();

// 点击反查
document.addEventListener('click', (e) => {
  let edges = window.__wdpp__.lookup(e.target);
  if (!edges.length && e.target.nodeType === 1) {
    for (const n of e.target.childNodes) {
      if (n.nodeType === 3) edges = edges.concat(window.__wdpp__.lookup(n));
    }
  }
  console.log('点选:', e.target.textContent?.slice(0, 20), '->', edges);
});
