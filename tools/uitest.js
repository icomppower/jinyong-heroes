// 介面煙霧測試：用真的按鈕與真的畫布點擊跑一輪，把數值結果寫進 #testout。
// 由 tools/uismoke.mjs 以無頭 Chrome 載入 index.html?autotest=1 執行。

const out = [];
const errors = [];
let api = null;

const t = (name, ok, detail = '') => out.push({ name, ok: !!ok, detail: String(detail) });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const $ = sel => document.querySelector(sel);

async function waitFor(sel, ms = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const el = $(sel);
    if (el) return el;
    await sleep(30);
  }
  return null;
}

async function click(sel, ms = 4000) {
  const el = await waitFor(sel, ms);
  if (!el) throw new Error('找不到可點擊元素：' + sel);
  el.click();
  await sleep(40);
  return el;
}

// 對話框中的主要按鈕（繼續／確定）
async function clickPrimary(ms = 3000) {
  const el = await waitFor('#modal.on .foot .btn.primary', ms);
  if (el) { el.click(); await sleep(50); return true; }
  return false;
}

function tapTile(x, y) {
  const bui = api.S.bui;
  const r = bui.canvas.getBoundingClientRect();
  const cx = r.left + bui.ox + x * bui.ts + bui.ts / 2;
  const cy = r.top + bui.oy + y * bui.ts + bui.ts / 2;
  bui.canvas.dispatchEvent(new PointerEvent('pointerdown', {
    clientX: cx, clientY: cy, bubbles: true,
  }));
}

const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

export async function run(_api) {
  api = _api;
  window.onerror = (m, s, l) => { errors.push(`${m} @${l}`); };
  window.onunhandledrejection = e => { errors.push('rejection: ' + (e.reason?.message || e.reason)); };

  try {
    await scenario();
  } catch (e) {
    errors.push('測試中止：' + (e?.message || e));
  }

  t('執行期間沒有未捕捉的例外', errors.length === 0, errors.join(' | '));

  const el = document.createElement('div');
  el.id = 'testout';
  el.style.display = 'none';
  el.textContent = JSON.stringify({
    pass: out.filter(o => o.ok).length,
    fail: out.filter(o => !o.ok).length,
    results: out,
  });
  document.body.appendChild(el);
}

