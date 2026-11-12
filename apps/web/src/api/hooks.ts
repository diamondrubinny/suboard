import type {
  ItemPersonal,
  ItemReminder,
  ItemTemplate,
  QuickFormInput,
  MyWorkItem,
  CustomTemplate,
  ActiveSession,
  PasskeyInfo,
  ModuleState,
  Workspace,
  Webhook,
  ApiTokenInfo,
  ItemTime,
  WebhookDelivery,
  WebhookEvent,
  BoardFile,
  FollowState,
  Reaction,
  RecentBoard,
  MyTraining,
  PlanPin,
  Procedure,
  ProcedureAckReport,
  ProcedureVersionInput,
  Training,
  TrainingMatrix,
  CustomDashboard,
  DependencyInfo,
  MonthlyReport,
  TrendPoint,
  WidgetData,
  WidgetInput,
  WorkloadRow,
  BoardCompliance,
  BoardForm,
  ComplianceSettings,
  CreateFormInput,
  FormForFill,
  Investigation,
  InvestigationInput,
  ItemCard,
  ItemLink,
  MySubmission,
  Automation,
  AutomationRun,
  BoardReportSummary,
  CreateAutomationInput,
  CreateRecurrenceInput,
  CreateReportInput,
  Recurrence,
  ScheduledReport,
  ImportResult,
  SavedView,
  SearchHit,
  TrashedItem,
  ViewConfig,
  AppNotification,
  Attachment,
  ActivityEntry,
  AdminUser,
  AuditEntry,
  BoardDetail,
  BoardMember,
  BoardRole,
  BoardSummary,
  Column,
  ColumnSettings,
  ColumnType,
  Dashboard,
  DirectoryUser,
  GlobalRole,
  Group,
  Item,
  ItemUpdate,
  TemplateInfo,
} from '@suboard/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, uploadFile } from './client';

export const qk = {
  me: ['me'] as const,
  boards: ['boards'] as const,
  board: (id: string) => ['board', id] as const,
  directory: ['directory'] as const,
  templates: ['templates'] as const,
  dashboard: ['dashboard'] as const,
  updates: (itemId: string) => ['updates', itemId] as const,
  itemActivity: (itemId: string) => ['item-activity', itemId] as const,
  users: ['users'] as const,
  audit: (event: string) => ['audit', event] as const,
  meMeta: ['me-meta'] as const,
  notifications: ['notifications'] as const,
  attachments: (itemId: string) => ['attachments', itemId] as const,
  views: (boardId: string) => ['views', boardId] as const,
  trash: (boardId: string) => ['trash', boardId] as const,
  search: (q: string) => ['search', q] as const,
  automations: (boardId: string) => ['automations', boardId] as const,
  automationRuns: (boardId: string) => ['automation-runs', boardId] as const,
  recurrences: (boardId: string) => ['recurrences', boardId] as const,
  reports: (boardId: string) => ['reports', boardId] as const,
  reportSummary: (boardId: string, days: number) => ['report-summary', boardId, days] as const,
  card: (itemId: string) => ['card', itemId] as const,
  links: (itemId: string) => ['links', itemId] as const,
  investigation: (itemId: string) => ['investigation', itemId] as const,
  compliance: ['compliance'] as const,
  boardCompliance: (boardId: string) => ['compliance', boardId] as const,
  boardForms: (boardId: string) => ['board-forms', boardId] as const,
  forms: ['forms'] as const,
  form: (id: string) => ['form', id] as const,
  mySubmissions: ['my-submissions'] as const,
  dashboards: ['dashboards'] as const,
  customDashboard: (id: string) => ['custom-dashboard', id] as const,
  dashboardData: (id: string) => ['custom-dashboard-data', id] as const,
  trend: (key: string) => ['trend', key] as const,
  workload: ['workload'] as const,
  monthly: (month: string) => ['monthly', month] as const,
  dependencies: (itemId: string) => ['dependencies', itemId] as const,
  boardDependencies: (boardId: string) => ['board-dependencies', boardId] as const,
  trainings: ['trainings'] as const,
  trainingMatrix: ['training-matrix'] as const,
  myTrainings: ['my-trainings'] as const,
  procedures: ['procedures'] as const,
  procedure: (id: string) => ['procedure', id] as const,
  procedureAcks: (id: string) => ['procedure-acks', id] as const,
  myProcedures: ['my-procedures'] as const,
  plans: (boardId: string) => ['plans', boardId] as const,
  pins: (attachmentId: string) => ['pins', attachmentId] as const,
  sessions: ['sessions'] as const,
  passkeys: ['passkeys'] as const,
  modules: ['modules'] as const,
  workspaces: ['workspaces'] as const,
  recentBoards: ['recent-boards'] as const,
  follow: (itemId: string) => ['follow', itemId] as const,
  boardFiles: (boardId: string) => ['board-files', boardId] as const,
  myWork: ['my-work'] as const,
};

// ------------------------------------------------------------------ phase 2
export const useMeMeta = () =>
  useQuery({
    queryKey: qk.meMeta,
    queryFn: () => api<{ recoveryCodesLeft: number | null; emailAvailable: boolean }>('/auth/me'),
  });

export const useNotifications = () =>
  useQuery({
    queryKey: qk.notifications,
    queryFn: () => api<{ notifications: AppNotification[]; unread: number }>('/notifications'),
    refetchInterval: 60_000,
  });

export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { all: true } | { ids: string[] }) => api('/notifications/read', 'POST', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.notifications }),
  });
}

export const useAttachments = (itemId: string) =>
  useQuery({
    queryKey: qk.attachments(itemId),
    queryFn: () => api<{ attachments: Attachment[]; scanner: string | null; maxBytes: number }>(`/items/${itemId}/attachments`),
    // Poll while something is still waiting in quarantine.
    refetchInterval: (q) => (q.state.data?.attachments.some((a) => a.status === 'pending') ? 15_000 : false),
  });

export function useAttachmentMutations(itemId: string) {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.attachments(itemId) });
    void qc.invalidateQueries({ queryKey: qk.itemActivity(itemId) });
  };
  return {
    upload: useMutation({ mutationFn: (file: File) => uploadFile<{ attachment: Attachment }>(`/items/${itemId}/attachments`, file), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: string) => api(`/attachments/${id}`, 'DELETE'), onSuccess: refresh }),
  };
}

// ------------------------------------------------------------------ queries
export const useBoards = () => useQuery({ queryKey: qk.boards, queryFn: () => api<{ boards: BoardSummary[] }>('/boards').then((r) => r.boards) });

export const useBoard = (id: string) =>
  useQuery({ queryKey: qk.board(id), queryFn: () => api<{ board: BoardDetail }>(`/boards/${id}`).then((r) => r.board), enabled: Boolean(id) });

