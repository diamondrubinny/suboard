/**
 * What a guest account may call. Default deny: a guest reaches only the paths listed here — the
 * boards it was invited to (every board route still checks membership and the board role), its own
 * account, and its own notifications. Anything new in the API is closed to guests until listed.
 *
 * `path` is the API path after `/api`, without the query string.
 */
const ID = '[^/]+';
const rule = (methods: string, pattern: string): { methods: Set<string>; re: RegExp } => ({ methods: new Set(methods.split(' ')), re: new RegExp(`^${pattern}$`) });

const GUEST_RULES = [
  // own account and security (API tokens stay closed)
  rule('GET POST PATCH DELETE', '/auth/(?!tokens(/|$)).*'),
  rule('GET', '/modules'),
  rule('GET', '/users/directory'),
  rule('GET', '/workspaces'),
  rule('GET', '/notifications'),
  rule('POST', '/notifications/read'),
  rule('GET', '/search'),
  rule('GET', '/me/work'),
  rule('GET', '/me/recent-boards'),
  // boards the guest is a member of: read, and edit items when the board role allows
  rule('GET', '/boards'),
  rule('GET', `/boards/${ID}`),
  rule('GET', `/boards/${ID}/(activity|views|files|item-names|dependencies|plans|item-templates)`),
  rule('PUT DELETE', `/boards/${ID}/favorite`),
  rule('POST', `/boards/${ID}/items(/bulk)?`),
  rule('PATCH DELETE', `/items/${ID}`),
  rule('GET', `/items/${ID}/(activity|attachments|card|dependencies|follow|links|personal|updates|time)`),
  rule('POST', `/items/${ID}/(attachments|duplicate|move|reminders|restore|updates|time|time/start|time/stop)`),
  rule('PUT', `/items/${ID}/(dependencies|follow|note)`),
  rule('DELETE', `/items/${ID}/follow`),
  rule('PUT', `/items/${ID}/relations/${ID}`),
  rule('POST', `/items/${ID}/vote/${ID}`),
  rule('GET', `/attachments/${ID}/(download|pins)`),
  rule('DELETE', `/attachments/${ID}`),
  rule('DELETE', `/updates/${ID}`),
  rule('PUT DELETE', `/updates/${ID}/reactions/${ID}`),
  rule('DELETE', `/reminders/${ID}`),
  rule('PATCH DELETE', `/time/${ID}`),
];

export function guestMayCall(method: string, path: string): boolean {
  const m = method.toUpperCase() === 'HEAD' ? 'GET' : method.toUpperCase();
  return GUEST_RULES.some((r) => r.methods.has(m) && r.re.test(path));
}

/** Guest accounts always expire: 90 days by default, a year at most. */
export const GUEST_DEFAULT_DAYS = 90;
export const GUEST_MAX_DAYS = 366;
