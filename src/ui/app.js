// 主控：標題、場景行走、與 NPC 互動、各式面板，以及戰鬥銜接。

import * as G from '../core/game.js';
import { LOC_BY_ID } from '../data/world/locations.js';
import { ITEM_BY_ID, QUEST_BOOKS } from '../data/items.js';
import { SKILL_BY_ID, KIND_NAME } from '../data/skills.js';
import { ALLY_BY_ID } from '../data/chars.js';
import { derived, maxHp, maxMp, moveRange, canLearn, skillExpToNext, expToNext } from '../core/rules.js';
import { BattleUI, skillRows } from './battleui.js';
import { SceneUI } from './sceneui.js';

const app = document.getElementById('app');
const modalEl = document.getElementById('modal');
const S = { g: null, slot: 1, sui: null, battle: null, bui: null, isBoss: false, speed: 340 };
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// ═══ 對話框 ═══
function modal(title, body, foot = [{ t: '關閉' }]) {
  modalEl.className = 'on';
  S.sui && (S.sui.paused = true);
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
function closeModal() {
  modalEl.className = '';
  modalEl.innerHTML = '';
  if (S.sui) { S.sui.paused = false; S.sui.held.clear(); }
}
modalEl.onclick = e => { if (e.target === modalEl) closeModal(); };
function say(html, then) { modal('　', `<div class="narr">${html}</div>`, [{ t: '繼續', primary: true, fn: then }]); }
function toast(msg) { G.say(S.g, msg); paintLog(); paintHud(); }

// ═══ 標題 ═══
function renderTitle() {
  if (S.sui) { S.sui.destroy(); S.sui = null; }
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
    <div class="credit">方向鍵／WASD 行走 · 點地圖自動尋路 · 走上去撞人便是交談</div>
  </div>`;
  app.querySelector('[data-new]').onclick = askName;
  app.querySelectorAll('[data-load]').forEach(b => b.onclick = () => {
    const g = G.loadFrom(+b.dataset.load);
    if (g) { S.g = g; S.slot = +b.dataset.load; renderField(); }
  });
}

function askName() {
  modal('請問尊姓大名', `<div class="small muted">你自異世醒來，身無長物，只記得自己的名字。</div>
    <input id="nm" maxlength="6" value="無名" style="width:100%;margin-top:10px;padding:.5em;
      font-family:inherit;font-size:17px;border:1px solid var(--line);background:var(--paper2)">`,
    [{ t: '取消' }, {
      t: '入江湖', primary: true, fn: vals => {
        S.g = applyDebugParams(G.newGame((vals.nm || '無名').trim().slice(0, 6) || '無名'));
        S.slot = 1;
        renderField();
        say('你在揚州城外的官道上醒來。<br><br>頭很痛，記不清自己是怎麼到這裡的。<br>身上只有幾十文錢，和一把不知哪來的木刀。<br><br>順著官道往北走十幾步，就是揚州城門。<br><br><span class="small muted">方向鍵或 WASD 走動，也可以直接點地圖上想去的地方。<br>走上去撞到人就是跟他說話；推開有「門」字的門扉可以進屋。<br>沿官道走省力又快，跨野而行既慢又累；天黑之後路上不太平。</span>');
      }
    }]);
  setTimeout(() => document.getElementById('nm')?.select(), 30);
}

// ═══ 主畫面 ═══
function shell() {
  app.innerHTML = `
    <div id="hud"></div>
    <div id="main">
      <div id="left"><div id="stage"></div><div id="logbox"></div></div>
      <div id="right"><div id="side"></div><div id="actions"></div></div>
    </div>`;
  return {
    hud: document.getElementById('hud'), stage: document.getElementById('stage'),
    log: document.getElementById('logbox'), side: document.getElementById('side'),
    actions: document.getElementById('actions'),
  };
}
let R = null;

