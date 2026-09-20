import { ReactNode } from 'react';
import { StepStatus } from '../engine/types';

export function Badge({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

const STATUS_META: Record<StepStatus, { tone: string; text: string }> = {
  pending: { tone: 'pending', text: '待执行' },
  applied: { tone: 'applied', text: '✓ 已应用' },
  skipped: { tone: 'skipped', text: '↷ 跳过（已应用过）' },
  failed: { tone: 'failed', text: '✕ 校验失败' },
  faulted: { tone: 'faulted', text: '✕ transform 异常' },
};

export function StepStatusBadge({ status }: { status: StepStatus }) {
  const m = STATUS_META[status];
  return <Badge tone={m.tone}>{m.text}</Badge>;
}

export function JsonView({ value, maxHeight }: { value: unknown; maxHeight?: number }) {
  return (
    <pre className="json" style={maxHeight ? { maxHeight } : undefined}>
      {stringify(value)}
    </pre>
  );
}

export function stringify(value: unknown): string {
  return JSON.stringify(value, replacer, 2);
}

function replacer(_key: string, value: unknown) {
  return value;
}

export function fmtTime(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}
