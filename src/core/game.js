// 江湖狀態機：徒步行走、場景進出、遭遇、商店、客棧、練功、招募、存讀檔。
// 這一層不碰 DOM。

import { RNG } from './rng.js';
import { LOCATIONS, LOC_BY_ID } from '../data/world.js';
import { PLAYER_TEMPLATE, ALLY_BY_ID, ENEMY_BY_ID, cloneChar } from '../data/chars.js';
import { ITEM_BY_ID, QUEST_BOOKS } from '../data/items.js';
import { SKILL_BY_ID } from '../data/skills.js';
import { gainExp, battleExp, canLearn, learn, meditate, maxHp, maxMp, derived } from './rules.js';
import { createBattle, alive } from './battle.js';
import { getScene, owPos } from '../data/maps.js';
import * as F from './field.js';

export const PARTY_MAX = 6;
export const STAMINA_MAX = 100;
export const SAVE_KEY = 'jinyong-heroes-save';
const STEPS_PER_DAY = 34;      // 大地圖上走幾步算一天
const STAMINA_PER_STEP = 0.28;

export function newGame(name = '無名', seed = Date.now() & 0x7fffffff) {
  const hero = cloneChar(PLAYER_TEMPLATE);
  hero.name = name || '無名';
  hero.curHp = maxHp(hero); hero.curMp = maxMp(hero);
  // 起點就用大地圖自己的出生點，別再各算各的
  const start = getScene('overworld').spawn;
  return {
    seed, rngState: seed, day: 1, gold: 60, fame: 0, morality: 50,
    stamina: STAMINA_MAX, staminaFrac: 0,
    scene: 'overworld', pos: { ...start }, facing: 'up', steps: 0,
    party: [hero],
    bag: { p_jinchuang: 3, p_xionghuang: 1 },
    flags: {}, books: [], log: ['你在揚州城外的官道上醒來。'],
    version: 2,
  };
}

function rngOf(g) { const r = new RNG(1); r.s = g.rngState >>> 0; return r; }
function saveRng(g, r) { g.rngState = r.s >>> 0; }

export function say(g, msg) { g.log.push(msg); if (g.log.length > 200) g.log.shift(); }

export const hero = g => g.party[0];
export const curScene = g => getScene(g.scene);
export const here = g => (g.scene === 'overworld' ? null : LOC_BY_ID[g.scene]);

// ── 場上仍然存在的實體（頭目打倒後消失、秘笈拿走後消失）──
export function activeEntities(g, sc = curScene(g)) {
  return sc.entities.filter(e => {
    if (e.type === 'boss') return !g.flags['cleared:' + sc.id];
    if (e.type === 'book') return !g.books.includes(e.book);
    if (e.type === 'recruit') return !g.party.some(p => p.id === e.who);
    return true;
  });
}

// ── 行走 ──
// 回傳 {moved, blocked, bumped, entered, encounter, sceneChanged}
export function walk(g, dir) {
  const sc = curScene(g);
  const ents = activeEntities(g, sc);
  g.facing = dir;
  const r = F.step(sc, g.pos, dir, ents);
  if (!r.moved) return { moved: false, blocked: r.blocked, bumped: r.bumped || null };

  g.pos = { x: r.x, y: r.y };
  g.steps++;

  const out = { moved: true, entered: r.entered || null };

  // 體力與日子
  if (g.scene === 'overworld') {
    g.staminaFrac += STAMINA_PER_STEP;
    while (g.staminaFrac >= 1) { g.staminaFrac -= 1; g.stamina = Math.max(0, g.stamina - 1); }
    if (g.steps % STEPS_PER_DAY === 0) { g.day++; regen(g, 1); }
  }

  // 踏上出入口
  if (r.entered) {
    if (r.entered.type === 'gate') {
      const blocked = gateBlocked(g, r.entered.to);
      if (blocked) { out.refused = blocked; return out; }
      enterScene(g, r.entered.to);
      out.sceneChanged = true;
      return out;
    }
    if (r.entered.type === 'exit') { exitScene(g); out.sceneChanged = true; return out; }
    if (r.entered.type === 'book') { out.book = takeBook(g, r.entered); return out; }
  }

  // 隨機遭遇
  const rate = sc.encounterRate || 0;
  if (rate > 0 && g.stamina > 0) {
    const rr = rngOf(g);
    if (rr.chance(rate)) {
      const mobs = mobsFor(g, sc, rr);
      saveRng(g, rr);
      if (mobs) out.encounter = mobs;
    } else saveRng(g, rr);
  }
  return out;
}