export const useDirectory = () =>
  useQuery({ queryKey: qk.directory, queryFn: () => api<{ users: DirectoryUser[] }>('/users/directory').then((r) => r.users), staleTime: 5 * 60_000 });

export const useTemplates = () =>
  useQuery({ queryKey: qk.templates, queryFn: () => api<{ templates: TemplateInfo[]; custom: CustomTemplate[] }>('/templates'), staleTime: 60_000 });

export function useTemplateMutations() {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: qk.templates });
  return {
    save: useMutation({
      mutationFn: ({ boardId, name, description }: { boardId: string; name: string; description?: string }) =>
        api<{ template: CustomTemplate }>(`/boards/${boardId}/save-as-template`, 'POST', { name, description }).then((r) => r.template),
      onSuccess: refresh,
    }),
    remove: useMutation({ mutationFn: (id: string) => api(`/templates/custom/${id}`, 'DELETE'), onSuccess: refresh }),
  };
}

export const useDashboard = () =>
  useQuery({ queryKey: qk.dashboard, queryFn: () => api<{ dashboard: Dashboard }>('/dashboard').then((r) => r.dashboard) });

export const useItemUpdates = (itemId: string) =>
  useQuery({ queryKey: qk.updates(itemId), queryFn: () => api<{ updates: ItemUpdate[] }>(`/items/${itemId}/updates`).then((r) => r.updates) });

export const useItemActivity = (itemId: string) =>
  useQuery({ queryKey: qk.itemActivity(itemId), queryFn: () => api<{ activity: ActivityEntry[] }>(`/items/${itemId}/activity`).then((r) => r.activity) });

export const useUsers = () => useQuery({ queryKey: qk.users, queryFn: () => api<{ users: AdminUser[] }>('/users').then((r) => r.users) });

export const useAudit = (event: string) =>
  useQuery({
    queryKey: qk.audit(event),
    queryFn: () => api<{ entries: AuditEntry[] }>(`/admin/audit${event ? `?event=${encodeURIComponent(event)}` : ''}`).then((r) => r.entries),
  });

// ------------------------------------------------------------------ board mutations
/** Helpers that patch the cached board in place so the UI updates without a full refetch. */
function useBoardCache(boardId: string) {
  const qc = useQueryClient();
  const update = (fn: (b: BoardDetail) => BoardDetail) => qc.setQueryData<BoardDetail>(qk.board(boardId), (b) => (b ? fn(b) : b));
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.board(boardId) });
    void qc.invalidateQueries({ queryKey: qk.dashboard });
    void qc.invalidateQueries({ queryKey: qk.boards });
  };
  return { qc, update, refresh };
}

export function useCreateBoard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; description?: string; templateKey: string; customTemplateId?: string; workspaceId?: string }) => api<{ board: BoardDetail }>('/boards', 'POST', input).then((r) => r.board),
    onSuccess: (board) => {
      qc.setQueryData(qk.board(board.id), board);
      void qc.invalidateQueries({ queryKey: qk.boards });
    },
  });
}

export function useUpdateBoard(boardId: string) {
  const { qc, refresh } = useBoardCache(boardId);
  return useMutation({
    mutationFn: (input: { name?: string; description?: string; itemTerm?: string }) => api<{ board: BoardDetail }>(`/boards/${boardId}`, 'PATCH', input).then((r) => r.board),
    onSuccess: (board) => {
      qc.setQueryData(qk.board(boardId), board);
      refresh();
    },
  });
}

export function useDuplicateBoard(boardId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; withItems: boolean }) => api<{ board: BoardDetail; items: number }>(`/boards/${boardId}/duplicate`, 'POST', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.boards }),
  });
}

export function useArchiveBoard(boardId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api(`/boards/${boardId}`, 'DELETE'),
    onSuccess: () => {
      qc.removeQueries({ queryKey: qk.board(boardId) });
      void qc.invalidateQueries({ queryKey: qk.boards });
      void qc.invalidateQueries({ queryKey: qk.dashboard });
    },
  });
}

export function useCreateItem(boardId: string) {
  const { update, qc } = useBoardCache(boardId);
  return useMutation({
    mutationFn: (input: { groupId: string; name: string; parentId?: string; values?: Record<string, unknown> }) =>
      api<{ item: Item }>(`/boards/${boardId}/items`, 'POST', input).then((r) => r.item),
    onSuccess: (item) => {
      update((b) => ({ ...b, items: [...b.items, item] }));
      void qc.invalidateQueries({ queryKey: qk.dashboard });
    },
  });
}

/** In-flight edits per item: a response is applied only when it is the last one pending. */
const pendingEdits = new Map<string, number>();

export function useUpdateItem(boardId: string) {
  const { update, qc } = useBoardCache(boardId);
  return useMutation({
    mutationFn: ({ itemId, patch }: { itemId: string; patch: { name?: string; groupId?: string; values?: Record<string, unknown> } }) =>
      api<{ item: Item }>(`/items/${itemId}`, 'PATCH', patch).then((r) => r.item),
    // Optimistic update; rolled back on error.
    onMutate: ({ itemId, patch }) => {
      pendingEdits.set(itemId, (pendingEdits.get(itemId) ?? 0) + 1);
      // Cancel in-flight refetches without reverting, then patch the cache immediately so
      // controlled inputs reflect the new value without a visible flicker.
      void qc.cancelQueries({ queryKey: qk.board(boardId) }, { revert: false });
      const previous = qc.getQueryData<BoardDetail>(qk.board(boardId));
      update((b) => ({
        ...b,
        items: b.items.map((i) => {
          if (i.id !== itemId) return i;
          const values = { ...i.values };
          for (const [k, v] of Object.entries(patch.values ?? {})) {
            if (v === null) delete values[k];
            else values[k] = v as never;
          }
          return { ...i, ...(patch.name ? { name: patch.name } : {}), ...(patch.groupId ? { groupId: patch.groupId } : {}), values };
        }),
      }));
      return { previous };
    },
    onError: (_e, v, context) => {
      // Roll back only if nothing else is pending for this item; otherwise resync from the server.
      if ((pendingEdits.get(v.itemId) ?? 0) <= 1 && context?.previous) qc.setQueryData(qk.board(boardId), context.previous);
      else void qc.invalidateQueries({ queryKey: qk.board(boardId) });
    },
    onSuccess: (item) => {
      // An earlier response must not overwrite a newer optimistic edit of the same item.
      if ((pendingEdits.get(item.id) ?? 0) <= 1) update((b) => ({ ...b, items: b.items.map((i) => (i.id === item.id ? item : i)) }));
      void qc.invalidateQueries({ queryKey: qk.itemActivity(item.id) });
      void qc.invalidateQueries({ queryKey: qk.dashboard });
      // A failed checklist entry may have opened (and linked) a corrective action on another board.
      void qc.invalidateQueries({ queryKey: qk.links(item.id) });
    },
    onSettled: (_d, _e, v) => {
      const n = (pendingEdits.get(v.itemId) ?? 1) - 1;
      if (n <= 0) pendingEdits.delete(v.itemId);
      else pendingEdits.set(v.itemId, n);
    },
  });
}

