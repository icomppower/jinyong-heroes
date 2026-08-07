// 無頭驗證：資料完整性、確定性、戰鬥平衡、主線可通關。
// 用法：node tools/verify.mjs [--quiet] [--seeds N]

import { RNG } from '../src/core/rng.js';
import { SKILLS, SKILL_BY_ID } from '../src/data/skills.js';
import { ITEMS, ITEM_BY_ID, QUEST_BOOKS } from '../src/data/items.js';
import { ALLIES, ENEMIES, ENEMY_BY_ID, ALLY_BY_ID, PLAYER_TEMPLATE, cloneChar } from '../src/data/chars.js';
import { LOCATIONS, LOC_BY_ID, travelCost } from '../src/data/world.js';
import { derived, maxHp, maxMp, canLearn } from '../src/core/rules.js';
import { createBattle, alive } from '../src/core/battle.js';
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
const pct = n => (n * 100).toFixed(0) + '%';

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

  const badEquip = allChars.flatMap(c =>
    Object.values(c.equip || {}).filter(i => !itemIds.has(i)).map(i => `${c.name}:${i}`));
  check('人物裝備皆存在', badEquip.length === 0, badEquip.join(','));

  const badTeach = ITEMS.filter(i => i.teaches && !skillIds.has(i.teaches)).map(i => i.id);
  check('秘笈所授武功皆存在', badTeach.length === 0, badTeach.join(','));

  check('主線秘笈共 14 部', QUEST_BOOKS.length === 14);
  const missingBooks = QUEST_BOOKS.filter(b => !itemIds.has(b));
  check('主線秘笈皆有物品定義', missingBooks.length === 0, missingBooks.join(','));

  const placed = LOCATIONS.map(l => l.book).filter(Boolean);
  check('十四部秘笈各有藏處', new Set(placed).size === 14 && QUEST_BOOKS.every(b => placed.includes(b)),
    `已配置 ${new Set(placed).size} 部`);

  const badLink = LOCATIONS.flatMap(l => l.links.filter(x => !locIds.has(x)).map(x => `${l.id}->${x}`));
  check('地圖連線指向存在的地點', badLink.length === 0, badLink.join(','));

  const asym = [];
  for (const l of LOCATIONS) for (const x of l.links) {
    if (!LOC_BY_ID[x].links.includes(l.id)) asym.push(`${l.id}->${x}`);
  }
  check('地圖連線雙向對稱', asym.length === 0, asym.join(','));

  // 連通性：從揚州能走到所有地點
  const seen = new Set(['yangzhou']);
  const q = ['yangzhou'];
  while (q.length) for (const n of LOC_BY_ID[q.pop()].links) if (!seen.has(n)) { seen.add(n); q.push(n); }
  check('全地圖自揚州可達', seen.size === LOCATIONS.length, `${seen.size}/${LOCATIONS.length}`);

  const badEnemy = LOCATIONS.flatMap(l =>
    [...(l.boss?.enemies || []), ...(l.mobs || [])].filter(e => !ENEMY_BY_ID[e]).map(e => `${l.id}:${e}`));
  check('地點敵人皆存在', badEnemy.length === 0, badEnemy.join(','));

  const badRecruit = LOCATIONS.flatMap(l => (l.recruit || [])
    .filter(r => !ALLY_BY_ID[r.id]).map(r => `${l.id}:${r.id}`));
  check('可招募人物皆存在', badRecruit.length === 0, badRecruit.join(','));

  const badNeed = LOCATIONS.flatMap(l => (l.recruit || [])
    .filter(r => r.needAlly && !ALLY_BY_ID[r.needAlly]).map(r => `${l.id}:${r.needAlly}`));
  check('前置同伴皆存在', badNeed.length === 0, badNeed.join(','));

  const badShop = LOCATIONS.flatMap(l => (l.shop || []).filter(i => !itemIds.has(i)).map(i => `${l.id}:${i}`));
  check('商店貨品皆存在', badShop.length === 0, badShop.join(','));

  // 每個同伴至少有一處可招募
  const recruitable = new Set(LOCATIONS.flatMap(l => (l.recruit || []).map(r => r.id)));
  const orphan = ALLIES.filter(a => !recruitable.has(a.id)).map(a => a.name);
  check('每位同伴都有招募地點', orphan.length === 0, orphan.join(','));

  // 資質門檻：每門秘笈至少有一人學得會
  const learnable = QUEST_BOOKS.map(b => {
    const sk = SKILL_BY_ID[ITEM_BY_ID[b].teaches];
    const who = [PLAYER_TEMPLATE, ...ALLIES].filter(c => c.apt >= sk.apt);
    return { name: sk.name, apt: sk.apt, n: who.length };
  }).filter(x => x.n === 0);
  check('每部秘笈都有人學得會', learnable.length === 0, learnable.map(x => `${x.name}(需資質${x.apt})`).join(','));
}

