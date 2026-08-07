// 戰鬥引擎：方格戰棋，行動值（AP）排序，移動＋出招。
// 純資料運算，不依賴瀏覽器；tools/verify.mjs 直接跑它做平衡驗證。

import { RNG } from './rng.js';
import { SKILL_BY_ID } from '../data/skills.js';
import { ITEM_BY_ID } from '../data/items.js';
import {
  derived, moveRange, computeDamage, computeHeal, poisonTick, effectChance,
  gainSkillExp, BASIC_ATTACK, TUNING,
} from './rules.js';

export const TERRAIN = { OPEN: 0, ROUGH: 1, BLOCK: 2, WATER: 3 };
const COST = { 0: 1, 1: 2, 2: Infinity, 3: Infinity };

export function makeGrid(w, h, seed, density = 0.1) {
  const rng = new RNG(seed);
  const t = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = rng.next();
    t[i] = r < density * 0.45 ? TERRAIN.BLOCK : r < density ? TERRAIN.ROUGH : TERRAIN.OPEN;
  }
  // 出生區淨空
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x < 2 || x >= w - 2) t[y * w + x] = TERRAIN.OPEN;
    }
  }
  return { w, h, t };
}

export function tileAt(g, x, y) {
  if (x < 0 || y < 0 || x >= g.w || y >= g.h) return TERRAIN.BLOCK;
  return g.t[y * g.w + x];
}

function skillOf(id) { return id === '_basic' ? BASIC_ATTACK : SKILL_BY_ID[id]; }

export function createBattle(opts) {
  const {
    allies, enemies, seed = 1, w = 15, h = 13, density = 0.12,
    name = '遭遇戰', canFlee = true, onWinRecruit = null,
  } = opts;
  const rng = new RNG(seed);
  const grid = makeGrid(w, h, seed * 7919 + 13, density);
  const units = [];
  let uid = 0;

  const place = (chars, side) => {
    const col = side === 'ally' ? 1 : w - 2;
    const startY = Math.max(0, Math.floor((h - chars.length * 2) / 2));
    chars.forEach((c, i) => {
      let y = startY + i * 2, x = col;
      let guard = 0;
      while ((tileAt(grid, x, y) === TERRAIN.BLOCK || units.some(u => u.x === x && u.y === y)) && guard++ < 200) {
        y = (y + 1) % h;
        if (y === 0) x += side === 'ally' ? 1 : -1;
      }
      const D = derived(c);
      units.push({
        uid: uid++, side, char: c, x, y,
        hp: c.curHp != null ? Math.min(c.curHp, D.maxHp) : D.maxHp,
        mp: c.curMp != null ? Math.min(c.curMp, D.maxMp) : D.maxMp,
        maxHp: D.maxHp, maxMp: D.maxMp,
        ap: rng.int(30), statuses: [], down: false,
        moved: false, acted: false, skillUse: {},
      });
    });
  };
  place(allies, 'ally');
  place(enemies, 'enemy');

  return {
    name, grid, units, rng, round: 1, over: null, log: [],
    active: null, canFlee, onWinRecruit, fled: false,
    stats: { rounds: 0, dmgByAlly: 0, dmgByEnemy: 0, actions: 0 },
  };
}

export function alive(b, side) { return b.units.filter(u => u.side === side && !u.down); }
export function unitAt(b, x, y) { return b.units.find(u => !u.down && u.x === x && u.y === y); }
export function log(b, msg) { b.log.push(msg); if (b.log.length > 400) b.log.shift(); }

// ── 行動值推進：回傳下一個該行動的單位 ──
export function advance(b) {
  if (b.over) return null;
  let guard = 0;
  while (guard++ < 100000) {
    const ready = b.units.filter(u => !u.down && u.ap >= TUNING.apThreshold);
    if (ready.length) {
      ready.sort((a, c) => c.ap - a.ap || derived(c.char).qinggong - derived(a.char).qinggong || a.uid - c.uid);
      const u = ready[0];
      u.ap -= TUNING.apThreshold;
      u.moved = false; u.acted = false; u.extraUsed = false;
      b.active = u;
      startTurn(b, u);
      if (u.down) { b.active = null; if (checkOver(b)) return null; continue; }
      if (hasStatus(u, 'stun')) {
        log(b, `${u.char.name} 動彈不得。`);
        b.active = null;
        continue;
      }
      return u;
    }
    for (const u of b.units) if (!u.down) u.ap += Math.max(8, derived(u.char).qinggong);
    b.round++; b.stats.rounds++;
    if (b.round > 200) { b.over = 'draw'; return null; }
  }
  b.over = 'draw';
  return null;
}

