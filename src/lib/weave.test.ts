import { describe, expect, it } from 'vitest'
import { computeWeave, expandedThreading, expandedTreadling, previewRows } from './weave'
import { createDefaultState } from './defaultDraft'
import { detectFloats } from './floats'
import { makeState } from './testUtils'

describe('computeWeave 组织矩阵计算', () => {
  it('W[r][c] = tieUp[threading[c]][treadling[r]]（恒等对角线样例）', () => {
    const s = makeState() // threading=[0,1,2,3], treadling=[0,1,2,3], tieUp 为对角矩阵
    const W = computeWeave(s)
    expect(W).toHaveLength(8)
    expect(W[0]).toHaveLength(8)
    // 顺穿 + 顺踏 + 对角提综 ⇒ 组织图也是 1 在对角（含循环铺贴）
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) expect(W[r][c]).toBe(r % 4 === c % 4 ? 1 : 0)
  })

  it('所有综框都被提起时整幅为经浮点', () => {
    const s = makeState({
      tieUp: Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => true)),
    })
    const W = computeWeave(s)
    expect(W.every((row) => row.every((v) => v === 1))).toBe(true)
  })

  it('没有任何综框被提起时整幅为纬浮点', () => {
    const s = makeState({
      tieUp: Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => false)),
    })
    const W = computeWeave(s)
    expect(W.every((row) => row.every((v) => v === 0))).toBe(true)
  })

  it('修改一个连接点会重算所有相关行列', () => {
    const s = makeState()
    const before = computeWeave(s)
    // 让踏板 0 额外提起综框 1
    const tieUp = s.tieUp.map((r) => r.slice())
    tieUp[1][0] = true
    const after = computeWeave({ ...s, tieUp })
    // 穿综为 1 的列（c=1,5）在踩踏板 0 的行（r=0,4）由 0 变 1
    expect(after[0][1]).toBe(1)
    expect(after[4][5]).toBe(1)
    expect(before[0][1]).toBe(0)
    // 其余格不变
    expect(after[0][0]).toBe(before[0][0])
    expect(after[2][2]).toBe(before[2][2])
  })
})

describe('内置破斜纹样稿', () => {
  const s = createDefaultState()
  const W = computeWeave(s)

  it('规格为 8 综 8 踏板 32 经 24 纬', () => {
    expect(s.settings).toMatchObject({
      harnessCount: 8,
      treadleCount: 8,
      warpCount: 32,
      weftCount: 24,
      threadingRepeat: 8,
      treadlingRepeat: 8,
    })
    expect(W).toHaveLength(24)
    W.forEach((row) => expect(row).toHaveLength(32))
  })

  it('穿综为断穿 1-4,8-5，踏纹顺踏 1-8', () => {
    expect(s.threading).toEqual([0, 1, 2, 3, 7, 6, 5, 4])
    expect(s.treadling).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  it('组织图沿穿综与踏纹双周期重复（8 经 × 8 纬铺贴）', () => {
    for (let r = 0; r < 24; r++)
      for (let c = 0; c < 32; c++) expect(W[r][c]).toBe(W[r % 8][c % 8])
  })

  it('断口两侧斜纹方向相反（人字形破斜）', () => {
    // 左半段（穿综 1-4）：W[r][c] = ((c - r) mod 8) < 4，条带随纬行向右推进；
    // 右半段（穿综 8-5，令 q = 11-c）：W = ((q - r) mod 8) < 4，条带随纬行向左推进。
    // 直接校验 8×8 基础单元每一格，方向镜像由此严格保证。
    const mod8 = (x: number) => ((x % 8) + 8) % 8
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const coord = c < 4 ? c : 11 - c
        expect(W[r][c]).toBe(mod8(coord - r) < 4 ? 1 : 0)
      }
    }
    // 抽查：第 1 纬右半段只有最右列（第 8 经）浮起，第 4 纬右半段四列全部浮起
    expect(W[1].slice(4, 8)).toEqual([0, 0, 0, 1])
    expect(W[4].slice(4, 8)).toEqual([1, 1, 1, 1])
  })

  it('默认阈值 4 下内置样稿无超长浮线', () => {
    // 4/4 破斜最长浮线恰为 4，等于上限不报警
    expect(detectFloats(W, 4)).toHaveLength(0)
  })
})

describe('循环展开到整幅', () => {
  it('穿综按循环铺满 warpCount', () => {
    expect(expandedThreading(makeState({ threading: [0, 2], warpCount: 5, threadingRepeat: 2 }))).toEqual([
      0, 2, 0, 2, 0,
    ])
  })
  it('踏纹按循环铺满 weftCount', () => {
    expect(
      expandedTreadling(makeState({ treadling: [3, 1], weftCount: 5, treadlingRepeat: 2 }))
    ).toEqual([3, 1, 3, 1, 3])
  })
})

describe('previewRows 逐纬预演切片', () => {
  const s = makeState({ warpCount: 6, weftCount: 10 })
  it('n=0 为空布面', () => {
    expect(previewRows(s, 0)).toEqual([])
  })
  it('返回前 n 行且与整幅矩阵一致', () => {
    const full = computeWeave(s)
    expect(previewRows(s, 3)).toEqual(full.slice(0, 3))
  })
  it('超过总行数时夹到整幅', () => {
    expect(previewRows(s, 99)).toHaveLength(10)
  })
  it('负值夹到 0', () => {
    expect(previewRows(s, -5)).toHaveLength(0)
  })
})
