/**
 * Day16 R2: 序列化边界 + RSC Payload 格式模拟
 * 
 * 验证：
 *   1. 哪些类型可以跨 Server/Client 边界传递
 *   2. 函数在序列化时丢失（除非 use server 包装）
 *   3. RSC Payload 的 $ / @ 结构
 *   4. 客户端如何解析 Payload
 */

const log = (...args) => console.log(`[${new Date().toISOString().slice(11,19)}]`, ...args);

// ===== 模拟 RSC Payload 编码器 =====

// $ = 普通元素（已渲染的 Server Component 或 HTML 元素）
function Element(tag, props, ...children) {
  return ['$', tag, props ?? null, children.length === 1 ? children[0] : children];
}

// @ = Client Component 引用
function ClientRef(modulePath, props) {
  return ['@', modulePath, props ?? null];
}

// 模拟序列化检查
function checkSerializable(value, path = 'prop') {
  if (value === null || value === undefined) {
    return { ok: true, type: 'null/undefined' };
  }
  
  const t = typeof value;
  
  if (t === 'string' || t === 'number' || t === 'boolean') {
    return { ok: true, type: t };
  }
  
  if (t === 'function') {
    // 特殊：use server 标记的函数有特殊处理路径
    if (value.__isServerAction) {
      return { ok: true, type: 'ServerAction(可远程调用)' };
    }
    return { 
      ok: false, 
      type: 'Function', 
      reason: `函数不能直接跨边界传递！需要用 "use server" 包装成 Server Action` 
    };
  }
  
  if (Array.isArray(value)) {
    const results = value.map((v, i) => checkSerializable(v, `${path}[${i}]`));
    const failed = results.find(r => !r.ok);
    return failed ? failed : { ok: true, type: `Array[${value.length}]` };
  }
  
  if (t === 'object') {
    // Date / RegExp 等内置对象有限支持
    if (value instanceof Date) return { ok: true, type: 'Date' };
    if (value instanceof RegExp) return { ok: true, type: 'RegExp' };
    
    // 普通对象：递归检查每个值
    const results = Object.entries(value).map(
      ([k, v]) => checkSerializable(v, `${path}.${k}`)
    );
    const failed = results.find(r => !r.ok);
    return failed ? failed : { ok: true, type: 'Object' };
  }
  
  return { ok: false, type: t, reason: `未知类型 "${t}" 不支持序列化` };
}