// ─────────────────────────────────────────────
section('【二】確定性');
{
  const mk = seed => {
    const allies = [cloneChar(PLAYER_TEMPLATE), cloneChar(ALLY_BY_ID.guojing)];
    allies.forEach(c => { c.curHp = maxHp(c); c.curMp = maxMp(c); });
    const enemies = ['b_qiuqianren', 'e_biaoshi'].map(id => {
      const c = cloneChar(ENEMY_BY_ID[id]); c.curHp = maxHp(c); c.curMp = maxMp(c); return c;
    });
    return createBattle({ allies, enemies, seed });
  };
  const a = autoBattle(mk(4242));
  const b = autoBattle(mk(4242));
  check('同種子戰鬥結果一致', JSON.stringify(a) === JSON.stringify(b), `${a.result} / ${a.rounds} 回合`);
  const c = autoBattle(mk(999));
  check('不同種子會產生不同過程', JSON.stringify(a) !== JSON.stringify(c));

  // 不會卡死
  let timeouts = 0;
  for (let s = 0; s < 40; s++) if (autoBattle(mk(s)).result === 'timeout') timeouts++;
  check('40 場戰鬥皆能終局（無卡死）', timeouts === 0, `timeout=${timeouts}`);
}

// ─────────────────────────────────────────────
section('【三】野球拳彩蛋');
{
  const mkHero = lvl => {
    const c = cloneChar(PLAYER_TEMPLATE);
    c.fist = 90; c.atk = 120;
    c.skills = [{ id: 'yeqiu', lvl, exp: 0 }];
    return c;
  };
  const dummy = cloneChar(ENEMY_BY_ID.e_seng);
  const { computeDamage } = await import('../src/core/rules.js');
  const flat = { chance: () => false, range: () => 0, next: () => 0.5, int: () => 0 };
  const d8 = computeDamage(mkHero(8), dummy, SKILL_BY_ID.yeqiu, 8, flat).dmg;
  const d10 = computeDamage(mkHero(10), dummy, SKILL_BY_ID.yeqiu, 10, flat).dmg;
  const xl10 = computeDamage(mkHero(10), dummy, SKILL_BY_ID.xianglong, 10, flat).dmg;
  check('野球拳十層威力遠勝八層', d10 > d8 * 4, `${d8} → ${d10}`);
  check('野球拳十層可與降龍十八掌抗衡', d10 > xl10 * 0.9, `野球拳 ${d10} vs 降龍 ${xl10}`);
}

// ─────────────────────────────────────────────
// 主線通關機器人
// ─────────────────────────────────────────────
const ROUTE = [
  // 依地圖實際走法排序：東部起手，中原，再繞西南環線，最後回頭上華山
  'yangzhou', 'fuwei', 'dongting', 'wudang', 'gumu', 'jueqing',
  'tianlong', 'wuliang', 'taohua', 'shaolin', 'huashan', 'heimu',
  'xiangyang', 'guangming', 'final',
];

function path(from, to) {
  const prev = { [from]: null };
  const q = [from];
  while (q.length) {
    const cur = q.shift();
    if (cur === to) break;
    for (const n of LOC_BY_ID[cur].links) if (!(n in prev)) { prev[n] = cur; q.push(n); }
  }
  if (!(to in prev)) return null;
  const out = [];
  for (let c = to; c && c !== from; c = prev[c]) out.unshift(c);
  return out;
}

// 真人玩家的習慣：秘笈優先給主角，主角學不了才給資質最高的同伴
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

function shopStock(g) {
  const loc = G.here(g);
  if (!loc.shop) return;
  // 補藥
  const want = [['p_dahuan', 8], ['p_xiaohuan', 8], ['p_baxian', 6], ['p_gudan', 6], ['p_jinchuang', 6], ['p_jiedu', 3]];
  for (const [id, n] of want) {
    if (!loc.shop.includes(id)) continue;
    while ((g.bag[id] || 0) < n && g.gold > ITEM_BY_ID[id].price * 3) G.buy(g, id);
  }
  // 買得起的秘笈
  for (const id of loc.shop) {
    const it = ITEM_BY_ID[id];
    if (it.type === 'book' && g.gold > it.price * 2.5 && !g.bag[id]) G.buy(g, id);
  }
  // 升級裝備
  for (const slot of ['weapon', 'armor', 'accessory']) {
    for (let ci = 0; ci < g.party.length; ci++) {
      const c = g.party[ci];
      const cur = ITEM_BY_ID[c.equip[slot]];
      const opts = loc.shop.map(i => ITEM_BY_ID[i]).filter(i => i.type === slot);
      for (const o of opts) {
        const better = (o.mods?.atk || 0) + (o.mods?.def || 0) > (cur?.mods?.atk || 0) + (cur?.mods?.def || 0);
        if (better && g.gold > o.price * 1.6) { G.buy(g, o.id); G.equip(g, ci, o.id); break; }
      }
    }
  }
}

