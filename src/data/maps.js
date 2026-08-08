// 一張圖的江湖：384×288，一層世界，沒有大地圖／城鎮之分。
//
// 拓樸（海岸、河、山脈、官道、街廓、地標）由 world/jianghu.js 手寫；
// 荒野的草木沙石由有種子的生成器填。建物內部是唯一的第二層場景。

import { RNG } from '../core/rng.js';
import { LOCATIONS, LOC_BY_ID } from './world/locations.js';
import * as GEO from './world/jianghu.js';
import { INTERIORS, HOUSE_LINES, SHUT_LINES } from './interiors.js';

export const T = {
  GRASS: 0, ROAD: 1, WALL: 2, WATER: 3, TREE: 4,
  BUILDING: 5, ROOF: 6, SAND: 7, MOUNTAIN: 8, COUNTER: 9,
  BRIDGE: 10, FLOWER: 11, FLOOR: 12, RUG: 13,
  ROCK: 14, SNOW: 15, BAMBOO: 16, FARM: 17, STREET: 18,
};

const WALKABLE = new Set([
  T.GRASS, T.ROAD, T.SAND, T.BRIDGE, T.FLOWER, T.FLOOR, T.RUG,
  T.SNOW, T.FARM, T.STREET,
]);
export const isWalkable = t => WALKABLE.has(t);
export const isRoad = t => t === T.ROAD || t === T.BRIDGE;

export const TILE_NAME = {
  [T.GRASS]: '草地', [T.ROAD]: '官道', [T.WALL]: '牆', [T.WATER]: '水',
  [T.TREE]: '林', [T.BUILDING]: '屋牆', [T.ROOF]: '屋頂', [T.SAND]: '沙地',
  [T.MOUNTAIN]: '山', [T.COUNTER]: '櫃檯', [T.BRIDGE]: '橋', [T.FLOWER]: '花',
  [T.FLOOR]: '地板', [T.RUG]: '地毯', [T.ROCK]: '峭壁', [T.SNOW]: '雪線',
  [T.BAMBOO]: '竹林', [T.FARM]: '田', [T.STREET]: '街道',
};

// 每走一格的代價。官道便宜、跨野貴——世界放大三倍，旅程長度才不會跟著漲三倍，
// 而且官道終於在機制上有意義，不再只是「遭遇發生的地方」。
export const TILE_COST = {
  [T.ROAD]: { m: 12, s: 0.09 },
  [T.BRIDGE]: { m: 12, s: 0.09 },
  [T.STREET]: { m: 0, s: 0 },
  [T.FLOOR]: { m: 0, s: 0 },
  [T.RUG]: { m: 0, s: 0 },
  [T.GRASS]: { m: 28, s: 0.26 },
  [T.FARM]: { m: 26, s: 0.24 },
  [T.FLOWER]: { m: 28, s: 0.26 },
  [T.SAND]: { m: 34, s: 0.32 },
  [T.SNOW]: { m: 48, s: 0.55 },
};
const DEFAULT_COST = { m: 30, s: 0.28 };

export const W = GEO.W, H = GEO.H;

// ══════════════════════════════════════════════════════════
// 小工具
// ══════════════════════════════════════════════════════════
class Grid {
  constructor(w, h, fill = T.GRASS) {
    this.w = w; this.h = h;
    this.t = new Uint8Array(w * h).fill(fill);
  }
  get(x, y) { return (x < 0 || y < 0 || x >= this.w || y >= this.h) ? T.WALL : this.t[y * this.w + x]; }
  set(x, y, v) { if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.t[y * this.w + x] = v; }
  rect(x, y, w, h, v) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, v); }
}

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

// 點到線段的距離
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

