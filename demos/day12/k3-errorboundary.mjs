/**
 * Day 12 实验 L3：ErrorBoundary + Suspense 嵌套
 *
 * 验证目标：
 * 1. pending → Suspense 捕获 → 显示 fallback
 * 2. reject → ErrorBoundary 捕获 → 显示错误 UI
 * 3. 两者同时存在时，正确的嵌套顺序
 * 4. React.lazy() + 数据请求共存于同一个 Suspense
 *
 * 运行: node k3-errorboundary.mjs
 */

const log = (...args) => console.log(`[${new Date().toISOString().slice(11,19)}]`, ...args);

// 防止 unhandled rejection 导致 Node 进程退出（React 环境下有 ErrorBoundary 接住）
process.on('unhandledRejection', () => {});

// ============ 模拟 React 内部机制 ============

/**
 * 模拟 throwException 的路由逻辑（Day11 学过的 6 种 case）
 * 来自 ReactFiberThrow.js
 *
 * throwException(value):
 *   if (value === null || typeof value.then !== 'function')
 *     → 非 thenable → 找 ErrorBoundary（或 root）
 *   else
 *     → thenable (promise) → 找最近的 Suspense 边界
 */
function classifyThrownValue(value) {
  if (value === null || value === undefined) {
    return { type: 'null', route: 'ErrorBoundary', detail: 'throw 了 null/undefined' };
  }
  if (typeof value.then === 'function') {
    return { type: 'thenable', route: 'Suspense', detail: 'Promise/thenable — 走 Suspense 路线' };
  }
  // 其他所有情况
  return { type: 'error', route: 'ErrorBoundary', detail: `非 thenable: ${String(value).slice(0,50)}` };
}

// ============ 场景模拟 ============

