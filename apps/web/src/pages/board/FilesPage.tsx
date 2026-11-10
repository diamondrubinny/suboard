import type { BoardFile } from '@suboard/shared';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { errorMessage } from '../../api/client';
import { useBoard, useBoardFiles } from '../../api/hooks';
import { Dialog } from '../../components/Dialog';
import { ErrorState, LoadingState } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { usePageTitle } from '../../components/Layout';
import { formatDateTime } from './activityText';

const size = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** Board gallery: every file that passed the malware scan, images as a grid, other files as a table. */
export function FilesPage() {
  const { boardId = '' } = useParams();
  const board = useBoard(boardId);
  const files = useBoardFiles(boardId);
  const [groupId, setGroupId] = useState('');
  const [preview, setPreview] = useState<BoardFile | null>(null);
  usePageTitle(`גלריית קבצים — ${board.data?.name ?? ''}`);

  const shown = useMemo(() => (files.data ?? []).filter((f) => !groupId || f.groupId === groupId), [files.data, groupId]);
  const images = shown.filter((f) => f.isImage);
  const docs = shown.filter((f) => !f.isImage);
  const itemLink = (f: BoardFile) => `/boards/${boardId}?item=${f.itemId}`;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>גלריית קבצים: {board.data?.name}</h1>
          <p className="muted" style={{ margin: 'var(--space-1) 0 0' }}>
            רק קבצים שעברו סריקת נוזקות מוצגים כאן. העלאה ומחיקה — מתוך הפריט, בלשונית "קבצים".
          </p>
        </div>
        <div className="actions">
          <Link to={`/boards/${boardId}`} className="btn">
            חזרה ללוח
          </Link>
        </div>
      </div>
      {board.data && board.data.groups.length > 1 && (
        <div className="field" style={{ maxInlineSize: '18rem' }}>
          <label htmlFor="files-group">קבוצה</label>
          <select id="files-group" className="select" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">כל הקבוצות</option>
            {board.data.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {files.isPending && <LoadingState />}
      {files.isError && <ErrorState message={errorMessage(files.error)} onRetry={() => files.refetch()} />}
      {files.data && (
        <p className="muted" role="status">
          {images.length} תמונות · {docs.length} קבצים אחרים
        </p>
      )}
      {files.data && shown.length === 0 && (
        <div className="empty-state">
          <Icon name="image" />
          <p>אין עדיין קבצים{groupId ? ' בקבוצה הזו' : ' בלוח'}.</p>
        </div>
      )}
      {images.length > 0 && (
        <section aria-labelledby="gal-img-h">
          <h2 id="gal-img-h">תמונות</h2>
          <ul className="list-plain gallery">
            {images.map((f) => (
              <li key={f.id}>
                <figure className="gallery-card">
                  <button type="button" className="gallery-thumb" onClick={() => setPreview(f)} aria-label={`הגדלת התמונה ${f.name} (פריט: ${f.itemName})`}>
                    <img src={`/api/attachments/${f.id}/download`} alt="" loading="lazy" decoding="async" />
                  </button>
                  <figcaption>
                    <Link to={itemLink(f)}>{f.itemName}</Link>
                    <small className="muted">
                      <bdi>{f.name}</bdi> · <time dateTime={f.createdAt}>{formatDateTime(f.createdAt)}</time>
                    </small>
                  </figcaption>
                </figure>
              </li>
            ))}
          </ul>
        </section>
      )}
      {docs.length > 0 && (
        <section aria-labelledby="gal-docs-h" className="card">
          <h2 id="gal-docs-h">קבצים אחרים</h2>
          <div className="table-wrap" tabIndex={0} role="region" aria-labelledby="gal-docs-h">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">קובץ</th>
                  <th scope="col">פריט</th>
                  <th scope="col">גודל</th>
                  <th scope="col">הועלה</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <a href={`/api/attachments/${f.id}/download`} download>
                        <Icon name="download" size={16} /> <bdi>{f.name}</bdi>
                      </a>
                    </td>
                    <td>
                      <Link to={itemLink(f)}>{f.itemName}</Link>
                    </td>
                    <td className="nowrap">{size(f.size)}</td>
                    <td className="nowrap">{formatDateTime(f.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <Dialog open={Boolean(preview)} onClose={() => setPreview(null)} title={preview ? `${preview.itemName} — ${preview.name}` : ''}>
        {preview && (
          <>
            <img className="gallery-preview" src={`/api/attachments/${preview.id}/download`} alt={`${preview.name}, מצורף לפריט ${preview.itemName}`} />
            <p className="toolbar">
              <Link to={itemLink(preview)} className="btn" onClick={() => setPreview(null)}>
                פתיחת הפריט
              </Link>
              <a href={`/api/attachments/${preview.id}/download`} download className="btn btn-ghost">
                <Icon name="download" /> הורדה
              </a>
            </p>
          </>
        )}
      </Dialog>
    </>
  );
}
