// 江湖的三維場：地形高度、官道折線、可走遮罩、視線、步速。
//
// **這一層不碰 THREE，也不碰 DOM。**Node 直接 import 得動，所以「華山之巔是不是全圖
// 唯一最高點」「官道坡度有沒有超過三成」「從揚州看不看得見華山」這種事全部在無頭環境
// 驗得出來，不必開瀏覽器。畫面層（scenery/settlements/kit）才 import THREE。
//
// 這正是 src/core 與 src/ui 分家的那條線，只是搬到三維這邊再畫一次。
//
// 座標：格陣 384×288 不動（拓樸、verify、平衡表全部以格為單位）。渲染時一格 = 2 公尺，
// 所以世界是 768×576 公尺。慣例沿用 Golden Hour：+x 東、-x 西、+z 南、-z 北。

import { worldScene, T, isWalkable, TILE_COST, GEO } from '../data/maps.js';

export const S = 2;                 // 一格幾公尺——這一期唯一真正要決定的參數
export const HSCALE = 0.38;         // 高度場 0–255 → 公尺
export const SEA_RAW = -26;         // 水面下的原始高度，讓岸線是斜的而不是五公尺高的崖
export const EYE = 1.66;            // 眼高

export const W = GEO.W, H = GEO.H;
export const WORLD_W = W * S, WORLD_D = H * S;
export const PEAK_RAW = 255;

// ── 格 ↔ 公尺 ──
export const tx2x = gx => (gx - W / 2 + 0.5) * S;
export const ty2z = gy => (gy - H / 2 + 0.5) * S;
export const x2tx = X => X / S + W / 2 - 0.5;
export const z2ty = Z => Z / S + H / 2 - 0.5;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ══════════════════════════════════════════════════════════
// 1. 高度場
//    2D 的高度場是「移動耗費」用的，不是山的形狀：華山之巔在 13 格半徑內從 24 衝到 255，
//    照抄成三維就是一根針。所以這裡做三件事——把水壓到海面下讓岸線有坡、把整張圖抹一次
//    讓山有山的樣子、再把街廓重新整平（借 Golden Hour 的 FLATS）。
//    峰頂最後回填，華山之巔仍然是全圖唯一的最高點。
// ══════════════════════════════════════════════════════════

// 山頂平台 236、峰岩 255——這兩個數不是挑的，是 2D 那邊本來就有的：
// buildDistrict 把街廓抹平時封頂在 236，好讓事後回填的 255 仍是全圖唯一最高點。
// 三維這邊照抄，於是華山之巔是「一片台地上再立一塊七公尺高的岩」，
// 而不是「一片台地，中間鼓起兩公尺」——後者從遠處看會被台地自己的邊緣擋掉。
const SUMMIT_PLATEAU = 236;
const SUMMIT_KNOB_R = 4;            // 峰岩的半徑，以格計

function buildHeightField(sc) {
  const N = W * H;
  let hf = new Float32Array(N);
  for (let i = 0; i < N; i++) hf[i] = sc.tiles[i] === T.WATER ? SEA_RAW : sc.height[i];

  // 抹三次 3×3。山脈的脊線因此有肩膀，官道兩旁不再是階梯狀的鋸齒。
  let tmp = new Float32Array(N);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let s = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy; if (yy < 0 || yy >= H) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx; if (xx < 0 || xx >= W) continue;
            const wgt = (dx === 0 && dy === 0) ? 4 : 1;
            s += hf[yy * W + xx] * wgt; n += wgt;
          }
        }
        tmp[y * W + x] = s / n;
      }
    }
    const t = hf; hf = tmp; tmp = t;
    // 抹完要把水路壓回去。漢水只有一格寬，三次 3×3 之後它的 -26 會被兩岸的 +40 平均掉，
    // 河床浮到水面之上——河就這樣不見了。所以每一輪重新壓一次，兩岸仍然是斜的。
    const floor = pass < 2 ? -14 : -4;
    for (let i = 0; i < N; i++) if (sc.tiles[i] === T.WATER) hf[i] = Math.min(hf[i], floor);
  }
  return hf;
}

