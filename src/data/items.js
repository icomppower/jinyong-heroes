// 物品總表。type: weapon 兵器 / armor 護甲 / accessory 飾物 / potion 藥品 / book 秘笈 / quest 信物
// mods 為裝備加成；use 為使用效果；teaches 為秘笈可習得之武功。

export const ITEMS = [
  // ── 兵器 ──
  { id: 'w_mudao', name: '木刀', type: 'weapon', price: 50, mods: { atk: 6 }, wkind: 'blade', desc: '練武用的木刀。' },
  { id: 'w_gangdao', name: '精鋼刀', type: 'weapon', price: 400, mods: { atk: 18 }, wkind: 'blade', desc: '鋪子裡買得到的好刀。' },
  { id: 'w_xuedao', name: '血刀', type: 'weapon', price: 2600, mods: { atk: 46, poison: 10 }, wkind: 'blade', desc: '血刀老祖的成名兇器，刀身赤如凝血。' },
  { id: 'w_lengyue', name: '冷月寶刀', type: 'weapon', price: 4200, mods: { atk: 62, qinggong: 6 }, wkind: 'blade', desc: '刀光如霜月，出鞘則寒氣逼人。' },
  { id: 'w_tiejian', name: '鐵劍', type: 'weapon', price: 80, mods: { atk: 8 }, wkind: 'sword', desc: '尋常鐵劍。' },
  { id: 'w_qingang', name: '青鋼劍', type: 'weapon', price: 500, mods: { atk: 20 }, wkind: 'sword', desc: '劍身泛青，鋒利可斷髮。' },
  { id: 'w_junzi', name: '君子劍', type: 'weapon', price: 3000, mods: { atk: 48, def: 8 }, wkind: 'sword', desc: '與淑女劍為一對，溫潤而利。' },
  { id: 'w_yitian', name: '倚天劍', type: 'weapon', price: 9000, mods: { atk: 88, sword: 12 }, wkind: 'sword', desc: '武林至尊，寶刀屠龍。倚天不出，誰與爭鋒。' },
  { id: 'w_xuantie', name: '玄鐵重劍', type: 'weapon', price: 8000, mods: { atk: 96, qinggong: -10 }, wkind: 'sword', desc: '重劍無鋒，大巧不工。四十歲前恃之橫行天下。' },
  { id: 'w_dagoubang', name: '打狗棒', type: 'weapon', price: 5000, mods: { atk: 54, special: 15 }, wkind: 'staff', desc: '碧玉青竹，丐幫幫主信物。' },
  { id: 'w_yuxiao', name: '玉簫', type: 'weapon', price: 2200, mods: { atk: 34, mp: 40 }, wkind: 'staff', desc: '東邪隨身之物，可奏碧海潮生。' },
  { id: 'w_tulong', name: '屠龍刀', type: 'weapon', price: 9500, mods: { atk: 100, blade: 12 }, wkind: 'blade', desc: '號令天下，莫敢不從。' },

  // ── 護甲 ──
  { id: 'a_bu', name: '粗布衣', type: 'armor', price: 30, mods: { def: 4 }, desc: '尋常百姓的衣衫。' },
  { id: 'a_pi', name: '皮甲', type: 'armor', price: 260, mods: { def: 14 }, desc: '硝製牛皮所縫。' },
  { id: 'a_suozi', name: '鎖子甲', type: 'armor', price: 900, mods: { def: 28 }, desc: '環環相扣，刀劍難入。' },
  { id: 'a_wugou', name: '烏蠶衣', type: 'armor', price: 3200, mods: { def: 46, poisonRes: 20 }, desc: '烏蠶絲織就，百毒不侵。' },
  { id: 'a_jinsi', name: '金絲軟甲', type: 'armor', price: 6000, mods: { def: 62, hp: 60 }, desc: '刀槍不入的護身寶甲。' },
  { id: 'a_xuanbing', name: '玄冰披風', type: 'armor', price: 4400, mods: { def: 52, mp: 50 }, desc: '寒玉所製，靜坐其上內力精進。' },

  // ── 飾物 ──
  { id: 'c_yupei', name: '玉珮', type: 'accessory', price: 200, mods: { mp: 20 }, desc: '溫潤羊脂玉。' },
  { id: 'c_jiuhua', name: '九花玉露丸囊', type: 'accessory', price: 1200, mods: { hp: 50, medicine: 8 }, desc: '藥香隨身，療傷事半功倍。' },
  { id: 'c_hanyu', name: '寒玉牌', type: 'accessory', price: 2400, mods: { mp: 70, def: 6 }, desc: '古墓寒玉，凝神養氣。' },
  { id: 'c_qingyun', name: '輕雲履', type: 'accessory', price: 1800, mods: { qinggong: 22 }, desc: '踏之如行雲，身法倍捷。' },
  { id: 'c_shezhu', name: '蛇珠', type: 'accessory', price: 2000, mods: { poisonRes: 45, hp: 30 }, desc: '含之百毒不侵。' },
  { id: 'c_jinlun', name: '金輪', type: 'accessory', price: 5200, mods: { atk: 24, def: 18 }, desc: '金輪法王隨身法器。' },

  // ── 藥品 ──
  { id: 'p_jinchuang', name: '金創藥', type: 'potion', price: 40, use: { hp: 80 }, desc: '止血生肌。' },
  { id: 'p_xiaohuan', name: '小還丹', type: 'potion', price: 120, use: { hp: 220 }, desc: '少林傷藥，服之立見奇效。' },
  { id: 'p_dahuan', name: '大還丹', type: 'potion', price: 400, use: { hp: 600 }, desc: '生死人而肉白骨。' },
  { id: 'p_gudan', name: '固本丹', type: 'potion', price: 150, use: { mp: 120 }, desc: '固本培元，回復內力。' },
  { id: 'p_baxian', name: '八仙丸', type: 'potion', price: 460, use: { mp: 320 }, desc: '八味奇藥所煉，內息立復。' },
  { id: 'p_jiedu', name: '解毒丹', type: 'potion', price: 90, use: { cure: ['poison'] }, desc: '解百般毒物。' },
  { id: 'p_xingshen', name: '醒神香', type: 'potion', price: 110, use: { cure: ['stun', 'weaken'] }, desc: '一嗅則神智立清。' },
  { id: 'p_ganlu', name: '甘露丸', type: 'potion', price: 700, use: { hp: 400, mp: 200, cure: ['poison', 'stun', 'weaken'] }, desc: '天山童姥所煉，諸傷俱癒。' },
  { id: 'p_gangjing', name: '乾坤一氣丹', type: 'potion', price: 2500, use: { permMp: 12 }, desc: '服之內力上限永久精進。' },
  { id: 'p_xionghuang', name: '雄黃酒', type: 'potion', price: 60, use: { stamina: 40 }, desc: '驅寒解乏，走遠路的好東西。' },
  { id: 'p_mangguo', name: '莽牯朱蛤', type: 'potion', price: 3000, use: { permPoisonRes: 40, hp: 200 }, desc: '萬毒之王，食之百毒不侵。' },

  // ── 十四秘笈（主線）──
  { id: 'b_yeqiu', name: '野球拳譜', type: 'book', price: 0, teaches: 'yeqiu', desc: '一本破爛不堪的拳譜，扉頁寫著「一二三四五六七」。' },
  { id: 'b_yijin', name: '易筋經', type: 'book', price: 0, teaches: 'yijin', desc: '達摩老祖東來所遺，梵文寫就。' },
  { id: 'b_jiuyang', name: '九陽真經', type: 'book', price: 0, teaches: 'jiuyang', desc: '夾藏於楞伽經字裡行間的無上內功。' },
  { id: 'b_jiuyin', name: '九陰真經', type: 'book', price: 0, teaches: 'jiuyin', desc: '黃裳所著，天下武學之總綱。' },
  { id: 'b_beiming', name: '北冥神功', type: 'book', price: 0, teaches: 'beiming', desc: '逍遙派神功圖譜，繪有無數小人。' },
  { id: 'b_qiankun', name: '乾坤大挪移心法', type: 'book', price: 0, teaches: 'qiankun', desc: '明教歷代教主相傳，藏於光明頂密道。' },
  { id: 'b_dugu', name: '獨孤九劍要訣', type: 'book', price: 0, teaches: 'dugu', desc: '刻於華山思過崖石壁之上。' },
  { id: 'b_xianglong', name: '降龍十八掌譜', type: 'book', price: 0, teaches: 'xianglong', desc: '丐幫至寶，掌譜上畫著十八條神龍。' },
  { id: 'b_pixie', name: '辟邪劍譜', type: 'book', price: 0, teaches: 'pixie', desc: '袈裟上以蠅頭小楷寫成，開篇一行血字。' },
  { id: 'b_liumai', name: '六脈神劍經', type: 'book', price: 0, teaches: 'liumai', desc: '天龍寺鎮寺之寶，需絕頂內力方能施展。' },
  { id: 'b_yunv', name: '玉女心經', type: 'book', price: 0, teaches: 'yunv', desc: '林朝英所創，字裡行間盡是未了情。' },
  { id: 'b_anran', name: '黯然銷魂掌訣', type: 'book', price: 0, teaches: 'anran', desc: '楊過獨居絕情谷十六年所悟。' },
  { id: 'b_kuihua', name: '葵花寶典', type: 'book', price: 0, teaches: 'kuihua', desc: '殘卷一冊，翻開便覺殺氣撲面。' },
  { id: 'b_taiji', name: '太極拳經', type: 'book', price: 0, teaches: 'taijiquan', desc: '張三丰手書，一筆一畫皆是圓轉之意。' },

  // ── 可習得的江湖散學（非主線秘笈，商店或事件取得）──
  { id: 'b_quanzhen', name: '全真心法抄本', type: 'book', price: 300, teaches: 'quanzhen', desc: '全真教入門心法抄本。' },
  { id: 'b_taizu', name: '太祖長拳圖解', type: 'book', price: 250, teaches: 'taizu', desc: '市井拳師人手一冊。' },
  { id: 'b_wuhu', name: '五虎斷門刀譜', type: 'book', price: 300, teaches: 'wuhu', desc: '江湖上最常見的刀譜。' },
  { id: 'b_quanzhenjian', name: '全真劍法譜', type: 'book', price: 320, teaches: 'quanzhenjian', desc: '全真派劍術入門。' },
  { id: 'b_huichun', name: '回春醫典', type: 'book', price: 900, teaches: 'huichun', desc: '蝶谷醫仙所遺醫書。' },
  { id: 'b_guixi', name: '龜息功訣', type: 'book', price: 800, teaches: 'guixi', desc: '道家吐納之術。' },
  { id: 'b_mantian', name: '滿天花雨手冊', type: 'book', price: 1100, teaches: 'mantian', desc: '暗器手法圖說。' },
  { id: 'b_hunyuan', name: '混元功心訣', type: 'book', price: 1400, teaches: 'hunyuan', desc: '崑崙派內功。' },
  { id: 'b_chunyang', name: '純陽無極功', type: 'book', price: 2600, teaches: 'chunyang', desc: '武當派內功心法。' },
  { id: 'b_jingang', name: '金剛不壞體神功', type: 'book', price: 2200, teaches: 'jingang', desc: '少林護體之法。' },

  // ── 信物 ──
  { id: 'q_lingpai', name: '丐幫令牌', type: 'quest', price: 0, desc: '見牌如見幫主。' },
  { id: 'q_jian', name: '半塊玉玦', type: 'quest', price: 0, desc: '斷口新鮮，似乎另有半塊。' },
];

export const ITEM_BY_ID = Object.fromEntries(ITEMS.map(i => [i.id, i]));
export function item(id) {
  const it = ITEM_BY_ID[id];
  if (!it) throw new Error('unknown item: ' + id);
  return it;
}

// 主線十四秘笈
export const QUEST_BOOKS = [
  'b_yeqiu', 'b_yijin', 'b_jiuyang', 'b_jiuyin', 'b_beiming', 'b_qiankun', 'b_dugu',
  'b_xianglong', 'b_pixie', 'b_liumai', 'b_yunv', 'b_anran', 'b_kuihua', 'b_taiji',
];