async function run() {
  console.log('=== R2: 序列化边界 + RSC Payload 格式 ===\n');

  // ===== 实验 1：可序列化 vs 不可序列化的类型 =====
  console.log('--- 实验 1：哪些类型能跨 Server/Client 边界？---\n');

  const testCases = [
    { name: 'string', value: 'hello' },
    { name: 'number', value: 42 },
    { name: 'boolean', value: true },
    { name: 'null', value: null },
    { name: 'undefined', value: undefined },
    { name: '普通对象', value: { id: 1, title: 'test' } },
    { name: '数组', value: [1, 'two', true] },
    { name: 'Date', value: new Date('2026-01-01') },
    { name: '普通函数', value: () => 'hello' },
    { name: 'Server Action', value: { __isServerAction: true, id: 'action_123' } },
    { name: '类实例', value: new Map([['a', 1]]) },
  ];

  for (const tc of testCases) {
    const result = checkSerializable(tc.value);
    console.log(
      `${result.ok ? '✅' : '❌'} ${tc.name.padEnd(12)} → ${result.type}` +
      (result.reason ? `\n   ${result.reason}` : '')
    );
  }

  // ===== 实验 2：RSC Payload 构建与解析 =====
  console.log('\n--- 实验 2：RSC Payload 结构演示 ---\n');

  // 模拟一个 Server Component 渲染过程
  function buildPayload() {
    // 这是一个 Server Component 的渲染结果
    // 它混合了：
    //   - 普通元素 ($)
    //   - 已展开的 Server Component 子树 ($)
    //   - Client Component 引用 (@)
    
    return Element('div', null,
      Element('header', null,
        Element('h1', null, '我的笔记'),
        // ThemeToggle 是 Client Component → 用 @ 引用
        ClientRef('./ThemeToggle', { theme: 'dark' })
      ),
      Element('main', null,
        // NoteList 是 Server Component，已经在服务端渲染完毕
        Element('ul', null,
          Element('li', null, '学习 React'),
          Element('li', null, '学习 RSC'),
          Element('li', null, '面试准备')
        )
      ),
      // Footer 也是 Client Component
      ClientRef('./Footer', { year: 2026 })
    );
  }

  const payload = buildPayload();

  console.log('[RSC Payload 输出]');
  console.log(JSON.stringify(payload, null, 2));
  console.log('');

  // ===== 实验 3：客户端解析 Payload =====
  console.log('--- 实验 3：客户端如何解析 RSC Payload ---\n');
  
  let clientBundleDownloads = [];
  let domElements = [];

  function renderNode(node) {
    if (!Array.isArray(node)) return;

    const [marker, ...rest] = node;

    if (marker === '$') {
      const [tag, props, children] = rest;
      domElements.push(`<${tag}>`);
      
      if (Array.isArray(children)) {
        if (children[0] && Array.isArray(children[0])) {
          // children 是数组，递归
          for (const child of children) renderNode(child);
        } else if (typeof children === 'string') {
          domElements.push(children);
        }
      } else if (typeof children === 'string') {
        domElements.push(children);
      }
      
      domElements.push(`</${tag}>`);
    } else if (marker === '@') {
      const [modulePath, props] = rest;
      clientBundleDownloads.push(modulePath);
      domElements.push(`[加载 ${modulePath} 并用 props=${JSON.stringify(props)} 渲染]`);
    }
  }

  renderNode(payload);

  console.log('[客户端处理流程]');
  console.log('');
  console.log('1. 需要下载的 Client Components:');
  clientBundleDownloads.forEach(m => console.log(`   - 动态 import("${m}")`));
  console.log('');
  console.log('2. 渲染出的 DOM 结构:');
  domElements.forEach(el => console.log(`   ${el}`));

  // ===== 实验 4：流式传输模拟 =====
  console.log('\n--- 实验 4：流式传输（逐步接收 Payload）---\n');

  async function simulateStreaming() {
    // 服务端分块发送 payload（模拟 Suspense 边界）
    const chunks = [
      // Chunk 1: 页面框架（立即到达）
      ['$','div',null,
        ['$','h1',null,'我的笔记'],
      ],
      // Chunk 2: 快速组件（50ms 后到达）
      ['@','./ThemeToggle',{'theme':'dark'}],
      // Chunk 3: 数据列表（200ms 后，可能更慢）
      ['$','ul',null,
        ['$','li',null,'学习 React'],
        ['$','li',null,'学习 RSC'],
        ['$','li',null,'面试准备'],
      ],
      // Chunk 4: 底部（300ms 后）
      ['@','./Footer',{'year':2026}],
    ];

    log('📡 开始接收流式 Payload...');
    
    for (let i = 0; i < chunks.length; i++) {
      await new Promise(r => setTimeout(r, 10));  // 模拟网络延迟
      const chunk = JSON.stringify(chunks[i]);
      log(`Chunk #${i+1} 到达 (${chunk.length} bytes): ${chunk.slice(0,60)}...`);
    }
    
    log('\n✅ 全部接收完成！用户看到页面是渐进式出现的：');
    log('  T+0ms   → 看到 <h1>我的笔记</h1>');
    log('  T+10ms  → 主题切换按钮出现');
    log('  T+20ms  → 列表内容出现');
    log('  T+30ms  → Footer 出现');
    log('\n对比 SSR：必须等最慢的那个组件完成才能输出任何 HTML！');
  }

  await simulateStreaming();

  console.log('\n=== R2 结论 ===');
  console.log('1. 可序列化：基本类型、Date、纯对象/数组 ✅');
  console.log('2. 不可序列化：函数（需 use server）、类实例 ❌');
  console.log('3. RSC Payload 中：$ = 已渲染元素，@ = 客户端组件引用');
  console.log('4. 客户端收到 payload 后：$ 直接创建 DOM，@ 触发动态 import');
  console.log('5. 流式传输让最快的内容先显示，不用等整棵树');
}

run().catch(console.error);
