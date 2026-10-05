import type { CaseSlot } from '../../types/case';
import { rcKey, slotAt, type RCCell } from '../../utils/layout';

export interface LayoutGridProps {
  rows: number;
  cols: number;
  slots: CaseSlot[];
  /** 当前选中格位 */
  highlight?: RCCell | null;
  /** 需要额外高亮的格位（如某枚字模所在位置） */
  highlightKeys?: string[];
  /** 编辑内容自身冲突格位（重复落位 / 越界） */
  conflictKeys?: string[];
  /** 多页面合并时双方都改过、尚未取舍的冲突格位 */
  mergeConflictKeys?: string[];
  /** 落位字模已停用 / 缺损 / 缺失的失效格位 */
  invalidKeys?: string[];
  /** 待落位字符提示 */
  pendingCharacter?: string;
  readOnly?: boolean;
  onSlotClick?: (row: number, col: number) => void;
  testIdPrefix?: string;
}

const ROW_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/** 字盘行列网格：支持点击落位与调换，被字盘布局编辑器与字模详情页复用 */
export default function LayoutGrid({
  rows,
  cols,
  slots,
  highlight,
  highlightKeys = [],
  conflictKeys = [],
  mergeConflictKeys = [],
  invalidKeys = [],
  pendingCharacter = '',
  readOnly = false,
  onSlotClick,
  testIdPrefix = 'slot',
}: LayoutGridProps) {
  const highlightSet = new Set(highlightKeys);
  const conflictSet = new Set(conflictKeys);
  const mergeConflictSet = new Set(mergeConflictKeys);
  const invalidSet = new Set(invalidKeys);

  return (
    <div className="overflow-x-auto">
      <div className="inline-block min-w-full">
        <div
          className="grid gap-1"
          style={{ gridTemplateColumns: `28px repeat(${cols}, minmax(44px, 1fr))` }}
          data-testid="layout-grid"
          data-rows={rows}
          data-cols={cols}
        >
          <div className="flex h-7 items-center justify-center text-[10px] text-ink-mute">列</div>
          {Array.from({ length: cols }, (_, c) => (
            <div
              key={`h-${c}`}
              className="flex h-7 items-center justify-center font-song text-[11px] text-ink-mute"
            >
              {c + 1}
            </div>
          ))}

          {Array.from({ length: rows }, (_, r) => (
            <div key={`row-${r}`} className="contents">
              <div className="flex h-11 items-center justify-center font-song text-[11px] text-ink-mute">
                {ROW_LABELS[r] ?? r + 1}
              </div>
              {Array.from({ length: cols }, (_, c) => {
                const key = rcKey(r, c);
                const slot = slotAt(slots, r, c);
                const isSelected = highlight?.row === r && highlight?.col === c;
                const isHighlighted = highlightSet.has(key);
                const isConflict = conflictSet.has(key);
                const isMergeConflict = mergeConflictSet.has(key);
                const isInvalid = invalidSet.has(key);
                const canClick = !readOnly && Boolean(onSlotClick);
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={!canClick}
                    onClick={() => onSlotClick?.(r, c)}
                    title={`${ROW_LABELS[r] ?? r + 1}${c + 1} ${slot ? slot.character : '空格'}${
                      isInvalid ? '（字模已停用 / 缺损，需取出或替换）' : ''
                    }${isMergeConflict ? '（双方改动冲突，待取舍）' : ''}`}
                    data-testid={`${testIdPrefix}-${r}-${c}`}
                    data-filled={slot ? '1' : '0'}
                    className={`relative flex h-11 flex-col items-center justify-center rounded border text-center transition ${
                      slot ? 'border-ink/25 bg-white shadow-press' : 'border-dashed border-paper-line bg-paper/50'
                    } ${isSelected ? 'ring-2 ring-seal' : ''} ${
                      isHighlighted ? 'ring-2 ring-brass' : ''
                    } ${isConflict ? 'border-seal bg-seal-pale' : ''} ${
                      isMergeConflict ? 'ring-2 ring-brass bg-brass-pale' : ''
                    } ${isInvalid ? 'ring-2 ring-seal' : ''} ${
                      canClick ? 'cursor-pointer hover:border-seal' : 'cursor-default'
                    } ${pendingCharacter && !slot ? 'hover:bg-brass-pale' : ''}`}
                  >
                    {isInvalid ? (
                      <span
                        className="absolute right-0.5 top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-seal text-[8px] leading-none text-paper"
                        data-testid={`${testIdPrefix}-${r}-${c}-invalid`}
                      >
                        !
                      </span>
                    ) : null}
                    <span className="font-song text-lg leading-none text-ink">{slot?.character ?? ''}</span>
                    {slot ? (
                      <span className="mt-0.5 text-[9px] leading-none text-ink-mute">{slot.matrixId}</span>
                    ) : (
                      <span className="text-[9px] leading-none text-ink-mute/70">
                        {pendingCharacter || `${r + 1}·${c + 1}`}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
