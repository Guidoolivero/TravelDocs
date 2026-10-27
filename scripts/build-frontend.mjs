// Publica solo public/ y fija todo el grafo de imports a una misma carpeta.
import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

export async function buildFrontend({ source = path.join(root, 'public'), output = path.join(root, '.netlify/site') } = {}) {
  const js = path.join(source, 'js');
  const files = (await readdir(js, { recursive: true })).filter(file => /\.(js|mjs)$/.test(file)).sort();
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file.replaceAll(path.sep, '/')).update('\0').update(await readFile(path.join(js, file))).update('\0');
  }
  const version = 'v-' + hash.digest('hex').slice(0, 16);
  await rm(output, { recursive: true, force: true });
  await cp(source, output, { recursive: true });
  await mkdir(path.join(output, 'js', version), { recursive: true });
  await cp(js, path.join(output, 'js', version), { recursive: true });
  // URLs /js/*.js viejas: reexportan este grafo. Si no, un db.js nuevo
  // importaba alert-core.mjs cacheado sin el export y el login se caia.
  for (const file of files) {
    const sourceFile = await readFile(path.join(js, file), 'utf8');
    if (!/^\s*(import|export)\b/m.test(sourceFile)) continue;
    const rel = file.replaceAll(path.sep, '/');
    const up = '../'.repeat(rel.split('/').length - 1) || './';
    await writeFile(path.join(output, 'js', file), `export * from '${up}${version}/${rel}';\n`);
  }
  for (const file of await readdir(output)) {
    if (!file.endsWith('.html')) continue;
    const target = path.join(output, file);
    const html = await readFile(target, 'utf8');
    await writeFile(target, html.replace(/(\bsrc\s*=\s*["'])(?:\.\/|\/)?js\/([^"']+\.(?:js|mjs))(["'])/g, `$1/js/${version}/$2$3`));
  }
  console.log(`Frontend: ${version} (${files.length} modulos)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await buildFrontend();
}
