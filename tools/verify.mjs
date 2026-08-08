// 無頭驗證：資料完整性、一層世界的健全性、跨場景連通性、日夜與代價、
// 確定性、戰鬥平衡、主線可徒步通關。
// 用法：node tools/verify.mjs [--quiet] [--seeds=N]

import { SKILLS, SKILL_BY_ID } from '../src/data/skills.js';
import { ITEMS, ITEM_BY_ID, QUEST_BOOKS } from '../src/data/items.js';
import { ALLIES, ENEMIES, ENEMY_BY_ID, ALLY_BY_ID, PLAYER_TEMPLATE, cloneChar } from '../src/data/chars.js';
import { LOCATIONS, LOC_BY_ID } from '../src/data/world/locations.js';
import * as GEO from '../src/data/world/jianghu.js';
import { INTERIORS } from '../src/data/interiors.js';
import {
  getScene, isWalkable, isRoad, T, W, H, TILE_COST, stepCost,
  districtAt, heightAt, locPos, actorAt, articulationPoints,
} from '../src/data/maps.js';
import * as F from '../src/core/field.js';
import { maxHp, maxMp, canLearn, moveRange, computeDamage, computeHeal } from '../src/core/rules.js';
import { createBattle, tryFlee } from '../src/core/battle.js';
import { autoBattle } from '../src/core/ai.js';
import * as G from '../src/core/game.js';

const args = process.argv.slice(2);
const SEEDS = Number(args.find(a => a.startsWith('--seeds='))?.split('=')[1] || 12);
const QUIET = args.includes('--quiet');

let pass = 0, fail = 0;
const fails = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; if (!QUIET) console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; fails.push(name + (detail ? ' — ' + detail : '')); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
const section = t => console.log(`\n${t}`);
const flat = { chance: () => false, range: () => 0, next: () => 0.5, int: () => 0 };

const world = getScene('world');
const doorEnts = world.entities.filter(e => e.type === 'door');
const interiorIds = doorEnts.map(e => e.to);

// ─────────────────────────────────────────────
section('【一】資料完整性');
{
  const skillIds = new Set(SKILLS.map(s => s.id));
  const itemIds = new Set(ITEMS.map(i => i.id));
  const locIds = new Set(LOCATIONS.map(l => l.id));

  check('武功 id 無重複', skillIds.size === SKILLS.length, `${SKILLS.length} 門`);
  check('物品 id 無重複', itemIds.size === ITEMS.length, `${ITEMS.length} 件`);

  const allChars = [PLAYER_TEMPLATE, ...ALLIES, ...ENEMIES];
  const badSkill = allChars.flatMap(c => c.skills.filter(s => !skillIds.has(s.id)).map(s => `${c.name}:${s.id}`));
  check('人物所帶武功皆存在', badSkill.length === 0, badSkill.join(','));
  const badEquip = allChars.flatMap(c => Object.values(c.equip || {}).filter(i => !itemIds.has(i)).map(i => `${c.name}:${i}`));
  check('人物裝備皆存在', badEquip.length === 0, badEquip.join(','));
  check('秘笈所授武功皆存在', ITEMS.filter(i => i.teaches && !skillIds.has(i.teaches)).length === 0);
  check('主線秘笈共 14 部', QUEST_BOOKS.length === 14);

  const placed = LOCATIONS.map(l => l.book).filter(Boolean);
  check('十四部秘笈各有藏處', new Set(placed).size === 14 && QUEST_BOOKS.every(b => placed.includes(b)));

  const asym = [];
  for (const l of LOCATIONS) for (const x of l.links) {
    if (!locIds.has(x)) asym.push(`${l.id}->${x}(不存在)`);
    else if (!LOC_BY_ID[x].links.includes(l.id)) asym.push(`${l.id}->${x}(單向)`);
  }
  check('地點連線雙向且皆存在', asym.length === 0, asym.join(','));

  const badEnemy = LOCATIONS.flatMap(l => [...(l.boss?.enemies || []), ...(l.mobs || [])]
    .filter(e => !ENEMY_BY_ID[e]).map(e => `${l.id}:${e}`));
  check('地點敵人皆存在', badEnemy.length === 0, badEnemy.join(','));
  const badRecruit = LOCATIONS.flatMap(l => (l.recruit || []).filter(r => !ALLY_BY_ID[r.id]).map(r => `${l.id}:${r.id}`));
  check('可招募人物皆存在', badRecruit.length === 0, badRecruit.join(','));
  const recruitable = new Set(LOCATIONS.flatMap(l => (l.recruit || []).map(r => r.id)));
  check('每位同伴都有招募地點', ALLIES.every(a => recruitable.has(a.id)),
    ALLIES.filter(a => !recruitable.has(a.id)).map(a => a.name).join(','));
  const badShop = LOCATIONS.flatMap(l => (l.shop || []).filter(i => !itemIds.has(i)).map(i => `${l.id}:${i}`));
  check('商店貨品皆存在', badShop.length === 0, badShop.join(','));

  const unlearnable = QUEST_BOOKS.map(b => SKILL_BY_ID[ITEM_BY_ID[b].teaches])
    .filter(sk => ![PLAYER_TEMPLATE, ...ALLIES].some(c => c.apt >= sk.apt));
  check('每部秘笈都有人學得會', unlearnable.length === 0, unlearnable.map(s => s.name).join(','));

  const spikes = LOCATIONS.filter(l => l.boss && l.mobs).map(l => {
    const bossLvl = Math.max(...l.boss.enemies.map(e => ENEMY_BY_ID[e].lvl));
    const mobLvl = Math.max(...l.mobs.map(m => ENEMY_BY_ID[m].lvl));
    return { name: l.name, bossLvl, mobLvl };
  }).filter(x => x.mobLvl > x.bossLvl);
  check('各地雜兵不強過該地頭目', spikes.length === 0,
    spikes.map(s => `${s.name} 雜兵${s.mobLvl}>頭目${s.bossLvl}`).join(','));

  // 手寫的地理資料本身
  check('十五處地點都在地圖上有街廓', GEO.DISTRICTS.length === LOCATIONS.length,
    `${GEO.DISTRICTS.length}/${LOCATIONS.length}`);
  const overlap = [];
  for (let i = 0; i < GEO.DISTRICTS.length; i++) for (let j = i + 1; j < GEO.DISTRICTS.length; j++) {
    const a = GEO.districtRect(GEO.DISTRICTS[i]), b = GEO.districtRect(GEO.DISTRICTS[j]);
    if (a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1) {
      overlap.push(`${GEO.DISTRICTS[i].id}×${GEO.DISTRICTS[j].id}`);
    }
  }
  check('街廓彼此不重疊', overlap.length === 0, overlap.join(','));
  const outOfBounds = GEO.DISTRICTS.filter(d => {
    const r = GEO.districtRect(d);
    return r.x0 < 2 || r.y0 < 2 || r.x1 > W - 3 || r.y1 > H - 3;
  });
  check('街廓都在圖內', outOfBounds.length === 0, outOfBounds.map(d => d.id).join(','));
  const badRoad = GEO.ROADS.filter(r =>
    ![r.a, r.b].every(n => GEO.DISTRICT_BY_ID[n] || GEO.NODES[n]));
  check('官道端點皆有定義', badRoad.length === 0, badRoad.map(r => `${r.a}-${r.b}`).join(','));
  // 原著相對位置：華山在西、桃花島在東海、大理在西南、光明頂最西
  const P = id => GEO.DISTRICT_BY_ID[id];
  check('原著方位對得上（華山在西、桃花島東海、大理西南、光明頂最西）',
    P('huashan').cx < P('shaolin').cx && P('taohua').cx > P('yangzhou').cx
    && P('tianlong').cx < P('xiangyang').cx && P('tianlong').cy > P('xiangyang').cy
    && P('guangming').cx === Math.min(...GEO.DISTRICTS.map(d => d.cx))
    && P('gumu').cy === Math.min(...GEO.DISTRICTS.map(d => d.cy)));
}

