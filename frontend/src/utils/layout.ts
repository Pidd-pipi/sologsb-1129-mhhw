import type { CaseSlot } from '../types/case';
import { capacityOf } from '../types/case';

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

/* ------------------------------------------------------------------ */
/* 按格位三方合并（base 为打开页面时的布局，mine 为本次编辑，theirs 为别人后保存的布局） */
/* ------------------------------------------------------------------ */

/** 空格位的统一标记，空格与空格视为相同内容 */
export const EMPTY_CELL = '__empty__';

/** 格位内容签名：同一枚字模即同一内容（落位时间变化不视为内容变化） */
export function slotSignature(slot: CaseSlot | undefined): string {
  return slot ? slot.matrixId || `${EMPTY_CELL}:${slot.character}` : EMPTY_CELL;
}

function slotsToMap(slots: CaseSlot[]): Map<string, CaseSlot> {
  const map = new Map<string, CaseSlot>();
  for (const s of slots) map.set(rcKey(s.row, s.col), s);
  return map;
}

export interface CellMergeConflict {
  /** 格位键 `行-列` */
  key: string;
  row: number;
  col: number;
  /** 本次编辑版本的落位（取出为 undefined） */
  mine: CaseSlot | undefined;
  /** 已存（别人）版本的落位（取出为 undefined） */
  theirs: CaseSlot | undefined;
}

export interface MergeResult {
  /** 自动合并后的落位；冲突格位先以「本次编辑」占位，等待逐格裁决 */
  slots: CaseSlot[];
  /** 同一格双方都动过且内容不同，需逐格确认 */
  conflicts: CellMergeConflict[];
  /** 冲突格位键集合 */
  conflictKeys: string[];
  /** 相对基线发生变化的格位键（无论由谁改动） */
  changedKeys: string[];
  /** 是否存在相对基线的变化 */
  hasChanges: boolean;
}

/**
 * 按格位三方合并：
 * - 只有一方动过：落位 / 取出 / 调换照常并入；
 * - 双方都没动：保持基线；
 * - 同一格双方都动过且改成不同内容：列为冲突，确认前不写入已保存布局。
 */
export function mergeLayouts(base: CaseSlot[], mine: CaseSlot[], theirs: CaseSlot[]): MergeResult {
  const baseMap = slotsToMap(base);
  const mineMap = slotsToMap(mine);
  const theirsMap = slotsToMap(theirs);

  const keys = new Set<string>([...baseMap.keys(), ...mineMap.keys(), ...theirsMap.keys()]);
  const merged: CaseSlot[] = [];
  const conflicts: CellMergeConflict[] = [];
  const changedKeys: string[] = [];

  keys.forEach((key) => {
    const b = baseMap.get(key);
    const m = mineMap.get(key);
    const t = theirsMap.get(key);
    const mineChanged = slotSignature(m) !== slotSignature(b);
    const theirsChanged = slotSignature(t) !== slotSignature(b);

    if (mineChanged && theirsChanged && slotSignature(m) !== slotSignature(t)) {
      conflicts.push({ key, row: m?.row ?? t?.row ?? 0, col: m?.col ?? t?.col ?? 0, mine: m, theirs: t });
      changedKeys.push(key);
      // 冲突格先呈现本次编辑版本，最终值由逐格裁决覆盖
      if (m) merged.push(m);
      return;
    }

    // 任一方改动（含双方改成相同内容）即采用改动值；都没动则保持基线
    const winner = theirsChanged ? t : mineChanged ? m : b;
    if (slotSignature(winner) !== slotSignature(b)) changedKeys.push(key);
    if (winner) merged.push(winner);
  });

  merged.sort((a, b) => a.row - b.row || a.col - b.col);
  return {
    slots: merged,
    conflicts,
    conflictKeys: conflicts.map((c) => c.key),
    changedKeys,
    hasChanges: changedKeys.length > 0,
  };
}

/** 冲突格的逐格裁决选择：采用本次编辑 / 采用已存版本 / 取出清空 */
export type ConflictChoice = 'mine' | 'theirs' | 'empty';

/** 取出若干格位后返回新数组（批量处理失效落位用） */
export function removeSlots(slots: CaseSlot[], keys: Iterable<string>): CaseSlot[] {
  const keySet = new Set(keys);
  return slots.filter((s) => !keySet.has(rcKey(s.row, s.col)));
}

/* ------------------------------------------------------------------ */
/* 字模可用性失效：停用 / 待补刻 / 已删除的字模，盘里的旧落位不可再当可用 */
/* ------------------------------------------------------------------ */

export interface InvalidSlot {
  key: string;
  row: number;
  col: number;
  slot: CaseSlot;
  /** 失效原因：停用 / 待补刻 / 字模已删除 */
  reason: string;
}

/**
 * 重算布局中的失效落位：所引用字模不是「可用」（含查无此模的删除情况）即失效。
 * 字模可用性变化后据此立即重算，处理完前不允许保存。
 */
export function findInvalidSlots(
  slots: CaseSlot[],
  matrixById: Map<string, { availability: string }>,
): InvalidSlot[] {
  const out: InvalidSlot[] = [];
  for (const s of slots) {
    const matrix = matrixById.get(s.matrixId);
    if (!matrix) {
      out.push({ key: rcKey(s.row, s.col), row: s.row, col: s.col, slot: s, reason: '字模档案已删除' });
    } else if (matrix.availability !== '可用') {
      out.push({
        key: rcKey(s.row, s.col),
        row: s.row,
        col: s.col,
        slot: s,
        reason: `字模已${matrix.availability}`,
      });
    }
  }
  return out;
}
