// 介面煙霧測試：用真的按鍵、真的方向鍵、真的點地圖走一遍，把數值結果寫進 #testout。
// 由 tools/uismoke.mjs 以無頭 Chrome 載入 index.html?autotest=1 執行。

const out = [];
const errors = [];
let api = null;

const t = (name, ok, detail = '') => out.push({ name, ok: !!ok, detail: String(detail) });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const $ = sel => document.querySelector(sel);
const g = () => api.S.g;
const sui = () => api.S.sui;

async function waitFor(sel, ms = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const el = $(sel); if (el) return el; await sleep(30); }
  return null;
}
async function click(sel, ms = 4000) {
  const el = await waitFor(sel, ms);
  if (!el) throw new Error('找不到可點擊元素：' + sel);
  el.click(); await sleep(40); return el;
}

// 真手指點得到嗎？element.click() 會直接派給節點，無視被別的東西蓋住，
// 所以另外用 elementFromPoint 檢查該元素是不是自己中心點上最上層的東西。
function hittable(el) {
  if (!el) return { ok: false, why: '元素不存在' };
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return { ok: false, why: '尺寸為零' };
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) return { ok: false, why: '在畫面外' };
  const top = document.elementFromPoint(cx, cy);
  if (!top) return { ok: false, why: '該點沒有元素' };
  if (el === top || el.contains(top) || top.contains(el)) return { ok: true };
  const d = top.id ? '#' + top.id : top.className ? '.' + String(top.className).split(' ')[0] : top.tagName;
  return { ok: false, why: `被 ${d} 蓋住` };
}
async function tapChecked(sel, label, ms = 4000) {
  const el = await waitFor(sel, ms);
  const h = hittable(el);
  t(`${label}真的按得到（沒被蓋住）`, h.ok, h.why || '');
  if (el) { el.click(); await sleep(40); }
  return el;
}

const modalOpen = () => !!$('#modal.on');
async function dismissModal() {
  const btn = $('#modal.on .foot .btn.primary') || $('#modal.on .foot .btn');
  if (btn) { btn.click(); await sleep(60); return true; }
  return false;
}

// 走路途中可能跳出遭遇戰：打完再繼續
const isEncounterModal = () => /攔住去路/.test($('#modal.on .body')?.textContent || '');

async function handleInterrupts(stats) {
  let guard = 0;
  // 只處理遭遇戰旁白；商鋪、招募、頭目那些對話框要留著給斷言檢查
  while (modalOpen() && (isEncounterModal() || (api.S.battle && !api.S.battle.over)) && guard++ < 40) {
    await dismissModal();
    if (api.S.battle && !api.S.battle.over) {
      stats.battles++;
      await playBattle(api.S.battle, stats);
      let g2 = 0;
      while (modalOpen() && g2++ < 6) await dismissModal();   // 戰果、秘笈入手
      await sleep(80);
    }
  }
}

async function stepDir(dir, stats) {
  sui()?.press(dir);
  await sleep(24);
  await handleInterrupts(stats);
}

// 用遊戲自己的尋路走到某個實體，全程走 sui.press（跟真人按方向鍵同一條路徑）
async function walkToEntity(pred, stats, maxLegs = 6) {
  const F = await import('../src/core/field.js');
  for (let leg = 0; leg < maxLegs; leg++) {
    const sc = api.G.curScene(g());
    const ents = api.G.activeEntities(g(), sc);
    if (!ents.find(pred)) return 'missing';
    const path = F.pathToEntity(sc, g().pos, pred, ents);
    if (!path) return 'nopath';
    const startScene = g().scene;
    for (const d of path) {
      await stepDir(d, stats);
      if (g().scene !== startScene) return 'scene';
      if (modalOpen()) return 'dialog';
    }
    if (modalOpen()) return 'dialog';
    return 'arrived';
  }
  return 'giveup';
}

export async function run(_api) {
  api = _api;
  window.onerror = (m, s, l) => errors.push(`${m} @${l}`);
  window.onunhandledrejection = e => errors.push('rejection: ' + (e.reason?.message || e.reason));
  try { await scenario(); }
  catch (e) { errors.push('測試中止：' + (e?.message || e)); }
  t('執行期間沒有未捕捉的例外', errors.length === 0, errors.join(' | '));

  const el = document.createElement('div');
  el.id = 'testout';
  el.style.display = 'none';
  el.textContent = JSON.stringify({
    pass: out.filter(o => o.ok).length, fail: out.filter(o => !o.ok).length, results: out,
  });
  document.body.appendChild(el);
}

