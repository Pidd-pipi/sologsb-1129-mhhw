import { create } from 'zustand';
import { db, ensureSeed } from '../db';
import type { CaseInput, CaseSlot, TypeCase } from '../types/case';
import { capacityOf } from '../types/case';
import { makeId, toPlain } from '../utils/format';
import { findInvalidSlots, matrixIdsOf, mergeSlots, validateCapacity, type SlotSide } from '../utils/layout';

/** 合并保存时发现未决议的格位冲突 */
export class MergeConflictError extends Error {
  conflicts: Array<{ key: string }>;
  constructor(conflicts: Array<{ key: string }>) {
    super('存在未处理的格位合并冲突，请逐格采用本次或已存版本');
    this.name = 'MergeConflictError';
    this.conflicts = conflicts;
  }
}

interface SaveLayoutArgs {
  /** 打开页面时的格位快照 */
  baseSlots: CaseSlot[];
  /** 本次编辑后的格位 */
  localSlots: CaseSlot[];
  /** 逐格冲突取舍：local 采用本次，saved 采用已存 */
  resolutions: Record<string, SlotSide>;
}

interface CaseState {
  cases: TypeCase[];
  loaded: boolean;
  loading: boolean;
  error: string;
  load: () => Promise<void>;
  createCase: (input: CaseInput) => Promise<TypeCase>;
  updateCase: (id: string, patch: Partial<TypeCase>) => Promise<void>;
  /** 按格位三向合并保存布局，返回合并后的布局与新版本号 */
  saveLayout: (id: string, args: SaveLayoutArgs) => Promise<{ slots: CaseSlot[]; layoutVersion: number }>;
  removeCase: (id: string) => Promise<void>;
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
      set({ cases: cases.sort((a, b) => (a.code < b.code ? -1 : 1)), loaded: true, loading: false });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : '字盘档案读取失败' });
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
      layoutVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    if (capacityOf(rows, cols) <= 0) throw new Error('字盘容量不合法，请检查行列数');
    await db.cases.add(row);
    set((s) => ({ cases: [...s.cases, row].sort((a, b) => (a.code < b.code ? -1 : 1)) }));
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
      // 行列数变化后旧布局不再完整，版本号 +1，提醒各页面按新格位重新合并
      next.layoutVersion = (current?.layoutVersion ?? 1) + 1;
    }
    await db.cases.update(id, next);
    set((s) => ({ cases: s.cases.map((c) => (c.id === id ? { ...c, ...next } : c)) }));
  },

  /**
   * 保存格位布局：打开页面时的快照为基准，与 IndexedDB 中的最新已存版本
   * 逐格合并——对方未动过的格位照常入库，双方都动过的格位须先逐格取舍；
   * 合并后若仍有停用 / 缺损字模落位，或超出容量，一律拒绝写入。
   */
  saveLayout: async (id, { baseSlots, localSlots, resolutions }) => {
    const fresh = await db.cases.get(id);
    if (!fresh) throw new Error('未找到字盘');
    const merge = mergeSlots(baseSlots, fresh.slots ?? [], localSlots, resolutions);
    if (merge.conflicts.length) throw new MergeConflictError(merge.conflicts);

    const matrices = await db.matrices.toArray();
    const invalid = findInvalidSlots(merge.merged, matrices);
    if (invalid.length) {
      throw new Error(
        `盘内仍有 ${invalid.length} 格停用 / 缺损字模，请先取出或替换后再保存`,
      );
    }
    const check = validateCapacity(fresh.rows, fresh.cols, merge.merged);
    if (check.overCapacity) throw new Error(check.message);

    const nextVersion = (fresh.layoutVersion ?? 1) + 1;
    const now = new Date().toISOString();
    const next: Partial<TypeCase> = {
      slots: toPlain(merge.merged),
      matrixId: matrixIdsOf(merge.merged),
      layoutVersion: nextVersion,
      updatedAt: now,
    };
    await db.cases.update(id, next);
    set((s) => ({ cases: s.cases.map((c) => (c.id === id ? { ...c, ...next } : c)) }));
    return { slots: merge.merged, layoutVersion: nextVersion };
  },

  removeCase: async (id) => {
    await db.cases.delete(id);
    set((s) => ({ cases: s.cases.filter((c) => c.id !== id) }));
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
