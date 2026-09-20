// 故障注入配置：在某个迁移步骤上制造指定故障，可控制发生次数（1 次 / 每次）。
export type FaultKind =
  | 'transformThrow' // 迁移函数执行到一半抛异常（最常见：读到未定义字段）
  | 'badOutput' // 函数返回了不符合 outputChecks 的产物（校验失败）
  | 'crashAfterStaging' // 已写暂存日志、转换前"断电"（刷新/崩溃）
  | 'crashAfterDocWrite' // 主快照已写、暂存未清时"断电"
  | 'corruptDocWrite' // 主快照写入了半截/损坏字节

export interface FaultSpec {
  kind: FaultKind
  /** 还应触发多少次；Infinity 表示每次都触发 */
  remaining: number
}

export const FAULT_LABELS: Record<FaultKind, string> = {
  transformThrow: '迁移函数抛异常',
  badOutput: '产物校验失败（缺字段）',
  crashAfterStaging: '转换前断电（刷新）',
  crashAfterDocWrite: '提交后断电（刷新）',
  corruptDocWrite: '主快照写坏（半截写入）',
}

export class FaultBoard {
  private specs = new Map<string, FaultSpec>()

  set(stepId: string, kind: FaultKind | null, repeat: number = 1): void {
    if (!kind) this.specs.delete(stepId)
    else this.specs.set(stepId, { kind, remaining: repeat })
  }

  consume(stepId: string): FaultKind | null {
    const spec = this.specs.get(stepId)
    if (!spec) return null
    const kind = spec.kind
    if (Number.isFinite(spec.remaining)) {
      spec.remaining -= 1
      if (spec.remaining <= 0) this.specs.delete(stepId)
    }
    return kind
  }

  peek(stepId: string): FaultSpec | undefined {
    return this.specs.get(stepId)
  }

  clear(): void {
    this.specs.clear()
  }

  snapshot(): Record<string, { kind: FaultKind; remaining: number }> {
    return Object.fromEntries(
      [...this.specs.entries()].map(([k, v]) => [k, { kind: v.kind, remaining: v.remaining }]),
    )
  }
}

/** 让某一步的产物故意缺字段，触发 outputChecks */
export function sabotageOutput(stepId: string, output: Record<string, unknown>): Record<string, unknown> {
  const bad = structuredClone(output)
  switch (stepId) {
    case '1->2': {
      const tasks = bad.tasks as Array<Record<string, unknown>>
      delete tasks[0]!.order
      return bad
    }
    case '2->3': {
      const tasks = bad.tasks as Record<string, Record<string, unknown>>
      const first = Object.keys(tasks)[0]!
      delete tasks[first]!.createdAt
      return bad
    }
    case '3->4': {
      const tasks = bad.tasks as Record<string, Record<string, unknown>>
      const first = Object.keys(tasks)[0]!
      delete tasks[first]!.priority
      return bad
    }
    case '4->5': {
      const tasks = bad.tasks as Record<string, Record<string, unknown>>
      const first = Object.keys(tasks)[0]!
      // 类型错误：tags 应为数组
      tasks[first]!.tags = '紧急'
      return bad
    }
    default:
      return bad
  }
}
