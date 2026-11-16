#!/usr/bin/env node
// goal-loop screenshots: builds the app, serves it locally and takes four screenshots with
// Playwright (light and dark, desktop and phone width) for the visual review of a UI change.
// Self-contained (Node >= 18, git); uses the repository's own Playwright.
//
//   node .goal-loop/screenshots.mjs --label <issue|batch>           write .goal-loop/shots/<label>/*.png
//   node .goal-loop/screenshots.mjs --label <batch> --publish       also store them on the
//        <github.branchPrefix>screenshots branch, push that branch, and print Markdown for the PR body
//   options: --config <file> (default .goal-loop/config.json)
//            --url <url>    use a server that is already running (no build, no serve)
//
// Settings: `visual` in the config: buildCommand, serveCommand, url, timeoutSeconds, and setup:
// a module in the repository whose default export `async (page, { scheme, size })` runs on each
// page before its screenshot (for example to add sample data), or "" for none.
// Playwright: `playwright` or `@playwright/test` in the repository, and its browser
// (`npx playwright install chromium`).
//
// Exit codes: 0 done, 1 failed, 2 usage/config error.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const flag = (n) => args.includes(n);
const out = (m) => console.log(`screenshots: ${m}`);
let server = null;
let serverTail = '';
const fail = (code, m) => { console.error(`screenshots: ${m}`); stopServer(); process.exit(code); };

function git(a, env) {
  const r = spawnSync('git', a, { encoding: 'utf8', env: env ? { ...process.env, ...env } : process.env });
  if (r.status !== 0) fail(1, `git ${a.join(' ')} failed: ${(r.stderr || r.stdout || r.error?.message || '').trim()}`);
  return r.stdout.trim();
}

const root = (() => {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (r.status !== 0) fail(2, 'not inside a git repository');
  return r.stdout.trim();
})();
const cfgFile = path.resolve(root, opt('--config') ?? '.goal-loop/config.json');
let cfg;
try { cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8')); } catch (e) { fail(2, `cannot read ${cfgFile}: ${e.message}`); }
const vis = cfg.visual ?? {};
const label = opt('--label');
if (!label || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(label)) fail(2, 'usage: --label <name> [--publish] [--url <url>]  (letters, digits, . _ -)');
const timeoutMs = Number(vis.timeoutSeconds ?? 180) * 1000;
const givenUrl = opt('--url');
const url = givenUrl ?? vis.url;
if (!url) fail(2, `visual.url is not set in ${cfgFile}`);
if (!givenUrl && !vis.serveCommand) fail(2, `visual.serveCommand is not set in ${cfgFile} (or pass --url for a server that is running)`);
const dir = path.join(root, '.goal-loop', 'shots', label);

// The whole run is bounded: a hung build, server or browser never holds the loop.
setTimeout(() => fail(1, `timed out after ${Math.round((3 * timeoutMs) / 1000)} s`), 3 * timeoutMs).unref();

/** Stop the server and everything it started (killing only the shell can leave the real server running). */
function stopServer() {
  if (!server || server.exitCode !== null) return;
  try {
    if (process.platform === 'win32') {
      spawnSync(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      process.kill(-server.pid, 'SIGKILL');
    }
  } catch { /* already gone */ }
  try { server.kill('SIGKILL'); } catch { /* already gone */ }
}

async function waitForUrl() {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    if (server && server.exitCode !== null) fail(1, `the server exited (${server.exitCode}) before ${url} answered:\n${serverTail.slice(-2000)}`);
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (r.ok) return;
      last = `HTTP ${r.status}`;
    } catch (e) { last = e.message; }
    await new Promise((r) => setTimeout(r, 500));
  }
  fail(1, `${url} did not answer within ${timeoutMs / 1000} s (${last})${serverTail ? `:\n${serverTail.slice(-2000)}` : ''}`);
}

async function loadPlaywright() {
  const req = createRequire(path.join(root, 'package.json'));
  for (const name of ['playwright', '@playwright/test']) {
    let p;
    try { p = req.resolve(name); } catch { continue; }
    const m = await import(pathToFileURL(p).href);
    const chromium = m.chromium ?? m.default?.chromium;
    if (chromium) return chromium;
  }
  return fail(2, 'Playwright is not installed in this repository: add playwright (or @playwright/test) as a dev dependency, then run npx playwright install chromium');
}

async function loadSetup() {
  if (!vis.setup) return null;
  const file = path.resolve(root, vis.setup);
  if (!fs.existsSync(file)) { out(`no ${vis.setup} yet; taking the screenshots without it`); return null; }
  const m = await import(pathToFileURL(file).href);
  if (typeof m.default !== 'function') fail(2, `${vis.setup} must export a default async function (page, { scheme, size })`);
  return m.default;
}

