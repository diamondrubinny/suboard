import { findPrimaryStatusColumn, isItemDone, MAX_SUBITEM_DEPTH, type BoardDetail, type CellValue, type Column, type Item } from '@suboard/shared';
import { errorMessage } from '../../api/client';
import { useUpdateItem } from '../../api/hooks';
import { useFeedback } from '../../components/Feedback';

/** Maximum nesting below a top-level item (item → sub-item → sub-item of a sub-item → …). */
export const MAX_DEPTH = MAX_SUBITEM_DEPTH;

export function depthOf(board: BoardDetail, item: Item): number {
  let d = 0;
  let cur: Item | undefined = item;
  while (cur?.parentId && d <= MAX_SUBITEM_DEPTH) {
    cur = board.items.find((i) => i.id === cur!.parentId);
    d++;
  }
  return d;
}

export const childrenOf = (board: BoardDetail, id: string): Item[] => board.items.filter((i) => i.parentId === id).sort((a, b) => a.position - b.position);

/** Sub-items and their sub-items. */
export function descendantsOf(board: BoardDetail, id: string): Item[] {
  const out: Item[] = [];
  for (const c of childrenOf(board, id)) out.push(c, ...descendantsOf(board, c.id));
  return out;
}

/** "3 of 5 done" over every descendant, by the board's primary status column. */
export function subtaskProgress(board: BoardDetail, id: string): { done: number; total: number } {
  const status = findPrimaryStatusColumn(board.columns);
  const all = descendantsOf(board, id);
  return { total: all.length, done: all.filter((i) => isItemDone(i, status)).length };
}

/** The status options used by the "done" checkbox: first `done` option, and first open option to go back to. */
export function doneToggle(board: BoardDetail): { column: Column; doneId: string; openId: string | null } | null {
  const column = findPrimaryStatusColumn(board.columns);
  const done = column?.settings.options?.find((o) => o.done);
  if (!column || !done) return null;
  return { column, doneId: done.id, openId: column.settings.options?.find((o) => !o.done)?.id ?? null };
}

/**
 * Item edits with an "undo" toast: the previous value is sent back on demand (recorded in the item's
 * history as a normal change). Checklist columns are excluded — a failed entry may already have
 * opened a corrective action.
 */
export function useUndoableUpdate(board: BoardDetail) {
  const update = useUpdateItem(board.id);
  const { toast } = useFeedback();
  const onError = (e: unknown) => toast(errorMessage(e), 'error');

  const setValue = (item: Item, columnId: string, value: CellValue, what?: string) => {
    const column = board.columns.find((c) => c.id === columnId);
    const previous = (item.values[columnId] ?? null) as CellValue;
    update.mutate(
      { itemId: item.id, patch: { values: { [columnId]: value } } },
      {
        onError,
        onSuccess: () => {
          if (!column || column.type === 'checklist' || JSON.stringify(previous) === JSON.stringify(value ?? null)) return;
          toast(
            what ?? `"${column.title}" עודכן`,
            'info',
            {
              label: 'ביטול',
              onClick: () => update.mutate({ itemId: item.id, patch: { values: { [columnId]: previous } } }, { onError, onSuccess: () => toast('השינוי בוטל', 'info', undefined, 'undo') }),
            },
            'undo',
          );
        },
      },
    );
  };

  const rename = (item: Item, name: string) => {
    const previous = item.name;
    update.mutate(
      { itemId: item.id, patch: { name } },
      {
        onError,
        onSuccess: () =>
          toast('השם עודכן', 'info', { label: 'ביטול', onClick: () => update.mutate({ itemId: item.id, patch: { name: previous } }, { onError, onSuccess: () => toast('השינוי בוטל', 'info', undefined, 'undo') }) }, 'undo'),
      },
    );
  };

  return { setValue, rename, update };
}