function renderField() {
  if (S.bui) { S.bui.destroy(); S.bui = null; }
  if (S.sui) { S.sui.destroy(); S.sui = null; }
  S.battle = null;
  R = shell();
  S.sui = new SceneUI(R.stage, S.g, {
    lockView: camParam ? +camParam : null,
    onInteract: e => handleInteract(e),
    onEncounter: mobs => say('前方閃出人影，攔住去路！', () => startBattle(G.startEncounter(S.g, mobs), false)),
    onSceneChange: () => { paintAll(); autosave(); },
    onChanged: () => paintHud(),
    onMessage: m => toast(m),
    onArrive: id => { paintAll(); autosave(); },
    onActor: e => {
      const act = G.interact(S.g, e);
      if (act?.kind === 'shop') { S.sui.queue.length = 0; shopDialog(act.stock, act.title, act.greet); }
      else if (act) toast(`${act.title}　${act.text}`);
    },
    onFerry: f => ferryDialog(f),
    onBook: id => {
      paintAll(); autosave();
      const bk = ITEM_BY_ID[id];
      say(`——得到<b style="color:var(--red)">《${bk.name}》</b><br><span class="small muted">${bk.desc}</span>
        <br><br>已集齊 <b>${S.g.books.length}/14</b> 部秘笈。
        <br><span class="small muted">在「隊伍」裡翻閱秘笈，資質足夠者便能習得。</span>`);
    },
  });
  paintAll();
  autosave();
}

function paintAll() { paintHud(); paintSide(); paintActions(); paintLog(); S.sui?.draw(); }

function paintHud() {
  const g = S.g;
  const sc = G.curScene(g);
  const loc = G.here(g);
  const where = sc.kind === 'interior' ? sc.name : (loc ? loc.name : '江湖道上');
  R.hud.innerHTML = `
    <b>${esc(g.party[0].name)}</b>
    <span>${where}</span>
    <span>第 <b>${g.day}</b> 天</span>
    <span${G.isNight(g) ? ' style="color:var(--mp)"' : ''}>${G.timeLabel(g)}</span>
    <span>銀兩 <b>${g.gold}</b></span>
    <span>聲望 <b>${g.fame}</b></span>
    <span>道德 <b>${g.morality}</b></span>
    <span>體力 <b>${g.stamina}</b></span>
    <span>秘笈 <b style="color:var(--red)">${g.books.length}</b>/14</span>
    <span class="sp"></span>
    <button class="btn sm" data-h="save">存檔</button>
    <button class="btn sm" data-h="title">回標題</button>`;
  R.hud.querySelector('[data-h="save"]').onclick = saveDialog;
  R.hud.querySelector('[data-h="title"]').onclick = () =>
    modal('離開', '<div class="narr">回到標題畫面？進度已自動存檔。</div>',
      [{ t: '留下' }, { t: '離開', primary: true, fn: () => { autosave(); renderTitle(); } }]);
}

function paintLog() {
  R.log.innerHTML = S.g.log.slice(-30).map(l => `<div>${l}</div>`).join('');
  R.log.scrollTop = R.log.scrollHeight;
}

