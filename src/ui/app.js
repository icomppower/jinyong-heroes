// 主控：標題、江湖地圖、各式面板，以及與戰鬥畫面的銜接。

import * as G from '../core/game.js';
import { LOCATIONS, LOC_BY_ID, travelCost } from '../data/world.js';
import { ITEM_BY_ID, QUEST_BOOKS } from '../data/items.js';
import { SKILL_BY_ID, KIND_NAME } from '../data/skills.js';
import {
  derived, maxHp, maxMp, moveRange, canLearn, skillExpToNext, expToNext,
} from '../core/rules.js';
import { BattleUI, skillRows } from './battleui.js';

const app = document.getElementById('app');
const modalEl = document.getElementById('modal');
const S = { g: null, battle: null, bui: null, isBoss: false, sel: 0, speed: 340 };
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// ═══ 對話框 ═══
function modal(title, body, foot = [{ t: '關閉' }]) {
  modalEl.className = 'on';
  modalEl.innerHTML = `<div class="dlg"><h3>${title}</h3><div class="body">${body}</div>
    <div class="foot">${foot.map((f, i) => `<button class="btn ${f.primary ? 'primary' : ''}" data-f="${i}">${f.t}</button>`).join('')}</div></div>`;
  modalEl.querySelectorAll('[data-f]').forEach(b => {
    b.onclick = () => {
      const f = foot[+b.dataset.f];
      // 先把輸入值抄下來——closeModal 會清空內容，之後就讀不到了
      const vals = {};
      modalEl.querySelectorAll('input[id]').forEach(i => { vals[i.id] = i.value; });
      closeModal();
      f.fn?.(vals);
    };
  });
  return modalEl.querySelector('.body');
}
function closeModal() { modalEl.className = ''; modalEl.innerHTML = ''; }
modalEl.onclick = e => { if (e.target === modalEl) closeModal(); };

function say(html, then) {
  modal('　', `<div class="narr">${html}</div>`, [{ t: '繼續', primary: true, fn: then }]);
}

// ═══ 標題 ═══
function renderTitle() {
  const slots = [1, 2, 3].map(i => {
    const s = G.saveInfo(i);
    return `<div class="slot"><button class="btn" data-load="${i}" ${s ? '' : 'disabled'} style="flex:1;text-align:left">
      ${s ? `${esc(s.name)}　Lv.${s.lvl}　${esc(s.at || '')}　秘笈 ${s.books}/14　第 ${s.day} 天` : `存檔 ${i}：空`}
    </button></div>`;
  }).join('');
  app.innerHTML = `<div id="title">
    <div class="big">金庸群俠傳</div>
    <div class="sub">十四部秘笈　一場江湖</div>
    <div class="menu">
      <button class="btn primary" data-new>新的江湖</button>
      ${slots}
    </div>
    <div class="credit">方向：點地圖行走 · 戰鬥為方格戰棋 · 進度自動存於瀏覽器</div>
  </div>`;
  app.querySelector('[data-new]').onclick = askName;
  app.querySelectorAll('[data-load]').forEach(b => b.onclick = () => {
    const g = G.loadFrom(+b.dataset.load);
    if (g) { S.g = g; S.slot = +b.dataset.load; renderWorld(); }
  });
}

function askName() {
  modal('請問尊姓大名', `<div class="small muted">你自異世醒來，身無長物，只記得自己的名字。</div>
    <input id="nm" maxlength="6" value="無名" style="width:100%;margin-top:10px;padding:.5em;
      font-family:inherit;font-size:17px;border:1px solid var(--line);background:var(--paper2)">`,
    [{ t: '取消' }, {
      t: '入江湖', primary: true, fn: vals => {
        const nm = (vals.nm || '無名').trim().slice(0, 6) || '無名';
        S.g = G.newGame(nm);
        S.slot = 1;
        renderWorld();
        say('你在揚州城外的荒草堆裡醒來。<br><br>頭很痛，記不清自己是怎麼到這裡的。<br>身上只有幾十文錢，和一把不知哪來的木刀。<br><br>遠處是運河的帆影，河上有船夫在唱曲——<br>這是一個你只在書裡讀過的世界。');
      }
    }]);
  setTimeout(() => document.getElementById('nm')?.select(), 30);
}

// ═══ 世界畫面 ═══
function shell() {
  app.innerHTML = `
    <div id="hud"></div>
    <div id="main">
      <div id="left">
        <div id="stage"></div>
        <div id="logbox"></div>
      </div>
      <div id="right">
        <div id="side"></div>
        <div id="actions"></div>
      </div>
    </div>`;
  return {
    hud: document.getElementById('hud'),
    stage: document.getElementById('stage'),
    log: document.getElementById('logbox'),
    side: document.getElementById('side'),
    actions: document.getElementById('actions'),
  };
}

