import { createApp } from './app.js';
import { config } from './config.js';
import { closePool } from './db.js';

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`[campusedge] API listening on :${config.port} (${config.env})`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`\n[campusedge] ${signal} received, shutting down`);
    server.close(async () => {
      await closePool();
      process.exit(0);
    });
  });
}
