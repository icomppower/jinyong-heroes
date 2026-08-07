// 地圖生成：一張可徒步走遍的大地圖，加上每個地點各自的可行走場景。
// 全部由種子決定，Node 直接跑得動，連通性在 tools/verify.mjs 裡驗。

import { RNG } from '../core/rng.js';
import { LOCATIONS, LOC_BY_ID } from './world.js';

export const T = {
  GRASS: 0, PATH: 1, WALL: 2, WATER: 3, TREE: 4,
  BUILDING: 5, ROOF: 6, SAND: 7, MOUNTAIN: 8, COUNTER: 9,
  BRIDGE: 10, FLOWER: 11, FLOOR: 12, RUG: 13,
};

const WALKABLE = new Set([T.GRASS, T.PATH, T.SAND, T.BRIDGE, T.FLOWER, T.FLOOR, T.RUG]);
export const isWalkable = t => WALKABLE.has(t);

export const TILE_NAME = {
  [T.GRASS]: '草地', [T.PATH]: '道路', [T.WALL]: '牆', [T.WATER]: '水',
  [T.TREE]: '樹', [T.BUILDING]: '屋牆', [T.ROOF]: '屋頂', [T.SAND]: '沙地',
  [T.MOUNTAIN]: '山', [T.COUNTER]: '櫃檯', [T.BRIDGE]: '橋', [T.FLOWER]: '花',
  [T.FLOOR]: '地板', [T.RUG]: '地毯',
};

// ── 大地圖尺寸 ──
export const OW = { w: 130, h: 96 };

class Grid {
  constructor(w, h, fill = T.GRASS) {
    this.w = w; this.h = h;
    this.t = new Uint8Array(w * h).fill(fill);
  }
  get(x, y) { return (x < 0 || y < 0 || x >= this.w || y >= this.h) ? T.WALL : this.t[y * this.w + x]; }
  set(x, y, v) { if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.t[y * this.w + x] = v; }
  rect(x, y, w, h, v) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, v); }
  border(v) {
    for (let x = 0; x < this.w; x++) { this.set(x, 0, v); this.set(x, this.h - 1, v); }
    for (let y = 0; y < this.h; y++) { this.set(0, y, v); this.set(this.w - 1, y, v); }
  }
}

// 平滑雜訊（給地形用）
function noise2(seed, w, h, scale) {
  const rng = new RNG(seed);
  const gw = Math.ceil(w / scale) + 2, gh = Math.ceil(h / scale) + 2;
  const g = Array.from({ length: gh }, () => Array.from({ length: gw }, () => rng.next()));
  return (x, y) => {
    const fx = x / scale, fy = y / scale;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const s = t => t * t * (3 - 2 * t);
    const a = g[y0][x0], b = g[y0][x0 + 1], c = g[y0 + 1][x0], d = g[y0 + 1][x0 + 1];
    const u = s(tx), v = s(ty);
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  };
}

export function owPos(loc) {
  return {
    x: Math.round(4 + (loc.x / 100) * (OW.w - 9)),
    y: Math.round(4 + (loc.y / 100) * (OW.h - 9)),
  };
}

