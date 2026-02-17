import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { SECURITY_HEADERS } from '../constants';

const securityHeadersPluginImpl: FastifyPluginAsync = async (fastify): Promise<void> => {
  fastify.addHook('onSend', async (_request: FastifyRequest, reply: FastifyReply) => {
    for (const [header, value] of Object.entries(SECURITY_HEADERS)) {
      reply.header(header, value);
    }
  });
};

export const securityHeadersPlugin = fp(securityHeadersPluginImpl, {
  name: 'security-headers-plugin',
});