export function useDeleteItem(boardId: string) {
  const { update, qc } = useBoardCache(boardId);
  return useMutation({
    mutationFn: (itemId: string) => api(`/items/${itemId}`, 'DELETE').then(() => itemId),
    onSuccess: (itemId) => {
      // Sub-items go to the trash with their parent.
      update((b) => ({ ...b, items: b.items.filter((i) => i.id !== itemId && i.parentId !== itemId) }));
      void qc.invalidateQueries({ queryKey: qk.dashboard });
      void qc.invalidateQueries({ queryKey: qk.trash(boardId) });
    },
  });
}

// ------------------------------------------------------------------ wave A
export function useItemActions(boardId: string) {
  const { refresh, qc } = useBoardCache(boardId);
  const all = () => {
    refresh();
    void qc.invalidateQueries({ queryKey: qk.trash(boardId) });
  };
  return {
    restore: useMutation({ mutationFn: (itemId: string) => api<{ item: Item }>(`/items/${itemId}/restore`, 'POST'), onSuccess: all }),
    duplicate: useMutation({ mutationFn: (itemId: string) => api<{ item: Item }>(`/items/${itemId}/duplicate`, 'POST').then((r) => r.item), onSuccess: all }),
    promote: useMutation({ mutationFn: (itemId: string) => api<{ item: Item }>(`/items/${itemId}/promote`, 'POST').then((r) => r.item), onSuccess: all }),
    move: useMutation({
      mutationFn: ({ itemId, target }: { itemId: string; target: { boardId: string; groupId: string } }) =>
        api<{ item: Item; dropped: string[] }>(`/items/${itemId}/move`, 'POST', target),
      onSuccess: (_r, v) => {
        all();
        void qc.invalidateQueries({ queryKey: qk.board(v.target.boardId) });
      },
    }),
    bulk: useMutation({
      mutationFn: (
        input:
          | { action: 'delete'; itemIds: string[] }
          | { action: 'move_group'; itemIds: string[]; groupId: string }
          | { action: 'set_value'; itemIds: string[]; columnId: string; value: unknown },
      ) => api<{ affected: number }>(`/boards/${boardId}/items/bulk`, 'POST', input),
      onSuccess: all,
    }),
    importRows: useMutation({
      mutationFn: (input: { groupId: string; rows: { name: string; values?: Record<string, unknown> }[] }) =>
        api<ImportResult>(`/boards/${boardId}/import`, 'POST', input),
      onSuccess: all,
    }),
  };
}

export const useTrash = (boardId: string, enabled: boolean) =>
  useQuery({ queryKey: qk.trash(boardId), queryFn: () => api<{ items: TrashedItem[] }>(`/boards/${boardId}/trash`).then((r) => r.items), enabled });

export const useViews = (boardId: string) =>
  useQuery({ queryKey: qk.views(boardId), queryFn: () => api<{ views: SavedView[] }>(`/boards/${boardId}/views`).then((r) => r.views) });

export function useViewMutations(boardId: string) {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: qk.views(boardId) });
  return {
    create: useMutation({
      mutationFn: (input: { name: string; config: ViewConfig; shared: boolean }) =>
        api<{ view: SavedView }>(`/boards/${boardId}/views`, 'POST', input).then((r) => r.view),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ id, patch }: { id: string; patch: { name?: string; config?: ViewConfig; shared?: boolean } }) =>
        api<{ view: SavedView }>(`/views/${id}`, 'PATCH', patch).then((r) => r.view),
      onSuccess: refresh,
    }),
    remove: useMutation({ mutationFn: (id: string) => api(`/views/${id}`, 'DELETE'), onSuccess: refresh }),
  };
}

export const useSearch = (q: string) =>
  useQuery({
    queryKey: qk.search(q),
    queryFn: () => api<{ hits: SearchHit[] }>(`/search?q=${encodeURIComponent(q)}`).then((r) => r.hits),
    enabled: q.trim().length >= 2,
    staleTime: 10_000,
  });

export function useGroupMutations(boardId: string) {
  const { update, refresh } = useBoardCache(boardId);
  return {
    create: useMutation({
      mutationFn: (input: { name: string }) => api<{ group: Group }>(`/boards/${boardId}/groups`, 'POST', input).then((r) => r.group),
      onSuccess: (group) => update((b) => ({ ...b, groups: [...b.groups, group] })),
    }),
    update: useMutation({
      mutationFn: ({ groupId, patch }: { groupId: string; patch: { name?: string; color?: string } }) =>
        api<{ group: Group }>(`/groups/${groupId}`, 'PATCH', patch).then((r) => r.group),
      onSuccess: (group) => update((b) => ({ ...b, groups: b.groups.map((g) => (g.id === group.id ? group : g)) })),
    }),
    duplicate: useMutation({
      mutationFn: (groupId: string) => api<{ group: Group; items: number }>(`/groups/${groupId}/duplicate`, 'POST', {}),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (groupId: string) => api(`/groups/${groupId}`, 'DELETE'),
      onSuccess: refresh,
    }),
  };
}

export function useColumnMutations(boardId: string) {
  const { refresh } = useBoardCache(boardId);
  return {
    create: useMutation({
      mutationFn: (input: { title: string; type: ColumnType; settings?: ColumnSettings }) =>
        api<{ column: Column }>(`/boards/${boardId}/columns`, 'POST', input).then((r) => r.column),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ columnId, patch }: { columnId: string; patch: { title?: string; settings?: ColumnSettings; position?: number; replaceOptions?: Record<string, string | null>; clearLinks?: boolean } }) =>
        api<{ column: Column }>(`/columns/${columnId}`, 'PATCH', patch).then((r) => r.column),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (columnId: string) => api(`/columns/${columnId}`, 'DELETE'),
      onSuccess: refresh,
    }),
  };
}

export function useMemberMutations(boardId: string) {
  const { update } = useBoardCache(boardId);
  const onSuccess = (members: BoardMember[]) => update((b) => ({ ...b, members }));
  return {
    set: useMutation({
      mutationFn: (input: { userId: string; role: BoardRole }) =>
        api<{ members: BoardMember[] }>(`/boards/${boardId}/members`, 'PUT', input).then((r) => r.members),
      onSuccess,
    }),
    remove: useMutation({
      mutationFn: (userId: string) => api<{ members: BoardMember[] }>(`/boards/${boardId}/members/${userId}`, 'DELETE').then((r) => r.members),
      onSuccess,
    }),
  };
}

