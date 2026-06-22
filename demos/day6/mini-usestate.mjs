// mini useState —— 贴近真实 React 源码的简化实现
// 运行：node demos/day6/mini-usestate.mjs
//
// 覆盖的源码机制（对应 packages/react-reconciler/src/ReactFiberHooks.js
//                + ReactFiberRootScheduler.js）：
//   1. setState 不立即改 state，只创建 update 入队 queue.pending（环形链表）
//   2. 同一同步栈里多次 setState 被批处理（microtask 去重，只 render 一次）
//   3. 下一次 render 时 updateReducer 遍历 queue 逐个 reduce 累积
//   4. cursor++ 对应真实链表的 next 指针；render 前 cursor 归零
//   5. 值更新 vs 函数式更新：action 存值 / 存函数，basicStateReducer 分流

// ─────────────────────────────────────────────
// 全局：模拟一个函数组件 fiber 的 Hook 存储
// ─────────────────────────────────────────────
let hooks = [];        // 每个槽 = 一个 Hook 节点 { memoizedState, queue }
let cursor = 0;        // 当前 Hook 索引（真实 React 是 workInProgressHook 指针）
let Component = null;  // 当前要渲染的组件函数
let isRendering = false;

// 批处理调度：microtask 去重标志（对应 didScheduleMicrotask）
let scheduled = false;

// basicStateReducer：值更新 vs 函数式更新在这里分流
function basicStateReducer(state, action) {
  return typeof action === 'function' ? action(state) : action;
}

// ─────────────────────────────────────────────
// useState
// ─────────────────────────────────────────────
function useState(initial) {
  const i = cursor;

  // mount：初始化这个 Hook 节点（含独立的 queue）
  if (hooks[i] === undefined) {
    hooks[i] = {
      memoizedState: typeof initial === 'function' ? initial() : initial,
      queue: { pending: [] },   // 简化：用数组代替环形链表
    };
  }

  const hook = hooks[i];

  // update：消费 queue 里攒下的所有 update，逐个 reduce 累积
  if (hook.queue.pending.length > 0) {
    let newState = hook.memoizedState;      // 从当前值（baseState）出发
    for (const action of hook.queue.pending) {
      newState = basicStateReducer(newState, action);  // 依次执行
    }
    hook.memoizedState = newState;          // ★ state 此刻才真正改变
    hook.queue.pending = [];                // 清空队列
  }

  // dispatch：闭包捕获 hook（真实 React 是 bind 捕获 fiber + queue）
  const setState = (action) => {
    hook.queue.pending.push(action);        // ① 只入队，不立即改 state
    scheduleRender();                        // ② 调度一次 render（批处理）
  };

  cursor++;                                  // 移动到下一个 Hook 槽（对应链表 next）
  return [hook.memoizedState, setState];
}

// ─────────────────────────────────────────────
// 批处理调度：同一同步栈内多次 setState 只触发一个 microtask
// ─────────────────────────────────────────────
function scheduleRender() {
  if (scheduled) return;                     // 去重：已调度则跳过（合并）
  scheduled = true;
  queueMicrotask(() => {                      // 延迟到当前同步栈跑完
    scheduled = false;
    render();
  });
}

// ─────────────────────────────────────────────
// render：每次渲染前 cursor 归零，重新执行组件
// ─────────────────────────────────────────────
let renderCount = 0;
function render() {
  cursor = 0;                                // ★ render 前归零（对应 wIPHook=null）
  isRendering = true;
  renderCount++;
  Component();                               // 重新执行组件，useState 从头按序读
  isRendering = false;
}

// 启动一个组件（首次 mount）
function mount(comp) {
  Component = comp;
  hooks = [];
  renderCount = 0;
  render();
}

// 等所有 microtask 跑完（演示用）
const flush = () => new Promise((r) => setTimeout(r, 0));

// ═════════════════════════════════════════════
// 用例
// ═════════════════════════════════════════════
async function main() {
  // ── 用例 1：值更新 ×3 → 批处理后互相覆盖，n = 3（不是 6） ──
  console.log('\n=== 用例1：值更新 setN(n+1) ×3（同一栈）===');
  let snap1;
  mount(function App() {
    const [n, setN] = useState(0);
    snap1 = { n, setN };
    console.log(`  render #${renderCount}: n =`, n);
  });
  // 同一同步栈连续 3 次：闭包里的 n 都是 0，action 都是 1
  snap1.setN(snap1.n + 1);
  snap1.setN(snap1.n + 1);
  snap1.setN(snap1.n + 1);
  await flush();
  console.log('  结果 n =', snap1.n, '（3 个 action 都是 1，覆盖 → 1）');
  console.log('  render 次数 =', renderCount, '（批处理：3 次 setN 只 render 1 次）');

  // ── 用例 2：函数式 ×3 → 链式累积，n = 6 ──
  console.log('\n=== 用例2：函数式 setN(prev=>prev+1) ×3 ===');
  let snap2;
  mount(function App() {
    const [n, setN] = useState(3);
    snap2 = { n, setN };
    console.log(`  render #${renderCount}: n =`, n);
  });
  snap2.setN((p) => p + 1);
  snap2.setN((p) => p + 1);
  snap2.setN((p) => p + 1);
  await flush();
  console.log('  结果 n =', snap2.n, '（prev 来自上次 reduce 结果：3→4→5→6）');

  // ── 用例 3：多 Hook → 各自 queue 独立，按 cursor 顺序对应 ──
  console.log('\n=== 用例3：多 Hook（cursor 顺序对应各自 queue）===');
  let snap3;
  mount(function App() {
    const [n, setN] = useState(10);      // 槽 0
    const [s, setS] = useState('a');     // 槽 1
    snap3 = { n, s, setN, setS };
    console.log(`  render #${renderCount}: n =`, n, ', s =', s);
  });
  snap3.setN((p) => p + 6);              // 只动槽 0
  snap3.setS('b');                       // 只动槽 1
  await flush();
  console.log('  结果 n =', snap3.n, ', s =', snap3.s, '（两 Hook 互不干扰）');

  // ── 用例 4：值/函数式混用 → 队列里混着值和函数，按序消费 ──
  console.log('\n=== 用例4：混用 setN(100) 然后 setN(p=>p+1) ===');
  let snap4;
  mount(function App() {
    const [n, setN] = useState(0);
    snap4 = { n, setN };
    console.log(`  render #${renderCount}: n =`, n);
  });
  snap4.setN(100);                       // action = 值 100
  snap4.setN((p) => p + 1);              // action = 函数，基于上一步结果
  await flush();
  console.log('  结果 n =', snap4.n, '（0 →(值)100 →(函数)101）');

  console.log('\n✅ 全部用例完成');
}

main();