// ─────────────────────────────────────────────
section('【二】一層世界（走得到嗎）');
{
  check('世界是一張 384×288 的圖', world.w === 384 && world.h === 288 && world.kind === 'world',
    `${world.w}×${world.h}，約 ${(world.w * world.h / 1000).toFixed(0)}k 格`);
  check('記憶體開銷可忽略（四層 Uint8Array）', world.tiles.length + world.height.length + world.town.length < 400_000,
    `${((world.tiles.length + world.height.length + world.town.length) / 1024).toFixed(0)}KB`);

  const { seen, count } = F.reachableCount(world, world.spawn);
  const walkable = world.tiles.reduce((n, t) => n + (isWalkable(t) ? 1 : 0), 0);
  const pct = count / (world.w * world.h);
  check('可行走區域佔比合理（25%–75%）', pct > 0.25 && pct < 0.75, `${(pct * 100).toFixed(0)}%（${count} 格）`);
  check('可走的地方幾乎都連在一起', count / walkable > 0.95,
    `可走 ${walkable}、走得到 ${count}（${(count / walkable * 100).toFixed(1)}%）`);

  const unreachable = GEO.DISTRICTS.filter(d => !seen[d.cy * world.w + d.cx]);
  check('自出生點可徒步（或渡船）走到每一處地點', unreachable.length === 0,
    unreachable.map(d => d.id).join(',') || `${GEO.DISTRICTS.length} 處全通`);

  const g0 = G.newGame('起點測試', 1);
  const openDirs = ['up', 'down', 'left', 'right'].filter(d => {
    const [dx, dy] = F.DIRS[d];
    return F.passable(world, g0.pos.x + dx, g0.pos.y + dy, world.entities);
  });
  check('新遊戲的出生點就在世界出生點上',
    g0.pos.x === world.spawn.x && g0.pos.y === world.spawn.y, `(${g0.pos.x},${g0.pos.y})`);
  check('出生點站在官道上', isRoad(world.tiles[g0.pos.y * world.w + g0.pos.x]));
  const toTown = F.pathTo(world, world.spawn, locPos('yangzhou'), { ents: world.entities });
  check('出生點四周走得動（不會一開場就卡住）', openDirs.length >= 2, `可走方向 ${openDirs.join('、') || '無'}`);
  check('一開場往北走沒幾步就進得了揚州城', toTown && toTown.length < 40,
    toTown ? `${toTown.length} 步` : '走不到');

  // 沒有城鎮場景切換了，尋路自然不會半路被傳送
  check('世界上沒有任何會把人傳走的城門', world.entities.filter(e => e.type === 'gate').length === 0);

  // 每個街廓裡走得上去的格子，都得走得回出生點
  const pockets = [];
  for (const d of GEO.DISTRICTS) {
    const r = GEO.districtRect(d);
    let bad = 0, sample = null;
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
      if (!F.passable(world, x, y, world.entities)) continue;
      if (!seen[y * world.w + x]) { bad++; if (!sample) sample = `(${x},${y})`; }
    }
    if (bad) pockets.push(`${LOC_BY_ID[d.id].name} ${bad} 格 例如${sample}`);
  }
  check('街廓中沒有走得進去卻出不來的死角', pockets.length === 0, pockets.join(' | '));

  // 每個地點的頭目、秘笈、可招募之人都在，也走得到
  const problems = [];
  for (const loc of LOCATIONS) {
    const ents = world.entities.filter(e => districtAt(world, e.x, e.y) === loc.id);
    if (loc.boss && !ents.some(e => e.type === 'boss')) problems.push(`${loc.name}:無頭目`);
    if (loc.book && !ents.some(e => e.type === 'book')) problems.push(`${loc.name}:無秘笈`);
    for (const r of (loc.recruit || [])) {
      if (!ents.some(e => e.type === 'recruit' && e.who === r.id)) problems.push(`${loc.name}:缺${r.id}`);
    }
    for (const e of ents) {
      if (!F.entityReachable(world, world.spawn, e)) problems.push(`${loc.name}:${e.type}走不到`);
    }
  }
  check('每個地點的人與物都走得到，且該有的都在', problems.length === 0, problems.join(' | '));

  // 打倒頭目後秘笈都拿得到
  const gAll = G.newGame('探路', 2);
  for (const l of LOCATIONS) gAll.flags['cleared:' + l.id] = true;
  const stillBlocked = LOCATIONS.filter(l => l.book).filter(loc => {
    const bk = world.entities.find(e => e.type === 'book' && districtAt(world, e.x, e.y) === loc.id);
    return !bk || !F.entityReachable(world, world.spawn, bk, G.activeEntities(gAll, world));
  });
  check('打倒頭目後秘笈都拿得到', stillBlocked.length === 0, stillBlocked.map(l => l.name).join(','));
}

