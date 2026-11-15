import { useId, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/**
 * Secondary controls that stay inline on a wide screen and fold behind one button on a phone.
 * On a wide screen the wrapper disappears (`display: contents`) and the button is not rendered
 * visually, so the desktop layout is exactly what it was. On a phone the controls are really
 * hidden (not focusable) until the button is pressed.
 */
export function MobileFold({ label, icon, badge, children }: { label: string; icon: IconName; badge?: string | number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <button type="button" className="btn fold-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <Icon name={icon} size={16} /> {label}
        {badge ? <span className="fold-badge">{badge}</span> : null}
        <span className="fold-chevron" aria-hidden="true">
          <Icon name="chevronDown" size={16} />
        </span>
      </button>
      <div id={id} className="fold-body" data-open={open || undefined}>
        {children}
      </div>
    </>
  );
}
