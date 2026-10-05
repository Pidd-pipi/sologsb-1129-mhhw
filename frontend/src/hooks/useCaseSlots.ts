import { useCallback, useEffect, useMemo, useState } from 'react';
import { useCaseStore } from '../stores/caseStore';
import { useMatrixStore } from '../stores/matrixStore';
import type { CaseSlot, TypeCase } from '../types/case';
import {
  detectConflicts,
  emptySlots,
  fillRate,
  findInvalidSlots,
  mergeSlots,
  parseRcKey,
  placeSlot,
  rcKey,
  removeSlot,
  swapSlots,
  validateCapacity,
  type InvalidSlot,
  type RCCell,
  type SlotConflicts,
  type SlotMergeResult,
  type SlotSide,
} from '../utils/layout';
import { DRAFT_KEYS, useLocalDraft } from './useLocalDraft';

/** 布局草稿：本次编辑内容 + 打开时的基准快照 + 逐格冲突取舍 */
interface LayoutDraft {
  slots: CaseSlot[];
  baseSlots: CaseSlot[];
  resolutions: Record<string, SlotSide>;
}

export interface CaseSlotsApi {
  /** 当前编辑中的格位布局（可能尚未保存） */
  slots: CaseSlot[];
  /** 打开页面时的基准快照（合并的底数） */
  baseSlots: CaseSlot[];
  /** 与基准快照相比是否有未保存改动 */
  dirty: boolean;
  saving: boolean;
  /** 与本机已存版本逐格合并的结果 */
  merge: SlotMergeResult;
  /** 合并结果中引用了停用 / 缺损 / 缺失字模的失效格位 */
  invalidSlots: InvalidSlot[];
  /** 合并冲突格位键（双方都改过且未取舍） */
  mergeConflictKeys: string[];
  /** 编辑内容自身的冲突（重复落位 / 同格重复 / 越界） */
  conflicts: SlotConflicts;
  capacity: ReturnType<typeof validateCapacity>;
  fillPercent: number;
  emptyCells: RCCell[];
  /** 草稿与已保存布局是否有差异 */
  draftDiffers: boolean;
  /** 落位：把一枚可用字模放到指定格位 */
  place: (matrix: { id: string; character: string }, row: number, col: number) => void;
  /** 取出格位上的字模 */
  take: (row: number, col: number) => void;
  /** 调换两个格位（目标为空时视为移动） */
  swap: (a: RCCell, b: RCCell) => void;
  clear: () => void;
  replaceAll: (next: CaseSlot[]) => void;
  /** 逐格取舍合并冲突：local 采用本次，saved 采用已存 */
  resolveConflict: (key: string, side: SlotSide) => void;
  /** 批量取舍全部冲突格位 */
  resolveAll: (side: SlotSide) => void;
  /** 按格位合并保存到 IndexedDB；冲突未决议或有失效格位时返回失败原因 */
  save: () => Promise<{ ok: boolean; message?: string; layoutVersion?: number }>;
  /** 放弃未保存改动，回到打开时的基准快照 */
  revert: () => void;
  /** 恢复 localStorage 中暂存的编辑内容 */
  restoreDraft: () => void;
  /** 清除持久化草稿并回到基准快照 */
  discardDraft: () => void;
}

/**
 * 字盘格位编辑：落位 / 取出 / 调换，实时给出空格与重复落位提示；
 * 保存时以打开时快照为基准逐格合并——别的页面动过的格位照常入库，
 * 同一格双方都动过则列为冲突，逐格取舍后才更新已保存布局。
 * 被字盘布局编辑器（`/cases`）复用。
 */