let R = null;

function renderWorld() {
  if (S.bui) { S.bui.destroy(); S.bui = null; }
  S.battle = null;
  R = shell();
  R.stage.innerHTML = '<canvas id="map"></canvas>';
  mapSetup();
  paintWorld();
  autosave();
}

function paintWorld() {
  paintHud();
  paintSide();
  paintActions();
  paintLog();
  drawMap();
}

function paintHud() {
  const g = S.g;
  R.hud.innerHTML = `
    <b>${esc(g.party[0].name)}</b>
    <span>第 <b>${g.day}</b> 天</span>
    <span>銀兩 <b>${g.gold}</b></span>
    <span>聲望 <b>${g.fame}</b></span>
    <span>道德 <b>${g.morality}</b></span>
    <span>體力 <b>${g.stamina}</b>/100</span>
    <span>秘笈 <b style="color:var(--red)">${g.books.length}</b>/14</span>
    <span class="sp"></span>
    <button class="btn sm" data-h="save">存檔</button>
    <button class="btn sm" data-h="title">回標題</button>`;
  R.hud.querySelector('[data-h="save"]').onclick = saveDialog;
  R.hud.querySelector('[data-h="title"]').onclick = () =>
    modal('離開', '<div class="narr">回到標題畫面？未存的進度會留在自動存檔中。</div>',
      [{ t: '留下' }, { t: '離開', primary: true, fn: () => { autosave(); renderTitle(); } }]);
}

function paintLog() {
  R.log.innerHTML = S.g.log.slice(-30).map(l => `<div>${l}</div>`).join('');
  R.log.scrollTop = R.log.scrollHeight;
}

function paintSide() {
  const g = S.g, loc = G.here(g);
  const cleared = G.isCleared(g, loc.id);
  const bk = G.bookHere(g);
  const chips = [];
  if (loc.inn != null) chips.push('<span class="chip">客棧</span>');
  if (loc.shop) chips.push('<span class="chip">商鋪</span>');
  if (loc.recruit) chips.push('<span class="chip">可尋訪</span>');
  if (bk) chips.push(`<span class="chip ${bk.got ? 'on' : 'off'}">秘笈${bk.got ? '已得' : '未得'}</span>`);
  if (loc.boss) chips.push(`<span class="chip ${cleared ? 'on' : ''}">${cleared ? '已了結' : '有強敵'}</span>`);

  R.side.innerHTML = `
    <div class="loc-name">${loc.name}</div>
    <div>${chips.join('')}</div>
    <div class="loc-desc">${loc.desc}</div>
    <hr>
    <div class="small muted" style="letter-spacing:.2em">隊伍（${g.party.length}/${G.PARTY_MAX}）</div>
    ${g.party.map((c, i) => {
      const mh = maxHp(c), mm = maxMp(c);
      return `<button class="pc" data-pc="${i}" style="width:100%;text-align:left;cursor:pointer">
        <div class="nm"><b>${esc(c.name)}</b>
          <span class="tiny muted">${c.title || ''}　Lv.${c.lvl}　資質 ${c.apt}</span></div>
        <div class="bar hp"><i style="width:${(c.curHp ?? mh) / mh * 100}%"></i></div>
        <div class="bar mp"><i style="width:${(c.curMp ?? mm) / mm * 100}%"></i></div>
        <div class="tiny muted">氣血 ${c.curHp ?? mh}/${mh}　內力 ${c.curMp ?? mm}/${mm}　武功 ${c.skills.length} 門</div>
      </button>`;
    }).join('')}`;
  R.side.querySelectorAll('[data-pc]').forEach(b => b.onclick = () => charSheet(+b.dataset.pc));
}

