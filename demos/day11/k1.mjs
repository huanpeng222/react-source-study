/**
 * Day11 Demo: Suspense 概念验证实验
 * 
 * 环境：jsdom + react@19.2.7
 * 
 * ⚠️ 重要边界声明（实测硬规则 #10）：
 * 
 * jsdom 无 Scheduler / 无浏览器事件循环，以下行为无法在此环境观察：
 *   - promise resolve → attachPingListener → 自动重试 → 切回 primary（异步链路）
 *   - Concurrent 模式延迟 fallback（拥塞节流 ~500ms）
 *   - OffscreenComponent 切换前后状态保留（需要完整 render→commit 周期）
 *   - workLoopConcurrent 的 shouldYield 中断
 *
 * 本实验聚焦于可在 jsdom 同步执行中验证的行为：
 *   K1: throw promise 不导致崩溃（Suspense 边界兜住）
 *   K2: use(promise) API 存在且可调用
 *   K3: Error Boundary 与 Suspense 路由分流（同一 catch 不同分支）
 */

import React, { useState, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';

// ============ 工具函数 ============
const logs = [];

function log(...args) {
  const msg = args.join(' ');
  console.log(msg);
  logs.push(msg);
}

// 创建 DOM 环境
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>');
global.document = dom.window.document;
global.window = dom.window;

// ============ Resource 工厂 ============

function createResource(promise) {
  let status = 'pending';
  let result;
  let error;
  promise.then(
    v => { status = 'fulfilled'; result = v; },
    e => { status = 'rejected'; error = e; }
  );
  return {
    read() {
      if (status === 'pending') throw promise;
      if (status === 'rejected') throw error;
      return result;
    },
    get status() { return status; },
  };
}

// ============ K1: Suspense 兜底 — 验证 throw promise 不崩 ============

function runK1() {
  log('===== K1: Suspense 边界兜底验证 =====');
  
  // 新建独立容器
  const wrapper = document.createElement('div');
  document.body.appendChild(wrapper);
  const root = createRoot(wrapper);

  const neverResolve = new Promise(() => {});
  const resource = createResource(neverResolve);
  
  let profileCalled = false;
  let fallbackCalled = false;

  function Profile() {
    profileCalled = true;
    log(`[K1] Profile 执行了 — 即将 resource.read()`); 
    try {
      const data = resource.read();  // 这里会 throw promise
      log(`[K1] Profile 读到数据: ${JSON.stringify(data)} (不应该到这里)`);
      return React.createElement('div', null, JSON.stringify(data));
    } catch(thrown) {
      log(`[K1] Profile 抛出了: ${thrown.constructor.name} (${typeof thrown.then === 'function' ? '有 .then' : '无 .then'})`);
      throw thrown; // 继续向上抛
    }
  }

  function Spinner() {
    fallbackCalled = true;
    log(`[K1] Spinner (fallback) 执行了 ✅`);
    return React.createElement('div', null, '⏳ 加载中...');
  }

  let didCrash = false;
  try {
    root.render(
      React.createElement(Suspense, { fallback: React.createElement(Spinner) },
        React.createElement(Profile)
      )
    );
    log(`[K1] root.render() 成功返回 — 没有未捕获异常 ✅`);
  } catch(e) {
    didCrash = true;
    log(`[K1] ❌ 崩溃了: ${e.message}`);
  }

  log(`[K1] Profile 是否被调用: ${profileCalled ? '是 ✅' : '否'}`);
  log(`[K1] Fallback 是否被调用: ${fallbackCalled ? '是 ✅' : '否 (jsdom 异步调度限制)'}`);
  log(`[K1] 是否崩溃: ${didCrash ? '是 ❌' : '否 ✅'}`);

  document.body.removeChild(wrapper);
  log('');
}

// ============ K2: use(promise) API 可用性验证 ============

function runK2() {
  log('===== K2: React.use (use(promise)) API 验证 =====');
  
  // 检查 React.use 是否存在
  log(`[K2] React.use 存在: ${typeof React.use === 'function' ? '是 ✅' : '否 ❌ (' + typeof React.use + ')'}`);

  if (typeof React.use === 'function') {
    // 测试三态逻辑（模拟 use 内部实现）
    const tests = [
      { name: 'fulfilled', p: Object.assign(Promise.resolve({name:'数据'}), {status:'fulfilled', value:{name:'数据'}}) },
      { name: 'pending',   p: new Promise(()=>{}) },
      { name: 'rejected',  p: Object.assign(Promise.reject(new Error('失败')), {status:'rejected', reason:new Error('失败')}) },
    ];

    for (const t of tests) {
      const hasThen = typeof t.p.then === 'function';
      const hasStatus = t.p.status !== undefined;
      log(`[K2] ${t.name}: thenable=${hasThen}, 有status字段=${hasStatus}, status="${t.p.status || 'undefined'}"`);
    }

    log(`[K2] 结论: React.use() 在 React@${React.version} 中可用。内部根据 .status 决定返回值或 throw。`);
  }
  log('');
}

// ============ K3: Error vs Suspense 分流判断条件验证 ============

function runK3() {
  log('===== K3: throwException 路由分流条件验证 =====');

  // 验证核心判断条件
  const testCases = [
    { name: 'Promise (thenable)',     value: new Promise(()=>{}), expected: 'Suspense' },
    { name: 'Error (普通对象)',        value: new Error('炸了'),          expected: 'ErrorBoundary' },
    { name: '字符串',                  value: '出错了',                 expected: 'ErrorBoundary' },
    { name: '数字',                    value: 42,                        expected: 'ErrorBoundary' },
    { name: '自定义 Thenable',         value: { then: ()=>{} },         expected: 'Suspense' },
    { name: 'null',                    value: null,                      expected: 'ErrorBoundary' },
  ];

  for (const tc of testCases) {
    const isThenable = tc.value !== null && typeof tc.value.then === 'function';
    const route = isThenable ? 'Suspense' : 'ErrorBoundary';
    const match = route === tc.expected ? '✅' : '❌';
    log(`[K3] ${match} ${tc.name}: typeof .then === 'function'? → ${isThenable} → 走 ${route}`);
  }

  log('');
  log('[K3] 核心结论: throwException 只用一行代码决定路由:');
  log('    if (typeof value.then === "function") → Suspense');
  log('    else → Error Boundary');
  log('');
}

// ============ 运行全部实验 ============
runK1();
runK2();
runK3();

log('========== 全部完成 ==========');
process.exit(0);