export function useUpdateMutations(itemId: string) {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.updates(itemId) });
    void qc.invalidateQueries({ queryKey: qk.itemActivity(itemId) });
  };
  return {
    add: useMutation({
      mutationFn: (input: { body: string; mentions?: string[]; parentId?: string }) => api(`/items/${itemId}/updates`, 'POST', input),
      onSuccess: () => {
        refresh();
        void qc.invalidateQueries({ queryKey: qk.follow(itemId) });
      },
    }),
    remove: useMutation({ mutationFn: (updateId: string) => api(`/updates/${updateId}`, 'DELETE'), onSuccess: refresh }),
    react: useMutation({
      mutationFn: ({ updateId, emoji, on }: { updateId: string; emoji: Reaction; on: boolean }) =>
        api(`/updates/${updateId}/reactions/${encodeURIComponent(emoji)}`, on ? 'PUT' : 'DELETE', on ? {} : undefined),
      onSuccess: () => void qc.invalidateQueries({ queryKey: qk.updates(itemId) }),
    }),
  };
}

// ------------------------------------------------------------------ admin
export function useUserMutations() {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.users });
    void qc.invalidateQueries({ queryKey: qk.directory });
  };
  return {
    create: useMutation({
      mutationFn: (input: { email: string; name: string; role: GlobalRole; password: string }) => api<{ user: AdminUser }>('/users', 'POST', input),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ id, patch }: { id: string; patch: { name?: string; role?: GlobalRole; isActive?: boolean; password?: string; unlock?: true; guestExpiresAt?: string; guestOrg?: string } }) =>
        api<{ user: AdminUser }>(`/users/${id}`, 'PATCH', patch),
      onSuccess: refresh,
    }),
    resetMfa: useMutation({ mutationFn: (id: string) => api<{ user: AdminUser }>(`/users/${id}/reset-mfa`, 'POST'), onSuccess: refresh }),
  };
}

// ------------------------------------------------------------------ wave B
export const useAutomations = (boardId: string, enabled = true) =>
  useQuery({
    queryKey: qk.automations(boardId),
    queryFn: () => api<{ automations: Automation[] }>(`/boards/${boardId}/automations`).then((r) => r.automations),
    enabled,
  });

export const useAutomationRuns = (boardId: string, enabled = true) =>
  useQuery({
    queryKey: qk.automationRuns(boardId),
    queryFn: () => api<{ runs: AutomationRun[] }>(`/boards/${boardId}/automation-runs`).then((r) => r.runs),
    enabled,
  });

export function useAutomationMutations(boardId: string) {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: qk.automations(boardId) });
  return {
    create: useMutation({
      mutationFn: (input: CreateAutomationInput) => api<{ automation: Automation }>(`/boards/${boardId}/automations`, 'POST', input).then((r) => r.automation),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ id, patch }: { id: string; patch: Partial<CreateAutomationInput> }) =>
        api<{ automation: Automation }>(`/automations/${id}`, 'PATCH', patch).then((r) => r.automation),
      onSuccess: refresh,
    }),
    remove: useMutation({ mutationFn: (id: string) => api(`/automations/${id}`, 'DELETE'), onSuccess: refresh }),
  };
}

export const useRecurrences = (boardId: string) =>
  useQuery({
    queryKey: qk.recurrences(boardId),
    queryFn: () => api<{ recurrences: Recurrence[] }>(`/boards/${boardId}/recurrences`).then((r) => r.recurrences),
  });

export function useRecurrenceMutations(boardId: string) {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: qk.recurrences(boardId) });
  return {
    create: useMutation({
      mutationFn: (input: CreateRecurrenceInput) => api<{ recurrence: Recurrence }>(`/boards/${boardId}/recurrences`, 'POST', input).then((r) => r.recurrence),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ id, patch }: { id: string; patch: Partial<CreateRecurrenceInput> }) =>
        api<{ recurrence: Recurrence }>(`/recurrences/${id}`, 'PATCH', patch).then((r) => r.recurrence),
      onSuccess: refresh,
    }),
    remove: useMutation({ mutationFn: (id: string) => api(`/recurrences/${id}`, 'DELETE'), onSuccess: refresh }),
  };
}

export const useReports = (boardId: string, enabled = true) =>
  useQuery({
    queryKey: qk.reports(boardId),
    queryFn: () => api<{ reports: ScheduledReport[] }>(`/boards/${boardId}/reports`).then((r) => r.reports),
    enabled,
  });

export function useReportMutations(boardId: string) {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: qk.reports(boardId) });
  return {
    create: useMutation({
      mutationFn: (input: CreateReportInput) => api<{ report: ScheduledReport }>(`/boards/${boardId}/reports`, 'POST', input).then((r) => r.report),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ id, patch }: { id: string; patch: Partial<CreateReportInput> }) =>
        api<{ report: ScheduledReport }>(`/reports/${id}`, 'PATCH', patch).then((r) => r.report),
      onSuccess: refresh,
    }),
    remove: useMutation({ mutationFn: (id: string) => api(`/reports/${id}`, 'DELETE'), onSuccess: refresh }),
  };
}

export const useReportSummary = (boardId: string, periodDays: number) =>
  useQuery({
    queryKey: qk.reportSummary(boardId, periodDays),
    queryFn: () => api<{ summary: BoardReportSummary }>(`/boards/${boardId}/report-summary?periodDays=${periodDays}`).then((r) => r.summary),
  });

// ------------------------------------------------------------------ wave C
export const useItemCard = (itemId: string) =>
  useQuery({ queryKey: qk.card(itemId), queryFn: () => api<{ card: ItemCard }>(`/items/${itemId}/card`).then((r) => r.card), retry: false });

export const useItemLinks = (itemId: string) =>
  useQuery({ queryKey: qk.links(itemId), queryFn: () => api<{ links: ItemLink[] }>(`/items/${itemId}/links`).then((r) => r.links) });

export function useLinkMutations(itemId: string, boardId: string) {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['links'] });
    void qc.invalidateQueries({ queryKey: qk.board(boardId) });
    void qc.invalidateQueries({ queryKey: qk.itemActivity(itemId) });
  };
  return {
    add: useMutation({ mutationFn: (toItemId: string) => api<{ links: ItemLink[] }>(`/items/${itemId}/links`, 'POST', { toItemId }), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (linkId: string) => api(`/links/${linkId}`, 'DELETE'), onSuccess: refresh }),
  };
}

/** Item names of a board, for the relation picker. */
export const useBoardItemNames = (boardId: string, q: string) =>
  useQuery({
    queryKey: ['item-names', boardId, q] as const,
    queryFn: () => api<{ items: { id: string; name: string }[] }>(`/boards/${boardId}/item-names?q=${encodeURIComponent(q)}`).then((r) => r.items),
    enabled: Boolean(boardId),
    staleTime: 15_000,
  });