function paintActions() {
  const g = S.g, loc = G.here(g);
  const cleared = G.isCleared(g, loc.id);
  const btns = [];
  btns.push(['travel', '前往', false]);
  if (loc.boss) btns.push(['boss', cleared ? '舊地重遊' : (loc.type === 'final' ? '華山論劍' : '一探究竟'), false]);
  if (loc.mobs) btns.push(['roam', '遊蕩', g.stamina < 8]);
  if (loc.inn != null) btns.push(['inn', `客棧（${loc.inn} 兩）`, g.gold < loc.inn]);
  if (loc.shop) btns.push(['shop', '商鋪', false]);
  if (loc.recruit) btns.push(['recruit', '尋訪', false]);
  btns.push(['train', '練功', g.stamina < 15]);
  btns.push(['bag', '行囊', false]);
  if (loc.type === 'town') { btns.push(['alms', '施捨', g.gold < 50]); btns.push(['rob', '劫掠', false]); }

  R.actions.innerHTML = `<div class="row">${btns.map(([k, t, dis]) =>
    `<button class="btn ${k === 'boss' && !cleared ? 'primary' : ''}" data-w="${k}" ${dis ? 'disabled' : ''}>${t}</button>`).join('')}</div>`;
  R.actions.querySelectorAll('[data-w]').forEach(b => b.onclick = () => worldAction(b.dataset.w));
}

function worldAction(a) {
  const g = S.g, loc = G.here(g);
  switch (a) {
    case 'travel': travelDialog(); break;
    case 'boss': challenge(); break;
    case 'roam': roam(); break;
    case 'inn': { const r = G.inn(g); if (!r.ok) toast(r.why); paintWorld(); autosave(); break; }
    case 'shop': shopDialog(); break;
    case 'recruit': recruitDialog(); break;
    case 'train': trainDialog(); break;
    case 'bag': bagDialog(); break;
    case 'alms': almsDialog(); break;
    case 'rob': { const r = G.extort(g); toast(`得手 ${r.gain} 兩，但道德有虧。`); paintWorld(); autosave(); break; }
  }
}

function toast(msg) { G.say(S.g, msg); paintLog(); paintHud(); }

// ═══ 地圖 ═══
let mapCv, mapCtx, mapHover = null;

function mapSetup() {
  mapCv = document.getElementById('map');
  mapCtx = mapCv.getContext('2d');
  const resize = () => {
    const r = R.stage.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    mapCv.width = r.width * dpr; mapCv.height = r.height * dpr;
    mapCv._dpr = dpr; mapCv._w = r.width; mapCv._h = r.height;
    drawMap();
  };
  window.addEventListener('resize', resize);
  mapCv.addEventListener('pointermove', e => {
    const l = pickLoc(e);
    if (l !== mapHover) { mapHover = l; drawMap(); }
  });
  mapCv.addEventListener('pointerleave', () => { mapHover = null; drawMap(); });
  mapCv.addEventListener('pointerdown', e => {
    const l = pickLoc(e);
    if (!l || l.id === S.g.at) return;
    if (G.here(S.g).links.includes(l.id)) doTravel(l.id);
  });
  resize();
}

function locXY(l) {
  const pad = 34;
  return {
    x: pad + (l.x / 100) * (mapCv._w - pad * 2),
    y: pad + (l.y / 100) * (mapCv._h - pad * 2),
  };
}

function pickLoc(e) {
  const r = mapCv.getBoundingClientRect();
  const px = e.clientX - r.left, py = e.clientY - r.top;
  for (const l of LOCATIONS) {
    const p = locXY(l);
    if (Math.hypot(p.x - px, p.y - py) < 20) return l;
  }
  return null;
}

