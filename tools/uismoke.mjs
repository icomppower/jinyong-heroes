// 以無頭 Chrome 載入 index.html?autotest=1，真的把世界建起來、真的跑幀、真的自走上華山，
// 再把數值結果讀回來。不截圖。
//
// 跑兩幕：
//   第一幕　從揚州出生，自走到華山之巔（唯一的通過條件）
//   第二幕　除錯參數直接落在華山山道上、夜裡（把「得先走半小時才測得到」壓成一次跳轉）
//
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

const profile = mkdtempSync(join(tmpdir(), 'jy3d-smoke-'));
const cleanup = () => {
  server?.kill();                     // 只關掉自己開的這支，不要 pkill chrome
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
};
process.on('exit', cleanup);

const base = remote
  ? remote.replace(/\/$/, '') + '/index.html'
  : `http://127.0.0.1:${PORT}/index.html`;

await new Promise(r => setTimeout(r, remote ? 0 : 800));

const decode = s => s
  .replace(/&quot;/g, '"').replace(/&#34;/g, '"')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

// 線上載入模組比本機慢，虛擬時間預算太小會在測試跑完前就 dump DOM
const BUDGET = remote ? 240000 : 150000;

// 第一次用新 profile 開 Chrome 要跑 first-run 設定、還會去叫 GoogleUpdater，
// 那段開銷會把第一幕整個吃掉（第二幕反而過，因為 profile 已經熱了）。
// 先空跑一次把 profile 暖起來，兩幕才是同一個起跑線。
function warmProfile() {
  spawnSync(CHROME, [
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, '--virtual-time-budget=2000', '--dump-dom', 'about:blank',
  ], { encoding: 'utf8', timeout: 120000 });
}

function act(query) {
  const res = spawnSync(CHROME, [
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`,
    // 無頭要有 WebGL，不然 runWalk 第一行就死。SwiftShader 是軟體算的，
    // 所以 p95 幀時只當「跑得動」的證據，不當效能數字——真機才算數。
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    `--virtual-time-budget=${BUDGET}`,
    '--window-size=760,480',   // SwiftShader 是 fragment bound，畫小一點才跑得出幾幀
    '--dump-dom',
    `${base}?${query}`,
  ], { encoding: 'utf8', timeout: BUDGET + 240000, maxBuffer: 64 * 1024 * 1024 });
  const dom = res.stdout || '';
  const m = dom.match(/<div id="testout"[^>]*>([\s\S]*?)<\/div>/);
  if (!m) {
    console.log(`無法取得測試結果（?${query}）。Chrome 輸出開頭：`);
    console.log(dom.slice(0, 1400) || res.stderr?.slice(0, 1400) || '(空)');
    return null;
  }
  try { return JSON.parse(decode(m[1])); }
  catch (e) { console.log('結果解析失敗：', e.message, '\n', m[1].slice(0, 800)); return null; }
}

const ACTS = [
  { name: '第一幕　揚州出生，自走上華山之巔', q: 'autotest=1' },
  { name: '第二幕　除錯參數直接落在華山山道，夜裡', q: 'autotest=1&pos=167,104&time=21' },
];

warmProfile();

let pass = 0, fail = 0;
const fails = [];
for (const a of ACTS) {
  console.log(`\n${a.name}`);
  const r = act(a.q);
  if (!r) { fail++; fails.push(a.name + ' — 沒有結果'); continue; }
  if (r.error) { console.log('  頁內錯誤：\n' + r.error.split('\n').slice(0, 8).map(l => '    ' + l).join('\n')); }
  for (const c of r.checks) {
    if (c.pass) { pass++; console.log(`  ✓ ${c.name}${c.detail ? ' — ' + c.detail : ''}`); }
    else { fail++; fails.push(`${a.name}／${c.name} — ${c.detail}`); console.log(`  ✗ ${c.name}${c.detail ? ' — ' + c.detail : ''}`); }
  }
  if (r.walk) console.log(`    · 自走 ${r.walk.travelled} 公尺／${r.walk.waypoints} 個航點，`
    + `終點距峰頂 ${r.walk.distToPeak} 公尺，海拔 ${r.walk.finalY}，${r.walk.place}`);
  if (r.p95 != null) console.log(`    · p95 幀時 ${r.p95.toFixed(1)} ms（SwiftShader 軟體算，只證明跑得動）`);
  if (r.stats) console.log(`    · draw call ${r.stats.drawCalls}／實例 ${r.stats.instances}／`
    + `建物 ${r.stats.buildings}／頂點 ${r.stats.terrainVerts}`);
  if (r.error) { fail++; fails.push(a.name + ' — 頁內錯誤'); }
}

console.log(`\n${'─'.repeat(52)}`);
console.log(`通過 ${pass}　失敗 ${fail}`);
if (fail) { console.log('\n失敗項目：'); fails.forEach(f => console.log('  · ' + f)); process.exit(1); }
console.log('全部通過。');