export function useSetRelation(boardId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, columnId, itemIds }: { itemId: string; columnId: string; itemIds: string[] }) => api(`/items/${itemId}/relations/${columnId}`, 'PUT', { itemIds }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.board(boardId) });
      void qc.invalidateQueries({ queryKey: ['links'] });
    },
  });
}

export const useInvestigation = (itemId: string) =>
  useQuery({ queryKey: qk.investigation(itemId), queryFn: () => api<{ investigation: Investigation }>(`/items/${itemId}/investigation`).then((r) => r.investigation) });

export function useInvestigationMutations(itemId: string, boardId: string) {
  const qc = useQueryClient();
  return {
    save: useMutation({
      mutationFn: (input: InvestigationInput) => api<{ investigation: Investigation }>(`/items/${itemId}/investigation`, 'PUT', input).then((r) => r.investigation),
      onSuccess: (inv) => {
        qc.setQueryData(qk.investigation(itemId), inv);
        void qc.invalidateQueries({ queryKey: qk.itemActivity(itemId) });
      },
    }),
    action: useMutation({
      mutationFn: (input: { boardId: string; groupId: string; name: string }) => api<{ item: Item }>(`/items/${itemId}/investigation/action`, 'POST', input).then((r) => r.item),
      onSuccess: (_item, input) => {
        void qc.invalidateQueries({ queryKey: qk.links(itemId) });
        void qc.invalidateQueries({ queryKey: qk.board(input.boardId) });
        void qc.invalidateQueries({ queryKey: qk.board(boardId) });
      },
    }),
  };
}

export const useComplianceOverview = () =>
  useQuery({ queryKey: qk.compliance, queryFn: () => api<{ boards: BoardCompliance[] }>('/compliance').then((r) => r.boards) });

export const useBoardCompliance = (boardId: string) =>
  useQuery({ queryKey: qk.boardCompliance(boardId), queryFn: () => api<{ compliance: BoardCompliance | null }>(`/boards/${boardId}/compliance`).then((r) => r.compliance) });

export function useConfigureCompliance(boardId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (settings: ComplianceSettings) => api<{ compliance: BoardCompliance | null }>(`/boards/${boardId}/compliance`, 'PUT', { settings }).then((r) => r.compliance),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.compliance }),
  });
}

export const useBoardForms = (boardId: string) =>
  useQuery({ queryKey: qk.boardForms(boardId), queryFn: () => api<{ forms: BoardForm[] }>(`/boards/${boardId}/forms`).then((r) => r.forms) });

export function useFormMutations(boardId: string) {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.boardForms(boardId) });
    void qc.invalidateQueries({ queryKey: qk.forms });
    void qc.invalidateQueries({ queryKey: ['forms-managed'] });
  };
  return {
    duplicate: useMutation({ mutationFn: (id: string) => api<{ form: BoardForm }>(`/forms/${id}/duplicate`, 'POST', {}).then((r) => r.form), onSuccess: refresh }),
    create: useMutation({
      mutationFn: (input: CreateFormInput) => api<{ form: BoardForm }>(`/boards/${boardId}/forms`, 'POST', input).then((r) => r.form),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ id, patch }: { id: string; patch: Partial<CreateFormInput> }) => api<{ form: BoardForm }>(`/forms/${id}`, 'PATCH', patch).then((r) => r.form),
      onSuccess: refresh,
    }),
    remove: useMutation({ mutationFn: (id: string) => api(`/forms/${id}`, 'DELETE'), onSuccess: refresh }),
  };
}

/** Forms on boards I own (the management hub). */
export const useManagedForms = (enabled = true) => useQuery({ queryKey: ['forms-managed'], enabled, queryFn: () => api<{ forms: BoardForm[] }>('/forms/managed').then((r) => r.forms) });
/** Hub actions that are not tied to one board's cache. */
export function useManagedFormActions() {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['forms-managed'] });
    void qc.invalidateQueries({ queryKey: qk.forms });
    void qc.invalidateQueries({ queryKey: ['board-forms'] });
  };
  return {
    toggle: useMutation({ mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => api<{ form: BoardForm }>(`/forms/${id}`, 'PATCH', { enabled }), onSuccess: refresh }),
    duplicate: useMutation({ mutationFn: (id: string) => api<{ form: BoardForm }>(`/forms/${id}/duplicate`, 'POST', {}).then((r) => r.form), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: string) => api(`/forms/${id}`, 'DELETE'), onSuccess: refresh }),
  };
}
export const useAvailableForms = () => useQuery({ queryKey: qk.forms, queryFn: () => api<{ forms: BoardForm[] }>('/forms').then((r) => r.forms) });
export const useFormForFill = (id: string) =>
  useQuery({ queryKey: qk.form(id), queryFn: () => api<{ form: FormForFill }>(`/forms/${id}`).then((r) => r.form), retry: false });
export const useMySubmissions = () =>
  useQuery({ queryKey: qk.mySubmissions, queryFn: () => api<{ submissions: MySubmission[] }>('/forms/mine').then((r) => r.submissions) });

export function useSubmitForm(id: string) {
  const qc = useQueryClient();
  return {
    submit: useMutation({
      mutationFn: (input: { name: string; values: Record<string, unknown> }) => api<{ itemId: string; ref: string }>(`/forms/${id}/submit`, 'POST', input),
      onSuccess: () => void qc.invalidateQueries({ queryKey: qk.mySubmissions }),
    }),
    photo: useMutation({
      mutationFn: ({ itemId, file }: { itemId: string; file: File }) => uploadFile(`/forms/${id}/items/${itemId}/attachments`, file),
    }),
  };
}

// ------------------------------------------------------------------ wave D
export const useDashboards = () => useQuery({ queryKey: qk.dashboards, queryFn: () => api<{ dashboards: CustomDashboard[] }>('/dashboards').then((r) => r.dashboards) });
export const useCustomDashboard = (id: string) =>
  useQuery({ queryKey: qk.customDashboard(id), queryFn: () => api<{ dashboard: CustomDashboard }>(`/dashboards/${id}`).then((r) => r.dashboard), retry: false });
export const useDashboardData = (id: string, enabled = true) =>
  useQuery({ queryKey: qk.dashboardData(id), queryFn: () => api<{ data: Record<string, WidgetData> }>(`/dashboards/${id}/data`).then((r) => r.data), enabled, refetchInterval: 5 * 60_000 });