// 折線取樣：回傳 y 對應的 x（海岸線用）
function polyX(pts, y) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    if (y >= y0 && y <= y1) {
      const t = (y - y0) / (y1 - y0 || 1);
      return x0 + (x1 - x0) * t;
    }
  }
  return pts[pts.length - 1][0];
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ══════════════════════════════════════════════════════════
// 高度場：移動耗費、視野、以及「華山之巔就是全圖最高點」
// ══════════════════════════════════════════════════════════
function buildHeight(seed) {
  const hgt = new Uint8Array(W * H);
  const base = noise2(seed + 31, W, H, 34);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = 24 + base(x, y) * 46;
    for (const r of GEO.RANGES) {
      const d = segDist(x, y, r.a[0], r.a[1], r.b[0], r.b[1]);
      if (d < r.r) {
        const f = 1 - d / r.r;
        v = Math.max(v, r.h * f * f * (3 - 2 * f) * 0.55 + r.h * 0.45 * f);
      }
    }
    for (const p of GEO.PEAKS) {
      const d = Math.hypot(x - p.x, y - p.y);
      if (d < p.r) {
        const f = 1 - d / p.r;
        v = Math.max(v, p.h * f);
      }
    }
    hgt[y * W + x] = Math.max(0, Math.min(255, Math.round(v)));
  }
  // 峰頂寫死，確保是嚴格最高點
  for (const p of GEO.PEAKS) hgt[p.y * W + p.x] = p.h;
  return hgt;
}

// ══════════════════════════════════════════════════════════
// 水域
// ══════════════════════════════════════════════════════════
function paintWater(g, hgt) {
  for (let y = 0; y < H; y++) {
    const cx = polyX(GEO.COAST, y);
    for (let x = Math.max(0, Math.floor(cx)); x < W; x++) { g.set(x, y, T.WATER); hgt[y * W + x] = 0; }
  }
  for (const lake of GEO.LAKES) {
    for (let y = Math.floor(lake.y - lake.ry); y <= lake.y + lake.ry; y++) {
      for (let x = Math.floor(lake.x - lake.rx); x <= lake.x + lake.rx; x++) {
        const u = (x - lake.x) / lake.rx, v = (y - lake.y) / lake.ry;
        if (u * u + v * v <= 1) { g.set(x, y, T.WATER); hgt[y * W + x] = 0; }
      }
    }
  }
  for (const riv of GEO.RIVERS) {
    for (let i = 0; i < riv.pts.length - 1; i++) {
      const [ax, ay] = riv.pts[i], [bx, by] = riv.pts[i + 1];
      const steps = Math.ceil(Math.hypot(bx - ax, by - ay));
      for (let k = 0; k <= steps; k++) {
        const px = ax + (bx - ax) * k / steps, py = ay + (by - ay) * k / steps;
        for (let dy = -riv.width; dy <= riv.width; dy++) for (let dx = -riv.width; dx <= riv.width; dx++) {
          if (Math.hypot(dx, dy) > riv.width) continue;
          const x = Math.round(px + dx), y = Math.round(py + dy);
          g.set(x, y, T.WATER); if (x >= 0 && y >= 0 && x < W && y < H) hgt[y * W + x] = 0;
        }
      }
    }
  }
  // 圖框化為海，避免走出邊界
  for (let x = 0; x < W; x++) { g.set(x, 0, T.WATER); g.set(x, H - 1, T.WATER); }
  for (let y = 0; y < H; y++) { g.set(0, y, T.WATER); g.set(W - 1, y, T.WATER); }
}

// ══════════════════════════════════════════════════════════
// 貼圖：高度＋濕度決定荒野長什麼樣（拓樸手寫，貼圖生成）
// ══════════════════════════════════════════════════════════
function paintTerrain(g, hgt, seed) {
  const moist = noise2(seed + 977, W, H, 26);
  const detail = noise2(seed + 4241, W, H, 7);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (g.get(x, y) === T.WATER) continue;
    const h = hgt[y * W + x];
    const m = moist(x, y) * 0.75 + detail(x, y) * 0.25;
    let t;
    if (h >= 214) t = T.SNOW;
    else if (h >= 168) t = T.ROCK;
    else if (h >= 132) t = T.MOUNTAIN;
    else if (m > 0.70) t = h < 84 ? T.BAMBOO : T.TREE;
    else if (m > 0.58) t = T.TREE;
    else if (m < 0.30) t = T.SAND;
    else if (m < 0.38) t = T.FARM;
    else t = T.GRASS;
    g.set(x, y, t);
  }
}

