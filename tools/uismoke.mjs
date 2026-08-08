// 以無頭 Chrome 載入 index.html?autotest=1，跑真實介面操作，讀回數值斷言。
// 跑兩幕：第一幕從頭玩起，第二幕用除錯參數直接落在華山山道上。
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

const decode = s => s
  .replace(/&quot;/g, '"').replace(/&#34;/g, '"')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

function act(query) {
  const res = spawnSync(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`,
    '--virtual-time-budget=90000',
    '--window-size=1280,860',
    '--dump-dom',
    `${base}?${query}`,
  ], { encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
  const dom = res.stdout || '';
  const m = dom.match(/<div id="testout"[^>]*>([\s\S]*?)<\/div>/);
  if (!m) {
    console.log(`無法取得測試結果（?${query}）。Chrome 輸出開頭：`);
    console.log(dom.slice(0, 1200) || res.stderr?.slice(0, 1200) || '(空)');
    return null;
  }
  try { return JSON.parse(decode(m[1])); }
  catch (e) { console.log('結果解析失敗：', e.message, '\n', m[1].slice(0, 600)); return null; }
}

const ACTS = [
  { name: '第一幕　從頭玩起', q: 'autotest=1' },
  {
    name: '第二幕　除錯參數直接落地（華山山道、夜裡、十三部秘笈）',
    q: 'autotest=1&stage=2&pos=164,105&time=21&books=13&cam=24&gold=900',
  },
];

let pass = 0, fail = 0;
console.log('\n【介面煙霧測試】以無頭瀏覽器實際點按');
for (const a of ACTS) {
  const data = act(a.q);
  if (!data) { cleanup(); process.exit(1); }
  console.log(`\n${a.name}`);
  for (const r of data.results) {
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
  }
  pass += data.pass; fail += data.fail;
}
console.log(`\n通過 ${pass}　失敗 ${fail}`);
cleanup();
process.exit(fail ? 1 : 0);