// ─────────────────────────────────────────────
section('【三】高度場、代價、日夜');
{
  let max = -1, at = null, ties = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const h = heightAt(world, x, y);
    if (h > max) { max = h; at = { x, y }; ties = 1; }
    else if (h === max) ties++;
  }
  const peak = GEO.PEAKS.find(p => p.name === '華山之巔');
  check('華山之巔就是全圖唯一的最高點', ties === 1 && at.x === peak.x && at.y === peak.y,
    `高度 ${max} 於 (${at.x},${at.y})，並列 ${ties} 處`);
  check('終局在地圖上是有實體的（華山之巔的街廓就在峰上）',
    districtAt(world, peak.x, peak.y) === 'final');

  // 官道便宜、跨野貴、上坡更貴——世界大三倍，旅程長度才不會跟著漲三倍
  const roadTile = { m: TILE_COST[T.ROAD].m, s: TILE_COST[T.ROAD].s };
  const wildTile = { m: TILE_COST[T.GRASS].m, s: TILE_COST[T.GRASS].s };
  check('沿官道走比跨野便宜一倍以上', wildTile.m / roadTile.m >= 2 && wildTile.s / roadTile.s >= 2,
    `官道 ${roadTile.m} 分/${roadTile.s} 體力，草地 ${wildTile.m} 分/${wildTile.s} 體力`);
  check('官道一天走得完約 120 格（世界放大三倍，旅程天數不變）',
    Math.round(1440 / roadTile.m) >= 100 && Math.round(1440 / roadTile.m) <= 140,
    `${Math.round(1440 / roadTile.m)} 格/日`);
  // 上坡真的比較累
  const flatCost = stepCost(world, 306, 161, 306, 160);
  let uphill = null;
  for (let y = 1; y < H - 1 && !uphill; y++) for (let x = 1; x < W - 1; x++) {
    if (districtAt(world, x, y) || !isWalkable(world.tiles[y * world.w + x])) continue;
    if (heightAt(world, x, y) - heightAt(world, x, y + 1) > 20 && isWalkable(world.tiles[(y + 1) * world.w + x])) {
      uphill = stepCost(world, x, y + 1, x, y); break;
    }
  }
  check('上山比走平地耗體力', !uphill || uphill.stamina > flatCost.stamina + 0.1,
    uphill ? `上坡 ${uphill.stamina.toFixed(2)} vs 平地 ${flatCost.stamina.toFixed(2)}` : '找不到夠陡的坡');
  check('城鎮街道上逛街不耗體力也不推時辰',
    stepCost(world, 306, 142, 306, 141).stamina === 0 && stepCost(world, 306, 142, 306, 141).minutes === 0);

  // 日夜是系統不是濾鏡
  const gd = G.newGame('日夜', 5);
  gd.clock = 12 * 60;
  const gn = G.newGame('日夜', 5);
  gn.clock = 22 * 60;
  check('白天與夜裡的時辰判斷正確', !G.isNight(gd) && G.isNight(gn),
    `${G.timeLabel(gd)} / ${G.timeLabel(gn)}`);
  const rateDay = G.encounterRate(gd, world, 306, 161);
  const rateNight = G.encounterRate(gn, world, 306, 161);
  check('夜路遭遇率高於白天', rateNight > rateDay * 1.5,
    `白天 ${(rateDay * 100).toFixed(1)}% → 夜裡 ${(rateNight * 100).toFixed(1)}%`);
  check('夜裡的敵人略強', G.nightScale(gn) > 1 && G.nightScale(gd) === 1, `×${G.nightScale(gn)}`);
  const gClosed = G.newGame('打烊', 5); gClosed.clock = 2 * 60;
  const gOpen = G.newGame('營業', 5); gOpen.clock = 14 * 60;
  check('客棧深夜打烊、白天開門', !G.innOpen(gClosed) && G.innOpen(gOpen));
  const gSleep = G.newGame('住店', 5);
  gSleep.pos = { ...locPos('yangzhou') }; gSleep.clock = 20 * 60; gSleep.gold = 500;
  const innRes = G.inn(gSleep);
  check('住店會睡到隔日清晨', innRes.ok && G.dayOf(gSleep) === 2 && Math.floor(G.hourOf(gSleep)) === 7,
    `第 ${G.dayOf(gSleep)} 天 ${G.timeLabel(gSleep)}`);
  const gCamp = G.newGame('露宿', 5); gCamp.clock = 21 * 60; gCamp.stamina = 20;
  G.camp(gCamp);
  check('野外露宿可以熬到天亮', !G.isNight(gCamp) && gCamp.stamina > 20,
    `${G.timeLabel(gCamp)}，體力 ${gCamp.stamina}`);
}

