// plugin.js - L1/L2 Babel 插件(精确实现)
// L1:变换恢复(二元/模板/纯方法/一般调用)+ 控制边(&&/||/三元/if)
// L2(config.l2):全量属性读 SM 槽位 + 控制上下文栈(跨组件)
//
// 按值追踪下不需插桩的:变量赋值/for-of/delete/计算键/对象字面量/函数参数(值带护照)
// 需插桩的:产生新值的变换 + 控制流条件

const PURE_METHODS = new Set([
  'toUpperCase','toLowerCase','trim','trimStart','trimEnd','slice','substring','substr',
  'split','replace','replaceAll','padStart','padEnd','concat','at','charAt','charCodeAt',
  'repeat','normalize','toFixed','toPrecision','toExponential','toString',
  'join','indexOf','lastIndexOf','includes','startsWith','endsWith',
]);

const HELPERS = new Set(['__recover','__controlAnd','__controlOr','__controlTernary','__controlReturn','__readSlot','__readProp']);

export default function wdppPlugin({ types: t }, opts = {}) {
  const l2 = !!opts.l2; // L2 全量属性读 + 跨组件控制

  function extractSlot(memberNode) {
    const path = [];
    let n = memberNode;
    while (t.isMemberExpression(n)) {
      if (n.computed) return null;
      if (!t.isIdentifier(n.property)) return null;
      path.unshift(n.property.name);
      n = n.object;
    }
    if (!t.isIdentifier(n)) return null;
    return { root: n, path };
  }

  function readSlotCall(slot) {
    return t.callExpression(t.identifier('__readSlot'), [
      t.clone(slot.root),
      t.arrayExpression(slot.path.map(p => t.stringLiteral(p))),
    ]);
  }

  // 是否已是 __recover 的第一个参数(防重入)
  function isRecoverArg(path) {
    return path.parentPath.isCallExpression() &&
      t.isIdentifier(path.parentPath.node.callee, { name: '__recover' }) &&
      path.parentPath.node.arguments[0] === path.node;
  }

  // 收集表达式中的操作数(Identifier/MemberExpression),不递归进属性名
  function collectInputs(node) {
    const inputs = [];
    const seen = new Set();
    function add(n) {
      if (!n) return;
      if (t.isIdentifier(n) && !HELPERS.has(n.name)) {
        if (!seen.has(n.name)) { seen.add(n.name); inputs.push(t.clone(n)); }
      } else if (t.isMemberExpression(n) && !n.computed) {
        // 用成员表达式本身作为 input(求值后是值,带护照)
        const key = t.isIdentifier(n.object) ? n.object.name : '';
        if (!seen.has(key)) { seen.add(key); inputs.push(t.clone(n)); }
      }
    }
    if (t.isBinaryExpression(node)) { add(node.left); add(node.right); }
    else if (t.isTemplateLiteral(node)) { node.expressions.forEach(add); }
    else { add(node); }
    return inputs;
  }

  return {
    visitor: {
      // 1. 二元表达式:a + b -> __recover(a + b, [a, b])
      BinaryExpression(path) {
        if (isRecoverArg(path)) return;
        // 只处理产生字符串/数字的运算(算术/拼接),不处理比较(=== < > 那些是布尔化)
        const op = path.node.operator;
        if (['==','===','!=','!==','<','>','<=','>=','instanceof','in'].includes(op)) return;
        const inputs = collectInputs(path.node);
        if (!inputs.length) return;
        path.replaceWith(t.callExpression(t.identifier('__recover'), [
          t.clone(path.node),
          t.arrayExpression(inputs),
        ]));
      },

      // 2. 模板字面量:`${a}${b}` -> __recover(`...`, [a, b])
      TemplateLiteral(path) {
        if (isRecoverArg(path)) return;
        if (!path.node.expressions.length) return; // 无插值
        const inputs = path.node.expressions
          .filter(e => t.isIdentifier(e) || t.isMemberExpression(e))
          .map(e => t.clone(e));
        if (!inputs.length) return;
        path.replaceWith(t.callExpression(t.identifier('__recover'), [
          t.clone(path.node),
          t.arrayExpression(inputs),
        ]));
      },

      // 3. 函数调用:纯方法 + 一般调用
      CallExpression(path) {
        if (isRecoverArg(path)) return;
        const callee = path.node.callee;

        // 纯方法:recv.m(...args) -> __recover(recv.m(...args), [recv, ...args])
        if (t.isMemberExpression(callee) && !callee.computed &&
            t.isIdentifier(callee.property) && PURE_METHODS.has(callee.property.name)) {
          const recv = callee.object;
          const args = path.node.arguments;
          path.replaceWith(t.callExpression(t.identifier('__recover'), [
            t.clone(path.node),
            t.arrayExpression([t.clone(recv), ...args.map(a => t.clone(a))]),
          ]));
          return;
        }

        // 一般调用(非 helper、非 JSX 运行时):f(args) -> __recover(f(args), [args])
        // 只对有标识符 callee 的调用(不处理 require/import 等特殊调用)
        if (l2 && t.isIdentifier(callee) && !HELPERS.has(callee.name) &&
            callee.name !== 'require' && callee.name !== 'import' &&
            !path.parentPath.isCallExpression()) {
          const args = path.node.arguments.filter(a => t.isIdentifier(a) || t.isMemberExpression(a));
          if (args.length) {
            path.replaceWith(t.callExpression(t.identifier('__recover'), [
              t.clone(path.node),
              t.arrayExpression(args.map(a => t.clone(a))),
            ]));
          }
        }
      },

      // 4. && / ||:cond OP right -> __controlAnd(cond, readSlot, () => right)
      LogicalExpression(path) {
        const left = path.node.left;
        if (!t.isMemberExpression(left)) return;
        const slot = extractSlot(left);
        if (!slot) return;
        const helper = path.node.operator === '&&' ? '__controlAnd' : '__controlOr';
        path.replaceWith(t.callExpression(t.identifier(helper), [
          t.clone(left),
          readSlotCall(slot),
          t.arrowFunctionExpression([], t.clone(path.node.right)),
        ]));
      },

      // 5. 三元:cond ? a : b -> __controlTernary(cond, readSlot, () => a, () => b)
      ConditionalExpression(path) {
        const test = path.node.test;
        let slot = null;
        if (t.isMemberExpression(test)) slot = extractSlot(test);
        if (!slot) return;
        path.replaceWith(t.callExpression(t.identifier('__controlTernary'), [
          t.clone(test),
          readSlotCall(slot),
          t.arrowFunctionExpression([], t.clone(path.node.consequent)),
          t.arrowFunctionExpression([], t.clone(path.node.alternate)),
        ]));
      },

      // 6. if 语句:if (cond) return X / if (cond) { body } / 早退 region P
      IfStatement(path) {
        const test = path.node.test;
        if (!t.isMemberExpression(test)) return;
        const slot = extractSlot(test);
        if (!slot) return;
        const cp = readSlotCall(slot);

        // 6a. return 语句:if (cond) return X -> __controlReturn
        const wrapReturn = (stmt) => {
          if (t.isReturnStatement(stmt) && stmt.argument) {
            stmt.argument = t.callExpression(t.identifier('__controlReturn'), [t.clone(cp), t.clone(stmt.argument)]);
          }
        };
        // 判断是否以跳转结尾(return/throw/break/continue)
        const endsWithJump = (stmt) => {
          if (t.isReturnStatement(stmt) || t.isThrowStatement(stmt) || t.isBreakStatement(stmt) || t.isContinueStatement(stmt)) return true;
          if (t.isBlockStatement(stmt)) {
            const last = stmt.body[stmt.body.length - 1];
            return last && endsWithJump(last);
          }
          return false;
        };

        const cons = path.node.consequent;
        if (t.isBlockStatement(cons)) {
          if (cons.body.length === 1 && t.isReturnStatement(cons.body[0])) {
            wrapReturn(cons.body[0]);
          } else {
            // 非 return 体:__controlEnter + try/finally/__controlExit
            cons.body.unshift(t.expressionStatement(t.callExpression(t.identifier('__controlEnter'), [t.clone(cp)])));
            cons.body.unshift(t.tryStatement(
              t.blockStatement(cons.body.slice(1)),
              null,
              t.blockStatement([t.expressionStatement(t.callExpression(t.identifier('__controlExit'), []))])
            ));
            cons.body = [cons.body[0]];
          }
        } else if (t.isReturnStatement(cons)) {
          wrapReturn(cons);
        }

        // 6b. else 分支
        const alt = path.node.alternate;
        if (alt) {
          if (t.isBlockStatement(alt)) {
            for (const s of alt.body) wrapReturn(s);
            if (!alt.body.some(s => t.isReturnStatement(s))) {
              alt.body.unshift(t.expressionStatement(t.callExpression(t.identifier('__controlEnter'), [t.clone(cp)])));
              const orig = alt.body.slice(1);
              alt.body = [t.tryStatement(t.blockStatement(orig), null,
                t.blockStatement([t.expressionStatement(t.callExpression(t.identifier('__controlExit'), []))]))];
            }
          } else wrapReturn(alt);
        }

        // 6c. 早退 region P:if (cond) return; rest -> rest 受 !cond 控制
        //    (consequent 以跳转结尾、无 else、父块有后续语句)
        if (!alt && endsWithJump(cons) && path.parentPath.isBlockStatement()) {
          const siblings = path.parentPath.node.body;
          const ifIdx = siblings.indexOf(path.node);
          const rest = siblings.slice(ifIdx + 1);
          if (rest.length > 0) {
            const enterStmt = t.expressionStatement(t.callExpression(t.identifier('__controlEnter'), [t.clone(cp)]));
            const tryStmt = t.tryStatement(
              t.blockStatement(rest.map(s => t.cloneNode(s))),
              null,
              t.blockStatement([t.expressionStatement(t.callExpression(t.identifier('__controlExit'), []))])
            );
            siblings.splice(ifIdx + 1, rest.length, enterStmt, tryStmt);
          }
        }
      },

      // 7. while/for:循环体受条件控制
      Loop(path) {
        const test = path.node.test || (t.isForOfStatement(path.node) ? path.node.right : null) ||
                     (t.isForInStatement(path.node) ? path.node.right : null);
        let slot = null;
        if (test && t.isMemberExpression(test)) slot = extractSlot(test);
        if (!slot) return;
        const cp = readSlotCall(slot);
        const body = path.node.body;
        if (t.isBlockStatement(body)) {
          body.body.unshift(t.expressionStatement(t.callExpression(t.identifier('__controlEnter'), [t.clone(cp)])));
          const orig = body.body.slice(1);
          body.body = [t.tryStatement(t.blockStatement(orig), null,
            t.blockStatement([t.expressionStatement(t.callExpression(t.identifier('__controlExit'), []))]))];
        }
      },

      // 8. switch:判别式控制所有 case 体
      SwitchStatement(path) {
        const disc = path.node.discriminant;
        if (!t.isMemberExpression(disc)) return;
        const slot = extractSlot(disc);
        if (!slot) return;
        const cp = readSlotCall(slot);
        // 在每个 case 的 consequent 前插入 __controlEnter,后插 __controlExit
        for (const c of path.node.cases) {
          if (t.isBlockStatement(c.consequent)) {
            c.consequent.unshift(t.expressionStatement(t.callExpression(t.identifier('__controlEnter'), [t.clone(cp)])));
          }
        }
        // switch 末尾加清理(简化:每个 case 末尾不单独 exit,靠下一个 case 的 enter 覆盖)
      },

      // 7. L2:全量属性读 a.b -> __readProp(a, 'b')(返回原值 + SM 槽位)
      ...(l2 ? {
        MemberExpression(path) {
          if (path.parentPath.isCallExpression() && PURE_METHODS.has(path.node.property?.name)) return;
          if (path.parentPath.isMemberExpression()) return; // 链式 a.b.c 只处理最内层
          if (t.isAssignmentExpression(path.parent) && path.parent.left === path.node) return; // 赋值左侧
          if (path.node.computed) return;
          if (!t.isIdentifier(path.node.property)) return;
          // 不替换 readSlot 内部的
          if (path.parentPath.isCallExpression() &&
              t.isIdentifier(path.parentPath.node.callee, { name: '__readSlot' })) return;
          path.replaceWith(t.callExpression(t.identifier('__readProp'), [
            t.clone(path.node.object),
            t.stringLiteral(path.node.property.name),
          ]));
        },
      } : {}),
    },
  };
}