export function useDashboardMutations() {
  const qc = useQueryClient();
  const refresh = (id?: string) => {
    void qc.invalidateQueries({ queryKey: qk.dashboards });
    if (id) {
      void qc.invalidateQueries({ queryKey: qk.customDashboard(id) });
      void qc.invalidateQueries({ queryKey: qk.dashboardData(id) });
    }
  };
  return {
    create: useMutation({
      mutationFn: (input: { name: string; shared?: boolean; widgets?: WidgetInput[] }) => api<{ dashboard: CustomDashboard }>('/dashboards', 'POST', input).then((r) => r.dashboard),
      onSuccess: () => refresh(),
    }),
    update: useMutation({
      mutationFn: ({ id, patch }: { id: string; patch: { name?: string; shared?: boolean; widgets?: WidgetInput[] } }) =>
        api<{ dashboard: CustomDashboard }>(`/dashboards/${id}`, 'PATCH', patch).then((r) => r.dashboard),
      onSuccess: (d) => refresh(d.id),
    }),
    remove: useMutation({ mutationFn: (id: string) => api(`/dashboards/${id}`, 'DELETE'), onSuccess: () => refresh() }),
  };
}

export const useTrend = (boardIds: string[], period: 'week' | 'month', count: number) =>
  useQuery({
    queryKey: qk.trend(`${boardIds.join(',')}|${period}|${count}`),
    queryFn: () => api<{ points: TrendPoint[] }>(`/analytics/trend?boards=${boardIds.join(',')}&period=${period}&count=${count}`).then((r) => r.points),
  });
export const useWorkload = () => useQuery({ queryKey: qk.workload, queryFn: () => api<{ rows: WorkloadRow[] }>('/workload').then((r) => r.rows) });
export const useMonthlyReport = (month: string) =>
  useQuery({ queryKey: qk.monthly(month), queryFn: () => api<{ report: MonthlyReport }>(`/reports/monthly${month ? `?month=${month}` : ''}`).then((r) => r.report), retry: false });

export const useDependencies = (itemId: string) =>
  useQuery({ queryKey: qk.dependencies(itemId), queryFn: () => api<{ dependencies: DependencyInfo }>(`/items/${itemId}/dependencies`).then((r) => r.dependencies) });
export const useBoardDependencies = (boardId: string, enabled = true) =>
  useQuery({
    queryKey: qk.boardDependencies(boardId),
    queryFn: () => api<{ dependencies: { blocker: string; blocked: string }[] }>(`/boards/${boardId}/dependencies`).then((r) => r.dependencies),
    enabled,
  });
export function useSetDependencies(itemId: string, boardId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (blockedBy: string[]) => api<{ dependencies: DependencyInfo }>(`/items/${itemId}/dependencies`, 'PUT', { blockedBy }).then((r) => r.dependencies),
    onSuccess: (d) => {
      qc.setQueryData(qk.dependencies(itemId), d);
      void qc.invalidateQueries({ queryKey: qk.boardDependencies(boardId) });
      void qc.invalidateQueries({ queryKey: ['dependencies'] });
      void qc.invalidateQueries({ queryKey: qk.itemActivity(itemId) });
    },
  });
}

// ------------------------------------------------------------------ wave E
export const useTrainings = () => useQuery({ queryKey: qk.trainings, queryFn: () => api<{ trainings: Training[] }>('/trainings').then((r) => r.trainings) });
export const useTrainingMatrix = () => useQuery({ queryKey: qk.trainingMatrix, queryFn: () => api<{ matrix: TrainingMatrix }>('/trainings/matrix').then((r) => r.matrix) });
export const useMyTrainings = () => useQuery({ queryKey: qk.myTrainings, queryFn: () => api<{ trainings: MyTraining[] }>('/me/trainings').then((r) => r.trainings) });

export function useTrainingMutations() {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.trainings });
    void qc.invalidateQueries({ queryKey: qk.trainingMatrix });
    void qc.invalidateQueries({ queryKey: qk.myTrainings });
  };
  return {
    create: useMutation({ mutationFn: (input: { name: string; description?: string; validityMonths: number; allUsers: boolean }) => api<{ training: Training }>('/trainings', 'POST', input), onSuccess: refresh }),
    update: useMutation({
      mutationFn: ({ id, patch }: { id: string; patch: { name?: string; description?: string; validityMonths?: number; allUsers?: boolean } }) => api(`/trainings/${id}`, 'PATCH', patch),
      onSuccess: refresh,
    }),
    remove: useMutation({ mutationFn: (id: string) => api(`/trainings/${id}`, 'DELETE'), onSuccess: refresh }),
    requirements: useMutation({ mutationFn: ({ id, userIds }: { id: string; userIds: string[] }) => api(`/trainings/${id}/requirements`, 'PUT', { userIds }), onSuccess: refresh }),
    record: useMutation({
      mutationFn: ({ id, ...input }: { id: string; userIds: string[]; completedOn: string; note?: string }) => api<{ added: number }>(`/trainings/${id}/records`, 'POST', input),
      onSuccess: refresh,
    }),
    removeRecord: useMutation({ mutationFn: (recordId: string) => api(`/training-records/${recordId}`, 'DELETE'), onSuccess: refresh }),
  };
}

export const useProcedures = () => useQuery({ queryKey: qk.procedures, queryFn: () => api<{ procedures: Procedure[] }>('/procedures').then((r) => r.procedures) });
export const useProcedure = (id: string) => useQuery({ queryKey: qk.procedure(id), queryFn: () => api<{ procedure: Procedure }>(`/procedures/${id}`).then((r) => r.procedure), retry: false });
export const useProcedureAcks = (id: string, enabled: boolean) =>
  useQuery({ queryKey: qk.procedureAcks(id), queryFn: () => api<{ report: ProcedureAckReport }>(`/procedures/${id}/acks`).then((r) => r.report), enabled });
export const useMyProcedures = () => useQuery({ queryKey: qk.myProcedures, queryFn: () => api<{ procedures: Procedure[] }>('/me/procedures').then((r) => r.procedures) });

export function useProcedureMutations() {
  const qc = useQueryClient();
  const done = (p: Procedure) => {
    qc.setQueryData(qk.procedure(p.id), p);
    void qc.invalidateQueries({ queryKey: qk.procedures });
    void qc.invalidateQueries({ queryKey: qk.myProcedures });
    void qc.invalidateQueries({ queryKey: qk.procedureAcks(p.id) });
  };
  return {
    create: useMutation({
      mutationFn: (input: { code: string; title: string; category?: string; audience: 'all' | 'users'; userIds: string[] }) => api<{ procedure: Procedure }>('/procedures', 'POST', input).then((r) => r.procedure),
      onSuccess: done,
    }),
    update: useMutation({
      mutationFn: ({ id, patch }: { id: string; patch: { title?: string; category?: string; audience?: 'all' | 'users'; userIds?: string[] } }) => api<{ procedure: Procedure }>(`/procedures/${id}`, 'PATCH', patch).then((r) => r.procedure),
      onSuccess: done,
    }),
    publish: useMutation({
      mutationFn: ({ id, input }: { id: string; input: ProcedureVersionInput }) => api<{ procedure: Procedure }>(`/procedures/${id}/versions`, 'POST', input).then((r) => r.procedure),
      onSuccess: done,
    }),
    ack: useMutation({ mutationFn: (versionId: string) => api<{ procedure: Procedure }>(`/procedure-versions/${versionId}/ack`, 'POST', {}).then((r) => r.procedure), onSuccess: done }),
  };
}

