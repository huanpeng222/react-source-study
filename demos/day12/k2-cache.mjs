/**
 * Day 12 实验 L2：use(promise) + 缓存 Map（防死循环）
 *
 * 验证目标：
 * 1. 无缓存 → 每次渲染都创建新 Promise → 死循环
 * 2. 有缓存 Map → 同 id 返回同一 Promise 引用 → 正常工作
 * 3. id 变化时自动发新请求
 *
 * 运行: node k2-cache.mjs
 */

const log = (...args) => console.log(`[${new Date().toISOString().slice(11,19)}]`, ...args);

// ============ 模拟 React use() ============
// React 19 的 use() 核心行为：根据 promise 状态返回值或 throw

function mockUse(promise) {
  if (promise.status === 'fulfilled') {
    return promise.value; // 已 resolve → 直接返回数据
  }
  if (promise.status === 'rejected') {
    throw promise.reason; // 已 reject → 抛出错误
  }
  // pending → throw promise，让 Suspense 捕获
  throw promise;
}

// ============ 场景 A：无缓存（死循环演示） ============

/**
 * ❌ 错误写法：每次调用都 new 一个新 Promise
 */
let renderCount_A = 0;
function naiveFetchData(id) {
  log(`  [场景A] fetchUser(${id}) 被调用 — 创建全新 Promise`);
  return new Promise((resolve) => {
    setTimeout(() => resolve({ id, name: `用户${id}` }), 50);
  });
}

function simulateRenderWithoutCache(id) {
  renderCount_A++;
  log(`[场景A] 第 ${renderCount_A} 次 render`);

  try {
    const p = naiveFetchData(id);       // 每次 render 都新建！
    const data = mockUse(p);            // p 是新的 → pending → throw
    log(`[场景A] ✅ 渲染成功: ${data.name}`);
    return { success: true, data };
  } catch (thrownValue) {
    if (thrownValue instanceof Promise && typeof thrownValue.then === 'function') {
      log(`[场景A] ⏳ Suspense 捕获到 promise，显示 fallback...`);
      return { success: false, reason: 'suspended' };
    }
    log(`[场景A] ❌ 抛出了非 thenable 错误: ${thrownValue}`);
    return { success: false, reason: 'error', error: thrownValue };
  }
}

// ============ 场景 B：有缓存 Map（正确写法） ============

/**
 * ✅ 正确写法：缓存 Promise 引用
 */
const dataCache = new Map();
let fetchCallCount_B = 0;

function cachedFetchData(id) {
  if (!dataCache.has(id)) {
    fetchCallCount_B++;
    log(`  [场景B] fetchUser(${id}) 首次调用 — 创建并缓存 Promise (#${fetchCallCount_B}次实际请求)`);
    const p = new Promise((resolve) => {
      setTimeout(() => resolve({ id, name: `用户${id}` }), 50);
    });
    // 给 p 加上 status 字段（模拟 React 内部标记）
    p.then(
      (value) => { p.status = 'fulfilled'; p.value = value; },
      (reason) => { p.status = 'rejected'; p.reason = reason; }
    );
    dataCache.set(id, p);
    return p;
  }
  log(`  [场景B] fetchUser(${id}) 命中缓存! 返回同一个 Promise 引用`);
  return dataCache.get(id);
}

let renderCount_B = 0;
function simulateRenderWithCache(id) {
  renderCount_B++;
  log(`[场景B] 第 ${renderCount_B} 次 render`);

  try {
    const p = cachedFetchData(id);     // 同 id 始终返回同一引用
    const data = mockUse(p);            // p 已 resolved → 返回数据！
    log(`[场景B] ✅ 渲染成功: ${data.name}`);
    return { success: true, data };
  } catch (thrownValue) {
    if (thrownValue instanceof Promise && typeof thrownValue.then === 'function') {
      log(`[场景B] ⏳ Suspense 捕获到 promise，显示 fallback...`);
      return { success: false, reason: 'suspended' };
    }
    return { success: false, reason: 'error' };
  }
}

// ============ 辅助：等待 promise settle 后重试 ============
async function waitAndRerender(renderer, id, maxRenders = 5) {
  for (let i = 0; i < maxRenders; i++) {
    const result = renderer(id);
    if (result.success) return result;
    await new Promise(r => setTimeout(r, 60)); // 等 promise resolve
  }
  return { success: false, reason: `超过最大重试次数(${maxRenders})` };
}

// ============ 主实验 ============
async function runExperiment() {
  log('=== Day 12 L2: use() + 缓存 Map（防死循环） ===\n');

  // ========== 场景 A 演示 ==========
  log('═════════ 场景 A：无缓存（死循环演示） ═════════\n');
  log('模拟 3 次 render 循环:\n');
  renderCount_A = 0;
  for (let i = 1; i <= 4; i++) {
    const result = simulateRenderWithoutCache(1);
    if (i < 4 && result.reason === 'suspended') {
      // 模拟 "promise resolve → React 重试"
      log('  → (模拟: promise resolve, React 重试 render)\n');
      await new Promise(r => setTimeout(r, 60));
    }
  }

  log(`场景A 结果: ${renderCount_A} 次 render，全部挂起 → ♾️ 死循环\n`);

  // ========== 场景 B 演示 ==========
  log('═════════ 场景 B：有缓存 Map（正确写法） ═════════\n');
  log('模拟完整的 mount → suspend → resolve → rerender 流程:\n');
  renderCount_B = 0;
  fetchCallCount_B = 0;

  // render 1: 首次，没有缓存
  const r1 = simulateRenderWithCache(1); // 应该 suspended
  await new Promise(r => setTimeout(r, 60)); // 等 fetch resolve

  // render 2: promise 已 resolved，但 use() 需要重试
  const r2 = simulateRenderWithCache(1); // 应该成功！

  // render 3: 父组件 rerender（id 不变）
  log('\n--- 模拟: 父组件 setState 导致 rerender ---');
  const r3 = simulateRenderWithCache(1); // 命中缓存，直接成功

  log(`\n场景B 结果:`);
  log(`  - 总 render 次数: ${renderCount_B}`);
  log(`  - 实际请求次数: ${fetchCallCount_B}（只发了 1 次网络请求！）`);
  log(`  - 最终状态: ✅ 成功渲染\n`);

  // ========== 场景 C：id 变化 ==========
  log('═════════ 场景 C：id 变化时的行为 ═════════\n');
  const r4 = simulateRenderWithCache(2); // 新 id，应该又 suspended
  await new Promise(r => setTimeout(r, 60));
  const r5 = simulateRenderWithCache(2); // 成功

  log(`\n场景C结果: id=2 时实际请求了 #${fetchCallCount_B} 次新请求（正确！）\n`);

  // ========== 总结 ==========
  log('=== 关键结论 ===\n');
  log('1. 死循环根因: 函数体每帧执行 → 每次 new Promise → 新 Promise 总是 pending → 又 throw');
  log('2. 解决方案: 缓存 Map 保证同 key 返回同一个 Promise 引用');
  log('3. 缓存的是 Promise 不是数据 —— 这样 use() 才能追踪状态变化');
  log('4. id 变化时自动发新请求 —— 因为 Map 里没有这个新 key');
  log('');
  log('⭐ 面试话术:');
  log('   "Suspense 要求两次 render 拿到同一个 promise 引用，');
  log('    所以必须用外部 Map 缓存。这是 Suspense 数据获取的硬性前提。"');
}

runExperiment().catch(console.error);
