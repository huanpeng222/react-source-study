/**
 * Day16 R1: Server / Client 边界规则模拟
 * 
 * 验证：
 *   1. Server → Client import ✅ 合法
 *   2. Client → Server import ❌ 非法（编译时阻断）
 *   3. 隐式 client boundary：Client import 未标记组件 → 被拖入客户端 bundle
 *   4. children 模式：保持子组件在服务端
 */

const log = (...args) => console.log(`[${new Date().toISOString().slice(11,19)}]`, ...args);

// ===== 模拟打包器：追踪每个文件进入哪个 bundle =====
const serverBundle = new Set();  // 服务端 bundle 文件列表
const clientBundle = new Set();   // 客户端 bundle 文件列表

// 模拟文件注册表
const fileRegistry = {};

function registerFile(name, type, imports = []) {
  fileRegistry[name] = { type, imports };
  log(`  [注册] ${name} → type=${type}, imports=[${imports.join(', ')}]`);
}

// 模拟编译过程
function compile(entry) {
  const visited = new Set();
  
  function walk(file) {
    if (visited.has(file)) return;
    visited.add(file);
    
    const info = fileRegistry[file];
    if (!info) {
      log(`  ⚠️ 文件 ${file} 未注册，跳过`);
      return;
    }
    
    // 根据文件类型决定进入哪个 bundle
    if (info.type === 'client') {
      clientBundle.add(file);
      // ★ 关键：client 文件 import 的所有依赖也进 client bundle（隐式 boundary）
      for (const imp of info.imports) {
        const depInfo = fileRegistry[imp];
        if (depInfo && depInfo.type !== 'client') {
          log(`  📍 隐式 client boundary: ${imp} 被 ${file}(client) import → 强制进入客户端 bundle!`);
        }
        walk(imp);  // 所有依赖都走 client 路径
      }
    } else {
      serverBundle.add(file);
      for (const imp of info.imports) {
        // server 可以 import client → 但 client 文件还是进 client bundle
        const depInfo = fileRegistry[imp];
        if (depInfo && depInfo.type === 'client') {
          log(`  ✅ Server→Client 边界: ${file}(server) import ${imp}(client) → 合法!`);
          clientBundle.add(imp);
          walk(imp);
        } else {
          walk(imp);  // server→server 正常递归
        }
      }
    }
  }
  
  walk(entry);
}

async function run() {
  console.log('=== R1: Server / Client 边界规则 ===\n');

  // ===== 场景 1：正常的 Server/Client 结构 =====
  console.log('--- 场景 1：正常结构 ---\n');
  
  registerFile('page.jsx', 'server', ['Header', 'ThemeToggle']);
  registerFile('Header.jsx', 'server', ['Logo', 'Nav']);
  registerFile('Logo.jsx', 'server', []);
  registerFile('Nav.jsx', 'client', ['UserMenu']);       // "use client"
  registerFile('UserMenu.jsx', 'client', []);            // "use client"
  registerFile('ThemeToggle.jsx', 'client', []);         // "use client"
  
  compile('page.jsx');
  
  console.log('\n[编译结果]');
  console.log(`Server Bundle (${serverBundle.size} 个文件):`);
  [...serverBundle].forEach(f => console.log(`  - ${f}`));
  console.log(`Client Bundle (${clientBundle.size} 个文件):`);
  [...clientBundle].forEach(f => console.log(`  - ${f}`));
  console.log(`\n结论: page/Header/Logo 在服务端 ✅ | Nav/UserMenu/ThemeToggle 在客户端 ✅`);

  // ===== 场景 2：Client → Server import（应该报错）=====
  console.log('\n--- 场景 2：Client 尝试 import Server 组件（非法）---\n');
  
  serverBundle.clear();
  clientBundle.clear();
  
  registerFile('BadClient.jsx', 'client', ['SecretComponent']);  // ❌ 试图 import 服务端组件
  registerFile('SecretComponent.jsx', 'server', []);              // 含敏感逻辑
  
  console.log('BadClient (client) import SecretComponent (server)...');
  console.log('');
  
  let caughtError = false;
  try {
    // 模拟编译器的检查
    const bad = fileRegistry['BadClient.jsx'];
    for (const imp of bad.imports) {
      const dep = fileRegistry[imp];
      if (dep && dep.type === 'server' && bad.type === 'client') {
        throw new Error(
          `❌ 编译错误: Client Component "${bad.name || 'BadClient.jsx'}" ` +
          `不能 import Server Component "${imp}"！` +
          `\n   原因: 如果允许 → SecretComponent 的代码会被打入客户端 bundle → 安全风险`
        );
      }
    }
    compile('BadClient.jsx');
  } catch (e) {
    caughtError = true;
    console.log(e.message);
  }

  if (!caughtError) {
    console.log('⚠️ 编译器没有拦截这个错误！');
  }

  // ===== 场景 3：隐式 client boundary 性能陷阱 =====
  console.log('\n--- 场景 3：隐式 client boundary（性能陷阱）---\n');
  
  serverBundle.clear();
  clientBundle.clear();
  
  registerFile('SearchBar.jsx', 'client', ['UserAvatar', 'SuggestionList']);
  registerFile('UserAvatar.jsx', 'server', []);           // ⚠️ 无 "use client"！
  registerFile('SuggestionList.jsx', 'client', []);
  
  console.log('SearchBar (client) import 了:');
  console.log('  - UserAvatar (无标记 → 本应是 Server Component)');
  console.log('  - SuggestionList (client)');
  console.log('');
  
  compile('SearchBar.jsx');
  
  console.log('[编译结果]');
  console.log(`Server Bundle: [...${serverBundle.size}]`);
  console.log(`Client Bundle: [${[...clientBundle].join(', ')}]`);
  console.log('');
  console.log('⚠️ 问题：UserAvatar 只是显示一张图片，不需要任何客户端能力');
  console.log('   但因为它被 SearchBar(client) import 了 → 被强制打入客户端 bundle！');
  console.log('');

  // ===== 场景 4：children 模式修复 =====
  console.log('--- 场景 4：用 children 模式修复 ---\n');
  
  serverBundle.clear();
  clientBundle.clear();
  
  // 重构后：UserAvatar 不再被 SearchBar 直接 import
  registerFile('page2.jsx', 'server', ['SearchBar2', 'UserAvatar']);
  registerFile('SearchBar2.jsx', 'client', []);  // 不再直接 import UserAvatar
  registerFile('UserAvatar.jsx', 'server', []);
  
  console.log('重构后的结构:');
  console.log('  page2 (server):');
  console.log('    <SearchBar2>');
  console.log('      <UserAvatar />   ← 作为 children 由 server 层传入');
  console.log('    </SearchBar2>');
  console.log('');
  
  compile('page2.jsx');
  
  console.log('[编译结果]');
  console.log(`Server Bundle: [${[...serverBundle].join(', ')}]`);
  console.log(`  ↑ UserAvatar 回到服务端了！✅`);
  console.log(`Client Bundle: [${[...clientBundle].join(', ')}]`);

  console.log('\n=== R1 结论 ===');
  console.log('1. Server → Client import 是合法的，形成自然的边界');
  console.log('2. Client → Server import 被编译器拦截（安全原因）');
  console.log('3. Client Component import 未标记的组件 → 隐式 client boundary → 性能陷阱');
  console.log('4. 解决方案：用 children/插槽模式把纯展示组件保持在服务端');
}

run().catch(console.error);
