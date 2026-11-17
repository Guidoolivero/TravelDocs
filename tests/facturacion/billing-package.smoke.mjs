// Usa el mismo Netlify CLI del deploy: node tests/facturacion/billing-package.smoke.mjs <raiz-cli>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const cli = createRequire(path.resolve(process.argv[2], 'package.json'));
const { listFunctions, zipFunction } = await import(pathToFileURL(cli.resolve('@netlify/zip-it-and-ship-it')));
const { parse } = cli('smol-toml');
const config = parse(await readFile('netlify.toml', 'utf8'));
const pdf = config.context.production.functions['billing-pdf'];
const output = await mkdtemp(path.join(tmpdir(), 'billing-package-'));
try {
  const bundle = path.join(root, config.context.production.build.functions, 'billing-pdf.cjs');
  const artifact = await zipFunction(bundle, output, {
    archiveFormat: 'none', basePath: root, repositoryRoot: root,
    config: { 'billing-pdf': {
      nodeBundler: pdf.node_bundler,
      externalNodeModules: config.functions['billing-pdf'].external_node_modules,
      includedFiles: pdf.included_files,
    } },
  });
  assert.equal(artifact.runtimeAPIVersion, 2, 'Netlify tiene que detectar la funcion como API v2');
  // En v2 Netlify vuelve a empaquetar la entrada (CJS a ESM): el debug id de Sentry sigue en el codigo.
  const dist = path.join(artifact.path, path.dirname(path.relative(root, bundle)));
  const main = (await readdir(dist)).find(name => name.startsWith('billing-pdf.'));
  const debugId = (await readFile(bundle, 'utf8')).match(/sentry-dbid-[0-9a-f-]+/)?.[0];
  assert.ok(debugId && (await readFile(path.join(dist, main), 'utf8')).includes(debugId), 'El paquete conserva el debug id de Sentry');
  const distDir = path.dirname(bundle);
  const all = await listFunctions(distDir, { parseISC: true });
  assert.deepEqual(all.filter(f => f.runtimeAPIVersion !== 2).map(f => f.name), [], 'Todas las functions del bundle son API v2');
  // Igual que el runtime de Netlify: default del modulo y despues default del export CJS.
  const probe = `
    try {
      const unwrap = m => m && typeof m === 'object' && 'default' in m ? m.default : m;
      for (const name of ${JSON.stringify(all.map(f => path.basename(f.mainFile)))}) {
        const fn = unwrap(unwrap(await import(${JSON.stringify(distDir + '/')} + name)));
        if (typeof fn !== 'function') throw new Error(name + ': el default no es una funcion');
      }
      const handler = unwrap(unwrap(await import('./${main}')));
      const response = await handler(new Request('https://test.local/.netlify/functions/billing-pdf', { method: 'POST', body: '{}' }));
      if (response.status !== 401 || response.headers.get('cache-control') !== 'no-store') throw new Error('Se esperaba 401 sin credenciales');
    } catch (error) { console.error(error.name + ': ' + error.message.split('\\n')[0]); process.exitCode = 1; }
  `;
  const result = spawnSync(process.execPath, ['--no-experimental-require-module', '--input-type=module', '-e', probe], {
    cwd: dist, timeout: 30000,
    env: { ...process.env, SENTRY_DSN: 'https://disabled.invalid/0',
      FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ project_id: 'demo-billing', client_email: 'qa@demo-billing.iam.gserviceaccount.com',
        private_key: generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } }).privateKey }),
    },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.error?.message || result.stderr);
  console.log('PDF empaquetado: arranque correcto y 401 sin credenciales.');
} finally {
  await rm(output, { recursive: true, force: true });
}