function startTurn(b, u) {
  // 狀態結算
  for (const st of u.statuses.slice()) {
    if (st.type === 'poison') {
      const dmg = poisonTick(st.src, u.char, st.power);
      applyDamage(b, u, dmg, null);
      log(b, `${u.char.name} 毒發，受 ${dmg} 點傷害。`);
    }
    st.turns--;
    if (st.turns <= 0) u.statuses = u.statuses.filter(s => s !== st);
  }
  // 回氣
  if (!u.down) u.mp = Math.min(u.maxMp, u.mp + Math.max(1, Math.round(u.maxMp * 0.03)));
}

export function hasStatus(u, type) { return u.statuses.some(s => s.type === type); }
export function statusPower(u, type) {
  return u.statuses.filter(s => s.type === type).reduce((n, s) => n + s.power, 0);
}
export function addStatus(u, type, power, turns, src) {
  const ex = u.statuses.find(s => s.type === type);
  if (ex) { ex.turns = Math.max(ex.turns, turns); ex.power = Math.max(ex.power, power); ex.src = src || ex.src; }
  else u.statuses.push({ type, power, turns, src });
}

// ── 移動 ──
export function reachable(b, u) {
  const g = b.grid;
  const budget = moveRange(u.char);
  const dist = new Map();
  const key = (x, y) => y * g.w + x;
  dist.set(key(u.x, u.y), 0);
  const q = [[u.x, u.y, 0]];
  const out = [];
  while (q.length) {
    q.sort((a, c) => a[2] - c[2]);
    const [x, y, d] = q.shift();
    if (d > (dist.get(key(x, y)) ?? Infinity)) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
      const c = COST[tileAt(g, nx, ny)];
      if (!isFinite(c)) continue;
      const occ = unitAt(b, nx, ny);
      if (occ && occ !== u) continue;
      const nd = d + c;
      if (nd > budget) continue;
      if (nd < (dist.get(key(nx, ny)) ?? Infinity)) {
        dist.set(key(nx, ny), nd);
        q.push([nx, ny, nd]);
      }
    }
  }
  for (const [k, d] of dist) {
    if (d === 0) continue;
    out.push({ x: k % g.w, y: Math.floor(k / g.w), cost: d });
  }
  return out;
}

export function moveTo(b, u, x, y) {
  if (u.moved) return false;
  const ok = reachable(b, u).some(t => t.x === x && t.y === y);
  if (!ok) return false;
  u.x = x; u.y = y; u.moved = true;
  return true;
}

export const dist = (a, c) => Math.abs(a.x - c.x) + Math.abs(a.y - c.y);

// ── 施展範圍 ──
export function inRange(u, sk, x, y) {
  const d = Math.abs(u.x - x) + Math.abs(u.y - y);
  if (sk.shape === 'self') return x === u.x && y === u.y;
  return d >= (sk.rmin ?? 1) && d <= (sk.rmax ?? 1);
}

export function affectedTiles(b, u, sk, tx, ty) {
  const g = b.grid;
  const out = [];
  const push = (x, y, f) => {
    if (x < 0 || y < 0 || x >= g.w || y >= g.h) return;
    if (!out.some(t => t.x === x && t.y === y)) out.push({ x, y, falloff: f });
  };
  const a = sk.area || 1;
  switch (sk.shape) {
    case 'self': push(u.x, u.y, 1); break;
    case 'burst':
      for (let dx = -a; dx <= a; dx++) for (let dy = -a; dy <= a; dy++) {
        const d = Math.abs(dx) + Math.abs(dy);
        if (d <= a) push(tx + dx, ty + dy, d === 0 ? 1 : 0.72);
      }
      break;
    case 'cross':
      push(tx, ty, 1);
      for (let i = 1; i <= a; i++) {
        push(tx + i, ty, 0.72); push(tx - i, ty, 0.72);
        push(tx, ty + i, 0.72); push(tx, ty - i, 0.72);
      }
      break;
    case 'line': {
      let dx = Math.sign(tx - u.x), dy = Math.sign(ty - u.y);
      if (dx && dy) { if (Math.abs(tx - u.x) >= Math.abs(ty - u.y)) dy = 0; else dx = 0; }
      if (!dx && !dy) dx = 1;
      for (let i = 1; i <= a; i++) push(u.x + dx * i, u.y + dy * i, i === 1 ? 1 : 0.85);
      push(tx, ty, 1);
      break;
    }
    default: push(tx, ty, 1);
  }
  return out;
}

