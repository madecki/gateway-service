import type { FastifyReply, FastifyRequest } from 'fastify';
import '@fastify/cookie';

const ACCESS_TOKEN_COOKIE = 'access_token';
const REFRESH_TOKEN_COOKIE = 'refresh_token';
const USER_ID_COOKIE = 'user_id';

/** Decode the exp claim from a JWT without verifying the signature. */
function getTokenExp(token: string): number | undefined {
  try {
    const [, payload] = token.split('.');
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof decoded.exp === 'number' ? decoded.exp : undefined;
  } catch {
    return undefined;
  }
}

export function setAuthCookies(
  reply: FastifyReply,
  accessToken: string,
  refreshToken: string,
  userId: string,
): void {
  const exp = getTokenExp(accessToken);
  const accessMaxAge = exp
    ? Math.max(60, exp - Math.floor(Date.now() / 1000))
    : 15 * 60;

  reply.setCookie(ACCESS_TOKEN_COOKIE, accessToken, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: accessMaxAge,
  });

  reply.setCookie(REFRESH_TOKEN_COOKIE, refreshToken, {
    httpOnly: true,
    sameSite: 'lax',
    // Scoped to /auth so the browser only sends it to auth routes
    path: '/auth',
    maxAge: 7 * 24 * 60 * 60,
  });

  // Non-httpOnly: lets client-side JS check whether the user is authenticated
  // without ever touching the JWT itself.
  reply.setCookie(USER_ID_COOKIE, userId, {
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60,
  });
}

export function clearAuthCookies(reply: FastifyReply): void {
  for (const name of [ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE, USER_ID_COOKIE]) {
    reply.clearCookie(name, { path: name === REFRESH_TOKEN_COOKIE ? '/auth' : '/' });
  }
}

export function getAccessToken(request: FastifyRequest): string | undefined {
  return request.cookies[ACCESS_TOKEN_COOKIE];
}

export function getRefreshToken(request: FastifyRequest): string | undefined {
  return request.cookies[REFRESH_TOKEN_COOKIE];
}
