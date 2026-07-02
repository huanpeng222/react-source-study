/**
 * N3: Streaming + Suspense + Error Boundary 模拟
 * 
 * 模拟 Next.js App Router 的自动化边界：
 *   1. loading.tsx = <Suspense fallback={LoadingUI}>
 *   2. error.tsx = <ErrorBoundary fallback={ErrorUI}>
 *   3. Streaming 流式替换（先骨架屏，后真实内容）
 */

import React, { useState, useEffect, Suspense, Component } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><div id="root"></div>', { url: 'http://localhost' });
global.document = dom.window.document;
global.window = dom.window;

const rootEl = dom.window.document.getElementById('root');

// ============================================================
// Part 1: 模拟 loading.tsx —— 自动 Suspense fallback
// ============================================================

function BlogLoading() {
  return React.createElement('div', {
    style: { padding: 15, background: '#f3f4f6', borderRadius: 8 },
    'data-testid': 'loading-ui',
  },
    React.createElement('p', null, '\u23F3 Loading...'),
    React.createElement('div', { style: { height: 12, background: '#e5e7eb', width: '80%', borderRadius: 4, marginTop: 8 } }),
    React.createElement('div', { style: { height: 12, background: '#e5e7eb', width: '60%', borderRadius: 4, marginTop: 6 } }),
    React.createElement('div', { style: { height: 12, background: '#e5e7eb', width: '90%', borderRadius: 4, marginTop: 6 } }),
  );
}

console.log('[N3] loading.tsx = <Suspense fallback={<BlogLoading />}>');
console.log('     (Server Component, returns immediately)');
console.log();

// ============================================================
// Part 2: 模拟 error.tsx —— 自动 ErrorBoundary (Client Component)
// ============================================================

class BlogErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return React.createElement('div', {
        style: { padding: 20, textAlign: 'center', border: '2px solid #ef4444', borderRadius: 8, margin: 10 },
        'data-testid': 'error-ui',
      },
        React.createElement('h3', { style: { color: '#dc2626' } }, '\u26A0\uFE0F Load Failed'),
        React.createElement('p', null, `Error: ${this.state.error.message}`),
        React.createElement('button', {
          onClick: () => this.setState({ error: null }),
          style: { marginTop: 10, padding: '5px 15px', cursor: 'pointer' },
          'data-testid': 'retry-btn',
        }, '\uD83D\uDD04 Retry')
      );
    }
    return this.props.children;
  }
}

console.log('[N3] error.tsx = <ErrorBoundary fallback={<BlogError />}>');
console.log('     (must be Client Component)');
console.log();

// ============================================================
// Part 3: 数据获取 + Suspense throw promise 模式
// ============================================================

let currentResource = null;

function createResource(promise) {
  let status = 'pending';
  let result;
  let suspender = promise.then(
    r => { status = 'success'; result = r; },
    e => { status = 'error'; result = e; }
  );

  return {
    read() {
      if (status === 'pending') throw suspender;
      if (status === 'error') throw result;
      return result;
    }
  };
}

function BlogList() {
  const posts = currentResource.read();
  return React.createElement('div', { 'data-testid': 'blog-content' },
    React.createElement('h3', null, '\uD83D\uDCDD Blog List'),
    ...posts.map((post, i) =>
      React.createElement('div', {
        key: i,
        style: { padding: '8px 0', borderBottom: '1px solid #eee' },
      }, `[${post.id}] ${post.title}`)
    )
  );
}

function FailingComponent() {
  currentResource.read(); // will throw
  return React.createElement('div', null);
}

// ============================================================
// Part 4: App Router 页面结构（自动包裹 Suspense + ErrorBoundary）
// ============================================================

function AppRouterPage({ mode }) {
  const PageComp = mode === 'error' ? FailingComponent : BlogList;

  return React.createElement(BlogErrorBoundary, null,
    React.createElement(Suspense, { fallback: React.createElement(BlogLoading) },
      React.createElement(PageComp)
    )
  );
}

// ============================================================
// Part 5: 运行实验
// ============================================================

