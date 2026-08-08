// 走動層：碰撞、撞人觸發、尋路。純函式，Node 直接可用。

import { getScene, isWalkable, actorAt } from '../data/maps.js';

export const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

export function scene(id) { return getScene(id); }

export function tileAt(sc, x, y) {
  if (x < 0 || y < 0 || x >= sc.w || y >= sc.h) return null;
  return sc.tiles[y * sc.w + x];
}

// 會走動的 NPC：位置是步數的純函式，不必存座標，也就永遠不會跟存檔對不上。
export function actorEntities(sc, steps) {
  if (!sc.actors?.length) return [];
  return sc.actors.map(a => {
    const p = actorAt(a, steps);
    return { ...a, x: p.x, y: p.y };
  });
}

// ents 可傳入「目前仍在場」的實體清單（例如頭目已被打倒就不再擋路）
export function entityAt(sc, x, y, ents = sc.entities) {
  return ents.find(e => e.x === x && e.y === y) || null;
}

export function passable(sc, x, y, ents = sc.entities) {
  const t = tileAt(sc, x, y);
  if (t == null || !isWalkable(t)) return false;
  const e = entityAt(sc, x, y, ents);
  return !(e && e.solid);
}

// 走一步。回傳 {moved, bumped, entered}
// bumped：撞上實心 NPC（該觸發對話／商店／頭目）
// entered：踏上非實心物件（出口、入口、秘笈）
export function step(sc, pos, dir, ents = sc.entities) {
  const d = DIRS[dir];
  if (!d) return { moved: false };
  const nx = pos.x + d[0], ny = pos.y + d[1];
  const t = tileAt(sc, nx, ny);
  if (t == null || !isWalkable(t)) return { moved: false, blocked: true };
  const e = entityAt(sc, nx, ny, ents);
  if (e && e.solid) return { moved: false, bumped: e };
  return { moved: true, x: nx, y: ny, entered: e || null };
}

// BFS 最短路；回傳方向陣列。goal 可以是座標或判斷函式。
export function pathTo(sc, from, goal, opts = {}) {
  const isGoal = typeof goal === 'function'
    ? goal
    : (x, y) => x === goal.x && y === goal.y;
  // 允許終點是實心的（要撞上去的 NPC）：走到相鄰格再回報方向
  const adjacentOk = opts.adjacent !== false;
  const ents = opts.ents || sc.entities;
  // 別把出入口當中繼站走過去，否則半路就被傳送到別的場景
  const avoid = opts.avoid || new Set(['exit', 'door', 'ferry', 'book']);
  // 進不去的地方（例如秘笈未齊的華山之巔）也不能拿來抄近路，
  // 否則尋路會排出一條走到一半就被擋下來的路。
  const blocked = opts.blocked || null;
  const W = sc.w, H = sc.h;
  const prev = new Int32Array(W * H).fill(-1);
  const seen = new Uint8Array(W * H);
  const start = from.y * W + from.x;
  seen[start] = 1;
  let q = [start], head = 0;
  const order = [['up', 0, -1], ['down', 0, 1], ['left', -1, 0], ['right', 1, 0]];

  while (head < q.length) {
    const cur = q[head++];
    const cx = cur % W, cy = (cur / W) | 0;
    for (const [, dx, dy] of order) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (seen[ni]) continue;
      const t = tileAt(sc, nx, ny);
      if (t == null || !isWalkable(t)) continue;
      if (blocked && blocked(nx, ny)) continue;

      const ent = entityAt(sc, nx, ny, ents);
      if (isGoal(nx, ny)) {
        prev[ni] = cur;
        return rebuild(prev, start, ni, W);
      }
      if (ent && !ent.solid && avoid.has(ent.type)) continue;   // 非目標的傳送點繞開
      if (ent && ent.solid) {
        // 目標是實心物：走到旁邊就算到
        if (adjacentOk && isGoalEntity(ent, isGoal, nx, ny)) {
          return rebuild(prev, start, cur, W).concat(dirOf(dx, dy));
        }
        continue;
      }
      seen[ni] = 1; prev[ni] = cur; q.push(ni);
    }
  }
  return null;
}

function isGoalEntity(ent, isGoal, x, y) { return isGoal(x, y, ent); }
function dirOf(dx, dy) { return dx === 1 ? 'right' : dx === -1 ? 'left' : dy === 1 ? 'down' : 'up'; }

function rebuild(prev, start, end, W) {
  const cells = [];
  for (let c = end; c !== -1 && c !== start; c = prev[c]) cells.unshift(c);
  const out = [];
  let px = start % W, py = (start / W) | 0;
  for (const c of cells) {
    const x = c % W, y = (c / W) | 0;
    out.push(dirOf(x - px, y - py));
    px = x; py = y;
  }
  return out;
}

// 走到某個 entity（實心的話走到相鄰並回傳最後撞上去的方向）
export function pathToEntity(sc, from, pred, ents = sc.entities, opts = {}) {
  const target = ents.find(pred);
  if (!target) return null;
  if (from.x === target.x && from.y === target.y) return [];
  return pathTo(sc, from,
    (x, y, ent) => (ent ? ent === target : (x === target.x && y === target.y)), { ...opts, ents });
}

export function findEntity(sc, pred, ents = sc.entities) { return ents.find(pred) || null; }

// 從 spawn 可達的格子數（場景健全性檢查用）。渡口是圖上的一條額外邊，
// 不當它是路的話，桃花島永遠會被誤判成到不了。
export function reachableCount(sc, from, ents = sc.entities) {
  const W = sc.w, H = sc.h;
  const seen = new Uint8Array(W * H);
  const q = [from.y * W + from.x];
  seen[q[0]] = 1;
  let n = 0, head = 0;
  const portal = new Map((sc.portals || []).map(p => [p.from.y * W + p.from.x, p.to.y * W + p.to.x]));
  while (head < q.length) {
    const cur = q[head++]; n++;
    if (portal.has(cur)) {
      const j = portal.get(cur);
      if (!seen[j]) { seen[j] = 1; q.push(j); }
    }
    const cx = cur % W, cy = (cur / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (seen[ni]) continue;
      const t = tileAt(sc, nx, ny);
      if (t == null || !isWalkable(t)) continue;
      if (entityAt(sc, nx, ny, ents)?.solid) continue;
      seen[ni] = 1; q.push(ni);
    }
  }
  return { count: n, seen };
}

// entity 是否走得到（實心的算「能站到旁邊」）
export function entityReachable(sc, from, e, ents = sc.entities) {
  const { seen } = reachableCount(sc, from, ents);
  const W = sc.w;
  if (!e.solid) return !!seen[e.y * W + e.x];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = e.x + dx, ny = e.y + dy;
    if (nx < 0 || ny < 0 || nx >= sc.w || ny >= sc.h) continue;
    if (seen[ny * W + nx]) return true;
  }
  return false;
}
