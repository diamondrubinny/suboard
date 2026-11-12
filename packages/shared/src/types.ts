import type { BoardRole, CauseCategory, ColorKey, ColumnType, GlobalRole, Reaction } from './constants.js';
import type { ColumnSettings, ComplianceSettings, Widget, RecurrenceSchedule, RuleAction, RuleCondition, RuleTrigger } from './schemas.js';

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
  /** Monthly management e-mail (managers / admins). */
  monthlyReport: boolean;
  /** How the account is managed: local password, SSO, or provisioned by SCIM. */
  authSource: 'local' | 'sso' | 'scim';
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
  /** local password / SSO-linked / provisioned by SCIM. */
  authSource: 'local' | 'sso' | 'scim';
}

export interface TimeTotal {
  /** Seconds logged on the item by everyone (the viewer's own running timer is not included — it is counted live). */
  seconds: number;
  /** When the viewer's own timer on this item was started, if it is running. */
  runningSince: string | null;
  /** How many other people have a timer running on the item right now. */
  othersRunning: number;
}
export interface TimeEntry {
  id: string;
  userId: string;
  userName: string;
  startedAt: string;
  endedAt: string | null;
  seconds: number;
  note: string;
  mine: boolean;
}
export interface ItemTime {
  totalSeconds: number;
  mineSeconds: number;
  /** The viewer's own entries; for board owners, everyone's. */
  entries: TimeEntry[];
  /** True when `entries` holds everyone's entries (board owners). */
  detailed: boolean;
}

export interface ApiTokenInfo {
  id: string;
  name: string;
  /** Last four characters, to tell tokens apart. */
  hint: string;
  scope: 'read' | 'write';
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
}