// FLATS：圓角矩形 SDF，把街廓重新整平。抹過之後城裡的地又有了坡度，
// 建物是一個個獨立的盒子，站在坡上會浮起來或陷進去——所以要平回去。
function buildFlats(hf) {
  const flats = [];
  for (const d of GEO.DISTRICTS) {
    const r = GEO.districtRect(d);
    const level = d.id === 'final'
      ? SUMMIT_PLATEAU                              // 山頂平台就是峰頂高度，不是抹平後的殘值
      : hf[d.cy * W + d.cx];
    flats.push({
      x: tx2x(d.cx), z: ty2z(d.cy),
      hw: (r.x1 - r.x0 + 1) / 2 * S, hd: (r.y1 - r.y0 + 1) / 2 * S,
      y: level, blend: 7 * S, id: d.id,
    });
  }
  return flats;
}

export function makeField(sc = worldScene()) {
  const hf = buildHeightField(sc);
  const FLATS = buildFlats(hf);
  const peak = GEO.PEAKS.find(p => p.name === '華山之巔');
  const peakX = tx2x(peak.x), peakZ = ty2z(peak.y);

  // 原始（未整平）高度，雙線性取樣，單位仍是 0–255
  function rawAt(X, Z) {
    const fx = clamp(x2tx(X), 0, W - 1.001), fy = clamp(z2ty(Z), 0, H - 1.001);
    const x0 = fx | 0, y0 = fy | 0, tx = fx - x0, ty = fy - y0;
    const a = hf[y0 * W + x0], b = hf[y0 * W + x0 + 1];
    const c = hf[(y0 + 1) * W + x0], d = hf[(y0 + 1) * W + x0 + 1];
    return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
  }

  // 街廓整平 + 峰頂那塊岩
  function levelledRaw(X, Z) {
    let v = rawAt(X, Z);
    for (const f of FLATS) {
      const qx = Math.abs(X - f.x) - f.hw, qz = Math.abs(Z - f.z) - f.hd;
      const d = -(Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0));
      if (d > -f.blend) v = lerp(v, f.y, smoothstep(-f.blend, 2, d));
    }
    const dp = Math.hypot(X - peakX, Z - peakZ) / S;      // 以格為單位
    if (dp < SUMMIT_KNOB_R) {
      v = Math.max(v, lerp(PEAK_RAW, SUMMIT_PLATEAU, smoothstep(0, SUMMIT_KNOB_R, dp)));
    }
    return v;
  }

  const terrainRaw = levelledRaw;
  const terrainH = (X, Z) => levelledRaw(X, Z) * HSCALE;

  return { hf, FLATS, terrainRaw, terrainH, peak: { x: peakX, z: peakZ, raw: PEAK_RAW }, sc };
}

// ══════════════════════════════════════════════════════════
// 2. 官道 —— 手置折線 → 採樣地形 → 平滑並限坡 → Catmull-Rom 重採樣 → 走廊內混向
//    這一段是從 golden-hour-engine/cities/hong_kong.js 的 makeHillRoad 搬過來的
//    （太平山盤道、大嶼山上大佛的那條），只是把 THREE.CatmullRomCurve3 換成自己算，
//    好讓這個檔能在 Node 裡跑。**這就是華山山道與武當登山道。**
// ══════════════════════════════════════════════════════════

function catmullRom(p0, p1, p2, p3, t, tension = 0.4) {
  const t2 = t * t, t3 = t2 * t;
  const out = {};
  for (const k of ['x', 'y', 'z']) {
    const v0 = (p2[k] - p0[k]) * tension, v1 = (p3[k] - p1[k]) * tension;
    out[k] = (2 * p1[k] - 2 * p2[k] + v0 + v1) * t3
           + (-3 * p1[k] + 3 * p2[k] - 2 * v0 - v1) * t2 + v0 * t + p1[k];
  }
  return out;
}

function resample(P, step) {
  if (P.length < 2) return P.slice();
  const ext = [P[0], ...P, P[P.length - 1]];
  const out = [];
  for (let i = 0; i < ext.length - 3; i++) {
    const a = ext[i], b = ext[i + 1], c = ext[i + 2], d = ext[i + 3];
    const seg = Math.max(2, Math.ceil(Math.hypot(c.x - b.x, c.z - b.z) / step));
    for (let k = 0; k < seg; k++) out.push(catmullRom(a, b, c, d, k / seg));
  }
  out.push({ ...P[P.length - 1] });
  return out;
}

/**
 * @param nodes  [[x,z],…] 公尺
 * @param opt    width 路面寬、edge 兩側混向帶、maxGrade 最大坡度、lift 抬離地面
 */