// ─────────────────────────────────────────────
section('【四】建物內部與跨場景連通性');
{
  const { seen } = F.reachableCount(world, world.spawn);
  // 門是死路端點：恰好一個可行走的世界鄰格，且那一格永遠不是道路格
  const badDoors = [];
  for (const e of doorEnts) {
    const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .map(([dx, dy]) => ({ x: e.x + dx, y: e.y + dy }))
      .filter(p => isWalkable(world.tiles[p.y * world.w + p.x]));
    if (nb.length !== 1) badDoors.push(`(${e.x},${e.y}) 有 ${nb.length} 個鄰格`);
    else if (isRoad(world.tiles[e.y * world.w + e.x])) badDoors.push(`(${e.x},${e.y}) 門格是道路`);
  }
  check('每一扇門都是死路端點（恰好一個鄰格，且門格不是道路）', badDoors.length === 0,
    badDoors.slice(0, 4).join(' | ') || `${doorEnts.length} 扇門`);

  check('內部場景全部小且手寫（8×8 到 12×9）',
    Object.values(INTERIORS).every(t => t.rows.length >= 8 && t.rows.length <= 9
      && t.rows[0].length >= 8 && t.rows[0].length <= 12
      && t.rows.every(r => r.length === t.rows[0].length)),
    Object.entries(INTERIORS).map(([k, v]) => `${k} ${v.rows[0].length}×${v.rows.length}`).join('、'));
  check('每個內部樣板恰好一個出口',
    Object.values(INTERIORS).every(t => t.rows.join('').split('+').length - 1 === 1));

  // 連通性得是跨場景的圖：門從出生點走得到，掌櫃從門走得到
  const crossFails = [];
  const kindsSeen = new Set();
  for (const e of doorEnts) {
    if (!seen[e.y * world.w + e.x]) { crossFails.push(`${e.to} 的門從出生點走不到`); continue; }
    const sc = getScene(e.to);
    kindsSeen.add(e.kind);
    if (!sc.entities.some(x => x.type === 'exit')) { crossFails.push(`${e.to} 沒有出口`); continue; }
    for (const inner of sc.entities) {
      if (!F.entityReachable(sc, sc.spawn, inner)) crossFails.push(`${e.to}:${inner.type} 從門走不到`);
    }
  }
  check('跨場景連通：每一扇門都走得到，門後每一個人也走得到', crossFails.length === 0,
    crossFails.slice(0, 4).join(' | ') || `${interiorIds.length} 個內部場景`);

  // 每一位掌櫃、店小二都真的在某扇門後面
  const shopLocs = LOCATIONS.filter(l => l.shop).map(l => l.id);
  const innLocs = LOCATIONS.filter(l => l.inn != null).map(l => l.id);
  const haveShop = new Set(doorEnts.filter(e => e.kind === 'shop').map(e => districtAt(world, e.x, e.y)));
  const haveInn = new Set(doorEnts.filter(e => e.kind === 'inn').map(e => districtAt(world, e.x, e.y)));
  check('有商店的地方都有一扇通往掌櫃的門', shopLocs.every(id => haveShop.has(id)),
    shopLocs.filter(id => !haveShop.has(id)).join(','));
  check('有客棧的地方都有一扇通往店小二的門', innLocs.every(id => haveInn.has(id)),
    innLocs.filter(id => !haveInn.has(id)).join(','));
  check('靜室也在門後（打坐要進屋）', kindsSeen.has('train'));

  // 進出建物不耗體力、不推天數
  const gIn = G.newGame('進屋', 3);
  const anyDoor = doorEnts.find(e => e.kind === 'shop');
  const before = { stamina: gIn.stamina, clock: gIn.clock };
  G.enterDoor(gIn, anyDoor.to);
  const sc = G.curScene(gIn);
  G.walk(gIn, 'up');
  G.exitDoor(gIn);
  check('進出建物不耗體力、不推時辰',
    gIn.stamina === before.stamina && gIn.clock === before.clock, `${sc.name}`);
  check('走出建物會回到門那一格',
    gIn.pos.x === anyDoor.x && gIn.pos.y === anyDoor.y, `(${gIn.pos.x},${gIn.pos.y})`);

  // 渡口
  const ferries = world.entities.filter(e => e.type === 'ferry');
  check('東海渡口成對存在', ferries.length === 2, ferries.map(f => f.name).join('、'));
  const gF = G.newGame('渡海', 4);
  gF.pos = { x: ferries[0].x, y: ferries[0].y }; gF.gold = 100;
  const c0 = gF.clock;
  G.ride(gF, ferries[0]);
  check('渡船會把人送到對岸，並花掉半天',
    gF.pos.x === ferries[0].to.x && gF.pos.y === ferries[0].to.y && gF.clock - c0 === 360);
}

// ─────────────────────────────────────────────
section('【五】江湖自己會動');
{
  check('官道上有商隊、鏢隊與巡山弟子', world.actors.length >= 6,
    world.actors.map(a => a.name).join('、'));
  const kinds = new Set(world.actors.map(a => a.kind));
  check('三種都在（商隊／鏢隊／巡山）', kinds.has('caravan') && kinds.has('escort') && kinds.has('patrol'),
    [...kinds].join(','));

  // 站著不動的人擋在割點上，就會把江湖切成兩半（v2 的襄陽是這個 bug 的小號版）
  const art = articulationPoints(world.tiles, world.w, world.h);
  const onCut = world.entities.filter(e => e.solid && art[e.y * world.w + e.x])
    .map(e => `${e.name}(${e.x},${e.y})`);
  check('沒有任何固定的 NPC 站在割點上（不會把江湖切成兩半）', onCut.length === 0,
    onCut.slice(0, 3).join(',') || `${world.entities.filter(e => e.solid).length} 位一一驗過`);

  // 會走動的就不能靠站位保證了：兩台商隊一前一後也能堵死城門，
  // 而它們單獨站的每一格都不是割點。解法不是挑站位，是讓它們根本不成為牆。
  const gN = G.newGame('讓路', 8);
  check('會走動的 NPC 不擋路（走上去是追上他們，不是撞牆）',
    world.actors.every(a => !a.solid),
    `${world.actors.length} 支隊伍`);
  const pOpts = G.pathOpts(gN, world);
  check('尋路不把會走動的 NPC 當牆（路線只取決於靜態地形）',
    pOpts.ents.every(e => e.type !== 'actor')
    && G.activeEntities(gN, world).some(e => e.type === 'actor'));

  // 位置是 steps 的純函式：同一個 steps 必得同一個位置，且真的會動
  const a0 = world.actors[0];
  const p1 = actorAt(a0, 0), p1b = actorAt(a0, 0);
  const moved = new Set();
  for (let s = 0; s < 400; s++) { const p = actorAt(a0, s); moved.add(p.x + ',' + p.y); }
  check('會走動的 NPC 位置是步數的純函式（不進存檔也不會對不上）',
    p1.x === p1b.x && p1.y === p1b.y && moved.size > 10, `${moved.size} 個不同位置`);

  // 不論走到哪，尋路看到的世界都不變
  const gA = G.newGame('走動', 6);
  const base = F.reachableCount(world, world.spawn, G.pathOpts(gA, world).ents).count;
  let worst = base;
  for (const steps of [0, 37, 91, 143, 211, 613, 1499, 4598, 11529]) {
    gA.steps = steps;
    worst = Math.min(worst, F.reachableCount(world, world.spawn, G.pathOpts(gA, world).ents).count);
  }
  check('不論走動的 NPC 走到哪，尋路看到的世界都一樣大', worst === base, `${worst}/${base} 格`);

  const lm = new Set(GEO.LANDMARKS.map(l => l.type));
  check('地標型別庫有實際用到（reskin 時唯一該抽出來的東西）', lm.size >= 8,
    `${GEO.LANDMARK_TYPES.length} 種型別，用到 ${lm.size} 種：${[...lm].join('、')}`);
}

