// 無頭驗證：資料完整性、地圖與場景健全性、確定性、戰鬥平衡、主線可徒步通關。
// 用法：node tools/verify.mjs [--quiet] [--seeds=N]

import { SKILLS, SKILL_BY_ID } from '../src/data/skills.js';
import { ITEMS, ITEM_BY_ID, QUEST_BOOKS } from '../src/data/items.js';
import { ALLIES, ENEMIES, ENEMY_BY_ID, ALLY_BY_ID, PLAYER_TEMPLATE, cloneChar } from '../src/data/chars.js';
import { LOCATIONS, LOC_BY_ID } from '../src/data/world.js';
import { getScene, OW } from '../src/data/maps.js';
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

  // 隨機遭遇不得強過該地頭目，否則等級不夠就被自己堵死
  const spikes = LOCATIONS.filter(l => l.boss && l.mobs).map(l => {
    const bossLvl = Math.max(...l.boss.enemies.map(e => ENEMY_BY_ID[e].lvl));
    const mobLvl = Math.max(...l.mobs.map(m => ENEMY_BY_ID[m].lvl));
    return { name: l.name, bossLvl, mobLvl };
  }).filter(x => x.mobLvl > x.bossLvl);
  check('各地雜兵不強過該地頭目', spikes.length === 0,
    spikes.map(s => `${s.name} 雜兵${s.mobLvl}>頭目${s.bossLvl}`).join(','));
}

// ─────────────────────────────────────────────
section('【二】地圖與場景健全性（走得到嗎）');
{
  const ow = getScene('overworld');
  check('大地圖已生成', ow.w === OW.w && ow.h === OW.h, `${ow.w}×${ow.h}`);
  const gates = ow.entities.filter(e => e.type === 'gate');
  check('每個地點在大地圖上都有入口', gates.length === LOCATIONS.length, `${gates.length}/${LOCATIONS.length}`);

  const { seen, count } = F.reachableCount(ow, ow.spawn);
  const walkPct = count / (ow.w * ow.h);
  check('大地圖可行走區域佔比合理（25%–75%）', walkPct > 0.25 && walkPct < 0.75,
    `${(walkPct * 100).toFixed(0)}%（${count} 格）`);
  const unreachable = gates.filter(g => !seen[g.y * ow.w + g.x]);
  check('自出生點可徒步走到每一個地點', unreachable.length === 0,
    unreachable.map(g => g.name).join(',') || `${gates.length} 處全通`);

  const g0 = G.newGame('起點測試', 1);
  const openDirs = ['up', 'down', 'left', 'right'].filter(d => {
    const [dx, dy] = F.DIRS[d];
    return F.passable(ow, g0.pos.x + dx, g0.pos.y + dy, ow.entities);
  });
  check('新遊戲的出生點就在大地圖出生點上',
    g0.pos.x === ow.spawn.x && g0.pos.y === ow.spawn.y,
    `(${g0.pos.x},${g0.pos.y}) vs (${ow.spawn.x},${ow.spawn.y})`);
  check('出生點四周走得動（不會一開場就卡住）', openDirs.length >= 3, `可走方向 ${openDirs.join('、') || '無'}`);

  const dup = gates.filter((a, i) => gates.some((b, j) => j !== i && b.x === a.x && b.y === a.y));
  check('地點入口不重疊', dup.length === 0, dup.map(d => d.name).join(','));

  const problems = [];
  for (const loc of LOCATIONS) {
    const sc = getScene(loc.id);
    for (const e of sc.entities) {
      if (!F.entityReachable(sc, sc.spawn, e)) problems.push(`${loc.name}:${e.type}`);
    }
    if (!sc.entities.some(e => e.type === 'exit')) problems.push(`${loc.name}:無出口`);
    if (loc.boss && !sc.entities.some(e => e.type === 'boss')) problems.push(`${loc.name}:無頭目`);
    if (loc.book && !sc.entities.some(e => e.type === 'book')) problems.push(`${loc.name}:無秘笈`);
    if (loc.shop && !sc.entities.some(e => e.type === 'shop')) problems.push(`${loc.name}:無商鋪`);
    if (loc.inn != null && !sc.entities.some(e => e.type === 'inn')) problems.push(`${loc.name}:無客棧`);
    for (const r of (loc.recruit || [])) {
      if (!sc.entities.some(e => e.type === 'recruit' && e.who === r.id)) problems.push(`${loc.name}:缺${r.id}`);
    }
  }
  check('每個場景的人與物都走得到，且該有的都在', problems.length === 0, problems.join(' | '));

  // 一圈 NPC 圍成環會把中間封死，人走進去就出不來——每一個站得上去的格子都必須走得回出口
  const trapped = [];
  for (const loc of LOCATIONS) {
    const sc = getScene(loc.id);
    const gg = G.newGame('t', 1); gg.scene = loc.id;
    const ents = G.activeEntities(gg, sc);
    let bad = 0, sample = null;
    for (let y = 0; y < sc.h; y++) for (let x = 0; x < sc.w; x++) {
      if (!F.passable(sc, x, y, ents)) continue;
      if (!F.pathToEntity(sc, { x, y }, e => e.type === 'exit', ents)) {
        bad++; if (!sample) sample = `(${x},${y})`;
      }
    }
    if (bad) trapped.push(`${loc.name} ${bad} 格 例如${sample}`);
  }
  check('場景中沒有走得進去卻出不來的死角', trapped.length === 0, trapped.join(' | '));

  // 打倒頭目後秘笈都拿得到
  const gAll = G.newGame('探路', 2);
  for (const l of LOCATIONS) gAll.flags['cleared:' + l.id] = true;
  const stillBlocked = LOCATIONS.filter(l => l.book).filter(loc => {
    const sc = getScene(loc.id);
    const bk = sc.entities.find(e => e.type === 'book');
    return !F.entityReachable(sc, sc.spawn, bk, G.activeEntities(gAll, sc));
  });
  check('打倒頭目後秘笈都拿得到', stillBlocked.length === 0, stillBlocked.map(l => l.name).join(','));
}

