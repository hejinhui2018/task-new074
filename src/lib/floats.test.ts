import { describe, expect, it } from 'vitest'
import { detectFloats, locateFloat } from './floats'
import type { WeaveMatrix } from './types'

const m = (rows: string[]): WeaveMatrix =>
  rows.map((line) => line.replace(/\s/g, '').split('').map((ch) => (ch === '1' ? 1 : 0)) as (0 | 1)[])

describe('detectFloats 经纬浮线检测', () => {
  it('检出纬浮线（行内连续 0）并给出方向、位置、长度', () => {
    const W = m([
      '11000011', // 中间 4 个连续纬浮点
      '11111111',
    ])
    const floats = detectFloats(W, 3)
    expect(floats).toHaveLength(1)
    expect(floats[0]).toMatchObject({ kind: 'weft', row: 0, col: 2, length: 4, wrap: false })
    expect(floats[0].cells).toEqual([
      { r: 0, c: 2 },
      { r: 0, c: 3 },
      { r: 0, c: 4 },
      { r: 0, c: 5 },
    ])
  })

  it('检出经浮线（列内连续 1）', () => {
    const W = m([
      '11',
      '11',
      '10',
      '10',
      '00',
    ])
    const floats = detectFloats(W, 3)
    // 第 0 列连续 4 个经浮点
    expect(floats).toHaveLength(1)
    expect(floats[0]).toMatchObject({ kind: 'warp', row: 0, col: 0, length: 4, wrap: false })
  })

  it('长度恰好等于上限不报警，超过才报', () => {
    const W = m(['10000111']) // 连续 0 长度 4
    expect(detectFloats(W, 4)).toHaveLength(0)
    expect(detectFloats(W, 3)).toHaveLength(1)
  })

  it('同幅图可同时报出经、纬浮线', () => {
    const W = m([
      '111100',
      '111000',
      '110000',
      '100000',
    ])
    const floats = detectFloats(W, 2)
    const kinds = new Set(floats.map((f) => f.kind))
    expect(kinds).toEqual(new Set(['warp', 'weft']))
  })

  it('跨首尾接缝的纬浮线（循环铺贴）合并为一条并标记 wrap', () => {
    // 尾部 2 个 0 + 头部 2 个 0 = 连续 4
    const W = m(['00111100'])
    const floats = detectFloats(W, 3)
    expect(floats).toHaveLength(1)
    expect(floats[0]).toMatchObject({ kind: 'weft', row: 0, col: 6, length: 4, wrap: true })
    expect(floats[0].cells).toEqual([
      { r: 0, c: 6 },
      { r: 0, c: 7 },
      { r: 0, c: 0 },
      { r: 0, c: 1 },
    ])
  })

  it('跨首尾接缝的经浮线也能检出', () => {
    // 第 0 列：底部两个 1 + 顶部两个 1 = 连续 4
    const W = m(['10', '10', '00', '10', '10'])
    const floats = detectFloats(W, 3)
    expect(floats).toHaveLength(1)
    expect(floats[0]).toMatchObject({ kind: 'warp', row: 3, col: 0, length: 4, wrap: true })
  })

  it('整行同值不重复计数', () => {
    const allZero = m(['00000'])
    expect(detectFloats(allZero, 3)).toHaveLength(1)
    expect(detectFloats(allZero, 3)[0]).toMatchObject({ length: 5, wrap: false })
  })

  it('空矩阵安全返回空数组', () => {
    expect(detectFloats([], 3)).toEqual([])
  })
})

describe('locateFloat 问题定位', () => {
  const threadingExpanded = [0, 1, 2, 3, 0, 1, 2, 3]
  const treadlingExpanded = [0, 1, 2, 3, 0, 1, 2, 3]
  const ctx = {
    threadingExpanded,
    treadlingExpanded,
    threadingRepeat: 4,
    treadlingRepeat: 4,
  }

  it('纬浮线定位到所在踏纹行及参与的穿综列', () => {
    const [f] = detectFloats(m(['10000111']), 3)
    const loc = locateFloat(f, ctx)
    expect(loc.expandedRows).toEqual([0])
    expect(loc.treadlingUnitCells).toEqual([0]) // 第 0 纬对应踏纹循环位 1
    // 连续 0 在列 1..4
    expect(loc.expandedCols).toEqual([1, 2, 3, 4])
    expect(loc.threadingUnitCells).toEqual([0, 1, 2, 3])
    expect(loc.harnesses).toEqual([0, 1, 2, 3])
    expect(loc.treadles).toEqual([0])
  })

  it('经浮线定位到所在穿综列及参与的踏纹行', () => {
    const [f] = detectFloats(
      m([
        '11',
        '11',
        '10',
        '10',
        '00',
      ]),
      3
    )
    const loc = locateFloat(f, {
      threadingExpanded: [0, 1],
      treadlingExpanded: [0, 1, 2, 3, 0],
      threadingRepeat: 2,
      treadlingRepeat: 4,
    })
    expect(loc.expandedCols).toEqual([0])
    expect(loc.threadingUnitCells).toEqual([0])
    expect(loc.expandedRows).toEqual([0, 1, 2, 3])
    expect(loc.treadlingUnitCells).toEqual([0, 1, 2, 3])
  })
})
