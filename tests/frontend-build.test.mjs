import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildFrontend } from '../scripts/build-frontend.mjs';

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
