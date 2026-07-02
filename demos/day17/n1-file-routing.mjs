/**
 * N1: 文件系统路由模拟
 * 
 * 模拟 Next.js App Router 的目录结构 → URL 路由映射
 * 包含：
 *   1. 静态路由匹配 (page.js → /)
 *   2. 动态路由 ([param])
 *   3. Catch-all 路由 ([...slug])
 *   4. 路由分组（(group）不影响 URL）
 */

import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><div id="root"></div>', { url: 'http://localhost' });
global.document = dom.window.document;
global.window = dom.window;

// ============================================================
// Part 1: 路由文件解析器 —— 模拟 App Router 的路由匹配算法
// ============================================================

/**
 * 将文件路径转换为路由段
 * "app/blog/[slug]/page.js" → ["blog", ":slug"]
 * "app/shop/[category]/[id]/page.js" → ["shop", ":category", ":id"]
 * "app/blog/[...slug]/page.js" → ["blog", "*slug"]  (* = catch-all)
 */
function parseSegments(filePath) {
  // 去掉 app/ 前缀和 page.js 后缀
  // 支持 "app/page.js", "./app/page.js", "/full/path/app/about/page.js" 等格式
  const appIndex = filePath.indexOf('app/');
  const afterApp = filePath.slice(appIndex + 4); // "app/" 之后的部分
  const relative = afterApp
    .replace(/\/?page\.(js|tsx|ts)$/, '')     // ? 让斜杠可选（根路由 app/page.js → page.js → ''）
    .replace(/\/?route\.(js|tsx|ts)$/, '');    // route.ts 也是叶子节点
  
  if (!relative || relative === 'page' || relative === 'route') {
    return ['']; // 根路由 /
  }
  
  return relative.split('/').map(seg => {
    if (seg.startsWith('[') && seg.endsWith(']')) {
      const inner = seg.slice(1, -1);
      if (inner.startsWith('...')) {
        return '*' + inner.slice(3); // Catch-all: *slug
      }
      return ':' + inner;            // Dynamic: :param
    }
    if (seg.startsWith('(') && seg.endsWith(')')) {
      return null; // Route group: 不影响 URL
    }
    return seg;                       // Static
  }).filter(Boolean);
}

/**
 * 匹配 URL 到路由文件
 * 返回: { matched: boolean, params: {}, file: string } 或 null
 */
function matchRoute(fileSegments, urlSegments) {
  const params = {};
  
  // 根路由特殊处理: [""] 匹配 []
  if (fileSegments.length === 1 && fileSegments[0] === '' && urlSegments.length === 0) {
    return { matched: true, params: {} };
  }

  // Catch-all: ["blog", "*slug"] 可以匹配 /blog/a, /blog/a/b, /blog/a/b/c...
  const catchAllIdx = fileSegments.findIndex(s => s && s.startsWith('*'));
  
  if (catchAllIdx !== -1) {
    const paramName = fileSegments[catchAllIdx].slice(1);
    
    // 前面的段必须精确匹配
    for (let i = 0; i < catchAllIdx; i++) {
      if (fileSegments[i] !== urlSegments[i]) return null;
    }
    
    // 后面的所有段都归给 catch-all 参数
    const remaining = urlSegments.slice(catchAllIdx);
    if (remaining.length === 0) return null; // 至少要有一段
    
    params[paramName] = remaining;
    return { matched: true, params };
  }
  
  // 普通匹配: 段数必须相等
  if (fileSegments.length !== urlSegments.length) return null;
  
  for (let i = 0; i < fileSegments.length; i++) {
    if (fileSegments[i].startsWith(':')) {
      params[fileSegments[i].slice(1)] = urlSegments[i];
    } else if (fileSegments[i] !== urlSegments[i]) {
      return null;
    }
  }
  
  return { matched: true, params };
}

// ============================================================
// Part 2: 定义虚拟的文件结构（模拟 app/ 目录）
// ============================================================