// ══════════════════════════════════════════════════════════
// 地標型別庫。日後 reskin 成大唐或三國，真正該抽出來的就是這一段。
// ══════════════════════════════════════════════════════════
const LANDMARK = {
  gate(g, x, y, o) {                       // 城門／山門：門洞兩側的樓台
    g.set(x - 1, y, T.BUILDING); g.set(x + 1, y, T.BUILDING);
    g.set(x - 1, y - 1, T.ROOF); g.set(x + 1, y - 1, T.ROOF);
    g.set(x, y, o.ground);
  },
  sectgate(g, x, y, o) { LANDMARK.gate(g, x, y, o); },
  pagoda(g, x, y) {                        // 塔
    g.rect(x - 1, y - 2, 3, 4, T.BUILDING);
    g.set(x, y - 1, T.ROOF); g.set(x, y - 2, T.ROOF);
  },
  temple(g, x, y) {                        // 廟／殿
    g.rect(x - 2, y - 2, 5, 4, T.BUILDING);
    g.rect(x - 1, y - 2, 3, 2, T.ROOF);
  },
  stonebridge(g, x, y, o) {                // 石橋
    const wdt = o.width || 3;
    for (let i = -(wdt >> 1); i <= (wdt >> 1); i++) g.set(x + i, y, T.BRIDGE);
  },
  dock(g, x, y) {                          // 碼頭
    g.rect(x - 2, y - 1, 5, 2, T.SAND);
    g.set(x, y + 1, T.BRIDGE);
  },
  tomb(g, x, y, o) {                       // 古墓：石環，南面留口
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const edge = Math.abs(dx) === 2 || Math.abs(dy) === 2;
      if (edge && !(dx === 0 && dy === 2)) g.set(x + dx, y + dy, T.WALL);
      else g.set(x + dx, y + dy, o.ground);
    }
  },
  grotto(g, x, y, o) {                     // 石窟：同上，換成岩壁
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const edge = Math.abs(dx) === 2 || Math.abs(dy) === 2;
      if (edge && !(dx === 0 && dy === 2)) g.set(x + dx, y + dy, T.ROCK);
      else g.set(x + dx, y + dy, T.FLOOR);
    }
  },
  drillground(g, x, y) { g.rect(x - 3, y - 2, 7, 5, T.SAND); },
  bamboo(g, x, y) {                        // 竹林：格狀種，留出十字通道
    // 不可以種成棋盤格——四鄰接下，棋盤格的空格彼此不相鄰，反而把人困死。
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if ((dx & 1) === 0 && (dy & 1) === 0) g.set(x + dx, y + dy, T.BAMBOO);
    }
  },
  pass(g, x, y, o) {                       // 關隘：兩段牆，中留三格
    for (let dx = -4; dx <= 4; dx++) {
      if (Math.abs(dx) <= 1) { g.set(x + dx, y, o.ground); continue; }
      g.set(x + dx, y, T.WALL); g.set(x + dx, y - 1, T.WALL);
    }
  },
  custom(g, x, y, o) { g.rect(x - 2, y - 1, 5, 3, o.decor); },
};

// ══════════════════════════════════════════════════════════
// 街廓：城鎮＝同一張圖上建物密度變高的一塊，不是另一個場景
// ══════════════════════════════════════════════════════════
const STYLE = {
  town: { ground: T.STREET, wall: T.WALL, decor: T.FLOWER, houses: 4 },
  sect: { ground: T.STREET, wall: T.WALL, decor: T.RUG, houses: 3 },
  wild: { ground: T.GRASS, wall: null, decor: T.FLOWER, houses: 2 },
  final: { ground: T.SNOW, wall: null, decor: T.FLOWER, houses: 0 },
};

