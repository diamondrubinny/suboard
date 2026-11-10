import type {
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
import { api } from './client';

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
};

// ------------------------------------------------------------------ queries
export const useBoards = () => useQuery({ queryKey: qk.boards, queryFn: () => api<{ boards: BoardSummary[] }>('/boards').then((r) => r.boards) });

export const useBoard = (id: string) =>
  useQuery({ queryKey: qk.board(id), queryFn: () => api<{ board: BoardDetail }>(`/boards/${id}`).then((r) => r.board) });

export const useDirectory = () =>
  useQuery({ queryKey: qk.directory, queryFn: () => api<{ users: DirectoryUser[] }>('/users/directory').then((r) => r.users), staleTime: 5 * 60_000 });

export const useTemplates = () =>
  useQuery({ queryKey: qk.templates, queryFn: () => api<{ templates: TemplateInfo[] }>('/templates').then((r) => r.templates), staleTime: Infinity });

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
    mutationFn: (input: { name: string; description?: string; templateKey: string }) => api<{ board: BoardDetail }>('/boards', 'POST', input).then((r) => r.board),
    onSuccess: (board) => {
      qc.setQueryData(qk.board(board.id), board);
      void qc.invalidateQueries({ queryKey: qk.boards });
    },
  });
}

export function useUpdateBoard(boardId: string) {
  const { qc, refresh } = useBoardCache(boardId);
  return useMutation({
    mutationFn: (input: { name?: string; description?: string }) => api<{ board: BoardDetail }>(`/boards/${boardId}`, 'PATCH', input).then((r) => r.board),
    onSuccess: (board) => {
      qc.setQueryData(qk.board(boardId), board);
      refresh();
    },
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
    mutationFn: (input: { groupId: string; name: string; values?: Record<string, unknown> }) =>
      api<{ item: Item }>(`/boards/${boardId}/items`, 'POST', input).then((r) => r.item),
    onSuccess: (item) => {
      update((b) => ({ ...b, items: [...b.items, item] }));
      void qc.invalidateQueries({ queryKey: qk.dashboard });
    },
  });
}

export function useUpdateItem(boardId: string) {
  const { update, qc } = useBoardCache(boardId);
  return useMutation({
    mutationFn: ({ itemId, patch }: { itemId: string; patch: { name?: string; groupId?: string; values?: Record<string, unknown> } }) =>
      api<{ item: Item }>(`/items/${itemId}`, 'PATCH', patch).then((r) => r.item),
    // Optimistic update; rolled back on error.
    onMutate: ({ itemId, patch }) => {
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
    onError: (_e, _v, context) => {
      if (context?.previous) qc.setQueryData(qk.board(boardId), context.previous);
    },
    onSuccess: (item) => {
      update((b) => ({ ...b, items: b.items.map((i) => (i.id === item.id ? item : i)) }));
      void qc.invalidateQueries({ queryKey: qk.itemActivity(item.id) });
      void qc.invalidateQueries({ queryKey: qk.dashboard });
    },
  });
}

export function useDeleteItem(boardId: string) {
  const { update, qc } = useBoardCache(boardId);
  return useMutation({
    mutationFn: (itemId: string) => api(`/items/${itemId}`, 'DELETE').then(() => itemId),
    onSuccess: (itemId) => {
      update((b) => ({ ...b, items: b.items.filter((i) => i.id !== itemId) }));
      void qc.invalidateQueries({ queryKey: qk.dashboard });
    },
  });
}

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
      mutationFn: ({ columnId, patch }: { columnId: string; patch: { title?: string; settings?: ColumnSettings; position?: number } }) =>
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
    add: useMutation({ mutationFn: (body: string) => api(`/items/${itemId}/updates`, 'POST', { body }), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (updateId: string) => api(`/updates/${updateId}`, 'DELETE'), onSuccess: refresh }),
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
      mutationFn: ({ id, patch }: { id: string; patch: { name?: string; role?: GlobalRole; isActive?: boolean; password?: string; unlock?: true } }) =>
        api<{ user: AdminUser }>(`/users/${id}`, 'PATCH', patch),
      onSuccess: refresh,
    }),
  };
}
