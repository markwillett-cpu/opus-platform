import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';

import { config } from './src/config.js';
import { requireInternalKey } from './src/auth.js';

import stylesRoutes from './src/routes/styles.js';
import tracksRoutes from './src/routes/styleTracks.js';
import assignmentsRoutes from './src/routes/styleAssignments.js';
import weightsRoutes from './src/routes/styleWeights.js';

const app = Fastify({
  logger: true
});

// CORS: only enable if you truly need browser calls from GH Pages.
// For internal-only (server-to-server), you can leave CORS_ORIGIN empty.
await app.register(cors, {
  origin: ['http://localhost:3000'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-API-Key', 'Authorization']
});


// Health check
app.get('/health', async () => ({ ok: true }));

// Internal-only guard (simple and effective for now)
app.addHook('onRequest', requireInternalKey);

// Routes
await app.register(stylesRoutes, { prefix: '/v1' });
await app.register(tracksRoutes, { prefix: '/v1' });
await app.register(assignmentsRoutes, { prefix: '/v1' });
await app.register(weightsRoutes, { prefix: '/v1' });

// Error handler (consistent JSON)
app.setErrorHandler((err, req, reply) => {
  req.log.error(err);

  const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
  reply.code(status).send({
    error: {
      message: err.message || 'Internal Server Error',
      status
    }
  });
});

app.listen({ port: config.PORT, host: '0.0.0.0' })
  .then(() => app.log.info(`Opus API listening on :${config.PORT}`))
  .catch((e) => {
    app.log.error(e);
    process.exit(1);
  });