export function makeHillRoad(field, nodes, opt = {}) {
  const width = opt.width ?? 5, edge = opt.edge ?? 4.5, maxGrade = opt.maxGrade ?? 0.30;
  const P = nodes.map(([x, z]) => ({ x, z, y: field.terrainH(x, z) }));
  const y0 = P[0].y, yN = P[P.length - 1].y;
  const seglen = i => Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z);
  for (let it = 0; it < 60; it++) {
    for (let i = 1; i < P.length - 1; i++) P[i].y = P[i].y * 0.4 + (P[i - 1].y + P[i + 1].y) * 0.3;
    P[0].y = y0; P[P.length - 1].y = yN;
    for (let i = 1; i < P.length; i++) { const m = maxGrade * seglen(i), d = P[i].y - P[i - 1].y; if (Math.abs(d) > m) P[i].y = P[i - 1].y + Math.sign(d) * m; }
    for (let i = P.length - 2; i >= 0; i--) { const m = maxGrade * seglen(i + 1), d = P[i].y - P[i + 1].y; if (Math.abs(d) > m) P[i].y = P[i + 1].y + Math.sign(d) * m; }
  }
  const pts = resample(P, 3);
  // 石階不是公路：每一階的升幅是一樣的。與其指望限坡迴圈去磨（端點每輪都被釘回地面，
  // 最後一段永遠磨不平），不如直接照弧長把高度攤開——坡度於是恰好等於 爬升／路長，
  // 是一個算得出來、驗得到的數，不是一個希望。
  if (opt.profile === 'even') {
    const seg = [0];
    for (let i = 1; i < pts.length; i++) seg[i] = seg[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    const total = seg[seg.length - 1] || 1;
    for (let i = 0; i < pts.length; i++) pts[i].y = lerp(y0, yN, seg[i] / total);
  }
  let bx0 = 1e9, bx1 = -1e9, bz0 = 1e9, bz1 = -1e9;
  for (const p of pts) { bx0 = Math.min(bx0, p.x); bx1 = Math.max(bx1, p.x); bz0 = Math.min(bz0, p.z); bz1 = Math.max(bz1, p.z); }
  const pad = width / 2 + edge + 2; bx0 -= pad; bx1 += pad; bz0 -= pad; bz1 += pad;
  const HALF = width / 2, OUT = HALF + edge;

  function heightAt(X, Z) {
    if (X < bx0 || X > bx1 || Z < bz0 || Z > bz1) return null;
    let bd = 1e9, by = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1;
      let t = ((X - a.x) * dx + (Z - a.z) * dz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(X - (a.x + dx * t), Z - (a.z + dz * t));
      if (d < bd) { bd = d; by = a.y + (b.y - a.y) * t; }
    }
    if (bd > OUT) return null;
    return { y: by, blend: smoothstep(OUT, HALF, bd), dist: bd };
  }
  let length = 0;
  for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  let grade = 0;
  for (let i = 1; i < pts.length; i++) {
    const L = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z) || 1e-6;
    grade = Math.max(grade, Math.abs(pts[i].y - pts[i - 1].y) / L);
  }
  return { pts, heightAt, length, grade, width, edge, bounds: { bx0, bx1, bz0, bz1 }, name: opt.name || '' };
}

// ── 華山山道：不是官道，是鑿在岩壁上的石階 ──
// 從華山山門（164,120）繞到南面，之字上到山頂平台（158,96）。峰頂比山門高約四十公尺，
// 限坡三成就得走一百四十公尺以上的路——所以是三段折返，不是一條直線。
// 五段折返。之字之間在平面上至少隔三格，走廊才不會併成一片——否則整面崖都變成可走的，
// 玩家直接爬上去，折返就白做了。這條規矩比坡度更容易漏掉。
const HUASHAN_STAIR = [
  [165, 110], [151, 106], [169, 103], [152, 100], [167, 98], [158, 96],
];

// 官道折線：端點與路口沿用 world/jianghu.js 的資料，一格不改。
function roadNodes() {
  const P = name => {
    if (GEO.NODES[name]) return GEO.NODES[name];
    const d = GEO.DISTRICT_BY_ID[name];
    return [d.cx, d.cy];
  };
  const out = [];
  for (const r of GEO.ROADS) {
    if (r.a === 'huashan' && r.b === 'final') continue;      // 山道另外走
    out.push({ id: `${r.a}-${r.b}`, kind: 'road', nodes: [P(r.a), ...r.via, P(r.b)] });
  }
  out.push({ id: 'huashan-stair', kind: 'stair', nodes: HUASHAN_STAIR });
  const cw = GEO.CAUSEWAY;
  out.push({ id: 'junshan-causeway', kind: 'causeway', nodes: [cw.from, cw.to] });
  return out;
}

