import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCaseStore, LayoutStaleError } from '../stores/caseStore';
import { useMatrixStore } from '../stores/matrixStore';
import type { CaseSlot, TypeCase } from '../types/case';
import type { TypeMatrix } from '../types/matrix';
import {
  type CellMergeConflict,
  type ConflictChoice,
  detectConflicts,
  emptySlots,
  type InvalidSlot,
  fillRate,
  findInvalidSlots,
  mergeLayouts,
  placeSlot,
  rcKey,
  removeSlot,
  removeSlots,
  slotAt,
  swapSlots,
  validateCapacity,
  type RCCell,
  type SlotConflicts,
} from '../utils/layout';
import {
  clearCaseSession,
  loadCaseSession,
  readLegacyDraftSlots,
  removeLegacyDraft,
  saveCaseSession,
  type CaseEditSession,
} from '../utils/caseSession';

export interface CaseSlotsApi {
  /** 当前编辑中的格位布局（自动合并 + 裁决 + 失效取出后的结果） */
  slots: CaseSlot[];
  /** 与最新已存布局是否有差异 */
  dirty: boolean;
  saving: boolean;
  /** 布局内部校验：重复落位 / 越界等 */
  conflicts: SlotConflicts;
  capacity: ReturnType<typeof validateCapacity>;
  fillPercent: number;
  emptyCells: RCCell[];
  /** 三方合并状态（两个页面先后保存同一字盘时） */
  merge: MergeStatus;
  /** 停用 / 待补刻 / 已删除字模的失效落位 */
  invalidSlots: InvalidSlot[];
  /** 落位：把一枚可用字模放到指定格位 */
  place: (matrix: TypeMatrix, row: number, col: number) => void;
  /** 取出格位上的字模 */
  take: (row: number, col: number) => void;
  /** 调换两个格位（目标为空时视为移动） */
  swap: (a: RCCell, b: RCCell) => void;
  clear: () => void;
  replaceAll: (next: CaseSlot[]) => void;
  /** 冲突格逐格裁决：采用本次编辑 / 已存版本 / 清空 */
  decide: (key: string, choice: ConflictChoice) => void;
  /** 取出一枚失效落位（停用 / 缺损字模） */
  takeInvalid: (key: string) => void;
  /** 一次性取出全部失效落位 */
  takeAllInvalid: () => void;
  /** 保存到 IndexedDB（仍有冲突或失效落位时拒绝保存） */
  save: () => Promise<void>;
  /** 放弃未保存改动，回到最新落库版本 */
  revert: () => void;
}

export interface MergeStatus {
  /** 已存布局相对打开时的基线已被别的页面更新 */
  stale: boolean;
  /** 已自动并入、无需确认的格位数（只有一方动过） */
  autoMergedCount: number;
  /** 双方都动过且内容不同、尚未裁决的冲突 */
  unresolved: CellMergeConflict[];
  /** 已逐格裁决的数量 */
  resolvedCount: number;
  /** 是否还有冲突未确认（确认前不更新已保存布局） */
  hasUnresolvedConflict: boolean;
}

type DecisionMap = Record<string, ConflictChoice>;

/**
 * 字盘格位编辑：
 * - 打开页面后未被别人动过的落位 / 取出 / 调换照常入库；
 * - 同一格双方都动过列为冲突，逐格采用本次（mine）或已存（theirs）版本，确认前不保存；
 * - 字模停用 / 缺损 / 删除后，盘里的旧落位立即判失效，取出处理前不能保存；
 * - 基线、本地编辑与裁决写入 localStorage 编辑会话，关页再开可继续处理冲突。
 */
