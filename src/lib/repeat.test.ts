import { describe, expect, it } from 'vitest'
import { clampIndex, expandRepeat, resizeRepeat } from './repeat'

describe('expandRepeat 循环展开', () => {
  it('按周期取模铺满指定长度', () => {
    expect(expandRepeat([0, 1, 2], 7)).toEqual([0, 1, 2, 0, 1, 2, 0])
  })

  it('长度小于单元时只取前缀', () => {
    expect(expandRepeat([9, 8, 7, 6], 2)).toEqual([9, 8])
  })

  it('整倍数长度精确重复', () => {
    expect(expandRepeat([1, 0], 6)).toEqual([1, 0, 1, 0, 1, 0])
  })

  it('空单元抛错', () => {
    expect(() => expandRepeat([], 3)).toThrow()
  })
})

describe('resizeRepeat 循环长度调整', () => {
  it('缩短时截断', () => {
    expect(resizeRepeat([5, 6, 7, 8], 2)).toEqual([5, 6])
  })

  it('延长时按旧周期补齐', () => {
    expect(resizeRepeat([5, 6, 7], 6)).toEqual([5, 6, 7, 5, 6, 7])
  })

  it('非法长度抛错', () => {
    expect(() => resizeRepeat([1], 0)).toThrow()
  })
})

describe('clampIndex', () => {
  it('夹到合法区间并向下取整', () => {
    expect(clampIndex(-3, 8)).toBe(0)
    expect(clampIndex(99, 8)).toBe(7)
    expect(clampIndex(2.9, 8)).toBe(2)
  })
})
