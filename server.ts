import { createExpressApp } from './server/server.js';

const PORT = 3000;
const app = createExpressApp();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[VK Chat Exporter] Server running at http://0.0.0.0:${PORT}`);
});
