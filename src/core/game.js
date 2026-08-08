// 江湖狀態機：徒步行走、時辰與日夜、進出建物、渡海、遭遇、商店、客棧、練功、招募、存讀檔。
// 這一層不碰 DOM。

import { RNG } from './rng.js';
import { LOCATIONS, LOC_BY_ID } from '../data/world/locations.js';
import { DISTRICT_BY_ID } from '../data/world/jianghu.js';
import { PLAYER_TEMPLATE, ALLY_BY_ID, ENEMY_BY_ID, cloneChar } from '../data/chars.js';
import { ITEM_BY_ID, QUEST_BOOKS } from '../data/items.js';
import { SKILL_BY_ID } from '../data/skills.js';
import { ACTOR_LINES } from '../data/world/jianghu.js';
import { gainExp, battleExp, canLearn, learn, meditate, maxHp, maxMp, derived } from './rules.js';
import { createBattle, alive } from './battle.js';
import {
  getScene, locPos, districtAt, heightAt, stepCost, isRoad, doorPosOf, T,
} from '../data/maps.js';
import * as F from './field.js';

export const PARTY_MAX = 6;
export const STAMINA_MAX = 100;
export const SAVE_KEY = 'jinyong-heroes-save';

// ── 時辰 ──
// clock 是從第一天 00:00 起算的分鐘數，天數與時辰都由它推出來。
export const DAY_MINUTES = 1440;
const START_CLOCK = 7 * 60;          // 第一天早上七點醒來
export const DAWN = 5, DUSK = 19;    // 天亮、天黑
const INN_CLOSED_FROM = 23, INN_CLOSED_TO = 5;

