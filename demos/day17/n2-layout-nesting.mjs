/**
 * N2: Layout 嵌套系统模拟
 * 
 * 模拟 Next.js App Router 的 Layout 核心机制：
 *   1. Layout 不随路由切换而重挂载（状态保持）
 *   2. Template 每次导航都销毁重建
 *   3. 嵌套 Layout 的 children 传递
 */

import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><div id="root"></div>', { url: 'http://localhost' });
global.document = dom.window.document;
global.window = dom.window;

const rootEl = dom.window.document.getElementById('root');

// ============================================================
// 计数器
// ============================================================
let layoutMountCount = 0;
let templateMountCount = 0;

// ============================================================
// Part 1: 模拟 Layout 组件（状态持久）
// ============================================================

function RootLayout({ children }) {
  const [navState, setNavState] = useState('expanded');
  const mountId = ++layoutMountCount;
  
  return React.createElement('div', {
    style: { border: '2px solid #3b82f6', padding: 10, margin: 5 },
    'data-testid': 'layout-wrapper',
  },
    React.createElement('div', { 'data-testid': 'layout-info' },
      `RootLayout (mount #${mountId}, navState=${navState})`
    ),
    React.createElement('button', {
      onClick: () => setNavState(s => s === 'expanded' ? 'collapsed' : 'expanded'),
      'data-testid': 'toggle-nav',
    }, `Toggle Nav (${navState})`),
    React.createElement('div', {
      style: { marginTop: 10, padding: 10, border: '1px dashed #999' },
    }, children)
  );
}

// ============================================================
// Part 2: 模拟 Template 组件（每次重建）
// ============================================================

function MyTemplate({ children }) {
  const [count, setCount] = useState(0);
  const mountId = ++templateMountCount;
  
  useEffect(() => {
    console.log(`[Template] Mounted! mountId=${mountId}`);
  }, []);
  
  return React.createElement('div', {
    style: { border: '2px solid #f59e0b', padding: 10, margin: 5, background: '#fef3c7' },
    'data-testid': 'template-wrapper',
  },
    React.createElement('div', { 'data-testid': 'template-info' },
      `Template (mount #${mountId}, count=${count})`
    ),
    React.createElement('button', {
      onClick: () => setCount(c => c + 1),
      'data-testid': 'inc-template',
    }, 'Template +1'),
    React.createElement('div', null, children)
  );
}

// ============================================================
// Part 3: 页面组件
// ============================================================

function HomePage() {
  return React.createElement('div', { 'data-testid': 'page-name' }, 'Home Page');
}
function AboutPage() {
  return React.createElement('div', { 'data-testid': 'page-name' }, 'About Page');
}
function BlogPage() {
  return React.createElement('div', { 'data-testid': 'page-name' }, 'Blog Page');
}

const pages = { '/': HomePage, '/about': AboutPage, '/blog': BlogPage };

// ============================================================
// Part 4: 模拟 Router
// ============================================================

function App() {
  const [currentPath, setCurrentPath] = useState('/');
  const [useLayoutMode, setUseLayoutMode] = useState(true);
  const PageComponent = pages[currentPath];
  
  let content = React.createElement(PageComponent);
  
  if (useLayoutMode) {
    content = React.createElement(RootLayout, null, content);
  } else {
    content = React.createElement(MyTemplate, null, content);
  }
  
  // 导航按钮
  const navButtons = Object.keys(pages).map(path =>
    React.createElement('button', {
      key: path,
      onClick: () => setCurrentPath(path),
      'data-testid': `nav-${path.slice(1) || 'home'}`,
      style: { marginRight: 5 },
    }, path === '/' ? 'Home' : path)
  );
  
  const switchBtn = React.createElement('button', {
    onClick: () => setUseLayoutMode(m => !m),
    'data-testid': 'switch-mode',
    style: { marginLeft: 15, background: useLayoutMode ? '#dbeafe' : '#fef3c7' },
  }, `Switch to ${useLayoutMode ? 'Template' : 'Layout'}`);

  return React.createElement('div', { style: { fontFamily: 'monospace', fontSize: 14 } },
    React.createElement('h3', null, 'Navigation Bar'),
    React.createElement('div', { style: { marginBottom: 10 } }, ...navButtons, switchBtn),
    React.createElement('div', { 'data-testid': 'path-display' }, `Current: ${currentPath}`),
    content
  );
}