// ─────────────────────────────────────────────
section('【六】確定性與戰鬥基本盤');
{
  const mk = seed => {
    const allies = [cloneChar(PLAYER_TEMPLATE), cloneChar(ALLY_BY_ID.guojing)];
    allies.forEach(c => { c.curHp = maxHp(c); c.curMp = maxMp(c); });
    const enemies = ['b_qiuqianren', 'e_biaoshi'].map(id => {
      const c = cloneChar(ENEMY_BY_ID[id]); c.curHp = maxHp(c); c.curMp = maxMp(c); return c;
    });
    return createBattle({ allies, enemies, seed });
  };
  const a = autoBattle(mk(4242)), b = autoBattle(mk(4242)), c = autoBattle(mk(999));
  check('同種子戰鬥結果一致', JSON.stringify(a) === JSON.stringify(b), `${a.result} / ${a.rounds} 回合`);
  check('不同種子會產生不同過程', JSON.stringify(a) !== JSON.stringify(c));
  let timeouts = 0;
  for (let s = 0; s < 40; s++) if (autoBattle(mk(s)).result === 'timeout') timeouts++;
  check('40 場戰鬥皆能終局（無卡死）', timeouts === 0, `timeout=${timeouts}`);

  const mkHero = lvl => {
    const h = cloneChar(PLAYER_TEMPLATE);
    h.fist = 90; h.atk = 120; h.skills = [{ id: 'yeqiu', lvl, exp: 0 }];
    return h;
  };
  const dummy = cloneChar(ENEMY_BY_ID.e_seng);
  const d8 = computeDamage(mkHero(8), dummy, SKILL_BY_ID.yeqiu, 8, flat).dmg;
  const d10 = computeDamage(mkHero(10), dummy, SKILL_BY_ID.yeqiu, 10, flat).dmg;
  const xl = computeDamage(mkHero(10), dummy, SKILL_BY_ID.xianglong, 10, flat).dmg;
  check('野球拳十層威力遠勝八層', d10 > d8 * 4, `${d8} → ${d10}`);
  check('野球拳十層可與降龍十八掌抗衡', d10 > xl * 0.9, `野球拳 ${d10} vs 降龍 ${xl}`);

  const zero = SKILLS.filter(sk => {
    if (sk.kind === 'internal' || sk.shape === 'self') return false;
    const ch = cloneChar(PLAYER_TEMPLATE);
    ch.fist = ch.sword = ch.blade = ch.special = ch.hidden = ch.medicine = ch.poison = 60;
    ch.skills = [{ id: sk.id, lvl: 5, exp: 0 }];
    const v = sk.kind === 'heal' ? computeHeal(ch, sk, 5) : computeDamage(ch, dummy, sk, 5, flat).dmg;
    return v <= 0;
  });
  check('每門武功五層時皆有實際效果', zero.length === 0, zero.map(s => s.name).join(','));

  const c1 = cloneChar(PLAYER_TEMPLATE), c2 = cloneChar(PLAYER_TEMPLATE);
  c2.skills.push({ id: 'jiuyang', lvl: 8, exp: 0 });
  check('內功提升氣血與內力上限', maxMp(c2) > maxMp(c1) && maxHp(c2) > maxHp(c1),
    `${maxHp(c1)}/${maxMp(c1)} → ${maxHp(c2)}/${maxMp(c2)}`);
  check('輕功高者移動力較大',
    moveRange(cloneChar(ALLY_BY_ID.xiaolongnv)) > moveRange(cloneChar(PLAYER_TEMPLATE)));

  const fleeRate = (who, foe) => {
    let n = 0;
    for (let s = 0; s < 60; s++) {
      const allies = [cloneChar(who)]; allies[0].curHp = maxHp(allies[0]);
      const enemies = [cloneChar(ENEMY_BY_ID[foe])]; enemies[0].curHp = maxHp(enemies[0]);
      const bt = createBattle({ allies, enemies, seed: s, canFlee: true });
      if (tryFlee(bt, bt.units.find(u => u.side === 'ally'))) n++;
    }
    return n / 60;
  };
  const vsBoss = fleeRate(PLAYER_TEMPLATE, 'b_dongfang');
  check('弱者面對強敵仍有逃生機會（但非必成）', vsBoss > 0 && vsBoss < 1, `${(vsBoss * 100).toFixed(0)}%`);
  const slowF = fleeRate(PLAYER_TEMPLATE, 'e_gaoshou');
  const fastF = fleeRate(ALLY_BY_ID.xiaolongnv, 'e_gaoshou');
  check('輕功高者更容易脫身', fastF > slowF,
    `小龍女 ${(fastF * 100).toFixed(0)}% > 主角 ${(slowF * 100).toFixed(0)}%（同為江湖高手）`);

  const gs = G.newGame('存檔測試', 77);
  G.addItem(gs, 'p_dahuan', 2);
  check('存檔序列化往返無損', JSON.stringify(G.deserialize(G.serialize(gs))) === JSON.stringify(gs));
}