// 大地圖上的雜兵取自最近的地點
function mobsFor(g, sc, r) {
  let pool = null;
  if (sc.kind === 'overworld') {
    let best = null, bd = Infinity;
    for (const loc of LOCATIONS) {
      if (!loc.mobs) continue;
      const p = owPos(loc);
      const d = Math.abs(p.x - g.pos.x) + Math.abs(p.y - g.pos.y);
      if (d < bd) { bd = d; best = loc; }
    }
    pool = best?.mobs;
  } else pool = sc.loc?.mobs;
  if (!pool?.length) return null;
  const n = r.irange(1, Math.min(4, 1 + Math.floor(g.party.length * 0.8)));
  return Array.from({ length: n }, () => r.pick(pool));
}

export function enterScene(g, locId) {
  const sc = getScene(locId);
  g.scene = locId;
  g.pos = { ...sc.spawn };
  g.facing = 'up';
  say(g, `你走進了${sc.name}。`);
}

export function exitScene(g) {
  const locId = g.scene;
  const p = owPos(LOC_BY_ID[locId]);   // 路口就在入口南邊一格
  g.scene = 'overworld';
  g.pos = { x: p.x, y: p.y };
  g.facing = 'down';
  say(g, `你離開了${LOC_BY_ID[locId].name}。`);
}

function regen(g, days) {
  for (const c of g.party) {
    const mh = maxHp(c), mm = maxMp(c);
    c.curHp = Math.min(mh, (c.curHp ?? mh) + Math.round(mh * 0.06 * days));
    c.curMp = Math.min(mm, (c.curMp ?? mm) + Math.round(mm * 0.1 * days));
  }
}

function takeBook(g, e) {
  if (g.books.includes(e.book)) return null;
  g.books.push(e.book);
  addItem(g, e.book, 1);
  say(g, `你得到了《${ITEM_BY_ID[e.book].name}》。`);
  return e.book;
}

// ── 戰鬥 ──
export function buildEnemies(ids, r, scale = 1) {
  return ids.map(id => {
    const c = cloneChar(ENEMY_BY_ID[id]);
    if (scale !== 1) for (const k of ['hp', 'mp', 'atk', 'def']) c[k] = Math.round(c[k] * scale);
    c.curHp = maxHp(c); c.curMp = maxMp(c);
    return c;
  });
}

export function startEncounter(g, mobIds) {
  const r = rngOf(g);
  const seed = r.int(1e9);
  saveRng(g, r);
  return createBattle({
    allies: g.party, enemies: buildEnemies(mobIds, new RNG(seed)),
    seed, name: '遭遇戰', canFlee: true,
  });
}

export function startBoss(g) {
  const loc = here(g);
  if (!loc?.boss) return null;
  const r = rngOf(g);
  const seed = r.int(1e9);
  saveRng(g, r);
  return createBattle({
    allies: g.party, enemies: buildEnemies(loc.boss.enemies, new RNG(seed), loc.boss.scale || 1),
    seed, name: loc.boss.title,
    canFlee: loc.boss.flee !== false, density: loc.type === 'town' ? 0.06 : 0.14,
  });
}

