import { serve } from "@hono/node-server";

import { apiApp } from "./app.js";

const port = Number.parseInt(process.env.PORT ?? "8787", 10);

serve({
  fetch: apiApp.fetch,
  port,
});

console.log(`curacuri.ai API listening on http://localhost:${String(port)}`);
