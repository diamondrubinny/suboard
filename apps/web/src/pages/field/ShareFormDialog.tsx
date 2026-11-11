import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { appLink } from '../../api/base';
import { Dialog } from '../../components/Dialog';
import { useFeedback } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { QrCode } from '../../components/QrCode';

/** Share a form: its link (copy / phone share sheet), a QR code to print or scan, and a shortcut to open it. */
export function ShareFormDialog({ form, created = false, onClose, children }: { form: { id: string; name: string } | null; created?: boolean; onClose: () => void; children?: React.ReactNode }) {
  const { toast } = useFeedback();
  const copyRef = useRef<HTMLButtonElement>(null);
  if (!form) return null;
  const url = appLink(`/forms/${form.id}`);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast('הקישור הועתק');
    } catch {
      toast('לא ניתן להעתיק אוטומטית — סמנו את הקישור והעתיקו ידנית', 'error');
    }
  };
  return (
    <Dialog open onClose={onClose} title={created ? `הטופס "${form.name}" מוכן` : `שיתוף הטופס: ${form.name}`} initialFocusRef={copyRef}>
      <div className="share-form">
        {created && <p className="form-success">הטופס נוצר ופעיל. שתפו את הקישור או את קוד ה-QR — כל תשובה תיכנס כפריט חדש בלוח התשובות.</p>}
        <div className="field">
          <label htmlFor="share-link">קישור לטופס</label>
          <div className="share-link-row">
            <input id="share-link" className="input" dir="ltr" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
            <button type="button" ref={copyRef} className="btn btn-primary" onClick={copy}>
              העתקה
            </button>
          </div>
          <span className="hint">המילוי מחייב התחברות למערכת — מי שאינו מחובר יועבר קודם לעמוד הכניסה.</span>
        </div>
        <div className="share-qr">
          <QrCode value={url} size={176} label={`קוד QR לטופס ${form.name}`} />
          <p className="muted">סריקה במצלמת הטלפון פותחת את הטופס. אפשר להדפיס ולתלות (למשל ליד עמדת עבודה).</p>
        </div>
        <div className="toolbar">
          {canShare && (
            <button type="button" className="btn" onClick={() => void navigator.share({ title: form.name, url }).catch(() => undefined)}>
              <Icon name="open" /> שיתוף…
            </button>
          )}
          <button type="button" className="btn" onClick={() => window.print()}>
            <Icon name="printer" /> הדפסת ה-QR
          </button>
          <Link to={`/forms/${form.id}`} className="btn" onClick={onClose}>
            פתיחת הטופס
          </Link>
          {children}
        </div>
      </div>
    </Dialog>
  );
}
