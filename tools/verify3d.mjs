// 三維世界的無頭驗證：高度場、官道坡度、可走遮罩、跨場景連通、視線。
//
// 這些全部是 src/world3d/field.js 算得出來的東西，而那個檔不碰 THREE 也不碰 DOM——
// 所以「華山之巔是不是全圖唯一最高點」「山道有沒有超過三成坡」「從揚州看不看得見華山」
// 不必開瀏覽器就驗得完。開瀏覽器那一半（幾何量、draw call、幀時）在 tools/uismoke.mjs。
//
// 用法：node tools/verify3d.mjs [--quiet]

import * as F from '../src/world3d/field.js';
import { LOC_BY_ID } from '../src/data/maps.js';

const QUIET = process.argv.includes('--quiet');
let pass = 0, fail = 0;
const fails = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; if (!QUIET) console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; fails.push(name + (detail ? ' — ' + detail : '')); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
const section = t => console.log(`\n${t}`);

const t0 = Date.now();
const field = F.makeField();
const roads = F.buildRoads(field);
const groundH = F.makeGround(field, roads);
const mask = F.buildWalkMask(field, roads, groundH);
const speedAt = F.makeSpeed(field, mask);
const buildMs = Date.now() - t0;

const nameOf = id => (LOC_BY_ID[id] && LOC_BY_ID[id].name) || id;

// ─────────────────────────────────────────────
section('【一】高度場');
{
  check('場在一秒內建得完（畫面層不必等）', buildMs < 1000, `${buildMs} ms`);

  let max = -1e9, mx = 0, my = 0, second = -1e9;
  for (let gy = 0; gy < F.H; gy++) for (let gx = 0; gx < F.W; gx++) {
    const h = groundH(F.tx2x(gx), F.ty2z(gy));
    if (h > max) { second = max; max = h; mx = gx; my = gy; }
    else if (h > second) second = h;
  }
  const peakG = F.GEO.PEAKS.find(p => p.name === '華山之巔');
  check('華山之巔是全圖最高點', mx === peakG.x && my === peakG.y,
    `最高在 (${mx},${my})，${max.toFixed(1)} 公尺`);
  check('而且是嚴格唯一的最高點', max > second + 0.05,
    `第二高 ${second.toFixed(2)} 公尺，差 ${(max - second).toFixed(2)}`);
  check('峰頂高得看得出來（不小於世界寬度的十分之一）', max > F.WORLD_W / 10,
    `${max.toFixed(1)} 公尺 / 世界寬 ${F.WORLD_W} 公尺`);

  // 抹過的高度場仍然守著 2D 的地形分帶：雪線在高處，海在低處
  const seaY = groundH(F.tx2x(378), F.ty2z(140));
  check('東海在水面之下', seaY < 0.4, `${seaY.toFixed(2)} 公尺`);
  // 漢水只有一格寬，是最容易被抹平抹不見的一條。取它自己的水格來量，不要用目測的座標。
  const riv = F.GEO.RIVERS.find(r => r.name === '漢水');
  let hanWorst = -1e9, hanAt = null, hanN = 0;
  for (const [gx, gy] of riv.pts) {
    for (let d = -1; d <= 1; d++) {
      const x = Math.round(gx) + d, y = Math.round(gy);
      if (field.sc.tiles[y * F.W + x] !== F.T.WATER) continue;
      hanN++;
      // 量地形，不量地面：官道過河會架橋，橋面的高度不是河床的高度
      const h = field.terrainH(F.tx2x(x), F.ty2z(y));
      if (h > hanWorst) { hanWorst = h; hanAt = [x, y]; }
    }
  }
  check('漢水的水格取得到', hanN > 0, `${hanN} 格`);
  check('一格寬的漢水沒有被抹平（河床仍在水面下）', hanWorst < 0.55,
    `最淺的一格 ${hanWorst.toFixed(2)} 公尺 @ (${hanAt})`);
}

