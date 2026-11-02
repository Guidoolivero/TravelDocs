// Empaqueta las functions para produccion y sube los source maps a Sentry.
// netlify dev y los deploy previews siguen con el esbuild de Netlify.
// El deploy de produccion tiene que correr este script (sin --no-build):
// si no, Netlify busca netlify/functions-dist y publica el sitio sin functions.

import { build } from "esbuild";
import { sentryEsbuildPlugin } from "@sentry/esbuild-plugin";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "netlify/functions");
const outdir = path.join(root, "netlify/functions-dist");
const handlers = (await readdir(srcDir)).filter((name) => name.endsWith(".cjs") && !name.startsWith("_"));

if (process.env.CONTEXT === "production" && !process.env.SENTRY_AUTH_TOKEN) {
  console.error("Falta SENTRY_AUTH_TOKEN. No se suben los source maps de las functions.");
  process.exit(1);
}

// El plugin no sube maps si NODE_ENV=development, y despues los borra igual.
if (process.env.SENTRY_AUTH_TOKEN && process.env.NODE_ENV === "development") {
  delete process.env.NODE_ENV;
}

await rm(outdir, { recursive: true, force: true });

const releaseName = process.env.COMMIT_REF || process.env.SENTRY_RELEASE;

await build({
  absWorkingDir: root,
  entryPoints: handlers.map((name) => path.join(srcDir, name)),
  bundle: true,
  define: { BILLING_BUILD_CONTEXT: JSON.stringify(process.env.CONTEXT || '') },
  external: ["@react-pdf/renderer"],
  platform: "node",
  format: "cjs",
  target: "node22",
  outdir,
  outExtension: { ".js": ".cjs" },
  sourcemap: "external",
  sourcesContent: true,
  logLevel: "warning",
  plugins: [
    sentryEsbuildPlugin({
      org: "traveldocs",
      project: "tradingdocs-functions",
      authToken: process.env.SENTRY_AUTH_TOKEN,
      telemetry: false,
      release: {
        ...(releaseName ? { name: releaseName } : {}),
        inject: false,
        create: true,
        finalize: false,
        setCommits: false,
      },
      sourcemaps: {
        filesToDeleteAfterUpload: [path.join(outdir, "*.map")],
      },
      errorHandler(err) {
        throw err;
      },
    }),
  ],
});

const leftover = (await readdir(outdir)).filter((name) => name.endsWith(".map"));
if (leftover.length > 0) {
  console.error("Quedaron source maps en netlify/functions-dist.");
  process.exit(1);
}