// 建物擺位手寫。中央的橫排與直排永遠留空，官道從任一邊進來都通得到中心。
const BLOCKS = {
  town: [
    [-15, -11, 6, 4], [-9, -11, 6, 4], [7, -11, 6, 4],
    [-15, -4, 6, 4], [-9, -4, 6, 4], [2, -4, 6, 4], [9, -4, 6, 4],
    [-15, 4, 7, 4], [-7, 4, 7, 4], [1, 4, 7, 4], [9, 4, 7, 4],
  ],
  sect: [
    [-12, -9, 6, 4], [6, -9, 6, 4],
    [-12, -4, 6, 4], [-5, -4, 4, 4], [2, -4, 4, 4], [8, -4, 5, 4],
    [-12, 2, 6, 4], [-5, 2, 4, 4], [2, 2, 4, 4], [8, 2, 5, 4],
  ],
  wild: [
    [-11, -4, 6, 4], [5, -4, 6, 4], [-11, 3, 6, 4], [4, 3, 7, 4],
  ],
  final: [],
};

function buildDistrict(g, hgt, d, out) {
  const loc = LOC_BY_ID[d.id];
  const st = STYLE[d.style];
  const r = GEO.districtRect(d);
  const rng = new RNG(hash('dist:' + d.id));

  // 整地：footprint 全部化為地面，高度抹平成中心高度
  // （封頂在 236，好讓 buildWorld 事後回填的華山之巔 255 仍是全圖唯一最高點）
  const centreH = Math.min(hgt[d.cy * W + d.cx], 236);
  for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
    g.set(x, y, st.ground);
    hgt[y * W + x] = centreH;
    out.town[y * W + x] = out.districtIndex[d.id] + 1;
  }
  // 圍牆（城鎮與山門有，荒野沒有）
  if (st.wall) {
    for (let x = r.x0; x <= r.x1; x++) { g.set(x, r.y0, st.wall); g.set(x, r.y1, st.wall); }
    for (let y = r.y0; y <= r.y1; y++) { g.set(r.x0, y, st.wall); g.set(r.x1, y, st.wall); }
  }

  // 建物（每一棟都是孤島，門開在南面正中）
  const blocks = BLOCKS[d.style] || [];
  const doorSpots = [];
  for (const [dx, dy, bw, bh] of blocks) {
    const bx = d.cx + dx, by = d.cy + dy;
    g.rect(bx, by, bw, bh, T.BUILDING);
    g.rect(bx + 1, by, bw - 2, bh - 2, T.ROOF);
    const doorX = bx + (bw >> 1), doorY = by + bh - 1;
    g.set(doorX, doorY, T.FLOOR);
    doorSpots.push({ x: doorX, y: doorY });
  }

  // 哪幾扇門通到內部：掌櫃、客棧、靜室、一戶人家
  const needed = [];
  if (loc.shop) needed.push('shop');
  if (loc.inn != null) needed.push('inn');
  needed.push('train');
  if (doorSpots.length > needed.length) needed.push('house');

  doorSpots.forEach((p, i) => {
    const kind = needed[i];
    if (kind) {
      const id = `int:${d.id}:${kind}`;
      out.entities.push({
        type: 'door', to: id, kind, loc: d.id, x: p.x, y: p.y,
        name: INTERIORS[kind].name, solid: false,
      });
      out.doorBack[id] = { x: p.x, y: p.y };
    } else {
      out.entities.push({
        type: 'talk', loc: d.id, x: p.x, y: p.y, name: '門', solid: true,
        text: SHUT_LINES[(hash(d.id) + i) % SHUT_LINES.length],
      });
    }
  });

  // 地標。蓋章時不准動到建物，否則屋牆會被開洞。
  for (const lm of GEO.LANDMARKS.filter(l => l.loc === d.id)) {
    const x = d.cx + lm.dx, y = d.cy + lm.dy;
    const keep = [];
    for (let j = y - 4; j <= y + 4; j++) for (let i = x - 5; i <= x + 5; i++) {
      const t = g.get(i, j);
      if (t === T.BUILDING || t === T.ROOF || t === T.FLOOR) keep.push([i, j, t]);
    }
    (LANDMARK[lm.type] || LANDMARK.custom)(g, x, y, { ground: st.ground, decor: st.decor, width: 3 });
    for (const [i, j, t] of keep) g.set(i, j, t);
    out.wants.push({
      district: d.id, anchor: { x, y: y + 3 },
      ent: { type: 'sign', loc: d.id, name: lm.name, solid: true, text: `${lm.name}。${loc.desc}` },
    });
  }

  return { rect: r, style: st, rng };
}

