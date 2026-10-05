import type { CaseSlot } from '../types/case';
import { capacityOf } from '../types/case';
import type { MatrixAvailability, TypeMatrix } from '../types/matrix';

/** 行列号与格位索引互算、字盘容量校验与冲突检测 */

export interface RCCell {
  row: number;
  col: number;
}

/** 格位键：`行-列`（0 基） */
export function rcKey(row: number, col: number): string {
  return `${row}-${col}`;
}

/** 解析格位键，非法返回 null */
export function parseRcKey(key: string): RCCell | null {
  const [r, c] = key.split('-');
  const row = Number(r);
  const col = Number(c);
  if (!Number.isInteger(row) || !Number.isInteger(col)) return null;
  return { row, col };
}

/** 二维行列 → 一维格位索引（0 基） */
export function slotIndex(row: number, col: number, cols: number): number {
  return row * cols + col;
}

/** 一维格位索引 → 行列 */
export function indexToRC(index: number, cols: number): RCCell {
  return { row: Math.floor(index / cols), col: index % cols };
}

/** 是否落在字盘边界内 */
export function isWithinBounds(row: number, col: number, rows: number, cols: number): boolean {
  return row >= 0 && col >= 0 && row < rows && col < cols;
}

/** 全部格位（按行优先展开） */
export function allPositions(rows: number, cols: number): RCCell[] {
  const out: RCCell[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) out.push({ row: r, col: c });
  }
  return out;
}

/** 已占用格位键集合 */
export function occupiedKeys(slots: CaseSlot[]): Set<string> {
  return new Set(slots.map((s) => rcKey(s.row, s.col)));
}

/** 空格位清单 */
export function emptySlots(rows: number, cols: number, slots: CaseSlot[]): RCCell[] {
  const used = occupiedKeys(slots);
  return allPositions(rows, cols).filter((p) => !used.has(rcKey(p.row, p.col)));
}

/** 取指定格位的落位 */
export function slotAt(slots: CaseSlot[], row: number, col: number): CaseSlot | undefined {
  return slots.find((s) => s.row === row && s.col === col);
}

export interface DuplicateGroup {
  character: string;
  count: number;
  keys: string[];
}

export interface SlotConflicts {
  /** 同一字符重复落位的分组 */
  duplicateCharacters: DuplicateGroup[];
  /** 同一格位出现多条落位记录 */
  duplicatePositions: string[];
  /** 越界格位 */
  outOfRange: string[];
  hasConflict: boolean;
}

/** 冲突检测：重复落位、同格位重复、越界 */
export function detectConflicts(rows: number, cols: number, slots: CaseSlot[]): SlotConflicts {
  const byChar = new Map<string, string[]>();
  const byKey = new Map<string, number>();
  const outOfRange: string[] = [];
  for (const s of slots) {
    const key = rcKey(s.row, s.col);
    byKey.set(key, (byKey.get(key) ?? 0) + 1);
    if (!isWithinBounds(s.row, s.col, rows, cols)) outOfRange.push(key);
    const arr = byChar.get(s.character) ?? [];
    arr.push(key);
    byChar.set(s.character, arr);
  }
  const duplicateCharacters: DuplicateGroup[] = [];
  byChar.forEach((keys, character) => {
    if (keys.length > 1) duplicateCharacters.push({ character, count: keys.length, keys });
  });
  const duplicatePositions = Array.from(byKey.entries())
    .filter(([, n]) => n > 1)
    .map(([k]) => k);
  return {
    duplicateCharacters,
    duplicatePositions,
    outOfRange,
    hasConflict: duplicateCharacters.length > 0 || duplicatePositions.length > 0 || outOfRange.length > 0,
  };
}

/** 容量校验：行 / 列合法性与可用格位数 */
export function validateCapacity(
  rows: number,
  cols: number,
  slots: CaseSlot[],
): { capacity: number; filled: number; empty: number; overCapacity: boolean; message: string } {
  const capacity = capacityOf(rows, cols);
  const filled = slots.length;
  const empty = Math.max(0, capacity - filled);
  const overCapacity = filled > capacity;
  const message = overCapacity
    ? `落位 ${filled} 格已超出字盘容量 ${capacity} 格，请先取出多余字模`
    : `已落位 ${filled} / ${capacity} 格，空余 ${empty} 格`;
  return { capacity, filled, empty, overCapacity, message };
}

/** 落位（同格位覆盖）；返回新的 slots 数组，不修改入参 */
export function placeSlot(slots: CaseSlot[], slot: CaseSlot): CaseSlot[] {
  const rest = slots.filter((s) => !(s.row === slot.row && s.col === slot.col));
  return [...rest, slot].sort((a, b) => a.row - b.row || a.col - b.col);
}

/** 取出格位上的字模 */
export function removeSlot(slots: CaseSlot[], row: number, col: number): CaseSlot[] {
  return slots.filter((s) => !(s.row === row && s.col === col));
}

/** 调换两格内容：目标为空则视为移动 */
export function swapSlots(slots: CaseSlot[], a: RCCell, b: RCCell): CaseSlot[] {
  const sa = slotAt(slots, a.row, a.col);
  const sb = slotAt(slots, b.row, b.col);
  if (!sa && !sb) return slots;
  let next = removeSlot(removeSlot(slots, a.row, a.col), b.row, b.col);
  if (sa) next = placeSlot(next, { ...sa, row: b.row, col: b.col });
  if (sb) next = placeSlot(next, { ...sb, row: a.row, col: a.col });
  return next;
}

