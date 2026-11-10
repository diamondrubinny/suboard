import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';

interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  variant?: 'modal' | 'drawer';
  /** Element to focus when opened (defaults to the first focusable element). */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
}

/**
 * Accessible modal built on the native <dialog> element: focus is trapped and
 * Escape closes it natively (unless a child component consumed that Escape); focus returns to the
 * previously focused element on close.
 */
export function Dialog({ open, title, onClose, children, footer, variant = 'modal', initialFocusRef }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const returnFocus = useRef<HTMLElement | null>(null);
  /**
   * Set while an Escape keydown is being dispatched inside the dialog and cleared if it bubbles up to
   * the dialog. If a child handled Escape (stopPropagation — a popover, picker or inline editor), the
   * native "cancel" that follows must not close the whole dialog.
   */
  const escapeHandledInside = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      returnFocus.current = document.activeElement as HTMLElement | null;
      el.showModal();
      requestAnimationFrame(() => initialFocusRef?.current?.focus());
    } else if (!open && el.open) {
      el.close();
    }
  }, [open, initialFocusRef]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handleClose = () => {
      returnFocus.current?.focus?.();
    };
    el.addEventListener('close', handleClose);
    return () => el.removeEventListener('close', handleClose);
  }, []);

  return (
    <dialog
      ref={ref}
      className={variant === 'drawer' ? 'drawer' : undefined}
      aria-labelledby={titleId}
      onKeyDownCapture={(e) => {
        if (e.key === 'Escape') escapeHandledInside.current = true;
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') escapeHandledInside.current = false;
      }}
      onCancel={(e) => {
        e.preventDefault();
        if (escapeHandledInside.current) {
          escapeHandledInside.current = false;
          return;
        }
        onClose();
      }}
      onMouseDown={(e) => {
        // Click on the backdrop (the dialog element itself) closes it.
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <div className={variant === 'drawer' ? 'drawer-layout' : undefined}>
          <div className="dialog-header">
            <h2 id={titleId}>{title}</h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="סגירה">
              <Icon name="x" />
            </button>
          </div>
          <div className="dialog-body">{children}</div>
          {footer && <div className="dialog-footer">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