function equipLoot(g) {
  for (let ci = 0; ci < g.party.length; ci++) {
    const c = g.party[ci];
    for (const { id, item } of G.bagList(g)) {
      if (!['weapon', 'armor', 'accessory'].includes(item.type)) continue;
      const cur = ITEM_BY_ID[c.equip[item.type]];
      const score = i => (i?.mods?.atk || 0) + (i?.mods?.def || 0) + (i?.mods?.hp || 0) / 8;
      if (score(item) > score(cur)) G.equip(g, ci, id);
    }
  }
}

function healUp(g) {
  const loc = G.here(g);
  if (loc.inn != null && g.gold >= loc.inn) { G.inn(g); return; }
  // 沒客棧就自行調息
  for (const c of g.party) {
    while (c.curHp < maxHp(c) * 0.85 && g.bag.p_dahuan) G.useItemWorld(g, g.party.indexOf(c), 'p_dahuan');
    while (c.curHp < maxHp(c) * 0.7 && g.bag.p_xiaohuan) G.useItemWorld(g, g.party.indexOf(c), 'p_xiaohuan');
    while (c.curMp < maxMp(c) * 0.6 && g.bag.p_baxian) G.useItemWorld(g, g.party.indexOf(c), 'p_baxian');
  }
  if (g.stamina < 40) { g.day += 2; g.stamina = Math.min(100, g.stamina + 45); }
}

function partyHpPct(g) {
  return g.party.reduce((n, c) => n + (c.curHp ?? 0) / maxHp(c), 0) / g.party.length;
}

function grind(g, rounds, stats) {
  const loc = G.here(g);
  if (!loc.mobs?.length) return;
  for (let i = 0; i < rounds; i++) {
    if (g.stamina < 12) { healUp(g); }
    const r = new RNG(g.rngState + i * 31);
    const n = 1 + r.int(3);
    const mobs = Array.from({ length: n }, () => r.pick(loc.mobs));
    const b = G.startEncounter(g, mobs);
    autoBattle(b);
    stats.encounters++;
    G.resolveBattle(g, b, false);
    if (partyHpPct(g) < 0.5) healUp(g);
  }
}

function goTo(g, dest, stats) {
  const p = path(g.at, dest);
  if (!p) return false;
  for (const step of p) {
    let guard = 0;
    while (g.stamina < travelCost(g.at, step).stamina && guard++ < 8) healUp(g);
    const r = G.travel(g, step);
    if (!r.ok) return false;
    if (r.encounter) {
      const b = G.startEncounter(g, r.encounter);
      autoBattle(b);
      stats.encounters++;
      G.resolveBattle(g, b, false);
      if (partyHpPct(g) < 0.45) healUp(g);
    }
  }
  return true;
}

function tryRecruit(g) {
  for (const c of G.recruitCandidates(g)) if (c.ok && !c.has) G.recruit(g, c.ally.id);
}

function runCampaign(seed, verbose = false) {
  const g = G.newGame('測試俠', seed);
  const stats = { encounters: 0, bossAttempts: 0, bossLosses: 0, perLoc: [] };
  let guardTotal = 0;

  for (const dest of ROUTE) {
    if (guardTotal++ > 60) break;
    // 先在沿途城鎮補給
    if (!goTo(g, dest, stats)) return { ok: false, why: `走不到 ${dest}`, g, stats };
    tryRecruit(g);
    studyAll(g);
    equipLoot(g);
    shopStock(g);
    healUp(g);

    const loc = G.here(g);
    if (!loc.boss) continue;

    let won = false;
    for (let attempt = 0; attempt < 6 && !won; attempt++) {
      healUp(g);
      studyAll(g);
      equipLoot(g);
      const b = G.startBoss(g);
      const res = autoBattle(b);
      stats.bossAttempts++;
      const out = G.resolveBattle(g, b, true);
      if (res.result === 'win') {
        won = true;
        stats.perLoc.push({
          loc: loc.id, name: loc.name, attempt: attempt + 1,
          lvl: g.party[0].lvl, party: g.party.length, day: g.day,
          hpLeft: res.allyHpPct, rounds: res.rounds,
        });
      } else {
        stats.bossLosses++;
        // 練級再來
        grind(g, 4 + attempt * 3, stats);
        tryRecruit(g);
        // 回城補給
        const town = ['xiangyang', 'yangzhou', 'dongting'].find(t => path(g.at, t));
        if (town && attempt >= 1) { goTo(g, town, stats); shopStock(g); tryRecruit(g); studyAll(g); goTo(g, loc.id, stats); }
      }
    }
    if (!won) return { ok: false, why: `${loc.name} 過不去（第 ${stats.bossAttempts} 次嘗試）`, g, stats };
  }

  const done = g.flags['cleared:final'];
  return { ok: !!done, g, stats, why: done ? '' : '未擊敗東方不敗' };
}

