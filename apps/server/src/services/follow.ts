import type { FollowState } from '@suboard/shared';
import { nowIso, type DB } from '../db/index.js';
import type { AccessService, Actor } from './access.js';
import type { BoardService } from './boards.js';
import type { CommentEvent, ItemEvent, ItemService } from './items.js';
import type { NotificationService } from './notifications.js';

/**
 * Item following. Creators, update writers and assignees follow automatically; anyone who can see
 * the board may follow or unfollow. Followers hear about new updates and status / group changes by
 * someone else (never their own, never automation changes) — one unread notice per item at a time.
 */
export class FollowService {
  constructor(
    private readonly db: DB,
    private readonly access: AccessService,
    private readonly boards: BoardService,
    private readonly items: ItemService,
    private readonly notifications: NotificationService,
  ) {
    items.onItemEvent((e) => this.handleEvent(e));
    items.onComment((e) => this.handleComment(e));
  }

  state(actor: Actor, itemId: string): FollowState {
    this.access.requireBoard(actor, this.access.boardIdForItem(itemId), 'viewer');
    return this.stateOf(actor.id, itemId);
  }

  set(actor: Actor, itemId: string, on: boolean): FollowState {
    this.access.requireBoard(actor, this.access.boardIdForItem(itemId), 'viewer');
    if (on) this.follow(itemId, [actor.id]);
    else this.db.prepare('DELETE FROM item_followers WHERE item_id = ? AND user_id = ?').run(itemId, actor.id);
    return this.stateOf(actor.id, itemId);
  }

  private stateOf(userId: string, itemId: string): FollowState {
    const count = (this.db.prepare('SELECT COUNT(*) AS n FROM item_followers WHERE item_id = ?').get(itemId) as { n: number }).n;
    const following = this.db.prepare('SELECT 1 FROM item_followers WHERE item_id = ? AND user_id = ?').get(itemId, userId) !== undefined;
    return { following, count };
  }

  private follow(itemId: string, userIds: Iterable<string>): void {
    const ins = this.db.prepare('INSERT OR IGNORE INTO item_followers (item_id, user_id, created_at) VALUES (?, ?, ?)');
    const ts = nowIso();
    for (const id of new Set(userIds)) ins.run(itemId, id, ts);
  }

  private followers(itemId: string): string[] {
    return (this.db.prepare('SELECT user_id FROM item_followers WHERE item_id = ?').all(itemId) as { user_id: string }[]).map((r) => r.user_id);
  }

  private handleEvent(e: ItemEvent): void {
    if (!e.actorId) return;
    const added = this.items.newAssignees(e.boardId, e.before?.values ?? {}, e.after.values);
    if (e.kind === 'created') {
      this.follow(e.after.id, [e.actorId, ...added]);
      return;
    }
    if (added.length) this.follow(e.after.id, added);
    const before = e.before!;
    const statusChanged = this.boards
      .columns(e.boardId)
      .some((c) => c.type === 'status' && JSON.stringify(before.values[c.id] ?? null) !== JSON.stringify(e.after.values[c.id] ?? null));
    const moved = before.groupId !== e.after.groupId;
    if (!statusChanged && !moved) return;
    const skip = new Set([e.actorId, ...added]); // new assignees already got "assigned"
    const to = this.followers(e.after.id).filter((id) => !skip.has(id));
    if (to.length) this.notifications.onFollowed(e.actorId, e.boardId, e.after.id, e.after.name, statusChanged ? 'status' : 'moved', to);
  }

  private handleComment(e: CommentEvent): void {
    this.follow(e.itemId, [e.actor.id]);
    const skip = new Set([e.actor.id, ...e.notified]);
    const to = this.followers(e.itemId).filter((id) => !skip.has(id));
    if (to.length) this.notifications.onFollowed(e.actor.id, e.boardId, e.itemId, e.itemName, 'update', to);
  }
}