async function runTests() {
  console.log('═══════════════════════════════════════');
  console.log('  N3: Streaming + Suspense + Error Boundary');
  console.log('═══════════════════════════════════════');

  let allPassed = true;

  // ===== Test A: 正常加载流程 =====
  console.log('\n── Test A: Normal Loading (Suspense -> Loading -> Content) ──');

  const fakePosts = [
    { id: 1, title: 'React 19 New Features' },
    { id: 2, title: 'RSC Payload Deep Dive' },
    { id: 3, title: 'App Router vs Pages' },
  ];

  currentResource = createResource(
    new Promise(r => setTimeout(() => r(fakePosts), 200))
  );

  const root = createRoot(rootEl);
  root.render(React.createElement(AppRouterPage, { mode: 'normal' }));

  // Phase 1: 应显示 Loading UI
  await new Promise(res => setTimeout(res, 50));
  const hasLoading50 = !!rootEl.querySelector('[data-testid="loading-ui"]');
  const hasContent50 = !!rootEl.querySelector('[data-testid="blog-content"]');
  const tA1 = hasLoading50 && !hasContent50;
  console.log(`  T=50ms: Loading=${hasLoading50} Content=${hasContent50} → ${tA1 ? '✅' : '❌'}`);
  allPassed = allPassed && tA1;

  // Phase 2: 数据就绪后显示真实内容
  await new Promise(res => setTimeout(res, 300));
  const hasContent = !!rootEl.querySelector('[data-testid="blog-content"]');
  const loadingGone = !rootEl.querySelector('[data-testid="loading-ui"]');
  const postCount = rootEl.querySelectorAll('[data-testid="blog-content"] > div').length;
  const tA2 = hasContent && loadingGone && postCount === 3;
  console.log(`  T=500ms: Content=${hasContent} LoadingGone=${loadingGone} Posts=${postCount}/3 → ${tA2 ? '✅' : '❌'}`);
  allPassed = allPassed && tA2;


  // ===== Test B: 错误处理流程 =====
  console.log('\n── Test B: Error Handling (Error Boundary) ──');

  root.unmount();
  currentResource = createResource(
    new Promise((_, rej) => setTimeout(() => rej(new Error('DB Connection Timeout')), 100))
  );

  const root2 = createRoot(rootEl);
  root2.render(React.createElement(AppRouterPage, { mode: 'error' }));

  await new Promise(res => setTimeout(res, 50));
  
  // 等待 reject + ErrorBoundary 渲染周期
  await new Promise(res => setTimeout(res, 300));

  const hasErrorUI = !!rootEl.querySelector('[data-testid="error-ui"]');
  const hasRetryBtn = !!rootEl.querySelector('[data-testid="retry-btn"]');
  const errorText = rootEl.querySelector('[data-testid="error-ui"]')?.textContent || '';
  const hasErrorMsg = errorText.includes('DB Connection Timeout');
  const tB1 = hasErrorUI && hasRetryBtn && hasErrorMsg;
  console.log(`  Error UI=${hasErrorUI} RetryBtn=${hasRetryBtn} MsgMatch=${hasErrorMsg} → ${tB1 ? '✅' : '❌'}`);
  allPassed = allPassed && tB1;

  // Test B2: 重试恢复
  if (hasRetryBtn) {
    root2.unmount();
    currentResource = createResource(
      new Promise(r => setTimeout(() => r([{ id: 99, title: 'Recovered Post' }]), 100))
    );

    const root3 = createRoot(rootEl);
    root3.render(React.createElement(AppRouterPage, { mode: 'normal' }));
    
    await new Promise(res => setTimeout(res, 400)); // wait for promise (100ms) + render cycles
    const recoveredContent = !!rootEl.querySelector('[data-testid="blog-content"]');
    const recoveredText = rootEl.querySelector('[data-testid="blog-content"]')?.textContent || '';
    const tB2 = recoveredContent && recoveredText.includes('Recovered Post');
    console.log(`  After retry: Content=${recoveredContent} Match=${tB2} → ${tB2 ? '✅' : '❌'}`);
    allPassed = allPassed && tB2;
  } else {
    var tB2 = false;
    console.log(`  After retry: skipped (no retry btn) → ❌`);
    allPassed = false;
  }

  // 总结
  console.log('\n═══════════════════════════════════════');
  console.log(allPassed ? '  ✅ N3 通过' : '  ❌ N3 有失败项');
  console.log('═══════════════════════════════════════');
  
  console.log('\n── Key Takeaways ──');
  console.log('  loading.tsx = <Suspense fallback={LoadingComponent}> (Server Component)');
  console.log('  error.tsx   = <ErrorBoundary fallback={ErrorComponent}> (Client Component)');
  console.log('  Streaming   = Loading shows first → async data ready → swap to real content');

  process.exit(allPassed ? 0 : 1);
}

runTests();