// ─────────────────────────────────────────────
section('【三】確定性與戰鬥基本盤');
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
  // 面對輕功遠勝己方的東方不敗，只剩保底機會
  const vsBoss = fleeRate(PLAYER_TEMPLATE, 'b_dongfang');
  check('弱者面對強敵仍有逃生機會（但非必成）', vsBoss > 0 && vsBoss < 1, `${(vsBoss * 100).toFixed(0)}%`);
  // 對上同一個尋常對手，輕功高低才看得出差別（都對頭目的話雙方都被保底壓平）
  const slowF = fleeRate(PLAYER_TEMPLATE, 'e_gaoshou');
  const fastF = fleeRate(ALLY_BY_ID.xiaolongnv, 'e_gaoshou');
  check('輕功高者更容易脫身', fastF > slowF,
    `小龍女 ${(fastF * 100).toFixed(0)}% > 主角 ${(slowF * 100).toFixed(0)}%（同為江湖高手）`);

  const gs = G.newGame('存檔測試', 77);
  G.addItem(gs, 'p_dahuan', 2);
  check('存檔序列化往返無損', JSON.stringify(G.deserialize(G.serialize(gs))) === JSON.stringify(gs));
}

// ═════════════════════════════════════════════
// 徒步通關機器人
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
  if (g.stamina < 30) { g.day += 2; g.stamina = Math.min(100, g.stamina + 50); }
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
    if (r.book) return { status: 'book', book: r.book };
    if (!r.moved) return { status: 'blocked' };
  }
  return { status: 'done' };
}

