/**
 * Day16 R3: RSC vs SSR 流程对比模拟
 * 
 * 验证：
 *   1. SSR: 全量渲染 → HTML → hydrate（对比 DOM 差异）
 *   2. RSC: 组件级渲染 → Payload → 直接渲染（无 hydrate）
 *   3. JS bundle 大小差异
 *   4. 缓存粒度差异
 */

const log = (...args) => console.log(`[${new Date().toISOString().slice(11,19)}]`, ...args);

// ===== 模拟组件 =====

// 组件注册：name, type(server/client), renderCost(ms), jsSize(bytes)
const components = {
  // Server Components
  'Page':       { type: 'server', cost: 5,  size: 0 },
  'Header':     { type: 'server', cost: 10, size: 0 },
  'Logo':       { type: 'server', cost: 3,  size: 0 },
  'NoteList':   { type: 'server', cost: 80, size: 0 },  // 最慢！查数据库
  'Footer':     { type: 'server', cost: 8,  size: 0 },
  
  // Client Components  
  'Nav':        { type: 'client', cost: 2,  size: 3000 },
  'ThemeToggle': { type: 'client', cost: 1,  size: 800 },
  'LikeButton': { type: 'client', cost: 1,  size: 500 },
};

const tree = {
  name: 'Page',
  children: [
    {
      name: 'Header',
      children: [
        { name: 'Logo' },
        { name: 'Nav' },        // Client
      ]
    },
    {
      name: 'NoteList',
      children: [
        { name: 'NoteItem1' },  // 纯展示，server
        { name: 'NoteItem2' },
        { name: 'LikeButton' }  // Client
      ]
    },
    { name: 'Footer' }
  ]
};

async function simulateSSR() {
  log('=== SSR 流程 ===\n');
  
  const timeline = [];
  let totalJS = 0;
  
  // Step 1: 服务端渲染整棵树（同步/串行或并行但等最慢的）
  log('Step 1: 服务端执行 renderToString(<App />)');
  log('  所有组件在服务端执行...');
  
  const startRender = Date.now();
  let maxCost = 0;
  
  async function renderSSR(node) {
    const comp = components[node.name];
    if (!comp) return;  // 虚拟节点
    
    await new Promise(r => setTimeout(r, comp.cost));  // 模拟渲染耗时
    
    if (comp.type === 'client') totalJS += comp.size;
    if (comp.cost > maxCost) maxCost = comp.cost;
    
    timeline.push({ time: Date.now() - startRender, event: `渲染 ${node.name} (${comp.type})` });
    
    if (node.children) {
      for (const child of node.children) {
        await renderSSR(child);
      }
    }
  }
  
  await renderSSR(tree);
  
  const renderTime = Date.now() - startRender;
  log(`\n  渲染完成！耗时: ${renderTime}ms (受最慢组件 NoteList 制约)`);
  
  // Step 2: 输出 HTML
  log(`\nStep 2: 输出 HTML 字符串`);
  log(`  "<!DOCTYPE html><html>...<div id='root'>...</div></html>"`);
  log(`  (HTML 长度: ~${renderTime * 20} bytes)`);
  
  // Step 3: 发送到浏览器
  log(`\nStep 3: 浏览器接收 HTML + 下载 JS bundle`);
  log(`  JS bundle 大小: ${(totalJS / 1024).toFixed(1)} KB (所有 Client Component 都要下载)`);
  
  // Step 4: Hydrate
  const hydrateCost = Math.max(30, totalJS / 100);
  log(`\nStep 4: Hydrate (~${hydrateCost}ms)`);
  log(`  React 对比 DOM 和虚拟 DOM 的差异`);
  log(`  绑定事件处理器`);
  log(`  ⚠️ 如果服务端和客户端渲染结果不一致 → hydration mismatch 报错!`);
  
  return { 
    totalTime: renderTime + hydrateCost,
    jsSize: totalJS,
    stages: ['服务端渲染', 'HTML传输', 'JS下载', 'Hydrate']
  };
}

