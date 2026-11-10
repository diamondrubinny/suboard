import type { Attachment, AttachmentStatus } from '@suboard/shared';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from '../config.js';
import { nowIso, type DB } from '../db/index.js';
import type { Scanner } from '../lib/clamav.js';
import { newId } from '../lib/crypto.js';
import { AppError, badRequest, forbidden, notFound } from '../lib/errors.js';
import { detectType, extensionMatches, sanitizeFilename } from '../lib/filetype.js';
import type { AccessService, Actor } from './access.js';
import type { ActivityService } from './activity.js';
import type { AuditService } from './audit.js';

export const MAX_ATTACHMENTS_PER_ITEM = 20;

interface Row {
  id: string;
  item_id: string;
  board_id: string;
  uploaded_by: string | null;
  uploader_name: string | null;
  original_name: string;
  mime: string;
  size: number;
  sha256: string;
  status: AttachmentStatus;
  created_at: string;
}

const toAttachment = (r: Row): Attachment => ({
  id: r.id,
  itemId: r.item_id,
  originalName: r.original_name,
  mime: r.mime,
  size: r.size,
  status: r.status,
  uploadedBy: r.uploaded_by,
  uploaderName: r.uploader_name,
  createdAt: r.created_at,
});

/**
 * Attachment pipeline: validate (size, magic bytes, extension) → write to quarantine/ under a
 * random name → scan with ClamAV → move to store/ only when clean. Anything else is never served.
 * Files live outside the web root and are never executed or parsed by the server.
 */
export class AttachmentService {
  private readonly quarantineDir: string;
  private readonly storeDir: string;

  constructor(
    private readonly db: DB,
    private readonly config: AppConfig,
    private readonly access: AccessService,
    private readonly activity: ActivityService,
    private readonly audit: AuditService,
    private readonly scanner: Scanner | null,
    private log: Pick<FastifyBaseLogger, 'error' | 'warn'> = console,
  ) {
    const root = resolve(config.uploadDir);
    this.quarantineDir = join(root, 'quarantine');
    this.storeDir = join(root, 'store');
    mkdirSync(this.quarantineDir, { recursive: true, mode: 0o700 });
    mkdirSync(this.storeDir, { recursive: true, mode: 0o700 });
  }

  setLogger(log: Pick<FastifyBaseLogger, 'error' | 'warn'>) {
    this.log = log;
  }

  get scannerName(): string | null {
    return this.scanner?.name ?? null;
  }

  private select(where: string) {
    return `SELECT a.*, u.name AS uploader_name FROM attachments a LEFT JOIN users u ON u.id = a.uploaded_by WHERE ${where}`;
  }

  list(actor: Actor, itemId: string): Attachment[] {
    this.access.requireBoard(actor, this.access.boardIdForItem(itemId), 'viewer');
    return (this.db.prepare(`${this.select('a.item_id = ?')} ORDER BY a.created_at DESC`).all(itemId) as Row[]).map(toAttachment);
  }

