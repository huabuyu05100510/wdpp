// babel-compile.conformance.js - Babel 编译产物测试
// 验证:babel/plugin.js 的新 visitors(7+ AST 节点)实际产生正确 helper 调用
//
// 规范:WDPP §4.3 完整 visitor 清单
//
// 运行:node --test test/babel-compile.conformance.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transformSync } from '@babel/core';
import plugin from '../babel/plugin.js';

// 工具函数:编译 JS 代码,返回编译后的代码字符串
function compile(code) {
  const result = transformSync(code, {
    filename: 'x.js',
    babelrc: false,
    configFile: false,
    plugins: [plugin],
  });
  return result.code;
}

// 工具:检查编译产物包含期望的 helper 调用
function hasHelper(generated, helperName) {
  return generated.includes(helperName);
}

// ============================================================
// Universal Taint Union:7+ 新 visitor 编译产物
// ============================================================

test('Babel 编译:AssignmentExpression `x = y` → __recoverSelf(x, y)', () => {
  const code = compile(`
    function f() {
      x = 'new-value';
    }
  `);
  assert.ok(hasHelper(code, '__recoverSelf'), '应包含 __recoverSelf');
});

test('Babel 编译:MemberExpression 写 `obj.x = y` → __writeField', () => {
  const code = compile(`
    function f() {
      obj.status = 'active';
    }
  `);
  assert.ok(hasHelper(code, '__writeField'), '应包含 __writeField');
});

test('Babel 编译:MemberExpression 计算式写 `obj[k] = y` → __writeField', () => {
  const code = compile(`
    function f() {
      obj[key] = 'value';
    }
  `);
  assert.ok(hasHelper(code, '__writeField'), '计算式写也应包含 __writeField');
});

test('Babel 编译:ObjectPattern 解构 `const {a, b} = obj` → __readField 展开', () => {
  const code = compile(`
    const obj = { a: 1, b: 2 };
    const { a, b } = obj;
  `);
  // 应该有两个 __readField 调用
  const matches = code.match(/__readField/g);
  assert.ok(matches && matches.length >= 2,
    `应包含多个 __readField,实际 ${matches?.length ?? 0}`);
});

test('Babel 编译:ThrowStatement `throw x` → throw __throw(x)', () => {
  const code = compile(`
    function f() {
      throw error;
    }
  `);
  assert.ok(hasHelper(code, '__throw'), '应包含 __throw');
});

test('Babel 编译:LogicalExpression `a ?? b` → __nullish', () => {
  const code = compile(`
    const c = a ?? b;
  `);
  assert.ok(hasHelper(code, '__nullish'), '应包含 __nullish');
});

test('Babel 编译:OptionalMemberExpression `a?.b` → __optionalChain', () => {
  const code = compile(`
    const c = obj?.field;
  `);
  assert.ok(hasHelper(code, '__optionalChain'), '应包含 __optionalChain');
});

test('Babel 编译:UnaryExpression `delete obj.x` → __deleteField', () => {
  const code = compile(`
    delete obj.x;
  `);
  assert.ok(hasHelper(code, '__deleteField'), '应包含 __deleteField');
});

test('Babel 编译:TaggedTemplateExpression `tag\`${x}\`` → __taggedTemplate', () => {
  const code = compile(`
    const r = tag\`\${value}\`;
  `);
  assert.ok(hasHelper(code, '__taggedTemplate'), '应包含 __taggedTemplate');
});

test('Babel 编译:AwaitExpression `await x` → __await', () => {
  const code = compile(`
    async function f() {
      const r = await promise;
    }
  `);
  assert.ok(hasHelper(code, '__await'), '应包含 __await');
});

test('Babel 编译:ClassProperty `class { x = y }` → __classPropertyInit', () => {
  const code = compile(`
    class MyClass {
      x = 'init';
      method() { return this.x; }
    }
  `);
  assert.ok(hasHelper(code, '__classPropertyInit'), '应包含 __classPropertyInit');
});

// ============================================================
// 现有 visitor 编译产物(回归)
// ============================================================

test('Babel 编译回归:`name.toUpperCase()` → __recover', () => {
  const code = compile(`
    function f(name) {
      return name.toUpperCase();
    }
  `);
  assert.ok(hasHelper(code, '__recover'), 'toUpperCase 应生成 __recover');
});

test('Babel 编译回归:`cond && X` → __controlAnd', () => {
  const code = compile(`
    function f() {
      const x = cond && user.name;
    }
  `);
  assert.ok(hasHelper(code, '__controlAnd'), '&& 应生成 __controlAnd');
});

test('Babel 编译回归:`a + b` → __recover', () => {
  const code = compile(`
    function f() {
      const s = "LV." + level;
    }
  `);
  assert.ok(hasHelper(code, '__recover'), '二元运算应生成 __recover');
});

// ============================================================
// 集成:多个 visitor 同时工作
// ============================================================

test('Babel 编译集成:组合多个 AST 节点', () => {
  const code = compile(`
    function f(obj, value) {
      // 解构
      const { name } = obj;
      // 字段写
      obj.status = 'active';
      // 条件
      const visible = obj.isVip && name;
      // 模板
      const label = tag\`Hello \${name}\`;
      // 抛出
      if (!name) throw error;
      return { visible, label };
    }
  `);
  assert.ok(hasHelper(code, '__readField'), '集成测试应包含 __readField');
  assert.ok(hasHelper(code, '__writeField'), '应包含 __writeField');
  assert.ok(hasHelper(code, '__controlAnd'), '应包含 __controlAnd');
  assert.ok(hasHelper(code, '__taggedTemplate'), '应包含 __taggedTemplate');
  assert.ok(hasHelper(code, '__throw'), '应包含 __throw');
});

// ============================================================
// 防重入:已经是 helper 调用的不应再包
// ============================================================

test('Babel 编译防重入:__recover 内的二元运算不应再被包', () => {
  // 模拟:源代码中已经有 __recover 调用的场景
  const code = compile(`
    function f() {
      return __recover(a + b, [a, b]);
    }
  `);
  // 校验:不应该有嵌套的 __recover(__recover(...))
  const matches = code.match(/__recover\(/g);
  // 至少 1 个 __recover,但不应该太多(防重入)
  assert.ok(matches && matches.length <= 1,
    `不应有过多 __recover(防重入),实际 ${matches?.length ?? 0}`);
});