// runtime.js - L0 runtime + L1/L2 helper 注入浏览器全局
// 纯通用:plugin 插桩所有操作(__recover 调用边界传护照)+ value-index + DOM sink + overlay。
import '@wdpp/index.js';
import {
  __recover, __passthrough, __fieldGet, __aggr, __readProp,
  __readPropOptional, __fieldGetOptional,
  __controlAnd, __controlOr, __controlTernary, __controlReturn,
  __readSlot, __controlEnter, __controlExit,
  __setRCO,
} from '@wdpp/babel-runtime.js';
import { install } from '@wdpp/index.js';
import React from 'react';

install({ expose: true, overlay: true });

__setRCO(() => React?.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE?.A
  ?? React?.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED?.ReactCurrentOwner?.current
  ?? null);

Object.assign(globalThis, {
  __recover, __passthrough, __fieldGet, __aggr, __readProp,
  __readPropOptional, __fieldGetOptional,
  __controlAnd, __controlOr, __controlTernary, __controlReturn,
  __readSlot, __controlEnter, __controlExit,
});

console.log('WDPP ready. window.__wdpp__ 可用,屏幕叠加已启动。');