async function simulateRSC() {
  log('=== RSC 流程 ===\n');
  
  const timeline = [];
  let clientJS = 0;
  let serverComponentsRendered = 0;
  let clientRefs = [];
  
  const startRender = Date.now();
  
  // Step 1: Server Components 各自独立渲染，流式输出
  log('Step 1: Server Components 在服务端各自渲染');
  
  async function renderRSC(node, depth = 0) {
    const comp = components[node.name];
    if (!comp) return;
    
    if (comp.type === 'server') {
      await new Promise(r => setTimeout(r, comp.cost));
      serverComponentsRendered++;
      
      const t = Date.now() - startRender;
      log(`  [${t}ms] ✅ ${node.name} (Server) 渲染完毕 → 进入 Payload`);
      
      // Server Component 不进客户端 JS
    } else {
      // Client Component → 只记录引用，不渲染
      clientJS += comp.size;
      clientRefs.push(node.name);
      const t = Date.now() - startRender;
      log(`  [${t}ms] 📍 ${node.name} (Client) → 写入 @ 引用，待客户端加载`);
    }
    
    if (node.children) {
      for (const child of node.children) {
        await renderRSC(child, depth + 1);
      }
    }
  }
  
  await renderRSC(tree);
  
  log(`\n  Server Components 渲染完成: ${serverComponentsRendered} 个`);
  log(`  Client Components 引用: ${clientRefs.join(', ')}`);
  
  // Step 2: 输出 RSC Payload
  const payloadTime = Date.now() - startRender;
  log(`\nStep 2: 输出 RSC Payload (流式)`);
  log(`  Payload 包含已渲染的 Server Component 树 + Client Component 引用`);
  log(`  (Payload 大小比 HTML 小，因为不包含 Client Component 内部结构)`);
  
  // Step 3: 客户端接收并渲染
  log(`\nStep 3: 客户端处理 Payload`);
  log(`  ① 解析 $ 元素 → 直接创建 DOM`);
  log(`  ② 遇到 @ 引用 → 动态 import Client Component JS`);
  log(`  ③ 只需下载 Client Component: ${(clientJS / 1024).toFixed(1)} KB`);
  log(`     (对比 SSR 的 ${(Object.values(components)
    .filter(c => c.type === 'client')
    .reduce((s,c)=>s+c.size,0) / 1024).toFixed(1)} KB — 嗯，这个例子一样大)`);
  log(`  但注意：Server Component 的代码完全不需要下载！`);
  
  // Step 4: ★ 无需 Hydrate！
  log(`\nStep 4: ★ 无 Hydrate ★`);
  log(`  Payload → 直接渲染成可交互页面`);
  log(`  没有 DOM 对比过程`);
  log(`  没有 hydration mismatch 可能性`);
  
  return {
    totalTime: payloadTime,
    jsSize: clientJS,
    serverOnly: true,
    stages: ['Server Components 渲染', 'Payload 流式传输', 'Client Components 加载']
  };
}

async function run() {
  console.log('=== R3: RSC vs SSR 流程完整对比 ===\n');

  console.log('组件树:');
  console.log('  Page');
  console.log('  ├── Header (Server)');
  console.log('  │   ├── Logo (Server)');
  console.log('  │   └── Nav (Client)');
  console.log('  ├── NoteList (Server) ← 最慢！80ms');
  console.log('  │   ├── NoteItem1 (Server)');
  console.log('  │   ├── NoteItem2 (Server)');
  console.log('  │   └── LikeButton (Client)');
  console.log('  └── Footer (Server)');
  console.log('');

  // 运行 SSR 模拟
  console.log('═════════════════════════════════');
  const ssrResult = await simulateSSR();
  console.log('═════════════════════════════════');
  console.log('');

  // 运行 RSC 模拟
  console.log('\n\n═════════════════════════════════');
  const rscResult = await simulateRSC();
  console.log('═════════════════════════════════');
  console.log('');

  // ===== 最终对比 =====
  console.log('\n══════════════════════════════════════════');
  console.log('                  最终对比');
  console.log('══════════════════════════════════════════');
  console.log('');
  console.log('  维度              SSR              RSC');
  console.log('  ────────────────────────────────────────');
  console.log(`  总耗时            ~${ssrResult.totalTime}ms           ~${rscResult.totalTime}ms (首屏更快)`);
  console.log(`  客户端JS          ~${(ssrResult.jsSize/1024).toFixed(1)}KB          仅 Client Comp JS`);
  console.log(`  Hydrate           需要(~${Math.max(30,ssrResult.jsSize/100)}ms)     ❌ 不需要`);
  console.log(`  缓存粒度          页面级别           组件级别`);
  console.log(`  数据获取时机      render时一次性    组件级按需`);
  console.log(`  安全风险          无                 Server代码不到前端✅`);
  console.log('');
  console.log('  适用场景:');
  console.log('    SEO 需求强      ✅ SSR 更合适');
  console.log('    复杂交互多      ✅ RSC 更合适');
  console.log('    数据查询重      ✅ RSC 更合适');
  console.log('    团队熟悉度      SSR 更通用         Next.js App Router 用 RSC');

  console.log('\n=== R3 结论 ===');
  console.log('1. SSR 出 HTML + Hydrate，RSC 出 Payload + 直接渲染');
  console.log('2. RSC 少了 Hydrate 这一步 → 更快、更不容易出错');
  console.log('3. RSC 可以做组件级缓存（单个 Server Component 可被 CDN 缓存）');
  console.log('4. RSC 的核心价值不是替代 SSR，而是让"服务端执行"这件事粒度更细');
}

run().catch(console.error);
