// 江湖狀態機：行走、遭遇、商店、客棧、練功、招募、存讀檔。

import { RNG } from './rng.js';
import { LOCATIONS, LOC_BY_ID, travelCost } from '../data/world.js';
import { PLAYER_TEMPLATE, ALLY_BY_ID, ENEMY_BY_ID, cloneChar } from '../data/chars.js';
import { ITEM_BY_ID, QUEST_BOOKS } from '../data/items.js';
import { SKILL_BY_ID } from '../data/skills.js';
import {
  derived, gainExp, battleExp, canLearn, learn, meditate, maxHp, maxMp,
} from './rules.js';
import { createBattle, alive } from './battle.js';

export const PARTY_MAX = 6;
export const STAMINA_MAX = 100;
export const SAVE_KEY = 'jinyong-heroes-save';

export function newGame(name = '無名', seed = Date.now() & 0x7fffffff) {
  const hero = cloneChar(PLAYER_TEMPLATE);
  hero.name = name || '無名';
  hero.curHp = maxHp(hero); hero.curMp = maxMp(hero);
  return {
    seed, rngState: seed, day: 1, gold: 60, fame: 0, morality: 50,
    stamina: STAMINA_MAX, at: 'yangzhou',
    party: [hero],
    bag: { p_jinchuang: 3, p_xionghuang: 1 },
    flags: {}, books: [], log: ['你在揚州城外醒來，身上只有幾十文錢。'],
    version: 1,
  };
}

function rngOf(g) {
  const r = new RNG(1);
  r.s = g.rngState >>> 0;
  return r;
}
function saveRng(g, r) { g.rngState = r.s >>> 0; }

export function say(g, msg) {
  g.log.push(msg);
  if (g.log.length > 200) g.log.shift();
}

export const here = g => LOC_BY_ID[g.at];
export const hero = g => g.party[0];

// ── 行走 ──
export function neighbours(g) {
  return here(g).links
    .map(id => LOC_BY_ID[id])
    .filter(l => {
      if (l.requireBooks && g.books.length < l.requireBooks) return false;
      return true;
    });
}

export function travel(g, toId) {
  const loc = here(g);
  if (!loc.links.includes(toId)) return { ok: false, why: '那裡不通。' };
  const dest = LOC_BY_ID[toId];
  if (dest.requireBooks && g.books.length < dest.requireBooks) {
    return { ok: false, why: `十四部秘笈未齊（${g.books.length}/${dest.requireBooks}），上不得華山之巔。` };
  }
  const cost = travelCost(g.at, toId);
  if (g.stamina < cost.stamina) return { ok: false, why: '體力不支，先歇息罷。' };
  g.stamina -= cost.stamina;
  g.day += cost.days;
  g.at = toId;
  regen(g, cost.days);
  say(g, `你走了 ${cost.days} 天，來到${dest.name}。`);

  const r = rngOf(g);
  let encounter = null;
  const src = LOC_BY_ID[toId];
  if (src.mobs?.length && r.chance(0.34)) {
    const n = r.irange(1, Math.min(4, 1 + Math.floor(g.party.length * 0.8)));
    encounter = Array.from({ length: n }, () => r.pick(src.mobs));
  }
  saveRng(g, r);
  return { ok: true, days: cost.days, encounter };
}

// 每天自然恢復
function regen(g, days) {
  for (const c of g.party) {
    const mh = maxHp(c), mm = maxMp(c);
    c.curHp = Math.min(mh, (c.curHp ?? mh) + Math.round(mh * 0.08 * days));
    c.curMp = Math.min(mm, (c.curMp ?? mm) + Math.round(mm * 0.12 * days));
  }
}

// ── 戰鬥發起與結算 ──
export function buildEnemies(ids, r, scale = 1) {
  return ids.map(id => {
    const c = cloneChar(ENEMY_BY_ID[id]);
    if (scale !== 1) {
      for (const k of ['hp', 'mp', 'atk', 'def']) c[k] = Math.round(c[k] * scale);
    }
    c.curHp = maxHp(c); c.curMp = maxMp(c);
    return c;
  });
}

export function startEncounter(g, mobIds) {
  const r = rngOf(g);
  const seed = r.int(1e9);
  saveRng(g, r);
  const enemies = buildEnemies(mobIds, new RNG(seed));
  return createBattle({
    allies: g.party, enemies, seed, name: '遭遇戰', canFlee: true,
  });
}

export function startBoss(g) {
  const loc = here(g);
  if (!loc.boss) return null;
  const r = rngOf(g);
  const seed = r.int(1e9);
  saveRng(g, r);
  const enemies = buildEnemies(loc.boss.enemies, new RNG(seed), loc.boss.scale || 1);
  return createBattle({
    allies: g.party, enemies, seed, name: loc.boss.title,
    canFlee: loc.boss.flee !== false, density: loc.type === 'town' ? 0.06 : 0.14,
  });
}