function paintSide() {
  const g = S.g;
  const loc = G.here(g);
  const sc = G.curScene(g);
  const h = sc.kind === 'interior' ? 0 : G.heightAt(sc, g.pos.x, g.pos.y);
  R.side.innerHTML = `
    <div class="loc-name">${loc ? loc.name : '江湖'}</div>
    <div class="loc-desc">${loc ? loc.desc : '官道縱橫，四方皆可去得。沿著官道走省力，跨野而行既慢又累。'}</div>
    ${sc.kind === 'interior' ? '' : `<div class="tiny muted">海拔 ${h}　${h > 150 ? '山高風急，望得極遠' : h > 80 ? '地勢略高' : '平地'}</div>`}
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
  R.actions.innerHTML = `<div class="row" style="gap:6px">
    <div class="dpad">
      <button class="btn dp" data-d="up">↑</button>
      <button class="btn dp" data-d="left">←</button>
      <button class="btn dp" data-d="down">↓</button>
      <button class="btn dp" data-d="right">→</button>
    </div>
    <span class="sp"></span>
    <button class="btn" data-w="camp">露宿</button>
    <button class="btn" data-w="bag">行囊</button>
    <button class="btn" data-w="party">隊伍</button>
  </div>`;
  R.actions.querySelectorAll('[data-d]').forEach(b => {
    let last = 0;
    const go = () => S.sui?.press(b.dataset.d);
    b.onpointerdown = ev => { ev.preventDefault(); last = Date.now(); go(); };
    b.onclick = () => { if (Date.now() - last > 400) go(); };   // 合成 click 也要能走
  });
  R.actions.querySelector('[data-w="camp"]').onclick = campDialog;
  R.actions.querySelector('[data-w="bag"]').onclick = bagDialog;
  R.actions.querySelector('[data-w="party"]').onclick = () => charSheet(0);
}

// ═══ 撞到人／物 ═══
function handleInteract(e) {
  const act = G.interact(S.g, e);
  if (!act) return;
  switch (act.kind) {
    case 'text': modal(act.title, `<div class="narr">${act.text}</div>`); break;
    case 'shop': shopDialog(act.stock, act.title, act.greet); break;
    case 'inn': innDialog(); break;
    case 'train': trainDialog(); break;
    case 'recruit': recruitDialog(act.who); break;
    case 'boss': bossDialog(); break;
  }
}

function ferryDialog(f) {
  modal(f.name, `<div class="narr">渡口泊著一條船。「往${esc(f.toName)}麼？船資 ${f.fare} 兩，半日腳程。」</div>`,
    [{ t: '不渡了' }, {
      t: `上船（${f.fare} 兩）`, primary: true, fn: () => {
        const r = G.ride(S.g, f);
        if (!r.ok) return toast(r.why);
        paintAll(); autosave();
        say(`船在浪裡搖了半日。<br><br>靠岸時已是${G.timeLabel(S.g)}。`);
      }
    }]);
}

function campDialog() {
  const g = S.g;
  if (G.curScene(g).kind === 'interior') return toast('屋裡不必露宿。');
  modal('露宿', `<div class="narr">尋個背風處生堆火，捱到天亮。</div>
    <div class="small muted">現在是${G.timeLabel(g)}。露宿回復體力，但荒郊野外並不安穩。</div>`,
    [{ t: '再走走' }, {
      t: '就地生火', primary: true, fn: () => {
        G.camp(g); paintAll(); autosave();
        say(`火堆燒了一夜。<br><br>天亮了，${G.timeLabel(g)}，體力回到 ${g.stamina}。`);
      }
    }]);
}

function innDialog() {
  const loc = G.here(S.g);
  if (!G.innOpen(S.g)) return modal('客棧', '<div class="narr">「打烊了，客官明日請早。」<br><br>門板上了一半，店小二頭也不抬。</div>');
  modal('客棧', `<div class="narr">「客官，住店還是打尖？一晚 ${loc.inn} 兩。」</div>
    <div class="small muted">住一晚可回復全隊氣血、內力與體力。</div>`,
    [{ t: '不了' }, {
      t: `住下（${loc.inn} 兩）`, primary: true, fn: () => {
        const r = G.inn(S.g);
        if (!r.ok) return toast(r.why);
        paintAll(); autosave();
        say('一夜好眠，精神大振。');
      }
    }]);
}

function trainDialog() {
  modal('靜室', '<div class="narr">「此處清靜，正好打坐運氣。」</div><div class="small muted">耗一日與 15 點體力，全隊內功精進。</div>',
    [{ t: '改天' }, {
      t: '打坐一日', primary: true, fn: () => {
        const r = G.train(S.g);
        if (!r.ok) return toast(r.why);
        paintAll(); autosave();
        say('眾人尋了處僻靜地方，盤膝而坐，一日不動。<br><br>' + r.results.map(x =>
          `${x.name}　【${SKILL_BY_ID[x.skill].name}】內力增益 ${x.gain}${x.up ? `　<b style="color:var(--red)">精進至 ${x.up.lvl} 層</b>` : ''}`).join('<br>'));
      }
    }]);
}

function recruitDialog(who) {
  const chk = G.recruitCheck(S.g, who);
  const a = chk.ally;
  if (chk.has) return modal(a.name, `<div class="narr">「走罷，還等什麼？」</div>`);
  modal(a.name, `<div class="small muted">${a.title}　Lv.${a.lvl}　資質 ${a.apt}</div>
    <div class="narr">${a.desc}</div>
    ${chk.ok ? '<div class="small">他打量了你一番，似乎有意同行。</div>'
      : `<div class="small" style="color:var(--red)">${chk.reasons.join('；')}</div>`}`,
    chk.ok
      ? [{ t: '再說' }, {
        t: '邀他同行', primary: true, fn: () => {
          const r = G.recruit(S.g, who);
          if (!r.ok) return toast(r.why);
          paintAll(); autosave();
          say(`${r.char.name} 上下打量你一番。<br><br>「好，我便隨你走一遭。」`);
        }
      }]
      : [{ t: '告辭' }]);
}

function bossDialog() {
  const loc = G.here(S.g);
  const intro = (loc.intro || '').replace(/\n/g, '<br>');
  modal(loc.boss.title, `<div class="narr">${intro}</div>`,
    [{ t: '再等等' }, { t: '動手', primary: true, fn: () => startBattle(G.startBoss(S.g), true) }]);
}

// ═══ 戰鬥銜接 ═══
function startBattle(battle, isBoss) {
  if (!battle) return;
  S.battle = battle; S.isBoss = isBoss;
  if (S.sui) { S.sui.destroy(); S.sui = null; }
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
  const wasFinal = g.scene === 'final';
  const out = G.resolveBattle(g, S.battle, S.isBoss);
  const parts = [];
  if (res === 'win') {
    parts.push(`得經驗 <b>${out.exp}</b>，銀兩 <b>${out.gold}</b>。`);
    if (out.levelUps.length) parts.push(out.levelUps.map(l => `${l.name} 升至 <b>${l.lvl}</b> 級。`).join('<br>'));
    if (out.loot.length) parts.push('拾得：' + out.loot.map(i => ITEM_BY_ID[i].name).join('、'));
    if (out.cleared) parts.push('<span class="small muted">強敵已倒，它守著的東西，現在拿得到了。</span>');
  } else if (res === 'lose') parts.push('你們敗了。醒來時已在城裡，養傷三日，銀兩也少了三成。');
  else if (res === 'flee') parts.push('你們奪路而逃。');

  say((res === 'win' ? '<b>勝</b><br><br>' : res === 'lose' ? '<b>敗</b><br><br>' : '') + parts.join('<br>'),
    () => {
      if (res === 'win' && S.isBoss && wasFinal) return ending();
      renderField();
    });
}

function ending() {
  const g = S.g, top = g.party[0];
  const best = top.skills.slice().sort((a, b) => b.lvl - a.lvl)[0];
  modal('終', `<div class="narr">
繡花針落地。<br><br>
東方不敗看了你很久，忽然笑了：「原來如此。」<br>
紅衣一閃，人已墜入雲海。<br><br>
華山之巔風很大。你回頭，同伴們都還站在那裡。<br><br>
十四部秘笈都在你身上，可你忽然想不起來，當初為什麼要找它們。<br>
也許只是因為——在這個世界醒來之後，總得走一趟江湖。<br><br>
<b>${esc(top.name)}</b>　Lv.${top.lvl}　${best ? `${SKILL_BY_ID[best.id]?.name} ${best.lvl}層` : ''}<br>
歷時 ${g.day} 天，走了 ${g.steps} 步，聲望 ${g.fame}，道德 ${g.morality}。<br>
同行者：${g.party.slice(1).map(c => esc(c.name)).join('、') || '孤身一人'}。
</div>`, [{ t: '回到標題', primary: true, fn: renderTitle }]);
}

// ═══ 人物 ═══
const STAT_NAME = {
  atk: '攻擊', def: '防禦', hp: '氣血', mp: '內力', qinggong: '輕功',
  fist: '拳掌', sword: '御劍', blade: '耍刀', special: '特殊', hidden: '暗器',
  medicine: '醫療', poison: '用毒', poisonRes: '抗毒',
};

function charSheet(idx, tab = 'stat') {
  const g = S.g, c = g.party[idx];
  const D = derived(c);
  const mh = maxHp(c), mm = maxMp(c);
  const tabs = [['stat', '屬性'], ['skill', '武功'], ['equip', '裝備'], ['book', '秘笈'], ['party', '換人']];
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
    </div><div class="narr">${c.desc || ''}</div>`;
  } else if (tab === 'skill') {
    body = `<div class="list">${c.skills.map(s => {
      const sk = SKILL_BY_ID[s.id];
      const need = s.lvl < 10 ? skillExpToNext(s.lvl) : 0;
      return `<div class="item"><div class="t"><b>${sk.name}</b>
        <span class="tiny muted">${KIND_NAME[sk.kind]}　第 ${s.lvl} 層</span>
        <div class="d">${sk.desc}</div>
        ${need ? `<div class="bar sta" style="margin-top:4px"><i style="width:${(s.exp || 0) / need * 100}%"></i></div>`
          : '<div class="tiny" style="color:var(--red)">已臻大成</div>'}</div>
        <button class="btn sm" data-forget="${s.id}">遺忘</button></div>`;
    }).join('') || '<div class="muted small">尚未習得任何武功。</div>'}</div>`;
  } else if (tab === 'equip') {
    body = [['weapon', '兵器'], ['armor', '護甲'], ['accessory', '飾物']].map(([k, nm]) => {
      const cur = ITEM_BY_ID[c.equip[k]];
      const opts = G.bagList(g).filter(x => x.item.type === k);
      return `<div style="margin-bottom:10px">
        <div class="kv"><span class="muted">${nm}</span><b>${cur ? cur.name : '（無）'}</b></div>
        ${cur ? `<div class="tiny muted">${Object.entries(cur.mods || {}).map(([a, v]) => `${STAT_NAME[a] || a} ${v > 0 ? '+' : ''}${v}`).join('　')}</div>` : ''}
        <div class="list" style="margin-top:4px">${opts.map(x => `<button class="item" data-eq="${x.id}">
          <div class="t"><b>${x.item.name}</b> ×${x.n}<div class="d">${Object.entries(x.item.mods || {}).map(([a, v]) => `${STAT_NAME[a] || a} ${v > 0 ? '+' : ''}${v}`).join('　')}</div></div></button>`).join('')
        || '<div class="tiny muted">行囊中沒有此類物品。</div>'}</div></div>`;
    }).join('');
  } else if (tab === 'book') {
    const books = G.bagList(g).filter(x => x.item.teaches);
    body = `<div class="list">${books.map(x => {
      const sk = SKILL_BY_ID[x.item.teaches];
      const chk = canLearn(c, x.item.teaches);
      return `<button class="item" data-learn="${x.id}" ${chk.ok ? '' : 'disabled'}>
        <div class="t"><b>${x.item.name}</b> <span class="tiny muted">授【${sk.name}】需資質 ${sk.apt}</span>
        <div class="d">${chk.ok ? sk.desc : chk.why}</div></div></button>`;
    }).join('') || '<div class="muted small">行囊中沒有秘笈。</div>'}</div>`;
  } else {
    body = `<div class="list">${g.party.map((p, i) => `<button class="item" data-sw="${i}">
      <div class="t"><b>${esc(p.name)}</b> <span class="tiny muted">Lv.${p.lvl}　${p.title || ''}</span></div>
      ${i > 0 ? `<span class="d">點右側請他離隊</span>` : '<span class="d">主角</span>'}</button>`).join('')}</div>
      ${idx > 0 ? '<hr><button class="btn sm" data-dismiss>請 ' + esc(c.name) + ' 離隊</button>' : ''}`;
  }

  modalEl.className = 'on';
  S.sui && (S.sui.paused = true);
  modalEl.innerHTML = `<div class="dlg">
    <h3>${esc(c.name)}　<span class="tiny muted">${c.title || ''}</span></h3>
    <div class="tabs">${tabs.map(([k, t]) => `<button class="tab ${k === tab ? 'on' : ''}" data-tab="${k}">${t}</button>`).join('')}</div>
    <div class="body">${body}</div>
    <div class="foot"><button class="btn" data-close>關閉</button></div></div>`;
  modalEl.querySelector('[data-close]').onclick = closeModal;
  modalEl.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => charSheet(idx, b.dataset.tab));
  modalEl.querySelectorAll('[data-sw]').forEach(b => b.onclick = () => charSheet(+b.dataset.sw, 'stat'));
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
  if (dis) dis.onclick = () => { G.dismiss(g, idx); closeModal(); paintAll(); };
}

