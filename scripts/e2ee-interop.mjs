#!/usr/bin/env node
// Checks that this SDK's end-to-end encryption and the web SDK's read each
// other: sessions, messages in rooms of mixed clients, sealed attachments.
//
//   npm run e2ee:interop
//   WEB_SDK=/path/to/ethora-chat-component npm run e2ee:interop
//
// Needs the web SDK checked out (default: next to this repository) with its
// dependencies installed - its esbuild does the bundling. Exits 0 with a
// note when it is not there, so it can sit in a pipeline that has only this
// repository.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const web = resolve(process.env.WEB_SDK || join(root, '..', 'ethora-chat-component'));
const esbuild = join(web, 'node_modules', '.bin', 'esbuild');

if (!existsSync(join(web, 'src', 'e2ee', 'omemo.ts')) || !existsSync(esbuild)) {
  console.log(
    `e2ee interop: skipped - no web SDK with installed dependencies at ${web} (set WEB_SDK).`
  );
  process.exit(0);
}

const out = mkdtempSync(join(tmpdir(), 'e2ee-interop-'));
const bundle = join(out, 'interop.mjs');
try {
  execFileSync(
    esbuild,
    [
      join(here, 'e2ee-interop', 'entry.ts'),
      '--bundle',
      '--platform=node',
      '--format=esm',
      `--outfile=${bundle}`,
      '--log-level=error',
      `--alias:@web=${join(web, 'src', 'e2ee')}`,
      `--alias:@rn=${join(root, 'src', 'e2ee')}`,
      // Some dependencies are CommonJS and `require` at run time.
      "--banner:js=import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
    ],
    { stdio: 'inherit', cwd: root }
  );
  execFileSync(process.execPath, [bundle], { stdio: 'inherit' });
} catch {
  process.exitCode = 1;
} finally {
  rmSync(out, { recursive: true, force: true });
}
