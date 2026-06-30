/**
 * Day 12 实验 L1：SuspenseList 三种模式对比
 *
 * 验证目标：
 * 1. 无 SuspenseList → 各自独立展示（先加载完的先显示）
 * 2. together 模式 → 所有内容同时展示
 * 3. forwards 模式 → 按 DOM 顺序逐个展示
 * 4. backwards 模式 → 倒序逐个展示
 *
 * 运行: node k1.mjs
 */

// ============ 模拟环境（不需要真实 DOM） ============
const log = (...args) => console.log(`[${new Date().toISOString().slice(11,19)}]`, ...args);

// ============ 模拟 Suspense 边界 ============

/**
 * 模拟一个数据组件
 * @param {string} name 组件名
 * @param {number} delay 加载延迟 ms
 */
function createDataComponent(name, delay) {
  let resolveTime = null;

  const promise = new Promise((resolve) => {
    setTimeout(() => {
      resolveTime = Date.now();
      log(`  [${name}] 数据加载完成 (耗时 ${delay}ms)`);
      resolve({ name, data: `data-from-${name}` });
    }, delay);
  });

  return {
    name,
    promise,
    delay,
    getResolveTime: () => resolveTime,
    getPromise: () => promise,
  };
}

/**
 * 模拟 SuspenseList 协调器
 * 核心逻辑来自 ReactFiberBeginWork.js updateSuspenseListComponent
 */
class MockSuspenseList {
  constructor(revealOrder) {
    this.revealOrder = revealOrder;
    this.children = [];
  }

  addChild(child) {
    this.children.push(child);
  }

  /**
   * 模拟所有子组件都 resolve 后的 reveal 决策
   * 返回每个子组件的 "可见时间" 数组
   */
  simulate(allResolvedAt) {
    // allResolvedAt: { ProfileCard: t1, UserList: t2, StatsChart: t3 }
    const results = {};

    if (this.revealOrder === 'together') {
      // 所有都就绪后才一起展示
      const maxTime = Math.max(...Object.values(allResolvedAt));
      this.children.forEach(c => {
        results[c.name] = { visibleAt: maxTime, mode: '等待最慢的那个' };
      });
    } else if (this.revealOrder === 'forwards') {
      // 按顺序，前面的必须就绪了后面才能展示
      let prevReadyAt = 0;
      for (let i = 0; i < this.children.length; i++) {
        const childName = this.children[i].name;
        const resolvedAt = allResolvedAt[childName];
        // 这个组件的展示时间 = max(它自己的resolve时间, 前一个组件的展示时间)
        const visibleAt = Math.max(resolvedAt, prevReadyAt);
        results[childName] = { visibleAt, mode: `前一个在 ${prevReadyAt}ms 就绪，我在 ${resolvedAt}ms 就绪，所以 ${visibleAt}ms 展示` };
        prevReadyAt = visibleAt; // 下一个必须等这个展示完
      }
    } else if (this.revealOrder === 'backwards') {
      // 从最后一个开始倒序
      const reversedChildren = [...this.children].reverse();
      let nextReadyAt = Infinity;
      for (let i = 0; i < reversedChildren.length; i++) {
        const childName = reversedChildren[i].name;
        const resolvedAt = allResolvedAt[childName];
        // 最后一个最先展示（只要自己就绪就行）
        // 倒数第二个要等倒数第一个...
        const visibleAt = (i === 0)
          ? resolvedAt
          : Math.min(resolvedAt, nextReadyAt);
        results[childName] = { visibleAt, mode: `倒序第${i+1}个，${visibleAt}ms 展示` };
        nextReadyAt = visibleAt;
      }
    }

    return results;
  }
}