// ─────────────────────────────────────────────
section('【四】主線可通關（機器人自動遊玩）');
const runs = [];
for (let s = 0; s < SEEDS; s++) runs.push(runCampaign(1000 + s * 7717));
{
  const wins = runs.filter(r => r.ok);
  check(`${SEEDS} 局全部通關`, wins.length === SEEDS,
    `${wins.length}/${SEEDS}` + (wins.length < SEEDS ? ' | ' + runs.filter(r => !r.ok).map(r => r.why).join('; ') : ''));

  if (wins.length) {
    const lv = wins.map(r => r.g.party[0].lvl);
    const day = wins.map(r => r.g.day);
    const books = wins.map(r => r.g.books.length);
    const party = wins.map(r => r.g.party.length);
    const enc = wins.map(r => r.stats.encounters);
    const losses = wins.map(r => r.stats.bossLosses);
    const avg = a => (a.reduce((x, y) => x + y, 0) / a.length);
    const rng = a => `${Math.min(...a)}–${Math.max(...a)}`;

    check('通關時集齊 14 部秘笈', books.every(b => b === 14), `books=${rng(books)}`);
    check('主角終盤等級落在 18–40', lv.every(l => l >= 18 && l <= 40), `lvl=${rng(lv)} 平均 ${avg(lv).toFixed(1)}`);
    check('隊伍最終 4 人以上', party.every(p => p >= 4), `party=${rng(party)}`);
    check('通關天數在合理範圍（<900 天）', day.every(d => d < 900), `day=${rng(day)} 平均 ${avg(day).toFixed(0)}`);
    check('不必無限刷怪（平均遭遇 < 90 場）', avg(enc) < 90, `encounters=${rng(enc)} 平均 ${avg(enc).toFixed(0)}`);
    check('頭目戰有挑戰性（總計至少敗過一次）', losses.some(l => l > 0), `每局落敗次數 ${rng(losses)}`);
    check('但不至於處處碰壁（平均落敗 < 8 次）', avg(losses) < 8, `平均 ${avg(losses).toFixed(1)} 次`);
  }
}

// ─────────────────────────────────────────────
section('【五】各關難度曲線');
{
  const byLoc = new Map();
  for (const r of runs.filter(x => x.ok)) {
    for (const p of r.stats.perLoc) {
      if (!byLoc.has(p.loc)) byLoc.set(p.loc, []);
      byLoc.get(p.loc).push(p);
    }
  }
  const rows = ROUTE.filter(l => byLoc.has(l)).map(l => {
    const a = byLoc.get(l);
    const avg = k => a.reduce((n, x) => n + x[k], 0) / a.length;
    return { loc: l, name: LOC_BY_ID[l].name, attempts: avg('attempt'), lvl: avg('lvl'), day: avg('day'), n: a.length };
  });
  if (!QUIET) {
    console.log('  地點        平均嘗試  主角等級  天數');
    for (const r of rows) {
      console.log(`  ${r.name.padEnd(6, '　')} ${r.attempts.toFixed(2).padStart(8)} ${r.lvl.toFixed(1).padStart(9)} ${r.day.toFixed(0).padStart(6)}`);
    }
  }
  const lvls = rows.map(r => r.lvl);
  let mono = true;
  for (let i = 1; i < lvls.length; i++) if (lvls[i] < lvls[i - 1] - 0.5) mono = false;
  check('等級隨路線單調上升（難度曲線成立）', mono, rows.map(r => r.lvl.toFixed(0)).join('→'));
  check('沒有任何一關平均嘗試 ≥ 4 次（無牆關）', rows.every(r => r.attempts < 4),
    rows.filter(r => r.attempts >= 4).map(r => `${r.name}:${r.attempts.toFixed(1)}`).join(',') || '最高 ' +
    Math.max(...rows.map(r => r.attempts)).toFixed(2));
  const final = rows.find(r => r.loc === 'final');
  check('最終戰確實是最難的一關', !final || final.attempts >= Math.max(...rows.filter(r => r.loc !== 'final').map(r => r.attempts)) * 0.8,
    final ? `華山之巔 ${final.attempts.toFixed(2)} 次` : 'n/a');
}