// ══════════════════════════════════════════════════════════
// 官道
// ══════════════════════════════════════════════════════════
function endpointOf(name) {
  if (GEO.NODES[name]) return { x: GEO.NODES[name][0], y: GEO.NODES[name][1] };
  const d = GEO.DISTRICT_BY_ID[name];
  return { x: d.cx, y: d.cy };
}

function carveRoads(g, out) {
  const paint = (x, y) => {
    if (x <= 0 || y <= 0 || x >= W - 1 || y >= H - 1) return;
    const t = g.get(x, y);
    // 進了街廓，地面本來就是街道，官道不必再鑿——鑿下去會把民宅切開一個洞。
    // 只有城牆該為它讓路，那一格就是城門。
    if (out.town[y * W + x]) { if (t === T.WALL) g.set(x, y, T.STREET); return; }
    g.set(x, y, t === T.WATER ? T.BRIDGE : T.ROAD);
  };
  const line = (a, b) => {
    let x = a.x, y = a.y;
    let guard = 0;
    while ((x !== b.x || y !== b.y) && guard++ < 4000) {
      paint(x, y);
      const dx = b.x - x, dy = b.y - y;
      if (Math.abs(dx) >= Math.abs(dy)) x += Math.sign(dx);
      else y += Math.sign(dy);
    }
    paint(b.x, b.y);
  };
  for (const road of GEO.ROADS) {
    const pts = [endpointOf(road.a), ...road.via.map(([x, y]) => ({ x, y })), endpointOf(road.b)];
    for (let i = 0; i < pts.length - 1; i++) line(pts[i], pts[i + 1]);
    out.roadNames.push({ a: road.a, b: road.b });
  }
  // 君山長堤
  const cw = GEO.CAUSEWAY;
  for (let y = cw.from[1]; y <= cw.to[1]; y++) {
    LANDMARK.stonebridge(g, cw.from[0], y, { width: cw.width });
  }
}

// 官道穿山時把路面兩側的峭壁削成可看的關口（路本身已是可走的）
function dressRoads(g) {
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    if (g.get(x, y) !== T.ROAD) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (g.get(x + dx, y + dy) === T.ROCK) g.set(x + dx, y + dy, T.MOUNTAIN);
    }
  }
}

// ══════════════════════════════════════════════════════════
// 割點：擋在割點上的人會把世界切成兩半，所以會走動的 NPC 一律不站割點
// ══════════════════════════════════════════════════════════
export function articulationPoints(tiles, w, h) {
  const N = w * h;
  const walk = i => isWalkable(tiles[i]);
  const disc = new Int32Array(N), low = new Int32Array(N), art = new Uint8Array(N);
  const D = [1, -1, w, -w];
  let timer = 1;
  const su = new Int32Array(N), sp = new Int32Array(N), si = new Uint8Array(N);
  for (let s = 0; s < N; s++) {
    if (disc[s] || !walk(s)) continue;
    let top = 0, rootKids = 0;
    su[0] = s; sp[0] = -1; si[0] = 0;
    disc[s] = low[s] = timer++;
    while (top >= 0) {
      const u = su[top];
      if (si[top] < 4) {
        const k = si[top]++;
        const ux = u % w;
        if ((k === 0 && ux === w - 1) || (k === 1 && ux === 0)) continue;
        const v = u + D[k];
        if (v < 0 || v >= N || !walk(v)) continue;
        if (!disc[v]) {
          disc[v] = low[v] = timer++;
          if (u === s) rootKids++;
          top++; su[top] = v; sp[top] = u; si[top] = 0;
        } else if (v !== sp[top] && disc[v] < low[u]) low[u] = disc[v];
      } else {
        top--;
        if (top >= 0) {
          const p = su[top];
          if (low[u] < low[p]) low[p] = low[u];
          if (p !== s && low[u] >= disc[p]) art[p] = 1;
        }
      }
    }
    if (rootKids > 1) art[s] = 1;
  }
  return art;
}

