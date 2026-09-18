// @vitest-environment happy-dom
import { describe, expect, it, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import App from './App'

beforeEach(() => {
  localStorage.clear()
})

function getGrid(label: string): HTMLElement {
  return screen.getByLabelText(label)
}

describe('App 织物组织设计台 集成冒烟测试', () => {
  it('挂载后四联图齐全，默认样稿无超长浮线，组织图尺寸 24×32', () => {
    render(<App />)
    expect(getGrid('综框与踏板连接矩阵')).toBeTruthy()
    expect(getGrid('穿综图')).toBeTruthy()
    expect(getGrid('踏纹序列')).toBeTruthy()
    expect(getGrid('组织图')).toBeTruthy()

    // 组织图：24 行 × 32 列 = 768 格
    expect(within(getGrid('组织图')).getAllByRole('button')).toHaveLength(24 * 32)
    // 连接矩阵 8×8
    expect(within(getGrid('综框与踏板连接矩阵')).getAllByRole('button')).toHaveLength(64)
    // 默认阈值 4：无超长浮线
    expect(screen.getByText('无超长浮线')).toBeTruthy()
  })

  it('降低浮线阈值后出现问题列表，点击问题能定位（连接矩阵出现成因交点）', () => {
    render(<App />)
    const maxFloatInput = screen.getByLabelText('最大浮线') as HTMLInputElement
    fireEvent.change(maxFloatInput, { target: { value: '3' } })
    expect(maxFloatInput.value).toBe('3')

    // 4/4 破斜在阈值 3 下必然报出浮线（经浮线与纬浮线都有）
    const list = screen.getByLabelText('超长浮线问题列表')
    const items = within(list).getAllByRole('button')
    expect(items.length).toBeGreaterThan(0)

    const tieGrid = getGrid('综框与踏板连接矩阵')
    const causeMarks = () =>
      within(tieGrid)
        .getAllByRole('button')
        .filter((b) => b.className.includes('causal') || b.className.includes('candidate'))
    expect(causeMarks()).toHaveLength(0)

    // 点击第一个问题：组织图/列表选中，连接矩阵标出成因交点
    // （经浮线=红色 causal 已连接；纬浮线=琥珀 candidate 应提未提）
    fireEvent.click(items[0])
    expect(causeMarks().length).toBeGreaterThan(0)

    // 再点一次经浮线问题，应出现红色“已连接”成因交点
    const warpItem = within(list).getAllByRole('button', { name: /经浮线/ })[0]
    fireEvent.click(warpItem)
    const causal = within(tieGrid)
      .getAllByRole('button')
      .filter((b) => b.className.includes('causal'))
    expect(causal.length).toBeGreaterThan(0)
  })

  it('点击连接矩阵格点切换连接状态（任意格修改触发重算）', () => {
    render(<App />)
    const tieGrid = getGrid('综框与踏板连接矩阵')
    const cell = within(tieGrid).getAllByRole('button')[0]
    const before = cell.className.includes('on')
    fireEvent.click(cell)
    const after = within(tieGrid).getAllByRole('button')[0].className.includes('on')
    expect(after).toBe(!before)
  })

  it('逐纬预演：点“下一纬”后进度推进，且组织按当前踏纹呈现', () => {
    render(<App />)
    expect(screen.getByText(/已织 0\/24 纬/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '下一纬' }))
    expect(screen.getByText(/已织 1\/24 纬/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '下一纬' }))
    expect(screen.getByText(/已织 2\/24 纬/)).toBeTruthy()

    // 已织行不再淡化
    const drawdown = within(getGrid('组织图')).getAllByRole('button')
    const firstRowWoven = drawdown.slice(0, 32).every((b) => b.className.includes('woven'))
    const thirdRowPending = drawdown.slice(64, 96).every((b) => b.className.includes('pending'))
    expect(firstRowWoven).toBe(true)
    expect(thirdRowPending).toBe(true)

    // 回退
    fireEvent.click(screen.getByRole('button', { name: '上一纬' }))
    expect(screen.getByText(/已织 1\/24 纬/)).toBeTruthy()
  })

  it('播放到中途编辑连接矩阵，后续行仍正常推进且数据写入 localStorage', () => {
    render(<App />)
    // 织入 5 纬
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole('button', { name: '下一纬' }))
    expect(screen.getByText(/已织 5\/24 纬/)).toBeTruthy()

    // 编辑一个连接点
    const tieGrid = getGrid('综框与踏板连接矩阵')
    const cell = within(tieGrid).getAllByRole('button')[2]
    act(() => {
      fireEvent.click(cell)
    })

    // 从当前行继续：再织一纬，进度到 6，界面不报错
    fireEvent.click(screen.getByRole('button', { name: '下一纬' }))
    expect(screen.getByText(/已织 6\/24 纬/)).toBeTruthy()

    // 已持久化到浏览器本地
    const saved = JSON.parse(localStorage.getItem('weave-design-bench:v1') ?? 'null')
    expect(saved).not.toBeNull()
    expect(saved.settings.warpCount).toBe(32)
  })

  it('“恢复内置样稿”按钮可重置设计与播放进度', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '下一纬' }))
    fireEvent.click(screen.getByRole('button', { name: '恢复内置样稿' }))
    expect(screen.getByText(/已织 0\/24 纬/)).toBeTruthy()
    expect(screen.getByText('无超长浮线')).toBeTruthy()
  })
})
