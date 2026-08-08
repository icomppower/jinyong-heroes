// 十五處聚落。**幾何是從格陣長出來的，不是另外手畫的。**
//
// 建物、城牆、城門、門的位置全部讀 data/maps.js 已經蓋好的那張圖：BUILDING／ROOF 的連通塊
// 就是一棟房子，街廓四邊的 WALL 就是城牆，官道為它讓開的那一格就是城門。
// 所以三維世界的拓樸與那張驗過 87 項的圖是同一份，不會各說各話。
//
// 型別、顏色、屋頂、量體才是這一層自己決定的——那是「遠看認得出來」的部分。

import * as THREE from 'three';
import {
  roofGeo, horseHeadGeo, swallowRidgeGeo, wallGeo, merlonGeo, pagodaTierGeo, eaveRingGeo,
  stepGeo, rockGeo, bambooGeo, trunkGeo, broadleafGeo, PALETTES, DISTRICT_PALETTE, mat, place,
} from './kit.js';
import { S, W, H, tx2x, ty2z, T, GEO, PLACE_BY_ID, lerp, clamp } from './field.js';

const RNGS = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return () => { h = (h * 1103515245 + 12345) & 0x7fffffff; return h / 0x7fffffff; }; };

const STOREY = 3.6, ROOF_RATIO = 0.52;

// 每一處聚落的量體個性：房子幾層、主殿多高、有沒有城牆
const PROFILE = {
  yangzhou: { storeys: [2, 2, 3], hall: 9.5, kind: 'city' },      // 商城：牆矮、單城樓、水門
  xiangyang:{ storeys: [1, 2, 2], hall: 10.5, kind: 'fortress' }, // 守城：馬面、甕城、角樓
  shaolin:  { storeys: [1, 2], hall: 13.0, kind: 'temple' },
  wudang:   { storeys: [1, 2], hall: 11.0, kind: 'terrace' },
  huashan:  { storeys: [1, 1], hall: 7.5, kind: 'sect' },
  heimu:    { storeys: [1, 2], hall: 9.0, kind: 'sect' },
  guangming:{ storeys: [1, 1], hall: 8.0, kind: 'sect' },
  tianlong: { storeys: [1, 2], hall: 10.0, kind: 'temple' },
  dongting: { storeys: [1, 2], hall: 8.0, kind: 'sect' },
  wuliang:  { storeys: [1, 1], hall: 6.5, kind: 'wild' },
  gumu:     { storeys: [1, 1], hall: 6.0, kind: 'wild' },
  jueqing:  { storeys: [1, 2], hall: 7.0, kind: 'wild' },
  fuwei:    { storeys: [1, 2], hall: 8.5, kind: 'manor' },
  taohua:   { storeys: [1, 1], hall: 7.0, kind: 'wild' },
  final:    { storeys: [1], hall: 5.0, kind: 'summit' },
};

// ── 連通塊：一塊 BUILDING∪ROOF 就是一棟 ──
function footprints(sc, rect, skip) {
  const seen = new Set();
  const isB = (x, y) => {
    const t = sc.tiles[y * W + x];
    return t === T.BUILDING || t === T.ROOF;
  };
  const out = [];
  for (let y = rect.y0; y <= rect.y1; y++) for (let x = rect.x0; x <= rect.x1; x++) {
    const k = y * W + x;
    if (seen.has(k) || !isB(x, y)) continue;
    if (skip && skip(x, y)) { seen.add(k); continue; }
    const stack = [[x, y]]; seen.add(k);
    let x0 = x, x1 = x, y0 = y, y1 = y, n = 0;
    while (stack.length) {
      const [cx, cy] = stack.pop(); n++;
      x0 = Math.min(x0, cx); x1 = Math.max(x1, cx);
      y0 = Math.min(y0, cy); y1 = Math.max(y1, cy);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < rect.x0 || ny < rect.y0 || nx > rect.x1 || ny > rect.y1) continue;
        const nk = ny * W + nx;
        if (seen.has(nk) || !isB(nx, ny)) continue;
        if (skip && skip(nx, ny)) { seen.add(nk); continue; }
        seen.add(nk); stack.push([nx, ny]);
      }
    }
    out.push({ x0, x1, y0, y1, tiles: n });
  }
  return out;
}