export function resolveBattle(g, b, isBoss) {
  const r = rngOf(g);
  const out = { result: b.over, exp: 0, gold: 0, loot: [], levelUps: [], cleared: false };
  for (const u of b.units) {
    if (u.side !== 'ally') continue;
    u.char.curHp = u.down ? 1 : u.hp;
    u.char.curMp = u.mp;
  }
  const enemies = b.units.filter(u => u.side === 'enemy').map(u => u.char);

  if (b.over === 'win') {
    const exp = battleExp(enemies);
    const gold = enemies.reduce((n, e) => n + Math.round(6 * Math.pow(e.lvl, 1.4)), 0);
    out.exp = exp; out.gold = gold;
    g.gold += gold;
    const survivors = b.units.filter(u => u.side === 'ally' && !u.down);
    for (const u of survivors) {
      const share = u.char === g.party[0] ? exp : Math.round(exp / survivors.length);
      const ups = gainExp(u.char, share, r);
      if (ups.length) out.levelUps.push({ name: u.char.name, levels: ups.length, lvl: u.char.lvl });
    }
    for (const e of enemies) {
      if (e.equip?.weapon && r.chance(0.18)) out.loot.push(e.equip.weapon);
      if (e.equip?.accessory && r.chance(0.15)) out.loot.push(e.equip.accessory);
      if (r.chance(0.3)) out.loot.push(r.pick(['p_jinchuang', 'p_gudan', 'p_jiedu']));
    }
    for (const id of out.loot) addItem(g, id, 1);
    g.fame += isBoss ? 6 : 1;
    if (isBoss) {
      g.flags['cleared:' + g.scene] = true;
      out.cleared = true;
    }
    say(g, `一戰得勝，獲得 ${exp} 點經驗、${gold} 兩銀子。`);
  } else if (b.over === 'lose') {
    const lost = Math.round(g.gold * 0.3);
    g.gold -= lost;
    g.day += 3;
    for (const c of g.party) {
      c.curHp = Math.max(1, Math.round(maxHp(c) * 0.4));
      c.curMp = Math.round(maxMp(c) * 0.3);
    }
    g.stamina = Math.max(10, g.stamina - 20);
    // 送回最近城鎮
    const town = nearestTown(g);
    if (town) { g.scene = 'overworld'; g.pos = { ...owPos(town) }; }
    say(g, `你們敗了，被人抬回城裡，養了三日傷，還丟了 ${lost} 兩銀子。`);
  } else if (b.over === 'flee') {
    g.stamina = Math.max(0, g.stamina - 4);
    say(g, '你們奪路而逃。');
  }
  g.stamina = Math.max(0, g.stamina - (isBoss ? 10 : 4));
  saveRng(g, r);
  return out;
}

function nearestTown(g) {
  const towns = LOCATIONS.filter(l => l.type === 'town');
  const from = g.scene === 'overworld' ? g.pos : owPos(LOC_BY_ID[g.scene]);
  return towns.reduce((a, c) => {
    const pa = owPos(a), pc = owPos(c);
    const da = Math.abs(pa.x - from.x) + Math.abs(pa.y - from.y);
    const dc = Math.abs(pc.x - from.x) + Math.abs(pc.y - from.y);
    return dc < da ? c : a;
  });
}

// ── 與 NPC／物件互動 ──
// 回傳描述給 UI；純資料，不含畫面。
export function interact(g, e) {
  switch (e.type) {
    case 'sign': return { kind: 'text', title: '石碑', text: e.text };
    case 'talk': return { kind: 'text', title: '路人', text: e.text };
    case 'shop': return { kind: 'shop' };
    case 'inn': return { kind: 'inn' };
    case 'train': return { kind: 'train' };
    case 'recruit': return { kind: 'recruit', who: e.who };
    case 'boss': return { kind: 'boss' };
    default: return null;
  }
}

// ── 背包 ──
export function addItem(g, id, n = 1) { g.bag[id] = (g.bag[id] || 0) + n; }
export function removeItem(g, id, n = 1) {
  if (!g.bag[id]) return false;
  g.bag[id] -= n;
  if (g.bag[id] <= 0) delete g.bag[id];
  return true;
}
export function bagList(g) {
  return Object.entries(g.bag)
    .map(([id, n]) => ({ id, n, item: ITEM_BY_ID[id] }))
    .filter(x => x.item)
    .sort((a, x) => a.item.type.localeCompare(x.item.type));
}

export function buy(g, id) {
  const it = ITEM_BY_ID[id];
  if (!it) return { ok: false, why: '沒有此物。' };
  if (g.gold < it.price) return { ok: false, why: '銀子不夠。' };
  g.gold -= it.price; addItem(g, id, 1);
  return { ok: true };
}
export function sell(g, id) {
  const it = ITEM_BY_ID[id];
  if (!it || !g.bag[id]) return { ok: false };
  if (it.type === 'book' && QUEST_BOOKS.includes(id)) return { ok: false, why: '主線秘笈不可變賣。' };
  removeItem(g, id, 1);
  g.gold += Math.round(it.price * 0.4);
  return { ok: true, gold: Math.round(it.price * 0.4) };
}

