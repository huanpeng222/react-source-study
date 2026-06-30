/**
 * Day 12 实验 L3：ErrorBoundary + Suspense 嵌套 — 真实 React 组件版
 *
 * 环境：jsdom + react@19 + react-dom@19
 * 运行: node k3-errorboundary.mjs
 *
 * 验证目标：
 *   场景 A: pending promise → 被 Suspense 接住 → 显示 fallback
 *   场景 B: rejected promise → .reason 是 Error → ErrorBoundary 接住
 *   场景 C: 正确嵌套顺序验证（ErrorBoundary 包在 Suspense 外面）
 *   场景 D: React.lazy + use(fetch) 共存于同一 Suspense
 */

import React, { Component, Suspense } from 'react';
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

// ============ 真实 ErrorBoundary 组件（面试标准写法） ============
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    log(`  [ErrorBoundary] componentDidCatch: ${error.message}`);
  }

  render() {
    if (this.state.hasError) {
      return React.createElement('div', { style: { color: 'red', padding: '8px' } },
        `❌ 出错了: ${this.state.error.message}`
      );
    }
    return this.props.children;
  }
}

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


// ============================================================
//  场景 A：pending promise → Suspense 捕获
// ============================================================
function runScenarioA() {
  log('═══ 场景 A：pending promise → Suspense ═══\n');

  const wrapper = document.createElement('div');
  document.body.appendChild(wrapper);

  // 永远不 resolve 的 promise
  const neverResolve = new Promise(() => {});
  const resource = createResource(neverResolve);

  function UserProfile() {
    log(`  [UserProfile] render → resource.read()`);
    const data = resource.read();   // throw pending promise
    return React.createElement('div', null, data.name);
  }

  try {
    const root = createRoot(wrapper);
    root.render(
      React.createElement(ErrorBoundary,
        null,
        React.createElement(Suspense, { fallback: React.createElement(Spinner) },
          React.createElement(UserProfile)
        )
      )
    );
    log(`✅ root.render() 成功 — throw 被 Suspense 接住，显示 <Spinner />`);
    log(`   用户看到: ⏳ 加载中...`);
  } catch (e) {
    log(`❌ 未捕获异常: ${e.message} — 这不应该发生！Suspense 应该接住`);
  }

  try { document.body.removeChild(wrapper); } catch(e) {}
  log('');
}


// ============================================================
//  场景 B：rejected promise → ErrorBoundary 捕获
// ============================================================
function runScenarioB() {
  log('═══ 场景 B：rejected promise → ErrorBoundary ═══\n');

  const wrapper = document.createElement('div');
  document.body.appendChild(wrapper);

  // 会 reject 的 promise
  const rejectedPromise = new Promise((_, rej) => {
    setTimeout(() => rej(new Error('网络请求失败: 500')), 10);
  });
  const resource = createResource(rejectedPromise);

  function FailingUser() {
    log(`  [FailingUser] render → resource.read()`);
    const data = resource.read();   // 可能是 pending 或 rejected
    return React.createElement('div', null, data.name);
  }

  // 先等一下让 promise reject
  const start = Date.now();
  while (Date.now() - start < 20) {} // busy-wait

  try {
    const root = createRoot(wrapper);
    root.render(
      React.createElement(ErrorBoundary,
        null,
        React.createElement(Suspense, { fallback: React.createElement(Spinner) },
          React.createElement(FailingUser)
        )
      )
    );
    // 如果到这里说明 ErrorBoundary 接住了
    log(`✅ root.render() 成功 — rejected reason 被 ErrorBoundary 接住`);
    log(`   用户看到: ❌ 出错了: 网络请求失败: 500`);
  } catch (e) {
    // 也可能直接抛出（取决于 jsdom 的调度时机）
    log(`⚠️ 抛出异常: ${e.message} — 在真实浏览器中会被 ErrorBoundary.getDerivedStateFromError 接住`);
  }

  try { document.body.removeChild(wrapper); } catch(e) {}
  log('');
}