// ═════════════════════════════════════════════
// 徒步通關機器人：在一張圖上尋路、進城、進屋、撞人、開打、撿秘笈
// ═════════════════════════════════════════════
const ROUTE = [
  'yangzhou', 'fuwei', 'dongting', 'wudang', 'gumu', 'jueqing',
  'tianlong', 'wuliang', 'taohua', 'shaolin', 'huashan', 'heimu',
  'xiangyang', 'guangming', 'final',
];

const partyHpPct = g => g.party.reduce((n, c) => n + (c.curHp ?? 0) / maxHp(c), 0) / g.party.length;

function fight(g, mobs, stats) {
  const b = G.startEncounter(g, mobs);
  autoBattle(b);
  stats.encounters++;
  G.resolveBattle(g, b, false);
  return b.over;
}

function usePotions(g) {
  g.party.forEach((c, i) => {
    while (c.curHp < maxHp(c) * 0.8 && g.bag.p_dahuan) G.useItemWorld(g, i, 'p_dahuan');
    while (c.curHp < maxHp(c) * 0.7 && g.bag.p_xiaohuan) G.useItemWorld(g, i, 'p_xiaohuan');
    while (c.curHp < maxHp(c) * 0.6 && g.bag.p_jinchuang) G.useItemWorld(g, i, 'p_jinchuang');
    while (c.curMp < maxMp(c) * 0.6 && g.bag.p_baxian) G.useItemWorld(g, i, 'p_baxian');
    while (c.curMp < maxMp(c) * 0.5 && g.bag.p_gudan) G.useItemWorld(g, i, 'p_gudan');
  });
  if (g.stamina < 30) G.camp(g);
}

// 沿著一串方向走；遇敵就打，場景一變或被擋就回報
function follow(g, dirs, stats) {
  for (const d of dirs) {
    const before = g.scene;
    const r = G.walk(g, d);
    if (r.refused) return { status: 'refused', why: r.refused };
    if (r.bumped) return { status: 'bumped', entity: r.bumped };
    if (r.encounter) {
      const res = fight(g, r.encounter, stats);
      if (partyHpPct(g) < 0.55) usePotions(g);
      if (res === 'lose' || g.scene !== before) return { status: 'lost' };
    }
    if (r.sceneChanged) return { status: 'scene' };
    if (r.ferry) return { status: 'ferry', ferry: r.ferry };
    if (r.book) return { status: 'book', book: r.book };
    if (!r.moved) return { status: 'blocked' };
  }
  return { status: 'done' };
}

function walkToEntity(g, pred, stats, tries = 8) {
  const startScene = g.scene;
  for (let i = 0; i < tries; i++) {
    if (g.scene !== startScene) return { status: 'scene' };
    const sc = G.curScene(g);
    const opts = G.pathOpts(g, sc);
    const ents = opts.ents;
    if (!ents.find(pred)) return { status: 'missing' };
    const dirs = F.pathToEntity(sc, g.pos, pred, ents, opts);
    if (!dirs) return { status: 'nopath' };
    if (!dirs.length) return { status: 'here' };
    const r = follow(g, dirs, stats);
    if (r.status === 'bumped' && !pred(r.entity)) continue;   // 撞到路過的商隊，不是要找的人
    if (['done', 'bumped', 'scene', 'book', 'refused', 'ferry'].includes(r.status)) return r;
  }
  return { status: 'giveup' };
}

// 走到世界上的某一格
function walkToTile(g, target, stats, tries = 10, arrivedAt = null) {
  for (let i = 0; i < tries; i++) {
    if (g.scene !== 'world') {
      const r = walkToEntity(g, e => e.type === 'exit', stats);
      if (['giveup', 'nopath', 'missing'].includes(r.status)) return { status: 'stuck-inside' };
      continue;
    }
    if (g.pos.x === target.x && g.pos.y === target.y) return { status: 'arrived' };
    if (arrivedAt && arrivedAt(g)) return { status: 'arrived' };
    const sc = G.curScene(g);
    const dirs = F.pathTo(sc, g.pos, target, G.pathOpts(g, sc));
    if (!dirs) {
      if (process.env.JY_DEBUG) console.log('NOPATH', JSON.stringify({ from: g.pos, target, steps: g.steps, books: g.books.length, scene: g.scene }));
      return { status: 'nopath' };
    }
    if (g.stamina < 20) usePotions(g);
    const r = follow(g, dirs, stats);
    if (r.status === 'refused') return { status: 'refused', why: r.why };
    if (r.status === 'done') return { status: 'arrived' };
  }
  return { status: 'timeout' };
}

// 走到某個地點（島上的要先搭船）
function gotoLocation(g, locId, stats) {
  const island = GEO.FERRY.island;
  for (let leg = 0; leg < 4; leg++) {
    const onIsland = g.scene === 'world' && districtAt(G.curScene(g), g.pos.x, g.pos.y) === island;
    const wantIsland = locId === island;
    if (g.scene === 'world' && onIsland !== wantIsland) {
      const dock = onIsland ? GEO.FERRY.b : GEO.FERRY.a;
      const r = walkToTile(g, { x: dock.x, y: dock.y }, stats);
      if (r.status === 'ferry' || (g.pos.x === dock.x && g.pos.y === dock.y)) {
        const fe = G.curScene(g).entities.find(e => e.type === 'ferry' && e.x === dock.x && e.y === dock.y);
        if (fe) { G.ride(g, fe); continue; }
      }
      if (r.status === 'refused') return { status: 'refused', why: r.why };
      if (!['arrived', 'ferry'].includes(r.status)) return { status: r.status };
      continue;
    }
    if (G.inDistrict(g) === locId) return { status: 'arrived' };
    const p = locPos(locId);
    const r = walkToTile(g, p, stats, 14, gg => G.inDistrict(gg) === locId);
    if (r.status === 'arrived' || G.inDistrict(g) === locId) return { status: 'arrived' };
    if (r.status === 'refused') return { status: 'refused', why: r.why };
    if (r.status === 'ferry') continue;
    return { status: r.status };
  }
  return { status: 'timeout' };
}