// 走到當前場景裡某個實體（實心的會撞上去）
function walkToEntity(g, pred, stats, tries = 8) {
  const startScene = g.scene;
  for (let i = 0; i < tries; i++) {
    // 半路打輸會被丟回城鎮，場景一變就別再照舊場景重算路徑
    if (g.scene !== startScene) return { status: 'scene' };
    const sc = G.curScene(g);
    const ents = G.activeEntities(g, sc);
    const target = ents.find(pred);
    if (!target) return { status: 'missing' };
    const dirs = F.pathToEntity(sc, g.pos, pred, ents);
    if (!dirs) return { status: 'nopath' };
    if (!dirs.length) return { status: 'here', entity: target };
    const r = follow(g, dirs, stats);
    if (['done', 'bumped', 'scene', 'book', 'refused'].includes(r.status)) return r;
  }
  return { status: 'giveup' };
}

// 走到某個地點（必要時先離開目前場景）
function gotoLocation(g, locId, stats, tries = 16) {
  for (let i = 0; i < tries; i++) {
    if (g.scene === locId) return { status: 'arrived' };
    if (g.scene !== 'overworld') {
      const r = walkToEntity(g, e => e.type === 'exit', stats);
      if (['giveup', 'nopath', 'missing'].includes(r.status)) return { status: 'stuck-inside' };
      continue;
    }
    if (g.stamina < 20) usePotions(g);
    const r = walkToEntity(g, e => e.type === 'gate' && e.to === locId, stats);
    if (r.status === 'refused') return { status: 'refused', why: r.why };
    if (['nopath', 'giveup', 'missing'].includes(r.status)) return { status: 'nopath' };
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
function doShop(g) {
  const loc = G.here(g);
  if (!loc?.shop) return;
  for (const [id, n] of [['p_dahuan', 8], ['p_xiaohuan', 8], ['p_baxian', 6], ['p_gudan', 6], ['p_jinchuang', 6]]) {
    if (!loc.shop.includes(id)) continue;
    while ((g.bag[id] || 0) < n && g.gold > ITEM_BY_ID[id].price * 3) G.buy(g, id);
  }
  for (const id of loc.shop) {
    const it = ITEM_BY_ID[id];
    if (it.type === 'book' && g.gold > it.price * 2.5 && !g.bag[id]) G.buy(g, id);
    if (['weapon', 'armor', 'accessory'].includes(it.type) && g.gold > it.price * 1.8) G.buy(g, id);
  }
  equipLoot(g);
}

// 在大地圖上來回晃以觸發遭遇來練級
function grind(g, rounds, stats) {
  const dirs = ['up', 'down', 'left', 'right'];
  let done = 0, guard = 0;
  while (done < rounds && guard++ < rounds * 80) {
    const r = G.walk(g, dirs[guard % 4]);
    if (r.encounter) {
      fight(g, r.encounter, stats);
      done++;
      if (partyHpPct(g) < 0.55) usePotions(g);
    }
    if (r.sceneChanged) return;
    if (!r.moved) G.walk(g, dirs[(guard + 2) % 4]);
    if (g.stamina < 15) usePotions(g);
  }
}

// 敗陣之後回城：住店、補藥、換裝，再回頭挑戰
function resupply(g, stats) {
  for (const town of ['xiangyang', 'yangzhou', 'dongting']) {
    if (gotoLocation(g, town, stats).status !== 'arrived') continue;
    const i = walkToEntity(g, e => e.type === 'inn', stats);
    if (i.status === 'bumped') G.inn(g);
    const sh = walkToEntity(g, e => e.type === 'shop', stats);
    if (sh.status === 'bumped') doShop(g);
    studyAll(g); equipLoot(g); usePotions(g);
    return true;
  }
  return false;
}

// 到了一個地點之後：補給、招人、學武、打頭目、撿秘笈
function doLocation(g, locId, stats) {
  const loc = LOC_BY_ID[locId];

  if (loc.inn != null) {
    const r = walkToEntity(g, e => e.type === 'inn', stats);
    if (r.status === 'bumped') G.inn(g);
  }
  if (loc.shop) {
    const r = walkToEntity(g, e => e.type === 'shop', stats);
    if (r.status === 'bumped') doShop(g);
  }
  for (const req of (loc.recruit || [])) {
    if (g.party.some(p => p.id === req.id)) continue;
    if (!G.recruitCheck(g, req.id).ok) continue;
    const r = walkToEntity(g, e => e.type === 'recruit' && e.who === req.id, stats);
    if (r.status === 'bumped') G.recruit(g, req.id);
  }
  studyAll(g); equipLoot(g); usePotions(g);

  if (!loc.boss) return { ok: true };

  // 真人打頭目（尤其最終戰）不會只試六次就放棄；是不是「牆關」交由平均嘗試次數判定
  for (let attempt = 0; attempt < 10; attempt++) {
    usePotions(g); studyAll(g); equipLoot(g);
    if (g.scene !== locId) {
      const back = gotoLocation(g, locId, stats);
      if (back.status !== 'arrived') return { ok: false, why: `回不去${loc.name}（${back.status}）` };
    }
    // 途中打輸會被丟回城鎮，場景一變就得重新走回來再靠近
    let approach = null;
    for (let k = 0; k < 3 && !approach; k++) {
      if (g.scene !== locId) {
        const back = gotoLocation(g, locId, stats);
        if (back.status !== 'arrived') break;
      }
      const r = walkToEntity(g, e => e.type === 'boss', stats);
      if (r.status === 'bumped') approach = r;
      else if (r.status !== 'lost' && g.scene === locId) break;
    }
    if (!approach) return { ok: false, why: `走不到${loc.name}的頭目` };

    const b = G.startBoss(g);
    const res = autoBattle(b);
    stats.bossAttempts++;
    G.resolveBattle(g, b, true);

    if (res.result === 'win') {
      if (loc.book) {
        for (let k = 0; k < 3 && !g.books.includes(loc.book); k++) {
          if (g.scene !== locId) {
            const back = gotoLocation(g, locId, stats);
            if (back.status !== 'arrived') break;
          }
          walkToEntity(g, e => e.type === 'book', stats);
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
    if (attempt >= 1) resupply(g, stats);   // 回城補給，否則越打越窮成了死亡螺旋
  }
  return { ok: false, why: `${loc.name} 過不去` };
}

function runCampaign(seed) {
  const g = G.newGame('測試俠', seed);
  const stats = { encounters: 0, bossAttempts: 0, bossLosses: 0, perLoc: [] };

  for (const locId of ROUTE) {
    const go = gotoLocation(g, locId, stats);
    if (go.status !== 'arrived') {
      return { ok: false, why: `到不了 ${LOC_BY_ID[locId].name}（${go.status}${go.why ? ': ' + go.why : ''}）`, g, stats };
    }
    const r = doLocation(g, locId, stats);
    if (!r.ok) return { ok: false, why: r.why, g, stats };
  }
  return { ok: !!g.flags['cleared:final'], g, stats, why: g.flags['cleared:final'] ? '' : '未擊敗東方不敗' };
}

// ─────────────────────────────────────────────
section('【四】主線可徒步通關（機器人真的用走的）');
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
    check('全程步數在合理範圍（<60000 步）', steps.every(s => s < 60000), `steps=${rng(steps)} 平均 ${avg(steps).toFixed(0)}`);
    check('通關天數在合理範圍（<1500 天）', day.every(d => d < 1500), `day=${rng(day)} 平均 ${avg(day).toFixed(0)}`);
    check('不必無限刷怪（平均遭遇 < 160 場）', avg(enc) < 160, `encounters=${rng(enc)} 平均 ${avg(enc).toFixed(0)}`);
    check('頭目戰有挑戰性（總計至少敗過一次）', losses.some(l => l > 0), `每局落敗 ${rng(losses)}`);
    check('但不至於處處碰壁（平均落敗 < 9 次）', avg(losses) < 9, `平均 ${avg(losses).toFixed(1)} 次`);
  }
}

// ─────────────────────────────────────────────
section('【五】各關難度曲線');
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