// 一棟房子：台基 → 牆身 → 屋頂 →（江南加馬頭牆／福建加燕尾脊）
function putBuilding(P, geos, pal, palName, o) {
  const { cx, cz, w, d, base, height, roof, rotY, curve } = o;
  const M = geos.mats(palName);
  const plinthH = 0.42;
  P.add('box', geos.box, palName + ':plinth', M.plinth,
    place(cx, base + plinthH / 2, cz, w * 1.10, plinthH, d * 1.10, rotY));
  P.add('box', geos.box, palName + ':wall', M.wall,
    place(cx, base + plinthH + height / 2, cz, w, height, d, rotY));
  const rh = Math.max(1.7, Math.min(w, d) * ROOF_RATIO);
  const rg = geos.roof(roof, curve);
  P.add('roof:' + roof + ':' + curve.toFixed(2), rg, palName + ':tile', M.tile,
    place(cx, base + plinthH + height, cz, w * 1.20, rh, d * 1.24, rotY));
  // 出簷下的那條暗帶——斗拱那一層在行走視距下只讀得到「一條陰影」，就給它一條陰影
  P.add('box', geos.box, palName + ':trim', M.trim,
    place(cx, base + plinthH + height + 0.14, cz, w * 1.13, 0.28, d * 1.17, rotY));
  if (pal.horseHead) {
    for (const sx of [-1, 1]) {
      P.add('horsehead', geos.horseHead, palName + ':wall', M.wall,
        place(cx + Math.cos(rotY) * sx * w / 2, base + plinthH, cz - Math.sin(rotY) * sx * w / 2,
          d * 1.02, height * 0.62 + rh, 1, rotY + Math.PI / 2));
    }
  }
  if (pal.swallow) {
    P.add('swallow', geos.swallow, palName + ':trim', M.trim,
      place(cx, base + plinthH + height + rh * 0.86, cz, w * 1.24, rh * 0.5, 1, rotY));
  }
}

// ── 城牆：街廓四邊的 WALL 連續段。官道讓開的缺口就是城門。 ──
function wallRuns(sc, rect) {
  const runs = [], gates = [];
  const scan = (cells, horiz) => {
    let run = null;
    for (const c of cells) {
      const t = sc.tiles[c.y * W + c.x];
      if (t === T.WALL) { if (!run) run = { a: c, b: c }; else run.b = c; }
      else { if (run) { runs.push({ ...run, horiz }); run = null; } if (t === T.STREET || t === T.ROAD) gates.push({ ...c, horiz }); }
    }
    if (run) runs.push({ ...run, horiz });
  };
  const top = [], bot = [], left = [], right = [];
  for (let x = rect.x0; x <= rect.x1; x++) { top.push({ x, y: rect.y0 }); bot.push({ x, y: rect.y1 }); }
  for (let y = rect.y0; y <= rect.y1; y++) { left.push({ x: rect.x0, y }); right.push({ x: rect.x1, y }); }
  scan(top, true); scan(bot, true); scan(left, false); scan(right, false);
  // 相鄰的門格併成一座城門
  const merged = [];
  for (const g of gates) {
    const near = merged.find(m => m.horiz === g.horiz && Math.abs(m.x - g.x) <= 1 && Math.abs(m.y - g.y) <= 1);
    if (near) { near.x = (near.x + g.x) / 2; near.y = (near.y + g.y) / 2; near.n++; }
    else merged.push({ ...g, n: 1 });
  }
  return { runs, gates: merged };
}