// ─────────────────────────────────────────────
section('【二】官道與山道');
{
  const MAXG = 0.305;
  for (const r of roads) {
    if (r.kind === 'stair') continue;
    check(`官道 ${r.id} 坡度在三成以內`, r.grade <= MAXG, `${r.grade.toFixed(3)}`);
  }
  const stair = roads.find(r => r.kind === 'stair');
  check('華山山道存在', !!stair);
  check('華山山道坡度在三成以內（限坡真的有用）', stair.grade <= MAXG,
    `${stair.grade.toFixed(3)}，長 ${stair.length.toFixed(0)} 公尺`);
  const rise = stair.pts[stair.pts.length - 1].y - stair.pts[0].y;
  check('山道確實是往上爬的', rise > 8, `爬升 ${rise.toFixed(1)} 公尺`);
  check('山道夠長，坡度不是靠短路偷來的', stair.length >= rise / MAXG,
    `${stair.length.toFixed(0)} ≥ ${(rise / MAXG).toFixed(0)} 公尺`);
}

// ─────────────────────────────────────────────
section('【三】可走遮罩');
{
  const spawn = { x: F.SPAWN.gx, y: F.SPAWN.gy };
  check('出生點站得住', F.canStand(mask, F.SPAWN.x, F.SPAWN.z),
    `(${spawn.x},${spawn.y})`);

  const island = new Set(['taohua']);       // 桃花島隔著東海，只有渡船到得了
  let land = 0;
  for (const p of F.PLACES) {
    const r = F.reachable(mask, spawn, { x: p.gx, y: p.gy });
    if (island.has(p.id)) {
      check(`${nameOf(p.id)} 徒步到不了（渡海是唯一的非徒步移動，這一期不做）`, !r.ok);
    } else {
      check(`從揚州走得到 ${nameOf(p.id)}`, r.ok, r.ok ? '' : r.why);
      if (r.ok) land++;
    }
  }
  check('十四處本土地點全部連通', land === F.PLACES.length - 1, `${land}/${F.PLACES.length - 1}`);

  for (const p of F.PLACES) {
    check(`${nameOf(p.id)} 的廣場正中站得住`, F.canStand(mask, p.x, p.z));
  }
}

// ─────────────────────────────────────────────
section('【四】通過條件：揚州出生，走到華山之巔');
{
  const spawn = { x: F.SPAWN.gx, y: F.SPAWN.gy };
  const peakG = F.GEO.PEAKS.find(p => p.name === '華山之巔');
  const route = F.routeFast(mask, speedAt, groundH, spawn, { x: peakG.x, y: peakG.y });
  check('排得出一條從出生點走到峰頂的路', !!route);
  if (route) {
    const metres = route.length * F.S;
    const straight = Math.hypot(F.tx2x(peakG.x) - F.SPAWN.x, F.ty2z(peakG.y) - F.SPAWN.z);
    check('這條路走得完（不是繞了半個世界）', metres < straight * 2.6,
      `${metres.toFixed(0)} 公尺 / 直線 ${straight.toFixed(0)} 公尺`);
    const secs = route.seconds;
    console.log(`    · 全程 ${metres.toFixed(0)} 公尺，最快走法約 ${(secs / 60).toFixed(1)} 分鐘實時`);
    check('一趟落在五到十五分鐘（世界大小與步速對得上）', secs > 300 && secs < 900,
      `${(secs / 60).toFixed(1)} 分`);
    // 官道便宜要真的把人吸到官道上，不然「官道有意義」只是嘴上說說
    let onRoad = 0;
    for (const p of route) {
      const t = field.sc.tiles[p.y * F.W + p.x];
      if (t === F.T.ROAD || t === F.T.BRIDGE || t === F.T.STREET) onRoad++;
    }
    check('最快的走法大半在官道上（官道便宜是有機制作用的）', onRoad / route.length > 0.6,
      `${(onRoad / route.length * 100).toFixed(0)}%`);
  }

  // 折返不能白做：如果整面崖都變成可走的，最短路會直接貼著直線上去。
  const stair = roads.find(r => r.kind === 'stair');
  const base = stair.pts[0], top = stair.pts[stair.pts.length - 1];
  const bg = { x: Math.round(F.x2tx(base.x)), y: Math.round(F.z2ty(base.z)) };
  const tg = { x: peakG.x, y: peakG.y };
  const up = F.routeOn(mask, bg, tg);
  const straightUp = Math.hypot(F.tx2x(tg.x) - base.x, F.ty2z(tg.y) - base.z);
  check('上山非得走之字不可（崖面沒有被走廊連成一片）',
    up && up.length * F.S > straightUp * 1.8,
    up ? `${(up.length * F.S).toFixed(0)} 公尺 vs 直線 ${straightUp.toFixed(0)} 公尺` : '無路');
}

