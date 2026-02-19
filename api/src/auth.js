import { config } from './config.js';

export async function requireInternalKey(req, reply) {
  // Allow health unauthenticated if you prefer; currently guarded at hook-level.
  if (req.url === '/health') return;

  const key = req.headers['x-api-key'];
  if (!key || key !== config.OPUS_INTERNAL_API_KEY) {
    reply.code(401).send({
      error: { message: 'Unauthorized', status: 401 }
    });
  }
}
