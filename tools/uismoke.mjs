// 以無頭 Chrome 載入 index.html?autotest=1，跑真實介面操作，讀回數值斷言。
// 用法：node tools/uismoke.mjs            （起本機伺服器測本地檔案）
//       node tools/uismoke.mjs <網址>      （直接測已部署的線上版）

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 8137 + (process.pid % 200);
const remote = process.argv[2];

const server = remote ? null : spawn('python3', ['-m', 'http.server', String(PORT)], {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: 'ignore',
});

const profile = mkdtempSync(join(tmpdir(), 'jy-smoke-'));
const cleanup = () => {
  server?.kill();                     // 只關掉自己開的這支
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
};
process.on('exit', cleanup);

const base = remote
  ? remote.replace(/\/$/, '') + '/index.html'
  : `http://127.0.0.1:${PORT}/index.html`;

await new Promise(r => setTimeout(r, remote ? 0 : 700));

const res = spawnSync(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${profile}`,
  '--virtual-time-budget=90000',
  '--window-size=1280,860',
  '--dump-dom',
  `${base}?autotest=1`,
], { encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024 });

const dom = res.stdout || '';
const m = dom.match(/<div id="testout"[^>]*>([\s\S]*?)<\/div>/);
if (!m) {
  console.log('無法取得測試結果。Chrome 輸出開頭：');
  console.log(dom.slice(0, 1200) || res.stderr?.slice(0, 1200) || '(空)');
  cleanup();
  process.exit(1);
}

const decode = s => s
  .replace(/&quot;/g, '"').replace(/&#34;/g, '"')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

let data;
try { data = JSON.parse(decode(m[1])); }
catch (e) { console.log('結果解析失敗：', e.message, '\n', m[1].slice(0, 600)); cleanup(); process.exit(1); }

console.log('\n【介面煙霧測試】以無頭瀏覽器實際點按');
for (const r of data.results) {
  console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
}
console.log(`\n通過 ${data.pass}　失敗 ${data.fail}`);
cleanup();
process.exit(data.fail ? 1 : 0);