// ─────────────────────────────────────────────
section('【四之二】馬：官道的獎賞，但上不了華山');
{
  const rideMask = F.buildRideMask(field, roads, groundH, mask);
  const horseSpeedAt = F.makeHorseSpeed(field, rideMask);
  const spots = F.horseSpots(rideMask);
  check('十四處聚落各拴一匹馬（桃花島隔海，沒有）', spots.length === 14, spots.length + ' 匹');
  for (const sp of spots) {
    check(`${nameOf(sp.id)} 的馬站得住（騎得上去的格子）`,
      F.canStand(rideMask, sp.x, sp.z, 0.7));
  }

  const yz = spots.find(s => s.id === 'yangzhou');
  let linked = 0; const cut = [];
  for (const sp of spots) {
    const okR = F.reachable(rideMask, { x: yz.gx, y: yz.gy }, { x: sp.gx, y: sp.gy }).ok;
    if (sp.id === 'taohua') {
      // 桃花島那匹是島上自己的馬——渡海過去才騎得到，本土騎不過去才是對的
      check('桃花島的馬騎不過海（島上自己有一匹）', !okR);
      continue;
    }
    if (okR) linked++; else cut.push(sp.id);
  }
  check('本土十三處拴馬樁之間騎得通', linked === spots.length - 1,
    `${linked}/${spots.length - 1}` + (cut.length ? '　斷：' + cut.join(',') : ''));

  const P = F.PLACE_BY_ID;
  check('騎得到華山山門', F.reachable(rideMask, { x: yz.gx, y: yz.gy }, { x: P.huashan.gx, y: P.huashan.gy }).ok);
  // 這一條是整個設計的支點：馬不准騎上論劍台。
  check('**騎不上華山之巔**（石階整條不給騎，最後一段只能靠腿）',
    !F.reachable(rideMask, { x: yz.gx, y: yz.gy }, { x: P.final.gx, y: P.final.gy }).ok);

  const rd = { x: F.tx2x(276), z: F.ty2z(146) };
  const hv = horseSpeedAt(rd.x, rd.z, groundH), wv = speedAt(rd.x, rd.z, groundH);
  check('官道上馬比人快一倍以上', hv > wv * 2, `${hv.toFixed(2)} vs ${wv.toFixed(2)} m/s`);
  const gx = F.tx2x(280), gz = F.ty2z(160);
  const hg = horseSpeedAt(gx, gz, groundH), wg = speedAt(gx, gz, groundH);
  check('跨野時馬的優勢縮小（馬比人挑地面）', hg / wg < hv / wv,
    `野外 ${(hg / wg).toFixed(2)} 倍 vs 官道 ${(hv / wv).toFixed(2)} 倍`);

  const ride = F.routeFast(rideMask, horseSpeedAt, groundH, { x: yz.gx, y: yz.gy }, { x: P.huashan.gx, y: P.huashan.gy });
  check('騎馬從揚州到華山山門在四分鐘內', ride && ride.seconds < 240,
    ride ? `${(ride.length * F.S).toFixed(0)} 公尺，${(ride.seconds / 60).toFixed(1)} 分` : '無路');

  let rideable = 0, walkable = 0;
  for (let i = 0; i < mask.length; i++) { walkable += mask[i]; rideable += rideMask[i]; }
  check('騎得到的地方比走得到的少（馬有它自己的代價）', rideable < walkable,
    `${(100 * rideable / walkable).toFixed(0)}% 的可走地`);
}

