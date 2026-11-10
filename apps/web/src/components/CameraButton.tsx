import { useId } from 'react';
import { Icon } from './Icon';

/**
 * "צילום" — opens the rear camera on phones (`capture="environment"`); on desktops it falls back to
 * picking an image file. Uses the native camera app, not getUserMedia (Permissions-Policy keeps the
 * camera API blocked for the page itself).
 */
export function CameraButton({ onFiles, disabled, label = 'צילום' }: { onFiles: (files: FileList | null) => void; disabled?: boolean; label?: string }) {
  const id = useId();
  return (
    <>
      <label htmlFor={id} className="btn" aria-disabled={disabled || undefined} style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}>
        <Icon name="camera" /> {label}
      </label>
      <input
        id={id}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        className="sr-only"
        disabled={disabled}
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </>
  );
}