// ═══ 商店・行囊 ═══
function shopDialog(stock, title = '商鋪', greet = '') {
  const g = S.g;
  const buyRows = stock.map(id => {
    const it = ITEM_BY_ID[id];
    return `<button class="item" data-buy="${id}" ${g.gold < it.price ? 'disabled' : ''}>
      <div class="t"><b>${it.name}</b><div class="d">${it.desc}</div></div>
      <div class="d">${it.price} 兩</div></button>`;
  }).join('');
  const sellRows = G.bagList(g).filter(x => !(x.item.type === 'book' && QUEST_BOOKS.includes(x.id)))
    .map(x => `<button class="item" data-sell="${x.id}">
      <div class="t"><b>${x.item.name}</b> ×${x.n}</div>
      <div class="d">售 ${Math.round(x.item.price * 0.4)} 兩</div></button>`).join('');
  const body = modal(`${esc(title)}　<span class="tiny muted">身上 ${g.gold} 兩</span>`,
    `${greet ? `<div class="narr">${greet}</div>` : ''}<div class="small muted">買</div><div class="list">${buyRows}</div>
     <hr><div class="small muted">賣</div><div class="list">${sellRows || '<div class="tiny muted">沒有可賣之物。</div>'}</div>`);
  body.querySelectorAll('[data-buy]').forEach(b => b.onclick = () => {
    const r = G.buy(g, b.dataset.buy);
    if (!r.ok) return toast(r.why);
    paintHud(); closeModal(); shopDialog(stock, title);
  });
  body.querySelectorAll('[data-sell]').forEach(b => b.onclick = () => {
    const r = G.sell(g, b.dataset.sell);
    if (!r.ok) return toast(r.why || '賣不得。');
    paintHud(); closeModal(); shopDialog(stock, title);
  });
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
      closeModal(); paintAll(); autosave(); bagDialog();
    });
  });
}

