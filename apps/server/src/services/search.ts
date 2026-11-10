import type { SearchHit } from '@suboard/shared';
import type { DB } from '../db/index.js';
import type { AccessService, Actor } from './access.js';

const MAX_HITS = 30;

/** LIKE pattern with %, _ and the escape character itself escaped (no wildcard injection). */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function snippet(text: string, q: string): string {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text.slice(0, 120);
  const start = Math.max(0, i - 40);
  return (start > 0 ? '…' : '') + text.slice(start, i + q.length + 60) + (i + q.length + 60 < text.length ? '…' : '');
}

/**
 * Global search over item names, text cell values and updates — only in boards the actor can
 * view, never in trashed items. Parameterised LIKE; results capped.
 */
export class SearchService {
  constructor(
    private readonly db: DB,
    private readonly access: AccessService,
  ) {}

  search(actor: Actor, q: string): SearchHit[] {
    const boardIds = this.access.accessibleBoardIds(actor);
    if (!boardIds.length) return [];
    const inBoards = `i.board_id IN (${boardIds.map(() => '?').join(',')})`;
    const pattern = likePattern(q);

    const itemRows = this.db
      .prepare(
        `SELECT i.id, i.name, i.cell_values, i.board_id, b.name AS board_name FROM items i JOIN boards b ON b.id = i.board_id
         WHERE ${inBoards} AND i.deleted_at IS NULL AND (i.name LIKE ? ESCAPE '\\' OR i.cell_values LIKE ? ESCAPE '\\')
         ORDER BY i.updated_at DESC LIMIT 200`,
      )
      .all(...boardIds, pattern, pattern) as { id: string; name: string; cell_values: string; board_id: string; board_name: string }[];

    const hits: SearchHit[] = [];
    const needle = q.toLowerCase();
    for (const r of itemRows) {
      if (r.name.toLowerCase().includes(needle)) {
        hits.push({ kind: 'item', itemId: r.id, itemName: r.name, boardId: r.board_id, boardName: r.board_name, snippet: r.name });
        continue;
      }
      // Match only inside string values (not ids or JSON keys) to avoid false positives.
      let values: Record<string, unknown> = {};
      try {
        values = JSON.parse(r.cell_values) as Record<string, unknown>;
      } catch {
        /* ignore */
      }
      const text = Object.values(values).find((v): v is string => typeof v === 'string' && v.toLowerCase().includes(needle));
      if (text) hits.push({ kind: 'item', itemId: r.id, itemName: r.name, boardId: r.board_id, boardName: r.board_name, snippet: snippet(text, q) });
      if (hits.length >= MAX_HITS) return hits;
    }

    const updateRows = this.db
      .prepare(
        `SELECT up.body, i.id, i.name, i.board_id, b.name AS board_name FROM item_updates up
         JOIN items i ON i.id = up.item_id JOIN boards b ON b.id = i.board_id
         WHERE ${inBoards} AND i.deleted_at IS NULL AND up.body LIKE ? ESCAPE '\\'
         ORDER BY up.created_at DESC LIMIT ?`,
      )
      .all(...boardIds, pattern, MAX_HITS - hits.length) as { body: string; id: string; name: string; board_id: string; board_name: string }[];
    for (const r of updateRows) {
      hits.push({ kind: 'update', itemId: r.id, itemName: r.name, boardId: r.board_id, boardName: r.board_name, snippet: snippet(r.body, q) });
    }
    return hits.slice(0, MAX_HITS);
  }
}
