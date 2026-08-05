import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { transformSync } from '@babel/core';
import wdppPlugin from '../babel/plugin.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const L0_ROOT = resolve(__dirname, '..'); // impl/l0
const APP = /\/src\/.*\.[jt]sx?$/;

function wdppL1() {
  return {
    name: 'wdpp-l1',
    enforce: 'pre',
    transform(code, id) {
      if (!APP.test(id)) return null;            // 只转 app 代码
      if (id.includes('/node_modules/')) return null;
      if (id.endsWith('runtime.js')) return null; // 排除 WDPP 注入代码(install 被 __recover 包会依赖循环)
      if (id.includes('/impl/l0/src/')) return null; // 排除 WDPP 库自身(__recover 函数体被插桩→无限递归)
      const out = transformSync(code, {
        filename: id,
        presets: ['@babel/preset-react'],
        plugins: [[wdppPlugin, { l2: true }]],
        sourceMaps: true,
      });
      return { code: out.code, map: out.map };
    },
  };
}

export default {
  plugins: [wdppL1()],
  resolve: {
    alias: {
      '@wdpp': resolve(L0_ROOT, 'src'),
    },
  },
  esbuild: { jsx: 'automatic' },
};
