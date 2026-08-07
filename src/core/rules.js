// 規則核心：屬性衍算、傷害公式、成長曲線、武功習得條件。
// 這裡完全不碰 DOM，Node 可直接載入跑數值驗證。

import { SKILL_BY_ID, KIND_STAT, skill } from '../data/skills.js';
import { ITEM_BY_ID } from '../data/items.js';

export const TUNING = {
  statScale: 46,      // 屬性對傷害的加成除數
  atkScale: 68,       // 攻擊力對傷害的加成除數
  defSoak: 250,       // 防禦減傷常數
  variance: 0.12,     // 傷害浮動 ±
  weaponMatch: 1.18,  // 兵器與武功相合
  weaponMismatch: 0.72, // 使兵器武功卻無對應兵器
  critChance: 0.08,
  critMult: 1.6,
  moveBase: 3,
  moveDiv: 26,
  moveCap: 9,
  apThreshold: 100,
};

const WEAPON_KINDS = ['sword', 'blade', 'staff'];

// ── 衍算屬性：基礎 + 裝備 + 內功被動 ──
export function derived(c) {
  const d = {
    hp: c.hp, mp: c.mp, atk: c.atk, def: c.def, qinggong: c.qinggong,
    fist: c.fist, sword: c.sword, blade: c.blade, special: c.special,
    hidden: c.hidden, medicine: c.medicine, poison: c.poison, poisonRes: c.poisonRes,
  };
  for (const s of c.skills) {
    const sk = SKILL_BY_ID[s.id];
    if (sk && sk.passive) {
      for (const k in sk.passive) d[k] = (d[k] || 0) + sk.passive[k] * s.lvl;
    }
  }
  for (const slot of ['weapon', 'armor', 'accessory']) {
    const it = ITEM_BY_ID[c.equip?.[slot]];
    if (it?.mods) for (const k in it.mods) d[k] = (d[k] || 0) + it.mods[k];
  }
  for (const k in d) d[k] = Math.max(0, Math.round(d[k]));
  d.maxHp = d.hp; d.maxMp = d.mp;
  return d;
}

export function maxHp(c) { return derived(c).maxHp; }
export function maxMp(c) { return derived(c).maxMp; }

export function moveRange(c) {
  const q = derived(c).qinggong;
  return Math.min(TUNING.moveCap, TUNING.moveBase + Math.floor(q / TUNING.moveDiv));
}

function weaponKindOf(c) {
  const w = ITEM_BY_ID[c.equip?.weapon];
  return w?.wkind || null;
}

// 兵器是否配得上這門武功
function weaponFactor(c, sk) {
  if (!WEAPON_KINDS.includes(sk.kind)) return 1;
  const wk = weaponKindOf(c);
  if (wk === sk.kind) return TUNING.weaponMatch;
  if (!wk) return TUNING.weaponMismatch;
  return 1;
}

export const BASIC_ATTACK = {
  id: '_basic', name: '普通攻擊', kind: 'basic', mp: 0,
  base: 10, power: 4, rmin: 1, rmax: 1, shape: 'point',
  desc: '不使武功，一拳一腳或就手兵器。',
};

function statForSkill(D, sk, c) {
  if (sk.kind === 'basic') {
    const wk = weaponKindOf(c);
    return wk ? D[wk === 'staff' ? 'special' : wk] : D.fist;
  }
  const key = KIND_STAT[sk.kind];
  return key ? (D[key] || 0) : 0;
}

// ── 傷害 ──
// 回傳 {dmg, crit}
export function computeDamage(attacker, defender, sk, lvl, rng, mods = {}) {
  const A = derived(attacker), D = derived(defender);
  const stat = statForSkill(A, sk, attacker);
  let raw = (sk.base || 0) + (sk.power || 0) * lvl;
  // 野球拳彩蛋：練至九、十層威力暴漲
  if (sk.id === 'yeqiu' && lvl >= 9) raw *= lvl >= 10 ? 5.8 : 2.4;

  let power = raw * (1 + stat / TUNING.statScale) * (1 + A.atk / TUNING.atkScale);
  power *= weaponFactor(attacker, sk);

  const pierce = sk.pierce || 0;
  const defv = D.def * (1 - pierce);
  power *= TUNING.defSoak / (TUNING.defSoak + defv);

  if (mods.guard) power *= 1 - mods.guard;
  if (mods.weaken) power *= 1 + mods.weaken / 100;
  if (mods.areaFalloff) power *= mods.areaFalloff;

  const crit = rng.chance(TUNING.critChance);
  if (crit) power *= TUNING.critMult;

  power *= 1 + rng.range(-TUNING.variance, TUNING.variance);
  return { dmg: Math.max(1, Math.round(power)), crit };
}