// ══════════════════════════════════════════════════════════
// 江湖自己會動：商隊、鏢隊、巡山弟子
// 位置是 steps 的純函式，不進存檔，也就永遠不會跟存檔對不上。
// ══════════════════════════════════════════════════════════
function roadPath(tiles, town, from, to) {
  const N = W * H;
  // 官道、石橋、街道，加上街廓內的地面（荒野型的地點沒有石板街，但一樣走得進去）
  const ok = i => isRoad(tiles[i]) || tiles[i] === T.STREET || (town[i] && isWalkable(tiles[i]));
  const prev = new Int32Array(N).fill(-1);
  const seen = new Uint8Array(N);
  const start = from.y * W + from.x, goal = to.y * W + to.x;
  if (!ok(start)) return null;
  seen[start] = 1;
  const q = [start];
  let head = 0;
  while (head < q.length) {
    const cur = q[head++];
    if (cur === goal) break;
    const cx = cur % W;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = ((cur / W) | 0) + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (seen[ni] || !ok(ni)) continue;
      seen[ni] = 1; prev[ni] = cur; q.push(ni);
    }
  }
  if (!seen[goal]) return null;
  const out = [];
  for (let c = goal; c !== -1; c = prev[c]) out.unshift({ x: c % W, y: (c / W) | 0 });
  return out;
}

function buildActors(tiles, town, art) {
  const actors = [];
  for (const a of GEO.ACTORS) {
    const full = roadPath(tiles, town, endpointOf(a.from), endpointOf(a.to));
    if (!full) continue;
    // 只走非割點的最長連續段
    let best = [], run = [];
    for (const p of full) {
      if (art[p.y * W + p.x]) { if (run.length > best.length) best = run; run = []; }
      else run.push(p);
    }
    if (run.length > best.length) best = run;
    if (best.length < 4) continue;
    // 走動中的隊伍不擋路：走上去是「追上了他們」，不是撞牆。
    // 兩台商隊一前一後把城門堵死那種事，用挑站位是防不住的（單獨都不是割點，
    // 湊在一起卻是）；讓它們根本不成為牆，這一整類問題才真的消失。
    actors.push({ ...a, type: 'actor', route: best, solid: false });
  }
  return actors;
}

export function actorAt(actor, steps) {
  const n = actor.route.length;
  if (n === 1) return actor.route[0];
  const period = 2 * (n - 1);
  const k = ((Math.floor(steps / actor.speed) + actor.offset) % period + period) % period;
  return actor.route[k < n ? k : period - k];
}

// 街廓內的連通格數（把已擺好的實心 NPC 當成牆）
function districtReach(g, d, blocked) {
  const r = GEO.districtRect(d);
  const inRect = (x, y) => x >= r.x0 - 1 && x <= r.x1 + 1 && y >= r.y0 - 1 && y <= r.y1 + 1;
  const key = (x, y) => x * 1000 + y;
  const seen = new Set([key(d.cx, d.cy)]);
  const q = [[d.cx, d.cy]];
  let n = 1;
  while (q.length) {
    const [x, y] = q.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!inRect(nx, ny) || seen.has(key(nx, ny))) continue;
      if (!isWalkable(g.get(nx, ny)) || blocked.has(key(nx, ny))) continue;
      seen.add(key(nx, ny)); n++; q.push([nx, ny]);
    }
  }
  return n;
}

function placeSolids(g, out) {
  const key = (x, y) => x * 1000 + y;
  const taken = new Set(out.entities.map(e => key(e.x, e.y)));
  for (const d of GEO.DISTRICTS) {
    const blocked = new Set(out.entities.filter(e => e.solid).map(e => key(e.x, e.y)));
    let baseline = districtReach(g, d, blocked);
    const wants = out.wants.filter(w => w.district === d.id);
    for (const w of wants) {
      let placed = null;
      for (let r = w.ring ? 2 : 0; r <= 8 && !placed; r++) {
        for (let dy = -r; dy <= r && !placed; dy++) for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = w.anchor.x + dx, y = w.anchor.y + dy;
          if (x === d.cx && y === d.cy) continue;                 // 廣場正中留給玩家
          const t = g.get(x, y);
          if (!isWalkable(t) || t === T.FLOOR) continue;          // 門檻不站人
          if (g.get(x, y - 1) === T.FLOOR) continue;              // 門口不擋
          if (taken.has(key(x, y))) continue;
          blocked.add(key(x, y));
          if (districtReach(g, d, blocked) === baseline - 1) {
            placed = { x, y }; baseline--; taken.add(key(x, y));
            break;
          }
          blocked.delete(key(x, y));
        }
      }
      if (placed) out.entities.push({ ...w.ent, x: placed.x, y: placed.y });
    }
  }
}

