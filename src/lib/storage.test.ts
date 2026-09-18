import { describe, expect, it } from 'vitest'
import { coerceState } from './storage'
import { createDefaultState } from './defaultDraft'

describe('coerceState 本地数据校验与恢复', () => {
  it('合法数据原样保留', () => {
    const d = createDefaultState()
    const got = coerceState(JSON.parse(JSON.stringify(d)))
    expect(got).toEqual(d)
  })

  it('损坏数据回退到内置样稿', () => {
    expect(coerceState(null)).toEqual(createDefaultState())
    expect(coerceState('garbage')).toEqual(createDefaultState())
    expect(coerceState({ settings: 'nope' })).toEqual(createDefaultState())
  })

  it('缺字段时补默认值', () => {
    const got = coerceState({ settings: {}, threading: [], treadling: [], tieUp: [] })
    expect(got.settings.warpCount).toBe(32)
    expect(got.threading).toEqual([0, 1, 2, 3, 7, 6, 5, 4])
  })

  it('越界的穿综 / 踏纹值被修正为合法默认', () => {
    const got = coerceState({
      settings: { ...createDefaultState().settings },
      threading: [99, -1, 2, 3, 7, 6, 5, 4],
      treadling: [0, 1, 2, 3, 4, 5, 6, 7],
      tieUp: createDefaultState().tieUp,
    })
    expect(got.threading[0]).toBeGreaterThanOrEqual(0)
    expect(got.threading[0]).toBeLessThan(8)
  })

  it('尺寸变化后 tieUp 被补齐为布尔矩阵', () => {
    const got = coerceState({
      settings: { ...createDefaultState().settings, harnessCount: 10, treadleCount: 10 },
      threading: createDefaultState().threading,
      treadling: createDefaultState().treadling,
      tieUp: createDefaultState().tieUp,
    })
    expect(got.tieUp).toHaveLength(10)
    expect(got.tieUp[9]).toHaveLength(10)
    expect(got.tieUp[9][9]).toBe(false)
  })
})