export const dayOf = g => Math.floor(g.clock / DAY_MINUTES) + 1;
export const hourOf = g => (g.clock % DAY_MINUTES) / 60;
export const isNight = g => { const h = hourOf(g); return h < DAWN || h >= DUSK; };
export function timeLabel(g) {
  const h = Math.floor(hourOf(g)), m = Math.floor(g.clock % 60);
  const names = ['夜', '拂曉', '清晨', '上午', '正午', '午後', '黃昏', '入夜'];
  const idx = h < 5 ? 0 : h < 7 ? 1 : h < 9 ? 2 : h < 11 ? 3 : h < 13 ? 4 : h < 17 ? 5 : h < 19 ? 6 : 7;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} ${names[idx]}`;
}

export function newGame(name = '無名', seed = Date.now() & 0x7fffffff) {
  const hero = cloneChar(PLAYER_TEMPLATE);
  hero.name = name || '無名';
  hero.curHp = maxHp(hero); hero.curMp = maxMp(hero);
  const start = getScene('world').spawn;
  return {
    seed, rngState: seed, clock: START_CLOCK, day: 1,
    gold: 60, fame: 0, morality: 50,
    stamina: STAMINA_MAX, staminaFrac: 0,
    scene: 'world', pos: { ...start }, facing: 'up', steps: 0,
    party: [hero],
    bag: { p_jinchuang: 3, p_xionghuang: 1 },
    flags: {}, books: [], log: ['你在揚州城外的官道上醒來。'],
    version: 3,
  };
}

function rngOf(g) { const r = new RNG(1); r.s = g.rngState >>> 0; return r; }
function saveRng(g, r) { g.rngState = r.s >>> 0; }

export function say(g, msg) { g.log.push(msg); if (g.log.length > 200) g.log.shift(); }

export const hero = g => g.party[0];
export const curScene = g => getScene(g.scene);
export function here(g) {
  const sc = curScene(g);
  if (sc.kind === 'interior') return LOC_BY_ID[sc.locId];
  const id = districtAt(sc, g.pos.x, g.pos.y);
  return id ? LOC_BY_ID[id] : null;
}
export const inDistrict = g => {
  const sc = curScene(g);
  return sc.kind === 'interior' ? sc.locId : districtAt(sc, g.pos.x, g.pos.y);
};

// ── 時間推進 ──
export function advanceTime(g, minutes) {
  if (minutes <= 0) return;
  const before = dayOf(g);
  g.clock += minutes;
  g.day = dayOf(g);
  const days = g.day - before;
  if (days > 0) regen(g, days);
}

// ── 場上仍然存在的實體 ──
export function activeEntities(g, sc = curScene(g)) {
  const stat = sc.entities.filter(e => {
    if (e.type === 'boss') return !g.flags['cleared:' + sceneLoc(sc, e)];
    if (e.type === 'book') return !g.books.includes(e.book);
    if (e.type === 'recruit') return !g.party.some(p => p.id === e.who);
    return true;
  });
  return sc.actors?.length ? stat.concat(F.actorEntities(sc, g.steps)) : stat;
}
function sceneLoc(sc, e) {
  return sc.kind === 'interior' ? sc.locId : (districtAt(sc, e.x, e.y) || sc.id);
}

// 尋路要知道哪裡進不去，否則會排出一條走到一半被擋下來的路。
// 會走動的 NPC 不是牆（見 maps.js 的說明），尋路自然也不必理會它們。
export function pathOpts(g, sc = curScene(g)) {
  const ents = activeEntities(g, sc).filter(e => e.type !== 'actor');
  if (sc.kind === 'interior') return { ents };
  const shut = new Set(LOCATIONS.filter(l => gateBlocked(g, l.id)).map(l => l.id));
  if (!shut.size) return { ents };
  return { ents, blocked: (x, y) => shut.has(districtAt(sc, x, y)) };
}

// ══════════════════════════════════════════════════════════
// 行走
// ══════════════════════════════════════════════════════════
export function walk(g, dir) {
  const sc = curScene(g);
  const ents = activeEntities(g, sc);
  g.facing = dir;
  const from = { ...g.pos };
  const r = F.step(sc, g.pos, dir, ents);
  if (!r.moved) return { moved: false, blocked: r.blocked, bumped: r.bumped || null };

  // 華山之巔要十四部秘笈才上得去（不論從官道還是翻山過來）
  const destDist = districtAt(sc, r.x, r.y);
  if (destDist && destDist !== districtAt(sc, from.x, from.y)) {
    const block = gateBlocked(g, destDist);
    if (block) return { moved: false, refused: block };
  }

  g.pos = { x: r.x, y: r.y };
  g.steps++;

  const out = { moved: true, entered: r.entered || null };

  // 代價：官道便宜，跨野貴，上坡更貴；城鎮街道免費
  const cost = stepCost(sc, from.x, from.y, r.x, r.y);
  if (cost.stamina > 0) {
    g.staminaFrac += cost.stamina;
    while (g.staminaFrac >= 1) { g.staminaFrac -= 1; g.stamina = Math.max(0, g.stamina - 1); }
  }
  const wasNight = isNight(g);
  advanceTime(g, cost.minutes);
  if (isNight(g) && !wasNight) out.nightfall = true;

  // 進出街廓
  if (destDist && destDist !== districtAt(sc, from.x, from.y)) {
    out.arrived = destDist;
    say(g, `你走進了${LOC_BY_ID[destDist].name}。`);
  }

  // 踏上門檻／渡口／秘笈
  if (r.entered) {
    if (r.entered.type === 'door') { enterDoor(g, r.entered.to); out.sceneChanged = true; return out; }
    if (r.entered.type === 'exit') { exitDoor(g); out.sceneChanged = true; return out; }
    if (r.entered.type === 'ferry') { out.ferry = r.entered; return out; }
    if (r.entered.type === 'book') { out.book = takeBook(g, r.entered); return out; }
    if (r.entered.type === 'actor') out.actor = r.entered;   // 追上了路上的隊伍
  }

  // 隨機遭遇
  const rate = encounterRate(g, sc, r.x, r.y);
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

// 夜路難行：遭遇率高，強度略升
export function encounterRate(g, sc, x, y) {
  if (sc.kind === 'interior') return 0;
  const dist = districtAt(sc, x, y);
  if (dist) {
    const loc = LOC_BY_ID[dist];
    const style = DISTRICT_BY_ID[dist]?.style;
    return (loc.mobs && style === 'wild') ? 0.017 : 0;
  }
  const t = sc.tiles[y * sc.w + x];
  let rate = isRoad(t) ? 0.014 : 0.029;
  if (isNight(g)) rate *= 1.7;
  return rate;
}
export const nightScale = g => (isNight(g) ? 1.08 : 1);

function mobsFor(g, sc, r) {
  let pool = null;
  const dist = districtAt(sc, g.pos.x, g.pos.y);
  if (dist) pool = LOC_BY_ID[dist]?.mobs;
  else {
    let best = null, bd = Infinity;
    for (const loc of LOCATIONS) {
      if (!loc.mobs) continue;
      const p = locPos(loc.id);
      const d = Math.abs(p.x - g.pos.x) + Math.abs(p.y - g.pos.y);
      if (d < bd) { bd = d; best = loc; }
    }
    pool = best?.mobs;
  }
  if (!pool?.length) return null;
  const n = r.irange(1, Math.min(4, 1 + Math.floor(g.party.length * 0.8)));
  return Array.from({ length: n }, () => r.pick(pool));
}

// ── 建物內部（唯一的第二層場景）──
export function enterDoor(g, intId) {
  const sc = getScene(intId);
  g.returnTo = { scene: 'world', ...(doorPosOf(intId) || g.pos) };
  g.scene = intId;
  g.pos = { ...sc.spawn };
  g.facing = 'up';
  say(g, `你推門走進${sc.name}。`);
}

export function exitDoor(g) {
  const back = g.returnTo || { scene: 'world', ...getScene('world').spawn };
  const name = curScene(g).name;
  g.scene = back.scene;
  g.pos = { x: back.x, y: back.y };
  g.facing = 'down';
  g.returnTo = null;
  say(g, `你走出了${name}。`);
}

// ── 渡海（東海往桃花島）──
export function ride(g, ferry) {
  if (g.gold < ferry.fare) return { ok: false, why: `船資 ${ferry.fare} 兩，你付不起。` };
  g.gold -= ferry.fare;
  g.pos = { x: ferry.to.x, y: ferry.to.y };
  advanceTime(g, ferry.hours * 60);
  g.stamina = Math.max(0, g.stamina - 4);
  say(g, `渡船搖了半日，靠上${ferry.toName}。`);
  return { ok: true };
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

// ══════════════════════════════════════════════════════════
// 戰鬥
// ══════════════════════════════════════════════════════════
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
    allies: g.party, enemies: buildEnemies(mobIds, new RNG(seed), nightScale(g)),
    seed, name: isNight(g) ? '夜路遭遇' : '遭遇戰', canFlee: true,
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
  const locId = inDistrict(g);
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
    if (isBoss && locId) {
      g.flags['cleared:' + locId] = true;
      out.cleared = true;
    }
    say(g, `一戰得勝，獲得 ${exp} 點經驗、${gold} 兩銀子。`);
  } else if (b.over === 'lose') {
    const lost = Math.round(g.gold * 0.3);
    g.gold -= lost;
    advanceTime(g, 3 * DAY_MINUTES);
    for (const c of g.party) {
      c.curHp = Math.max(1, Math.round(maxHp(c) * 0.4));
      c.curMp = Math.round(maxMp(c) * 0.3);
    }
    g.stamina = Math.max(10, g.stamina - 20);
    const town = nearestTown(g);
    if (town) { g.scene = 'world'; g.pos = { ...locPos(town.id) }; g.returnTo = null; }
    say(g, `你們敗了，被人抬回城裡，養了三日傷，還丟了 ${lost} 兩銀子。`);
  } else if (b.over === 'flee') {
    g.stamina = Math.max(0, g.stamina - 4);
  }
  g.stamina = Math.max(0, g.stamina - (isBoss ? 10 : 4));
  saveRng(g, r);
  return out;
}

function nearestTown(g) {
  const towns = LOCATIONS.filter(l => l.type === 'town');
  const from = g.scene === 'world' ? g.pos : locPos(curScene(g).locId);
  return towns.reduce((a, c) => {
    const pa = locPos(a.id), pc = locPos(c.id);
    const da = Math.abs(pa.x - from.x) + Math.abs(pa.y - from.y);
    const dc = Math.abs(pc.x - from.x) + Math.abs(pc.y - from.y);
    return dc < da ? c : a;
  });
}

// ══════════════════════════════════════════════════════════
// 與 NPC／物件互動
// ══════════════════════════════════════════════════════════
const CARAVAN_STOCK = ['p_jinchuang', 'p_xiaohuan', 'p_gudan', 'p_jiedu', 'p_xionghuang'];

export function interact(g, e) {
  switch (e.type) {
    case 'sign': return { kind: 'text', title: e.name || '石碑', text: e.text };
    case 'talk': return { kind: 'text', title: e.name || '路人', text: e.text };
    case 'shop': return { kind: 'shop', stock: here(g)?.shop || [] };
    case 'inn': return { kind: 'inn' };
    case 'train': return { kind: 'train' };
    case 'recruit': return { kind: 'recruit', who: e.who };
    case 'boss': return { kind: 'boss' };
    case 'actor': return actorInteract(g, e);
    default: return null;
  }
}

function actorInteract(g, e) {
  const lines = ACTOR_LINES[e.kind] || ACTOR_LINES.patrol;
  const line = lines[(g.steps + e.offset) % lines.length];
  if (e.kind === 'caravan') return { kind: 'shop', stock: CARAVAN_STOCK, title: e.name, greet: line };
  return { kind: 'text', title: e.name, text: line };
}

// ══════════════════════════════════════════════════════════
// 背包
// ══════════════════════════════════════════════════════════
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

// ── 客棧：夜深了就打烊，逼你算準天黑前趕得到哪 ──
export function innOpen(g) {
  const h = hourOf(g);
  return !(h >= INN_CLOSED_FROM || h < INN_CLOSED_TO);
}

export function inn(g) {
  const loc = here(g);
  if (loc?.inn == null) return { ok: false, why: '此地沒有客棧。' };
  if (!innOpen(g)) return { ok: false, why: '「打烊了，客官明日請早。」' };
  if (g.gold < loc.inn) return { ok: false, why: '住不起店。' };
  g.gold -= loc.inn;
  // 睡到隔日清晨七點
  const target = Math.floor(g.clock / DAY_MINUTES) * DAY_MINUTES + DAY_MINUTES + START_CLOCK;
  advanceTime(g, target - g.clock);
  g.stamina = STAMINA_MAX;
  for (const c of g.party) { c.curHp = maxHp(c); c.curMp = maxMp(c); }
  say(g, '一夜好眠，精神大振。');
  return { ok: true };
}

export function train(g) {
  if (g.stamina < 15) return { ok: false, why: '體力不足，無法運功。' };
  const r = rngOf(g);
  g.stamina -= 15;
  advanceTime(g, DAY_MINUTES);
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

// 野外露宿：熬到天亮，代價是體力與遭遇風險已經付過了
export function camp(g) {
  const h = hourOf(g);
  const target = h >= DAWN
    ? Math.floor(g.clock / DAY_MINUTES) * DAY_MINUTES + DAY_MINUTES + START_CLOCK
    : Math.floor(g.clock / DAY_MINUTES) * DAY_MINUTES + START_CLOCK;
  advanceTime(g, Math.max(60, target - g.clock));
  g.stamina = Math.min(STAMINA_MAX, g.stamina + 35);
  say(g, '就地生了堆火，捱到天亮。');
  return { ok: true };
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

// ══════════════════════════════════════════════════════════
// 招募
// ══════════════════════════════════════════════════════════
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

// 華山之巔要十四部秘笈才上得去
export function gateBlocked(g, locId) {
  const l = LOC_BY_ID[locId];
  if (l?.requireBooks && g.books.length < l.requireBooks) {
    return `十四部秘笈未齊（${g.books.length}/${l.requireBooks}），上不得${l.name}。`;
  }
  return null;
}

// ══════════════════════════════════════════════════════════
// 存讀檔
// ══════════════════════════════════════════════════════════
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
    const sc = getScene(g.scene);
    const at = sc.kind === 'interior'
      ? sc.name
      : (districtAt(sc, g.pos.x, g.pos.y) ? LOC_BY_ID[districtAt(sc, g.pos.x, g.pos.y)].name : '江湖道上');
    return { name: g.party[0].name, lvl: g.party[0].lvl, day: g.day, at, books: g.books.length };
  } catch { return null; }
}

export { LOCATIONS, LOC_BY_ID, derived, alive, getScene, locPos, districtAt, heightAt, T };
