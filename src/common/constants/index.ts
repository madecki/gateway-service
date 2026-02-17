export const CORRELATION_ID_HEADER = 'x-correlation-id';

export const HOP_BY_HOP_HEADERS = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
];

export const AUTHORIZATION_HEADER_VARIANTS = ['x-authorization', 'x-auth', 'auth', 'x-api-key'];

export const DEFAULT_ACCEPT_HEADER = 'application/json';

export const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

export const AUTH_RATE_LIMIT_ROUTES = [
  { method: 'POST', url: '/auth/login' },
  { method: 'POST', url: '/auth/register' },
  { method: 'POST', url: '/auth/refresh' },
];