const fileSystem = [
  'app/page.js',                          // → /
  'app/about/page.js',                    // → /about
  'app/about/team/page.js',               // → /about/team
  'app/blog/page.js',                     // → /blog (列表)
  'app/blog/[slug]/page.js',              // → /blog/:slug (详情)
  'app/shop/page.js',                     // → /shop
  'app/shop/[category]/page.js',          // → /shop/:category
  'app/shop/[category]/[id]/page.js',     // → /shop/:category/:id
  'app/shop/[category]/[id]/reviews/page.js', // → /shop/:category/:id/reviews
  'app/docs/[...slug]/page.js',           // → /docs/* (catch-all)
  'app/api/users/route.js',               // → GET/POST /api/users
];

// ============================================================
// Part 3: 测试用例
// ============================================================

const testCases = [
  // [URL, 期望匹配到的文件, 期望 params]
  ['/', 'app/page.js', {}],
  ['/about', 'app/about/page.js', {}],
  ['/about/team', 'app/about/team/page.js', {}],
  ['/blog', 'app/blog/page.js', {}],
  ['/blog/hello-world', 'app/blog/[slug]/page.js', { slug: 'hello-world' }],
  ['/shop', 'app/shop/page.js', {}],
  ['/shop/electronics', 'app/shop/[category]/page.js', { category: 'electronics' }],
  ['/shop/electronics/42', 'app/shop/[category]/[id]/page.js', { category: 'electronics', id: '42' }],
  ['/shop/electronics/42/reviews', 'app/shop/[category]/[id]/reviews/page.js', { category: 'electronics', id: '42' }],
  ['/docs/getting-started', 'app/docs/[...slug]/page.js', { slug: ['getting-started'] }],
  ['/docs/guide/installation/step1', 'app/docs/[...slug]/page.js', { slug: ['guide', 'installation', 'step1'] }],
];

console.log('═══════════════════════════════════════');
console.log('  N1: 文件系统路由模拟');
console.log('═══════════════════════════════════════');
console.log();

// 解析所有文件的段信息
console.log('── 文件系统路由表 ──');
const parsedRoutes = fileSystem.map(f => ({
  file: f,
  segments: parseSegments(f),
}));

parsedRoutes.forEach(r => {
  console.log(`  ${r.file.padEnd(45)} → /${r.segments.join('/')}`);
});
console.log();

// 执行测试
let passed = 0;
let failed = 0;

for (const [url, expectedFile, expectedParams] of testCases) {
  const urlSegments = url === '' ? [] : url.split('/').filter(Boolean);
  let matchedResult = null;
  let matchedFile = null;

  for (const route of parsedRoutes) {
    const result = matchRoute(route.segments, urlSegments);
    if (result && result.matched) {
      matchedResult = result;
      matchedFile = route.file;
      break; // 第一个匹配的胜出（优先级：静态 > 动态 > catch-all，按定义顺序）
    }
  }


  const fileOk = matchedFile === expectedFile;
  const paramsOk = matchedResult 
    ? JSON.stringify(matchedResult.params) === JSON.stringify(expectedParams)
    : expectedParams === null || Object.keys(expectedParams).length === 0;

  if (fileOk && paramsOk) {
    console.log(`  ✅ ${url.padEnd(40)} → ${matchedFile} params=${JSON.stringify(matchedResult?.params || {})}`);
    passed++;
  } else {
    console.log(`  ❌ ${url.padEnd(40)} → 期望:${expectedFile} 实际:${matchedFile}`);
    console.log(`     期望params: ${JSON.stringify(expectedParams)} 实际params: ${JSON.stringify(matchedResult?.params)}`);
    failed++;
  }
}

console.log();
console.log('═══════════════════════════════════════');
if (failed === 0) {
  console.log(`  ✅ N1 通过 (${passed}/${passed + failed})`);
} else {
  console.log(`  ❌ N1 失败: ${passed} 通过, ${failed} 失败`);
}
console.log('═══════════════════════════════════════');

process.exit(failed > 0 ? 1 : 0);
