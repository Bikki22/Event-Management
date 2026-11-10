// Vercel Function entry: serves the compiled Express app (built by `npm run build` into dist/).
// vercel.json rewrites every path here. The BullMQ worker (src/worker.ts) does NOT run on Vercel.
import { buildApp } from "../dist/app.js";

export default buildApp();
