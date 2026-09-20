/**
 * localStorage 信封存储。
 * - 整个 Vault 一个 key，一次 JSON 写入（模拟原子提交）
 * - 解析失败时把原文交给上层隔离，绝不覆盖
 */
import { VaultEnvelope } from './types';

const STORAGE_KEY = 'statevault.envelope.v1';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): StorageLike | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const probe = '__statevault_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

export class VaultStorage {
  private store: StorageLike | null;
  readonly key = STORAGE_KEY;

  constructor(store?: StorageLike) {
    this.store = store ?? defaultStorage();
  }

  get available(): boolean {
    return this.store !== null;
  }

  /**
   * @returns
   *   { ok: true, envelope }      正常读取
   *   { ok: true, envelope: null } 首次使用，无存档
   *   { ok: false, raw, reason }  存档损坏（JSON / 结构），raw 供隔离
   */
  read():
    | { ok: true; envelope: VaultEnvelope | null }
    | { ok: false; raw: string; reason: string } {
    if (!this.store) return { ok: true, envelope: null };
    let raw: string | null;
    try {
      raw = this.store.getItem(this.key);
    } catch (e) {
      return { ok: false, raw: '', reason: `读取 localStorage 失败: ${msg(e)}` };
    }
    if (raw === null) return { ok: true, envelope: null };

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return { ok: false, raw, reason: `JSON 解析失败: ${msg(e)}` };
    }
    if (!isEnvelope(parsed)) {
      return { ok: false, raw, reason: '信封结构非法：缺少 format / 必需字段' };
    }
    return { ok: true, envelope: parsed };
  }

  write(envelope: VaultEnvelope): void {
    if (!this.store) return;
    this.store.setItem(this.key, JSON.stringify(envelope));
  }

  clear(): void {
    if (!this.store) return;
    this.store.removeItem(this.key);
  }

  /** 故障场景：直接写入任意字符串（绕过信封），模拟存储被外部写坏 */
  writeRaw(raw: string): void {
    if (!this.store) return;
    this.store.setItem(this.key, raw);
  }
}

function isEnvelope(v: unknown): v is VaultEnvelope {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    e.format === 'statevault' &&
    typeof e.savedAt === 'number' &&
    typeof e.live === 'object' &&
    e.live !== null &&
    Array.isArray(e.history) &&
    Array.isArray(e.future) &&
    Array.isArray(e.quarantine) &&
    Array.isArray(e.events)
  );
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
