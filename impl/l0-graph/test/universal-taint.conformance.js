// test/universal-taint.conformance.js — Universal Taint Union 一致性测试

import { install } from '../src/index.js';
import * as graph from '../src/graph.js';
import { addNode, addEdge } from '../src/graph.js';
import { getFieldId, getStamp, expandBits, fieldIdToPath, bit, reset as resetValueIndex, stampValue } from '../src/value-index.js';
import { __recover, __passthrough, __aggr, __writeField, __readSlot, __controlAnd, __controlTernary, __nullish, __taint } from '../src/babel-runtime.js';

let _passed = 0;
let _failed = 0;

function assert(cond, msg) {
  if (cond) {
    _passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    _failed++;
    console.log(`  ❌ ${msg}`);
  }
}

function assertEq(a, b, msg) {
  if (a === b) {
    _passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    _failed++;
    console.log(`  ❌ ${msg} (expected ${b}, got ${a})`);
  }
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

function resetAll() {
  graph.reset();
  resetValueIndex();
}

// ============ Test 1: Graph class 基础 ============

section('Test 1: Graph class basic');

resetAll();

const n1 = 'api:test';
const n2 = 'field:1';
addNode(n1, { type: 'ApiSource', confidence: 'exact' });
addNode(n2, { type: 'Field', confidence: 'exact' });
addEdge(n1, n2, 'stamps', 'exact');

assertEq(graph.nodeCount(), 2, '2 nodes created');
assertEq(graph.edgeCount(), 1, '1 edge created');
assertEq(graph.getNode(n1).type, 'ApiSource', 'n1 is ApiSource');
assertEq(graph.getOutgoing(n1).length, 1, 'n1 has 1 outgoing edge');

// ============ Test 2: stampOrigin 建图 ============

section('Test 2: stampOrigin creates graph nodes');

resetAll();

const userData = {
  name: 'Alice',
  email: 'alice@test.com',
  address: { city: 'Shanghai', zip: '200000' },
};

const { stampOrigin } = await import('../src/stamp-origin.js');
stampOrigin(userData, 'GET /api/user');

const allNodes = graph.allNodes();
const apiNodes = allNodes.filter(n => n.type === 'ApiSource');
const fieldNodes = allNodes.filter(n => n.type === 'Field');

assertEq(apiNodes.length, 1, '1 ApiSource created');
assert(fieldNodes.length >= 5, `≥5 Field nodes (got ${fieldNodes.length})`);

// 值查询
const stamp = getStamp('Alice');
assert(stamp !== null, 'Alice has stamp');
assert(stamp.passport !== 0n, 'Alice has non-zero passport');

const cityStamp = getStamp('Shanghai');
assert(cityStamp !== null, 'Shanghai has stamp');

// ============ Test 3: __recover taint union ============

section('Test 3: __recover taint union');

resetAll();

const a = 'John';
const b = 'Jane';

// 模拟两个 source 的 stamp
const fidA = getFieldId('GET /a:user.name');
const fidB = getFieldId('GET /b:customer.name');
stampValue(a, fidA);
stampValue(b, fidB);

const result = a + ' ' + b;  // 模拟 + 运算
__recover(result, [a, b]);

const rStamp = getStamp(result);
assert(rStamp !== null, 'concat result has stamp');
assert(rStamp.passport & bit(fidA), 'result has fidA in passport');
assert(rStamp.passport & bit(fidB), 'result has fidB in passport');

// 图验证
const opNodes = graph.allNodes().filter(n => n.type === 'Operation');
assert(opNodes.length >= 1, `≥1 Operation node created (got ${opNodes.length})`);

// ============ Test 4: __passthrough 深拷贝 ============

section('Test 4: __passthrough deep clone');

resetAll();

const original = { name: 'Bob', age: 25, address: { city: 'Beijing' } };
stampOrigin(original, 'GET /api/original');

const cloned = JSON.parse(JSON.stringify(original));  // 深拷贝断 SM
__passthrough(cloned, [original]);

// cloned 应带原始的字段护照
const clonedNameStamp = getStamp(cloned.name);
assert(clonedNameStamp !== null, 'cloned.name has stamp (per-field via __passthrough)');
// 此时 fieldMap 已复制到 cloned
assert(cloned.__wdpp_fields !== undefined, 'cloned has __wdpp_fields');

// ============ Test 5: __aggr 对象字面量 ============

section('Test 5: __aggr object literal');

resetAll();

stampValue('Laptop', getFieldId('GET /orders:[].product'));
stampValue(25, getFieldId('GET /orders:[].price'));

const order = { product: 'Laptop', price: 25 };
__aggr(order);

const orderStamp = getStamp(order);
assert(orderStamp !== null, 'order object has union stamp');
assert(orderStamp.passport & bit(getFieldId('GET /orders:[].product')), 'order has product passport');

// ============ Test 6: __writeField 字段突变 ============

section('Test 6: __writeField field mutation');

resetAll();

const obj = {};
stampValue('newvalue', getFieldId('GET /api:field'));
__writeField(obj, 'myfield', 'newvalue');

assert(obj.myfield === 'newvalue', 'field set');
assert(obj.__wdpp_fields?.myfield !== undefined, '__wdpp_fields has myfield');
const fieldStamp = getStamp('newvalue');
assert(fieldStamp !== null, 'value has stamp');

// ============ Test 7: __readSlot 解构 ============

section('Test 7: __readSlot destructuring');

resetAll();

const user = { name: 'Carol', age: 30 };
stampOrigin(user, 'GET /api/user');

const { name, age } = { name: __readSlot(user, 'name'), age: __readSlot(user, 'age') };
assert(name === 'Carol', 'destructured name');
assert(age === 30, 'destructured age');

// ============ Test 8: __controlAnd / __controlTernary 控制边 ============

section('Test 8: Control flow taint');

resetAll();

const cond = true;
const fidCond = getFieldId('GET /api:cond');
stampValue(cond, fidCond);

const result2 = __controlAnd(cond, bit(fidCond), () => 'yes');
assert(result2 === 'yes', 'controlAnd returns right side');

// ============ Test 9: __nullish ============

section('Test 9: __nullish');

resetAll();

const a3 = null;
const b3 = 'fallback';
stampValue(b3, getFieldId('GET /api:fallback'));

const r3 = __nullish(a3, b3, 0n, bit(getFieldId('GET /api:fallback')));
assert(r3 === 'fallback', '__nullish returns b when a is null');
const r3Stamp = getStamp(r3);
assert(r3Stamp !== null, 'r3 has stamp');

// ============ Test 10: 图查询反向 BFS ============

section('Test 10: Graph reverse BFS');

resetAll();

const domData = { text: 'visible value' };
stampOrigin(domData, 'GET /api/data');

// 用真实的 fieldId
const textFieldId = getFieldId(JSON.stringify(['GET /api/data', 'text']));

// 模拟 DOM 写入
const fakeNode = {};
const domId = 'dom:fake';
graph.addNode(domId, { type: 'DomNode' });
addEdge(`field:${textFieldId}`, domId, 'writes-to', 'exact');

// 查询
const ancestors = graph.getAncestorApis(domId);
assert(ancestors.length === 1, `1 ancestor API (got ${ancestors.length})`);
assertEq(ancestors[0], 'api:GET /api/data', 'correct ancestor API');

// ============ Test 11: Universal taint union 验证 ============

section('Test 11: Universal taint union via __taint');

resetAll();

const input1 = 'hello';
const input2 = 'world';
stampValue(input1, getFieldId('GET /a:msg'));
stampValue(input2, getFieldId('GET /b:msg'));

const out = input1 + input2;
__taint(out, [input1, input2], 'concat');

const outStamp = getStamp(out);
assert(outStamp !== null, 'output has stamp');
const fidA2 = getFieldId('GET /a:msg');
const fidB2 = getFieldId('GET /b:msg');
assert(outStamp.passport & bit(fidA2), 'output has fidA2');
assert(outStamp.passport & bit(fidB2), 'output has fidB2');

// ============ 总结 ============

console.log(`\n=== 测试结果 ===`);
console.log(`通过: ${_passed}`);
console.log(`失败: ${_failed}`);
console.log(`总计: ${_passed + _failed}`);

if (_failed > 0) {
  console.log(`\n❌ 有 ${_failed} 个测试失败`);
  process.exit(1);
} else {
  console.log(`\n✅ 全部通过!`);
  process.exit(0);
}
