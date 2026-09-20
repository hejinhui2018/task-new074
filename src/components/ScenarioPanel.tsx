import { VaultActions } from '../state/useVault';

interface Scenario {
  icon: string;
  title: string;
  desc: string;
  run: (a: VaultActions) => void;
}

/**
 * 一键验收脚本。部分场景需要真实页面刷新（localStorage 已提前写好），
 * 刷新后的结果会在恢复横幅与事件日志中体现。
 */
const SCENARIOS: Scenario[] = [
  {
    icon: '🚀',
    title: '跨多版升级',
    desc: '重置为 v0（2019 老用户），一口气跑到 v5，观察 5 步流水线全部校验通过。',
    run: (a) => {
      a.resetTo(0);
      a.runAllSync(null);
    },
  },
  {
    icon: '🧨',
    title: '中途失败 + 隔离',
    desc: 'v0 起跑到 2->3 时注入损坏半成品：校验拦截、live 留在 v2、半成品进隔离区。',
    run: (a) => {
      a.resetTo(0);
      a.runAllSync({ stepId: '2->3', kind: 'corrupt' });
    },
  },
  {
    icon: '💥',
    title: 'transform 抛异常',
    desc: 'v0→v1 迁移函数直接抛错：没有产物可提交，live 保持 v0，现场信息隔离。',
    run: (a) => {
      a.resetTo(0);
      a.runAllSync({ stepId: '0->1', kind: 'throw' });
    },
  },
  {
    icon: '🔁',
    title: '重复运行幂等',
    desc: '先升到 v5，再点两次“自动迁移”：版本号闸门拦截，没有任何一步被重复应用。',
    run: (a) => {
      a.resetTo(0);
      a.runAllSync(null);
      a.runAllSync(null);
      a.runAllSync(null);
    },
  },
  {
    icon: '⚡',
    title: '迁移中途刷新',
    desc: '提交前两步后立刻整页刷新：恢复后报告中断，从第 3 步继续，前两步不重跑。',
    run: (a) => a.interruptAndReload(),
  },
  {
    icon: '🧺',
    title: '存储损坏恢复',
    desc: '直接把 localStorage 写成无法解析的内容再刷新：原文隔离，载入安全示例，不覆盖。',
    run: (a) => a.corruptStorageAndReload(),
  },
  {
    icon: '🔮',
    title: '降级读取（未来版本）',
    desc: '写入 v6 存档再刷新：当前代码读不了，live 原样保留并进入只读模式。',
    run: (a) => a.futureVersionAndReload(),
  },
  {
    icon: '⏪',
    title: '撤销 / 重做',
    desc: '升级到 v5 后连续撤销回 v2，再重做恢复；期间不会重新执行任何迁移。',
    run: (a) => {
      a.resetTo(0);
      a.runAllSync(null);
      a.undo();
      a.undo();
      a.undo();
    },
  },
];

export function ScenarioPanel({ actions, running }: { actions: VaultActions; running: boolean }) {
  return (
    <div className="card">
      <div className="card-head">
        <h2>一键验收场景</h2>
        <span className="hint">覆盖：跨多版 / 中途失败 / 降级读取 / 重复运行 / 中断 / 撤销</span>
      </div>
      <div className="card-body">
        <div className="scenario-grid">
          {SCENARIOS.map((s) => (
            <button
              key={s.title}
              className="scenario"
              disabled={running}
              onClick={() => s.run(actions)}
              title={running ? '运行中请先暂停或终止' : s.desc}
            >
              <div className="sc-title">
                <span>{s.icon}</span>
                {s.title}
              </div>
              <div className="sc-desc">{s.desc}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