async function scenario() {
  const stats = { battles: 0 };
  try { localStorage.clear(); } catch {}

  // ── 開新遊戲（開場這條路徑逐步檢查點得到與否）──
  await tapChecked('[data-new]', '標題的「新的江湖」');
  await waitFor('#modal.on #nm');
  t('取名對話框浮在標題之上', hittable(document.getElementById('nm')).ok,
    hittable(document.getElementById('nm')).why || '');
  document.getElementById('nm').value = '測試';
  await tapChecked('#modal.on .foot .btn.primary', '取名框的「入江湖」');
  await tapChecked('#modal.on .foot .btn.primary', '開場白的「繼續」');
  await sleep(150);

  t('新遊戲建立成功', !!g() && g().party.length === 1, g() ? `隊伍 ${g().party.length} 人` : '無存檔物件');
  t('主角名字沿用輸入值', g().party[0].name === '測試', g().party[0].name);
  t('開場在大地圖上（不是選單）', g().scene === 'overworld', g().scene);
  const cv = $('#stage canvas');
  t('場景畫布有實際尺寸', cv && cv.width > 0 && cv.height > 0, cv ? `${cv.width}×${cv.height}` : '無畫布');
  t('場景畫面已建立', !!sui());

  // ── 走動：鍵盤 ──
  const p0 = { ...g().pos };
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  t('按鍵有被場景畫面接到', sui().held.has('down'), `held=[${[...sui().held]}] paused=${sui().paused}`);
  await sleep(150);
  for (let i = 0; i < 2; i++) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    await sleep(150);
  }
  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown', bubbles: true }));
  await sleep(120);
  await handleInterrupts(stats);
  const p1 = { ...g().pos };
  t('按方向鍵人物真的會走', p1.x !== p0.x || p1.y !== p0.y,
    `(${p0.x},${p0.y}) → (${p1.x},${p1.y})`);
  t('走動會累計步數', g().steps > 0, `${g().steps} 步`);

  // ── 走動：畫面上的方向鍵 ──
  const p2 = { ...g().pos };
  await tapChecked('[data-d="up"]', '畫面方向鍵');
  await sleep(120);
  await handleInterrupts(stats);
  t('點畫面方向鍵也會走', g().pos.x !== p2.x || g().pos.y !== p2.y,
    `(${p2.x},${p2.y}) → (${g().pos.x},${g().pos.y})`);

  // ── 走動：點地圖自動尋路 ──
  {
    const sc = api.G.curScene(g());
    const F = await import('../src/core/field.js');
    // 找一個附近走得到的目標格
    let target = null;
    for (let r = 3; r <= 6 && !target; r++) {
      for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
        const x = g().pos.x + dx, y = g().pos.y + dy;
        if (F.passable(sc, x, y, api.G.activeEntities(g(), sc))
          && F.pathTo(sc, g().pos, { x, y }, { ents: api.G.activeEntities(g(), sc) })) { target = { x, y }; break; }
      }
    }
    if (target) {
      const cam = sui().camera();
      const rect = sui().canvas.getBoundingClientRect();
      sui().canvas.dispatchEvent(new PointerEvent('pointerdown', {
        clientX: rect.left + target.x * sui().ts - cam.x + sui().ts / 2,
        clientY: rect.top + target.y * sui().ts - cam.y + sui().ts / 2,
        bubbles: true,
      }));
      t('點地圖會排出一條路徑', sui().queue.length > 0, `${sui().queue.length} 步`);
      const before = { ...g().pos };
      for (let i = 0; i < 12 && sui().queue.length; i++) { await sleep(140); await handleInterrupts(stats); }
      t('沿著點出的路徑走過去', g().pos.x !== before.x || g().pos.y !== before.y,
        `(${before.x},${before.y}) → (${g().pos.x},${g().pos.y})`);
    } else t('點地圖會排出一條路徑', false, '附近找不到可走的目標格');
  }

  // ── 走進揚州城 ──
  const enter = await walkToEntity(e => e.type === 'gate' && e.to === 'yangzhou', stats);
  await handleInterrupts(stats);
  t('走到城門就進得了城', g().scene === 'yangzhou', `${enter} / 現在在 ${g().scene}`);

  // ── 撞到掌櫃就開商鋪 ──
  {
    const r = await walkToEntity(e => e.type === 'shop', stats);
    const opened = modalOpen() && /商鋪/.test($('#modal.on h3')?.textContent || '');
    t('走上去撞到掌櫃便開商鋪', opened, `${r}`);
    if (opened) {
      const goldBefore = g().gold;
      await click('#modal.on [data-buy="p_jinchuang"]');
      await sleep(80);
      t('在商鋪買東西會扣銀兩', g().gold < goldBefore, `${goldBefore} → ${g().gold}`);
      while (modalOpen()) await dismissModal();
    }
  }

  // ── 撞到韋小寶就能入夥 ──
  {
    const r = await walkToEntity(e => e.type === 'recruit' && e.who === 'weixiaobao', stats);
    const opened = modalOpen();
    t('走上去撞到俠客便能交談', opened, `${r}`);
    if (opened) {
      await dismissModal();          // 「邀他同行」是主要按鈕
      await sleep(60);
      while (modalOpen()) await dismissModal();
      t('可在揚州請得韋小寶', g().party.length === 2, `隊伍 ${g().party.length} 人`);
    }
  }

  // ── 撞到強敵就開打 ──
  {
    const r = await walkToEntity(e => e.type === 'boss', stats);
    const opened = modalOpen();
    t('走到深處會遇上強敵', opened, `${r}`);
    if (opened) {
      await dismissModal();          // 「動手」
      await sleep(120);
      const b = api.S.battle;
      t('頭目戰確實開打', !!b && !b.over, b ? `敵方 ${b.units.filter(u => u.side === 'enemy').length} 人` : '沒開打');
      if (b) {
        const startRound = b.round;
        const acted = await playBattle(b, stats);
        t('玩家在戰鬥中實際出手過', acted.attacks > 0, `出招 ${acted.attacks} 次、移動 ${acted.moves} 次`);
        t('戰鬥回合有推進（非卡死）', b.round >= startRound, `第 ${startRound} → ${b.round} 回合`);
        t('戰鬥分出結果', !!b.over, b.over || '仍在進行');
        let guard = 0;
        while (modalOpen() && guard++ < 6) await dismissModal();
        await sleep(200);
        if (b.over === 'win') {
          t('勝利後該地標記為已了結', !!g().flags['cleared:yangzhou']);
          // ── 打倒強敵之後，秘笈才拿得到 ──
          const bk = await walkToEntity(e => e.type === 'book', stats);
          let guard2 = 0;
          while (modalOpen() && guard2++ < 4) await dismissModal();
          t('打倒強敵後走過去撿得到秘笈', g().books.includes('b_yeqiu'), `${bk} / 秘笈 ${g().books.length} 部`);
        }
      }
    }
  }

  // ── 走出城 ──
  {
    const r = await walkToEntity(e => e.type === 'exit', stats);
    await handleInterrupts(stats);
    t('走到出口便離開場景回到大地圖', g().scene === 'overworld', `${r} / 現在在 ${g().scene}`);
  }

  // ── 秘笈習武 ──
  if (g().books.includes('b_yeqiu')) {
    await click('[data-w="party"]');
    await click('[data-tab="book"]');
    t('秘笈頁列出已得秘笈', /野球拳譜/.test($('#modal.on .body')?.textContent || ''));
    await click('[data-close]');
  }

  // ── 行囊與裝備 ──
  await click('[data-w="bag"]');
  t('行囊列出物品', /金創藥/.test($('#modal.on .body')?.textContent || ''));
  while (modalOpen()) await dismissModal();

  api.G.addItem(g(), 'w_qingang', 1);
  await click('[data-w="party"]');
  await click('[data-tab="equip"]');
  await click('#modal.on [data-eq="w_qingang"]');
  await sleep(100);
  t('可以換上新兵器', g().party[0].equip.weapon === 'w_qingang', g().party[0].equip.weapon);
  await click('[data-close]');

  // ── 存讀檔 ──
  api.G.saveTo(9, g());
  const back = api.G.loadFrom(9);
  t('存檔可原樣讀回',
    back && back.day === g().day && back.party.length === g().party.length
      && back.pos.x === g().pos.x && back.pos.y === g().pos.y,
    back ? `第 ${back.day} 天／${back.party.length} 人／(${back.pos.x},${back.pos.y})` : '讀檔失敗');
  t('存檔摘要可讀', !!api.G.saveInfo(9)?.name, api.G.saveInfo(9)?.name);
}