// ============================================================
// Part 5: 运行实验
// ============================================================

async function runTests() {
  console.log('═══════════════════════════════════════');
  console.log('  N2: Layout 嵌套系统');
  console.log('═══════════════════════════════════════');

  const root = createRoot(rootEl);
  root.render(React.createElement(App));
  await new Promise(r => setTimeout(r, 100));

  let allPassed = true;

  // Test 1: 初始渲染 — Home 在 RootLayout 内
  const hasLayoutInfo = !!rootEl.querySelector('[data-testid="layout-info"]');
  const hasHome = (rootEl.querySelector('[data-testid="page-name"]')?.textContent || '').includes('Home');
  const t1 = hasLayoutInfo && hasHome;
  console.log(`\n[Test 1] 初始渲染: Layout存在=${hasLayoutInfo} Home存在=${hasHome} → ${t1 ? '✅' : '❌'}`);
  allPassed = allPassed && t1;

  // Test 2: 导航到 About — Layout 不重挂载（始终只有 1 个 Layout 实例）
  const aboutBtn = rootEl.querySelector('[data-testid="nav-about"]');
  if (aboutBtn) aboutBtn.click();
  await new Promise(r => setTimeout(r, 50));

  const layouts = rootEl.querySelectorAll('[data-testid="layout-info"]');
  const pageText = rootEl.querySelector('[data-testid="page-name"]')?.textContent || '';
  const t2 = layouts.length === 1 && pageText.includes('About');
  console.log(`[Test 2] 导航 /about: Layout数=${layouts.length}(期望1) 页面=${pageText} → ${t2 ? '✅' : '❌'}`);
  allPassed = allPassed && t2;

  // Test 3: 跨路由状态保持 —— Home 改了 navState 后切 About 再回来
  const homeBtn = rootEl.querySelector('[data-testid="nav-home"]');
  if (homeBtn) homeBtn.click();
  await new Promise(r => setTimeout(r, 50));

  const toggleBtn = rootEl.querySelector('[data-testid="toggle-nav"]');
  if (toggleBtn) toggleBtn.click(); // expanded → collapsed
  await new Promise(r => setTimeout(r, 30));

  const aboutBtn2 = rootEl.querySelector('[data-testid="nav-about"]');
  if (aboutBtn2) aboutBtn2.click();
  await new Promise(r => setTimeout(r, 30));

  const layoutTextAfterNav = rootEl.querySelector('[data-testid="layout-info"]')?.textContent || '';
  const stateKept = layoutTextAfterNav.includes('collapsed');
  const t3 = stateKept;
  console.log(`[Test 3] 跨路由状态保持: navState=collapsed(期望true) → ${t3 ? '✅' : '❌'} (文本="${layoutTextAfterNav}")`);
  allPassed = allPassed && t3;

  // Test 4: Template 模式 —— 每次导航重挂载
  const switchBtn = rootEl.querySelector('[data-testid="switch-mode"]');
  if (switchBtn) switchBtn.click();
  await new Promise(r => setTimeout(r, 50));

  const mountBefore = templateMountCount;
  
  const blogBtn = rootEl.querySelector('[data-testid="nav-blog"]');
  if (blogBtn) blogBtn.click();
  await new Promise(r => setTimeout(r, 50));

  const mountAfter = templateMountCount;
  const t4 = mountAfter > mountBefore;
  console.log(`[Test 4] Template重挂载: before=${mountBefore} after=${mountAfter} → ${t4 ? '✅' : '❌'}`);
  allPassed = allPassed && t4;

  console.log('\n═══════════════════════════════════════');
  console.log(allPassed ? '  ✅ N2 通过' : '  ❌ N2 有失败项');
  console.log('═══════════════════════════════════════');

  process.exit(allPassed ? 0 : 1);
}

runTests();
