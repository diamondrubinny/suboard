import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Dialog } from './Dialog';

// ------------------------------------------------------------------ toasts
interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'error';
}

interface FeedbackValue {
  toast: (message: string, kind?: Toast['kind']) => void;
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

  const toast = useCallback((message: string, kind: Toast['kind'] = 'info') => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, message, kind }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 8000 : 4000);
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
      {/* Live regions: polite for info, assertive for errors. */}
      <div className="toasts">
        <div role="status" aria-live="polite">
          {toasts
            .filter((t) => t.kind === 'info')
            .map((t) => (
              <div key={t.id} className="toast">
                <span>{t.message}</span>
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
      </div>
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