// ═══ 除錯參數 ═══
// ?pos=x,y[,facing] 直接落地　?cam=n 鎖視野格寬　?time=HH 設時辰
// ?books=N 先給 N 部秘笈　?at=地點id 站到那裡　?gold=N
// SF Sunset Drive 拿這些做截圖驗證；這裡是給 uismoke 用的——
// 「得先走到第五關才測得到」壓成一次跳轉。
function applyDebugParams(g) {
  const q = new URLSearchParams(location.search);
  if (q.has('at')) {
    const p = G.locPos(q.get('at'));
    if (p) { g.scene = 'world'; g.pos = { ...p }; }
  }
  if (q.has('pos')) {
    const [x, y, f] = q.get('pos').split(',');
    g.pos = { x: +x, y: +y };
    if (f) g.facing = f;
  }
  if (q.has('time')) g.clock = Math.floor(g.clock / G.DAY_MINUTES) * G.DAY_MINUTES + Math.round(+q.get('time') * 60);
  if (q.has('books')) {
    g.books = QUEST_BOOKS.slice(0, Math.min(14, +q.get('books')));
    for (const b of g.books) G.addItem(g, b, 1);
  }
  if (q.has('gold')) g.gold = +q.get('gold');
  g.day = G.dayOf(g);
  return g;
}
const camParam = new URLSearchParams(location.search).get('cam');

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
window.__jy = {
  S, G, modalEl, renderTitle, renderField, startBattle, charSheet,
  get R() { return R; }, get sui() { return S.sui; },
};

renderTitle();

if (location.search.includes('autotest')) {
  import('../../tools/uitest.js').then(m => m.run(window.__jy));
}
