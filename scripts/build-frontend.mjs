// Publica solo public/ y fija todo el grafo de imports a una misma carpeta.
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const exec = promisify(execFile);

async function copyVersion(js, output) {
  const files = (await readdir(js, { recursive: true })).filter(file => /\.(js|mjs)$/.test(file)).sort();
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file.replaceAll(path.sep, '/')).update('\0').update(await readFile(path.join(js, file))).update('\0');
  }
  const version = 'v-' + hash.digest('hex').slice(0, 16);
  await mkdir(path.join(output, 'js', version), { recursive: true });
  await cp(js, path.join(output, 'js', version), { recursive: true });
  return { version, files };
}

async function retainVersions(history, output) {
  const git = args => exec('git', args, { cwd: history });
  if ((await git(['rev-parse', '--is-shallow-repository'])).stdout.trim() === 'true') {
    throw new Error('La retencion de versiones requiere historial completo de Git (fetch-depth: 0).');
  }
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
  // La version previa al corte cubre sesiones de un deploy que estuvo dias sin cambios.
  const recent = await git(['log', '--first-parent', '--format=%H', `--since=${cutoff}`, '--', 'public/js']);
  const previous = await git(['log', '--first-parent', '--format=%H', '-1', `--until=${cutoff}`, '--', 'public/js']);
  const revisions = new Set((recent.stdout + previous.stdout).trim().split('\n').filter(Boolean));
  const temp = await mkdtemp(path.join(tmpdir(), 'frontend-versions-'));
  try {
    for (const revision of revisions) {
      const snapshot = path.join(temp, revision);
      await mkdir(snapshot);
      const archive = path.join(temp, 'snapshot.tar');
      // Solo JS publico: nunca extraer el repo completo (contiene datos personales).
      await git(['archive', '--format=tar', `--output=${archive}`, revision, 'public/js']);
      await exec('tar', ['-xf', archive, '-C', snapshot]);
      await copyVersion(path.join(snapshot, 'public/js'), output);
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

export async function buildFrontend({ source = path.join(root, 'public'), output = path.join(root, '.netlify/site'), history } = {}) {
  const js = path.join(source, 'js');
  await rm(output, { recursive: true, force: true });
  await cp(source, output, { recursive: true });
  if (history) await retainVersions(history, output);
  const { version, files } = await copyVersion(js, output);
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
  await buildFrontend({ history: root });
}
