import type { CaseSlot } from '../types/case';

/**
 * 字盘编辑会话（localStorage）：
 * 排字师傅打开字盘页面时的基线布局、未保存的本地落位 / 取出 / 调换，
 * 以及逐格冲突的裁决结果都落在会话里。关页再开（甚至刷新）后，
 * 仍能基于原基线与最新落库版本重新三方合并、继续处理冲突。
 *
 * 保存成功或撤回落库版本后清掉会话。
 */

const PREFIX = 'gbmovabletype-case-session:';
/** 旧版「布局草稿」键，升级后首次打开时把其中的 slots 当作本地编辑迁入会话 */
const LEGACY_DRAFT_PREFIX = 'gbmovabletype-draft:case-';

export interface CaseEditSession {
  caseId: string;
  /** 打开页面时所依据的已存布局版本令牌 */
  baseVersion: string;
  /** 基线布局（baseVersion 对应的 slots），用于三方合并 */
  baseSlots: CaseSlot[];
  /** 本次编辑（未保存）的布局 */
  localSlots: CaseSlot[];
  /** 冲突格逐格裁决：本次编辑 / 已存版本 / 清空 */
  decisions: Record<string, 'mine' | 'theirs' | 'empty'>;
  /** 会话创建 / 最近写入时间（ISO） */
  startedAt: string;
  updatedAt: string;
}

function storageKey(caseId: string): string {
  return `${PREFIX}${caseId}`;
}

/** 读出该字盘未结束的编辑会话；没有或解析失败返回 null */
export function loadCaseSession(caseId: string): CaseEditSession | null {
  try {
    const raw = localStorage.getItem(storageKey(caseId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CaseEditSession>;
    if (!parsed || parsed.caseId !== caseId || !hasSlotArrays(parsed)) return null;
    return {
      caseId,
      baseVersion: parsed.baseVersion ?? '',
      baseSlots: parsed.baseSlots ?? [],
      localSlots: parsed.localSlots ?? parsed.baseSlots ?? [],
      decisions: parsed.decisions ?? {},
      startedAt: parsed.startedAt ?? new Date().toISOString(),
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function hasSlotArrays(parsed: Partial<CaseEditSession>): boolean {
  return Array.isArray(parsed.baseSlots) && Array.isArray(parsed.localSlots);
}

/** 写入 / 更新编辑会话 */
export function saveCaseSession(session: CaseEditSession): void {
  try {
    localStorage.setItem(storageKey(session.caseId), JSON.stringify({ ...session, updatedAt: new Date().toISOString() }));
  } catch {
    /* 存储不可用时静默降级为纯内存会话（关页才会丢失） */
  }
}

/** 清除编辑会话（保存成功或撤回后） */
export function clearCaseSession(caseId: string): void {
  try {
    localStorage.removeItem(storageKey(caseId));
  } catch {
    /* 忽略 */
  }
}

/**
 * 兼容旧版布局草稿（gbmovabletype-draft:case-<id> 中只存 slots）：
 * 升级后首次打开时，若还没有会话而存在与落库不同的草稿，把草稿当成本次编辑迁入。
 * 返回本地编辑 slots；无旧草稿或与落库一致时返回 null。
 */
export function readLegacyDraftSlots(caseId: string, persistedSlots: CaseSlot[]): CaseSlot[] | null {
  try {
    const raw = localStorage.getItem(`${LEGACY_DRAFT_PREFIX}${caseId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { slots?: CaseSlot[] };
    const slots = parsed?.slots;
    if (!Array.isArray(slots)) return null;
    if (JSON.stringify(slots) === JSON.stringify(persistedSlots)) return null;
    return slots as CaseSlot[];
  } catch {
    return null;
  }
}

/** 迁移完成后删除旧草稿，避免重复提示 */
export function removeLegacyDraft(caseId: string): void {
  try {
    localStorage.removeItem(`${LEGACY_DRAFT_PREFIX}${caseId}`);
  } catch {
    /* 忽略 */
  }
}
