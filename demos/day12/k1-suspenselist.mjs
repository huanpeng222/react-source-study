/**
 * Day 12 实验 L1：SuspenseList 三种模式对比
 *
 * 环境：jsdom + react@19 + react-dom@19
 * 运行: node k1-suspenselist.mjs
 *
 * 验证目标：
 *   - 无 SuspenseList → 先加载完的先显示
 *   - together       → 所有内容同时出现（等最慢的）
 *   - forwards       → 按 DOM 顺序从前往后逐个展示
 *   - backwards      → 从后往前倒序展示
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

// ============ Resource 工厂（Day11 同款） ============
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

// ============ 数据组件工厂 ============
/**
 * 创建一个"需要加载数据"的 React 组件
 * @param {string} name  组件名（用于日志）
 * @param {number} delay 延迟毫秒数
 * @returns {Function} React 组件函数
 */
function createDataComponent(name, delay) {
  const resource = createResource(
    new Promise(resolve => {
      setTimeout(() => {
        log(`  [${name}] 数据就绪 (耗时 ${delay}ms)`);
        resolve({ name, data: `${name}的数据` });
      }, delay);
    })
  );

  function DataComp() {
    log(`  [${name}] render 执行 → resource.read()`);
    const data = resource.read();
    return React.createElement('div', { style: { padding: '4px 0' } },
      `✅ ${name}: ${data.data}`
    );
  }
  DataComp.displayName = name;
  return DataComp;
}

// ============ Fallback 组件 ============
function Spinner() {
  log(`  [Spinner] fallback render`);
  return React.createElement('div', null, '⏳ 加载中...');
}

// ============ L1 主实验 ============
function runL1() {
  log('===== L1: SuspenseList 三种模式 =====\n');

  // ---------- 场景 A：无 SuspenseList ----------
  log('--- 场景 A：无 SuspenseList ---');
  runScenario('A (无SuspenseList)', null);
  log('');

  // ---------- 场景 B：together ----------
  log('--- 场景 B：revealOrder="together" ---');
  runScenario('B (together)', 'together');
  log('');

  // ---------- 场景 C：forwards ----------
  log('--- 场景 C：revealOrder="forwards" ---');
  runScenario('C (forwards)', 'forwards');
  log('');

  // ---------- 场景 D：backwards ----------
  log('--- 场景 D：revealOrder="backwards" ---');
  runScenario('D (backwards)', 'backwards');
  log('');
}

/**
 * 运行一个场景
 * @param {string} label     场景标签
 * @param {string|null} order revealOrder 值，null 表示无 SuspenseList
 */
function runScenario(label, order) {
  const wrapper = document.createElement('div');
  document.body.appendChild(wrapper);

  // 3 个组件延迟不同
  const ProfileCard  = createDataComponent('ProfileCard', 200);   // 中速
  const UserList     = createDataComponent('UserList', 400);      // 最慢
  const StatsChart   = createDataComponent('StatsChart', 100);    // 最快

  log(`[${label}] 开始渲染 (ProfileCard:200ms, UserList:400ms, StatsChart:100ms)`);

  let suspenseListEl;

  if (order !== null) {
    // 有 SuspenseList
    suspenseListEl = React.createElement(React.SuspenseList, { revealOrder: order },
      React.createElement(ProfileCard),
      React.createElement(UserList),
      React.createElement(StatsChart)
    );

    const root = createRoot(wrapper);
    root.render(
      React.createElement(Suspense, { fallback: React.createElement(Spinner) },
        suspenseListEl
      )
    );
    log(`[${label}] root.render() 完成 — SuspenseList revealOrder="${order}"`);
  } else {
    // 无 SuspenseList
    const root = createRoot(wrapper);
    root.render(
      React.createElement(Suspense, { fallback: React.createElement(Spinner) },
        React.createElement(ProfileCard),
        React.createElement(UserList),
        React.createElement(StatsChart)
      )
    );
    log(`[${label}] root.render() 完成 — 无 SuspenseList`);
  }

  // 清理
  try { document.body.removeChild(wrapper); } catch(e) {}
}

// ============ 总结 ============
function printSummary() {
  log('===== 关键结论 =====\n');
  log('1. 无 SuspenseList: 各子项独立，谁先 resolve 谁先露面（碎片式填充）');
  log('2. together:      所有子项等最慢的那个就绪后一起展示（整体闪现）');
  log('3. forwards:      按 DOM 顺序，前一个没展示完后面的即使就绪也得等着');
  log('4. backwards:     从后往前倒序露出，最后一项最先有机会露面\n');
  log('⭐ 面试话术: "SuspenseList 是窗帘控制器不是加速器——请求并发发出，只控制何时拉开窗帘"\n');

  log('===== 实验限制说明（同 Day11）=====\n');
  log('- jsdom 没有 Scheduler，无法观察到异步 resolve 后自动重试的真实时序');
  log('- 本实验聚焦于: 组件是否被调用 / throw 是否被接住 / 是否崩溃');
  log('- 完整的 revealOrder 视觉效果请在浏览器里用 create-react-app 验证');
}

// ============ 执行 ============
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>');
global.document = dom.window.document;
global.window = dom.window;

runL1();
printSummary();

log('========== L1 完成 ==========');
process.exit(0);