const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

// 用真的按鈕與畫布點擊打完一場仗
async function playBattle(b, stats) {
  let moves = 0, attacks = 0, guard = 0;
  const { reachable } = await import('../src/core/battle.js');
  while (!b.over && guard++ < 220) {
    const skillBtn = $('[data-a="skill"]');
    if (!skillBtn) { await sleep(60); continue; }
    const u = b.active;
    if (!u || u.side !== 'ally') { await sleep(60); continue; }
    const foes = b.units.filter(x => x.side === 'enemy' && !x.down);
    if (!foes.length) break;
    const target = foes.reduce((a, c) => (manhattan(u, c) < manhattan(u, a) ? c : a));

    if (manhattan(u, target) > 1 && !u.moved) {
      const spots = reachable(b, u);
      if (spots.length) {
        const best = spots.reduce((a, c) => (manhattan(c, target) < manhattan(a, target) ? c : a));
        $('[data-a="move"]')?.click();
        await sleep(40);
        tapTile(best.x, best.y);
        await sleep(60);
        moves++;
      }
    }
    if (manhattan(u, target) <= 1) {
      $('[data-a="skill"]')?.click();
      const row = await waitFor('#modal.on [data-s]:not([disabled])', 1500);
      if (row) {
        row.click(); await sleep(60);
        tapTile(target.x, target.y);
        attacks++;
        await sleep(260);
      } else $('[data-a="wait"]')?.click();
    } else $('[data-a="wait"]')?.click();
    await sleep(90);
  }
  return { moves, attacks };
}

function tapTile(x, y) {
  const bui = api.S.bui;
  const r = bui.canvas.getBoundingClientRect();
  bui.canvas.dispatchEvent(new PointerEvent('pointerdown', {
    clientX: r.left + bui.ox + x * bui.ts + bui.ts / 2,
    clientY: r.top + bui.oy + y * bui.ts + bui.ts / 2,
    bubbles: true,
  }));
}