// ─────────────────────────────────────────────
section('【六】戰鬥系統健全性');
{
  // 招式覆蓋：每門非內功武功都能被 AI 打出傷害
  const dummy = () => { const c = cloneChar(ENEMY_BY_ID.e_seng); c.curHp = maxHp(c); c.curMp = maxMp(c); return c; };
  const { computeDamage, computeHeal } = await import('../src/core/rules.js');
  const flat = { chance: () => false, range: () => 0, next: () => 0.5, int: () => 0 };
  const zero = [];
  for (const sk of SKILLS) {
    if (sk.kind === 'internal' || sk.shape === 'self') continue;
    const c = cloneChar(PLAYER_TEMPLATE);
    c.fist = c.sword = c.blade = c.special = c.hidden = c.medicine = c.poison = 60;
    c.skills = [{ id: sk.id, lvl: 5, exp: 0 }];
    const v = sk.kind === 'heal' ? computeHeal(c, sk, 5) : computeDamage(c, dummy(), sk, 5, flat).dmg;
    if (v <= 0) zero.push(sk.name);
  }
  check('每門武功五層時皆有實際效果', zero.length === 0, zero.join(','));

  // 內功等級確實提升上限
  const c1 = cloneChar(PLAYER_TEMPLATE);
  const c2 = cloneChar(PLAYER_TEMPLATE);
  c2.skills.push({ id: 'jiuyang', lvl: 8, exp: 0 });
  check('內功提升氣血與內力上限', maxMp(c2) > maxMp(c1) && maxHp(c2) > maxHp(c1),
    `${maxHp(c1)}/${maxMp(c1)} → ${maxHp(c2)}/${maxMp(c2)}`);

  // 移動力隨輕功成長
  const { moveRange } = await import('../src/core/rules.js');
  const slow = cloneChar(PLAYER_TEMPLATE);
  const fast = cloneChar(ALLY_BY_ID.xiaolongnv);
  check('輕功高者移動力較大', moveRange(fast) > moveRange(slow), `${moveRange(slow)} → ${moveRange(fast)}`);

  // 逃走機制在可逃戰中生效
  const { tryFlee } = await import('../src/core/battle.js');
  let fled = 0;
  const TRIES = 60;
  for (let s = 0; s < TRIES; s++) {
    const allies = [cloneChar(PLAYER_TEMPLATE)];
    allies[0].curHp = maxHp(allies[0]);
    const enemies = [cloneChar(ENEMY_BY_ID.b_dongfang)];
    enemies[0].curHp = maxHp(enemies[0]);
    const b = createBattle({ allies, enemies, seed: s, canFlee: true });
    if (tryFlee(b, b.units.find(u => u.side === 'ally'))) fled++;
  }
  // 輕功遠遜東方不敗，逃脫率應落在保底附近而非必成
  check('弱者面對強敵仍有逃生機會（但非必成）', fled > 0 && fled < TRIES,
    `${TRIES} 次嘗試逃脫 ${fled} 次（${pct(fled / TRIES)}）`);

  let fledStrong = 0;
  for (let s = 0; s < TRIES; s++) {
    const allies = [cloneChar(ALLY_BY_ID.xiaolongnv)];
    allies[0].curHp = maxHp(allies[0]);
    const enemies = [cloneChar(ENEMY_BY_ID.e_seng)];
    enemies[0].curHp = maxHp(enemies[0]);
    const b = createBattle({ allies, enemies, seed: s, canFlee: true });
    if (tryFlee(b, b.units.find(u => u.side === 'ally'))) fledStrong++;
  }
  check('輕功高者更容易脫身', fledStrong > fled, `${pct(fledStrong / TRIES)} > ${pct(fled / TRIES)}`);

  // 存讀檔往返
  const g = G.newGame('存檔測試', 77);
  G.addItem(g, 'p_dahuan', 2);
  const round = G.deserialize(G.serialize(g));
  check('存檔序列化往返無損', JSON.stringify(round) === JSON.stringify(g));
}

// ─────────────────────────────────────────────
console.log(`\n${'─'.repeat(52)}`);
console.log(`通過 ${pass}　失敗 ${fail}`);
if (fail) { console.log('\n失敗項目：'); fails.forEach(f => console.log('  · ' + f)); process.exit(1); }
console.log('全部通過。');