export function useCaseSlots(typeCase: TypeCase | undefined): CaseSlotsApi {
  const saveSlots = useCaseStore((s) => s.saveSlots);
  const matrices = useMatrixStore((s) => s.matrices);

  const [baseSlots, setBaseSlots] = useState<CaseSlot[]>(typeCase?.slots ?? []);
  const [baseVersion, setBaseVersion] = useState<string>(typeCase?.layoutVersion ?? '');
  const [localSlots, setLocalSlots] = useState<CaseSlot[]>(typeCase?.slots ?? []);
  const [decisions, setDecisions] = useState<DecisionMap>({});
  /** 失效字模 / 远程格位被强制取出的格位键（合规模块直接移除，不参与合并冲突） */
  const [manualTakes, setManualTakes] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [ready, setReady] = useState(false);
  const initIdRef = useRef<string>('');

  /* ---------- 会话初始化：仅在切换字盘时执行（落库版本变化只触发重算，不重置） ---------- */
  useEffect(() => {
    if (!typeCase || initIdRef.current === typeCase.id) return;
    initIdRef.current = typeCase.id;

    const session = loadCaseSession(typeCase.id);
    if (session && session.baseVersion) {
      // 关页再开：沿用原基线与本地编辑，继续处理冲突
      setBaseSlots(session.baseSlots);
      setBaseVersion(session.baseVersion);
      setLocalSlots(session.localSlots);
      setDecisions(session.decisions);
      setManualTakes(new Set());
      setReady(true);
      return;
    }

    // 兼容旧版布局草稿：有未落库的草稿时当作本次编辑迁入会话
    const legacy = readLegacyDraftSlots(typeCase.id, typeCase.slots);
    if (legacy) {
      removeLegacyDraft(typeCase.id);
      setBaseSlots(typeCase.slots);
      setBaseVersion(typeCase.layoutVersion);
      setLocalSlots(legacy);
      setDecisions({});
      setManualTakes(new Set());
      setReady(true);
      return;
    }

    setBaseSlots(typeCase.slots);
    setBaseVersion(typeCase.layoutVersion);
    setLocalSlots(typeCase.slots);
    setDecisions({});
    setManualTakes(new Set());
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeCase?.id]);

  /* ---------- 编辑会话持久化：关页再开仍能继续 ---------- */
  useEffect(() => {
    if (!typeCase || !ready) return;
    const localChanged = JSON.stringify(localSlots) !== JSON.stringify(baseSlots);
    const hasSessionData = localChanged || Object.keys(decisions).length > 0 || manualTakes.size > 0;
    if (!hasSessionData) {
      clearCaseSession(typeCase.id);
      return;
    }
    const session: CaseEditSession = {
      caseId: typeCase.id,
      baseVersion,
      baseSlots,
      localSlots,
      decisions,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    saveCaseSession(session);
  }, [ready, typeCase?.id, baseVersion, baseSlots, localSlots, decisions, manualTakes]);

  const rows = typeCase?.rows ?? 0;
  const cols = typeCase?.cols ?? 0;
  const persisted = typeCase?.slots ?? [];
  const stale = (typeCase?.layoutVersion ?? '') !== baseVersion;

  /* ---------- 三方合并：基线 / 本次编辑 / 已存（可能被别的页面更新） ---------- */
  const merge = useMemo(
    () => mergeLayouts(baseSlots, localSlots, persisted),
    [baseSlots, localSlots, persisted],
  );

  /** 未裁决冲突（裁决只对当前仍存在的冲突生效，过期裁决自然失效） */
  const unresolved = useMemo(
    () => merge.conflicts.filter((c) => !decisions[c.key]),
    [merge.conflicts, decisions],
  );
  const unresolvedKeys = useMemo(() => new Set(unresolved.map((c) => c.key)), [unresolved]);

  /** 应用逐格裁决后的落位；未裁决格暂不落任何内容（网格高亮待处理） */
  const resolvedSlots = useMemo(() => {
    const out: CaseSlot[] = [];
    for (const s of merge.slots) {
      if (!unresolvedKeys.has(rcKey(s.row, s.col))) out.push(s);
    }
    merge.conflicts.forEach((c) => {
      const choice = decisions[c.key];
      if (!choice) return;
      if (choice === 'mine' && c.mine) out.push(c.mine);
      else if (choice === 'theirs' && c.theirs) out.push(c.theirs);
      // choice === 'empty'：该格清空
    });
    out.sort((a, b) => a.row - b.row || a.col - b.col);
    return out;
  }, [merge, unresolvedKeys, decisions]);

  /** 强制取出（失效落位 / 远程格位取出）后的最终布局 */
  const slots = useMemo(
    () => (manualTakes.size ? removeSlots(resolvedSlots, manualTakes) : resolvedSlots),
    [resolvedSlots, manualTakes],
  );

  /* ---------- 字模可用性失效重算（停用 / 待补刻 / 删除） ---------- */
  const matrixById = useMemo(() => {
    const map = new Map<string, TypeMatrix>();
    matrices.forEach((m) => map.set(m.id, m));
    return map;
  }, [matrices]);

  const invalidSlots = useMemo(
    () => findInvalidSlots(slots, matrixById),
    [slots, matrixById],
  );

  const conflicts = useMemo(() => detectConflicts(rows, cols, slots), [rows, cols, slots]);
  const capacity = useMemo(() => validateCapacity(rows, cols, slots), [rows, cols, slots]);
  const fillPercent = useMemo(() => fillRate(slots, rows, cols), [slots, rows, cols]);
  const emptyCells = useMemo(() => emptySlots(rows, cols, slots), [rows, cols, slots]);

  const dirty = useMemo(
    () => JSON.stringify(slots) !== JSON.stringify(persisted),
    [slots, persisted],
  );

  const autoMergedCount = useMemo(() => {
    if (!stale) return 0;
    // 远程相对基线变化、但不属于双方冲突的格位即自动并入
    return merge.changedKeys.filter((k) => !merge.conflictKeys.includes(k)).length;
  }, [stale, merge]);

  const mergeStatus: MergeStatus = {
    stale,
    autoMergedCount,
    unresolved,
    resolvedCount: merge.conflicts.length - unresolved.length,
    hasUnresolvedConflict: unresolved.length > 0,
  };

  /* ---------- 最新计算结果的 ref（供异步保存 / 操作回调读取，避免闭包过期） ---------- */
  const slotsRef = useRef<CaseSlot[]>(slots);
  slotsRef.current = slots;
  const invalidSlotsRef = useRef<InvalidSlot[]>(invalidSlots);
  invalidSlotsRef.current = invalidSlots;
  const unresolvedRef = useRef<CellMergeConflict[]>(unresolved);
  unresolvedRef.current = unresolved;

  /* ---------- 编辑操作：先把涉及格位的当前合并结果「取到本地」再改 ---------- */
  /** 把若干格位当前已并入的内容提升进本地编辑，保证对远程格位 / 失效格的操作也能参与合并 */
  const promoteCells = useCallback((keys: string[]) => {
    setManualTakes((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set(prev);
      keys.forEach((k) => next.delete(k));
      return next;
    });
    setDecisions((cur) => {
      let changed = false;
      const next = { ...cur };
      keys.forEach((k) => {
        if (k in next) {
          delete next[k];
          changed = true;
        }
      });
      return changed ? next : cur;
    });
    setLocalSlots((cur) => {
      let next = cur;
      for (const key of keys) {
        const [r, c] = key.split('-').map(Number);
        const effective = slotAt(slotsRef.current, r, c);
        const existing = slotAt(next, r, c);
        if (effective && (!existing || existing.matrixId !== effective.matrixId)) {
          next = placeSlot(next, effective);
        }
      }
      return next;
    });
  }, []);

  const place = useCallback(
    (matrix: TypeMatrix, row: number, col: number) => {
      promoteCells([rcKey(row, col)]);
      const slot: CaseSlot = {
        row,
        col,
        character: matrix.character,
        matrixId: matrix.id,
        placedAt: new Date().toISOString(),
      };
      setLocalSlots((cur) => placeSlot(cur, slot));
    },
    [promoteCells],
  );

  const take = useCallback(
    (row: number, col: number) => {
      promoteCells([rcKey(row, col)]);
      setLocalSlots((cur) => removeSlot(cur, row, col));
    },
    [promoteCells],
  );

  const swap = useCallback(
    (a: RCCell, b: RCCell) => {
      promoteCells([rcKey(a.row, a.col), rcKey(b.row, b.col)]);
      setLocalSlots((cur) => swapSlots(cur, a, b));
    },
    [promoteCells],
  );

  const clear = useCallback(() => setLocalSlots([]), []);

  const replaceAll = useCallback((next: CaseSlot[]) => {
    setLocalSlots(next);
    setManualTakes(new Set());
  }, []);

  const decide = useCallback((key: string, choice: ConflictChoice) => {
    setDecisions((cur) => ({ ...cur, [key]: choice }));
  }, []);

  /* ---------- 失效落位处理：直接在合并结果上取出（合规性移除） ---------- */
  const takeInvalid = useCallback((key: string) => {
    setManualTakes((prev) => new Set(prev).add(key));
  }, []);

  const takeAllInvalid = useCallback(() => {
    setManualTakes((prev) => {
      const next = new Set(prev);
      invalidSlotsRef.current.forEach((s) => next.add(s.key));
      return next;
    });
  }, []);

  /** 放弃本地编辑：清会话，以最新落库版本为新基线 */
  const revert = useCallback(() => {
    if (!typeCase) return;
    clearCaseSession(typeCase.id);
    setBaseSlots(typeCase.slots);
    setBaseVersion(typeCase.layoutVersion);
    setLocalSlots(typeCase.slots);
    setDecisions({});
    setManualTakes(new Set());
  }, [typeCase]);

  const save = useCallback(async () => {
    if (!typeCase) return;
    if (unresolvedRef.current.length > 0) {
      throw new Error(`还有 ${unresolvedRef.current.length} 格双方改动冲突未确认，请逐格选择后再保存`);
    }
    if (invalidSlotsRef.current.length > 0) {
      throw new Error(
        `盘内还有 ${invalidSlotsRef.current.length} 格停用 / 缺损 / 已删除字模，请取出处理后再保存`,
      );
    }
    setSaving(true);
    try {
      // 已并入别人保存的版本后，以「最新落库版本」作为乐观并发的比对基线
      const expectedVersion = typeCase.layoutVersion;
      const saved = await saveSlots(typeCase.id, slotsRef.current, expectedVersion);
      // 保存成功：以新版本为基线重新开始，编辑会话清空
      clearCaseSession(typeCase.id);
      setBaseSlots(saved.slots);
      setBaseVersion(saved.layoutVersion);
      setLocalSlots(saved.slots);
      setDecisions({});
      setManualTakes(new Set());
    } catch (err) {
      if (err instanceof LayoutStaleError) {
        // 保存瞬间又被别的页面抢先：store 已更新落库版本，下一次渲染会自动重新三方合并
        throw new Error('保存瞬间字盘又被别的页面更新，已重新按格位合并，请确认新增冲突后再保存');
      }
      throw err;
    } finally {
      setSaving(false);
    }
  }, [saveSlots, typeCase]);

  return {
    slots,
    dirty,
    saving,
    conflicts,
    capacity,
    fillPercent,
    emptyCells,
    merge: mergeStatus,
    invalidSlots,
    place,
    take,
    swap,
    clear,
    replaceAll,
    decide,
    takeInvalid,
    takeAllInvalid,
    save,
    revert,
  };
}
