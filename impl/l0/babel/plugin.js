// plugin.js - L1/L2 Babel 插件(精确实现)
// L1:变换恢复(二元/模板/纯方法/一般调用)+ 控制边(&&/||/三元/if)
// L2(config.l2):全量属性读 SM 槽位 + 控制上下文栈(跨组件)
//
// 按值追踪下不需插桩的:变量赋值/for-of/delete/计算键/对象字面量/函数参数(值带护照)
// 需插桩的:产生新值的变换 + 控制流条件
//
// Universal Taint Union(P3):扩展覆盖 7+ 新 AST 节点
//   AssignmentExpression / MemberExpression 写 / ObjectPattern / VariableDeclarator /
//   ThrowStatement / OptionalMemberExpression / NullishCoalescingExpression /
//   DeleteExpression / TaggedTemplateExpression / ClassProperty / AwaitExpression

const PURE_METHODS = new Set([
  'toUpperCase','toLowerCase','trim','trimStart','trimEnd','slice','substring','substr',
  'split','replace','replaceAll','padStart','padEnd','concat','at','charAt','charCodeAt',
  'repeat','normalize','toFixed','toPrecision','toExponential','toString',
  'join','indexOf','lastIndexOf','includes','startsWith','endsWith',
]);

const HELPERS = new Set([
  '__recover','__passthrough','__controlAnd','__controlOr','__controlTernary','__controlReturn',
  '__controlEnter','__controlExit','__readSlot','__readProp','__fieldGet','__aggr',
  '__readPropOptional','__fieldGetOptional',
  // P3:Universal Taint Union 新 helpers
  '__writeField','__recoverSelf','__throw','__readField','__nullish','__optionalChain',
  '__deleteField','__taggedTemplate','__await','__classPropertyInit',
]);