export function buildRoads(field) {
  const roads = [];
  for (const r of roadNodes()) {
    const nodes = r.nodes.map(([gx, gy]) => [tx2x(gx), ty2z(gy)]);
    const opt = r.kind === 'stair'
      ? { width: 3.0, edge: 1.6, maxGrade: 0.30, profile: 'even', name: r.id }
      : r.kind === 'causeway'
        ? { width: 6, edge: 3, maxGrade: 0.05, name: r.id }
        : { width: 5.4, edge: 5, maxGrade: 0.22, name: r.id };
    const road = makeHillRoad(field, nodes, opt);
    road.id = r.id; road.kind = r.kind;
    roads.push(road);
  }
  return roads;
}

// 地面高度 = 地形，被官道走廊往路面混過去
export function makeGround(field, roads) {
  return function groundH(X, Z) {
    let t = field.terrainH(X, Z);
    for (const r of roads) {
      const h = r.heightAt(X, Z);
      if (h) t = lerp(t, h.y, h.blend);
    }
    return t;
  };
}

// ══════════════════════════════════════════════════════════
// 3. 可走遮罩
//    底是 2D 的 isWalkable（拓樸就是那張已經驗過 87 項的圖），再把三維這邊自己開的
//    山道走廊蓋成可走——不然限坡折返出來的之字會被 ROCK 擋住，等於沒開路。
// ══════════════════════════════════════════════════════════
export const MAX_WALK_SLOPE = 0.80;      // 約 39°，人爬得上去的極限

export function buildWalkMask(field, roads, groundH) {
  const sc = field.sc;
  const N = W * H;
  const mask = new Uint8Array(N);
  for (let i = 0; i < N; i++) mask[i] = isWalkable(sc.tiles[i]) ? 1 : 0;

  // ── 坡度也要算進去 ──
  // 2D 的高度場是移動耗費用的，格子平不平它不管：華山山頂那片台地在格子上是「雪地，可走」，
  // 而它四周十四公尺內就掉六十公尺。只照格子走，玩家會沿著一面 5:1 的崖直接爬上論劍台，
  // 折返的山道就白開了。**三維的地面說了不算，格子也說了不算——兩個都要點頭。**
  if (groundH) {
    const e = 1.6;
    for (let gy = 1; gy < H - 1; gy++) for (let gx = 1; gx < W - 1; gx++) {
      const i = gy * W + gx;
      if (!mask[i]) continue;
      const X = tx2x(gx), Z = ty2z(gy);
      const s = Math.hypot(groundH(X + e, Z) - groundH(X - e, Z), groundH(X, Z + e) - groundH(X, Z - e)) / (2 * e);
      if (s > MAX_WALK_SLOPE) mask[i] = 0;
    }
  }

  for (const r of roads) {
    // 路面走廊一律蓋回可走：走廊裡的地形已經被混平了，那裡就是路。
    // 官道在 2D 本來就會鑿穿山，蓋回去不算多開門。
    // 用「到中心線的距離」蓋，不是用方框蓋。方框會把折返之間的縫填滿，整面崖就都能走了。
    // 官道蓋回整條混向帶（走廊裡的地形已經被拉平，那整塊都站得住）；
    // 山道只蓋路面本身，之字之間的縫要留著，不然折返白做。
    // 這條寬窄之分是有代價的：一開始官道也只蓋路面，結果坡度遮罩把 2D 的階梯狀路面
    // 跟三維的平滑折線之間那幾格切斷，洞庭與福威整個掉出連通圖。
    const b = r.bounds, half = r.kind === 'stair' ? r.width / 2 : r.width / 2 + r.edge;
    const gx0 = Math.max(1, Math.floor(x2tx(b.bx0))), gx1 = Math.min(W - 2, Math.ceil(x2tx(b.bx1)));
    const gy0 = Math.max(1, Math.floor(z2ty(b.bz0))), gy1 = Math.min(H - 2, Math.ceil(z2ty(b.bz1)));
    for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) {
      if (sc.tiles[gy * W + gx] === T.WATER && r.kind !== 'causeway') continue;
      const X = tx2x(gx), Z = ty2z(gy);
      let best = 1e9;
      for (let i = 0; i < r.pts.length - 1; i++) {
        const a = r.pts[i], c = r.pts[i + 1];
        const dx = c.x - a.x, dz = c.z - a.z, L2 = dx * dx + dz * dz || 1;
        let t = ((X - a.x) * dx + (Z - a.z) * dz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = Math.hypot(X - (a.x + dx * t), Z - (a.z + dz * t));
        if (d < best) best = d;
      }
      if (best <= half) mask[gy * W + gx] = 1;
    }
  }
  return mask;
}

