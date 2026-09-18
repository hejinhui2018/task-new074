import { describe, expect, it } from 'vitest'
import {
  setThreadingCell,
  setTreadlingCell,
  toggleTieCell,
  updateSettings,
} from './edits'
import { computeWeave, previewRows } from './weave'
import { createDefaultState } from './defaultDraft'
import { makeState } from './testUtils'

describe('格点编辑', () => {
  it('setThreadingCell 修改穿综循环位', () => {
    const s = makeState({ threading: [0, 1, 2, 3] })
    const s2 = setThreadingCell(s, 2, 0)
    expect(s2.threading[2]).toBe(0)
    expect(s.threading[2]).toBe(2) // 不可变：原状态不变
  })

  it('非法综框或越界位置被忽略', () => {
    const s = makeState()
    expect(setThreadingCell(s, 0, 99)).toBe(s)
    expect(setThreadingCell(s, 99, 0)).toBe(s)
    expect(setThreadingCell(s, 0, 0)).toBe(s) // 值未变，返回同一引用
  })

  it('setTreadlingCell 修改踏纹循环位', () => {
    const s = makeState({ treadling: [0, 1, 2, 3] })
    expect(setTreadlingCell(s, 1, 3).treadling[1]).toBe(3)
  })

  it('toggleTieCell 翻转连接并保持不可变', () => {
    const s = makeState()
    const before = s.tieUp[0][1]
    const s2 = toggleTieCell(s, 0, 1)
    expect(s2.tieUp[0][1]).toBe(!before)
    expect(s.tieUp[0][1]).toBe(before)
  })
})

describe('循环与尺寸设置', () => {
  it('加长穿综循环按旧周期补齐', () => {
    const s = makeState({ threading: [0, 1], threadingRepeat: 2 })
    const s2 = updateSettings(s, { threadingRepeat: 5 })
    expect(s2.threading).toEqual([0, 1, 0, 1, 0])
  })

  it('缩短穿综循环为截断', () => {
    const s = makeState({ threading: [0, 1, 2, 3], threadingRepeat: 4 })
    expect(updateSettings(s, { threadingRepeat: 2 }).threading).toEqual([0, 1])
  })

  it('减少综框数时夹紧越界穿综并重设连接矩阵', () => {
    const s = makeState({ harnessCount: 8, threading: [0, 7, 3, 5], threadingRepeat: 4 })
    const s2 = updateSettings(s, { harnessCount: 4 })
    expect(s2.threading).toEqual([0, 0, 3, 0])
    expect(s2.tieUp).toHaveLength(4)
    expect(s2.tieUp[0]).toHaveLength(4)
  })

  it('增加踏板数时连接矩阵新增列默认不连接', () => {
    const s = makeState({ treadleCount: 4 })
    const s2 = updateSettings(s, { treadleCount: 6 })
    expect(s2.tieUp[0][5]).toBe(false)
    expect(s2.tieUp).toHaveLength(4)
  })
})

describe('编辑后逐纬预演同步', () => {
  // 这是核心需求：播放到某行后进行编辑，已织部分保留当时结果的行数语义，
  // 而“从当前行继续”必须使用最新组织。previewRows 每次都对最新状态整体重算后切片，
  // 因此任何编辑都会即时反映在未织与将织的行上。
  it('编辑连接矩阵后，当前行之后的预演立即采用新组织', () => {
    const s = makeState({ warpCount: 8, weftCount: 8 })
    // 织到第 3 纬
    const atPick3 = previewRows(s, 3)
    expect(atPick3).toHaveLength(3)

    // 播放途中编辑：踏板 3 改为提起综框 0（对角矩阵中原为 (3,3)）
    const edited = toggleTieCell(s, 0, 3)

    // 已织出的前 3 行（r=0,1,2）都不踩踏板 3，故完全不变
    const resumed = previewRows(edited, 4)
    expect(resumed.slice(0, 3)).toEqual(computeWeave(s).slice(0, 3))
    // 第 4 纬（r=3）立即按最新组织：列 0、4（穿综 0）变为经浮点
    expect(resumed[3][0]).toBe(1)
    expect(resumed[3][4]).toBe(1)
    expect(computeWeave(s)[3][0]).toBe(0)
  })

  it('编辑穿综后从当前行继续，后续行与整幅最新矩阵一致', () => {
    const s = createDefaultState()
    // 播放到第 10 纬时，设计师改了第 0 个穿综循环位
    const edited = setThreadingCell(s, 0, 5)
    const rows = previewRows(edited, 12)
    expect(rows).toEqual(computeWeave(edited).slice(0, 12))
    // 且与编辑前组织确有差异（证明采用的是最新组织而非缓存）
    expect(rows).not.toEqual(computeWeave(s).slice(0, 12))
  })

  it('编辑踏纹后下一纬立即换踩新踏板', () => {
    const s = createDefaultState()
    const edited = setTreadlingCell(s, 5, 0) // 第 6 纬循环位改踩踏板 1
    const before = computeWeave(s)
    const after = computeWeave(edited)
    // r=5、13、21 都落在该循环位
    expect(after[5]).not.toEqual(before[5])
    expect(after[5]).toEqual(after[5].map((_, c) => after[0][c]))
    expect(after[13]).toEqual(after[5])
    expect(after[21]).toEqual(after[5])
  })

  it('播放到底后继续切片始终返回最新整幅的前缀', () => {
    const s = createDefaultState()
    const edited = toggleTieCell(s, 2, 6)
    expect(previewRows(edited, 24)).toEqual(computeWeave(edited))
    expect(previewRows(edited, 100)).toHaveLength(24)
  })
})