function bestLearner(g, skId) {
  if (canLearn(g.party[0], skId).ok) return 0;
  let best = null;
  g.party.forEach((c, i) => {
    if (!canLearn(c, skId).ok) return;
    if (best == null || c.apt > g.party[best].apt) best = i;
  });
  return best;
}
function studyAll(g) {
  for (const { id, item } of G.bagList(g)) {
    if (!item.teaches) continue;
    const i = bestLearner(g, item.teaches);
    if (i != null) G.studyBook(g, i, id);
  }
}
function equipLoot(g) {
  const score = i => (i?.mods?.atk || 0) + (i?.mods?.def || 0) + (i?.mods?.hp || 0) / 8;
  for (let ci = 0; ci < g.party.length; ci++) {
    for (const { id, item } of G.bagList(g)) {
      if (!['weapon', 'armor', 'accessory'].includes(item.type)) continue;
      if (score(item) > score(ITEM_BY_ID[g.party[ci].equip[item.type]])) G.equip(g, ci, id);
    }
  }
}
function doShop(g, stock) {
  for (const [id, n] of [['p_dahuan', 8], ['p_xiaohuan', 8], ['p_baxian', 6], ['p_gudan', 6], ['p_jinchuang', 6]]) {
    if (!stock.includes(id)) continue;
    while ((g.bag[id] || 0) < n && g.gold > ITEM_BY_ID[id].price * 3) G.buy(g, id);
  }
  for (const id of stock) {
    const it = ITEM_BY_ID[id];
    if (it.type === 'book' && g.gold > it.price * 2.5 && !g.bag[id]) G.buy(g, id);
    if (['weapon', 'armor', 'accessory'].includes(it.type) && g.gold > it.price * 1.8) G.buy(g, id);
  }
  equipLoot(g);
}

// 進屋辦事：走到門、推門進去、撞到人、辦完再走出來
// 一張圖上十五處地點，`type === 'door'` 會同時命中每一座城的門——
// 一律要指名是哪一處的，否則機器人會從揚州出發去走光明頂的門。
function visitDoor(g, locId, kind, stats, act) {
  const r = walkToEntity(g, e => e.type === 'door' && e.kind === kind && e.loc === locId, stats);
  if (r.status !== 'scene') return false;
  const inner = walkToEntity(g, e => e.type === kind, stats);
  let ok = false;
  if (inner.status === 'bumped') { act(); ok = true; }
  walkToEntity(g, e => e.type === 'exit', stats);
  return ok;
}

// 在野外來回晃以觸發遭遇來練級
function grind(g, rounds, stats) {
  const dirs = ['up', 'down', 'left', 'right'];
  let done = 0, guard = 0;
  while (done < rounds && guard++ < rounds * 160) {
    const r = G.walk(g, dirs[guard % 4]);
    if (r.encounter) {
      fight(g, r.encounter, stats);
      done++;
      if (partyHpPct(g) < 0.55) usePotions(g);
    }
    if (r.sceneChanged || r.ferry) return;
    if (!r.moved) G.walk(g, dirs[(guard + 2) % 4]);
    if (g.stamina < 15) usePotions(g);
  }
}

// 敗陣之後回城：住店、補藥、換裝，再回頭挑戰
function resupply(g, stats) {
  for (const town of ['xiangyang', 'yangzhou', 'dongting']) {
    if (gotoLocation(g, town, stats).status !== 'arrived') continue;
    if (!G.innOpen(g)) G.camp(g);
    visitDoor(g, town, 'inn', stats, () => G.inn(g));
    visitDoor(g, town, 'shop', stats, () => doShop(g, LOC_BY_ID[town].shop || []));
    studyAll(g); equipLoot(g); usePotions(g);
    return true;
  }
  return false;
}

function doLocation(g, locId, stats) {
  const loc = LOC_BY_ID[locId];

  if (loc.inn != null) {
    if (!G.innOpen(g)) G.camp(g);
    visitDoor(g, locId, 'inn', stats, () => G.inn(g));
  }
  if (loc.shop) visitDoor(g, locId, 'shop', stats, () => doShop(g, loc.shop));
  for (const req of (loc.recruit || [])) {
    if (g.party.some(p => p.id === req.id)) continue;
    if (!G.recruitCheck(g, req.id).ok) continue;
    const r = walkToEntity(g, e => e.type === 'recruit' && e.who === req.id && e.loc === locId, stats);
    if (r.status === 'bumped') G.recruit(g, req.id);
  }
  studyAll(g); equipLoot(g); usePotions(g);

  if (!loc.boss) return { ok: true };

  for (let attempt = 0; attempt < 10; attempt++) {
    usePotions(g); studyAll(g); equipLoot(g);
    if (G.inDistrict(g) !== locId) {
      const back = gotoLocation(g, locId, stats);
      if (back.status !== 'arrived') return { ok: false, why: `回不去${loc.name}（${back.status}${back.why ? ': ' + back.why : ''}）` };
    }
    let approach = null;
    for (let k = 0; k < 3 && !approach; k++) {
      if (G.inDistrict(g) !== locId) {
        const back = gotoLocation(g, locId, stats);
        if (back.status !== 'arrived') break;
      }
      const r = walkToEntity(g, e => e.type === 'boss' && e.loc === locId, stats);
      if (r.status === 'bumped') approach = r;
      else if (r.status !== 'lost' && G.inDistrict(g) === locId) break;
    }
    if (!approach) return { ok: false, why: `走不到${loc.name}的頭目` };

    const b = G.startBoss(g);
    const res = autoBattle(b);
    stats.bossAttempts++;
    G.resolveBattle(g, b, true);

    if (res.result === 'win') {
      if (loc.book) {
        for (let k = 0; k < 3 && !g.books.includes(loc.book); k++) {
          if (G.inDistrict(g) !== locId) {
            const back = gotoLocation(g, locId, stats);
            if (back.status !== 'arrived') break;
          }
          walkToEntity(g, e => e.type === 'book' && e.loc === locId, stats);
        }
        if (!g.books.includes(loc.book)) return { ok: false, why: `打贏了卻拿不到${loc.name}的秘笈` };
      }
      stats.perLoc.push({
        loc: locId, name: loc.name, attempt: attempt + 1,
        lvl: g.party[0].lvl, party: g.party.length, day: g.day,
      });
      return { ok: true };
    }
    stats.bossLosses++;
    grind(g, 4 + attempt * 3, stats);
    if (attempt >= 1) resupply(g, stats);
  }
  return { ok: false, why: `${loc.name} 過不去` };
}

