# Day 13 实验：React 19 Actions 体系

> 代码贴进 Vite + React playground（浏览器里跑）。
> 这个主题本身就是"表单交互"，之前 jsdom 版本反而绕开了真实的 `<form>` 直接手动 dispatch——这次改成真正的表单点击提交。

## 环境准备（如果还没有 playground）

```bash
cd demos/day13
npm create vite@latest playground -- --template react
cd playground
npm install
npm run dev
```

---

## 实验 E1：`<form action={fn}>` + useActionState

```jsx
import { useActionState } from 'react';

let callCount = 0;

async function submitUser(prevState, formData) {
  const name = formData.get('name');
  callCount++;
  console.log(`action 被调用 (#${callCount}), name="${name}", prevState=`, prevState);

  if (name === 'error') {
    throw new Error('用户名已存在');
  }

  await new Promise(r => setTimeout(r, 800));  // 模拟网络延迟
  return { name, ok: true, callId: callCount };
}

export default function App() {
  const [state, dispatchFn, isPending] = useActionState(submitUser, null);

  return (
    <div style={{ padding: 20 }}>
      <h2>useActionState + form action</h2>

      {/* 不需要 onSubmit + preventDefault，也不需要手动收集 name 值 */}
      <form action={dispatchFn}>
        <input name="name" placeholder="输入名字（输入 error 触发失败）" />
        <button type="submit" disabled={isPending}>
          {isPending ? '提交中...' : '提交'}
        </button>
      </form>

      <p>
        state:{' '}
        {state === null
          ? 'null'
          : state instanceof Error
            ? `❌ Error: ${state.message}`
            : `✅ ${JSON.stringify(state)}`}
      </p>
      <p>isPending: {String(isPending)}</p>
    </div>
  );
}
```

**操作步骤**：

1. 打开 Console，输入一个名字（比如"张三"），点提交。
2. 观察按钮是否变成"提交中..."并保持 disabled，800ms 后 state 是否显示成功结果。
3. 再输入 `error`，点提交，观察 state 是否变成 Error 提示。
4. 连续提交几次不同名字，观察 `prevState` 参数打印的是不是"上一次的返回值"。

**记录到 observations.md**：`isPending` 是否真的在 800ms 期间保持 true？错误场景下页面显示是什么？

---

## 实验 E2：useOptimistic 点赞（含失败自动回滚）

```jsx
import { useOptimistic, useState, startTransition } from 'react';

export default function App() {
  const [liked, setLiked] = useState(false);
  const [optLiked, setOptLiked] = useOptimistic(liked, (cur, next) => next);
  const [scenario, setScenario] = useState('success'); // success | fail

  function handleToggle() {
    startTransition(async () => {
      setOptLiked(!optLiked);   // ① 立刻乐观更新
      console.log('乐观更新 → optLiked 立刻变成', !optLiked);

      await new Promise(r => setTimeout(r, 600));

      if (scenario === 'success') {
        setLiked(!liked);   // ② 请求成功 → 真实值更新，optLiked 跟随
        console.log('请求成功 → liked 更新为', !liked);
      } else {
        console.log('请求失败！不做任何 setLiked → optLiked 应自动回滚');
        // ③ 什么都不做，liked 没变 → optLiked 下次渲染会基于 liked 重算，自动回滚
      }
    });
  }

  return (
    <div style={{ padding: 20 }}>
      <h2>useOptimistic 点赞</h2>
      <div style={{ marginBottom: 12 }}>
        <label>
          <input
            type="radio"
            checked={scenario === 'success'}
            onChange={() => setScenario('success')}
          /> 模拟成功
        </label>
        <label style={{ marginLeft: 12 }}>
          <input
            type="radio"
            checked={scenario === 'fail'}
            onChange={() => setScenario('fail')}
          /> 模拟失败
        </label>
      </div>
      <button onClick={handleToggle}>
        {optLiked ? '❤️ 已点赞' : '🤍 点赞'}
      </button>
      <p>真实值 liked = {String(liked)} | 乐观值 optLiked = {String(optLiked)}</p>
    </div>
  );
}
```

**操作步骤**：

1. 选中"模拟成功"，点击点赞按钮，观察：按钮是否**立刻**变成 ❤️（不等 600ms），600ms 后 `liked` 是否也变成 true。
2. 选中"模拟失败"，点击点赞按钮，观察：按钮是否立刻变 ❤️，600ms 后**是否自动跳回** 🤍（没有写任何"回滚"代码）。

**记录到 observations.md**：失败场景下，optLiked 是否真的自动回滚了？回滚发生在多久之后？

---

## 实验 E3：useFormStatus 跨层级感知

```jsx
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

function SubmitButton({ children }) {
  const { pending } = useFormStatus();   // 不需要任何 props！
  return (
    <button type="submit" disabled={pending}>
      {pending ? '提交中...' : children}
    </button>
  );
}

async function actionA(prevState, formData) {
  await new Promise(r => setTimeout(r, 1000));
  return { done: true };
}

async function actionB(prevState, formData) {
  await new Promise(r => setTimeout(r, 1000));
  return { done: true };
}

function FormA() {
  const [, dispatchA] = useActionState(actionA, null);
  return (
    <form action={dispatchA}>
      <p>Form A</p>
      <SubmitButton>提交A</SubmitButton>
    </form>
  );
}

function FormB() {
  const [, dispatchB] = useActionState(actionB, null);
  return (
    <form action={dispatchB}>
      <p>Form B</p>
      <SubmitButton>提交B</SubmitButton>
    </form>
  );
}

export default function App() {
  return (
    <div style={{ padding: 20 }}>
      <h2>useFormStatus 跨层级感知</h2>
      <FormA />
      <hr />
      <FormB />
    </div>
  );
}
```

**操作步骤**：点击"提交A"，观察：`SubmitButtonA` 是否变成"提交中..."，同时 `SubmitButtonB` 是否**完全不受影响**（各自独立）。

**记录到 observations.md**：两个表单的 pending 状态是否真的互不影响？`SubmitButton` 组件本身有没有接收任何跟 pending 相关的 props？

---

## 一句话收束

| 实验 | 要观察的现象 | 对应机制 |
|---|---|---|
| E1 | 提交中按钮 disabled，错误时 state 变 Error | `<form action={fn}>` 自动处理 FormData + preventDefault + pending/error |
| E2 | 点击立刻变色，失败后自动跳回 | useOptimistic 基于真实值重算，不需要手写回滚逻辑 |
| E3 | 两个表单的 pending 互不干扰 | useFormStatus 通过 FormContext 感知最近的父 `<form>` |

---

## 完成后

```bash
git add demos/day13 notes/day13.md
git commit -m "W3 D13 Actions体系：完成浏览器实验(真实form提交/乐观回滚/跨层级pending感知)"
git push
```
