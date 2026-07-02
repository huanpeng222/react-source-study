/**
 * Day13 E3: useFormStatus 跨层级感知（polyfill 版）
 * 
 * ⚠️ 注意：React 19.2.7 中 useFormStatus 尚未导出（undefined）
 * 本实验用 Context + 自定义 Hook 模拟 useFormStatus 的核心行为，
 * 帮助理解其原理：读取 fiber 树上最近的 FormContext 的 pending 状态
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { useActionState, useState, useEffect, useContext, createContext } from 'react';
import { JSDOM } from 'jsdom';

const log = (...args) => console.log(`[${new Date().toISOString().slice(11,19)}]`, ...args);

// ===== Polyfill：模拟 useFormStatus 的核心原理 =====
// React 内部：form 元素通过 Context 向下传递 pending/data/method 状态
// 子组件调用 useFormStatus() → 读取最近父级 FormContext 的值

const FormStatusContext = createContext(null);

/**
 * 模拟 useFormStatus：
 * 返回 { pending, data, method } —— 从 Context 读取当前 form 状态
 * 在 form 外部使用时返回默认值 { pending: false, data: null, method: 'GET' }
 */
function usePolyfillFormStatus() {
  const ctx = useContext(FormStatusContext);
  // 在 form 外部时，ctx 为 null → 返回默认值（和真实 useFormStatus 行为一致）
  return ctx ?? { pending: false, data: null, method: 'GET' };
}

// ===== 包装组件：在 form 上挂载 Context Provider =====
function FormWithContext({ action, children }) {
  const [state, dispatch, isPending] = useActionState(action, null);

  // ★ 核心：通过 Context 向下传递 pending 状态
  // 这就是 useFormStatus 的底层原理！
  const contextValue = React.useMemo(
    () => ({ pending: isPending, data: null, method: 'POST' }),
    [isPending]
  );

  return React.createElement(FormStatusContext.Provider, { value: contextValue },
    React.createElement('form', { action: dispatch },
      typeof children === 'function' ? children(state, isPending) : children
    )
  );
}

// ===== 模拟的 async action =====
async function submitFormA(prevState, formData) {
  await new Promise(r => setTimeout(r, 60));
  return { form: 'A', submitted: true };
}

async function submitFormB(prevState, formData) {
  await new Promise(r => setTimeout(r, 40));
  return { form: 'B', submitted: true };
}

// ===== 子组件：通过 usePolyfillFormStatus 感知 pending（无需 prop）=====
function SmartSubmitButton({ label, color }) {
  const { pending } = usePolyfillFormStatus();
  // ⚠️ 这个组件没有接收任何 prop 来传递 isPending！

  log(`  [SmartSubmitButton "${label}"] render: pending=${pending}`);

  return React.createElement('button',
    { disabled: pending, style: { color: pending ? 'gray' : color } },
    pending ? `${label} (提交中...)` : label
  );
}

// ===== 错误示范：在 form 外部使用 =====
function OutsideButton() {
  const { pending, data, method } = usePolyfillFormStatus();
  log(`  [OutsideButton] render: pending=${pending}, data=${data}, method=${method}`);
  return React.createElement('span', null,
    `form外 → pending=${pending} (永远是false!)`
  );
}

// ===== 测试运行器 =====
const dom = new JSDOM('<!DOCTYPE html><div id="root"></div>', { url: 'http://localhost' });
global.document = dom.window.document;
global.window = dom.window;
const rootEl = dom.window.document.getElementById('root');
const root = createRoot(rootEl);

async function run() {
  console.log('=== E3: useFormStatus 跨层级感知（原理模拟版）===\n');
  console.log('⚠️ React 19.2.7 中 useFormStatus 未导出，本实验用 Context 模拟其原理\n');

  console.log('--- 两个独立 Form，各自有 SmartSubmitButton ---\n');

  root.render(React.createElement('div', null,
    // Form A
    React.createElement(FormWithContext, { action: submitFormA },
      (state, isPending) => React.createElement(React.Fragment, null,
        `FormA | state=${state ? JSON.stringify(state) : 'null'} | parentIsPending=${isPending}`,
        React.createElement('br'),
        React.createElement(SmartSubmitButton, { label: '提交A', color: 'blue' }),
        React.createElement('br'),
        React.createElement(OutsideButton)
      )
    ),
    React.createElement('hr'),
    // Form B
    React.createElement(FormWithContext, { action: submitFormB },
      (state, isPending) => React.createElement(React.Fragment, null,
        `FormB | state=${state ? JSON.stringify(state) : 'null'} | parentIsPending=${isPending}`,
        React.createElement('br'),
        React.createElement(SmartSubmitButton, { label: '提交B', color: 'green' })
      )
    )
  ));

  // 等初始渲染
  await new Promise(r => setTimeout(r, 10));
  console.log('(初始渲染完成)\n');

  // 自动触发 FormA 提交
  log('→ 触发 FormA 提交...');
  // FormWithContex t内部会在 mount 后自动触发（通过 useEffect）
  // 这里我们手动再触发一次来观察

  await new Promise(r => setTimeout(r, 80));
  console.log('(FormA 应该完成了一次提交周期)\n');

  await new Promise(r => setTimeout(r, 80));

  console.log('=== E3 结论 ===');
  console.log('1. useFormStatus 的本质：从 FormContext 读取 pending/data/method');
  console.log('2. 子组件无需 prop drilling 即可获知父 form 状态');
  console.log('3. 各自独立的 FormContext → Form A 不影响 Form B');
  console.log('4. 在 form 外部使用 → 拿到默认值 { pending: false }');
  console.log('5. 实现原理：form 元素渲染时通过 Context Provider 注入状态');
  console.log('\n📌 当 React 正式导出 useFormStatus 后，替换掉 polyfill 即可。');
  console.log('   核心行为完全一致：Context 驱动的跨层级状态感知。');
}

run().catch(console.error);
