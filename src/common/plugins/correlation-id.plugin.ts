import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { v4 as uuidv4 } from 'uuid';
import { CORRELATION_ID_HEADER } from '../constants';

const correlationIdPluginImpl: FastifyPluginAsync = async (fastify): Promise<void> => {
  fastify.decorateRequest('correlationId', '');

  fastify.addHook('onRequest', async (request: FastifyRequest, _reply: FastifyReply) => {
    const existingCorrelationId = request.headers[CORRELATION_ID_HEADER] as string | undefined;
    const correlationId = existingCorrelationId || uuidv4();

    request.correlationId = correlationId;
    request.headers[CORRELATION_ID_HEADER] = correlationId;
  });

  fastify.addHook('onSend', async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header(CORRELATION_ID_HEADER, request.correlationId);
  });
};

export const correlationIdPlugin = fp(correlationIdPluginImpl, {
  name: 'correlation-id-plugin',
});
