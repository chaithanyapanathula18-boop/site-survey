// Production build into dist/: hashed JS (with code splitting) and CSS, the app shell,
// static files, and a service worker that precaches all of it.
//   node build.mjs            build once
//   node build.mjs --serve    build, then serve dist/ on http://localhost:8080 (rebuild on change)
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';

const root = path.dirname(new URL(import.meta.url).pathname);
const dist = path.join(root, 'dist');
const serve = process.argv.includes('--serve');

function copyDir(from, to, skip = () => false) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name);
    const b = path.join(to, e.name);
    if (skip(e.name)) continue;
    if (e.isDirectory()) copyDir(a, b);
    else fs.copyFileSync(a, b);
  }
}

function listFiles(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? listFiles(p, base) : [path.relative(base, p).split(path.sep).join('/')];
  });
}

export async function build({ quiet = false } = {}) {
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });

  const common = {
    bundle: true,
    minify: true,
    sourcemap: true,
    target: ['es2022', 'safari16'],
    outdir: path.join(dist, 'assets'),
    metafile: true,
    logLevel: quiet ? 'warning' : 'info',
    legalComments: 'linked',
  };

  const js = await esbuild.build({
    ...common,
    entryPoints: [path.join(root, 'src/main.js')],
    format: 'esm',
    splitting: true,
    entryNames: '[name]-[hash]',
    chunkNames: 'chunk-[hash]',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  const css = await esbuild.build({
    ...common,
    entryPoints: [path.join(root, 'src/styles.css')],
    entryNames: '[name]-[hash]',
    assetNames: '[name]-[hash]',
    loader: { '.png': 'file', '.svg': 'file' },
  });

  const entryOf = (meta, src) => {
    const [out] = Object.entries(meta.outputs).find(([, o]) => o.entryPoint && o.entryPoint.endsWith(src));
    return '/' + path.relative(dist, path.resolve(out)).split(path.sep).join('/');
  };
  const jsEntry = entryOf(js.metafile, 'src/main.js');
  const cssEntry = entryOf(css.metafile, 'src/styles.css');

  // static files and the app shell
  copyDir(path.join(root, 'static'), dist, (name) => name === 'index.html');
  const html = fs
    .readFileSync(path.join(root, 'static/index.html'), 'utf8')
    .replaceAll('{{JS}}', jsEntry)
    .replaceAll('{{CSS}}', cssEntry);
  fs.writeFileSync(path.join(dist, 'index.html'), html);

  // service worker: precache everything except source maps and licence notes
  const files = listFiles(dist).filter((f) => !/\.(map|LEGAL\.txt)$/.test(f) && f !== 'sw.js');
  const hash = crypto.createHash('sha256');
  for (const f of files.sort()) hash.update(f).update(fs.readFileSync(path.join(dist, f)));
  const version = hash.digest('hex').slice(0, 12);
  const precache = files.map((f) => (f === 'index.html' ? '/index.html' : '/' + f));
  const sw = fs
    .readFileSync(path.join(root, 'src/sw.js'), 'utf8')
    .replace('__VERSION__', JSON.stringify(version))
    .replace('__PRECACHE__', JSON.stringify(precache, null, 2));
  fs.writeFileSync(path.join(dist, 'sw.js'), sw);

  if (!quiet) console.log(`Built ${files.length} files, version ${version}`);
  return { version, jsEntry, cssEntry, files };
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

// Minimal static server with the same rewrite as Firebase Hosting (unknown paths -> index.html).
export function serveDist(port = 8080) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let file = path.join(dist, decodeURIComponent(url.pathname));
    if (!file.startsWith(dist)) {
      res.writeHead(403).end();
      return;
    }
    if (url.pathname.startsWith('/__/')) {
      res.writeHead(404).end(); // no Firebase config locally: the app runs on-device only
      return;
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  await build();
  if (serve) {
    const port = Number(process.env.PORT) || 8080;
    await serveDist(port);
    console.log(`Serving dist/ on http://localhost:${port} (Ctrl+C to stop)`);
    let timer = null;
    fs.watch(path.join(root, 'src'), { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => build({ quiet: true }).then(() => console.log('Rebuilt')).catch((e) => console.error(e.message)), 150);
    });
  }
}
