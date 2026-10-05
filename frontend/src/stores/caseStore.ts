import { create } from 'zustand';
import { db, ensureSeed } from '../db';
import type { CaseInput, CaseSlot, TypeCase } from '../types/case';
import { capacityOf } from '../types/case';
import { makeId, toPlain } from '../utils/format';
import { broadcastSignal } from '../utils/broadcast';
import { matrixIdsOf, validateCapacity } from '../utils/layout';

/** 保存布局时发现落库版本已被别人更新 */
export class LayoutStaleError extends Error {
  constructor(public latest: TypeCase) {
    super('字盘布局已被别的页面更新，需要按格位合并后再保存');
    this.name = 'LayoutStaleError';
  }
}

interface CaseState {
  cases: TypeCase[];
  loaded: boolean;
  loading: boolean;
  error: string;
  load: () => Promise<void>;
  /** 其它页面保存后静默刷新（不打断编辑、不弹错误） */
  reloadQuiet: () => Promise<void>;
  createCase: (input: CaseInput) => Promise<TypeCase>;
  updateCase: (id: string, patch: Partial<TypeCase>) => Promise<void>;
  saveSlots: (id: string, slots: CaseSlot[], expectedVersion?: string) => Promise<TypeCase>;
  removeCase: (id: string) => Promise<void>;
}

function sortByCode(list: TypeCase[]): TypeCase[] {
  return [...list].sort((a, b) => (a.code < b.code ? -1 : 1));
}

export const useCaseStore = create<CaseState>((set, get) => ({
  cases: [],
  loaded: false,
  loading: false,
  error: '',

  load: async () => {
    set({ loading: true, error: '' });
    try {
      await ensureSeed();
      const cases = await db.cases.toArray();
      set({ cases: sortByCode(cases), loaded: true, loading: false });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : '字盘档案读取失败' });
    }
  },

  reloadQuiet: async () => {
    try {
      await ensureSeed();
      const cases = await db.cases.toArray();
      set({ cases: sortByCode(cases), loaded: true });
    } catch {
      /* 静默刷新失败时保留当前内存数据，下个信号或手动操作再试 */
    }
  },

  createCase: async (input) => {
    const now = new Date().toISOString();
    const rows = Number(input.rows);
    const cols = Number(input.cols);
    const row: TypeCase = toPlain({
      id: makeId('case'),
      code: input.code.trim(),
      kind: input.kind,
      rows,
      cols,
      slots: [] as CaseSlot[],
      workStation: input.workStation.trim(),
      matrixId: [] as string[],
      layoutVersion: makeId('lay'),
      layoutSavedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    if (capacityOf(rows, cols) <= 0) throw new Error('字盘容量不合法，请检查行列数');
    await db.cases.add(row);
    set((s) => ({ cases: sortByCode([...s.cases, row]) }));
    broadcastSignal('cases-changed', row.id);
    return row;
  },

  updateCase: async (id, patch) => {
    const plain = toPlain(patch);
    const next: Partial<TypeCase> = { ...plain, updatedAt: new Date().toISOString() };
    if (plain.rows || plain.cols) {
      const current = get().cases.find((c) => c.id === id);
      const rows = plain.rows ?? current?.rows ?? 0;
      const cols = plain.cols ?? current?.cols ?? 0;
      const slots = plain.slots ?? current?.slots ?? [];
      const check = validateCapacity(rows, cols, slots);
      if (check.overCapacity) throw new Error(check.message);
    }
    await db.cases.update(id, next);
    set((s) => ({ cases: s.cases.map((c) => (c.id === id ? { ...c, ...next } : c)) }));
    broadcastSignal('cases-changed', id);
  },

  /**
   * 保存格位布局（按格位合并保存的落库端）：
   * - 同时刷新 matrixId 多值索引；
   * - 更换布局版本令牌，供另一个打开页面识别「别人已保存」并做三方合并；
   * - 带 expectedVersion 做乐观并发：落库版本已被别人更新时抛 LayoutStaleError，
   *   本次布局不覆盖已存数据，由编辑会话按格位合并后再保存。
   */
  saveSlots: async (id, slots, expectedVersion) => {
    const current = await db.cases.get(id);
    if (!current) throw new Error('未找到字盘');
    if (expectedVersion !== undefined && current.layoutVersion !== expectedVersion) {
      throw new LayoutStaleError(current);
    }
    const check = validateCapacity(current.rows, current.cols, slots);
    if (check.overCapacity) throw new Error(check.message);
    const nowIso = new Date().toISOString();
    const plainSlots = toPlain(slots);
    const next: TypeCase = {
      ...current,
      slots: plainSlots,
      matrixId: matrixIdsOf(plainSlots),
      layoutVersion: makeId('lay'),
      layoutSavedAt: nowIso,
      updatedAt: nowIso,
    };
    await db.cases.put(next);
    set((s) => ({ cases: s.cases.map((c) => (c.id === id ? next : c)) }));
    broadcastSignal('cases-changed', id);
    return next;
  },

  removeCase: async (id) => {
    await db.cases.delete(id);
    set((s) => ({ cases: s.cases.filter((c) => c.id !== id) }));
    broadcastSignal('cases-changed', id);
  },
}));

/** 找出存放指定字模的字盘与格位 */
export function findCaseHolding(cases: TypeCase[], matrixId: string): Array<{ typeCase: TypeCase; slots: CaseSlot[] }> {
  const out: Array<{ typeCase: TypeCase; slots: CaseSlot[] }> = [];
  for (const c of cases) {
    const slots = c.slots.filter((s) => s.matrixId === matrixId);
    if (slots.length) out.push({ typeCase: c, slots });
  }
  return out;
}