export function computeHeal(healer, sk, lvl) {
  const A = derived(healer);
  const raw = (sk.base || 0) + (sk.power || 0) * lvl;
  return Math.max(1, Math.round(raw * (1 + A.medicine / 40)));
}

export function poisonTick(source, victim, power) {
  const S = source ? derived(source) : { poison: 0 };
  const V = derived(victim);
  const v = power * (1 + S.poison / 70) * Math.max(0.1, 1 - V.poisonRes / 140);
  return Math.max(1, Math.round(v));
}

export function effectChance(source, victim, base) {
  const V = derived(victim);
  return Math.max(0.05, base * Math.max(0.15, 1 - V.poisonRes / 220));
}

// ── 成長 ──
export function expToNext(lvl) { return Math.round(60 * Math.pow(lvl, 1.7)); }

export function battleExp(enemies) {
  return enemies.reduce((n, e) => n + Math.round(34 * Math.pow(e.lvl, 1.35)), 0);
}

const GROW_KEYS = ['fist', 'sword', 'blade', 'special', 'hidden', 'medicine'];

// 依角色已練的武功類別決定成長偏向
export function levelUp(c, rng) {
  c.lvl += 1;
  const g = [];
  const bump = (k, v) => { c[k] += v; g.push([k, v]); };
  bump('hp', rng.irange(9, 18));
  bump('mp', rng.irange(5, 12));
  bump('atk', rng.irange(2, 4));
  bump('def', rng.irange(2, 4));
  if (rng.chance(0.6)) bump('qinggong', 1);
  const kinds = new Set(c.skills.map(s => SKILL_BY_ID[s.id]?.kind).filter(Boolean));
  const pool = GROW_KEYS.filter(k => kinds.has(k === 'special' ? 'staff' : k === 'medicine' ? 'heal' : k));
  const target = pool.length ? rng.pick(pool) : rng.pick(GROW_KEYS);
  bump(target, rng.irange(2, 4));
  return g;
}

export function gainExp(c, amount, rng) {
  c.exp = (c.exp || 0) + amount;
  const ups = [];
  while (c.exp >= expToNext(c.lvl) && c.lvl < 40) {
    c.exp -= expToNext(c.lvl);
    ups.push(levelUp(c, rng));
  }
  return ups;
}

// ── 武功習得與精進 ──
export function canLearn(c, skId) {
  const sk = skill(skId);
  if (c.skills.some(s => s.id === skId)) return { ok: false, why: '已經學會了。' };
  if (c.skills.length >= 10) return { ok: false, why: '所學武功已達十門，貪多嚼不爛。' };
  if (c.apt < sk.apt) return { ok: false, why: `資質不足（需 ${sk.apt}，你只有 ${c.apt}）。` };
  return { ok: true };
}

export function learn(c, skId) {
  const r = canLearn(c, skId);
  if (!r.ok) return r;
  c.skills.push({ id: skId, lvl: 1, exp: 0 });
  return { ok: true };
}

export function skillExpToNext(lvl) { return Math.round(14 * Math.pow(lvl, 1.55)); }

export function gainSkillExp(c, skId, amount) {
  const s = c.skills.find(x => x.id === skId);
  if (!s || s.lvl >= 10) return null;
  s.exp = (s.exp || 0) + amount;
  let up = 0;
  while (s.lvl < 10 && s.exp >= skillExpToNext(s.lvl)) {
    s.exp -= skillExpToNext(s.lvl);
    s.lvl += 1; up += 1;
  }
  return up ? { id: skId, lvl: s.lvl } : null;
}

// 打坐練功：提升內功等級
export function meditate(c, rng) {
  const internals = c.skills.filter(s => SKILL_BY_ID[s.id]?.kind === 'internal');
  if (!internals.length) return { ok: false, why: '未習內功，無從運氣。' };
  const s = internals.reduce((a, b) => (a.lvl <= b.lvl ? a : b));
  const gain = Math.round(rng.irange(6, 12) * (1 + c.apt / 120));
  const up = gainSkillExp(c, s.id, gain);
  return { ok: true, skill: s.id, gain, up };
}

export function usableSkills(c) {
  return c.skills
    .map(s => ({ s, sk: SKILL_BY_ID[s.id] }))
    .filter(x => x.sk && x.sk.kind !== 'internal');
}