function putWalls(P, geos, palName, sc, rect, groundH, prof) {
  const M = geos.mats(palName);
  const HGT = prof.kind === 'fortress' ? 8.0 : prof.kind === 'city' ? 5.6 : 4.4;
  const THK = prof.kind === 'fortress' ? 5.0 : 3.4;
  const { runs, gates } = wallRuns(sc, rect);
  for (const r of runs) {
    const ax = tx2x(r.a.x), az = ty2z(r.a.y), bx = tx2x(r.b.x), bz = ty2z(r.b.y);
    const len = Math.hypot(bx - ax, bz - az) + S;
    const cx = (ax + bx) / 2, cz = (az + bz) / 2;
    const rotY = r.horiz ? 0 : Math.PI / 2;
    const base = groundH(cx, cz) - 0.4;
    P.add('wall', geos.wall, palName + ':plinth', M.plinth, place(cx, base, cz, len, HGT, THK, rotY));
    // 垛口
    const n = Math.max(2, Math.round(len / 3.2));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const mx = lerp(ax - (r.horiz ? S / 2 : 0), bx + (r.horiz ? S / 2 : 0), t);
      const mz = lerp(az - (r.horiz ? 0 : S / 2), bz + (r.horiz ? 0 : S / 2), t);
      P.add('box', geos.box, palName + ':trim', M.trim,
        place(mx, base + HGT + 0.55, mz, r.horiz ? 1.7 : THK * 0.6, 1.1, r.horiz ? THK * 0.6 : 1.7, 0));
    }
    // 馬面：突出的敵台，守城的城牆才有
    if (prof.kind === 'fortress' && len > 16) {
      const m = Math.max(1, Math.floor(len / 22));
      for (let i = 0; i < m; i++) {
        const t = (i + 0.5) / m;
        const mx = lerp(ax, bx, t), mz = lerp(az, bz, t);
        const outward = r.horiz
          ? (r.a.y === rect.y0 ? -1 : 1) : (r.a.x === rect.x0 ? -1 : 1);
        const ox = r.horiz ? 0 : outward * THK * 0.75, oz = r.horiz ? outward * THK * 0.75 : 0;
        P.add('wall', geos.wall, palName + ':plinth', M.plinth,
          place(mx + ox, base, mz + oz, r.horiz ? 7 : THK * 1.5, HGT, r.horiz ? THK * 1.5 : 7, rotY));
      }
    }
  }
  // 城門樓
  for (const g of gates) {
    const gx = tx2x(g.x), gz = ty2z(g.y);
    const base = groundH(gx, gz);
    const wdt = Math.max(7, g.n * S + 5);
    // 門洞兩側的墩
    for (const s of [-1, 1]) {
      const ox = g.horiz ? s * (wdt / 2 + 1.4) : 0, oz = g.horiz ? 0 : s * (wdt / 2 + 1.4);
      P.add('wall', geos.wall, palName + ':plinth', M.plinth,
        place(gx + ox, base - 0.4, gz + oz, g.horiz ? 4 : THK, HGT, g.horiz ? THK : 4, g.horiz ? 0 : Math.PI / 2));
    }
    // 門楣與城樓（歇山頂——主力屋頂）
    P.add('box', geos.box, palName + ':plinth', M.plinth,
      place(gx, base + HGT - 0.9, gz, g.horiz ? wdt + 4 : THK, 1.8, g.horiz ? THK : wdt + 4, 0));
    const tw = g.horiz ? wdt + 2 : THK * 1.5, td = g.horiz ? THK * 1.5 : wdt + 2;
    P.add('box', geos.box, palName + ':wall', M.wall,
      place(gx, base + HGT + 2.1, gz, tw, 4.2, td, 0));
    P.add('roof:xieshan:1.55', geos.roof('xieshan', 1.55), palName + ':tile', M.tile,
      place(gx, base + HGT + 4.2, gz, tw * 1.32, 3.4, td * 1.36, 0));
  }
  return gates;
}

// ══════════════════════════════════════════════════════════
// 四個非手建不可的英雄輪廓
// ══════════════════════════════════════════════════════════