const SIZES = [
  { size: 'desktop', viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  { size: 'phone', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
];

async function shoot() {
  const chromium = await loadPlaywright();
  const setup = await loadSetup();
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch({ timeout: 60000 });
  const files = [];
  const problems = [];
  try {
    for (const s of SIZES) {
      for (const scheme of ['light', 'dark']) {
        const ctx = await browser.newContext({ viewport: s.viewport, deviceScaleFactor: s.deviceScaleFactor, isMobile: s.isMobile, hasTouch: s.hasTouch, colorScheme: scheme, reducedMotion: 'reduce' });
        try {
          const page = await ctx.newPage();
          page.setDefaultTimeout(30000);
          page.on('console', (m) => { if (m.type() === 'error') problems.push(`${s.size}-${scheme}: console error: ${m.text()}`); });
          page.on('pageerror', (e) => problems.push(`${s.size}-${scheme}: page error: ${e.message}`));
          await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
          if (setup) await setup(page, { scheme, size: s.size });
          await page.waitForTimeout(300);
          const file = path.join(dir, `${s.size}-${scheme}.png`);
          await page.screenshot({ path: file, fullPage: true });
          files.push(file);
        } finally {
          await ctx.close();
        }
      }
    }
  } finally {
    await browser.close();
  }
  fs.writeFileSync(path.join(dir, 'problems.txt'), problems.length ? `${problems.join('\n')}\n` : 'none\n');
  return { files, problems };
}

/** Store the screenshots as a commit on the screenshots branch (never the default branch), push it, return the Markdown. */
function publish(files) {
  const branch = `${cfg.github?.branchPrefix ?? 'goal-loop/'}screenshots`;
  const ref = `refs/heads/${branch}`;
  spawnSync('git', ['fetch', '--quiet', 'origin', `+${ref}:${ref}`], { encoding: 'utf8' }); // fine if the branch is new
  const prev = spawnSync('git', ['rev-parse', '--verify', '--quiet', ref], { encoding: 'utf8' }).stdout.trim();
  // A separate index: the working tree, the real index and the current branch are untouched.
  const env = { GIT_INDEX_FILE: path.resolve(root, git(['rev-parse', '--git-path', 'index-goal-loop-shots'])) };
  try {
    git(prev ? ['read-tree', prev] : ['read-tree', '--empty'], env);
    for (const f of files) {
      const blob = git(['hash-object', '-w', f]);
      git(['update-index', '--add', '--cacheinfo', `100644,${blob},${label}/${path.basename(f)}`], env);
    }
    const tree = git(['write-tree'], env);
    const commit = git(['commit-tree', tree, ...(prev ? ['-p', prev] : []), '-m', `screenshots: ${label}`]);
    git(['update-ref', ref, commit, ...(prev ? [prev] : [])]);
    git(['push', '--quiet', 'origin', `${ref}:${ref}`]);
    const remote = git(['remote', 'get-url', 'origin']);
    const m = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(remote);
    out(`stored on ${branch} at ${commit.slice(0, 12)} and pushed`);
    // Not on GitHub: the paths inside the screenshots commit, for the PR text to point at.
    const img = (size, scheme) => (m
      ? `![${size}, ${scheme}](https://github.com/${m[1]}/${m[2]}/blob/${commit}/${label}/${size}-${scheme}.png?raw=true)`
      : `${branch}@${commit.slice(0, 12)}:${label}/${size}-${scheme}.png`);
    return ['| | Light | Dark |', '|---|---|---|', ...SIZES.map((s) => `| ${s.size === 'desktop' ? 'Desktop (1280 px)' : 'Phone (390 px)'} | ${img(s.size, 'light')} | ${img(s.size, 'dark')} |`)].join('\n');
  } finally {
    fs.rmSync(env.GIT_INDEX_FILE, { force: true });
  }
}

if (!givenUrl) {
  if (vis.buildCommand) {
    out(`building: ${vis.buildCommand}`);
    const b = spawnSync(vis.buildCommand, { cwd: root, shell: true, encoding: 'utf8', timeout: timeoutMs, env: { ...process.env, CI: process.env.CI ?? 'true' } });
    if (b.status !== 0) fail(1, `the build failed (${b.error?.message ?? `exit ${b.status}`}):\n${`${b.stdout}${b.stderr}`.slice(-2000)}`);
  }
  out(`serving: ${vis.serveCommand}`);
  server = spawn(vis.serveCommand, { cwd: root, shell: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: process.env.CI ?? 'true' } });
  const keep = (d) => { serverTail = (serverTail + d.toString('utf8')).slice(-4000); };
  server.stdout.on('data', keep);
  server.stderr.on('data', keep);
}
try {
  await waitForUrl();
  const { files, problems } = await shoot();
  out(`${files.length} screenshots in ${path.relative(root, dir).replace(/\\/g, '/')}/ (${problems.length ? `${problems.length} page or console errors, see problems.txt` : 'no page or console errors'})`);
  if (flag('--publish')) {
    const md = publish(files);
    out('Markdown for the PR body:');
    console.log(md);
  }
} catch (e) {
  fail(1, e?.message ?? String(e));
} finally {
  stopServer();
}
process.exit(0);
