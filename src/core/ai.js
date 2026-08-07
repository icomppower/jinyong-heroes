// 戰鬥 AI：敵方自動行動，也供無頭平衡測試驅動雙方。
// 評分不使用戰鬥亂數（確定性），只在真正出招時才動到 b.rng。

import {
  advance, reachable, moveTo, useSkill, rest, endTurn, unitAt, alive,
  affectedTiles, inRange, canUse, statusPower, dist, checkOver, tryFlee,
} from './battle.js';
import { SKILL_BY_ID } from '../data/skills.js';
import { derived, computeDamage, computeHeal, BASIC_ATTACK } from './rules.js';
import { RNG } from './rng.js';

const FLAT = new RNG(1);
// 無亂數的傷害估計
function estimate(attacker, defender, sk, lvl, mods) {
  const r = { chance: () => false, range: () => 0, next: () => 0.5, int: () => 0 };
  return computeDamage(attacker, defender, sk, lvl, r, mods).dmg;
}

function skillList(u) {
  const out = [{ id: '_basic', sk: BASIC_ATTACK, lvl: 1 }];
  for (const s of u.char.skills) {
    const sk = SKILL_BY_ID[s.id];
    if (sk && sk.kind !== 'internal') out.push({ id: s.id, sk, lvl: s.lvl });
  }
  return out;
}

function scoreAction(b, u, entry, tx, ty) {
  const { sk, lvl } = entry;
  const tiles = affectedTiles(b, u, sk, tx, ty);
  let score = 0;
  for (const t of tiles) {
    const v = unitAt(b, t.x, t.y);
    if (!v) continue;
    if (sk.kind === 'heal') {
      if (v.side !== u.side) continue;
      const amt = Math.min(computeHeal(u.char, sk, lvl), v.maxHp - v.hp);
      score += amt * 1.35;
      if (v.hp / v.maxHp < 0.3) score += amt * 0.9;
      continue;
    }
    if (sk.shape === 'self') { score += 24 + lvl * 4; continue; }
    if (v.side === u.side) { score -= 999; continue; }
    const mods = { guard: statusPower(v, 'guard'), weaken: statusPower(v, 'weaken'), areaFalloff: t.falloff };
    const dmg = estimate(u.char, v.char, sk, lvl, mods);
    const eff = Math.min(dmg, v.hp);
    score += eff;
    if (dmg >= v.hp) score += 55;                       // 收人頭
    if (sk.effect && sk.effect.type === 'poison') score += (sk.effect.power || 0) * 1.2;
    if (sk.effect && sk.effect.type === 'stun') score += 22;
    if (sk.drain) score += eff * sk.drain;
  }
  if (score <= 0) return -Infinity;
  // 內力昂貴的招式在敵人殘血時不划算
  score -= (sk.mp || 0) * 0.35;
  if (sk.recoil) score -= (sk.base + sk.power * lvl) * sk.recoil;
  return score;
}

// 為單位挑一個行動並執行。回傳描述用的動作紀錄。
export function aiAct(b, u) {
  const foes = alive(b, u.side === 'ally' ? 'enemy' : 'ally');
  if (!foes.length) { endTurn(b, u); return { kind: 'none' }; }

  const skills = skillList(u).filter(e => canUse(b, u, e.id));
  const spots = [{ x: u.x, y: u.y, cost: 0 }, ...reachable(b, u)];

  // 治療優先：己方有人低於三成血且我會醫術
  const healEntry = skills.find(e => e.sk.kind === 'heal');
  let best = null;

  for (const spot of spots) {
    const save = { x: u.x, y: u.y };
    u.x = spot.x; u.y = spot.y;
    const centers = new Map();
    const consider = (x, y) => { centers.set(x + ',' + y, { x, y }); };
    for (const f of foes) {
      consider(f.x, f.y);
      // 範圍招式：也試敵人四周，可能一次罩住多人
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) consider(f.x + dx, f.y + dy);
    }
    if (healEntry) for (const a of alive(b, u.side)) consider(a.x, a.y);
    for (const entry of skills) {
      if (entry.sk.shape === 'self') {
        const s = scoreAction(b, u, entry, u.x, u.y) - spot.cost * 0.4;
        if (s > -Infinity && (!best || s > best.score)) best = { score: s, spot, entry, tx: u.x, ty: u.y };
        continue;
      }
      for (const c of centers.values()) {
        if (!inRange(u, entry.sk, c.x, c.y)) continue;
        const s = scoreAction(b, u, entry, c.x, c.y) - spot.cost * 0.4;
        if (s > -Infinity && (!best || s > best.score)) best = { score: s, spot, entry, tx: c.x, ty: c.y };
      }
    }
    u.x = save.x; u.y = save.y;
  }

  if (best) {
    if (best.spot.cost > 0) moveTo(b, u, best.spot.x, best.spot.y);
    const r = useSkill(b, u, best.entry.id, best.tx, best.ty);
    if (!u.acted && !b.over && !u.down) return { kind: 'extra', ...r }; // 快招再動
    if (!b.over) endTurn(b, u);
    return { kind: 'attack', skill: best.entry.id, ...r };
  }

  // 打不到人：往最近的敵人靠
  const target = foes.reduce((a, c) => (dist(u, c) < dist(u, a) ? c : a));
  const spots2 = reachable(b, u);
  if (spots2.length) {
    let bestSpot = null, bestD = dist(u, target);
    for (const s of spots2) {
      const d = Math.abs(s.x - target.x) + Math.abs(s.y - target.y) + s.cost * 0.05;
      if (d < bestD) { bestD = d; bestSpot = s; }
    }
    if (bestSpot) moveTo(b, u, bestSpot.x, bestSpot.y);
  }
  // 站定調息
  if (u.mp < u.maxMp * 0.5 || u.hp < u.maxHp * 0.5) rest(b, u);
  endTurn(b, u);
  return { kind: 'approach' };
}

// 無頭跑完整場戰鬥（雙方 AI）。回傳結果統計。
export function autoBattle(b, maxSteps = 4000) {
  let steps = 0;
  while (!b.over && steps++ < maxSteps) {
    const u = advance(b);
    if (!u) break;
    aiAct(b, u);
    checkOver(b);
  }
  const survivors = alive(b, 'ally');
  return {
    result: b.over || 'timeout',
    rounds: b.round,
    steps,
    allySurvivors: survivors.length,
    allyHpPct: survivors.length
      ? survivors.reduce((n, u) => n + u.hp / u.maxHp, 0) / survivors.length
      : 0,
    enemySurvivors: alive(b, 'enemy').length,
  };
}