export function equip(g, charIdx, itemId) {
  const c = g.party[charIdx];
  const it = ITEM_BY_ID[itemId];
  if (!c || !it) return { ok: false };
  const slot = it.type;
  if (!['weapon', 'armor', 'accessory'].includes(slot)) return { ok: false };
  const old = c.equip[slot];
  if (!removeItem(g, itemId, 1)) return { ok: false };
  if (old) addItem(g, old, 1);
  c.equip[slot] = itemId;
  c.curHp = Math.min(c.curHp ?? maxHp(c), maxHp(c));
  c.curMp = Math.min(c.curMp ?? maxMp(c), maxMp(c));
  return { ok: true, replaced: old };
}

export function useItemWorld(g, charIdx, itemId) {
  const c = g.party[charIdx];
  const it = ITEM_BY_ID[itemId];
  if (!c || !it?.use) return { ok: false };
  const u = it.use;
  if (u.hp) c.curHp = Math.min(maxHp(c), (c.curHp ?? 0) + u.hp);
  if (u.mp) c.curMp = Math.min(maxMp(c), (c.curMp ?? 0) + u.mp);
  if (u.stamina) g.stamina = Math.min(STAMINA_MAX, g.stamina + u.stamina);
  if (u.permMp) { c.mp += u.permMp; c.curMp = maxMp(c); }
  if (u.permPoisonRes) c.poisonRes += u.permPoisonRes;
  removeItem(g, itemId, 1);
  return { ok: true };
}

export function studyBook(g, charIdx, itemId) {
  const c = g.party[charIdx];
  const it = ITEM_BY_ID[itemId];
  if (!it?.teaches) return { ok: false, why: '這不是武學秘笈。' };
  if (!g.bag[itemId]) return { ok: false, why: '你沒有這本秘笈。' };
  const chk = canLearn(c, it.teaches);
  if (!chk.ok) return chk;
  learn(c, it.teaches);
  if (!QUEST_BOOKS.includes(itemId)) removeItem(g, itemId, 1);
  say(g, `${c.name} 習得【${SKILL_BY_ID[it.teaches].name}】。`);
  return { ok: true, skill: SKILL_BY_ID[it.teaches] };
}

export function forgetSkill(g, charIdx, skillId) {
  const c = g.party[charIdx];
  const i = c.skills.findIndex(s => s.id === skillId);
  if (i < 0) return { ok: false };
  c.skills.splice(i, 1);
  c.curHp = Math.min(c.curHp, maxHp(c)); c.curMp = Math.min(c.curMp, maxMp(c));
  return { ok: true };
}

export function inn(g) {
  const loc = here(g);
  if (loc?.inn == null) return { ok: false, why: '此地沒有客棧。' };
  if (g.gold < loc.inn) return { ok: false, why: '住不起店。' };
  g.gold -= loc.inn;
  g.day += 1;
  g.stamina = STAMINA_MAX;
  for (const c of g.party) { c.curHp = maxHp(c); c.curMp = maxMp(c); }
  say(g, '一夜好眠，精神大振。');
  return { ok: true };
}

export function train(g) {
  if (g.stamina < 15) return { ok: false, why: '體力不足，無法運功。' };
  const r = rngOf(g);
  g.stamina -= 15; g.day += 1;
  const results = [];
  for (const c of g.party) {
    const m = meditate(c, r);
    if (m.ok) {
      c.curMp = Math.min(maxMp(c), (c.curMp ?? 0) + Math.round(maxMp(c) * 0.5));
      results.push({ name: c.name, ...m });
    }
  }
  saveRng(g, r);
  if (!results.length) return { ok: false, why: '全隊都不會內功，練無可練。' };
  say(g, '眾人打坐一日，內功精進。');
  return { ok: true, results };
}

export function donate(g, amount) {
  if (g.gold < amount) return { ok: false, why: '銀子不夠。' };
  g.gold -= amount;
  const up = Math.min(12, Math.max(1, Math.round(amount / 120)));
  g.morality = Math.min(100, g.morality + up);
  say(g, `你施捨了 ${amount} 兩，道德 +${up}。`);
  return { ok: true, up };
}

