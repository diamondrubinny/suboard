import type { CellValue, ColorKey, Column, ColumnSettings, ColumnType, Group, Item } from '@suboard/shared';
import { parseJson } from '../db/index.js';

export interface GroupRow {
  id: string;
  board_id: string;
  name: string;
  color: string;
  position: number;
}
export interface ColumnRow {
  id: string;
  board_id: string;
  title: string;
  type: string;
  settings: string;
  position: number;
}
export interface ItemRow {
  id: string;
  board_id: string;
  group_id: string;
  parent_id: string | null;
  seq: number | null;
  deleted_at?: string | null;
  name: string;
  cell_values: string;
  position: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const toGroup = (r: GroupRow): Group => ({
  id: r.id,
  boardId: r.board_id,
  name: r.name,
  color: r.color as ColorKey,
  position: r.position,
});

export const toColumn = (r: ColumnRow): Column => ({
  id: r.id,
  boardId: r.board_id,
  title: r.title,
  type: r.type as ColumnType,
  settings: parseJson<ColumnSettings>(r.settings, {}),
  position: r.position,
});

export const toItem = (r: ItemRow): Item => ({
  id: r.id,
  boardId: r.board_id,
  groupId: r.group_id,
  parentId: r.parent_id ?? null,
  seq: r.seq ?? 0,
  name: r.name,
  values: parseJson<Record<string, CellValue>>(r.cell_values, {}),
  position: r.position,
  createdBy: r.created_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
