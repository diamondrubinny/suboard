/** True when this browser can create / use passkeys at all (needs HTTPS or localhost). */
export const passkeysSupported = (): boolean =>
  typeof window !== 'undefined' && window.isSecureContext && typeof window.PublicKeyCredential === 'function';

/** Human wording for a failed browser ceremony; `null` when the error is not a WebAuthn one. */
export function passkeyErrorMessage(err: unknown, action: 'login' | 'register'): string | null {
  if (!(err instanceof Error)) return null;
  switch (err.name) {
    case 'NotAllowedError':
    case 'AbortError':
      return action === 'login'
        ? 'הכניסה בוטלה, או שאין במכשיר הזה מפתח גישה למערכת. אפשר לנסות שוב או להתחבר בסיסמה.'
        : 'הפעולה בוטלה או שפג הזמן. אפשר לנסות שוב.';
    case 'InvalidStateError':
      return action === 'register' ? 'במכשיר הזה כבר שמור מפתח גישה לחשבון שלך.' : null;
    case 'NotSupportedError':
      return 'המכשיר או הדפדפן אינם תומכים במפתחות גישה עם אימות ביומטרי או קוד נעילה.';
    case 'SecurityError':
      return 'לא ניתן להשתמש במפתח גישה בכתובת הזו.';
    default:
      return null;
  }
}
