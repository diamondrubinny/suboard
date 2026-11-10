import type { Attachment, BoardDetail } from '@suboard/shared';
import { useRef, useState } from 'react';
import { errorMessage } from '../../api/client';
import { useAttachmentMutations, useAttachments } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';
import { ErrorState, LoadingState, useFeedback } from '../../components/Feedback';
import { Link } from 'react-router-dom';
import { CameraButton } from '../../components/CameraButton';
import { Icon } from '../../components/Icon';
import { formatDateTime } from './activityText';

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx';

const STATUS: Record<Attachment['status'], { label: string; cls: string }> = {
  clean: { label: 'נסרק — תקין', cls: 'badge success' },
  pending: { label: 'בהסגר — ממתין לסריקה', cls: 'badge warning' },
  infected: { label: 'נחסם — זוהה תוכן זדוני', cls: 'badge danger' },
  error: { label: 'שגיאת סריקה — לא זמין', cls: 'badge danger' },
};

/** Unicode first-strong isolate: keeps "שם.pdf" from flipping inside Hebrew sentences. */
const iso = (s: string) => `\u2068${s}\u2069`;

const formatSize = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

export function AttachmentsPanel({ board, itemId }: { board: BoardDetail; itemId: string }) {
  const { user } = useAuth();
  const q = useAttachments(itemId);
  const { upload, remove } = useAttachmentMutations(itemId);
  const { toast, confirm } = useFeedback();
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const canEdit = board.myRole !== 'viewer';
  const maxBytes = q.data?.maxBytes ?? 10 * 1024 * 1024;

  const send = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    for (const file of Array.from(files)) {
      if (file.size > maxBytes) {
        setError(`"${iso(file.name)}" גדול מהמותר (${formatSize(maxBytes)})`);
        continue;
      }
      try {
        const { attachment } = await upload.mutateAsync(file);
        if (attachment.status === 'clean') toast(`"${iso(attachment.originalName)}" הועלה ונסרק בהצלחה`);
        else if (attachment.status === 'infected') toast(`"${iso(attachment.originalName)}" נחסם: זוהה תוכן זדוני`, 'error');
        else toast(`"${iso(attachment.originalName)}" הועלה וממתין לסריקת אבטחה`);
      } catch (err) {
        setError(`${iso(file.name)}: ${errorMessage(err)}`);
      }
    }
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <>
      {canEdit && (
        <div
          className="dropzone"
          data-over={over}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            void send(e.dataTransfer.files);
          }}
        >
          <div className="toolbar">
            <label htmlFor="attach-input" className="btn" style={{ cursor: 'pointer' }}>
              <Icon name="paperclip" /> בחירת קבצים
            </label>
            <CameraButton disabled={upload.isPending} onFiles={(f) => void send(f)} />
          </div>
          <input
            id="attach-input"
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPT}
            className="sr-only"
            aria-describedby="attach-hint"
            onChange={(e) => void send(e.target.files)}
            disabled={upload.isPending}
          />
          <p id="attach-hint" className="hint muted" style={{ margin: '0.5rem 0 0' }}>
            או גררו לכאן. PDF, PNG, JPG, WEBP, DOCX, XLSX (ללא מאקרו), עד {formatSize(maxBytes)}. כל קובץ נסרק לאיתור נוזקות לפני שיהיה זמין להורדה.
          </p>
          {upload.isPending && (
            <p role="status" aria-live="polite">
              מעלה וסורק…
            </p>
          )}
        </div>
      )}
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      {q.data && !q.data.scanner && (
        <p className="draft-banner" role="note">
          סורק הנוזקות אינו מוגדר בשרת: קבצים חדשים יישארו בהסגר ולא יהיו זמינים להורדה עד להגדרתו.
        </p>
      )}
      {q.data?.scanner === 'disabled-unsafe' && (
        <p className="draft-banner" role="note">
          סביבת פיתוח: סריקת נוזקות מושבתת.
        </p>
      )}
      {q.isPending && <LoadingState />}
      {q.isError && <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />}
      {q.data?.attachments.length === 0 && <p className="muted">אין קבצים מצורפים.</p>}
      <ul className="list-plain">
        {q.data?.attachments.map((a) => (
          <li key={a.id} className="attachment-row">
            <Icon name="paperclip" />
            <span className="name">
              {a.status === 'clean' ? (
                <a href={`/api/attachments/${a.id}/download`} download={a.originalName}>
                  <bdi>{a.originalName}</bdi>
                  <span className="sr-only"> — הורדה</span>
                </a>
              ) : (
                <bdi>{a.originalName}</bdi>
              )}
              <br />
              <small className="muted">
                {formatSize(a.size)} · {a.uploaderName ?? 'משתמש שנמחק'} · {formatDateTime(a.createdAt)}
              </small>
              {a.status === 'clean' && /^image\/(png|jpeg|webp)$/.test(a.mime) && (
                <>
                  <br />
                  <Link to={`/boards/${board.id}/plans/${a.id}`} className="plan-link">
                    פתיחה כתוכנית קומה (נעיצת מפגעים)<span className="sr-only">: {a.originalName}</span>
                  </Link>
                </>
              )}
            </span>
            <span className={STATUS[a.status].cls}>{STATUS[a.status].label}</span>
            {canEdit && (a.uploadedBy === user?.id || board.myRole === 'owner') && (
              <button
                type="button"
                className="icon-btn"
                aria-label={`מחיקת הקובץ ${a.originalName}`}
                onClick={async () => {
                  if (await confirm({ title: 'מחיקת קובץ', message: `למחוק את "${iso(a.originalName)}"?`, confirmLabel: 'מחיקה', danger: true })) {
                    remove.mutate(a.id, { onSuccess: () => toast('הקובץ נמחק'), onError: (e) => toast(errorMessage(e), 'error') });
                  }
                }}
              >
                <Icon name="trash" size={16} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
