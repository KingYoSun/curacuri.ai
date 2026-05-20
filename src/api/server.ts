import "../app/env.js";

import { serve } from "@hono/node-server";

import { createAppRuntime } from "../app/runtime.js";
import { createApiApp } from "./app.js";

const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const runtime = await createAppRuntime();
const apiApp = createApiApp(runtime);

serve({
  fetch: apiApp.fetch,
  port,
});

console.log(`curacuri.ai API listening on http://localhost:${String(port)}`);
