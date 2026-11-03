// Usa el mismo Netlify CLI del deploy: node tests/billing-package.smoke.mjs <raiz-cli>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const cli = createRequire(path.resolve(process.argv[2], 'package.json'));
const { zipFunction } = await import(pathToFileURL(cli.resolve('@netlify/zip-it-and-ship-it')));
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
  assert.deepEqual(await readFile(path.join(artifact.path, path.relative(root, bundle))), await readFile(bundle), 'El paquete conserva el debug id de Sentry');
  const probe = `
    try {
      const entry = await import('./billing-pdf.js');
      const handler = entry.handler || entry.default?.handler;
      const response = await handler({ httpMethod: 'POST', headers: {}, body: '{}' });
      if (response.statusCode !== 401 || response.headers['Cache-Control'] !== 'no-store') throw new Error('Se esperaba 401 sin credenciales');
    } catch (error) { console.error(error.name + ': ' + error.message.split('\\n')[0]); process.exitCode = 1; }
  `;
  const result = spawnSync(process.execPath, ['--no-experimental-require-module', '--input-type=module', '-e', probe], {
    cwd: artifact.path, timeout: 30000,
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
