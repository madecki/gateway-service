import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import {
  HOP_BY_HOP_HEADERS,
  AUTHORIZATION_HEADER_VARIANTS,
  DEFAULT_ACCEPT_HEADER,
} from '../constants';

export interface HeaderNormalizationOptions {
  trustProxy: boolean;
}

const headerNormalizationPluginImpl: FastifyPluginAsync<HeaderNormalizationOptions> = async (
  fastify,
  options,
): Promise<void> => {
  fastify.addHook('preHandler', async (request: FastifyRequest, _reply: FastifyReply) => {
    const headers = request.headers;

    // Strip hop-by-hop headers
    for (const header of HOP_BY_HOP_HEADERS) {
      delete headers[header];
    }

    // Remove duplicate authorization header variants (keep standard "authorization")
    for (const variant of AUTHORIZATION_HEADER_VARIANTS) {
      delete headers[variant];
    }

    // Set default accept header if missing
    if (!headers['accept']) {
      headers['accept'] = DEFAULT_ACCEPT_HEADER;
    }

    // Normalize forwarded headers
    const clientIp = getClientIp(request, options.trustProxy);

    // Set x-forwarded-for (append client IP)
    const existingForwardedFor = headers['x-forwarded-for'] as string | undefined;
    if (existingForwardedFor && options.trustProxy) {
      headers['x-forwarded-for'] = `${existingForwardedFor}, ${clientIp}`;
    } else {
      headers['x-forwarded-for'] = clientIp;
    }

    // Set x-forwarded-proto
    if (!headers['x-forwarded-proto']) {
      headers['x-forwarded-proto'] = request.protocol;
    }

    // Set x-forwarded-host (preserve original host)
    if (!headers['x-forwarded-host'] && headers['host']) {
      headers['x-forwarded-host'] = headers['host'] as string;
    }
  });
};

function getClientIp(request: FastifyRequest, trustProxy: boolean): string {
  if (trustProxy) {
    const forwardedFor = request.headers['x-forwarded-for'];
    if (forwardedFor) {
      const ips = (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor).split(',');
      return ips[0].trim();
    }
  }

  return request.ip;
}

export function getClientIpForRateLimit(request: FastifyRequest, trustProxy: boolean): string {
  return getClientIp(request, trustProxy);
}

export const headerNormalizationPlugin = fp(headerNormalizationPluginImpl, {
  name: 'header-normalization-plugin',
});