export const usePlans = (boardId: string) =>
  useQuery({ queryKey: qk.plans(boardId), queryFn: () => api<{ plans: { id: string; name: string; itemId: string; itemName: string; pins: number }[] }>(`/boards/${boardId}/plans`).then((r) => r.plans) });
export const usePins = (attachmentId: string) => useQuery({ queryKey: qk.pins(attachmentId), queryFn: () => api<{ pins: PlanPin[] }>(`/attachments/${attachmentId}/pins`).then((r) => r.pins), retry: false });
export function useSavePins(attachmentId: string, boardId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pins: PlanPin[]) => api<{ pins: PlanPin[] }>(`/attachments/${attachmentId}/pins`, 'PUT', { pins }).then((r) => r.pins),
    onSuccess: (pins) => {
      qc.setQueryData(qk.pins(attachmentId), pins);
      void qc.invalidateQueries({ queryKey: qk.plans(boardId) });
    },
  });
}

// ------------------------------------------------------------------ wave H
export const useSessions = () => useQuery({ queryKey: qk.sessions, queryFn: () => api<{ sessions: ActiveSession[] }>('/auth/sessions').then((r) => r.sessions) });
export function useSessionMutations() {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: qk.sessions });
  return {
    revoke: useMutation({ mutationFn: (handle: string) => api<{ ok: true; signedOut: boolean }>(`/auth/sessions/${handle}`, 'DELETE'), onSuccess: refresh }),
    revokeOthers: useMutation({ mutationFn: () => api<{ sessions: ActiveSession[] }>('/auth/sessions/revoke-others', 'POST', {}), onSuccess: refresh }),
  };
}
export function useToggleVote(boardId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, columnId }: { itemId: string; columnId: string }) => api<{ votes: string[] }>(`/items/${itemId}/vote/${columnId}`, 'POST', {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.board(boardId) }),
  });
}
export const useItemTime = (itemId: string) => useQuery({ queryKey: ['item-time', itemId] as const, queryFn: () => api<{ time: ItemTime }>(`/items/${itemId}/time`).then((r) => r.time) });
export function useTimeMutations(boardId: string, itemId: string) {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.board(boardId) });
    void qc.invalidateQueries({ queryKey: ['item-time', itemId] });
  };
  return {
    start: useMutation({ mutationFn: () => api(`/items/${itemId}/time/start`, 'POST', {}), onSuccess: refresh }),
    stop: useMutation({ mutationFn: () => api(`/items/${itemId}/time/stop`, 'POST', {}), onSuccess: refresh }),
    addManual: useMutation({ mutationFn: (input: { minutes: number; date: string; note?: string }) => api(`/items/${itemId}/time`, 'POST', input), onSuccess: refresh }),
    update: useMutation({ mutationFn: ({ id, ...input }: { id: string; minutes: number; date: string; note?: string }) => api(`/time/${id}`, 'PATCH', input), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: string) => api(`/time/${id}`, 'DELETE'), onSuccess: refresh }),
  };
}
export const useApiTokens = () => useQuery({ queryKey: ['api-tokens'] as const, queryFn: () => api<{ tokens: ApiTokenInfo[] }>('/auth/tokens').then((r) => r.tokens) });
export function useApiTokenMutations() {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: ['api-tokens'] });
  return {
    create: useMutation({ mutationFn: (input: { name: string; scope: 'read' | 'write'; days: 30 | 90 | 365 }) => api<{ token: string; info: ApiTokenInfo }>('/auth/tokens', 'POST', input), onSuccess: refresh }),
    revoke: useMutation({ mutationFn: (id: string) => api(`/auth/tokens/${id}`, 'DELETE'), onSuccess: refresh }),
  };
}
export const useWebhooks = (boardId: string) => useQuery({ queryKey: ['webhooks', boardId] as const, queryFn: () => api<{ webhooks: Webhook[] }>(`/boards/${boardId}/webhooks`).then((r) => r.webhooks) });
export const useWebhookDeliveries = (id: string) => useQuery({ queryKey: ['webhook-deliveries', id] as const, queryFn: () => api<{ deliveries: WebhookDelivery[] }>(`/webhooks/${id}/deliveries`).then((r) => r.deliveries) });
export function useWebhookMutations(boardId: string) {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['webhooks', boardId] });
    void qc.invalidateQueries({ queryKey: ['webhook-deliveries'] });
  };
  return {
    create: useMutation({ mutationFn: (input: { url: string; events: WebhookEvent[] }) => api<{ webhook: Webhook; secret: string }>(`/boards/${boardId}/webhooks`, 'POST', input), onSuccess: refresh }),
    update: useMutation({ mutationFn: ({ id, patch }: { id: string; patch: { active?: boolean; events?: WebhookEvent[] } }) => api(`/webhooks/${id}`, 'PATCH', patch), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: string) => api(`/webhooks/${id}`, 'DELETE'), onSuccess: refresh }),
    test: useMutation({ mutationFn: (id: string) => api<{ delivery: WebhookDelivery }>(`/webhooks/${id}/test`, 'POST', {}).then((r) => r.delivery), onSettled: refresh }),
  };
}
export const useWorkspaces = () => useQuery({ queryKey: qk.workspaces, queryFn: () => api<{ workspaces: Workspace[] }>('/workspaces').then((r) => r.workspaces), staleTime: 60_000 });
export function useWorkspaceMutations() {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.workspaces });
    void qc.invalidateQueries({ queryKey: qk.boards });
  };
  return {
    create: useMutation({ mutationFn: (name: string) => api<{ workspace: Workspace }>('/workspaces', 'POST', { name }).then((r) => r.workspace), onSuccess: refresh }),
    rename: useMutation({ mutationFn: ({ id, name }: { id: string; name: string }) => api(`/workspaces/${id}`, 'PATCH', { name }), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: string) => api(`/workspaces/${id}`, 'DELETE'), onSuccess: refresh }),
    addFolder: useMutation({ mutationFn: ({ workspaceId, name }: { workspaceId: string; name: string }) => api<{ folder: { id: string; name: string } }>(`/workspaces/${workspaceId}/folders`, 'POST', { name }).then((r) => r.folder), onSuccess: refresh }),
    renameFolder: useMutation({ mutationFn: ({ id, name }: { id: string; name: string }) => api(`/folders/${id}`, 'PATCH', { name }), onSuccess: refresh }),
    removeFolder: useMutation({ mutationFn: (id: string) => api(`/folders/${id}`, 'DELETE'), onSuccess: refresh }),
    moveBoard: useMutation({
      mutationFn: ({ boardId, workspaceId, folderId = null }: { boardId: string; workspaceId: string | null; folderId?: string | null }) => api(`/boards/${boardId}/workspace`, 'PUT', { workspaceId, folderId }),
      onSuccess: (_r, v) => {
        refresh();
        void qc.invalidateQueries({ queryKey: qk.board(v.boardId) });
      },
    }),
  };
}