// 把戰後的血量與經驗寫回世界狀態
export function resolveBattle(g, b, isBoss) {
  const r = rngOf(g);
  const out = { result: b.over, exp: 0, gold: 0, loot: [], levelUps: [], book: null, cleared: false };
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
    // 主角是這段江湖路的主人，獨得全份經驗；同伴分攤其餘。
    for (const u of survivors) {
      const isHero = u.char === g.party[0];
      const share = isHero ? exp : Math.round(exp / survivors.length);
      const ups = gainExp(u.char, share, r);
      if (ups.length) out.levelUps.push({ name: u.char.name, levels: ups.length, lvl: u.char.lvl });
    }
    // 掉落
    for (const e of enemies) {
      if (e.equip?.weapon && r.chance(0.18)) out.loot.push(e.equip.weapon);
      if (e.equip?.accessory && r.chance(0.15)) out.loot.push(e.equip.accessory);
      if (r.chance(0.3)) out.loot.push(r.pick(['p_jinchuang', 'p_gudan', 'p_jiedu']));
    }
    for (const id of out.loot) addItem(g, id, 1);

    g.fame += isBoss ? 6 : 1;

    if (isBoss) {
      const loc = here(g);
      g.flags['cleared:' + loc.id] = true;
      out.cleared = true;
      if (loc.book && !g.books.includes(loc.book)) {
        g.books.push(loc.book);
        addItem(g, loc.book, 1);
        out.book = loc.book;
      }
    }
    say(g, `一戰得勝，獲得 ${exp} 點經驗、${gold} 兩銀子。`);
  } else if (b.over === 'lose') {
    const lost = Math.round(g.gold * 0.3);
    g.gold -= lost;
    g.day += 3;
    for (const c of g.party) { c.curHp = Math.max(1, Math.round(maxHp(c) * 0.4)); c.curMp = Math.round(maxMp(c) * 0.3); }
    g.stamina = Math.max(10, g.stamina - 20);
    say(g, `你們敗了，被人抬回客棧，養了三日傷，還丟了 ${lost} 兩銀子。`);
  } else if (b.over === 'flee') {
    g.stamina = Math.max(0, g.stamina - 8);
    say(g, '你們狼狽逃走。');
  }
  g.stamina = Math.max(0, g.stamina - (isBoss ? 12 : 6));
  saveRng(g, r);
  return out;
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

// ── 秘笈習武 ──
export function studyBook(g, charIdx, itemId) {
  const c = g.party[charIdx];
  const it = ITEM_BY_ID[itemId];
  if (!it?.teaches) return { ok: false, why: '這不是武學秘笈。' };
  if (!g.bag[itemId]) return { ok: false, why: '你沒有這本秘笈。' };
  const chk = canLearn(c, it.teaches);
  if (!chk.ok) return chk;
  learn(c, it.teaches);
  const sk = SKILL_BY_ID[it.teaches];
  if (!QUEST_BOOKS.includes(itemId)) removeItem(g, itemId, 1); // 散學書讀完即毀，主線秘笈保留
  say(g, `${c.name} 習得【${sk.name}】。`);
  return { ok: true, skill: sk };
}

export function forgetSkill(g, charIdx, skillId) {
  const c = g.party[charIdx];
  const i = c.skills.findIndex(s => s.id === skillId);
  if (i < 0) return { ok: false };
  c.skills.splice(i, 1);
  c.curHp = Math.min(c.curHp, maxHp(c)); c.curMp = Math.min(c.curMp, maxMp(c));
  return { ok: true };
}

// ── 客棧與練功 ──
export function inn(g) {
  const loc = here(g);
  if (loc.inn == null) return { ok: false, why: '此地沒有客棧。' };
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
  say(g, `眾人打坐一日，內功精進。`);
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
export function recruitCandidates(g) {
  const loc = here(g);
  if (!loc.recruit) return [];
  return loc.recruit.map(req => {
    const a = ALLY_BY_ID[req.id];
    const has = g.party.some(p => p.id === req.id);
    const reasons = [];
    if (has) reasons.push('已在隊中');
    if (g.party.length >= PARTY_MAX && !has) reasons.push(`隊伍已滿（上限 ${PARTY_MAX} 人）`);
    if (req.books && g.books.length < req.books) reasons.push(`需集齊 ${req.books} 部秘笈（現有 ${g.books.length}）`);
    if (req.fame && g.fame < req.fame) reasons.push(`需聲望 ${req.fame}（現有 ${g.fame}）`);
    if (req.morality && g.morality < req.morality) reasons.push(`需道德 ${req.morality}（現有 ${g.morality}）`);
    if (req.moralityMax != null && g.morality > req.moralityMax) reasons.push(`道德需低於 ${req.moralityMax}（現有 ${g.morality}）`);
    if (req.needAlly && !g.party.some(p => p.id === req.needAlly)) {
      reasons.push(`須先請得${ALLY_BY_ID[req.needAlly].name}`);
    }
    return { ally: a, req, ok: reasons.length === 0, reasons, has };
  });
}

export function recruit(g, id) {
  const cand = recruitCandidates(g).find(c => c.ally.id === id);
  if (!cand || !cand.ok) return { ok: false, why: cand ? cand.reasons[0] : '此人不在此處。' };
  const c = cloneChar(cand.ally);
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

// ── 進度 ──
export function progress(g) {
  const total = QUEST_BOOKS.length;
  return { books: g.books.length, total, done: g.books.length >= total };
}

export function isCleared(g, locId) { return !!g.flags['cleared:' + locId]; }

export function bookHere(g) {
  const loc = here(g);
  if (!loc.book) return null;
  return { id: loc.book, got: g.books.includes(loc.book) };
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
    return { name: g.party[0].name, lvl: g.party[0].lvl, day: g.day, at: LOC_BY_ID[g.at]?.name, books: g.books.length };
  } catch { return null; }
}

export { LOCATIONS, LOC_BY_ID, derived, alive };