export function useCaseSlots(typeCase: TypeCase | undefined): CaseSlotsApi {
  const saveLayout = useCaseStore((s) => s.saveLayout);
  const matrices = useMatrixStore((s) => s.matrices);

  const persisted = typeCase?.slots ?? [];
  const { draft, patch, reset: resetDraft } = useLocalDraft<LayoutDraft>(
    DRAFT_KEYS.caseEditor(typeCase?.id ?? 'none'),
    { slots: persisted, baseSlots: persisted, resolutions: {} },
  );

  const [slots, setSlots] = useState<CaseSlot[]>(() =>
    draft.baseSlots ? draft.slots : persisted,
  );
  const [baseSlots, setBaseSlots] = useState<CaseSlot[]>(() => draft.baseSlots ?? persisted);
  const [resolutions, setResolutions] = useState<Record<string, SlotSide>>(
    () => draft.resolutions ?? {},
  );
  const [saving, setSaving] = useState(false);

  const rows = typeCase?.rows ?? 0;
  const cols = typeCase?.cols ?? 0;

  const dirty = useMemo(
    () => JSON.stringify(slots) !== JSON.stringify(baseSlots),
    [slots, baseSlots],
  );

  /** 格位布局有未保存改动时，把编辑内容、基准快照与冲突取舍写入 localStorage 草稿，关页再开可继续处理 */
  useEffect(() => {
    if (!dirty) return;
    patch({ slots, baseSlots, resolutions });
  }, [dirty, slots, baseSlots, resolutions, patch]);

  const merge = useMemo(
    () => mergeSlots(baseSlots, persisted, slots, resolutions),
    [baseSlots, persisted, slots, resolutions],
  );

  const invalidSlots = useMemo(() => {
    const inMerged = findInvalidSlots(merge.merged, matrices);
    const inLocal = findInvalidSlots(slots, matrices);
    const map = new Map<string, InvalidSlot>();
    for (const inv of [...inMerged, ...inLocal]) map.set(inv.key, inv);
    return [...map.values()].sort((a, b) => a.row - b.row || a.col - b.col);
  }, [merge.merged, slots, matrices]);

  const mergeConflictKeys = useMemo(
    () => merge.conflicts.map((c) => c.key),
    [merge.conflicts],
  );

  const conflicts = useMemo(() => detectConflicts(rows, cols, slots), [rows, cols, slots]);
  const capacity = useMemo(() => validateCapacity(rows, cols, slots), [rows, cols, slots]);
  const fillPercent = useMemo(() => fillRate(slots, rows, cols), [slots, rows, cols]);
  const emptyCells = useMemo(() => emptySlots(rows, cols, slots), [rows, cols, slots]);

  const place = useCallback((matrix: { id: string; character: string }, row: number, col: number) => {
    const slot: CaseSlot = {
      row,
      col,
      character: matrix.character,
      matrixId: matrix.id,
      placedAt: new Date().toISOString(),
    };
    setResolutions((rs) => {
      if (!(rcKey(row, col) in rs)) return rs;
      const next = { ...rs };
      delete next[rcKey(row, col)];
      return next;
    });
    setSlots((cur) => placeSlot(cur, slot));
  }, []);

  const take = useCallback((row: number, col: number) => {
    setResolutions((rs) => {
      if (!(rcKey(row, col) in rs)) return rs;
      const next = { ...rs };
      delete next[rcKey(row, col)];
      return next;
    });
    setSlots((cur) => removeSlot(cur, row, col));
  }, []);

  const swap = useCallback((a: RCCell, b: RCCell) => {
    setResolutions((rs) => {
      const next = { ...rs };
      delete next[rcKey(a.row, a.col)];
      delete next[rcKey(b.row, b.col)];
      return next;
    });
    setSlots((cur) => swapSlots(cur, a, b));
  }, []);

  const clear = useCallback(() => {
    setResolutions({});
    setSlots([]);
  }, []);

  const replaceAll = useCallback((next: CaseSlot[]) => {
    setResolutions({});
    setSlots(next);
  }, []);

  const resolveConflict = useCallback((key: string, side: SlotSide) => {
    const cell = parseRcKey(key);
    setResolutions((rs) => ({ ...rs, [key]: side }));
    if (side === 'saved' && cell) {
      // 采用已存：把已存格位内容并入本次编辑，网格上即时可见
      const conflict = merge.conflicts.find((c) => c.key === key);
      setSlots((cur) => {
        let next = removeSlot(cur, cell.row, cell.col);
        if (conflict?.saved) next = placeSlot(next, conflict.saved);
        return next;
      });
    }
  }, [merge.conflicts]);

  const resolveAll = useCallback(
    (side: SlotSide) => {
      setResolutions((rs) => {
        const next = { ...rs };
        for (const c of merge.conflicts) next[c.key] = side;
        return next;
      });
      if (side === 'saved') {
        setSlots((cur) => {
          let next = cur;
          for (const c of merge.conflicts) {
            const cell = parseRcKey(c.key);
            if (!cell) continue;
            next = removeSlot(next, cell.row, cell.col);
            if (c.saved) next = placeSlot(next, c.saved);
          }
          return next;
        });
      }
    },
    [merge.conflicts],
  );

  const revert = useCallback(() => {
    setSlots(persisted);
    setBaseSlots(persisted);
    setResolutions({});
  }, [persisted]);

  const restoreDraft = useCallback(() => {
    setSlots(draft.slots);
    if (draft.baseSlots) setBaseSlots(draft.baseSlots);
    setResolutions(draft.resolutions ?? {});
  }, [draft]);

  const discardDraft = useCallback(() => {
    resetDraft();
    setSlots(persisted);
    setBaseSlots(persisted);
    setResolutions({});
  }, [resetDraft, persisted]);

  const save = useCallback(async () => {
    if (!typeCase) return { ok: false as const, message: '未选择字盘' };
    setSaving(true);
    try {
      const res = await saveLayout(typeCase.id, { baseSlots, localSlots: slots, resolutions });
      // 草稿同步为已合并的新布局，避免保存后仍提示“草稿与已保存布局不一致”
      const fresh: CaseSlot[] = res.slots;
      setSlots(fresh);
      setBaseSlots(fresh);
      setResolutions({});
      patch({ slots: fresh, baseSlots: fresh, resolutions: {} });
      return { ok: true as const, layoutVersion: res.layoutVersion };
    } catch (err) {
      return {
        ok: false as const,
        message: err instanceof Error ? err.message : '保存失败',
      };
    } finally {
      setSaving(false);
    }
  }, [saveLayout, typeCase, baseSlots, slots, resolutions, patch]);

  return {
    slots,
    baseSlots,
    dirty,
    saving,
    merge,
    invalidSlots,
    mergeConflictKeys,
    conflicts,
    capacity,
    fillPercent,
    emptyCells,
    draftDiffers: JSON.stringify(draft.slots) !== JSON.stringify(persisted),
    place,
    take,
    swap,
    clear,
    replaceAll,
    resolveConflict,
    resolveAll,
    save,
    revert,
    restoreDraft,
    discardDraft,
  };
}