/** Which optional modules are switched on (drives the menu and route guards). */
export const useModules = (enabled = true) =>
  useQuery({ queryKey: qk.modules, queryFn: () => api<{ modules: ModuleState }>('/modules').then((r) => r.modules), staleTime: 60_000, enabled });
export const useSetModules = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (modules: Partial<ModuleState>) => api<{ modules: ModuleState }>('/admin/modules', 'PUT', { modules }).then((r) => r.modules),
    onSuccess: (m) => qc.setQueryData(qk.modules, m),
  });
};
export const usePasskeys = () => useQuery({ queryKey: qk.passkeys, queryFn: () => api<{ passkeys: PasskeyInfo[] }>('/auth/passkeys').then((r) => r.passkeys) });
export const useRemovePasskey = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api(`/auth/passkeys/${id}`, 'DELETE'), onSuccess: () => void qc.invalidateQueries({ queryKey: qk.passkeys }) });
};
export const useRevokeUserSessions = () => useMutation({ mutationFn: (userId: string) => api(`/users/${userId}/revoke-sessions`, 'POST', {}) });

export const useRecentBoards = (enabled = true) => useQuery({ queryKey: qk.recentBoards, enabled, queryFn: () => api<{ boards: RecentBoard[] }>('/me/recent-boards').then((r) => r.boards) });
export function useToggleFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ boardId, on }: { boardId: string; on: boolean }) => api<{ favorite: boolean }>(`/boards/${boardId}/favorite`, on ? 'PUT' : 'DELETE', on ? {} : undefined),
    onSuccess: (r, { boardId }) => {
      qc.setQueryData<BoardSummary[]>(qk.boards, (list) => list?.map((b) => (b.id === boardId ? { ...b, favorite: r.favorite } : b)));
      qc.setQueryData<BoardDetail>(qk.board(boardId), (b) => (b ? { ...b, favorite: r.favorite } : b));
      void qc.invalidateQueries({ queryKey: qk.recentBoards });
    },
  });
}

export const useFollow = (itemId: string) => useQuery({ queryKey: qk.follow(itemId), queryFn: () => api<{ follow: FollowState }>(`/items/${itemId}/follow`).then((r) => r.follow) });
export function useToggleFollow(itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (on: boolean) => api<{ follow: FollowState }>(`/items/${itemId}/follow`, on ? 'PUT' : 'DELETE', on ? {} : undefined).then((r) => r.follow),
    onSuccess: (f) => qc.setQueryData(qk.follow(itemId), f),
  });
}

export const useBoardFiles = (boardId: string) =>
  useQuery({ queryKey: qk.boardFiles(boardId), queryFn: () => api<{ files: BoardFile[] }>(`/boards/${boardId}/files`).then((r) => r.files) });

// ------------------------------------------------------------------ wave J
export const useMyWork = () => useQuery({ queryKey: qk.myWork, queryFn: () => api<{ items: MyWorkItem[] }>('/me/work').then((r) => r.items) });
/** Mark an item done from "My work" (sets the board's primary status to its "done" option). */
export function useCompleteWork() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, columnId, optionId }: { itemId: string; boardId: string; columnId: string; optionId: string | null }) =>
      api<{ item: Item }>(`/items/${itemId}`, 'PATCH', { values: { [columnId]: optionId } }).then((r) => r.item),
    onSuccess: (_i, v) => {
      void qc.invalidateQueries({ queryKey: qk.myWork });
      void qc.invalidateQueries({ queryKey: qk.board(v.boardId) });
      void qc.invalidateQueries({ queryKey: qk.dashboard });
    },
  });
}

// ------------------------------------------------------------------ wave K
/** Form builder: creates the responses board and the form in one call. */
export function useQuickForm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: QuickFormInput) => api<{ form: BoardForm; boardId: string }>('/forms/quick', 'POST', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['forms-managed'] });
      void qc.invalidateQueries({ queryKey: qk.forms });
      void qc.invalidateQueries({ queryKey: qk.boards });
    },
  });
}

// ------------------------------------------------------------------ wave M
export const useItemPersonal = (itemId: string) => useQuery({ queryKey: ['item-personal', itemId], queryFn: () => api<{ personal: ItemPersonal }>(`/items/${itemId}/personal`).then((r) => r.personal) });
export const useItemTemplates = (boardId: string) => useQuery({ queryKey: ['item-templates', boardId], queryFn: () => api<{ templates: ItemTemplate[] }>(`/boards/${boardId}/item-templates`).then((r) => r.templates) });
export function usePersonalMutations(itemId: string, boardId = '') {
  const qc = useQueryClient();
  const mine = () => void qc.invalidateQueries({ queryKey: ['item-personal', itemId] });
  const templates = () => void qc.invalidateQueries({ queryKey: ['item-templates', boardId] });
  return {
    addReminder: useMutation({ mutationFn: (input: { remindAt: string; note: string }) => api<{ reminder: ItemReminder }>(`/items/${itemId}/reminders`, 'POST', input).then((r) => r.reminder), onSuccess: mine }),
    removeReminder: useMutation({ mutationFn: (id: string) => api(`/reminders/${id}`, 'DELETE'), onSuccess: mine }),
    saveNote: useMutation({ mutationFn: (body: string) => api<{ note: string }>(`/items/${itemId}/note`, 'PUT', { body }), onSuccess: mine }),
    saveTemplate: useMutation({ mutationFn: (name: string) => api<{ template: ItemTemplate }>(`/items/${itemId}/save-as-template`, 'POST', { name }).then((r) => r.template), onSuccess: templates }),
    useTemplate: useMutation({
      mutationFn: ({ templateId, groupId }: { templateId: string; groupId: string }) => api<{ item: Item }>(`/item-templates/${templateId}/use`, 'POST', { groupId }).then((r) => r.item),
      onSuccess: () => void qc.invalidateQueries({ queryKey: qk.board(boardId) }),
    }),
    removeTemplate: useMutation({ mutationFn: (id: string) => api(`/item-templates/${id}`, 'DELETE'), onSuccess: templates }),
  };
}