export function skillTargets(b, u, sk) {
  const g = b.grid;
  const out = [];
  if (sk.shape === 'self') return [{ x: u.x, y: u.y }];
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    if (inRange(u, sk, x, y)) out.push({ x, y });
  }
  return out;
}

export function canUse(b, u, skId) {
  const sk = skillOf(skId);
  if (!sk) return false;
  if (sk.kind === 'internal') return false;
  const lv = skLevel(u, skId);
  if (skId !== '_basic' && !lv) return false;
  return u.mp >= (sk.mp || 0);
}

function skLevel(u, skId) {
  if (skId === '_basic') return 1;
  return u.char.skills.find(s => s.id === skId)?.lvl || 0;
}

export function applyDamage(b, u, dmg, srcUnit) {
  u.hp -= dmg;
  if (srcUnit) {
    if (srcUnit.side === 'ally') b.stats.dmgByAlly += dmg; else b.stats.dmgByEnemy += dmg;
  }
  if (u.hp <= 0) {
    u.hp = 0; u.down = true;
    log(b, `${u.char.name} 倒下了！`);
  }
}

// ── 出招 ──
export function useSkill(b, u, skId, tx, ty) {
  const sk = skillOf(skId);
  if (!sk || u.acted || !canUse(b, u, skId)) return { ok: false };
  if (!inRange(u, sk, tx, ty)) return { ok: false };

  const lvl = skLevel(u, skId);
  u.mp -= sk.mp || 0;
  u.acted = true;
  b.stats.actions++;
  const events = [];
  const tiles = affectedTiles(b, u, sk, tx, ty);
  const isHeal = sk.kind === 'heal';

  log(b, `${u.char.name} 施展【${sk.name}】${lvl > 1 ? ` ${lvl}層` : ''}。`);

  let hits = 0;
  for (const t of tiles) {
    const v = unitAt(b, t.x, t.y);
    if (!v) continue;
    if (isHeal) {
      if (v.side !== u.side) continue;
      const amt = computeHeal(u.char, sk, lvl);
      v.hp = Math.min(v.maxHp, v.hp + amt);
      hits++;
      events.push({ type: 'heal', x: t.x, y: t.y, amount: amt });
      log(b, `　${v.char.name} 回復 ${amt} 點氣血。`);
      continue;
    }
    if (sk.shape === 'self') {
      if (sk.effect) {
        addStatus(u, sk.effect.type, sk.effect.power, sk.effect.turns, u.char);
        events.push({ type: 'buff', x: u.x, y: u.y, name: sk.name });
        log(b, `　${u.char.name} 運起護身之力。`);
      }
      hits++;
      continue;
    }
    if (v.side === u.side) continue;
    hits++;

    const mods = {
      guard: statusPower(v, 'guard'),
      weaken: statusPower(v, 'weaken'),
      areaFalloff: t.falloff,
    };
    const { dmg, crit } = computeDamage(u.char, v.char, sk, lvl, b.rng, mods);
    applyDamage(b, v, dmg, u);
    events.push({ type: 'hit', x: t.x, y: t.y, amount: dmg, crit });
    log(b, `　${v.char.name} 受 ${dmg} 點傷害${crit ? '（正中要害！）' : ''}。`);

    // 吸血 / 反噬 / 附加狀態
    if (sk.drain) {
      const heal = Math.round(dmg * sk.drain);
      u.hp = Math.min(u.maxHp, u.hp + heal);
      log(b, `　${u.char.name} 吸取 ${heal} 點氣血。`);
    }
    if (sk.effect && !v.down) {
      const ch = effectChance(u.char, v.char, sk.effect.chance);
      if (b.rng.chance(ch)) {
        addStatus(v, sk.effect.type, sk.effect.power || 0, sk.effect.turns || 2, u.char);
        const nm = { poison: '中毒', stun: '被制住', weaken: '筋骨受損', mpdrain: '真氣渙散', reflect: '', guard: '' };
        if (sk.effect.type === 'mpdrain') {
          const drain = Math.min(v.mp, sk.effect.power);
          v.mp -= drain; u.mp = Math.min(u.maxMp, u.mp + Math.round(drain * 0.6));
          v.statuses = v.statuses.filter(s => s.type !== 'mpdrain');
          log(b, `　${v.char.name} 內力被吸去 ${drain} 點。`);
        } else if (nm[sk.effect.type]) {
          log(b, `　${v.char.name} ${nm[sk.effect.type]}！`);
        }
      }
    }
    // 反震
    const refl = statusPower(v, 'reflect');
    if (refl > 0 && !v.down) {
      const back = Math.round(dmg * refl);
      applyDamage(b, u, back, v);
      log(b, `　${v.char.name} 借力打力，反震 ${back} 點！`);
    }
  }

  if (sk.recoil) {
    const self = Math.round((sk.base + sk.power * lvl) * sk.recoil);
    applyDamage(b, u, self, null);
    log(b, `　${u.char.name} 拳力反噬，自傷 ${self} 點。`);
  }

  if (hits && skId !== '_basic') {
    const up = gainSkillExp(u.char, skId, 2 + Math.floor(lvl / 3));
    if (up) log(b, `　${u.char.name} 的【${sk.name}】精進至 ${up.lvl} 層！`);
  }
  u.skillUse[skId] = (u.skillUse[skId] || 0) + 1;

  // 快招：有機率立刻再動一次，但一回合最多追加一次，免得一面倒連打
  if (sk.extraTurn && !u.extraUsed && b.rng.chance(sk.extraTurn) && !u.down) {
    u.extraUsed = true;
    u.acted = false; u.moved = false;
    log(b, `　招式如電，${u.char.name} 再進一招！`);
    events.push({ type: 'extra' });
  }

  checkOver(b);
  return { ok: true, events, hits };
}

