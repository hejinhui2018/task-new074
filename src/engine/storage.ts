// 极简 KV 抽象：浏览器用 localStorage，测试用内存 Map。
// 所有读写都经过这一层，便于模拟"断电/写坏"。

export interface KV {
  get(key: string): string | null
  set(key: string, value: string): void
  remove(key: string): void
  keys(): string[]
}

export class MemoryKV implements KV {
  private map = new Map<string, string>()
  get(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null
  }
  set(key: string, value: string): void {
    this.map.set(key, value)
  }
  remove(key: string): void {
    this.map.delete(key)
  }
  keys(): string[] {
    return [...this.map.keys()]
  }
  /** 测试用：直接从外部写裸数据（模拟别的程序 / 旧版本写库） */
  rawSet(key: string, value: string): void {
    this.map.set(key, value)
  }
}

export const STORAGE_KEYS = {
  doc: 'statevault:doc',
  meta: 'statevault:meta',
  staging: 'statevault:staging',
  rollback: 'statevault:rollback',
} as const

export class LocalStorageKV implements KV {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key)
    } catch {
      return null
    }
  }
  set(key: string, value: string): void {
    window.localStorage.setItem(key, value)
  }
  remove(key: string): void {
    window.localStorage.removeItem(key)
  }
  keys(): string[] {
    const out: string[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i)
      if (k) out.push(k)
    }
    return out
  }
}