// ── 大地圖 ──
export function buildOverworld(seed = 20260807) {
  const g = new Grid(OW.w, OW.h, T.GRASS);
  const elev = noise2(seed, OW.w, OW.h, 13);
  const moist = noise2(seed + 977, OW.w, OW.h, 9);

  for (let y = 0; y < OW.h; y++) for (let x = 0; x < OW.w; x++) {
    const e = elev(x, y), m = moist(x, y);
    // 邊緣化為海
    const edge = Math.min(x, y, OW.w - 1 - x, OW.h - 1 - y);
    if (edge < 2) { g.set(x, y, T.WATER); continue; }
    if (e > 0.74) g.set(x, y, T.MOUNTAIN);
    else if (e < 0.28) g.set(x, y, T.WATER);
    else if (m > 0.66 && e > 0.4) g.set(x, y, T.TREE);
    else if (m < 0.3) g.set(x, y, T.SAND);
    else g.set(x, y, T.GRASS);
  }

  // 地點周圍淨空
  const gates = {};
  for (const loc of LOCATIONS) {
    const p = owPos(loc);
    gates[loc.id] = p;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      if (Math.abs(dx) + Math.abs(dy) <= 4) g.set(p.x + dx, p.y + dy, T.GRASS);
    }
  }

  // 依 links 開路：先橫後縱的 L 形，沿途鏟平障礙
  const carve = (a, b) => {
    let x = a.x, y = a.y;
    const step = () => {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const t = g.get(x + dx, y + dy);
        if (t === T.MOUNTAIN || t === T.TREE) g.set(x + dx, y + dy, T.GRASS);
      }
      const cur = g.get(x, y);
      g.set(x, y, cur === T.WATER ? T.BRIDGE : T.PATH);
    };
    const midX = a.x + Math.sign(b.x - a.x) * Math.floor(Math.abs(b.x - a.x) / 2);
    while (x !== midX) { step(); x += Math.sign(midX - x); }
    while (y !== b.y) { step(); y += Math.sign(b.y - y); }
    while (x !== b.x) { step(); x += Math.sign(b.x - x); }
    step();
  };

  const done = new Set();
  for (const loc of LOCATIONS) for (const nId of loc.links) {
    const key = [loc.id, nId].sort().join('|');
    if (done.has(key)) continue;
    done.add(key);
    carve(gates[loc.id], gates[nId]);
  }

  // 地點入口：擺在路口北邊一格的死路端。
  // 道路只在路口交會，所以沿著官道走過去不會被硬拉進城，得自己往北踏一步才進得去。
  const entities = LOCATIONS.map(loc => ({
    type: 'gate', to: loc.id, x: gates[loc.id].x, y: gates[loc.id].y - 1,
    name: loc.name, solid: false,
  }));

  for (const e of entities) {
    g.set(e.x, e.y, T.PATH);        // 入口本身
    g.set(e.x, e.y + 1, T.PATH);    // 與路口相連
  }

  return {
    id: 'overworld', name: '江湖', kind: 'overworld',
    w: g.w, h: g.h, tiles: g.t, entities,
    spawn: { x: gates.yangzhou.x, y: gates.yangzhou.y + 2 },   // 揚州城門外的官道上
    encounterRate: 0.022,
  };
}

// ── 地點場景 ──
// 每個地點是一張可走的地圖：建物、NPC、頭目、秘笈、出口。
const SCENE_STYLE = {
  town: { w: 44, h: 32, ground: T.PATH, edge: T.BUILDING, decor: T.FLOWER, buildings: 7 },
  sect: { w: 40, h: 30, ground: T.FLOOR, edge: T.WALL, decor: T.RUG, buildings: 5 },
  wild: { w: 42, h: 32, ground: T.GRASS, edge: T.TREE, decor: T.FLOWER, buildings: 2 },
  final: { w: 30, h: 26, ground: T.SAND, edge: T.MOUNTAIN, decor: T.FLOWER, buildings: 0 },
};

// NPC 對白：招募對象以外的閒角
const FLAVOUR = {
  yangzhou: ['「這年頭，會武功的比賣菜的還多。」', '「聽說城裡來了個怪人，睡在城外草堆裡。」', '「麗春院？客官往那邊走。」'],
  xiangyang: ['「蒙古人又在城外擂鼓了。」', '「郭大俠守了襄陽十幾年，一步沒退過。」', '「城裡糧不多了，可沒人說要走。」'],
  shaolin: ['「藏經閣重地，施主止步。」', '「掃地的那位老僧？沒人知道他是誰。」', '「我佛慈悲。」'],
  huashan: ['「思過崖上的字，一百年沒人看懂。」', '「劍宗氣宗吵了幾十年，人都死光了。」'],
  gumu: ['「墓裡冷得緊，你當心。」', '「這裡的機關，走錯一步便回不來。」'],
  heimu: ['「文成武德，一統江湖！」', '「教主閉關已久，誰也見不著。」'],
  guangming: ['「熊熊聖火，焚我殘軀。」', '「明教不是魔教，是別人這樣叫我們。」'],
  wuliang: ['「山裡有洞，洞裡有玉像，你信不信？」', '「進去容易出來難。」'],
  tianlong: ['「六脈神劍，非有絕頂內力不可施展。」', '「段氏出家的，比在朝的還多。」'],
  jueqing: ['「情花有毒，別碰。」', '「谷主說了，動情就得死。」'],
  dongting: ['「污衣派淨衣派，其實吃的都是一樣的餿飯。」', '「打狗棒法歷代單傳。」'],
  wudang: ['「太極是圓的，人心也是。」', '「張真人一百歲了，還在畫圈。」'],
  taohua: ['「島上陣法一亂走，三天都出不去。」', '「東邪脾氣怪，人倒不壞。」'],
  fuwei: ['「一夜之間死了七十幾口，誰下的手？」', '「他們找的東西，就在這宅子裡。」'],
  final: ['「天下英雄都上來了。」'],
};