function runCampaign(seed) {
  const g = G.newGame('測試俠', seed);
  const stats = { encounters: 0, bossAttempts: 0, bossLosses: 0, perLoc: [], nights: 0 };

  for (const locId of ROUTE) {
    const go = gotoLocation(g, locId, stats);
    if (go.status !== 'arrived') {
      return { ok: false, why: `到不了 ${LOC_BY_ID[locId].name}（${go.status}${go.why ? ': ' + go.why : ''}）於 ${g.scene}(${g.pos.x},${g.pos.y}) 書${g.books.length}`, g, stats };
    }
    const r = doLocation(g, locId, stats);
    if (!r.ok) return { ok: false, why: r.why, g, stats };
  }
  return { ok: !!g.flags['cleared:final'], g, stats, why: g.flags['cleared:final'] ? '' : '未擊敗東方不敗' };
}

// ─────────────────────────────────────────────
section('【七】主線可徒步通關（機器人真的用走的）');
const runs = [];
for (let s = 0; s < SEEDS; s++) runs.push(runCampaign(1000 + s * 7717));
{
  const wins = runs.filter(r => r.ok);
  check(`${SEEDS} 局全部通關`, wins.length === SEEDS,
    `${wins.length}/${SEEDS}` + (wins.length < SEEDS ? ' | ' + runs.filter(r => !r.ok).map(r => r.why).join('; ') : ''));

  if (wins.length) {
    const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
    const rng = a => `${Math.min(...a)}–${Math.max(...a)}`;
    const lv = wins.map(r => r.g.party[0].lvl);
    const day = wins.map(r => r.g.day);
    const books = wins.map(r => r.g.books.length);
    const party = wins.map(r => r.g.party.length);
    const enc = wins.map(r => r.stats.encounters);
    const steps = wins.map(r => r.g.steps);
    const losses = wins.map(r => r.stats.bossLosses);

    check('通關時集齊 14 部秘笈', books.every(b => b === 14), `books=${rng(books)}`);
    check('主角終盤等級落在 18–40', lv.every(l => l >= 18 && l <= 40), `lvl=${rng(lv)} 平均 ${avg(lv).toFixed(1)}`);
    check('隊伍最終 4 人以上', party.every(p => p >= 4), `party=${rng(party)}`);
    check('全程步數在合理範圍（<120000 步）', steps.every(s => s < 120000), `steps=${rng(steps)} 平均 ${avg(steps).toFixed(0)}`);
    // 世界大了三倍，但官道便宜，旅程天數不該跟著漲三倍
    check('通關天數在合理範圍（<1500 天）', day.every(d => d < 1500), `day=${rng(day)} 平均 ${avg(day).toFixed(0)}`);
    check('不必無限刷怪（平均遭遇 < 200 場）', avg(enc) < 200, `encounters=${rng(enc)} 平均 ${avg(enc).toFixed(0)}`);
    check('頭目戰有挑戰性（總計至少敗過一次）', losses.some(l => l > 0), `每局落敗 ${rng(losses)}`);
    check('但不至於處處碰壁（平均落敗 < 9 次）', avg(losses) < 9, `平均 ${avg(losses).toFixed(1)} 次`);
  }
}

// ─────────────────────────────────────────────
section('【八】各關難度曲線');
{
  const byLoc = new Map();
  for (const r of runs.filter(x => x.ok)) for (const p of r.stats.perLoc) {
    if (!byLoc.has(p.loc)) byLoc.set(p.loc, []);
    byLoc.get(p.loc).push(p);
  }
  const rows = ROUTE.filter(l => byLoc.has(l)).map(l => {
    const a = byLoc.get(l);
    const avg = k => a.reduce((n, x) => n + x[k], 0) / a.length;
    return { loc: l, name: LOC_BY_ID[l].name, attempts: avg('attempt'), lvl: avg('lvl'), day: avg('day') };
  });
  if (!QUIET && rows.length) {
    console.log('  地點        平均嘗試  主角等級  天數');
    for (const r of rows) {
      console.log(`  ${r.name.padEnd(6, '　')} ${r.attempts.toFixed(2).padStart(8)} ${r.lvl.toFixed(1).padStart(9)} ${r.day.toFixed(0).padStart(6)}`);
    }
  }
  const lvls = rows.map(r => r.lvl);
  let mono = true;
  for (let i = 1; i < lvls.length; i++) if (lvls[i] < lvls[i - 1] - 0.6) mono = false;
  check('等級隨路線單調上升（難度曲線成立）', mono, rows.map(r => r.lvl.toFixed(0)).join('→'));
  check('沒有任何一關平均嘗試 ≥ 4 次（無牆關）', rows.every(r => r.attempts < 4),
    '最高 ' + Math.max(...rows.map(r => r.attempts)).toFixed(2));
  // v1 的教訓：等級單調上升不等於難度有起伏，中後段連著八關一次過就是平推
  const bumpy = rows.filter(r => r.attempts >= 1.3).length;
  check('難度有起伏，不是一路平推（至少四關平均嘗試 ≥ 1.3）', bumpy >= 4,
    `${bumpy} 關`);
  const fin = rows.find(r => r.loc === 'final');
  const others = rows.filter(r => r.loc !== 'final').map(r => r.attempts);
  check('最終戰確實是最難的一關', !fin || fin.attempts >= Math.max(...others) * 0.8,
    fin ? `華山之巔 ${fin.attempts.toFixed(2)} 次` : 'n/a');
}

// ─────────────────────────────────────────────
console.log(`\n${'─'.repeat(52)}`);
console.log(`通過 ${pass}　失敗 ${fail}`);
if (fail) { console.log('\n失敗項目：'); fails.forEach(f => console.log('  · ' + f)); process.exit(1); }
console.log('全部通過。');