export function extort(g) {
  const r = rngOf(g);
  const gain = r.irange(60, 260);
  g.gold += gain;
  g.morality = Math.max(0, g.morality - r.irange(4, 9));
  g.stamina = Math.max(0, g.stamina - 5);
  saveRng(g, r);
  say(g, `你「借」了 ${gain} 兩，道德下滑。`);
  return { ok: true, gain };
}

// ── 招募 ──
export function recruitCheck(g, id) {
  const loc = here(g);
  const req = loc?.recruit?.find(r => r.id === id);
  const a = ALLY_BY_ID[id];
  if (!a) return { ok: false, reasons: ['查無此人'], ally: null };
  const has = g.party.some(p => p.id === id);
  const reasons = [];
  if (has) reasons.push('已在隊中');
  if (!has && g.party.length >= PARTY_MAX) reasons.push(`隊伍已滿（上限 ${PARTY_MAX} 人）`);
  if (req) {
    if (req.books && g.books.length < req.books) reasons.push(`需集齊 ${req.books} 部秘笈（現有 ${g.books.length}）`);
    if (req.fame && g.fame < req.fame) reasons.push(`需聲望 ${req.fame}（現有 ${g.fame}）`);
    if (req.morality && g.morality < req.morality) reasons.push(`需道德 ${req.morality}（現有 ${g.morality}）`);
    if (req.moralityMax != null && g.morality > req.moralityMax) reasons.push(`道德需低於 ${req.moralityMax}（現有 ${g.morality}）`);
    if (req.needAlly && !g.party.some(p => p.id === req.needAlly)) {
      reasons.push(`須先請得${ALLY_BY_ID[req.needAlly].name}`);
    }
  }
  return { ok: reasons.length === 0, reasons, ally: a, has };
}

export function recruit(g, id) {
  const chk = recruitCheck(g, id);
  if (!chk.ok) return { ok: false, why: chk.reasons[0] };
  const c = cloneChar(chk.ally);
  c.curHp = maxHp(c); c.curMp = maxMp(c);
  g.party.push(c);
  g.flags['recruited:' + id] = true;
  say(g, `${c.name} 加入了隊伍。`);
  return { ok: true, char: c };
}

export function dismiss(g, idx) {
  if (idx === 0) return { ok: false, why: '不能趕走自己。' };
  const c = g.party.splice(idx, 1)[0];
  say(g, `${c.name} 拱手告辭。`);
  return { ok: true };
}

export function progress(g) {
  return { books: g.books.length, total: QUEST_BOOKS.length, done: g.books.length >= QUEST_BOOKS.length };
}
export function isCleared(g, locId) { return !!g.flags['cleared:' + locId]; }

// 華山之巔要十四部秘笈才進得去
export function gateBlocked(g, locId) {
  const l = LOC_BY_ID[locId];
  if (l?.requireBooks && g.books.length < l.requireBooks) {
    return `十四部秘笈未齊（${g.books.length}/${l.requireBooks}），上不得${l.name}。`;
  }
  return null;
}

// ── 存讀檔 ──
export function serialize(g) { return JSON.stringify(g); }
export function deserialize(s) {
  const g = JSON.parse(s);
  for (const c of g.party) { c.equip = c.equip || {}; c.skills = c.skills || []; }
  return g;
}
export function saveTo(slot, g) {
  if (typeof localStorage === 'undefined') return false;
  localStorage.setItem(SAVE_KEY + ':' + slot, serialize(g));
  return true;
}
export function loadFrom(slot) {
  if (typeof localStorage === 'undefined') return null;
  const s = localStorage.getItem(SAVE_KEY + ':' + slot);
  return s ? deserialize(s) : null;
}
export function saveInfo(slot) {
  if (typeof localStorage === 'undefined') return null;
  const s = localStorage.getItem(SAVE_KEY + ':' + slot);
  if (!s) return null;
  try {
    const g = JSON.parse(s);
    return {
      name: g.party[0].name, lvl: g.party[0].lvl, day: g.day,
      at: g.scene === 'overworld' ? '江湖道上' : LOC_BY_ID[g.scene]?.name,
      books: g.books.length,
    };
  } catch { return null; }
}

export { LOCATIONS, LOC_BY_ID, derived, alive, getScene, owPos };
