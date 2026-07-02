/**
 * Day13 E2: useOptimistic 乐观更新 + 失败回滚
 * 验证：乐观UI立即变化 / 成功后确认 / 失败后自动回滚
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { useOptimistic, useState, useTransition } from 'react';
import { JSDOM } from 'jsdom';

const log = (...args) => console.log(`[${new Date().toISOString().slice(11,19)}]`, ...args);

// ===== 模拟 API =====
let shouldFail = false;
async function apiLike(postId) {
  await new Promise(r => setTimeout(r, 30));
  if (shouldFail) throw new Error('网络错误');
  return { liked: true, count: 42 };
}

// ===== 点赞按钮（useOptimistic 版）=====
function OptimisticLikeButton({ initialLiked }) {
  const [realLiked, setRealLiked] = useState(initialLiked);
  const [optLiked, toggleOpt] = useOptimistic(realLiked, (state, next) => next);
  const [isPending, startTransition] = useTransition();

  log(`  [render] real=${realLiked}, opt=${optLiked}`);

  async function handleToggle() {
    startTransition(async () => {
      // ① 先触发乐观更新
      const newValue = !optLiked;
      toggleOpt(newValue);
      log(`  → 乐观切换: optLiked → ${newValue} (真实值仍为 ${realLiked})`);

      try {
        // ② 发请求
        const res = await apiLike('post-1');
        // ③ 服务端确认
        setRealLiked(res.liked);
        log(`  → 请求成功! realLiked → ${res.liked}`);
      } catch (err) {
        // ④ ★ 失败 → 自动回滚（不需要手动 set 回去！）
        log(`  → 请求失败: ${err.message}`);
        log(`  → ★ 自动回滚: optLiked 将重新基于 realLiked(${realLiked}) 计算`);
        // 注意：回滚发生在下一次 render，因为真实值没变
      }
    });
  }

  return React.createElement('button', { onClick: handleToggle },
    `${optLiked ? '❤️' : '🤍'} 乐观=${optLiked} | 真实=${realLiked}${isPending ? ' | [请求中]' : ''}`
  );
}

// ===== 测试运行器 =====
const dom = new JSDOM('<!DOCTYPE html><div id="root"></div>', { url: 'http://localhost' });
global.document = dom.window.document;
global.window = dom.window;
const rootEl = dom.window.document.getElementById('root');
const root = createRoot(rootEl);

async function run() {
  console.log('=== E2: useOptimistic 乐观更新 + 失败回滚 ===\n');

  // --- 场景 A：成功流程 ---
  console.log('--- 场景 A：正常点赞（模拟成功）---');
  shouldFail = false;
  
  let renderLog = [];
  function TrackedLikeButton() {
    const [realLiked, setRealLiked] = useState(false);
    const [optLiked, toggleOpt] = useOptimistic(realLiked, (s, n) => n);
    renderLog.push({ real: realLiked, opt: optLiked });

    React.useEffect(() => {
      // 模拟点击
      let mounted = true;
      setTimeout(() => {
        if (!mounted) return;
        (async () => {
          toggleOpt(!optLiked); // 乐观：false→true
          try {
            await new Promise(r => setTimeout(r, 30));
            setRealLiked(true); // 确认
          } catch {}
        })();
      }, 50);
      return () => { mounted = false; };
    }, []);

    return React.createElement('span', null,
      `real=${realLiked} opt=${optLiked}`
    );
  }

  root.render(React.createElement(TrackedLikeButton));
  await new Promise(r => setTimeout(r, 40));
  log(`初始 render:`, renderLog[renderLog.length - 1]);

  await new Promise(r => setTimeout(r, 50));
  log(`乐观更新后:`, renderLog[renderLog.length - 1]);

  await new Promise(r => setTimeout(r, 50));
  log(`确认后:`, renderLog[renderLog.length - 1]);
  
  console.log(`\n  场景A 结论: 乐观值先变(true)，确认后真实值跟上，最终一致\n`);

  // --- 场景 B：失败回滚 ---
  console.log('--- 场景 B：失败自动回滚 ---');
  shouldFail = true;

  let failRenderLog = [];
  function FailTestButton() {
    const [realLiked, setRealLiked] = useState(false);
    const [optLiked, toggleOpt] = useOptimistic(realLiked, (s, n) => n);
    failRenderLog.push({ real: realLiked, opt: optLiked });

    React.useEffect(() => {
      let mounted = true;
      setTimeout(async () => {
        if (!mounted) return;
        toggleOpt(true); // 乐观：false→true
        log(`  乐观已触发: optLiked=true (realLiked仍=false)`);

        await new Promise(r => setTimeout(r, 30));
        
        if (!mounted) return;
        // 不调用 setRealLiked！模拟请求失败，真实值保持 false
        log(`  请求失败！真实值保持 realLiked=false`);
        log(`  → 下次 render 时 optLiked 将基于 realLiked(false) 重新计算`);
      }, 50);
      return () => { mounted = false; };
    }, []);

    return React.createElement('span', null,
      `real=${realLiked} opt=${optLiked}`
    );
  }

  root.render(React.createElement(FailTestButton));
  await new Promise(r => setTimeout(r, 40));
  log(`初始:`, failRenderLog[failRenderLog.length - 1]);

  await new Promise(r => setTimeout(r, 60)); // 乐观更新 + 等待"失败"
  log(`乐观→失败后:`, failRenderLog[failRenderLog.length - 1]);

  // 触发一次无关 setState 来强制 re-render，观察回滚
  log('\n  触发一次强制 re-render 来观察回滚行为...');
  function ForceReRenderTest() {
    const [, force] = useState(0);
    const [realLiked] = useState(false);
    const [optLiked] = useOptimistic(realLiked, (s, n) => n);
    
    React.useEffect(() => {
      let mounted = true;
      setTimeout(() => {
        if (mounted) force(n => n + 1); // 强制重渲染
      }, 100);
      return () => { mounted = false; };
    }, []);

    return React.createElement('span', null,
      `force render #${force % 10}: real=${realLiked} opt=${optLiked}`
    );
  }

  root.render(React.createElement(ForceReRenderTest));
  await new Promise(r => setTimeout(r, 150));

  console.log('\n=== E2 结论 ===');
  console.log('1. useOptimistic 让 UI 立刻响应（不等后端）');
  console.log('2. 成功时：setRealLiked 更新基准值 → 乐观值自然跟随');
  console.log('3. 失败时：不更新基准值 → 下次 render 乐观值自动回归真实值');
  console.log('4. 核心原理：optimistic 值不独立存储，每次 render 基于 currentValue 重算');
}

run().catch(console.error);
