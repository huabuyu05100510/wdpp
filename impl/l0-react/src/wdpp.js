// wdpp.js — 简化的 WDPP 运行时,适用于 React 组件
// taint 用 WeakMap 存,不包装对象 → React 看到原始值,无渲染错误

import React from 'react';
import { stampOrigin, installProducers } from '../../l0-graph/src/stamp-origin.js';
import { installSink } from '../../l0-graph/src/dom-sink.js';
import { getTaint } from '../../l0-graph/src/labeled-box.js';

let _installed = false;

export function installWDPP({ expose = true } = {}) {
  if (_installed) return;
  _installed = true;

  installProducers();
  installSink();

  if (expose && typeof window !== 'undefined') {
    window.__wdpp__ = {
      stampOrigin,
      getTaint,
      scanHydration: () => {
        const sections = document.querySelectorAll('[data-wdpp-section]');
        for (const section of sections) {
          const api = section.dataset.wdppSection;
          section.setAttribute('data-wdpp-apis', api);
          section.setAttribute('title', `📡 APIs: ${api}`);
          for (const el of section.querySelectorAll('*')) {
            if (!el.getAttribute('data-wdpp-apis')) {
              let cur = el;
              const apis = new Set();
              while (cur) {
                if (cur.dataset?.wdppSection) apis.add(cur.dataset.wdppSection);
                cur = cur.parentElement;
              }
              if (apis.size > 0) {
                const list = [...apis];
                el.setAttribute('data-wdpp-apis', list.join(','));
                el.setAttribute('title', `📡 APIs: ${list.join(' | ')}`);
              }
            }
          }
        }
      },
    };
  }
}

/**
 * React Hook:fetch + stamp 数据
 */
export function useAPIData(apiPath) {
  const [state, setState] = React.useState({ data: null, loading: true, error: null });

  React.useEffect(() => {
    let cancelled = false;
    fetch(apiPath)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        const stamped = stampOrigin(data, `GET ${apiPath}`);
        setState({ data: stamped, loading: false, error: null });
      })
      .catch(err => {
        if (cancelled) return;
        setState({ data: null, loading: false, error: err });
      });
    return () => { cancelled = true; };
  }, [apiPath]);

  return state;
}

// React hook 引用(从 React 导出,组件用)