function drawMap() {
  if (!mapCv || !mapCtx) return;
  const g = S.g, ctx = mapCtx;
  ctx.save();
  ctx.setTransform(mapCv._dpr, 0, 0, mapCv._dpr, 0, 0);
  ctx.clearRect(0, 0, mapCv._w, mapCv._h);

  // 底紋
  ctx.fillStyle = '#e5dcc7';
  ctx.fillRect(0, 0, mapCv._w, mapCv._h);
  ctx.strokeStyle = 'rgba(90,78,60,.10)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 7; i++) {
    ctx.beginPath();
    const y = mapCv._h * (i + 1) / 8;
    ctx.moveTo(0, y);
    for (let x = 0; x <= mapCv._w; x += 22) ctx.lineTo(x, y + Math.sin((x + i * 40) / 55) * 5);
    ctx.stroke();
  }

  const here = LOC_BY_ID[g.at];
  const done = new Set();
  // 路線
  for (const l of LOCATIONS) for (const nId of l.links) {
    const key = [l.id, nId].sort().join('|');
    if (done.has(key)) continue;
    done.add(key);
    const n = LOC_BY_ID[nId];
    const gated = n.requireBooks && g.books.length < n.requireBooks
      || l.requireBooks && g.books.length < l.requireBooks;
    const a = locXY(l), b = locXY(n);
    const active = l.id === g.at || nId === g.at;
    ctx.strokeStyle = gated ? 'rgba(120,105,80,.22)' : active ? 'rgba(156,43,35,.55)' : 'rgba(90,78,60,.3)';
    ctx.lineWidth = active ? 2 : 1.2;
    ctx.setLineDash(gated ? [4, 5] : []);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.setLineDash([]);
  }

  // 地點
  for (const l of LOCATIONS) {
    const p = locXY(l);
    const isHere = l.id === g.at;
    const near = here.links.includes(l.id);
    const gated = l.requireBooks && g.books.length < l.requireBooks;
    const cleared = G.isCleared(g, l.id);
    const r = isHere ? 12 : l.type === 'final' ? 11 : 9;

    ctx.beginPath(); ctx.arc(p.x, p.y, r + 3, 0, 7);
    ctx.fillStyle = mapHover === l && near ? 'rgba(156,43,35,.22)' : 'rgba(0,0,0,0)';
    ctx.fill();

    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7);
    ctx.fillStyle = gated ? '#b3a68d'
      : isHere ? '#9c2b23'
      : cleared ? '#3d6b57'
      : near ? '#8a6d3b' : '#a3937a';
    ctx.fill();
    ctx.lineWidth = isHere ? 2.5 : 1;
    ctx.strokeStyle = isHere ? '#5d1a15' : 'rgba(255,255,255,.55)';
    ctx.stroke();

    if (l.book && !g.books.includes(l.book) && !gated) {
      ctx.fillStyle = '#f6efe2';
      ctx.font = '600 11px serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('笈', p.x, p.y + 1);
    }

    ctx.font = `${isHere ? '600 ' : ''}13px "Noto Serif TC","Songti TC",serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(233,225,208,.9)';
    ctx.strokeText(l.name, p.x, p.y + r + 3);
    ctx.fillStyle = gated ? '#8a7c68' : '#241f19';
    ctx.fillText(l.name, p.x, p.y + r + 3);
  }
  ctx.restore();
}

// ═══ 行走 ═══
function travelDialog() {
  const g = S.g;
  const rows = G.here(g).links.map(id => {
    const l = LOC_BY_ID[id];
    const c = travelCost(g.at, id);
    const gated = l.requireBooks && g.books.length < l.requireBooks;
    const no = gated || g.stamina < c.stamina;
    return `<button class="item" data-go="${id}" ${no ? 'disabled' : ''}>
      <div class="t"><b>${l.name}</b><div class="d">${gated ? `須集齊 ${l.requireBooks} 部秘笈` : l.desc.slice(0, 26) + '…'}</div></div>
      <div class="d">${c.days} 天 · 體力 ${c.stamina}</div></button>`;
  }).join('');
  const body = modal('前往何處', `<div class="list">${rows}</div>`);
  body.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { closeModal(); doTravel(b.dataset.go); });
}

function doTravel(id) {
  const r = G.travel(S.g, id);
  if (!r.ok) return toast(r.why);
  paintWorld();
  if (r.encounter) {
    say('路上忽然閃出幾條人影，攔住了去路。', () => startBattle(G.startEncounter(S.g, r.encounter), false));
  } else autosave();
}

function roam() {
  const g = S.g, loc = G.here(g);
  const rng = { pick: a => a[Math.floor(Math.random() * a.length)], n: 1 + Math.floor(Math.random() * 3) };
  const mobs = Array.from({ length: rng.n }, () => rng.pick(loc.mobs));
  startBattle(G.startEncounter(g, mobs), false);
}

function challenge() {
  const g = S.g, loc = G.here(g);
  const b = G.startBoss(g);
  if (!b) return;
  const cleared = G.isCleared(g, loc.id);
  const intro = cleared ? '你又回到了這裡。' : (loc.intro || '').replace(/\n/g, '<br>');
  say(intro + `<br><br><b>${loc.boss.title}</b>`, () => startBattle(b, true));
}

// ═══ 戰鬥銜接 ═══
function startBattle(battle, isBoss) {
  S.battle = battle; S.isBoss = isBoss;
  if (S.bui) S.bui.destroy();
  R = shell();
  S.bui = new BattleUI(R, battle, {
    speed: S.speed,
    onEnd: res => endBattle(res),
    onPickSkill: pickSkill,
    onPickItem: pickItem,
    onInspect: u => inspectUnit(u),
  });
}

function pickSkill(unit, cb) {
  const rows = skillRows(unit, S.battle);
  const html = rows.map(r => `<button class="item ${r.ok ? '' : 'no'}" data-s="${r.id}" ${r.ok ? '' : 'disabled'}>
    <div class="t"><b>${r.sk.name}</b> <span class="tiny muted">${KIND_NAME[r.sk.kind] || '基本'}${r.lvl > 1 ? ` ${r.lvl}層` : ''}</span>
      <div class="d">${r.sk.desc || ''}</div></div>
    <div class="d">${r.sk.mp ? `內力 ${r.sk.mp}` : '不耗內力'}<br>射程 ${r.sk.rmin ?? 1}–${r.sk.rmax ?? 1}</div></button>`).join('');
  const body = modal('施展武功', `<div class="list">${html}</div>`);
  body.querySelectorAll('[data-s]').forEach(b => b.onclick = () => { closeModal(); cb(b.dataset.s); });
}

function pickItem(unit, cb) {
  const g = S.g;
  const usable = G.bagList(g).filter(x => x.item.use);
  if (!usable.length) return modal('行囊', '<div class="narr">身上沒有能用的藥物。</div>');
  const html = usable.map(x => `<button class="item" data-i="${x.id}">
    <div class="t"><b>${x.item.name}</b> ×${x.n}<div class="d">${x.item.desc}</div></div></button>`).join('');
  const body = modal('使用物品', `<div class="list">${html}</div>`);
  body.querySelectorAll('[data-i]').forEach(b => b.onclick = () => {
    const id = b.dataset.i;
    closeModal();
    // 選對象：我方存活單位
    const allies = S.battle.units.filter(u => u.side === 'ally' && !u.down);
    const rows = allies.map((u, i) => `<button class="item" data-t="${i}">
      <div class="t"><b>${u.char.name}</b><div class="d">氣血 ${u.hp}/${u.maxHp}　內力 ${u.mp}/${u.maxMp}</div></div></button>`).join('');
    const body2 = modal('用在誰身上', `<div class="list">${rows}</div>`);
    body2.querySelectorAll('[data-t]').forEach(t => t.onclick = () => {
      closeModal();
      G.removeItem(g, id, 1);
      cb(id, allies[+t.dataset.t]);
    });
  });
}

function inspectUnit(u) {
  const D = derived(u.char);
  modal(u.char.name, `<div class="small muted">${u.char.title || ''}　Lv.${u.char.lvl}</div>
    <div class="narr">${u.char.desc || '江湖中人。'}</div>
    <div class="statgrid">
      <div><span>氣血</span> ${u.hp}/${u.maxHp}</div><div><span>內力</span> ${u.mp}/${u.maxMp}</div>
      <div><span>攻擊</span> ${D.atk}</div><div><span>防禦</span> ${D.def}</div>
      <div><span>輕功</span> ${D.qinggong}</div><div><span>移動</span> ${moveRange(u.char)}</div>
      <div><span>抗毒</span> ${D.poisonRes}</div><div><span>資質</span> ${u.char.apt}</div>
    </div><hr>
    <div class="small">${u.char.skills.map(s => `${SKILL_BY_ID[s.id]?.name ?? s.id} ${s.lvl}層`).join('、') || '未習武功'}</div>`);
}

function endBattle(res) {
  const g = S.g;
  const loc = G.here(g);
  const out = G.resolveBattle(g, S.battle, S.isBoss);
  const parts = [];
  if (res === 'win') {
    parts.push(`得經驗 <b>${out.exp}</b>，銀兩 <b>${out.gold}</b>。`);
    if (out.levelUps.length) parts.push(out.levelUps.map(l => `${l.name} 升至 <b>${l.lvl}</b> 級。`).join('<br>'));
    if (out.loot.length) {
      const names = out.loot.map(i => ITEM_BY_ID[i].name);
      parts.push('拾得：' + names.join('、'));
    }
  } else if (res === 'lose') parts.push('你們敗了。醒來時已在城中，養傷三日，銀兩也少了三成。');
  else if (res === 'flee') parts.push('你們奪路而逃。');

  const finish = () => {
    if (res === 'win' && S.isBoss && loc.type === 'final') return ending();
    renderWorld();
    if (out.book) {
      const bk = ITEM_BY_ID[out.book];
      say(`${loc.reward || '你找到了想找的東西。'}<br><br>——得到<b style="color:var(--red)">《${bk.name}》</b><br>
        <span class="small muted">${bk.desc}</span><br><br>已集齊 <b>${g.books.length}/14</b> 部秘笈。
        <br><span class="small muted">在「隊伍」中翻閱秘笈，資質足夠者便能習得。</span>`);
    }
  };
  say((res === 'win' ? '<b>勝</b><br><br>' : res === 'lose' ? '<b>敗</b><br><br>' : '') + parts.join('<br>'), finish);
}

function ending() {
  const g = S.g;
  const top = g.party[0];
  const best = top.skills.slice().sort((a, b) => b.lvl - a.lvl)[0];
  modal('終', `<div class="narr">
