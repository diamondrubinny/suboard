import type { BoardRole, ColorKey, ColumnType, GlobalRole } from './constants.js';
import type { ColumnSettings } from './schemas.js';

/** API data-transfer objects (JSON shapes returned by the server). */

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: GlobalRole;
  mustChangePassword: boolean;
}

export interface DirectoryUser {
  id: string;
  name: string;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: GlobalRole;
  isActive: boolean;
  mustChangePassword: boolean;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface BoardSummary {
  id: string;
  name: string;
  description: string;
  templateKey: string;
  myRole: BoardRole;
  itemCount: number;
  updatedAt: string;
}

export interface Group {
  id: string;
  boardId: string;
  name: string;
  color: ColorKey;
  position: number;
}

export interface Column {
  id: string;
  boardId: string;
  title: string;
  type: ColumnType;
  settings: ColumnSettings;
  position: number;
}

export type CellValue = string | number | boolean | string[] | null;

export interface Item {
  id: string;
  boardId: string;
  groupId: string;
  name: string;
  values: Record<string, CellValue>;
  position: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BoardMember {
  userId: string;
  name: string;
  email: string;
  role: BoardRole;
}

export interface BoardDetail {
  id: string;
  name: string;
  description: string;
  templateKey: string;
  myRole: BoardRole;
  groups: Group[];
  columns: Column[];
  items: Item[];
  members: BoardMember[];
  createdAt: string;
  updatedAt: string;
}

export interface ItemUpdate {
  id: string;
  itemId: string;
  userId: string;
  userName: string;
  body: string;
  createdAt: string;
}

export interface ActivityEntry {
  id: string;
  boardId: string;
  itemId: string | null;
  userId: string | null;
  userName: string | null;
  action: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface TemplateInfo {
  key: string;
  name: string;
  description: string;
  icon: string;
}

export interface DashboardItemRef {
  itemId: string;
  itemName: string;
  boardId: string;
  boardName: string;
  dueDate: string | null;
  statusLabel: string | null;
  statusColor: ColorKey | null;
}

export interface DashboardBoardStat {
  boardId: string;
  boardName: string;
  total: number;
  open: number;
  overdue: number;
  byStatus: { label: string; color: ColorKey; count: number }[];
}

export interface Dashboard {
  myOpenItems: DashboardItemRef[];
  overdue: DashboardItemRef[];
  dueSoon: DashboardItemRef[];
  boards: DashboardBoardStat[];
}

export interface AuditEntry {
  id: string;
  userId: string | null;
  userName: string | null;
  event: string;
  meta: Record<string, unknown>;
  createdAt: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string; fields?: Record<string, string> };
}