// ══════════════════════════════════════════════════════════
// 世界
// ══════════════════════════════════════════════════════════
export function buildWorld(seed = 20260808) {
  const g = new Grid(W, H, T.GRASS);
  const hgt = buildHeight(seed);
  const out = {
    town: new Uint8Array(W * H),
    districtIndex: Object.fromEntries(GEO.DISTRICTS.map((d, i) => [d.id, i])),
    entities: [], wants: [], doorBack: {}, roadNames: [],
  };

  paintWater(g, hgt);
  paintTerrain(g, hgt, seed);
  for (const d of GEO.DISTRICTS) buildDistrict(g, hgt, d, out);
  // 街廓整地會把峰頂抹平；峰頂在這裡回填，華山之巔因此是全圖唯一的最高點
  for (const p of GEO.PEAKS) hgt[p.y * W + p.x] = p.h;
  carveRoads(g, out);
  dressRoads(g);

  // ── 場上的人與物 ──
  for (const d of GEO.DISTRICTS) {
    const loc = LOC_BY_ID[d.id];
    const st = STYLE[d.style];
    const deepX = d.cx + d.deep[0], deepY = d.cy + d.deep[1];
    if (loc.boss) {
      g.set(deepX, deepY, st.ground);
      g.set(deepX, deepY - 1, st.ground);
      out.entities.push({ type: 'boss', loc: d.id, x: deepX, y: deepY, name: loc.boss.title, solid: true });
      if (loc.book) out.entities.push({ type: 'book', loc: d.id, book: loc.book, x: deepX, y: deepY - 1, name: '秘笈', solid: false });
    }
    out.wants.push({
      district: d.id, anchor: { x: d.cx + 1, y: d.cy + 2 },
      ent: { type: 'sign', loc: d.id, name: '石碑', solid: true, text: loc.desc },
    });
    for (const r of (loc.recruit || [])) {
      out.wants.push({
        district: d.id, anchor: { x: d.cx, y: d.cy }, ring: true,
        ent: { type: 'recruit', loc: d.id, who: r.id, name: '？', solid: true },
      });
    }
    for (const line of (FLAVOUR[d.id] || [])) {
      out.wants.push({
        district: d.id, anchor: { x: d.cx, y: d.cy }, ring: true,
        ent: { type: 'talk', loc: d.id, text: line, name: '路人', solid: true },
      });
    }
  }

  // 擺實心 NPC 與石碑：擺上去必須「剛好只少一格走得到的地方」。
  // 一圈人圍成環會把中間封死（v2 的襄陽），一塊石碑塞住洞口一樣會（v3 的無量山瑯嬛玉洞）——
  // 這條斷言把兩者一起擋掉。
  placeSolids(g, out);

  // 渡口（東海往桃花島，唯一的非徒步移動）
  const fy = GEO.FERRY;
  for (const [me, other] of [[fy.a, fy.b], [fy.b, fy.a]]) {
    g.set(me.x, me.y, T.BRIDGE);
    LANDMARK.dock(g, me.x, me.y - 1, {});
    g.set(me.x, me.y, T.BRIDGE);
    out.entities.push({
      type: 'ferry', x: me.x, y: me.y, name: me.name, solid: false,
      to: { x: other.x, y: other.y }, toName: other.name, fare: fy.fare, hours: fy.hours,
    });
  }

  const art = articulationPoints(g.t, W, H);
  const actors = buildActors(g.t, out.town, art);

  return {
    id: 'world', name: '江湖', kind: 'world',
    w: W, h: H, tiles: g.t, height: hgt, town: out.town,
    entities: out.entities, actors, art,
    portals: [
      { from: { x: fy.a.x, y: fy.a.y }, to: { x: fy.b.x, y: fy.b.y } },
      { from: { x: fy.b.x, y: fy.b.y }, to: { x: fy.a.x, y: fy.a.y } },
    ],
    districtOrder: GEO.DISTRICTS.map(d => d.id),
    doorBack: out.doorBack,
    spawn: { ...GEO.SPAWN },
  };
}