  /**
   * `asSubmitter`: the caller (FormService) already verified that the actor submitted this item through
   * a form that allows photos, within the time window — board membership is then not required.
   */
  async upload(actor: Actor, itemId: string, file: { filename: string; data: Buffer }, ip: string, opts: { asSubmitter?: true; maxFiles?: number } = {}): Promise<Attachment> {
    const boardId = this.access.boardIdForItem(itemId);
    if (!opts.asSubmitter) this.access.requireBoard(actor, boardId, 'editor');
    if (opts.maxFiles !== undefined) {
      const mine = (this.db.prepare('SELECT COUNT(*) AS n FROM attachments WHERE item_id = ? AND uploaded_by = ?').get(itemId, actor.id) as { n: number }).n;
      if (mine >= opts.maxFiles) throw badRequest(`ניתן לצרף עד ${opts.maxFiles} תמונות לדיווח`);
    }

    const count = (this.db.prepare('SELECT COUNT(*) AS n FROM attachments WHERE item_id = ?').get(itemId) as { n: number }).n;
    if (count >= MAX_ATTACHMENTS_PER_ITEM) throw badRequest(`ניתן לצרף עד ${MAX_ATTACHMENTS_PER_ITEM} קבצים לפריט`);
    if (file.data.length === 0) throw badRequest('הקובץ ריק');
    if (file.data.length > this.config.maxUploadBytes) throw new AppError(413, 'FILE_TOO_LARGE', 'הקובץ גדול מהמותר');

    const name = sanitizeFilename(file.filename);
    const type = detectType(file.data);
    if (!type || !extensionMatches(type, name)) {
      this.audit.log('upload_rejected', { userId: actor.id, ip, meta: { reason: type ? 'extension_mismatch' : 'type_not_allowed', itemId } });
      throw new AppError(415, 'FILE_TYPE_NOT_ALLOWED', 'סוג הקובץ אינו מותר. מותרים: PDF, PNG, JPG, WEBP, DOCX, XLSX (ללא מאקרו).');
    }

    const id = newId();
    const sha = createHash('sha256').update(file.data).digest('hex');
    // Row first, then file: the orphan sweeper only deletes files that have no row.
    this.db
      .prepare(
        `INSERT INTO attachments (id, item_id, board_id, uploaded_by, original_name, mime, size, sha256, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      )
      .run(id, itemId, boardId, actor.id, name, type.mime, file.data.length, sha, nowIso());
    try {
      await writeFile(join(this.quarantineDir, id), file.data, { mode: 0o600, flag: 'wx' });
    } catch (err) {
      this.db.prepare('DELETE FROM attachments WHERE id = ?').run(id);
      throw err;
    }
    this.activity.record(boardId, actor.id, 'attachment_added', { name }, itemId);

    await this.scanOne(id, file.data);
    return this.get(id);
  }

  private get(id: string): Attachment {
    const r = this.db.prepare(this.select('a.id = ?')).get(id) as Row | undefined;
    if (!r) throw notFound('הקובץ לא נמצא');
    return toAttachment(r);
  }

  /** Scans one quarantined file. Scanner errors leave it `pending` (fail closed) for a later retry. */
  private async scanOne(id: string, data: Buffer): Promise<void> {
    if (!this.scanner) return; // no scanner configured → stays quarantined
    let result;
    try {
      result = await this.scanner.scan(data);
    } catch (err) {
      this.log.warn({ err: err instanceof Error ? err.message : String(err), attachmentId: id }, 'malware scan unavailable; file stays in quarantine');
      return;
    }
    const row = this.db.prepare('SELECT board_id, uploaded_by, item_id FROM attachments WHERE id = ?').get(id) as
      | { board_id: string; uploaded_by: string | null; item_id: string }
      | undefined;
    if (!row) return;
    if (result.status === 'clean') {
      await rename(join(this.quarantineDir, id), join(this.storeDir, id));
      this.db.prepare("UPDATE attachments SET status = 'clean', scan_detail = ?, scanned_at = ? WHERE id = ?").run(this.scanner.name, nowIso(), id);
    } else {
      await rm(join(this.quarantineDir, id), { force: true });
      this.db.prepare("UPDATE attachments SET status = 'infected', scan_detail = ?, scanned_at = ? WHERE id = ?").run(result.signature, nowIso(), id);
      this.audit.log('malware_detected', { userId: row.uploaded_by, meta: { attachmentId: id, itemId: row.item_id, signature: result.signature } });
    }
  }

  /** Retries scanning of files left pending (e.g. scanner was down). */
  async rescanPending(): Promise<number> {
    if (!this.scanner) return 0;
    const pending = this.db.prepare("SELECT id FROM attachments WHERE status = 'pending' ORDER BY created_at LIMIT 50").all() as { id: string }[];
    for (const { id } of pending) {
      try {
        await this.scanOne(id, await readFile(join(this.quarantineDir, id)));
      } catch {
        this.db.prepare("UPDATE attachments SET status = 'error', scanned_at = ? WHERE id = ?").run(nowIso(), id);
      }
    }
    return pending.length;
  }

  /** Returns file metadata + absolute path for a clean attachment the actor may view. */
  resolveDownload(actor: Actor, id: string): { path: string; name: string; mime: string; size: number } {
    const r = this.db
      .prepare('SELECT a.* FROM attachments a JOIN items i ON i.id = a.item_id WHERE a.id = ? AND i.deleted_at IS NULL')
      .get(id) as Row | undefined;
    if (!r) throw notFound('הקובץ לא נמצא');
    this.access.requireBoard(actor, r.board_id, 'viewer');
    if (r.status !== 'clean') throw new AppError(409, 'NOT_SCANNED', 'הקובץ עדיין לא אושר בסריקת אבטחה ואינו זמין להורדה');
    return { path: join(this.storeDir, r.id), name: r.original_name, mime: r.mime, size: r.size };
  }

  async remove(actor: Actor, id: string): Promise<void> {
    const r = this.db
      .prepare('SELECT a.* FROM attachments a JOIN items i ON i.id = a.item_id WHERE a.id = ? AND i.deleted_at IS NULL')
      .get(id) as Row | undefined;
    if (!r) throw notFound('הקובץ לא נמצא');
    const role = this.access.requireBoard(actor, r.board_id, 'editor');
    if (r.uploaded_by !== actor.id && role !== 'owner') throw forbidden('ניתן למחוק רק קבצים שהעלית');
    this.db.prepare('DELETE FROM attachments WHERE id = ?').run(id);
    await rm(join(this.storeDir, id), { force: true });
    await rm(join(this.quarantineDir, id), { force: true });
    this.activity.record(r.board_id, actor.id, 'attachment_removed', { name: r.original_name }, r.item_id);
  }

  /** Housekeeping: delete files on disk with no DB row (e.g. after item/group deletion cascades). */
  sweepOrphans(): number {
    const known = new Set((this.db.prepare('SELECT id FROM attachments').all() as { id: string }[]).map((r) => r.id));
    let removed = 0;
    for (const dir of [this.quarantineDir, this.storeDir]) {
      for (const f of readdirSync(dir)) {
        if (!known.has(f)) {
          rmSync(join(dir, f), { force: true });
          removed++;
        }
      }
    }
    return removed;
  }
}