// ============ 主实验 ============
async function runExperiment() {
  log('=== Day 12 L1: SuspenseList 三种模式 ===\n');

  // 创建 3 个数据组件，延迟不同
  const profile = createDataComponent('ProfileCard', 300);   // 中速
  const userList = createDataComponent('UserList', 500);     // 最慢
  const statsChart = createDataComponent('StatsChart', 100); // 最快

  log('创建 3 个数据组件:');
  log(`  - ProfileCard:  ${profile.delay}ms`);
  log(`  - UserList:    ${userList.delay}ms`);
  log(`  - StatsChart:  ${statsChart.delay}ms`);
  log('');

  // 等待全部 resolve
  await Promise.all([profile.promise, userList.promise, statsChart.promise]);

  const resolvedAt = {
    [profile.name]: profile.getResolveTime(),
    [userList.name]: userList.getResolveTime(),
    [statsChart.name]: statsChart.getResolveTime(),
  };

  const baseTime = Math.min(...Object.values(resolvedAt));
  log(`全部加载完成。以最早完成时间为基准(=0ms):\n`);

  // 归一化到相对时间
  const relative = {};
  for (const [k, v] of Object.entries(resolvedAt)) {
    relative[k] = v - baseTime;
  }

  // ============ 场景 A：无 SuspenseList（默认行为）============
  log('--- 场景 A：无 SuspenseList（各自独立） ---');
  log('谁先加载完谁先展示:\n');
  const sorted = Object.entries(relative).sort((a, b) => a[1] - b[1]);
  sorted.forEach(([name, time]) => {
    log(`  +${time}ms  ${name} 展示`);
  });
  log('');

  // ============ 场景 B：together ============
  log('--- 场景 B：revealOrder="together" ---');
  log('所有内容一起出现（等最慢的那个）:\n');
  const slTogether = new MockSuspenseList('together');
  slTogether.addChild(profile);
  slTogether.addChild(userList);
  slTogether.addChild(statsChart);

  const rTogether = slTogether.simulate(relative);
  Object.entries(rTogether).forEach(([name, info]) => {
    log(`  +${info.visibleAt}ms  ${name}  (${info.mode})`);
  });
  log('');

  // ============ 场景 C：forwards ============
  log('--- 场景 C：revealOrder="forwards" ---');
  log('按 DOM 顺序逐个展示:\n');
  const slForwards = new MockSuspenseList('forwards');
  slForwards.addChild(profile);    // 第1个
  slForwards.addChild(userList);    // 第2个
  slForwards.addChild(statsChart); // 第3个

  const rForwards = slForwards.simulate(relative);
  Object.entries(rForwards).forEach(([name, info]) => {
    log(`  +${info.visibleAt}ms  ${name}  (${info.mode})`);
  });
  log('');

  // ============ 场景 D：backwards ============
  log('--- 场景 D：revealOrder="backwards" ---');
  log('倒序展示（最后面的先露面）:\n');
  const slBackwards = new MockSuspenseList('backwards');
  slBackwards.addChild(profile);
  slBackwards.addChild(userList);
  slBackwards.addChild(statsChart);

  const rBackwards = slBackwards.simulate(relative);
  // 按展示时间排序输出
  const sortedBackwards = Object.entries(rBackwards).sort((a, b) => a[1].visibleAt - b[1].visibleAt);
  sortedBackwards.forEach(([name, info]) => {
    log(`  +${info.visibleAt}ms  ${name}  (${info.mode})`);
  });
  log('');

  // ============ 总结表格 ============
  log('=== 总结对比 ===\n');
  log('模式          | ProfileCard | UserList | StatsChart | 视觉效果');
  log('-------------|------------|---------|-----------|----------');
  log(`无 SuspenseList | +${relative.ProfileCard}ms       | +${relative.UserList}ms      | +${relative.StatsChart}ms       | 碎片式填充`);
  log(`together      | +${rTogether.ProfileCard.visibleAt}ms       | +${rTogether.UserList.visibleAt}ms      | +${rTogether.StatsChart.visibleAt}ms       | 整体闪现`);
  log(`forwards      | +${rForwards.ProfileCard.visibleAt}ms       | +${rForwards.UserList.visibleAt}ms      | +${rForwards.StatsChart.visibleAt}ms       | 依次上菜`);
  log(`backwards     | +${rBackwards.ProfileCard.visibleAt}ms       | +${rBackwards.UserList.visibleAt}ms      | +${rBackwards.StatsChart.visibleAt}ms       | 倒序露出\n`);

  log('=== 关键结论 ===');
  log('1. SuspenseList 不改变请求速度——3 个请求都是并发发出的');
  log('2. SuspenseList 只控制 "已就绪的内容什么时候展示给用户"');
  log('3. forwards 的核心规则："前面没展示完，后面的即使就绪也得等着"');
  log('4. backwards 的核心规则："从后往前，最后那个组件最先有机会露面"');
  log('');
  log('⭐ 面试话术：SuspenseList 是"窗帘控制器"，不是"加速器"。');
}

runExperiment().catch(console.error);