function placeBuildings(g, rng, style, avoid) {
  const spots = [];
  const tries = style.buildings * 14;
  for (let i = 0; i < tries && spots.length < style.buildings; i++) {
    const bw = rng.irange(5, 8), bh = rng.irange(4, 6);
    const x = rng.irange(3, g.w - bw - 4), y = rng.irange(3, g.h - bh - 6);
    const clash = spots.some(s => x < s.x + s.w + 2 && x + bw + 2 > s.x && y < s.y + s.h + 2 && y + bh + 2 > s.y)
      || avoid.some(a => a.x >= x - 2 && a.x <= x + bw + 1 && a.y >= y - 2 && a.y <= y + bh + 1);
    if (clash) continue;
    spots.push({ x, y, w: bw, h: bh });
  }
  for (const s of spots) {
    g.rect(s.x, s.y, s.w, s.h, T.BUILDING);
    g.rect(s.x + 1, s.y, s.w - 2, s.h - 2, T.ROOF);
  }
  return spots;
}

export function buildScene(locId) {
  const loc = LOC_BY_ID[locId];
  const style = SCENE_STYLE[loc.type] || SCENE_STYLE.wild;
  const rng = new RNG(hash(locId));
  const g = new Grid(style.w, style.h, style.ground);

  // 外圍
  for (let k = 0; k < 2; k++) {
    for (let x = 0; x < g.w; x++) { g.set(x, k, style.edge); g.set(x, g.h - 1 - k, style.edge); }
    for (let y = 0; y < g.h; y++) { g.set(k, y, style.edge); g.set(g.w - 1 - k, y, style.edge); }
  }

  // 出口（往大地圖），開在下緣正中
  const exit = { x: Math.floor(g.w / 2), y: g.h - 2 };
  g.set(exit.x, exit.y, T.PATH);
  g.set(exit.x, g.h - 1, T.PATH);
  const spawn = { x: exit.x, y: g.h - 4 };

  const entities = [{ type: 'exit', x: exit.x, y: exit.y, name: '離開' + loc.name, solid: false }];
  const reserved = [spawn, exit];

  // 建物
  placeBuildings(g, rng, style, reserved);

  // 中央廣場淨空，主要 NPC 站在這裡
  const cx = Math.floor(g.w / 2), cy = Math.floor(g.h / 2);
  g.rect(cx - 5, cy - 4, 11, 9, style.ground);

  const slots = [];
  for (let r = 2; r <= 5 && slots.length < 24; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.abs(dx) + Math.abs(dy) !== r) continue;
      const x = cx + dx, y = cy + dy;
      if (isWalkable(g.get(x, y)) && !slots.some(s => s.x === x && s.y === y)) slots.push({ x, y });
    }
  }
  // 放置實心 NPC 時必須維持全圖連通——一圈 NPC 圍成環會把中間封死，
  // 玩家走進去就出不來（襄陽城原本正是這樣困住 5 格）。
  let si = 0;
  const solidAt = [];
  const walkableTiles = () => {
    let n = 0;
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (isWalkable(g.get(x, y))) n++;
    return n;
  };
  const reachFrom = () => {
    const seen = new Uint8Array(g.w * g.h);
    const q = [[spawn.x, spawn.y]];
    seen[spawn.y * g.w + spawn.x] = 1;
    let n = 1;
    while (q.length) {
      const [x, y] = q.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
        const i = ny * g.w + nx;
        if (seen[i] || !isWalkable(g.get(nx, ny))) continue;
        if (solidAt.some(p => p.x === nx && p.y === ny)) continue;
        seen[i] = 1; n++; q.push([nx, ny]);
      }
    }
    return n;
  };
  // 取下一個「擺上去也不會把地圖切開」的位置
  const nextSlot = (solid = true) => {
    for (let tried = 0; tried < slots.length; tried++) {
      const p = slots[si++ % slots.length];
      if (solidAt.some(q => q.x === p.x && q.y === p.y)) continue;
      if (!solid) return p;
      solidAt.push(p);
      // 可走格數扣掉被 NPC 佔住的，剩下的必須全部走得到
      if (reachFrom() === walkableTiles() - solidAt.length) return p;
      solidAt.pop();
    }
    return slots[si++ % slots.length];
  };

  // 商鋪
  if (loc.shop) {
    const p = nextSlot();
    entities.push({ type: 'shop', x: p.x, y: p.y, name: '掌櫃', solid: true });
    g.set(p.x, p.y - 1, T.COUNTER);
  }
  // 客棧
  if (loc.inn != null) {
    const p = nextSlot();
    entities.push({ type: 'inn', x: p.x, y: p.y, name: '店小二', solid: true });
  }
  // 可招募之人
  for (const r of (loc.recruit || [])) {
    const p = nextSlot();
    entities.push({ type: 'recruit', who: r.id, x: p.x, y: p.y, name: '？', solid: true, wander: true });
  }
  // 打坐處
  {
    const p = nextSlot();
    entities.push({ type: 'train', x: p.x, y: p.y, name: '靜室', solid: true });
  }
  // 閒角
  for (const line of (FLAVOUR[locId] || [])) {
    const p = nextSlot();
    entities.push({ type: 'talk', text: line, x: p.x, y: p.y, name: '路人', solid: true, wander: true });
  }
  // 頭目與秘笈：擺在遠離出口的深處
  if (loc.boss) {
    const bx = Math.floor(g.w / 2), by = 4;
    g.rect(bx - 4, by - 1, 9, 6, style.ground);
    entities.push({ type: 'boss', x: bx, y: by + 1, name: loc.boss.title, solid: true });
    if (loc.book) entities.push({ type: 'book', book: loc.book, x: bx, y: by, name: '秘笈', solid: false });
  }
  // 告示
  entities.push({ type: 'sign', x: exit.x - 2, y: g.h - 4, name: '石碑', solid: true, text: loc.desc });

  // NPC 腳下確保是可走地
  for (const e of entities) if (!isWalkable(g.get(e.x, e.y))) g.set(e.x, e.y, style.ground);

  // 保證出口到每個 entity 都走得通（打通被建物封死的路）
  ensureConnected(g, spawn, entities, style.ground);

  return {
    id: locId, name: loc.name, kind: loc.type, loc,
    w: g.w, h: g.h, tiles: g.t, entities, spawn,
    encounterRate: loc.mobs ? 0.02 : 0,
  };
}