// 深拷贝函数白名单(通用工具函数,非业务 by case)。识别后走 __passthrough(递归复制 identity 到输出),
// 解决深拷贝断 identity(Proxy 不可克隆,信息论限制) + byVal 值反查碰撞。JSON.parse(JSON.stringify(x)) 模式含。
const DEEP_CLONE_FNS = new Set(['cloneDeep', 'structuredClone', 'deepClone', 'deepcopy', 'deepCopy']);

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

  // 是否已是 helper(__recover/__passthrough/__aggr 等)的第一个参数(防重入)
  function isRecoverArg(path) {
    const pp = path.parentPath;
    if (!pp.isCallExpression()) return false;
    const callee = pp.node.callee;
    return t.isIdentifier(callee) && HELPERS.has(callee.name) && pp.node.arguments[0] === path.node;
  }

  // 深拷贝调用识别(白名单 + JSON 往返模式),识别后走 __passthrough(递归复制 identity)
  function isDeepCloneCall(path) {
    const callee = path.node.callee;
    if (t.isIdentifier(callee) && DEEP_CLONE_FNS.has(callee.name)) return true;
    if (t.isMemberExpression(callee) && !callee.computed && t.isIdentifier(callee.property) && DEEP_CLONE_FNS.has(callee.property.name)) return true;
    if (t.isMemberExpression(callee) && !callee.computed && t.isIdentifier(callee.object, { name: 'JSON' }) && t.isIdentifier(callee.property, { name: 'parse' })) {
      const arg0 = path.node.arguments[0];
      if (t.isCallExpression(arg0)) {
        const inner = arg0.callee;
        if (t.isMemberExpression(inner) && t.isIdentifier(inner.object, { name: 'JSON' }) && t.isIdentifier(inner.property, { name: 'stringify' })) return true;
      }
    }
    return false;
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
        // 单次求值 IIFE(修双重求值):((_l,_r) => __recover(_l op _r, [_l,_r]))(left, right)
        // left/right 各求值一次(IIFE 实参左到右);_l op _r 真实运算,保 valueOf/求值序/语义
        const l = path.scope.generateUidIdentifier('l');
        const r = path.scope.generateUidIdentifier('r');
        path.replaceWith(t.callExpression(
          t.arrowFunctionExpression([l, r], t.callExpression(t.identifier('__recover'), [
            t.binaryExpression(op, t.clone(l), t.clone(r)),
            t.arrayExpression([t.clone(l), t.clone(r)]),
          ])),
          [t.clone(path.node.left), t.clone(path.node.right)],
        ));
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

      // 3. 函数调用:统一过近似(身份/值指纹/并集由 recover 决定)。不断路。
      // f(args) -> __recover(f(args), [args]);recv.m(args) -> __recover(..., [recv, ...args])
      // callee 原样保留(this 不丢);receiver/args 作输入,recover 并集兜底给结果护照。
      CallExpression(path) {
        if (isRecoverArg(path)) return;
        const callee = path.node.callee;
        if (t.isIdentifier(callee) && (HELPERS.has(callee.name) || callee.name === 'require' || callee.name === 'import')) return;
        const inputs = [];
        if (t.isMemberExpression(callee)) inputs.push(t.clone(callee.object)); // receiver = 数据源
        for (const a of path.node.arguments) {
          if (t.isIdentifier(a) || t.isMemberExpression(a) || t.isCallExpression(a) ||
              t.isArrayExpression(a) || t.isObjectExpression(a)) inputs.push(t.clone(a));
        }
        if (!inputs.length) return;
        // 深拷贝走 __passthrough(递归复制 identity 到输出,字段级精确);其余 __recover(根并集)
        const helper = isDeepCloneCall(path) ? '__passthrough' : '__recover';
        path.replaceWith(t.callExpression(t.identifier(helper), [
          t.clone(path.node),
          t.arrayExpression(inputs),
        ]));
      },

      // 3b. 自增/自减:++X 产新值 -> __recover(++X, [X∓1]) 取旧值护照(并集)
      // ++ 后 X 已新值,X-1 还原旧值(带照);-- 用 X+1。++/-- 步长恒 1。
      UpdateExpression(path) {
        if (isRecoverArg(path)) return;
        const op = path.node.operator; // '++' | '--'
        const oldExpr = t.binaryExpression(op === '++' ? '-' : '+', t.clone(path.node.argument), t.numericLiteral(1));
        path.replaceWith(t.callExpression(t.identifier('__recover'), [
          t.clone(path.node),
          t.arrayExpression([oldExpr]),
        ]));
      },

      // 3c. 字面量/spread 产新容器 -> __aggr 盖成员并集(identity),否则新容器无照断路。
      //   跳过插件自产 helper 调用内部的 [inputs] 数组/对象(它们不是数据,是 helper 形参),
      //   但其内的值产生元素(用户数组/对象)仍会被包(父是数组,非 helper 调用)。
      ArrayExpression(path) {
        if (isRecoverArg(path)) return;
        const p = path.parentPath;
        if (p.isCallExpression() && t.isIdentifier(p.node.callee) && HELPERS.has(p.node.callee.name)) return;
        path.replaceWith(t.callExpression(t.identifier('__aggr'), [t.clone(path.node)]));
      },
      ObjectExpression(path) {
        if (isRecoverArg(path)) return;
        const p = path.parentPath;
        if (p.isCallExpression() && t.isIdentifier(p.node.callee) && HELPERS.has(p.node.callee.name)) return;
        path.replaceWith(t.callExpression(t.identifier('__aggr'), [t.clone(path.node)]));
      },

      // 3d. 一元 -a/+a/~a:产新值 -> __recover(op a,[a])。!/typeof/void 不传(布尔/丢弃)
      //     P3:delete obj.x 走 __deleteField(operator: 'delete')
      UnaryExpression(path) {
        if (isRecoverArg(path)) return;
        const op = path.node.operator;
        // delete obj.x → __deleteField
        if (op === 'delete') {
          const arg = path.node.argument;
          if (!t.isMemberExpression(arg)) return;
          const obj = arg.object;
          const key = arg.computed
            ? arg.property
            : t.stringLiteral(arg.property.name);
          path.replaceWith(t.callExpression(t.identifier('__deleteField'), [
            t.clone(obj),
            key,
          ]));
          return;
        }
        if (op === '!' || op === 'typeof' || op === 'void') return;
        path.replaceWith(t.callExpression(t.identifier('__recover'), [
          t.clone(path.node),
          t.arrayExpression([t.clone(path.node.argument)]),
        ]));
      },

      // 3e. 复合赋值 a+=b / a-=b:新值 -> __recover(a+=b,[a∓b]) 取旧值(用逆运算还原)
      //   仅 += / -=(逆运算精确);*= /= %= **= 求逆不精确,跳(降级 CUT)
      AssignmentExpression(path) {
        if (isRecoverArg(path)) return;
        const op = path.node.operator;
        if (op !== '+=' && op !== '-=') return; // 纯=是拷贝(通路);逻辑赋值=控制(另处理);*/**等跳
        const inv = op === '+=' ? '-' : '+';
        const oldExpr = t.binaryExpression(inv, t.clone(path.node.left), t.clone(path.node.right));
        path.replaceWith(t.callExpression(t.identifier('__recover'), [
          t.clone(path.node),
          t.arrayExpression([oldExpr]),
        ]));
      },

      // 3f. new C(x):构造体不透明 -> __recover(new C(x),[C?,...args]),对象结果由 recover-object 盖输入并集
      NewExpression(path) {
        if (isRecoverArg(path)) return;
        const callee = path.node.callee;
        if (t.isIdentifier(callee) && HELPERS.has(callee.name)) return;
        const inputs = [];
        if (t.isMemberExpression(callee)) inputs.push(t.clone(callee.object));
        for (const a of path.node.arguments) {
          if (t.isIdentifier(a) || t.isMemberExpression(a) || t.isCallExpression(a) ||
              t.isArrayExpression(a) || t.isObjectExpression(a)) inputs.push(t.clone(a));
        }
        if (!inputs.length) return;
        path.replaceWith(t.callExpression(t.identifier('__recover'), [
          t.clone(path.node),
          t.arrayExpression(inputs),
        ]));
      },

      // 4. && / ||:cond OP right -> __controlAnd(cond, readSlot, () => right)
      LogicalExpression(path) {
        const left = path.node.left;
        // a ?? b (nullish coalescing) → __nullish(a, b, ...)
        if (path.node.operator === '??') {
          path.replaceWith(t.callExpression(t.identifier('__nullish'), [
            t.clone(left),
            t.clone(path.node.right),
            t.numericLiteral(0),  // 占位:host 可填实际 passport
            t.numericLiteral(0),
          ]));
          return;
        }
        // 处理 && / ||,left 必须是 MemberExpression(可读 slot)或 Identifier
        if (!t.isMemberExpression(left) && !t.isIdentifier(left)) return;
        // Identifier 没有 SM 槽位,slot 是 0n;MemberExpression 走 readSlot
        let slotCall;
        if (t.isMemberExpression(left)) {
          const slot = extractSlot(left);
          if (!slot) return;
          slotCall = readSlotCall(slot);
        } else {
          // 简单标识符:slot 是 0n(控制边生效,但数据边走 right)
          slotCall = t.numericLiteral(0);
        }
        const helper = path.node.operator === '&&' ? '__controlAnd' : '__controlOr';
        path.replaceWith(t.callExpression(t.identifier(helper), [
          t.clone(left),
          slotCall,
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
            // enter 在 try 外:enter 抛错则不触发 exit(避免 pop 空栈);enter 成功后 finally 必 pop,配对正确。
            // (旧实现 unshift(enter) 后 body=[tryStmt] 把 enter 覆盖丢弃 -> 体执行时栈空,控制边丢失 + 嵌套误 pop 外层)
            const enterStmt = t.expressionStatement(t.callExpression(t.identifier('__controlEnter'), [t.clone(cp)]));
            const tryStmt = t.tryStatement(
              t.blockStatement(cons.body),
              null,
              t.blockStatement([t.expressionStatement(t.callExpression(t.identifier('__controlExit'), []))])
            );
            cons.body = [enterStmt, tryStmt];
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
              const enterStmt = t.expressionStatement(t.callExpression(t.identifier('__controlEnter'), [t.clone(cp)]));
              const tryStmt = t.tryStatement(t.blockStatement(alt.body), null,
                t.blockStatement([t.expressionStatement(t.callExpression(t.identifier('__controlExit'), []))]));
              alt.body = [enterStmt, tryStmt];
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
          const enterStmt = t.expressionStatement(t.callExpression(t.identifier('__controlEnter'), [t.clone(cp)]));
          const tryStmt = t.tryStatement(t.blockStatement(body.body), null,
            t.blockStatement([t.expressionStatement(t.callExpression(t.identifier('__controlExit'), []))]));
          body.body = [enterStmt, tryStmt];
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

      // 7. 成员读:计算式 obj[key] -> __fieldGet(obj,key)(key 带照→控制边);非计算式 a.b -> L2 __readProp
      MemberExpression(path) {
        // 左值 / callee / 链式内层 不包。callee 用 path.key(结构键,跨多趟 transform 稳)而非 node 引用(克隆后易失效)
        if (path.parentPath.isCallExpression() && (path.key === 'callee' || path.parentPath.node.callee === path.node)) return;
        if (path.parentPath.isMemberExpression()) return;

        // P3:作为赋值 left 的 MemberExpression(obj.x = y) → __writeField
        if (t.isAssignmentExpression(path.parent) && path.parent.left === path.node) {
          const obj = path.node.object;
          const key = path.node.computed
            ? path.node.property
            : t.stringLiteral(path.node.property.name);
          let value = path.parent.right;
          // 复合赋值 += / -= / *= 等:还原成 obj[key] op value
          const op = path.parent.operator;
          if (op !== '=') {
            const lhsClone = t.clone(path.node); // obj[key]
            value = t.binaryExpression(op.slice(0, -1), lhsClone, t.clone(value));
          }
          path.parentPath.replaceWith(t.callExpression(t.identifier('__writeField'), [
            t.clone(obj),
            key,
            value,
          ]));
          return;
        }
        if (t.isUpdateExpression(path.parent) && path.parent.argument === path.node) return;
        if (path.node.computed) {
          // obj[key]:key 选择了 result -> __fieldGet(obj,key),key 只读一次
          if (isRecoverArg(path)) return;
          path.replaceWith(t.callExpression(t.identifier('__fieldGet'), [
            t.clone(path.node.object),
            t.clone(path.node.property),
          ]));
          return;
        }
        if (!l2 || !t.isIdentifier(path.node.property)) return;
        if (path.parentPath.isCallExpression() &&
            t.isIdentifier(path.parentPath.node.callee, { name: '__readSlot' })) return;
        path.replaceWith(t.callExpression(t.identifier('__readProp'), [
          t.clone(path.node.object),
          t.stringLiteral(path.node.property.name),
        ]));
      },

      // 7b. optional chaining:a?.b / a?.[k] -> __readPropOptional/__fieldGetOptional(保 ?. 短路)
      //   skip-inner(只包最外,记最外的读;同 MemberExpression);callee/lvalue 不包。
      //   nullish 短路由 helper 保(__readPropOptional obj==null 返 undefined,不读不记)。
      OptionalMemberExpression(path) {
        if (path.parentPath.isCallExpression() && (path.key === 'callee' || path.parentPath.node.callee === path.node)) return;
        if (path.parentPath.isOptionalCallExpression() && (path.key === 'callee' || path.parentPath.node.callee === path.node)) return;
        if (path.parentPath.isMemberExpression() || path.parentPath.isOptionalMemberExpression()) return; // 链内层(只包最外)
        if (t.isAssignmentExpression(path.parent) && path.parent.left === path.node) return;
        if (t.isUpdateExpression(path.parent) && path.parent.argument === path.node) return;
        if (isRecoverArg(path)) return;
        if (path.node.computed) {
          // a?.[k] -> __optionalChain(a, k)(universal 实现)
          path.replaceWith(t.callExpression(t.identifier('__optionalChain'), [
            t.clone(path.node.object),
            t.clone(path.node.property),
          ]));
          return;
        }
        if (!t.isIdentifier(path.node.property)) return;
        if (path.parentPath.isCallExpression() &&
            t.isIdentifier(path.parentPath.node.callee, { name: '__readSlot' })) return;
        // a?.b -> __optionalChain(a, 'b')
        path.replaceWith(t.callExpression(t.identifier('__optionalChain'), [
          t.clone(path.node.object),
          t.stringLiteral(path.node.property.name),
        ]));
      },

      // 7c. optional call:f?.(args) / recv?.m(args) -> __recover(f?.(args), [recv, ...args])
      //   f?.(args) 本身保短路(nullish -> undefined);__recover 处理 undefined 结果。
      OptionalCallExpression(path) {
        if (isRecoverArg(path)) return;
        const callee = path.node.callee;
        if (t.isIdentifier(callee) && (HELPERS.has(callee.name) || callee.name === 'require' || callee.name === 'import')) return;
        const inputs = [];
        if (t.isMemberExpression(callee) || t.isOptionalMemberExpression(callee)) inputs.push(t.clone(callee.object));
        for (const a of path.node.arguments) {
          if (t.isIdentifier(a) || t.isMemberExpression(a) || t.isOptionalMemberExpression(a) ||
              t.isCallExpression(a) || t.isOptionalCallExpression(a) ||
              t.isArrayExpression(a) || t.isObjectExpression(a)) inputs.push(t.clone(a));
        }
        if (!inputs.length) return;
        path.replaceWith(t.callExpression(t.identifier('__recover'), [
          t.clone(path.node),
          t.arrayExpression(inputs),
        ]));
      },

      // ============ Universal Taint Union:7+ 新 visitor ============

      // 8. AssignmentExpression:x = y → __recoverSelf(x, y)
      // 标识符赋值,result 继承 expr 的 taint
      AssignmentExpression(path) {
        if (isRecoverArg(path)) return;
        const { left, right } = path.node;
        // 仅处理简单标识符赋值(复杂场景由 MemberExpression visitor 接管)
        if (!t.isIdentifier(left)) return;
        // 已是 helper 调用,跳过
        if (t.isCallExpression(right) && t.isIdentifier(right.callee) && HELPERS.has(right.callee.name)) return;
        path.replaceWith(t.callExpression(t.identifier('__recoverSelf'), [
          t.clone(left),
          t.clone(right),
        ]));
      },

      // 9. MemberExpression 写(已合并到上方 MemberExpression visitor 处理)

      // 10. ObjectPattern 解构:const { a, b } = obj → 展开为多个 __readField
      // 数组解构:const [a, b] = arr → __readField(arr, '0') 等
      ObjectPattern(path) {
        const parent = path.parentPath;
        if (!parent.isVariableDeclarator()) return;
        const sourceObj = parent.node.init;
        if (!sourceObj || !t.isIdentifier(sourceObj) && !t.isMemberExpression(sourceObj)) return;
        // 简化:只处理标识符解构
        if (!t.isIdentifier(sourceObj)) return;
        const sourceId = t.identifier(sourceObj.name);
        const stmts = path.node.properties.map((prop) => {
          const key = prop.key;
          const alias = prop.value;
          if (!t.isIdentifier(alias)) return null;
          const keyName = t.isIdentifier(key) ? key.name : key.value;
          return t.variableDeclarator(
            alias,
            t.callExpression(t.identifier('__readField'), [
              t.clone(sourceId),
              t.stringLiteral(keyName),
            ])
          );
        }).filter(Boolean);
        if (!stmts.length) return;
        // 替换为多个 variableDeclarator
        const newDecl = t.variableDeclaration('const', stmts);
        // 替换 VariableDeclaration 整体(避免重复 const)
        // path 是 ObjectPattern,path.parentPath 是 VariableDeclarator,grandparent 是 VariableDeclaration
        if (path.parentPath.parentPath && path.parentPath.parentPath.isVariableDeclaration()) {
          path.parentPath.parentPath.replaceWith(newDecl);
        } else {
          path.parentPath.replaceWith(newDecl);
        }
      },

      // 11. ThrowStatement:throw x → throw __throw(x)
      ThrowStatement(path) {
        const arg = path.node.argument;
        if (!arg) return;
        // 防递归:如果 argument 已经是 __throw 调用,跳过
        if (t.isCallExpression(arg) && t.isIdentifier(arg.callee) && HELPERS.has(arg.callee.name)) return;
        path.replaceWith(t.throwStatement(
          t.callExpression(t.identifier('__throw'), [t.clone(arg)])
        ));
        // 阻止重新访问新节点(避免无限递归)
      },

      // 12. NullishCoalescingExpression (a ?? b):Babel 用 LogicalExpression + operator:'??' 表示
      //      扩展现有 LogicalExpression visitor 处理 operator === '??'
      //      (新代码写在 LogicalExpression 内,见下面 visitor 重写)

      // 14. UnaryExpression(operator: 'delete'):已合并到 3d visitor
      // 注:已有 OptionalMemberExpression 处理(7c 后),这里处理非链式顶层 a?.b
      // (已存在的 visitor 不重复实现)

      // 15. TaggedTemplateExpression:tag`${x}` → __taggedTemplate(tag, strings, x)
      TaggedTemplateExpression(path) {
        const tag = path.node.tag;
        const quasi = path.node.quasi;
        const exprs = path.node.quasi.expressions;
        if (!tag || exprs.length === 0) return;
        const args = [t.clone(tag), t.clone(quasi), ...exprs.map(e => t.clone(e))];
        path.replaceWith(t.callExpression(t.identifier('__taggedTemplate'), args));
      },

      // 16. AwaitExpression:await x → __await(x)
      AwaitExpression(path) {
        path.replaceWith(t.callExpression(t.identifier('__await'), [t.clone(path.node.argument)]));
      },

      // 17. ClassProperty:class { x = y } → __classPropertyInit(this, 'x', y)
      ClassProperty(path) {
        const value = path.node.value;
        if (!value) return;
        const key = path.node.key;
        const keyName = t.isIdentifier(key) ? key.name : (t.isStringLiteral(key) ? key.value : null);
        if (!keyName) return;
        // 替换为 __classPropertyInit(this, 'key', value)
        path.replaceWith(t.expressionStatement(
          t.callExpression(t.identifier('__classPropertyInit'), [
            t.thisExpression(),
            t.stringLiteral(keyName),
            t.clone(value),
          ])
        ));
      },
    },
  };
}