/** 已落位字模 id 列表（去重，用于写入字盘的多值索引） */
export function matrixIdsOf(slots: CaseSlot[]): string[] {
  return Array.from(new Set(slots.map((s) => s.matrixId).filter(Boolean)));
}

/** 落位率百分比（一位小数） */
export function fillRate(slots: CaseSlot[], rows: number, cols: number): number {
  const capacity = capacityOf(rows, cols);
  if (!capacity) return 0;
  return Math.round((slots.length / capacity) * 1000) / 10;
}

/** 找出某字模在字盘中的格位 */
export function findSlotsByMatrix(slots: CaseSlot[], matrixId: string): CaseSlot[] {
  return slots.filter((s) => s.matrixId === matrixId);
}

/** 格位归属：本次（本地编辑）或已存（落库版本） */
export type SlotSide = 'local' | 'saved';

/** 按格位三向合并时的冲突单元：同一格位双方都改过且改法不一致 */
export interface MergeConflict {
  key: string;
  base: CaseSlot | null;
  saved: CaseSlot | null;
  local: CaseSlot | null;
}

export interface SlotMergeResult {
  /** 合并后的格位布局（冲突格位在未决议前不落盘） */
  merged: CaseSlot[];
  /** 未决议的冲突格位 */
  conflicts: MergeConflict[];
  /** 仅对方页面改过、已自动并入的格位键 */
  autoMergedSaved: string[];
  /** 仅本次编辑改过的格位键 */
  localOnly: string[];
}

/** 格位取值：以字模 id 代表格位内容（空格为 null） */
function cellValue(slot: CaseSlot | null | undefined): string | null {
  return slot ? slot.matrixId : null;
}

/**
 * 按格位三向合并：以打开页面时的快照（base）为基准，
 * 合并本机已存版本（saved）与本次未保存编辑（local）。
 *
 * 规则（逐格）：
 * - 本次未动（local == base）→ 从已存；
 * - 已存未动（saved == base）→ 从本次；
 * - 双方改成一致 → 从该结果；
 * - 双方都动过且不一致 → 冲突，按 resolutions 逐格取舍，未取舍则挂起。
 */
export function mergeSlots(
  base: CaseSlot[],
  saved: CaseSlot[],
  local: CaseSlot[],
  resolutions: Record<string, SlotSide> = {},
): SlotMergeResult {
  const baseMap = new Map(base.map((s) => [rcKey(s.row, s.col), s]));
  const savedMap = new Map(saved.map((s) => [rcKey(s.row, s.col), s]));
  const localMap = new Map(local.map((s) => [rcKey(s.row, s.col), s]));
  const keys = new Set([...baseMap.keys(), ...savedMap.keys(), ...localMap.keys()]);
  const merged: CaseSlot[] = [];
  const conflicts: MergeConflict[] = [];
  const autoMergedSaved: string[] = [];
  const localOnly: string[] = [];

  for (const key of keys) {
    const b = baseMap.get(key) ?? null;
    const sv = savedMap.get(key) ?? null;
    const lv = localMap.get(key) ?? null;
    const bv = cellValue(b);
    const svv = cellValue(sv);
    const lvv = cellValue(lv);

    let chosen: CaseSlot | null = null;
    if (lvv === bv) {
      // 本次未动：一律从已存（对方的落位 / 取出 / 调换照常入库）
      chosen = sv;
      if (svv !== bv) autoMergedSaved.push(key);
    } else if (svv === bv) {
      // 已存未动：从本次
      chosen = lv;
      localOnly.push(key);
    } else if (lvv === svv) {
      // 双方改成一致
      chosen = lv;
    } else {
      const side = resolutions[key];
      if (side === 'saved') chosen = sv;
      else if (side === 'local') chosen = lv;
      else {
        conflicts.push({ key, base: b, saved: sv, local: lv });
        continue;
      }
    }
    if (chosen) merged.push(chosen);
  }

  merged.sort((a, b) => a.row - b.row || a.col - b.col);
  return { merged, conflicts, autoMergedSaved, localOnly };
}

/** 格位失效原因：字模档案缺失，或可用性已变为停用 / 待补刻 */
export type InvalidSlotReason = 'missing' | 'unavailable';

export interface InvalidSlot {
  key: string;
  row: number;
  col: number;
  matrixId: string;
  character: string;
  reason: InvalidSlotReason;
  availability: MatrixAvailability | null;
}

/**
 * 失效格位检测：盘里落位的字模若已被删除，或可用性不再是「可用」
 * （停用 / 待补刻），该格位即失效，保存前必须取出或替换。
 */
export function findInvalidSlots(slots: CaseSlot[], matrices: TypeMatrix[]): InvalidSlot[] {
  const byId = new Map(matrices.map((m) => [m.id, m]));
  const out: InvalidSlot[] = [];
  for (const s of slots) {
    const m = byId.get(s.matrixId);
    if (!m) {
      out.push({ key: rcKey(s.row, s.col), row: s.row, col: s.col, matrixId: s.matrixId, character: s.character, reason: 'missing', availability: null });
    } else if (m.availability !== '可用') {
      out.push({
        key: rcKey(s.row, s.col),
        row: s.row,
        col: s.col,
        matrixId: s.matrixId,
        character: s.character,
        reason: 'unavailable',
        availability: m.availability,
      });
    }
  }
  return out;
}