export function useItem(b, u, itemId, target) {
  const it = ITEM_BY_ID[itemId];
  if (!it || !it.use || u.acted) return { ok: false };
  const v = target || u;
  const use = it.use;
  if (use.hp) { v.hp = Math.min(v.maxHp, v.hp + use.hp); log(b, `${u.char.name} 使用${it.name}，${v.char.name} 回復 ${use.hp} 點氣血。`); }
  if (use.mp) { v.mp = Math.min(v.maxMp, v.mp + use.mp); log(b, `${u.char.name} 使用${it.name}，${v.char.name} 回復 ${use.mp} 點內力。`); }
  if (use.cure) { v.statuses = v.statuses.filter(s => !use.cure.includes(s.type)); log(b, `${v.char.name} 的異狀解除了。`); }
  u.acted = true;
  return { ok: true };
}

export function rest(b, u) {
  u.acted = true; u.moved = true;
  const mp = Math.max(2, Math.round(u.maxMp * 0.12));
  const hp = Math.max(2, Math.round(u.maxHp * 0.06));
  u.mp = Math.min(u.maxMp, u.mp + mp);
  u.hp = Math.min(u.maxHp, u.hp + hp);
  log(b, `${u.char.name} 就地調息，回復 ${hp} 氣血、${mp} 內力。`);
  return { ok: true };
}

export function endTurn(b, u) { u.acted = true; u.moved = true; b.active = null; }

export function checkOver(b) {
  if (b.over) return true;
  if (!alive(b, 'enemy').length) { b.over = 'win'; log(b, '　—— 敵人盡數倒下。'); return true; }
  if (!alive(b, 'ally').length) { b.over = 'lose'; log(b, '　—— 我方全軍覆沒。'); return true; }
  return false;
}

export function tryFlee(b, u) {
  if (!b.canFlee) { log(b, '此戰無路可退！'); return false; }
  const mine = derived(u.char).qinggong;
  const foe = Math.max(...alive(b, 'enemy').map(e => derived(e.char).qinggong), 1);
  // 就算輕功遠遜對手，也總留一線生機
  const p = Math.min(0.92, Math.max(0.18, 0.35 + (mine - foe) / 120));
  if (b.rng.chance(p)) { b.over = 'flee'; b.fled = true; log(b, '你們奪路而逃。'); return true; }
  u.acted = true; u.moved = true;
  log(b, '逃走失敗！');
  return false;
}
