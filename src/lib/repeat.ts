/**
 * 循环区间工具：穿综 / 踏纹以“一个循环单元”编辑，
 * 再按周期铺满整幅布。
 */

/** 将长度为 L 的循环单元展开为长度 n 的序列（周期取模） */
export function expandRepeat(unit: readonly number[], n: number): number[] {
  if (unit.length === 0) throw new Error('循环单元不能为空')
  return Array.from({ length: n }, (_, i) => unit[i % unit.length])
}

/**
 * 调整循环单元长度：
 * - 缩短：直接截断
 * - 延长：用旧单元周期补齐（保证新增位置可预测）
 */
export function resizeRepeat(unit: readonly number[], newLength: number): number[] {
  if (newLength <= 0) throw new Error('循环长度必须为正整数')
  if (unit.length === 0) throw new Error('循环单元不能为空')
  return expandRepeat(unit, newLength)
}

/** 把 value 限制在 [0, max-1] */
export function clampIndex(value: number, max: number): number {
  if (max <= 0) throw new Error('上界必须为正整数')
  return Math.min(max - 1, Math.max(0, Math.floor(value)))
}