export const WEBHOOK_EVENTS = ['item_created', 'item_updated'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
export const WEBHOOK_EVENT_LABELS: Record<WebhookEvent, string> = { item_created: 'פריט נוצר', item_updated: 'פריט השתנה' };
export interface WebhookDelivery {
  id: string;
  event: string;
  ok: boolean;
  status: number | null;
  error: string | null;
  at: string;
}
export interface Webhook {
  id: string;
  boardId: string;
  url: string;
  events: WebhookEvent[];
  active: boolean;
  /** Consecutive failed deliveries; the webhook switches itself off after 10. */
  failures: number;
  createdAt: string;
  last: { ok: boolean; status: number | null; error: string | null; at: string } | null;
}

export interface Workspace {
  id: string;
  name: string;
  position: number;
}

export interface BoardSummary {
  id: string;
  name: string;
  /** The workspace the board is filed under, if any. */
  workspaceId: string | null;
  description: string;
  templateKey: string;
  myRole: BoardRole;
  itemCount: number;
  updatedAt: string;
  /** Starred by the current user. */
  favorite: boolean;
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

export interface RiskValue {
  /** Likelihood 1–5. */
  l: number;
  /** Severity 1–5. */
  s: number;
}
export type ChecklistResult = 'pass' | 'fail' | 'na';
/** Per checklist entry: the result and (server-maintained) the corrective action opened for a failure. */
export type ChecklistValue = Record<string, { r: ChecklistResult; capa?: string }>;
export type CellValue = string | number | boolean | string[] | { from: string; to: string } | RiskValue | ChecklistValue | null;

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
  /** What a row is called on this board; empty = "פריט". */
  itemTerm: string;
  workspaceId: string | null;
  groups: Group[];
  columns: Column[];
  items: Item[];
  members: BoardMember[];
  createdAt: string;
  updatedAt: string;
  /** Present when the board has a `linked` column: per item, linked items the viewer may see and how many are done. */
  linkStats?: Record<string, LinkStat>;
  /** Present when the board has a `time` column and the module is on: time logged per item. */
  timeTotals?: Record<string, TimeTotal>;
  /** Present when the board has a `files` column: item id → number of attached files (not counting blocked ones). */
  fileCounts?: Record<string, number>;
  /** Relation columns: item id → column id → connected items the viewer may see. */
  relations?: Record<string, Record<string, RelatedItem[]>>;
  /** Mirror columns: item id → column id → the mirrored values as text (one per connected item). */
  mirrors?: Record<string, Record<string, string[]>>;
  favorite: boolean;
}

export interface ItemUpdate {
  id: string;
  itemId: string;
  userId: string;
  userName: string;
  body: string;
  createdAt: string;
  /** Set on a reply (one level deep). */
  parentId: string | null;
  reactions: UpdateReaction[];
}

export interface UpdateReaction {
  emoji: Reaction;
  count: number;
  /** Whether the current user reacted with this emoji. */
  mine: boolean;
  /** Names of those who reacted (for the accessible tooltip / list). */
  users: string[];
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

export type NotificationKind = 'assigned' | 'overdue' | 'due_tomorrow' | 'mentioned' | 'automation' | 'report' | 'effectiveness' | 'monthly' | 'training' | 'procedure' | 'followed' | 'reply' | 'reminder';

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

// ---------- Wave C ----------
export interface LinkStat {
  total: number;
  done: number;
}
export const MAX_MANUAL_LINKS = 50;
export const MAX_RELATION_ITEMS = 20;
export interface RelatedItem {
  id: string;
  name: string;
  boardId: string;
}

export interface ItemLink {
  id: string;
  kind: 'checklist_capa' | 'investigation_action' | 'related';
  direction: 'out' | 'in';
  /** null when the linked item is on a board the viewer cannot see (name hidden). */
  item: { id: string; name: string; boardId: string; boardName: string; statusLabel: string | null; statusColor: ColorKey | null; done: boolean } | null;
  createdAt: string;
}

export interface Investigation {
  itemId: string;
  whys: string[];
  rootCause: string;
  categories: CauseCategory[];
  effectivenessDue: string | null;
  effectivenessResult: 'effective' | 'not_effective' | null;
  effectivenessNote: string;
  updatedAt: string | null;
  updatedByName: string | null;
}

export interface ComplianceBucket {
  key: string;
  label: string;
  total: number;
  ok: number;
  dueSoon: number;
  overdue: number;
  missing: number;
  /** (ok + dueSoon) / total × 100, rounded; null when total is 0. */
  percent: number | null;
}

export interface BoardCompliance {
  boardId: string;
  boardName: string;
  settings: NonNullable<ComplianceSettings>;
  dateColumnTitle: string;
  groupByTitle: string | null;
  summary: ComplianceBucket;
  groups: ComplianceBucket[];
  overdueItems: { id: string; name: string; date: string; group: string | null }[];
}

export interface FormField {
  columnId: string;
  label?: string;
  help?: string;
  required: boolean;
  section?: string;
  showIf?: { columnId: string; optionIds: string[] };
}

export interface BoardForm {
  id: string;
  boardId: string;
  boardName: string;
  name: string;
  description: string;
  groupId: string;
  nameLabel: string;
  fields: FormField[];
  audience: 'members' | 'all_users';
  allowPhotos: boolean;
  enabled: boolean;
  createdByName: string | null;
  submissions: number;
  successMessage: string;
  notifyUserIds: string[];
  assignUserIds: string[];
}

/** What a person filling the form receives: only the columns of its fields. */
export interface FormForFill {
  id: string;
  name: string;
  description: string;
  boardName: string;
  nameLabel: string;
  allowPhotos: boolean;
  successMessage: string;
  fields: (FormField & { column: Column })[];
  /** Board members (only for member forms with a person field). */
  members: DirectoryUser[];
}

export interface MySubmission {
  itemId: string;
  formName: string;
  boardName: string;
  name: string;
  ref: string;
  createdAt: string;
  statusLabel: string | null;
  statusColor: ColorKey | null;
  done: boolean;
}

export interface ItemCard {
  boardId: string;
  boardName: string;
  myRole: BoardRole;
  item: Item;
  columns: Column[];
  members: DirectoryUser[];
  updates: ItemUpdate[];
}

export type { ComplianceSettings };

// ---------- Wave D ----------
export interface CustomDashboard {
  id: string;
  name: string;
  shared: boolean;
  ownerId: string;
  ownerName: string | null;
  isOwner: boolean;
  widgets: Widget[];
  updatedAt: string;
}

export interface TrendPoint {
  /** Period start, YYYY-MM-DD. */
  start: string;
  label: string;
  created: number;
  closed: number;
  /** Average days from creation to first close, for items closed in this period. */
  avgCloseDays: number | null;
}

export interface WorkloadRow {
  userId: string;
  name: string;
  open: number;
  overdue: number;
  dueWeek: number;
  noDue: number;
  boards: { boardId: string; boardName: string; open: number; overdue: number }[];
}

export type WidgetData =
  | { type: 'count'; value: number; boards: number }
  | { type: 'status'; boardName: string; rows: { label: string; color: ColorKey | null; count: number }[] }
  | { type: 'trend'; points: TrendPoint[] }
  | { type: 'overdue'; items: { id: string; boardId: string; boardName: string; name: string; due: string; daysLate: number }[] }
  | { type: 'workload'; rows: WorkloadRow[] }
  | { type: 'compliance'; rows: { boardId: string; boardName: string; percent: number | null; overdue: number; total: number }[] }
  | { type: 'risk'; levels: { level: 'low' | 'medium' | 'high' | 'critical'; count: number }[]; unassessed: number }
  /** The widget points only at boards the viewer cannot see (or that no longer exist). */
  | { type: 'empty'; reason: string };

export interface DependencyInfo {
  itemId: string;
  blockedBy: { id: string; name: string; done: boolean; end: string | null }[];
  blocks: { id: string; name: string }[];
}

export interface MonthlyBoardRow {
  boardId: string;
  boardName: string;
  created: number;
  closed: number;
  openAtEnd: number;
  overdueAtEnd: number;
  avgCloseDays: number | null;
  prev: { created: number; closed: number; avgCloseDays: number | null };
}

export interface MonthlyReport {
  month: string;
  label: string;
  generatedAt: string;
  boards: MonthlyBoardRow[];
  totals: { created: number; closed: number; overdueAtEnd: number; prevCreated: number; prevClosed: number };
  compliance: { boardId: string; boardName: string; percent: number | null; overdue: number }[];
  risk: { level: 'low' | 'medium' | 'high' | 'critical'; count: number }[];
  topOverdue: { id: string; boardId: string; boardName: string; name: string; due: string; daysLate: number }[];
}

// ---------- Wave E ----------
export interface Training {
  id: string;
  name: string;
  description: string;
  validityMonths: number;
  allUsers: boolean;
  requiredUserIds: string[];
}

export type TrainingState = 'valid' | 'expiring' | 'expired' | 'missing' | 'not_required';
export interface TrainingCell {
  state: TrainingState;
  completedOn: string | null;
  expiresOn: string | null;
  recordId: string | null;
}
export interface TrainingMatrix {
  trainings: Training[];
  users: { id: string; name: string; cells: Record<string, TrainingCell> }[];
  /** Per training: required / valid / expiring / expired / missing. */
  totals: Record<string, { required: number; valid: number; expiring: number; expired: number; missing: number }>;
}
export interface MyTraining {
  training: Training;
  cell: TrainingCell;
  history: { id: string; completedOn: string; note: string }[];
}

export interface ProcedureVersion {
  id: string;
  version: string;
  effectiveOn: string;
  summary: string;
  body: string;
  link: string | null;
  publishedAt: string;
  publishedByName: string | null;
}
export interface Procedure {
  id: string;
  code: string;
  title: string;
  category: string;
  audience: 'all' | 'users';
  userIds: string[];
  current: ProcedureVersion | null;
  versions: { id: string; version: string; effectiveOn: string }[];
  /** Acknowledgements of the current version (managers only; null for others). */
  ackStats: { acked: number; total: number } | null;
  myAckAt: string | null;
  /** True when the current user is in the audience. */
  forMe: boolean;
}
export interface ProcedureAckReport {
  versionId: string;
  acked: { userId: string; name: string; at: string }[];
  pending: { userId: string; name: string }[];
}

export interface PlanPin {
  itemId: string;
  x: number;
  y: number;
}

// ---------- Wave H ----------
export interface ActiveSession {
  /** Opaque handle (one-way derived from the session id; never the token or its stored hash). */
  handle: string;
  /** e.g. "Chrome · Windows" — from the User-Agent; "דפדפן לא מזוהה" when unknown. */
  device: string;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
  viaSso: boolean;
  viaPasskey?: boolean;
}

/** A registered passkey, as shown to its owner (never the key material). */
export interface PasskeyInfo {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  /** Synced by the platform (iCloud Keychain, Google Password Manager…) rather than bound to one device. */
  synced: boolean;
}

export interface RecentBoard {
  id: string;
  name: string;
  visitedAt: string;
  favorite: boolean;
}

export interface FollowState {
  following: boolean;
  count: number;
}

export interface BoardFile {
  id: string;
  itemId: string;
  itemName: string;
  groupId: string;
  name: string;
  mime: string;
  size: number;
  createdAt: string;
  isImage: boolean;
}

// ---------- Wave I ----------
/** A board template saved from an existing board (structure only). */
export interface CustomTemplate {
  id: string;
  name: string;
  description: string;
  /** Built-in template the source board was created from (keeps template-specific features). */
  baseKey: string;
  groupCount: number;
  columnCount: number;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
}

// ---------- Wave J ----------
/** An open item or sub-item assigned to the current user ("My work"). */
export interface MyWorkItem extends DashboardItemRef {
  parentId: string | null;
  parentName: string | null;
  /** Set when the user may edit the board and the board has a "done" status: enables "mark done" in place. */
  complete: { columnId: string; optionId: string } | null;
  /** Current option id of the primary status (to undo "mark done"). */
  statusId: string | null;
}

// ---------- Wave M ----------
export interface ItemReminder {
  id: string;
  itemId: string;
  remindAt: string;
  note: string;
}
/** What only the current user keeps on an item. */
export interface ItemPersonal {
  reminders: ItemReminder[];
  note: string;
}
export interface ItemTemplate {
  id: string;
  boardId: string;
  name: string;
  /** Number of items the template creates (the item and all its sub-items). */
  size: number;
  createdBy: string | null;
  createdByName: string | null;
}
