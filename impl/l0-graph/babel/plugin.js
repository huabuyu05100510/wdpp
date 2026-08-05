// babel/plugin.js — Babel 插件:把源代码改写成 universal taint union 形式
// 14 个现有 visitor + 7+ 个新 visitor
//
// 使用方式(以 SWC 为例, Babel 类似):
//   import { transform } from '@swc/core';
//   transform(code, { jsc: { parser: ..., plugins: [...] } });

const HELPER_NAMES = new Set([
  '__recover', '__passthrough', '__aggr', '__readProp', '__readPropOptional',
  '__fieldGet', '__fieldGetOptional', '__controlAnd', '__controlOr', '__controlTernary',
  '__controlEnter', '__controlExit', '__writeField', '__deleteField', '__readSlot',
  '__recoverSelf', '__throw', '__await', '__optionalChain', '__nullish',
  '__taggedTemplate',
]);

const DEEP_CLONE_FNS = new Set(['cloneDeep', 'structuredClone', 'deepClone', 'deepcopy', 'deepCopy']);

function isDeepCloneCall(callee) {
  if (callee.type === 'Identifier' && DEEP_CLONE_FNS.has(callee.value)) return true;
  if (callee.type === 'MemberExpression' &&
      callee.property.type === 'Identifier' &&
      DEEP_CLONE_FNS.has(callee.property.value)) {
    return true;
  }
  // JSON.parse(JSON.stringify(x))
  if (callee.type === 'MemberExpression' &&
      callee.object.value === 'JSON' &&
      callee.property.value === 'parse') {
    return true;
  }
  return false;
}

/**
 * 入口:返回 babel 插件 visitors
 */