// 閒角對白
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

// ══════════════════════════════════════════════════════════
// 建物內部
// ══════════════════════════════════════════════════════════
const INT_TILE = {
  '#': T.WALL, '.': T.FLOOR, ',': T.RUG, 'C': T.COUNTER, 'T': T.BUILDING,
  'B': T.BUILDING, '+': T.FLOOR, 'S': T.FLOOR, 'I': T.FLOOR, 'M': T.RUG, 'P': T.FLOOR,
};
const INT_ENT = { S: 'shop', I: 'inn', M: 'train', P: 'talk' };

export function buildInterior(id) {
  const [, locId, kind] = id.split(':');
  const tpl = INTERIORS[kind];
  const loc = LOC_BY_ID[locId];
  const rows = tpl.rows;
  const w = rows[0].length, h = rows.length;
  const g = new Grid(w, h, T.WALL);
  const entities = [];
  let spawn = null;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ch = rows[y][x];
    g.set(x, y, INT_TILE[ch] ?? T.WALL);
    if (ch === '+') { entities.push({ type: 'exit', x, y, name: '出去', solid: false }); spawn = { x, y: y - 1 }; }
    else if (INT_ENT[ch]) {
      const type = INT_ENT[ch];
      entities.push({
        type, x, y, solid: true,
        name: { shop: '掌櫃', inn: '店小二', train: '蒲團', talk: '住戶' }[type],
        text: type === 'talk' ? (HOUSE_LINES[locId] || '「客官走好。」') : undefined,
      });
    }
  }
  return {
    id, name: `${loc.name}．${tpl.name}`, kind: 'interior', locId,
    w, h, tiles: g.t, entities, actors: [], spawn,
    height: new Uint8Array(w * h), town: new Uint8Array(w * h).fill(1),
    encounterRate: 0,
  };
}

// ══════════════════════════════════════════════════════════
// 場景快取
// ══════════════════════════════════════════════════════════
const cache = new Map();
export function getScene(id = 'world') {
  if (!cache.has(id)) cache.set(id, id === 'world' ? buildWorld() : buildInterior(id));
  return cache.get(id);
}
export function clearSceneCache() { cache.clear(); }
export function worldScene() { return getScene('world'); }

// 門在世界上的位置（從內部走出來時要回到那一格）
export function doorPosOf(intId) { return worldScene().doorBack[intId] || null; }

// ── 查詢 ──
export function heightAt(sc, x, y) {
  if (!sc.height || x < 0 || y < 0 || x >= sc.w || y >= sc.h) return 0;
  return sc.height[y * sc.w + x];
}
export function districtAt(sc, x, y) {
  if (!sc.town || x < 0 || y < 0 || x >= sc.w || y >= sc.h) return null;
  if (sc.kind === 'interior') return sc.locId;
  const v = sc.town[y * sc.w + x];
  return v ? sc.districtOrder[v - 1] : null;
}
export function locPos(locId) {
  const d = GEO.DISTRICT_BY_ID[locId];
  return d ? { x: d.cx, y: d.cy } : { x: 0, y: 0 };
}

// 走一格的代價：地形 ＋ 爬升。城鎮街道免費。
export function stepCost(sc, fromX, fromY, x, y) {
  if (sc.kind === 'interior') return { minutes: 0, stamina: 0 };
  if (sc.town && sc.town[y * sc.w + x]) return { minutes: 0, stamina: 0 };
  const t = sc.tiles[y * sc.w + x];
  const base = TILE_COST[t] || DEFAULT_COST;
  const dh = Math.max(0, heightAt(sc, x, y) - heightAt(sc, fromX, fromY));
  return { minutes: base.m + dh * 0.9, stamina: base.s + dh * 0.012 };
}

export { LOCATIONS, LOC_BY_ID, GEO };