繡花針落地。<br><br>
東方不敗看了你很久，忽然笑了：「原來如此。」<br>
紅衣一閃，人已墜入雲海。<br><br>
華山之巔風很大。你回頭，同伴們都還站在那裡。<br><br>
十四部秘笈都在你身上，可你忽然想不起來，當初為什麼要找它們。<br>
也許只是因為——在這個世界醒來之後，總得走一趟江湖。<br><br>
<b>${esc(top.name)}</b>　Lv.${top.lvl}　${best ? `${SKILL_BY_ID[best.id]?.name} ${best.lvl}層` : ''}<br>
歷時 ${g.day} 天，聲望 ${g.fame}，道德 ${g.morality}。<br>
同行者：${g.party.slice(1).map(c => esc(c.name)).join('、') || '孤身一人'}。
</div>`, [{ t: '回到標題', primary: true, fn: renderTitle }]);
}

// ═══ 人物 ═══
function charSheet(idx, tab = 'stat') {
  const g = S.g, c = g.party[idx];
  const D = derived(c);
  const mh = maxHp(c), mm = maxMp(c);
  const tabs = [['stat', '屬性'], ['skill', '武功'], ['equip', '裝備'], ['book', '秘笈']];
  let body = '';

  if (tab === 'stat') {
    body = `<div class="statgrid">
      <div><span>等級</span> ${c.lvl}</div><div><span>經驗</span> ${c.exp}/${expToNext(c.lvl)}</div>
      <div><span>氣血</span> ${c.curHp ?? mh}/${mh}</div><div><span>內力</span> ${c.curMp ?? mm}/${mm}</div>
      <div><span>攻擊</span> ${D.atk}</div><div><span>防禦</span> ${D.def}</div>
      <div><span>輕功</span> ${D.qinggong}</div><div><span>移動</span> ${moveRange(c)}</div>
      <div><span>拳掌</span> ${D.fist}</div><div><span>御劍</span> ${D.sword}</div>
      <div><span>耍刀</span> ${D.blade}</div><div><span>特殊</span> ${D.special}</div>
      <div><span>暗器</span> ${D.hidden}</div><div><span>醫療</span> ${D.medicine}</div>
      <div><span>用毒</span> ${D.poison}</div><div><span>抗毒</span> ${D.poisonRes}</div>
      <div><span>資質</span> ${c.apt}</div><div><span>武功</span> ${c.skills.length}/10 門</div>
    </div>
    <div class="narr">${c.desc || ''}</div>
    ${idx > 0 ? '<button class="btn sm" data-dismiss>請他離隊</button>' : ''}`;
  } else if (tab === 'skill') {
    body = `<div class="list">${c.skills.map(s => {
      const sk = SKILL_BY_ID[s.id];
      const need = s.lvl < 10 ? skillExpToNext(s.lvl) : 0;
      return `<div class="item"><div class="t"><b>${sk.name}</b>
        <span class="tiny muted">${KIND_NAME[sk.kind]}　第 ${s.lvl} 層</span>
        <div class="d">${sk.desc}</div>
        ${need ? `<div class="bar sta" style="margin-top:4px"><i style="width:${(s.exp || 0) / need * 100}%"></i></div>` : '<div class="tiny" style="color:var(--red)">已臻大成</div>'}
        </div>
        <button class="btn sm" data-forget="${s.id}">遺忘</button></div>`;
    }).join('') || '<div class="muted small">尚未習得任何武功。</div>'}</div>`;
  } else if (tab === 'equip') {
    const slots = [['weapon', '兵器'], ['armor', '護甲'], ['accessory', '飾物']];
    body = slots.map(([k, nm]) => {
      const cur = ITEM_BY_ID[c.equip[k]];
      const opts = G.bagList(g).filter(x => x.item.type === k);
      return `<div style="margin-bottom:10px">
        <div class="kv"><span class="muted">${nm}</span><b>${cur ? cur.name : '（無）'}</b></div>
        ${cur ? `<div class="tiny muted">${Object.entries(cur.mods || {}).map(([a, v]) => `${STAT_NAME[a] || a} ${v > 0 ? '+' : ''}${v}`).join('　')}</div>` : ''}
        <div class="list" style="margin-top:4px">${opts.map(x => `<button class="item" data-eq="${x.id}">
          <div class="t"><b>${x.item.name}</b> ×${x.n}<div class="d">${Object.entries(x.item.mods || {}).map(([a, v]) => `${STAT_NAME[a] || a} ${v > 0 ? '+' : ''}${v}`).join('　')}</div></div></button>`).join('') || '<div class="tiny muted">行囊中沒有此類物品。</div>'}</div>
      </div>`;
    }).join('');
  } else {
    const books = G.bagList(g).filter(x => x.item.teaches);
    body = `<div class="list">${books.map(x => {
      const sk = SKILL_BY_ID[x.item.teaches];
      const chk = canLearn(c, x.item.teaches);
      return `<button class="item" data-learn="${x.id}" ${chk.ok ? '' : 'disabled'}>
        <div class="t"><b>${x.item.name}</b> <span class="tiny muted">授【${sk.name}】需資質 ${sk.apt}</span>
        <div class="d">${chk.ok ? sk.desc : chk.why}</div></div></button>`;
    }).join('') || '<div class="muted small">行囊中沒有秘笈。</div>'}</div>`;
  }

  modalEl.className = 'on';
  modalEl.innerHTML = `<div class="dlg">
    <h3>${esc(c.name)}　<span class="tiny muted">${c.title || ''}</span></h3>
    <div class="tabs">${tabs.map(([k, t]) => `<button class="tab ${k === tab ? 'on' : ''}" data-tab="${k}">${t}</button>`).join('')}</div>
    <div class="body">${body}</div>
    <div class="foot"><button class="btn" data-close>關閉</button></div></div>`;
  modalEl.querySelector('[data-close]').onclick = closeModal;
  modalEl.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => charSheet(idx, b.dataset.tab));
  modalEl.querySelectorAll('[data-eq]').forEach(b => b.onclick = () => { G.equip(g, idx, b.dataset.eq); paintSide(); charSheet(idx, 'equip'); });
  modalEl.querySelectorAll('[data-learn]').forEach(b => b.onclick = () => {
    const r = G.studyBook(g, idx, b.dataset.learn);
    if (!r.ok) return toast(r.why);
    paintSide(); paintLog(); autosave();
    charSheet(idx, 'book');
  });
  modalEl.querySelectorAll('[data-forget]').forEach(b => b.onclick = () =>
    modal('遺忘武功', `<div class="narr">確定要忘記【${SKILL_BY_ID[b.dataset.forget].name}】？已練的層數不會回來。</div>`,
      [{ t: '算了' }, { t: '忘掉', primary: true, fn: () => { G.forgetSkill(g, idx, b.dataset.forget); paintSide(); charSheet(idx, 'skill'); } }]));
  const dis = modalEl.querySelector('[data-dismiss]');
  if (dis) dis.onclick = () => { G.dismiss(g, idx); closeModal(); paintWorld(); };
}

const STAT_NAME = {
  atk: '攻擊', def: '防禦', hp: '氣血', mp: '內力', qinggong: '輕功',
  fist: '拳掌', sword: '御劍', blade: '耍刀', special: '特殊', hidden: '暗器',
  medicine: '醫療', poison: '用毒', poisonRes: '抗毒',
};

// ═══ 商店・尋訪・練功・行囊 ═══
function shopDialog() {
  const g = S.g, loc = G.here(g);
  const buyRows = loc.shop.map(id => {
    const it = ITEM_BY_ID[id];
    return `<button class="item" data-buy="${id}" ${g.gold < it.price ? 'disabled' : ''}>
      <div class="t"><b>${it.name}</b><div class="d">${it.desc}</div></div>
      <div class="d">${it.price} 兩</div></button>`;
  }).join('');
  const sellRows = G.bagList(g).filter(x => !(x.item.type === 'book' && QUEST_BOOKS.includes(x.id)))
    .map(x => `<button class="item" data-sell="${x.id}">
      <div class="t"><b>${x.item.name}</b> ×${x.n}</div>
      <div class="d">售 ${Math.round(x.item.price * 0.4)} 兩</div></button>`).join('');
  const body = modal(`商鋪　<span class="tiny muted">身上 ${g.gold} 兩</span>`,
    `<div class="small muted">買</div><div class="list">${buyRows}</div>
     <hr><div class="small muted">賣</div><div class="list">${sellRows || '<div class="tiny muted">沒有可賣之物。</div>'}</div>`);
  body.querySelectorAll('[data-buy]').forEach(b => b.onclick = () => {
    const r = G.buy(g, b.dataset.buy);
    if (!r.ok) return toast(r.why);
    paintHud(); closeModal(); shopDialog();
  });
  body.querySelectorAll('[data-sell]').forEach(b => b.onclick = () => {
    const r = G.sell(g, b.dataset.sell);
    if (!r.ok) return toast(r.why || '賣不得。');
    paintHud(); closeModal(); shopDialog();
  });
}

function recruitDialog() {
  const g = S.g;
  const cands = G.recruitCandidates(g);
  const rows = cands.map(c => `<button class="item" data-r="${c.ally.id}" ${c.ok ? '' : 'disabled'}>
    <div class="t"><b>${c.ally.name}</b> <span class="tiny muted">${c.ally.title}　Lv.${c.ally.lvl}</span>
      <div class="d">${c.ok ? c.ally.desc : c.reasons.join('；')}</div></div></button>`).join('');
  const body = modal('尋訪', `<div class="list">${rows}</div>`);
  body.querySelectorAll('[data-r]').forEach(b => b.onclick = () => {
    const r = G.recruit(g, b.dataset.r);
    closeModal();
    if (!r.ok) return toast(r.why);
    paintWorld(); autosave();
    say(`${r.char.name} 上下打量你一番。<br><br>「好，我便隨你走一遭。」`);
  });
}

function trainDialog() {
  const r = G.train(S.g);
  if (!r.ok) return toast(r.why);
  const lines = r.results.map(x =>
    `${x.name}　【${SKILL_BY_ID[x.skill].name}】內力增益 ${x.gain}${x.up ? `　<b style="color:var(--red)">精進至 ${x.up.lvl} 層</b>` : ''}`).join('<br>');
  paintWorld(); autosave();
  say('眾人尋了處僻靜地方，盤膝而坐，一日不動。<br><br>' + lines);
}

function bagDialog() {
  const g = S.g;
  const rows = G.bagList(g).map(x => `<div class="item">
    <div class="t"><b>${x.item.name}</b> ×${x.n}<div class="d">${x.item.desc}</div></div>
    ${x.item.use ? `<button class="btn sm" data-use="${x.id}">使用</button>` : ''}</div>`).join('');
  const body = modal('行囊', `<div class="list">${rows || '<div class="muted small">空空如也。</div>'}</div>`);
  body.querySelectorAll('[data-use]').forEach(b => b.onclick = () => {
    const id = b.dataset.use;
    const rows2 = g.party.map((c, i) => `<button class="item" data-t="${i}">
      <div class="t"><b>${c.name}</b><div class="d">氣血 ${c.curHp}/${maxHp(c)}　內力 ${c.curMp}/${maxMp(c)}</div></div></button>`).join('');
    const b2 = modal('給誰用', `<div class="list">${rows2}</div>`);
    b2.querySelectorAll('[data-t]').forEach(t => t.onclick = () => {
      G.useItemWorld(g, +t.dataset.t, id);
      closeModal(); paintWorld(); autosave(); bagDialog();
    });
  });
}

function almsDialog() {
  const g = S.g;
  const opts = [50, 200, 600, 1500].filter(v => v <= g.gold);
  const body = modal('施捨', `<div class="narr">城門口聚著不少逃難來的災民。</div>
    <div class="list">${opts.map(v => `<button class="item" data-v="${v}"><div class="t"><b>${v} 兩</b></div></button>`).join('')}</div>`);
  body.querySelectorAll('[data-v]').forEach(b => b.onclick = () => {
    const r = G.donate(g, +b.dataset.v);
    closeModal();
    if (r.ok) { paintWorld(); autosave(); toast(`道德 +${r.up}。`); }
  });
}

// ═══ 存檔 ═══
function autosave() { if (S.g) G.saveTo(S.slot || 1, S.g); }
function saveDialog() {
  const rows = [1, 2, 3].map(i => {
    const s = G.saveInfo(i);
    return `<button class="item" data-s="${i}"><div class="t"><b>存檔 ${i}</b>
      <div class="d">${s ? `${s.name} Lv.${s.lvl}　${s.at}　秘笈 ${s.books}/14　第 ${s.day} 天` : '空'}</div></div></button>`;
  }).join('');
  const body = modal('存檔', `<div class="list">${rows}</div>`);
  body.querySelectorAll('[data-s]').forEach(b => b.onclick = () => {
    S.slot = +b.dataset.s; G.saveTo(S.slot, S.g); closeModal(); toast(`已存入存檔 ${S.slot}。`);
  });
}

// 除錯／自動測試用的把手（正常遊玩不會用到）
const api = {
  S, G, modalEl,
  renderTitle, renderWorld, worldAction, startBattle, charSheet,
  get R() { return R; },
};
window.__jy = api;

renderTitle();

if (location.search.includes('autotest')) {
  import('../../tools/uitest.js').then(m => m.run(api));
}