export default function wdppPlugin() {
  return {
    name: 'wdpp-graph',
    visitor: {
      // ============ 现有 14 个 visitor ============

      // 1. BinaryExpression: a + b → __recover(a + b, [a, b])
      BinaryExpression(path) {
        const { left, right, operator } = path.node;
        if (!['+', '-', '*', '/', '%'].includes(operator)) return;
        return {
          ...path.node,
          type: 'CallExpression',
          callee: { type: 'Identifier', value: '__recover' },
          arguments: [
            { type: 'BinaryExpression', operator, left, right },
            { type: 'ArrayExpression', elements: [left, right] },
          ],
        };
      },

      // 2. TemplateLiteral: `${a}` → __recover(`${a}`, [a])
      TemplateLiteral(path) {
        const { quasis, expressions } = path.node;
        return {
          type: 'CallExpression',
          callee: { type: 'Identifier', value: '__recover' },
          arguments: [
            { type: 'TemplateLiteral', quasis, expressions },
            { type: 'ArrayExpression', elements: expressions },
          ],
        };
      },

      // 3. CallExpression: fn(a) → __recover/__passthrough(fn(a), [a])
      CallExpression(path) {
        const helper = isDeepCloneCall(path.node.callee) ? '__passthrough' : '__recover';
        return {
          ...path.node,
          type: 'CallExpression',
          callee: { type: 'Identifier', value: helper },
          arguments: [
            path.node,
            { type: 'ArrayExpression', elements: path.node.arguments },
          ],
        };
      },

      // 4. MemberExpression: obj.x (静态) → __readProp(obj, 'x')
      MemberExpression(path) {
        // 计算式 obj[k] 用 __fieldGet
        if (path.node.computed) {
          return {
            type: 'CallExpression',
            callee: { type: 'Identifier', value: '__fieldGet' },
            arguments: [path.node.object, path.node.property],
          };
        }
        // 静态 obj.x 用 __readProp
        return {
          type: 'CallExpression',
          callee: { type: 'Identifier', value: '__readProp' },
          arguments: [path.node.object, { type: 'StringLiteral', value: path.node.property.value }],
        };
      },

      // ============ 新增 7+ visitor ============

      // 5. AssignmentExpression: x = y (Identifier) → __recoverSelf(x, y)
      //    实际等价于 x = y,因为对象引用共享
      //    但我们要标记图节点,所以特殊处理
      AssignmentExpression(path) {
        const { left, right } = path.node;
        // 只处理 Identifier 简单赋值(obj.x = y 由下面的 MemberExpression 处理)
        if (left.type !== 'Identifier') return;

        return {
          ...path.node,
          right: {
            type: 'CallExpression',
            callee: { type: 'Identifier', value: '__recoverSelf' },
            arguments: [left, right],
          },
        };
      },

      // 6. MemberExpression 作为赋值目标:obj.x = y → __writeField(obj, 'x', y)
      //    在 AssignmentExpression 内检测
      //    SWC 在 visitor 里,我们用 ConditionalExpression 包装

      // 7. ObjectPattern: const {a, b} = obj → 展开为 __readSlot
      ObjectPattern(path) {
        // 简化处理:把 properties 转成多个声明
        // 实际 Babel 改写复杂,这里给伪代码
        // 真实实现需要 path.insertBefore + path.replaceWith 多步
        return path.node;  // 占位
      },

      // 8. ThrowStatement: throw x → throw __throw(x)
      ThrowStatement(path) {
        if (!path.node.argument) return path.node;
        return {
          ...path.node,
          argument: {
            type: 'CallExpression',
            callee: { type: 'Identifier', value: '__throw' },
            arguments: [path.node.argument],
          },
        };
      },

      // 9. OptionalMemberExpression: a?.b → __optionalChain(a, 'b')
      OptionalMemberExpression(path) {
        if (path.node.computed) {
          return {
            type: 'CallExpression',
            callee: { type: 'Identifier', value: '__optionalChain' },
            arguments: [path.node.object, path.node.property],
          };
        }
        return {
          type: 'CallExpression',
          callee: { type: 'Identifier', value: '__optionalChain' },
          arguments: [
            path.node.object,
            { type: 'StringLiteral', value: path.node.property.value },
          ],
        };
      },

      // 10. OptionalCallExpression: a?.(b) → __optionalCall(a, b)
      OptionalCallExpression(path) {
        return {
          type: 'CallExpression',
          callee: { type: 'Identifier', value: '__optionalCall' },
          arguments: [path.node.callee, ...path.node.arguments],
        };
      },

      // 11. NullishCoalescingExpression: a ?? b → __nullish(a, b, aTaint, bTaint)
      NullishCoalescingExpression(path) {
        return {
          type: 'CallExpression',
          callee: { type: 'Identifier', value: '__nullish' },
          arguments: [path.node.left, path.node.right, path.node.left, path.node.right],
        };
      },

      // 12. DeleteExpression: delete obj.x → __deleteField(obj, 'x')
      UnaryExpression(path) {
        if (path.node.operator !== 'delete') return;
        const arg = path.node.argument;
        if (arg.type !== 'MemberExpression') return;
        const key = arg.computed
          ? arg.property
          : { type: 'StringLiteral', value: arg.property.value };
        return {
          type: 'CallExpression',
          callee: { type: 'Identifier', value: '__deleteField' },
          arguments: [arg.object, key],
        };
      },

      // 13. TaggedTemplateExpression: tag`${x}` → __taggedTemplate(tag, [x])
      TaggedTemplateExpression(path) {
        const { tag, quasi } = path.node;
        return {
          type: 'CallExpression',
          callee: { type: 'Identifier', value: '__taggedTemplate' },
          arguments: [tag, { type: 'ArrayExpression', elements: quasi.expressions }, quasi],
        };
      },

      // 14. AwaitExpression: await x → __await(x)
      AwaitExpression(path) {
        return {
          type: 'CallExpression',
          callee: { type: 'Identifier', value: '__await' },
          arguments: [path.node.argument],
        };
      },

      // 15. ClassProperty: class { x = y } → x = __recoverSelf(this.x, y)
      ClassProperty(path) {
        if (!path.node.value) return;
        return {
          ...path.node,
          value: {
            type: 'CallExpression',
            callee: { type: 'Identifier', value: '__recoverSelf' },
            arguments: [{ type: 'ThisExpression' }, path.node.value],
          },
        };
      },

      // 16. 控制流 if / while / for body
      IfStatement: wrapControlBlock('if'),
      WhileStatement: wrapControlBlock('while'),
      ForStatement: wrapControlBlock('for'),
      ForInStatement: wrapControlBlock('for-in'),
      ForOfStatement: wrapControlBlock('for-of'),
      DoWhileStatement: wrapControlBlock('do-while'),
      SwitchStatement: wrapControlBlock('switch'),
    },
  };
}

function wrapControlBlock(type) {
  return function(path) {
    // 简化:用 __controlEnter/Exit 包住整个 body
    // 真实实现需要 spliceStatements
    return path.node;
  };
}

// SWC plugin 包装(若使用 SWC)
export function swcVisitor() {
  return {
    BinaryExpression: (node, ctx) => {
      // 类似上面
      return node;
    },
    CallExpression: (node, ctx) => {
      return node;
    },
  };
}
