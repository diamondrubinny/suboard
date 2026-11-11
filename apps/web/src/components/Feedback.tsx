import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Dialog } from './Dialog';

// ------------------------------------------------------------------ toasts
interface ToastAction {
  label: string;
  onClick: () => void;
}

interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'error';
  action?: ToastAction;
  key?: string;
}

interface FeedbackValue {
  /** `action` adds a button (e.g. "ביטול" after a delete); such toasts stay longer (10s). */
  /** `replaceKey`: a newer toast with the same key replaces the older one (e.g. only the last "undo" stays). */
  toast: (message: string, kind?: Toast['kind'], action?: ToastAction, replaceKey?: string) => void;
  confirm: (opts: { title: string; message: string; confirmLabel?: string; danger?: boolean }) => Promise<boolean>;
}

const FeedbackContext = createContext<FeedbackValue | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const [confirmState, setConfirmState] = useState<
    (Parameters<FeedbackValue['confirm']>[0] & { resolve: (v: boolean) => void }) | null
  >(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // The top-most open modal dialog (or null): where toasts must live to stay interactive.
  const [host, setHost] = useState<Element | null>(null);
  useEffect(() => {
    const pick = () => {
      const open = document.querySelectorAll('dialog[open]');
      setHost(open.length ? open[open.length - 1]! : null);
    };
    pick();
    const mo = new MutationObserver(pick);
    mo.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['open'] });
    return () => mo.disconnect();
  }, []);

  const toast = useCallback((message: string, kind: Toast['kind'] = 'info', action?: ToastAction, replaceKey?: string) => {
    const id = nextId.current++;
    setToasts((t) => [...(replaceKey ? t.filter((x) => x.key !== replaceKey) : t), { id, message, kind, action, key: replaceKey }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), action ? 10000 : kind === 'error' ? 8000 : 4000);
  }, []);

  const confirm = useCallback<FeedbackValue['confirm']>(
    (opts) => new Promise<boolean>((resolve) => setConfirmState({ ...opts, resolve })),
    [],
  );

  const close = (value: boolean) => {
    confirmState?.resolve(value);
    setConfirmState(null);
  };

  return (
    <FeedbackContext.Provider value={{ toast, confirm }}>
      {children}
      {/* Live regions: polite for info, assertive for errors. Rendered inside the open modal dialog when
          there is one: everything outside a modal <dialog> is inert, so a toast (and its "undo" button)
          left in the page behind it could not be clicked or read. */}
      {createPortal(
      <div className="toasts">
        <div role="status" aria-live="polite">
          {toasts
            .filter((t) => t.kind === 'info')
            .map((t) => (
              <div key={t.id} className="toast">
                <span>{t.message}</span>
                {t.action && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      t.action!.onClick();
                      setToasts((x) => x.filter((y) => y.id !== t.id));
                    }}
                  >
                    {t.action.label}
                  </button>
                )}
                <button type="button" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} aria-label="סגירת הודעה">
                  ✕
                </button>
              </div>
            ))}
        </div>
        <div role="alert" aria-live="assertive">
          {toasts
            .filter((t) => t.kind === 'error')
            .map((t) => (
              <div key={t.id} className="toast error">
                <span>{t.message}</span>
                <button type="button" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} aria-label="סגירת הודעה">
                  ✕
                </button>
              </div>
            ))}
        </div>
      </div>,
        host ?? document.body,
      )}
      <Dialog
        open={confirmState !== null}
        title={confirmState?.title ?? ''}
        onClose={() => close(false)}
        initialFocusRef={cancelRef}
        footer={
          <>
            <button type="button" className="btn" ref={cancelRef} onClick={() => close(false)}>
              ביטול
            </button>
            <button type="button" className={confirmState?.danger ? 'btn btn-danger' : 'btn btn-primary'} onClick={() => close(true)}>
              {confirmState?.confirmLabel ?? 'אישור'}
            </button>
          </>
        }
      >
        <p>{confirmState?.message}</p>
      </Dialog>
    </FeedbackContext.Provider>
  );
}

export function useFeedback(): FeedbackValue {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error('useFeedback must be used inside FeedbackProvider');
  return ctx;
}

// ------------------------------------------------------------------ page states
export function LoadingState({ label = 'טוען…' }: { label?: string }) {
  return (
    <div className="state" role="status" aria-live="polite">
      <div className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state" role="alert">
      <strong>לא ניתן לטעון את הנתונים</strong>
      <span>{message}</span>
      {onRetry && (
        <button type="button" className="btn" onClick={onRetry}>
          נסו שוב
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="state">
      <strong>{title}</strong>
      {children}
    </div>
  );
}