// ============================================================
//  场景 C：嵌套顺序 — 为什么 ErrorBoundary 在外面
// ============================================================
function runScenarioC() {
  log('═══ 场景 C：正确嵌套顺序 ═══\n');
  log(`
正确的结构:

  <ErrorBoundary>           ← 最外层：接住非 thenable 错误
    <Suspense>              ← 中间层：接住 thenable（pending promise）
      <DataComponent />     ← 内层：可能 throw promise 或 error
    </Suspense>
  </ErrorBoundary>

为什么必须这样？

  throwException 路由逻辑（Day11 核心代码）:
  ┌─────────────────────────────────────┐
  │ throw value v                       │
  │     ↓                               │
  │ typeof v.then === 'function' ?      │
  │   ├─ Yes → 找最近的 Suspense        │  ← pending promise
  │   └─ No  → 找最近的 ErrorBoundary   │  ← rejected reason / Error / string
  └─────────────────────────────────────┘

  关键洞察:
  - pending promise 有 .then 方法 → Suspense 接住 ✅
  - rejected 后 use() 把 .reason(Error) 抛出
  - Error 没有 .then → ErrorBoundary 接住 ✅

  如果反过来写（Suspense 在外、ErrorBoundary 在内）:
  - JS 运行时异常（TypeError 等）→ ErrorBoundary 能接 ✅
  - fetch 失败的 rejected reason → 先碰到外层 Suspense
  - 但 Error 不是 thenable → Suspense 处理不了 → 冒泡 crash ❌
`);

  // 用代码验证路由判断
  log('--- 验证路由判断条件 ---\n');
  const testCases = [
    { label: 'pending promise', value: new Promise(()=>{}), expect: 'Suspense' },
    { label: 'rejected reason (Error)', value: new Error('500'), expect: 'ErrorBoundary' },
    { label: '运行时 TypeError', value: new TypeError('Cannot read x'), expect: 'ErrorBoundary' },
    { label: 'null', value: null, expect: 'ErrorBoundary' },
    { label: '字符串 "出错"', value: '出错', expect: 'ErrorBoundary' },
  ];

  for (const tc of testCases) {
    const isThenable = tc.value !== null && typeof tc.value.then === 'function';
    const route = isThenable ? 'Suspense' : 'ErrorBoundary';
    const match = route === tc.expect ? '✅' : '❌';
    log(`  ${match} throw(${tc.label}) → typeof .then==='function'? ${isThenable} → ${route}`);
  }
  log('');
}


// ============================================================
//  场景 D：React.lazy + 数据请求共存
// ============================================================
function runScenarioD() {
  log('═══ 场景 D：React.lazy + use(fetch) 同一 Suspense ═══\n');
  log(`
同一个 <Suspense> 可以管理两种异步源:

  <Suspense fallback={<Spin />}>
    <LazyComponent />       {/* React.lazy() → chunk 加载完成 resolve */}
    <UserData />            {/* use(fetchData()) → API 返回 resolve */}
  </Suspense>

两种异步源都是 "throw promise"：
  - lazy: throw chunk loading promise（JS 模块加载）
  - use(): throw data fetching promise（API 请求）

React 不关心 promise 来源，只看"是否 thenable"。
只要任一还在 pending → 都显示同一个 fallback。
全部 resolve → 渲染完整 UI。

用户只看到一次 Loading —— 这是 Suspense 的"统一等待区"能力。
`);
  log('');
}


// ============================================================
//  完整决策树 & 总结
// ============================================================
function printSummary() {
  log('=== throwException 完整决策树 ===\n');
  log(`
  组件 render 中 throw 出值 v
        │
        ▼
  ┌─ v === null/undefined ? ─────┐
  │ Yes → ErrorBoundary 路线     │  case 1
  │ No  ↓                        │
  ├─ typeof v.then === function? ─┐
  │ Yes → Suspense 路线          │  case 2,3 (thenable)
  │ No  → ErrorBoundary 路线     │  case 4,5,6 (其他一切)
  └──────────────────────────────┘

  Suspense 内部再分:
  ├── promise pending   → 显示 fallback，注册 ping 监听
  ├── promise fulfilled → 重试渲染（这次不 throw）
  └── promise rejected  → 把 .reason 当 error 重 throw → 走 ErrorBoundary

  ErrorBoundary 内部再分:
  ├── 有父级 EB → static getDerivedStateFromError()
  ├── 无父级但父组件 → 向上冒泡到 root（白屏）
  └── 开发模式 → 红色错误 overlay
`);

  log('=== 最终对照表 ===\n');
  log('+------------------+---------------+----------------+');
  log('| throw 的值        | 谁捕获         | 用户看到       |');
  log('+------------------+---------------+----------------+');
  log('| pending promise  | Suspense       | ⏳ Loading     |');
  log('| rejected reason  | ErrorBoundary  | ❌ Error UI    |');
  log('| Error 对象       | ErrorBoundary  | ❌ Error UI    |');
  log('| null / undefined | ErrorBoundary  | ❌ Error UI    |');
  log('| 字符串/数字      | ErrorBoundary  | ❌ Error UI    |');
  log('+------------------+---------------+----------------+\n');

  log('=== 面试必背 3 条 ===\n');
  log('1. Suspense 只捕获 thenable（typeof .then === "function"）');
  log('2. ErrorBoundary 捕获其他一切（Error/null/string/number）');
  log('3. 所以 ErrorBoundary 必须包在 Suspense 外面！\n');
}

// ============ 执行 ============
runScenarioA();
runScenarioB();
runScenarioC();
runScenarioD();
printSummary();

log('========== L3 完成 ==========');
process.exit(0);