// ─────────────────────────────────────────────
section('【五】視線：看得見才走得到');
{
  const eye = { x: F.SPAWN.x, z: F.SPAWN.z };
  const peak = { x: field.peak.x, z: field.peak.z };
  // 論劍台的欄杆高出峰頂地面約四公尺——你看見的是那個，不是地面上那一點
  const los = F.lineOfSight(groundH, eye, peak, { targetUp: 4 });
  check('從揚州出生點看得見華山之巔', los.visible,
    `距 ${los.dist.toFixed(0)} 公尺，仰角 ${los.elevationDeg.toFixed(1)}°，餘裕 ${los.clearance.toFixed(1)} 公尺`);
  check('仰角夠大，遠遠就認得出來（≥ 5°）', los.elevationDeg >= 5,
    `${los.elevationDeg.toFixed(1)}°`);

  // 沿路每一段都看得見終點，才叫「只靠地標與天際線找得到路」
  const peakG = F.GEO.PEAKS.find(p => p.name === '華山之巔');
  const route = F.routeFast(mask, speedAt, groundH, { x: F.SPAWN.gx, y: F.SPAWN.gy }, { x: peakG.x, y: peakG.y });
  if (route) {
    let seen = 0, n = 0, far = 0, farN = 0;
    for (let i = 0; i < route.length; i += 10) {
      const p = { x: F.tx2x(route[i].x), z: F.ty2z(route[i].y) };
      const l = F.lineOfSight(groundH, p, peak, { targetUp: 4 });
      n++; if (l.visible) seen++;
      if (l.dist > 120) { farN++; if (l.visible) far++; }
    }
    // 全程都看得見是做不到的，也不該做到——走到山腳下本來就看不見山頂。
    // 要的是遠處看得見（知道往哪走）；近處靠的是山道，不是天際線。
    check('一百二十公尺外的取樣點，八成看得見華山', farN > 0 && far / farN >= 0.8,
      `遠處 ${far}/${farN}`);
    console.log(`    · 全程 ${seen}/${n} 個取樣點看得見；一百二十公尺內被山自己擋住是應該的`);
  }

  // 襄陽是中線上的大城，從官道上該遠遠看見城牆
  const xy = F.PLACE_BY_ID.xiangyang;
  const fromRoad = { x: F.tx2x(276), z: F.ty2z(146) };        // 揚州—襄陽官道上的路口
  const l2 = F.lineOfSight(groundH, fromRoad, { x: xy.x, z: xy.z }, { targetUp: 8 });
  check('從官道路口看得見襄陽城樓', l2.visible,
    `距 ${l2.dist.toFixed(0)} 公尺，餘裕 ${l2.clearance.toFixed(1)} 公尺`);
}

// ─────────────────────────────────────────────
section('【六】步速：官道便宜、跨野貴，用腳底感覺');
{
  const onRoad = speedAt(F.tx2x(276), F.ty2z(146), null);
  const onGrass = speedAt(F.tx2x(280), F.ty2z(160), null);
  check('官道比跨野快', onRoad > onGrass, `${onRoad.toFixed(2)} vs ${onGrass.toFixed(2)} m/s`);
  check('官道步速就是設定值', Math.abs(onRoad - F.ROAD_SPEED) < 0.01, `${onRoad.toFixed(2)} m/s`);
  check('跨野沒有慢到像泥沼（不低於官道的一半）', onGrass > F.ROAD_SPEED * 0.5,
    `${(onGrass / F.ROAD_SPEED).toFixed(2)} 倍`);

  // 上坡真的費力：同一格地形，坡度一上來速度就掉
  const flat = speedAt(F.tx2x(276), F.ty2z(146), groundH);
  const steep = speedAt(F.tx2x(160), F.ty2z(101), groundH);
  check('爬華山山道比走平地慢', steep < flat * 0.92,
    `${steep.toFixed(2)} vs ${flat.toFixed(2)} m/s`);
}

// ─────────────────────────────────────────────
console.log(`\n${'─'.repeat(52)}`);
console.log(`通過 ${pass}　失敗 ${fail}`);
if (fail) { console.log('\n失敗項目：'); fails.forEach(f => console.log('  · ' + f)); process.exit(1); }
console.log('全部通過。');
