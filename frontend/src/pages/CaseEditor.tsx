import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import CharacterPicker from '../components/common/CharacterPicker';
import EmptyState from '../components/common/EmptyState';
import LayoutGrid from '../components/common/LayoutGrid';
import { useCaseSlots } from '../hooks/useCaseSlots';
import { useMatrixSearch } from '../hooks/useMatrixSearch';
import { useCaseStore } from '../stores/caseStore';
import { useMatrixStore } from '../stores/matrixStore';
import { useUiStore } from '../stores/uiStore';
import type { CaseKind, TypeCase } from '../types/case';
import { CASE_KINDS, COL_RANGE, ROW_RANGE, describeCapacity, validateCaseInput } from '../types/case';
import type { TypeMatrix } from '../types/matrix';
import { suggestCaseCode } from '../utils/format';
import { findInvalidSlots, rcKey, slotAt, type RCCell } from '../utils/layout';

/** 字盘列表 + 新建字盘 */
export default function CaseEditor() {
  const cases = useCaseStore((s) => s.cases);
  const loaded = useCaseStore((s) => s.loaded);
  const createCase = useCaseStore((s) => s.createCase);
  const matrices = useMatrixStore((s) => s.matrices);
  const selectedCaseId = useUiStore((s) => s.selectedCaseId);
  const setSelectedCaseId = useUiStore((s) => s.setSelectedCaseId);
  const pushToast = useUiStore((s) => s.pushToast);

  const [form, setForm] = useState({
    code: '',
    kind: '常用字盘' as CaseKind,
    rows: '6',
    cols: '8',
    workStation: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const selected = useMemo(
    () => cases.find((c) => c.id === selectedCaseId) ?? cases[0],
    [cases, selectedCaseId],
  );

  /** 各字盘已存布局中引用停用 / 缺损字模的格位数（清单角标） */
  const invalidCountByCase = useMemo(() => {
    const out = new Map<string, number>();
    for (const c of cases) {
      const n = findInvalidSlots(c.slots, matrices).length;
      if (n) out.set(c.id, n);
    }
    return out;
  }, [cases, matrices]);

  useEffect(() => {
    if (!selectedCaseId && cases.length > 0) setSelectedCaseId(cases[0].id);
  }, [cases, selectedCaseId, setSelectedCaseId]);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    const input = {
      code: form.code,
      kind: form.kind,
      rows: Number(form.rows),
      cols: Number(form.cols),
      workStation: form.workStation,
    };
    const next = validateCaseInput(input);
    setErrors(next);
    if (Object.keys(next).length > 0) {
      pushToast('字盘信息未通过校验，请按提示修正', 'warn');
      return;
    }
    try {
      const row = await createCase(input);
      setSelectedCaseId(row.id);
      setForm({ ...form, code: '', workStation: '' });
      setErrors({});
      pushToast(`已新建字盘 ${row.code}（${describeCapacity(row.rows, row.cols)}）`);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : '新建字盘失败', 'error');
    }
  };

  return (
    <div className="space-y-4">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="mt-title" data-testid="case-editor-title">
            字盘布局编辑器
          </h2>
          <p className="mt-sub">
            选中字盘后以行列网格呈现，点击格位落位、取出或调换；多页面按格位合并保存，冲突逐格取舍。
          </p>
        </div>
        <span className="mt-chip" data-testid="case-count">
          字盘 {cases.length} 个
        </span>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[260px_1fr]">
        <aside className="space-y-3">
          <div className="mt-panel">
            <div className="mt-panel-head">
              <h3 className="font-song text-sm font-semibold text-ink">字盘清单</h3>
            </div>
            <ul className="divide-y divide-paper-line" data-testid="case-list">
              {cases.length === 0 ? (
                <li className="px-4 py-3 text-xs text-ink-mute">
                  {loaded ? '暂无字盘，请在下方新建。' : '正在读取字盘档案…'}
                </li>
              ) : (
                cases.map((c) => {
                  const invalidCount = invalidCountByCase.get(c.id) ?? 0;
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        data-testid={`case-item-${c.id}`}
                        onClick={() => setSelectedCaseId(c.id)}
                        className={`flex w-full flex-col items-start gap-0.5 px-4 py-2 text-left transition hover:bg-paper-deep/60 ${
                          selected?.id === c.id ? 'bg-seal-pale/70' : ''
                        }`}
                      >
                        <span className="font-song text-sm text-ink">
                          {c.code}
                          <span className="ml-2 text-[11px] text-ink-mute">{c.kind}</span>
                          <span className="ml-2 text-[10px] text-ink-mute">v{c.layoutVersion ?? 1}</span>
                          {invalidCount > 0 ? (
                            <span
                              className="ml-2 rounded-full bg-seal px-1.5 py-0.5 text-[10px] text-paper"
                              data-testid={`case-invalid-badge-${c.id}`}
                            >
                              {invalidCount} 格停用
                            </span>
                          ) : null}
                        </span>
                        <span className="text-[11px] text-ink-mute">
                          {describeCapacity(c.rows, c.cols)} · 已落位 {c.slots.length} · {c.workStation}
                        </span>
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </div>

          <form className="mt-panel space-y-3 px-4 py-3" onSubmit={handleCreate} data-testid="case-create-form">
            <h3 className="font-song text-sm font-semibold text-ink">新建字盘</h3>
            <div>
              <label className="mt-label" htmlFor="case-code-input">
                字盘编号
              </label>
              <input
                id="case-code-input"
                data-testid="case-code-input"
                className="mt-input"
                placeholder={suggestCaseCode(cases.length + 1)}
                value={form.code}
                onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))}
              />
              {errors.code ? <p className="mt-error" data-testid="error-case-code">{errors.code}</p> : null}
            </div>
            <div>
              <label className="mt-label" htmlFor="case-kind-select">
                类型
              </label>
              <select
                id="case-kind-select"
                data-testid="case-kind-select"
                className="mt-input"
                value={form.kind}
                onChange={(e) => setForm((p) => ({ ...p, kind: e.target.value as CaseKind }))}
              >
                {CASE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mt-label" htmlFor="case-rows-input">
                  行数
                </label>
                <input
                  id="case-rows-input"
                  data-testid="case-rows-input"
                  className="mt-input"
                  type="number"
                  min={ROW_RANGE.min}
                  max={ROW_RANGE.max}
                  step={1}
                  value={form.rows}
                  onChange={(e) => setForm((p) => ({ ...p, rows: e.target.value }))}
                />
                {errors.rows ? <p className="mt-error">{errors.rows}</p> : null}
              </div>
              <div>
                <label className="mt-label" htmlFor="case-cols-input">
                  列数
                </label>
                <input
                  id="case-cols-input"
                  data-testid="case-cols-input"
                  className="mt-input"
                  type="number"
                  min={COL_RANGE.min}
                  max={COL_RANGE.max}
                  step={1}
                  value={form.cols}
                  onChange={(e) => setForm((p) => ({ ...p, cols: e.target.value }))}
                />
                {errors.cols ? <p className="mt-error">{errors.cols}</p> : null}
              </div>
            </div>
            <div>
              <label className="mt-label" htmlFor="case-station-input">
                所在工位
              </label>
              <input
                id="case-station-input"
                data-testid="case-station-input"
                className="mt-input"
                placeholder="例：三号排字工位"
                value={form.workStation}
                onChange={(e) => setForm((p) => ({ ...p, workStation: e.target.value }))}
              />
              {errors.workStation ? <p className="mt-error">{errors.workStation}</p> : null}
            </div>
            <button type="submit" className="mt-btn mt-btn-primary" data-testid="create-case-btn">
              新建字盘
            </button>
            <p className="mt-hint">
              容量：{describeCapacity(Number(form.rows) || 0, Number(form.cols) || 0)}
            </p>
          </form>
        </aside>

        {selected ? (
          <CaseLayoutEditor key={selected.id} typeCase={selected} />
        ) : (
          <EmptyState
            title="尚未选择字盘"
            description="在左侧清单中选择一个字盘，或先新建一个字盘后再编辑格位布局。"
            testId="case-empty"
          />
        )}
      </div>
    </div>
  );
}

interface PendingPlacement {
  matrix: TypeMatrix;
}

function CaseLayoutEditor({ typeCase }: { typeCase: TypeCase }) {
  const pushToast = useUiStore((s) => s.pushToast);
  const api = useCaseSlots(typeCase);
  const { results: candidateMatrices } = useMatrixSearch({ availability: ['可用'], ignoreKeyword: true });
  const [pickedChar, setPickedChar] = useState('');
  const [pending, setPending] = useState<PendingPlacement | null>(null);
  const [selectedKey, setSelectedKey] = useState('');
  const [swapFrom, setSwapFrom] = useState<RCCell | null>(null);

  const charCandidates = useMemo(
    () => (pickedChar ? candidateMatrices.filter((m) => m.character === pickedChar) : []),
    [candidateMatrices, pickedChar],
  );

  const selectedCell = selectedKey ? (parseKey(selectedKey) as RCCell) : null;
  const selectedSlot = selectedCell ? slotAt(api.slots, selectedCell.row, selectedCell.col) : undefined;

  const localConflictKeys = useMemo(
    () => [
      ...api.conflicts.duplicatePositions,
      ...api.conflicts.outOfRange,
      ...api.conflicts.duplicateCharacters.flatMap((g) => g.keys),
    ],
    [api.conflicts],
  );

  const invalidKeys = useMemo(
    () => api.invalidSlots.map((inv) => inv.key),
    [api.invalidSlots],
  );

  const unresolvedConflicts = api.merge.conflicts;
  const canSave =
    !api.saving && unresolvedConflicts.length === 0 && api.invalidSlots.length === 0;

  const handleSlotClick = (row: number, col: number) => {
    const key = rcKey(row, col);
    setSelectedKey(key);
    if (pending) {
      api.place(pending.matrix, row, col);
      pushToast(
        `已在 ${rowLabel(row)}${col + 1} 落位「${pending.matrix.character}」（${pending.matrix.code}）`,
      );
      return;
    }
    if (swapFrom) {
      if (swapFrom.row === row && swapFrom.col === col) {
        setSwapFrom(null);
        return;
      }
      api.swap(swapFrom, { row, col });
      setSwapFrom(null);
      pushToast(`已调换 ${rowLabel(swapFrom.row)}${swapFrom.col + 1} 与 ${rowLabel(row)}${col + 1}`);
      return;
    }
    if (slotAt(api.slots, row, col)) {
      setSwapFrom({ row, col });
    }
  };

  const handleSave = async () => {
    const res = await api.save();
    if (res.ok) {
      pushToast(`字盘 ${typeCase.code} 布局已保存（v${res.layoutVersion}，${api.slots.length} 格）`);
    } else {
      pushToast(res.message ?? '保存失败', 'error');
    }
  };

  return (
    <section className="space-y-3">
      <div className="mt-panel">
        <div className="mt-panel-head">
          <div>
            <h3 className="font-song text-sm font-semibold text-ink">
              {typeCase.code} · {typeCase.kind}
              <span className="ml-2 text-[11px] font-normal text-ink-mute">
                v{typeCase.layoutVersion ?? 1}
              </span>
            </h3>
            <p className="mt-sub">
              {describeCapacity(typeCase.rows, typeCase.cols)} · 工位 {typeCase.workStation} · 落位率{' '}
              {api.fillPercent}%
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="mt-btn mt-btn-primary"
              data-testid="save-layout-btn"
              onClick={handleSave}
              disabled={!canSave}
              title={
                unresolvedConflicts.length > 0
                  ? '请先逐格处理合并冲突'
                  : api.invalidSlots.length > 0
                    ? '请先取出或替换停用 / 缺损字模'
                    : undefined
              }
            >
              {api.saving
                ? '保存中…'
                : unresolvedConflicts.length > 0
                  ? `保存布局（${unresolvedConflicts.length} 格冲突待处理）`
                  : api.invalidSlots.length > 0
                    ? `保存布局（${api.invalidSlots.length} 格失效待处理）`
                    : api.dirty
                      ? '保存布局（有改动）'
                      : '保存布局'}
            </button>
            <button
              type="button"
              className="mt-btn"
              data-testid="revert-layout-btn"
              onClick={api.revert}
              disabled={!api.dirty}
            >
              撤回到打开时
            </button>
            <button
              type="button"
              className="mt-btn"
              data-testid="clear-grid-btn"
              onClick={() => {
                api.clear();
                pushToast('已清空当前格位（尚未保存）', 'warn');
              }}
            >
              清空格位
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 px-4 py-3 lg:grid-cols-[1fr_300px]">
          <div className="space-y-2">
            {/* 合并冲突：双方页面都改过的格位，须逐格取舍后才写入已保存布局 */}
            {unresolvedConflicts.length > 0 ? (
              <div
                className="rounded border border-brass/60 bg-brass-pale/70 px-3 py-2"
                data-testid="merge-conflict-panel"
              >
                <p className="text-xs font-semibold text-brass">
                  {unresolvedConflicts.length} 格与另一页面的改动冲突，请逐格确认采用哪一版，确认前不更新已保存布局。
                </p>
                <ul className="mt-1 space-y-1">
                  {unresolvedConflicts.map((c) => {
                    const cell = parseKey(c.key);
                    return (
                      <li
                        key={c.key}
                        className="flex flex-wrap items-center gap-2 text-[11px] text-ink-soft"
                        data-testid={`merge-conflict-${c.key}`}
                      >
                        <span className="font-song font-semibold">
                          {cell ? rowLabel(cell.row) : ''}
                          {cell ? cell.col + 1 : c.key}
                        </span>
                        <span>本次：{c.local ? `${c.local.character}（${c.local.matrixId}）` : '空'}</span>
                        <span>
                          已存：{c.saved ? `${c.saved.character}（${c.saved.matrixId}）` : '空'}
                        </span>
                        <button
                          type="button"
                          className="rounded border border-brass bg-white px-1.5 py-0.5 hover:bg-brass-pale"
                          data-testid={`conflict-local-${c.key}`}
                          onClick={() => api.resolveConflict(c.key, 'local')}
                        >
                          采用本次
                        </button>
                        <button
                          type="button"
                          className="rounded border border-brass bg-white px-1.5 py-0.5 hover:bg-brass-pale"
                          data-testid={`conflict-saved-${c.key}`}
                          onClick={() => api.resolveConflict(c.key, 'saved')}
                        >
                          采用已存
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    className="rounded border border-brass bg-white px-2 py-0.5 text-[11px] hover:bg-brass-pale"
                    data-testid="conflict-all-local"
                    onClick={() => api.resolveAll('local')}
                  >
                    全部采用本次
                  </button>
                  <button
                    type="button"
                    className="rounded border border-brass bg-white px-2 py-0.5 text-[11px] hover:bg-brass-pale"
                    data-testid="conflict-all-saved"
                    onClick={() => api.resolveAll('saved')}
                  >
                    全部采用已存
                  </button>
                </div>
              </div>
            ) : null}

            {/* 失效格位：字模已停用 / 待补刻 / 档案缺失，保存前必须取出或替换 */}
            {api.invalidSlots.length > 0 ? (
              <div
                className="rounded border border-seal/50 bg-seal-pale/70 px-3 py-2"
                data-testid="invalid-slots-panel"
              >
                <p className="text-xs font-semibold text-seal">
                  {api.invalidSlots.length} 格字模已停用或缺损，旧编辑已失效重算，请取出或替换后再保存。
                </p>
                <ul className="mt-1 space-y-1">
                  {api.invalidSlots.map((inv) => (
                    <li
                      key={inv.key}
                      className="flex flex-wrap items-center gap-2 text-[11px] text-ink-soft"
                      data-testid={`invalid-slot-${inv.key}`}
                    >
                      <span className="font-song font-semibold">
                        {rowLabel(inv.row)}
                        {inv.col + 1}
                      </span>
                      <span>
                        {inv.character}（{inv.matrixId}）·{' '}
                        {inv.reason === 'missing' ? '字模档案已删除' : inv.availability}
                      </span>
                      <button
                        type="button"
                        className="rounded border border-seal bg-white px-1.5 py-0.5 text-seal hover:bg-seal-pale"
                        data-testid={`invalid-take-${inv.key}`}
                        onClick={() => {
                          api.take(inv.row, inv.col);
                          pushToast(`已取出 ${rowLabel(inv.row)}${inv.col + 1} 的失效字模（尚未保存）`, 'warn');
                        }}
                      >
                        取出
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <LayoutGrid
              rows={typeCase.rows}
              cols={typeCase.cols}
              slots={api.slots}
              highlight={selectedCell}
              conflictKeys={localConflictKeys}
              mergeConflictKeys={unresolvedConflicts.map((c) => c.key)}
              invalidKeys={invalidKeys}
              pendingCharacter={pending?.matrix.character ?? ''}
              onSlotClick={handleSlotClick}
              testIdPrefix="case-slot"
            />
            <div
              className={`rounded border px-3 py-2 text-xs ${
                api.conflicts.hasConflict || api.capacity.overCapacity
                  ? 'border-seal/40 bg-seal-pale text-seal'
                  : 'border-paper-line bg-paper/50 text-ink-soft'
              }`}
              data-testid="slot-warning"
            >
              <p data-testid="capacity-message">{api.capacity.message}</p>
              <p>
                空格 {api.emptyCells.length} 个
                {api.conflicts.duplicateCharacters.length > 0
                  ? ` · 重复落位 ${api.conflicts.duplicateCharacters
                      .map((g) => `${g.character}×${g.count}`)
                      .join('、')}`
                  : ' · 无重复落位'}
                {api.conflicts.duplicatePositions.length > 0
                  ? ` · 同格位重复 ${api.conflicts.duplicatePositions.join('、')}`
                  : ''}
                {api.conflicts.outOfRange.length > 0
                  ? ` · 越界格位 ${api.conflicts.outOfRange.join('、')}`
                  : ''}
                {api.merge.autoMergedSaved.length > 0
                  ? ` · 已自动合并另一页面 ${api.merge.autoMergedSaved.length} 处改动`
                  : ''}
              </p>
              {api.dirty ? (
                <p className="mt-1" data-testid="dirty-hint">
                  当前布局尚未保存到本机档案，点「保存布局」按格位合并写回 IndexedDB。
                </p>
              ) : null}
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded border border-paper-line bg-white/70 px-3 py-3">
              <h4 className="mb-2 font-song text-sm font-semibold text-ink">落位操作</h4>
              <CharacterPicker
                value={pickedChar}
                onChange={(char) => {
                  setPickedChar(char);
                  setPending(null);
                }}
                label="待落位字符"
                testId="case-character-picker"
                compact
              />
              <div className="mt-2 space-y-1">
                <p className="text-[11px] text-ink-mute">
                  可用字模候选 {charCandidates.length} 枚（按总览页筛选条件）
                </p>
                {pickedChar && charCandidates.length === 0 ? (
                  <p className="text-[11px] text-seal" data-testid="no-candidate">
                    「{pickedChar}」当前没有可用字模，请先到「字模登记」登记或补刻。
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-1">
                  {charCandidates.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      data-testid={`candidate-matrix-${m.id}`}
                      onClick={() => setPending({ matrix: m })}
                      className={`rounded border px-2 py-1 text-[11px] transition ${
                        pending?.matrix.id === m.id
                          ? 'border-seal bg-seal text-paper'
                          : 'border-paper-line bg-white text-ink-soft hover:border-seal'
                      }`}
                    >
                      {m.character} · {m.code} · {m.sizeName}
                    </button>
                  ))}
                </div>
                {pending ? (
                  <p className="text-[11px] text-seal" data-testid="pending-hint">
                    待落位：{pending.matrix.character}（{pending.matrix.code}），点击网格格位完成落位。
                  </p>
                ) : (
                  <p className="text-[11px] text-ink-mute">先选字符与字模，再点网格落位。</p>
                )}
              </div>
            </div>

            <div className="rounded border border-paper-line bg-white/70 px-3 py-3" data-testid="slot-actions">
              <h4 className="mb-2 font-song text-sm font-semibold text-ink">格位操作</h4>
              <p className="text-[11px] text-ink-soft" data-testid="selected-slot-info">
                {selectedCell
                  ? `选中格位：${rowLabel(selectedCell.row)}${selectedCell.col + 1}${
                      selectedSlot ? ` · ${selectedSlot.character}（${selectedSlot.matrixId}）` : ' · 空格'
                    }`
                  : '未选中格位（点击网格选择）'}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="mt-btn"
                  data-testid="take-slot-btn"
                  disabled={!selectedCell || !selectedSlot}
                  onClick={() => {
                    if (!selectedCell) return;
                    api.take(selectedCell.row, selectedCell.col);
                    pushToast('已取出该格字模（尚未保存）', 'warn');
                  }}
                >
                  取出选中格
                </button>
                <button
                  type="button"
                  className="mt-btn"
                  data-testid="swap-start-btn"
                  disabled={!selectedCell || !selectedSlot}
                  onClick={() => setSwapFrom(selectedCell)}
                >
                  设为调换起点
                </button>
                <button
                  type="button"
                  className="mt-btn"
                  data-testid="swap-cancel-btn"
                  disabled={!swapFrom}
                  onClick={() => setSwapFrom(null)}
                >
                  取消调换
                </button>
              </div>
              {swapFrom ? (
                <p className="mt-1 text-[11px] text-seal" data-testid="swap-hint">
                  调换起点：{rowLabel(swapFrom.row)}
                  {swapFrom.col + 1}，请点击目标格位完成调换。
                </p>
              ) : null}
            </div>

            <div className="rounded border border-paper-line bg-white/70 px-3 py-3" data-testid="draft-panel">
              <h4 className="mb-2 font-song text-sm font-semibold text-ink">布局草稿</h4>
              <p className="text-[11px] text-ink-mute" data-testid="draft-status">
                {api.draftDiffers
                  ? `存在未保存的布局草稿（${api.slots.length} 格），刷新或关页后重开可继续处理冲突`
                  : '草稿与已保存布局一致'}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="mt-btn"
                  data-testid="restore-draft-btn"
                  disabled={!api.draftDiffers}
                  onClick={() => {
                    api.restoreDraft();
                    pushToast(`已恢复草稿布局（${api.slots.length} 格）`);
                  }}
                >
                  恢复草稿
                </button>
                <button
                  type="button"
                  className="mt-btn"
                  data-testid="discard-draft-btn"
                  disabled={!api.draftDiffers}
                  onClick={() => {
                    api.discardDraft();
                    pushToast('已放弃草稿', 'warn');
                  }}
                >
                  放弃草稿
                </button>
              </div>
            </div>

            <Link className="mt-btn block text-center" to="/defects" data-testid="goto-defects">
              去登记缺损 / 补刻
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function rowLabel(row: number): string {
  return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[row] ?? String(row + 1);
}

function parseKey(key: string): RCCell | null {
  const [r, c] = key.split('-');
  const row = Number(r);
  const col = Number(c);
  if (!Number.isInteger(row) || !Number.isInteger(col)) return null;
  return { row, col };
}
