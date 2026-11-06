import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildFrontend } from '../scripts/build-frontend.mjs';

const exec = promisify(execFile);

test('cada HTML e import estatico o diferido carga una misma version; cambiar una dependencia cambia las URLs', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'frontend-build-'));
  try {
    const source = path.join(root, 'public');
    const output = path.join(root, 'site');
    await mkdir(path.join(source, 'js'), { recursive: true });
    await writeFile(path.join(source, 'login.html'), '<script type="module" src="./js/login.js"></script><script defer src="/js/analytics.js"></script>');
    await writeFile(path.join(source, 'js/login.js'), "import { value } from './core.mjs'; export { value }; export const lazy = () => import('./lazy.mjs');");
    await writeFile(path.join(source, 'js/core.mjs'), 'export const value = 1;');
    await writeFile(path.join(source, 'js/lazy.mjs'), "export { value } from './core.mjs';");
    await writeFile(path.join(source, 'js/analytics.js'), 'window.analyticsLoaded = true;');
    await writeFile(path.join(root, 'private.txt'), 'no publicar');
    await buildFrontend({ source, output });
    const html = await readFile(path.join(output, 'login.html'), 'utf8');
    const urls = [...html.matchAll(/src="([^"]+)"/g)].map(m => m[1]);
    assert.match(urls[0], /^\/js\/v-[a-f0-9]{16}\/login\.js$/);
    assert.equal(path.posix.dirname(urls[0]), path.posix.dirname(urls[1]));
    const login = await import(pathToFileURL(path.join(output, urls[0])).href);
    assert.equal(login.value, 1);
    assert.equal((await login.lazy()).value, 1);
    const version = urls[0].match(/\/js\/(v-[a-f0-9]{16})\//)[1];
    assert.equal(await readFile(path.join(output, 'js/login.js'), 'utf8'), `export * from './${version}/login.js';\n`);
    assert.equal(await readFile(path.join(output, 'js/core.mjs'), 'utf8'), `export * from './${version}/core.mjs';\n`);
    assert.equal(await readFile(path.join(output, 'js/analytics.js'), 'utf8'), 'window.analyticsLoaded = true;');
    const legacy = await import(pathToFileURL(path.join(output, 'js/login.js')).href);
    assert.equal(legacy.value, 1);
    assert.equal((await legacy.lazy()).value, 1);
    await assert.rejects(readFile(path.join(output, 'private.txt')), { code: 'ENOENT' });
    await buildFrontend({ source, output });
    assert.equal(await readFile(path.join(output, 'login.html'), 'utf8'), html, 'Sin cambios se conserva la misma version');
    await writeFile(path.join(source, 'js/core.mjs'), 'export const value = 2;');
    await buildFrontend({ source, output });
    const updated = await readFile(path.join(output, 'login.html'), 'utf8');
    assert.notEqual(updated, html);
    const nextUrl = updated.match(/src="([^"]+)"/)[1];
    const nextLogin = await import(pathToFileURL(path.join(output, nextUrl)).href);
    assert.equal(nextLogin.value, 2);
    assert.equal((await nextLogin.lazy()).value, 2);
    assert.equal(await readFile(path.join(source, 'login.html'), 'utf8'), '<script type="module" src="./js/login.js"></script><script defer src="/js/analytics.js"></script>');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('un deploy conserva imports diferidos de los ultimos 7 dias y su version previa, sin publicar archivos privados', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'frontend-history-'));
  const source = path.join(root, 'public');
  const output = path.join(root, 'site');
  const git = args => exec('git', args, { cwd: root });
  try {
    await mkdir(path.join(source, 'js'), { recursive: true });
    await git(['init']);
    await git(['config', 'user.email', 'test@example.test']);
    await git(['config', 'user.name', 'Test']);
    await writeFile(path.join(root, 'private.txt'), 'no publicar');
    await git(['add', 'private.txt']);
    await writeFile(path.join(source, 'index.html'), '<script type="module" src="./js/app.mjs"></script>');
    await writeFile(path.join(source, 'js/app.mjs'), "export const lazy = () => import('./scanner.mjs');");
    const urls = [];
    for (const [days, value] of [[10, 0], [8, 1], [2, 2]]) {
      await writeFile(path.join(source, 'js/core.mjs'), `export const value = ${value};`);
      await writeFile(path.join(source, 'js/scanner.mjs'), "export { value } from './core.mjs';");
      await git(['add', 'public']);
      const date = new Date(Date.now() - days * 86400000).toISOString();
      await exec('git', ['commit', '-m', `version ${value}`], {
        cwd: root, env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
      });
      await buildFrontend({ source, output });
      urls.push((await readFile(path.join(output, 'index.html'), 'utf8')).match(/src="([^"]+)"/)[1]);
    }
    // La pestana aun no pidio scanner.mjs; el nuevo deploy lo elimina.
    const previous = await import(pathToFileURL(path.join(output, urls[2])).href);
    await rm(path.join(source, 'js/scanner.mjs'));
    await writeFile(path.join(source, 'js/app.mjs'), 'export const value = 3;');
    await git(['add', 'public']);
    await git(['commit', '-m', 'version 3']);
    await buildFrontend({ source, output, history: root });
    assert.equal((await previous.lazy()).value, 2);
    const baseline = await import(pathToFileURL(path.join(output, urls[1])).href);
    assert.equal((await baseline.lazy()).value, 1);
    await assert.rejects(readFile(path.join(output, urls[0])), { code: 'ENOENT' });
    const currentUrl = (await readFile(path.join(output, 'index.html'), 'utf8')).match(/src="([^"]+)"/)[1];
    assert.equal((await import(pathToFileURL(path.join(output, currentUrl)).href)).value, 3);
    await assert.rejects(readFile(path.join(output, 'private.txt')), { code: 'ENOENT' });
    await assert.rejects(readFile(path.join(output, path.dirname(currentUrl), 'scanner.mjs')), { code: 'ENOENT' });
    const shallow = path.join(root, 'shallow');
    await git(['clone', '--depth=1', pathToFileURL(root).href, shallow]);
    await assert.rejects(buildFrontend({
      source: path.join(shallow, 'public'), output: path.join(shallow, 'site'), history: shallow,
    }), /historial completo/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test('los modulos en subcarpetas conservan imports relativos y cargas diferidas', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'frontend-modulos-'));
  try {
    const source = path.join(root, 'public');
    const output = path.join(root, 'site');
    await mkdir(path.join(source, 'js/facturacion'), { recursive: true });
    await mkdir(path.join(source, 'js/compartido'), { recursive: true });
    await writeFile(path.join(source, 'index.html'), '<script type="module" src="./js/app.mjs"></script>');
    await writeFile(path.join(source, 'js/app.mjs'), "export { total, pdf } from './facturacion/pantalla.mjs';");
    await writeFile(path.join(source, 'js/facturacion/pantalla.mjs'), "export { total } from '../compartido/importes.mjs'; export const pdf = () => import('./pdf.mjs');");
    await writeFile(path.join(source, 'js/compartido/importes.mjs'), 'export const total = 10025;');
    await writeFile(path.join(source, 'js/facturacion/pdf.mjs'), "export { total } from '../compartido/importes.mjs';");
    await buildFrontend({ source, output });
    const html = await readFile(path.join(output, 'index.html'), 'utf8');
    const entry = html.match(/src="([^"]+)"/)[1];
    const app = await import(pathToFileURL(path.join(output, entry)).href);
    assert.equal(app.total, 10025);
    assert.equal((await app.pdf()).total, 10025);
    const compatible = await import(pathToFileURL(path.join(output, 'js/facturacion/pantalla.mjs')).href);
    assert.equal(compatible.total, 10025);
    assert.equal((await compatible.pdf()).total, 10025);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