async function runExperiment() {
  log('=== Day 12 L3: ErrorBoundary + Suspense 嵌套 ===\n');

  // ========== 场景 A：pending promise → Suspense ==========
  log('═════════ 场景 A：pending promise → Suspense ═════════\n');

  const pendingPromise = new Promise(() => {}); // 永远不 resolve
  const classificationA = classifyThrownValue(pendingPromise);
  log(`throw 出的值: ${pendingPromise.constructor.name}`);
  log(`分类结果:`);
  log(`  - 类型: ${classificationA.type}`);
  log(`  - 路由: ${classificationA.route}`);
  log(`  - 说明: ${classificationA.detail}`);
  log(`  → 用户看到: <Spin /> (Suspense fallback)\n`);

  // ========== 场景 B：rejected promise → ErrorBoundary ==========
  log('═════════ 场景 B：rejected promise → ErrorBoundary ═════════\n');

  const rejectedPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('网络请求失败: 500')), 10);
  });

  // 等 reject 后再分类
  const error = await new Promise((resolve) => {
    rejectedPromise.catch(err => resolve(err));
    setTimeout(() => resolve(new Error('超时')), 50);
  });

  {
    const classificationB = classifyThrownValue(error);
    log(`throw 出的值: ${error.message}`);
    log(`分类结果:`);
    log(`  - 类型: ${classificationB.type}`);
    log(`  - 路由: ${classificationB.route} ← 关键！rejected promise 的 reason 是普通 error`);
    log(`  - 说明: ${classificationB.detail}`);
    log(`  → 用户看到: <ErrorFallback /> (ErrorBoundary fallback)\n`);
  }

  // ========== 场景 C：正确的嵌套结构 ==========
  log('═════════ 场景 C：正确嵌套顺序 ═════════\n');
  log(`
  <ErrorBoundary>          ← 最外层：接住错误
    <Suspense>             ← 中间层：接住 pending
      <User id={123} />    ← 内层：可能 throw promise 或 error
    </Suspense>
  </ErrorBoundary>

  为什么必须 ErrorBoundary 在外面？
  因为 Suspense 只能捕获 thenable（pending promise）。
  当 promise reject 时，use() 会把 .reason（一个 Error 对象）抛出，
  Error 不是 thenable → Suspense 接不住 → 冒泡到 ErrorBoundary。

  如果反过来写:
    <Suspense>            ← 外层
      <ErrorBoundary>     ← 内层
        <User />
      </ErrorBoundary>
    </Suspense>

  问题：当 User 组件 JS 抛出运行时异常时（不是数据错误），
  ErrorBoundary 能接住。但当 fetch 失败时，reject 的 reason
  从 use() 抛出 → Suspense 先拦截（因为 Suspense 在外层），
  但它无法处理非 thenable 错误 → 直接 crash 到 root！
`);

  // ========== 场景 D：React.lazy + 数据请求共存 ==========
  log('═════════ 场景 D：React.lazy + use(fetch) 共存 ═════════\n');

  /**
   * 同一个 Suspense 边界下的两个异步源:
   * 1. React.lazy() → chunk 加载完成时 resolve（返回模块默认导出）
   * 2. use(fetchData()) → 数据请求完成时 resolve（返回 JSON）
   *
   * 它们都是 "throw promise" → 被同一个 Suspense 捕获
   * 只要任意一个还在 pending → 都显示同一个 fallback
   * 全部 resolve → 正常渲染
   */

  let chunkResolved = false;
  let dataResolved = false;
  const chunkPromise = new Promise(resolve => {
    setTimeout(() => {
      chunkResolved = true;
      log('  [lazy] chunk 加载完成');
      resolve(() => 'LazyComponentModule');
    }, 80); // 模拟 JS 加载
  });

  const dataPromise = new Promise(resolve => {
    setTimeout(() => {
      dataResolved = true;
      log('  [fetch] 数据加载完成');
      resolve({ name: '张三' });
    }, 120); // 模拟 API 请求（比 chunk 慢）
  });

  log('开始加载（并发）:\n');

  // 模拟时间线
  const timeline = [
    { t: 0,    event: 'render 开始' },
    { t: 1,    event: 'React.lazy() throw chunkPromise → Suspense 捕获' },
    { t: 80,   event: 'chunk resolve! 但 data 还是 pending → 继续 fallback' },
    { t: 120,  event: 'data resolve! 两个都就绪 → 渲染真实 UI ✅' },
  ];

  for (const step of timeline) {
    log(`  +${step.t.toString().padStart(3)}ms  ${step.event}`);
  }

  log('\n⭐ 关键洞察:');
  log('   同一个 Suspense 管理两种异步：JS 模块 + 数据请求。');
  log('   用户只看到一次 loading 状态——这是 Suspense 的"统一等待区"能力。\n');

  // ========== 完整决策树 ==========
  log('=== throwException 完整决策树（Day11 + Day12 合集）===\n');
  log(`
  组件 render 过程中 throw 出了某个值 v
        │
        ▼
  ┌─ v === null / undefined ? ─┐
  │ Yes → ErrorBoundary 路线   │  (case 1)
  │ No  ↓                      │
  ├─ typeof v.then === 'function'? ─┐
  │ Yes → Suspense 路线         │  (case 2,3)
  │ No  → ErrorBoundary 路线     │  (case 4,5,6)
  │                               │
  └───────────────────────────────┘

  Suspense 路线内部再分:
  ├── promise pending  → 显示 fallback，注册 ping 监听
  ├── promise fulfilled→ 重试渲染（这次不 throw 了）
  └── promise rejected → 把 .reason 当 error 重新 throw → 走 ErrorBoundary

  ErrorBoundary 路线内部再分:
  ├── 有父级 ErrorBoundary  → 调用 static getDerivedStateFromError()
  ├── 没有但有父级组件       → 向上冒泡直到 root（白屏）
  └── 开发模式               → 红色错误覆盖层 overlay
`);

  // ============ 最终总结 ============
  log('=== Day 12 全部实验总结 ===\n');
  log('+--------+------------------+------------------+');
  log('| throw值 | 谁捕获           | 用户看到          |');
  log('+--------+------------------+------------------+');
  log('| pending | Suspense        | Loading/Fallback |');
  log('| reject | ErrorBoundary   | Error UI         |');
  log('| error  | ErrorBoundary   | Error UI         |');
  log('| null   | ErrorBoundary   | Error UI         |');
  log('+--------+------------------+------------------+');
  log('');
  log('面试必背:');
  log('1. Suspense 只捕获 thenable，ErrorBoundary 捕获其他一切');
  log('2. 所以 ErrorBoundary 必须包在 Suspense 外面');
  log('3. 同一 Suspense 可同时管 lazy(chunk) + use(data)');
  log('4. SuspenseList 只控制展示时机，不影响加载速度');
}

runExperiment().catch(console.error);