export function walkableAt(mask, X, Z) {
  const gx = Math.round(x2tx(X)), gy = Math.round(z2ty(Z));
  if (gx < 0 || gy < 0 || gx >= W || gy >= H) return false;
  return mask[gy * W + gx] === 1;
}

// 半徑取樣：人不是一個點，四個角都得站得住
export function canStand(mask, X, Z, r = 0.42) {
  return walkableAt(mask, X - r, Z - r) && walkableAt(mask, X + r, Z - r)
      && walkableAt(mask, X - r, Z + r) && walkableAt(mask, X + r, Z + r);
}

// ── 遮罩上的連通：verify 用來斷言「走得到」 ──
export function reachable(mask, from, to) {
  const N = W * H;
  const seen = new Uint8Array(N);
  const start = from.y * W + from.x, goal = to.y * W + to.x;
  if (!mask[start]) return { ok: false, why: 'start not walkable' };
  const q = new Int32Array(N); let head = 0, tail = 0;
  q[tail++] = start; seen[start] = 1;
  while (head < tail) {
    const cur = q[head++];
    if (cur === goal) return { ok: true, visited: tail };
    const cx = cur % W, cy = (cur / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (seen[ni] || !mask[ni]) continue;
      seen[ni] = 1; q[tail++] = ni;
    }
  }
  return { ok: false, visited: tail, why: 'no path' };
}

// 遮罩上的最短路（給自走測試用；不是玩家用的——玩家只有兩條腿跟眼睛）
export function routeOn(mask, from, to) {
  const N = W * H;
  const prev = new Int32Array(N).fill(-1);
  const seen = new Uint8Array(N);
  const start = from.y * W + from.x, goal = to.y * W + to.x;
  if (!mask[start] || !mask[goal]) return null;
  const q = new Int32Array(N); let head = 0, tail = 0;
  q[tail++] = start; seen[start] = 1;
  while (head < tail) {
    const cur = q[head++];
    if (cur === goal) break;
    const cx = cur % W, cy = (cur / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (seen[ni] || !mask[ni]) continue;
      seen[ni] = 1; prev[ni] = cur; q[tail++] = ni;
    }
  }
  if (!seen[goal]) return null;
  const out = [];
  for (let c = goal; c !== -1; c = prev[c]) out.unshift({ x: c % W, y: (c / W) | 0 });
  return out;
}