// 少林塔林：存世 241 座磚石墓塔，一到七層、全部低於十五公尺。
// 撒四十到八十座就有「林」的感覺，不必真做兩百四。⚠️ 預算側先削數量，不要削屋頂種類。
function stupaForest(P, geos, groundH, cx, cz, count = 56) {
  const M = geos.mats('grey');
  const rnd = RNGS('talin');
  for (let i = 0; i < count; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 15;
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r * 0.8;
    const base = groundH(x, z);
    const tiers = 1 + Math.floor(Math.pow(rnd(), 0.8) * 6);          // 偏三到五
    const sides = rnd() < 0.45 ? 6 : 4;
    const bw = 1.5 + rnd() * 0.9, tilt = (rnd() - 0.5) * 0.05;
    let y = base;
    P.add('box', geos.box, 'grey:plinth', M.plinth, place(x, y + 0.25, z, bw * 1.5, 0.5, bw * 1.5, a));
    y += 0.5;
    for (let t = 0; t < tiers; t++) {
      const f = 1 - t / (tiers + 1.2) * 0.42, th = 1.05 - t * 0.05;
      P.add('pagoda' + sides, geos.tier(sides), 'grey:wall', M.wall,
        place(x + tilt * t, y, z, bw * f, th, bw * f, a));
      P.add('eave' + sides, geos.eave(sides), 'grey:tile', M.tile,
        place(x + tilt * t, y + th, z, bw * f * 1.12, 0.3, bw * f * 1.12, a));
      y += th + 0.3;
    }
    P.add('spire', geos.roof('zanjian', 1.4, sides), 'grey:tile', M.tile,
      place(x, y, z, bw * 0.9, 1.5 + rnd() * 0.7, bw * 0.9, a));
  }
  return count;
}

// 大理三塔：中塔方形十六層密簷，兩座側塔八角十層，全白，成三角。
// 外型與任何漢地塔都不同，遠遠就認得出來。
// ⚠️ 真高 69/42 公尺，在 768 公尺見方的世界裡會蓋過 96.9 公尺的華山之巔——
//    這裡壓到 30/19，保住「華山是全圖最高」這條硬規則。比例照舊，絕對值讓步。
function threePagodas(P, geos, groundH, cx, cz) {
  const M = geos.mats('dali');
  const white = geos.matOf(0xf6f3ea, 'dali:white');
  const spec = [
    { dx: 0, dz: 0, h: 30, tiers: 16, sides: 4, bw: 4.2 },
    { dx: -9, dz: 8, h: 19, tiers: 10, sides: 8, bw: 3.0 },
    { dx: 9, dz: 8, h: 19, tiers: 10, sides: 8, bw: 3.0 },
  ];
  for (const s of spec) {
    const x = cx + s.dx, z = cz + s.dz, base = groundH(x, z);
    const th = s.h / (s.tiers + 2);
    P.add('box', geos.box, 'dali:plinth', M.plinth, place(x, base + 0.6, z, s.bw * 1.9, 1.2, s.bw * 1.9, 0));
    let y = base + 1.2;
    for (let t = 0; t < s.tiers; t++) {
      const f = 1 - Math.pow(t / s.tiers, 1.25) * 0.46;
      P.add('pagoda' + s.sides, geos.tier(s.sides), 'dali:white', white,
        place(x, y, z, s.bw * f, th, s.bw * f, 0));
      P.add('eave' + s.sides, geos.eave(s.sides), 'dali:white', white,
        place(x, y + th * 0.82, z, s.bw * f * 1.2, th * 0.3, s.bw * f * 1.2, 0));
      y += th;
    }
    P.add('spire', geos.roof('zanjian', 1.3, s.sides), 'dali:trim', M.trim,
      place(x, y, z, s.bw * 0.62, s.h * 0.11, s.bw * 0.62, 0));
  }
}

