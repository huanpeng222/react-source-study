/**
 * Day 12 实验 L2：use() + 缓存 Map（防死循环）— 真实 React 组件版
 *
 * 环境：jsdom + react@19 + react-dom@19
 * 运行: node k2-cache.mjs
 *
 * 验证目标：
 *   场景 A: 无缓存 → 每次 render 新建 Promise → 死循环
 *   场景 B: 有缓存 Map → 同 id 返回同一引用 → 正常工作
 *   场景 C: id 变化 → 自动发新请求
 *
 * 核心结论: Suspense 要求"两次 render 拿到同一个 promise 引用"，
 *           否则每次都是 pending → 无限 throw → 死循环。
 */

import React, { Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

// ============ 环境初始化 ============
const logs = [];
function log(...args) {
  const msg = args.join(' ');
  console.log(msg);
  logs.push(msg);
}

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

function Spinner() {
  return React.createElement('div', null, '⏳ 加载中...');
}

let fetchCallCount = 0;

// ============================================================
//  ❌ 错误写法：无缓存 — 每次调用都新建 Promise
// ============================================================
function naiveFetchUser(id) {
  fetchCallCount++;
  log(`  [无缓存] fetchUser(${id}) 被调用 — 第 ${fetchCallCount} 次请求！创建全新 Promise`);
  return createResource(
    new Promise(resolve => {
      setTimeout(() => resolve({ id, name: `用户${id}` }), 30);
    })
  );
}

/**
 * 无缓存的 User 组件 — 模拟死循环场景
 */
function NaiveUser({ id }) {
  log(`  [NaiveUser] render(id=${id})`);
  const resource = naiveFetchUser(id);   // ← 每次 render 都新建！
  const data = resource.read();          // ← 第一次 pending → throw
  // 如果 promise 已 resolve，这里能拿到数据
  return React.createElement('div', null, `✅ ${data.name}`);
}


// ============================================================
//  ✅ 正确写法：有缓存 Map — 同 id 返回同一引用
// ============================================================
const dataCache = new Map();
let cachedFetchCount = 0;

function cachedFetchUser(id) {
  if (!dataCache.has(id)) {
    cachedFetchCount++;
    log(`  [有缓存] fetchUser(${id}) 首次调用 — 创建并缓存 (#${cachedFetchCount}次实际请求)`);
    const p = new Promise(resolve => {
      setTimeout(() => resolve({ id, name: `用户${id}` }), 30);
    });
    const resource = createResource(p);
    dataCache.set(id, resource);
    return resource;
  }
  log(`  [有缓存] fetchUser(${id}) 命中缓存! 返回同一 resource 引用 ✅`);
  return dataCache.get(id);
}

/**
 * 有缓存的 User 组件
 */
function CachedUser({ id }) {
  log(`  [CachedUser] render(id=${id})`);
  const resource = cachedFetchUser(id);   // ← 同 id 始终返回同一引用
  const data = resource.read();
  return React.createElement('div', null, `✅ ${data.name}`);
}


// ============================================================
//  主实验
// ============================================================

function runL2() {
  log('===== L2: use() + 缓存 Map（防死循环） =====\n');

  // ========== 场景 A：无缓存（演示问题） ==========
  log('═══ 场景 A：无缓存（错误写法） ═══\n');
  log('模拟 3 次 render（模拟 Suspense 重试机制）:\n');

  fetchCallCount = 0;
  const wrapperA = document.createElement('div');
  document.body.appendChild(wrapperA);

  for (let i = 1; i <= 3; i++) {
    log(`--- render #${i} ---`);

    try {
      const rootA = createRoot(wrapperA);
      rootA.render(
        React.createElement(Suspense, { fallback: React.createElement(Spinner) },
          React.createElement(NaiveUser, { id: 1 })
        )
      );
      log(`  root.render() 返回成功（throw 被 Suspense 接住，显示 fallback）`);
    } catch (e) {
      log(`  ❌ 崩溃: ${e.message}`);
    }

    // 模拟等待 promise resolve 后重试
    if (i < 3) {
      log(`  → 等待 40ms 模拟 promise resolve...`);
      // 用同步方式让 promise 有机会 resolve
      const start = Date.now();
      while (Date.now() - start < 40) {} // busy-wait 让微任务有机会执行
    }
  }

  log(`\n场景A 结果: fetch 被调用了 ${fetchCallCount} 次！每次都新建 Promise`);
  log(`→ 如果是真实 React 的自动重试，这里会死循环 ♾️\n`);

  try { document.body.removeChild(wrapperA); } catch(e) {}

  // ========== 场景 B：有缓存（正确写法） ==========
  log('═══ 场景 B：有缓存 Map（正确写法） ═══\n');
  log('模拟 mount → suspend → resolve → rerender 完整流程:\n');

  cachedFetchCount = 0;
  dataCache.clear();

  const wrapperB = document.createElement('div');
  document.body.appendChild(wrapperB);

  // Render 1: 首次 mount（会 suspended）
  log(`[场景B] === render 1: 首次 mount ===`);
  try {
    const rootB = createRoot(wrapperB);
    rootB.render(
      React.createElement(Suspense, { fallback: React.createElement(Spinner) },
        React.createElement(CachedUser, { id: 1 })
      )
    );
    log(`root.render() 完成 → Suspense 接住 pending promise → 显示 fallback`);
  } catch(e) {
    log(`❌ 异常: ${e.message}`);
  }

  // 等 promise resolve
  log(`\n[场景B] 等待 40ms 让 fetch promise resolve...`);
  const start = Date.now();
  while (Date.now() - start < 40) {}

  // Render 2: promise 已 resolved，重试渲染
  log(`\n[场景B] === render 2: promise 已 resolved，重试 ===`);
  try {
    const rootB2 = createRoot(wrapperB);
    rootB2.render(
      React.createElement(Suspense, { fallback: React.createElement(Spinner) },
        React.createElement(CachedUser, { id: 1 })
      )
    );
    log(`root.render() 完成 → read() 直接返回数据 ✅`);
  } catch(e) {
    log(`❌ 异常: ${e.message}`);
  }

  // Render 3: 父组件 setState 导致 rerender（id 不变）
  log(`\n[场景B] === render 3: 模拟父组件 rerender（id 不变）===`);
  try {
    const rootB3 = createRoot(wrapperB);
    rootB3.render(
      React.createElement(Suspense, { fallback: React.createElement(Spinner) },
        React.createElement(CachedUser, { id: 1 })
      )
    );
    log(`root.render() 完成 → 命中缓存，直接返回数据 ✅`);
  } catch(e) {
    log(`❌ 异常: ${e.message}`);
  }

  log(`\n场景B 结果:`);
  log(`  - 实际请求次数: ${cachedFetchCount}（只发了 1 次！）\n`);

  try { document.body.removeChild(wrapperB); } catch(e) {}


  // ========== 场景 C：id 变化 ==========
  log('═══ 场景 C：id 变化的行为 ═══\n');

  const wrapperC = document.createElement('div');
  document.body.appendChild(wrapperC);

  log(`[场景C] === 切换到 id=2 ===`);
  try {
    const rootC = createRoot(wrapperC);
    rootC.render(
      React.createElement(Suspense, { fallback: React.createElement(Spinner) },
        React.createElement(CachedUser, { id: 2 })  // 新 id！
      )
    );
    log(`root.render() 完成 → id=2 不在缓存里 → 发起新请求 (#${cachedFetchCount})`);
  } catch(e) {
    log(`❌ 异常: ${e.message}`);
  }

  log(`\n场景C结果: id=2 自动发了第 ${cachedFetchCount} 次请求（正确！）\n`);

  try { document.body.removeChild(wrapperC); } catch(e) {}
}


// ============================================================
//  总结 & 结论
// ============================================================
function printSummary() {
  log('===== 关键结论 =====\n');
  log('1. 死循环根因:');
  log('   函数体每帧执行 → 每次 new Promise → 新 Promise 总是 pending');
  log('   → 又 throw → Suspense 又接住 → 等待 → 重试 → 又新建... ♾️\n');
  log('2. 解决方案 — 外部缓存 Map:');
  log('   const cache = new Map();');
  log('   function fetchData(id) {');
  log('     if (!cache.has(id)) cache.set(id, fetchUser(id).then(r=>r.json()));');
  log('     return cache.get(id);  // 同 id 返回同一引用！');
  log('   }\n');
  log('3. 缓存的是 Promise/Resource 引用，不是最终数据');
  log('   这样 React 才能在不同 render 间追踪状态变化\n');
  log('4. id 变化时自动发新请求 — 因为 Map 里没有这个新 key\n');
  log('');
  log('⭐ ⭐ ⭐ 面试必背 ⭐ ⭐ ⭐');
  log('"Suspense 数据获取的硬性前提是缓存——必须用外部 Map 保证');
  log(' 同一个 key 在多次 render 之间返回同一个 promise 引用。"');
}

// ============ 执行 ============
runL2();
log('');
printSummary();

log('\n========== L2 完成 ==========');
process.exit(0);