// 照「走得多快」排路，不是照「格數最少」排。
// 格數最少的路會直接切過草坡與碎石，那不是人會走的路——人走官道。
// 自走測試與「一趟要走多久」都用這條。
export function routeFast(mask, speedAt, groundH, from, to) {
  const N = W * H;
  const dist = new Float64Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const done = new Uint8Array(N);
  const start = from.y * W + from.x, goal = to.y * W + to.x;
  if (!mask[start] || !mask[goal]) return null;
  // 二元堆，110k 格用陣列排序會慢到不能在 CI 跑
  const heap = [start]; dist[start] = 0;
  const keyOf = i => dist[i];
  const up = i => { while (i > 0) { const p = (i - 1) >> 1; if (keyOf(heap[p]) <= keyOf(heap[i])) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const down = i => {
    for (;;) {
      const l = i * 2 + 1, r = l + 1; let m = i;
      if (l < heap.length && keyOf(heap[l]) < keyOf(heap[m])) m = l;
      if (r < heap.length && keyOf(heap[r]) < keyOf(heap[m])) m = r;
      if (m === i) break;
      [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
    }
  };
  const cellSecs = i => {
    const gx = i % W, gy = (i / W) | 0;
    return S / Math.max(0.12, speedAt(tx2x(gx), ty2z(gy), groundH));
  };
  while (heap.length) {
    const cur = heap[0];
    heap[0] = heap[heap.length - 1]; heap.pop(); if (heap.length) down(0);
    if (done[cur]) continue;
    done[cur] = 1;
    if (cur === goal) break;
    const cx = cur % W, cy = (cur / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (done[ni] || !mask[ni]) continue;
      const nd = dist[cur] + cellSecs(ni);
      if (nd < dist[ni]) { dist[ni] = nd; prev[ni] = cur; heap.push(ni); up(heap.length - 1); }
    }
  }
  if (!Number.isFinite(dist[goal])) return null;
  const out = [];
  for (let c = goal; c !== -1; c = prev[c]) out.unshift({ x: c % W, y: (c / W) | 0 });
  out.seconds = dist[goal];
  return out;
}

// ══════════════════════════════════════════════════════════
// 4. 視線 —— 「為什麼要用走的，不是開地圖」的那個前提
//    從 A 的眼睛看得見 B 的頂嗎？沿線取樣地形剖面，看有沒有東西擋住。
// ══════════════════════════════════════════════════════════
export function lineOfSight(groundH, from, to, opt = {}) {
  const eye = opt.eye ?? EYE, targetUp = opt.targetUp ?? 0;
  const ax = from.x, az = from.z, bx = to.x, bz = to.z;
  const dist = Math.hypot(bx - ax, bz - az);
  const ay = groundH(ax, az) + eye, by = groundH(bx, bz) + targetUp;
  const steps = Math.max(16, Math.ceil(dist / 3));
  let worst = Infinity, worstAt = 0;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = lerp(ax, bx, t), z = lerp(az, bz, t);
    const ray = lerp(ay, by, t);
    const clearance = ray - groundH(x, z);
    if (clearance < worst) { worst = clearance; worstAt = t * dist; }
  }
  return {
    visible: worst > 0, clearance: worst, blockedAt: worstAt, dist,
    elevationDeg: Math.atan2(by - ay, dist) * 180 / Math.PI,
  };
}

// ══════════════════════════════════════════════════════════
// 5. 步速 —— 官道便宜、跨野貴，用腳底感覺，不是用累加的數字
//    數值直接沿用 data/maps.js 的 TILE_COST，只換一個傳達方式。
// ══════════════════════════════════════════════════════════
export const ROAD_SPEED = 1.55;     // 公尺／秒。官道一天約 120 格 ≈ 240 公尺 ≈ 三分半實時
const ROAD_M = TILE_COST[T.ROAD].m;

export function makeSpeed(field, mask) {
  const sc = field.sc;
  return function speedAt(X, Z, groundH) {
    const gx = clamp(Math.round(x2tx(X)), 0, W - 1), gy = clamp(Math.round(z2ty(Z)), 0, H - 1);
    const t = sc.tiles[gy * W + gx];
    const cost = TILE_COST[t] || { m: 30 };
    // 街道、地板、地毯在 2D 的代價是 0——那是「在城裡逛街不推時辰」的意思，不是「瞬移」。
    // 直接拿來當分母會得到 Infinity：走一步位移無限大，碰撞判定當然不給過，
    // 人就永遠釘在揚州南牆上。自走測試第一次跑只走了 11 公尺，就是死在這裡。
    const m = cost.m > 0 ? cost.m : ROAD_M * 0.9;
    // 代價比壓過一次：2D 的 12 : 28 差得太兇，走起來像泥沼；開 0.6 次方仍然「官道快一截」
    let v = ROAD_SPEED * Math.pow(ROAD_M / m, 0.6);
    if (groundH) {
      const e = 1.2;
      const gxs = (groundH(X + e, Z) - groundH(X - e, Z)) / (2 * e);
      const gzs = (groundH(X, Z + e) - groundH(X, Z - e)) / (2 * e);
      const slope = Math.hypot(gxs, gzs);
      v /= (1 + slope * 1.9);            // 上坡下坡都慢；爬華山真的費力
    }
    return v;
  };
}

// ── 十五處地點的世界座標，畫面與測試共用 ──
export const PLACES = GEO.DISTRICTS.map(d => ({
  id: d.id, gx: d.cx, gy: d.cy, x: tx2x(d.cx), z: ty2z(d.cy),
  w: d.w * S, d: d.h * S, style: d.style,
}));
export const PLACE_BY_ID = Object.fromEntries(PLACES.map(p => [p.id, p]));
export const SPAWN = { gx: GEO.SPAWN.x, gy: GEO.SPAWN.y, x: tx2x(GEO.SPAWN.x), z: ty2z(GEO.SPAWN.y) };

export { T, isWalkable, GEO, clamp, lerp, smoothstep };