// 武當登山：不是平面中軸，是殿宇逐台而上，石階串起來。
// 山頂金殿銅鑄鎏金——換一個金屬材質就買到「山頂有寶」。
function wudangTerraces(P, geos, groundH, cx, cz) {
  const M = geos.mats('wudang');
  const gold = geos.matOf(0xd8a13a, 'gold', { metalness: 0.85, roughness: 0.28, env: 1.0 });
  const rnd = RNGS('wudang');
  let z = cz + 16;
  for (let i = 0; i < 5; i++) {
    const x = cx + (rnd() - 0.5) * 3;
    const base = groundH(x, z);
    const w = 13 - i * 1.2, d = 7.5;
    P.add('box', geos.box, 'wudang:plinth', M.plinth, place(x, base + 0.5, z, w + 5, 1.0, d + 4, 0));
    putBuilding(P, geos, PALETTES.wudang, 'wudang', {
      cx: x, cz: z, w, d, base: base + 1.0, height: 4.6 + i * 0.35,
      roof: i === 4 ? 'xieshan' : 'xuanshan', rotY: 0, curve: 1.6,
    });
    // 石階串起兩台
    const nz = z - 7.5;
    const steps = 9;
    for (let s = 0; s < steps; s++) {
      const t = (s + 0.5) / steps;
      const sz = lerp(z - d / 2 - 0.8, nz + 3, t);
      const sy = lerp(groundH(x, z) + 1.0, groundH(x, nz) + 1.0, t);
      P.add('box', geos.box, 'wudang:plinth', M.plinth, place(x, sy - 0.15, sz, 5.5, 0.34, 1.3, 0));
    }
    z = nz;
  }
  // 山頂金殿
  const gx = cx, gz = z - 2, gb = groundH(gx, gz);
  P.add('box', geos.box, 'wudang:plinth', M.plinth, place(gx, gb + 0.9, gz, 11, 1.8, 9, 0));
  P.add('box', geos.box, 'gold', gold, place(gx, gb + 1.8 + 2.6, gz, 6.0, 5.2, 5.0, 0));
  P.add('roof:wudian:1.6', geos.roof('wudian', 1.6), 'gold', gold,
    place(gx, gb + 1.8 + 5.2, gz, 7.6, 3.4, 6.6, 0));
}

// 襄陽：夯土包青磚的守城。收分、垛口、馬面、角樓在 putWalls 裡；這裡加甕城——
// 吊橋 → 箭樓 → 困人的甕城院 → 內城樓。
// ⚠️ 護城河真寬 130–250 公尺，是湖不是溝；本作整座襄陽只有 68×52 公尺，
//    照比例畫護城河會把城淹掉。這裡做成一道 14 公尺寬的水面，並記下這筆帳。
function barbican(P, geos, groundH, gate, dir) {
  const M = geos.mats('grey');
  const D = 13, WID = 17, HGT = 8.0, THK = 3.6;
  const ox = dir.x * D / 2, oz = dir.z * D / 2;
  const cx = gate.x + ox, cz = gate.z + oz;
  const base = groundH(cx, cz) - 0.4;
  // 甕城三面牆
  const sides = [
    { x: cx + dir.x * D / 2, z: cz + dir.z * D / 2, w: WID, rot: dir.x ? Math.PI / 2 : 0 },
    { x: cx + dir.z * WID / 2, z: cz + dir.x * WID / 2, w: D, rot: dir.x ? 0 : Math.PI / 2 },
    { x: cx - dir.z * WID / 2, z: cz - dir.x * WID / 2, w: D, rot: dir.x ? 0 : Math.PI / 2 },
  ];
  for (const s of sides) {
    P.add('wall', geos.wall, 'grey:plinth', M.plinth, place(s.x, base, s.z, s.w, HGT, THK, s.rot));
  }
  // 箭樓
  const ax = cx + dir.x * D / 2, az = cz + dir.z * D / 2;
  P.add('box', geos.box, 'grey:wall', M.wall, place(ax, base + HGT + 2.4, az, dir.x ? THK * 1.6 : 12, 4.8, dir.x ? 12 : THK * 1.6, 0));
  P.add('roof:xieshan:1.5', geos.roof('xieshan', 1.5), 'grey:tile', M.tile,
    place(ax, base + HGT + 4.8, az, dir.x ? THK * 2.1 : 15, 3.6, dir.x ? 15 : THK * 2.1, 0));
}