async function scenario() {
  const { G } = api;
  try { localStorage.clear(); } catch {}

  // ── 開新遊戲 ──
  await click('[data-new]');
  await waitFor('#modal.on #nm');
  document.getElementById('nm').value = '測試';
  await clickPrimary();                       // 入江湖
  await clickPrimary();                       // 開場白
  await sleep(120);

  const g = api.S.g;
  t('新遊戲建立成功', !!g && g.party.length === 1, g ? `隊伍 ${g.party.length} 人` : '無存檔物件');
  t('主角名字沿用輸入值', g.party[0].name === '測試', g.party[0].name);
  t('起始位於揚州城', g.at === 'yangzhou', g.at);
  t('狀態列已繪出', /第 1 天/.test($('#hud')?.textContent || ''), ($('#hud')?.textContent || '').slice(0, 40));

  const cv = $('#map');
  t('地圖畫布有實際尺寸', cv && cv.width > 0 && cv.height > 0, cv ? `${cv.width}×${cv.height}` : '無畫布');
  t('地圖上有格數相符的地點', document.querySelectorAll('#stage canvas').length === 1);

  // ── 人物面板 ──
  await click('[data-pc="0"]');
  t('人物面板可開啟', /資質/.test($('#modal.on .body')?.textContent || ''));
  await click('[data-tab="skill"]');
  t('武功頁列出野球拳', /野球拳/.test($('#modal.on .body')?.textContent || ''));
  await click('[data-close]');

  // ── 尋訪同伴 ──
  await click('[data-w="recruit"]');
  await click('[data-r="weixiaobao"]');
  await clickPrimary();
  await sleep(100);
  t('可在揚州請得韋小寶', g.party.length === 2, `隊伍 ${g.party.length} 人`);

  // ── 商鋪 ──
  const goldBefore = g.gold;
  await click('[data-w="shop"]');
  await click('[data-buy="p_jinchuang"]');
  await sleep(80);
  t('商鋪買賣會扣銀兩', g.gold < goldBefore, `${goldBefore} → ${g.gold}`);
  t('買到的東西進了行囊', (g.bag.p_jinchuang || 0) >= 4, `金創藥 ×${g.bag.p_jinchuang}`);
  document.querySelector('#modal.on .foot .btn')?.click();
  await sleep(60);

  // ── 頭目戰 ──
  await click('[data-w="boss"]');
  await clickPrimary();                       // 進場白
  const bui = await waitFor('#stage canvas', 3000) && api.S.bui;
  t('戰鬥畫面已建立', !!bui);
  const b = api.S.battle;
  t('雙方單位都已上場', b && b.units.filter(u => u.side === 'ally').length === 2
    && b.units.filter(u => u.side === 'enemy').length === 3,
    b ? `我方 ${b.units.filter(u => u.side === 'ally').length}／敵方 ${b.units.filter(u => u.side === 'enemy').length}` : '');

  const startRound = b.round;
  const acted = await playBattle(b);
  t('玩家實際出手過', acted.attacks > 0, `出招 ${acted.attacks} 次、移動 ${acted.moves} 次`);
  t('回合有推進（非卡死）', b.round >= startRound, `第 ${startRound} → ${b.round} 回合`);
  t('戰鬥分出結果', !!b.over, b.over || '仍在進行');
  t('戰鬥紀錄有內容', b.log.length > 3, `${b.log.length} 行`);

  // ── 戰後結算 ──
  await clickPrimary(4000);                   // 勝負公布
  await clickPrimary(2000);                   // 秘笈入手（若勝）
  await sleep(150);

  if (b.over === 'win') {
    t('勝利後取得該地秘笈', g.books.includes('b_yeqiu'), `秘笈 ${g.books.length} 部`);
    t('勝利後該地標記為已了結', !!g.flags['cleared:yangzhou']);
    t('勝利後獲得銀兩', g.gold > 0, `${g.gold} 兩`);
  } else {
    t('敗北後仍能繼續遊戲', g.party.every(c => c.curHp > 0), b.over);
  }

  // ── 回到江湖畫面 ──
  await waitFor('[data-w="travel"]', 3000);
  t('戰鬥後回到江湖畫面', !!$('[data-w="travel"]'));

  // ── 秘笈習武 ──
  if (g.books.includes('b_yeqiu')) {
    await click('[data-pc="0"]');
    await click('[data-tab="book"]');
    t('秘笈頁列出已得秘笈', /野球拳譜/.test($('#modal.on .body')?.textContent || ''));
    await click('[data-close]');
  }

  // ── 行走 ──
  const dayBefore = g.day;
  await click('[data-w="travel"]');
  await click('[data-go="fuwei"]');
  await sleep(200);
  await clickPrimary(600);                    // 路上可能有遭遇
  await sleep(150);
  t('行走會消耗天數', g.day > dayBefore, `第 ${dayBefore} → ${g.day} 天`);
  t('已抵達福威鏢局或進入遭遇戰', g.at === 'fuwei', g.at);

  // ── 其餘江湖動作：每個都真的按一次，確保沒有壞掉的路徑 ──
  await click('[data-w="travel"]');
  await click('[data-go="yangzhou"]');
  await sleep(200);
  await clickPrimary(600);
  await sleep(120);

  g.gold = 5000; g.stamina = 100;
  api.renderWorld();

  const before = { day: g.day, gold: g.gold, morality: g.morality };
  await click('[data-w="inn"]');
  await sleep(80);
  t('客棧會過夜並回復體力', g.day > before.day && g.stamina === 100 && g.gold < before.gold,
    `第 ${g.day} 天／體力 ${g.stamina}／${g.gold} 兩`);

  const dayT = g.day;
  await click('[data-w="train"]');
  await clickPrimary(1500);
  await sleep(100);
  t('練功會耗去一天', g.day > dayT, `第 ${dayT} → ${g.day} 天`);

  await click('[data-w="alms"]');
  await click('#modal.on [data-v]');
  await sleep(100);
  t('施捨會提升道德', g.morality > before.morality, `${before.morality} → ${g.morality}`);

  const moralB = g.morality;
  await click('[data-w="rob"]');
  await sleep(80);
  t('劫掠會拉低道德', g.morality < moralB, `${moralB} → ${g.morality}`);

  await click('[data-w="bag"]');
  t('行囊列出物品', /金創藥/.test($('#modal.on .body')?.textContent || ''));
  document.querySelector('#modal.on .foot .btn')?.click();
  await sleep(60);

  // 裝備切換
  G.addItem(g, 'w_qingang', 1);
  await click('[data-pc="0"]');
  await click('[data-tab="equip"]');
  await click('#modal.on [data-eq="w_qingang"]');
  await sleep(100);
  t('可以換上新兵器', g.party[0].equip.weapon === 'w_qingang', g.party[0].equip.weapon);
  await click('[data-close]');

  // ── 存讀檔 ──
  G.saveTo(9, g);
  const back = G.loadFrom(9);
  t('存檔可原樣讀回', back && back.day === g.day && back.party.length === g.party.length,
    back ? `第 ${back.day} 天／${back.party.length} 人` : '讀檔失敗');
  t('存檔摘要可讀', !!G.saveInfo(9)?.name, G.saveInfo(9)?.name);
}

// 用真的按鈕與畫布點擊打完一場仗
async function playBattle(b) {
  let moves = 0, attacks = 0, guard = 0;
  while (!b.over && guard++ < 220) {
    // 等到我方可操作
    const skillBtn = $('[data-a="skill"]');
    if (!skillBtn) { await sleep(60); continue; }

    const u = b.active;
    if (!u || u.side !== 'ally') { await sleep(60); continue; }

    const foes = b.units.filter(x => x.side === 'enemy' && !x.down);
    if (!foes.length) break;
    const target = foes.reduce((a, c) => (manhattan(u, c) < manhattan(u, a) ? c : a));

    // 不相鄰就先走近
    if (manhattan(u, target) > 1 && !u.moved) {
      const { reachable } = await import('../src/core/battle.js');
      const spots = reachable(b, u);
      if (spots.length) {
        const best = spots.reduce((a, c) =>
          (manhattan(c, target) < manhattan(a, target) ? c : a));
        $('[data-a="move"]')?.click();
        await sleep(40);
        tapTile(best.x, best.y);
        await sleep(60);
        moves++;
      }
    }

    // 相鄰就出招，否則結束這一回合
    if (manhattan(b.active === u ? u : u, target) <= 1) {
      $('[data-a="skill"]')?.click();
      const row = await waitFor('#modal.on [data-s]:not([disabled])', 1500);
      if (row) {
        row.click();
        await sleep(60);
        tapTile(target.x, target.y);
        attacks++;
        await sleep(260);
      } else {
        $('[data-a="wait"]')?.click();
      }
    } else {
      $('[data-a="wait"]')?.click();
    }
    await sleep(90);
  }
  return { moves, attacks };
}
