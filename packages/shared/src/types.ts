import type { BoardRole, ColorKey, ColumnType, GlobalRole } from './constants.js';
import type { ColumnSettings, RecurrenceSchedule, RuleAction, RuleCondition, RuleTrigger } from './schemas.js';

/** API data-transfer objects (JSON shapes returned by the server). */

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: GlobalRole;
  mustChangePassword: boolean;
  mfaEnabled: boolean;
  /** The user's role requires MFA and it is not enrolled yet. */
  mfaSetupRequired: boolean;
  emailNotifications: boolean;
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
  mfaEnabled: boolean;
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

export type CellValue = string | number | boolean | string[] | { from: string; to: string } | null;

export interface Item {
  id: string;
  boardId: string;
  groupId: string;
  /** Set for sub-items (one level). */
  parentId: string | null;
  /** Running number within the board (shown by an `auto_id` column). */
  seq: number;
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

export type LoginResponse = { user: SessionUser; mfaRequired?: false } | { mfaRequired: true; challengeToken: string };

export interface MfaSetup {
  secret: string;
  otpauthUri: string;
  qrSvg: string;
}

export type NotificationKind = 'assigned' | 'overdue' | 'due_tomorrow' | 'mentioned' | 'automation' | 'report';

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  boardId: string | null;
  itemId: string | null;
  title: string;
  actorName: string | null;
  /** Extra text: automation message or report name (written by board owners, never item content). */
  detail: string | null;
  read: boolean;
  createdAt: string;
}

export type AttachmentStatus = 'pending' | 'clean' | 'infected' | 'error';

export interface Attachment {
  id: string;
  itemId: string;
  originalName: string;
  mime: string;
  size: number;
  status: AttachmentStatus;
  uploadedBy: string | null;
  uploaderName: string | null;
  createdAt: string;
}

export interface TrashedItem {
  id: string;
  name: string;
  parentId: string | null;
  deletedAt: string;
  purgeAt: string;
}

export interface SavedView {
  id: string;
  boardId: string;
  userId: string;
  ownerName: string;
  name: string;
  shared: boolean;
  config: import('./schemas.js').ViewConfig;
  mine: boolean;
}

export interface SearchHit {
  kind: 'item' | 'update';
  itemId: string;
  itemName: string;
  boardId: string;
  boardName: string;
  snippet: string;
}

export interface ImportResult {
  created: number;
  errors: { row: number; message: string }[];
}

// ---------- Wave B ----------
export interface Automation {
  id: string;
  boardId: string;
  name: string;
  enabled: boolean;
  trigger: RuleTrigger;
  conditions: RuleCondition[];
  actions: RuleAction[];
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
  runCount: number;
  errorCount: number;
}

export interface AutomationRun {
  id: string;
  automationId: string;
  automationName: string;
  itemId: string | null;
  itemName: string | null;
  status: 'ok' | 'error';
  detail: string | null;
  createdAt: string;
}

export interface Recurrence {
  id: string;
  boardId: string;
  groupId: string;
  name: string;
  values: Record<string, CellValue>;
  schedule: RecurrenceSchedule;
  dueColumnId: string | null;
  dueOffsetDays: number;
  enabled: boolean;
  /** Next date an item will be created (null when the schedule has ended). */
  nextDate: string | null;
  lastItemId: string | null;
  lastCreatedAt: string | null;
  createdByName: string | null;
}

export type ReportFrequency = 'daily' | 'weekly' | 'monthly';

export interface ScheduledReport {
  id: string;
  boardId: string;
  name: string;
  frequency: ReportFrequency;
  weekday: number;
  monthDay: number;
  recipients: string[];
  enabled: boolean;
  lastSentDay: string | null;
  createdByName: string | null;
}

export interface ReportItemRef {
  id: string;
  name: string;
  date: string;
}

export interface BoardReportSummary {
  boardId: string;
  boardName: string;
  generatedAt: string;
  periodDays: number;
  total: number;
  open: number;
  byStatus: { optionId: string | null; label: string; color: string | null; count: number }[];
  overdue: ReportItemRef[];
  upcoming: ReportItemRef[];
  createdInPeriod: number;
  closedInPeriod: number;
}