// ══════════════════════════════════════════════════════════
// 主入口
// ══════════════════════════════════════════════════════════
export function buildSettlements(ctx) {
  const { scene, pool: P, field, groundH, sc } = ctx;

  // 幾何與材質共用池——同一個 key 只做一次
  const cacheG = new Map(), cacheM = new Map();
  const geos = {
    box: new THREE.BoxGeometry(1, 1, 1),
    wall: wallGeo(0.24),
    horseHead: horseHeadGeo(3),
    swallow: swallowRidgeGeo(),
    roof(kind, curve, sides = 4) {
      const k = `${kind}:${curve.toFixed(2)}:${sides}`;
      if (!cacheG.has(k)) cacheG.set(k, roofGeo(kind, { curve, sides }));
      return cacheG.get(k);
    },
    tier(sides) { const k = 'tier' + sides; if (!cacheG.has(k)) cacheG.set(k, pagodaTierGeo(sides)); return cacheG.get(k); },
    eave(sides) { const k = 'eave' + sides; if (!cacheG.has(k)) cacheG.set(k, eaveRingGeo(sides)); return cacheG.get(k); },
    matOf(color, key, opt) { if (!cacheM.has(key)) cacheM.set(key, mat(color, opt)); return cacheM.get(key); },
    mats(palName) {
      const k = 'pal:' + palName;
      if (!cacheM.has(k)) {
        const p = PALETTES[palName];
        cacheM.set(k, {
          wall: this.matOf(p.wall, palName + ':wall'),
          trim: this.matOf(p.trim, palName + ':trim'),
          tile: this.matOf(p.tile, palName + ':tile', { roughness: 0.78, env: 0.34 }),
          plinth: this.matOf(p.plinth, palName + ':plinth'),
        });
      }
      return cacheM.get(k);
    },
  };

  const stats = { buildings: 0, gates: 0, walls: 0, stupas: 0, doors: 0 };
  // 英雄輪廓自己蓋，通用流程要讓開這幾塊
  const heroZones = [];
  const heroAt = (locId, name, r) => {
    const lm = GEO.LANDMARKS.find(l => l.loc === locId && l.name === name);
    if (!lm) return null;
    const d = GEO.DISTRICT_BY_ID[locId];
    const gx = d.cx + lm.dx, gy = d.cy + lm.dy;
    const z = { gx, gy, x: tx2x(gx), z: ty2z(gy), r };
    heroZones.push(z);
    return z;
  };
  const TALIN = heroAt('shaolin', '塔林', 9);
  const SANTA = heroAt('tianlong', '三塔', 9);
  const ZIXIAO = heroAt('wudang', '紫霄宮', 8);
  const HUOTAN = heroAt('guangming', '聖火壇', 6);
  const inHero = (gx, gy) => heroZones.some(h => Math.hypot(gx - h.gx, gy - h.gy) <= h.r);

  for (const d of GEO.DISTRICTS) {
    const rect = GEO.districtRect(d);
    const prof = PROFILE[d.id] || { storeys: [1], hall: 7, kind: 'wild' };
    const palName = DISTRICT_PALETTE[d.id] || 'grey';
    const pal = { ...PALETTES[palName] };
    if (d.id === 'fuwei') pal.swallow = true;               // 福建皮：紅磚白石加燕尾脊
    const rnd = RNGS('b:' + d.id);

    // ── 建物 ──
    const fps = footprints(sc, rect, (x, y) => inHero(x, y));
    let biggest = null;
    for (const f of fps) if (!biggest || f.tiles > biggest.tiles) biggest = f;
    for (const f of fps) {
      const wTiles = f.x1 - f.x0 + 1, dTiles = f.y1 - f.y0 + 1;
      if (wTiles * dTiles < 2) continue;
      const cx = (tx2x(f.x0) + tx2x(f.x1)) / 2, cz = (ty2z(f.y0) + ty2z(f.y1)) / 2;
      const w = wTiles * S * 0.92, dd = dTiles * S * 0.92;
      const base = groundH(cx, cz) - 0.3;
      const isHall = f === biggest && fps.length > 1;
      // 全圖只有一座廡殿頂：少林大雄寶殿，最尊的那一座
      const roof = isHall
        ? (d.id === 'shaolin' ? 'wudian' : 'xieshan')
        : (rnd() < 0.22 ? 'xieshan' : 'xuanshan');
      const storeys = isHall ? 1 : prof.storeys[(rnd() * prof.storeys.length) | 0];
      const height = isHall ? prof.hall : STOREY * storeys;
      putBuilding(P, geos, pal, palName, {
        cx, cz, w, d: dd, base, height, roof,
        rotY: wTiles >= dTiles ? 0 : Math.PI / 2, curve: pal.curve,
      });
      stats.buildings++;
    }

    // ── 門：看得見，這一期打不開 ──
    const M = geos.mats(palName);
    for (let y = rect.y0; y <= rect.y1; y++) for (let x = rect.x0; x <= rect.x1; x++) {
      if (sc.tiles[y * W + x] !== T.FLOOR) continue;
      const X = tx2x(x), Z = ty2z(y), base = groundH(X, Z);
      P.add('box', geos.box, palName + ':trim', M.trim, place(X, base + 1.15, Z, 1.9, 2.3, 0.36, 0));
      P.add('box', geos.box, 'door', geos.matOf(0x5b3524, 'door'), place(X, base + 1.05, Z - 0.1, 1.5, 2.1, 0.22, 0));
      stats.doors++;
    }

    // ── 城牆與城門 ──
    const style = { town: 1, sect: 1 }[d.style];
    if (style) {
      const gates = putWalls(P, geos, palName, sc, rect, groundH, prof);
      stats.gates += gates.length;
      stats.walls++;
      if (d.id === 'xiangyang' && gates.length) {
        // 甕城蓋在最南的那一座門上（官道從襄陽往南去武當、洞庭）
        const south = gates.reduce((a, b) => (b.y > a.y ? b : a));
        barbican(P, geos, groundH, { x: tx2x(south.x), z: ty2z(south.y) }, { x: 0, z: 1 });
      }
    }
  }

  // ── 英雄輪廓 ──
  if (TALIN) stats.stupas = stupaForest(P, geos, groundH, TALIN.x, TALIN.z, 56);
  if (SANTA) threePagodas(P, geos, groundH, SANTA.x, SANTA.z);
  if (ZIXIAO) wudangTerraces(P, geos, groundH, ZIXIAO.x, ZIXIAO.z);

  // 光明頂：夯土寨牆、中央一座露天火壇（明教崇日月與火）、一座石殿
  if (HUOTAN) {
    const M = geos.mats('rammed');
    const base = groundH(HUOTAN.x, HUOTAN.z);
    for (let i = 0; i < 3; i++) {
      P.add('pagoda8', geos.tier(8), 'rammed:plinth', M.plinth,
        place(HUOTAN.x, base + i * 0.7, HUOTAN.z, 9 - i * 2.2, 0.75, 9 - i * 2.2, 0));
    }
    P.add('pagoda8', geos.tier(8), 'rammed:trim', M.trim,
      place(HUOTAN.x, base + 2.1, HUOTAN.z, 3.2, 1.6, 3.2, 0));
    ctx.fireAltar = { x: HUOTAN.x, y: base + 3.7, z: HUOTAN.z };
  }

  // 華山之巔：論劍台。終局地點的型別就是地形加扶手。
  // 蓋在論劍台自己的錨點上（峰南三格），不是蓋在峰岩頂上——那塊岩要留著當天際線。
  {
    const lm = GEO.LANDMARKS.find(l => l.loc === 'final' && l.name === '論劍台');
    const d = GEO.DISTRICT_BY_ID.final;
    const fin = lm
      ? { x: tx2x(d.cx + lm.dx), z: ty2z(d.cy + lm.dy) }
      : { x: PLACE_BY_ID.final.x, z: PLACE_BY_ID.final.z };
    const M = geos.mats('grey');
    const base = groundH(fin.x, fin.z);
    for (let i = 0; i < 3; i++) {
      P.add('box', geos.box, 'grey:plinth', M.plinth,
        place(fin.x, base + 0.3 + i * 0.45, fin.z, 15 - i * 3, 0.5, 15 - i * 3, Math.PI / 4));
    }
    // 四根望柱加欄板——山頂的扶手
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      P.add('box', geos.box, 'grey:trim', M.trim,
        place(fin.x + Math.cos(a) * 5.2, base + 2.3, fin.z + Math.sin(a) * 5.2, 0.42, 1.5, 0.42, a));
    }
    ctx.summitPlatform = { x: fin.x, y: base + 1.65, z: fin.z, r: 7.5 };
  }

  return stats;      // 實例池由 cities/jianghu.js 統一 build——散佈與石階也在同一個池裡
}