// 從 spawn 洪水填滿；凡走不到的 entity，就用直線鑿一條路過去
function ensureConnected(g, spawn, entities, ground) {
  const reach = () => {
    const seen = new Uint8Array(g.w * g.h);
    const q = [[spawn.x, spawn.y]];
    seen[spawn.y * g.w + spawn.x] = 1;
    while (q.length) {
      const [x, y] = q.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
        const i = ny * g.w + nx;
        if (seen[i] || !isWalkable(g.get(nx, ny))) continue;
        seen[i] = 1; q.push([nx, ny]);
      }
    }
    return seen;
  };
  for (let pass = 0; pass < 6; pass++) {
    const seen = reach();
    const bad = entities.filter(e => !seen[e.y * g.w + e.x]);
    if (!bad.length) return;
    for (const e of bad) {
      // 從 spawn 直線鑿到 e
      let x = spawn.x, y = spawn.y;
      while (y !== e.y) { g.set(x, y, ground); y += Math.sign(e.y - y); }
      while (x !== e.x) { g.set(x, y, ground); x += Math.sign(e.x - x); }
      g.set(e.x, e.y, ground);
    }
  }
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// 場景快取
const cache = new Map();
export function getScene(id) {
  if (!cache.has(id)) cache.set(id, id === 'overworld' ? buildOverworld() : buildScene(id));
  return cache.get(id);
}
export function clearSceneCache() { cache.clear(); }
