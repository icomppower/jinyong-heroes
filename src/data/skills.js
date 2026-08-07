// 武功總表。
// kind: internal 內功 / fist 拳掌 / sword 劍法 / blade 刀法 / staff 特殊兵器 / hidden 暗器 / heal 醫術 / poison 毒功
// 傷害 = base + power * 等級，再乘上使用者的對應屬性與攻擊力（見 rules.js）
// shape: point 單體 / cross 十字 / line 直線貫穿 / burst 範圍爆發
// apt: 學習所需資質。effect: 附帶狀態。

export const SKILLS = [
  // ── 內功（被動：每級提升內力上限與攻防；同時是多數高階武功的前置） ──
  { id: 'quanzhen', name: '全真心法', kind: 'internal', apt: 20, mp: 0,
    passive: { mp: 6, atk: 1, def: 2, hp: 6 }, desc: '全真派入門正宗內功，中正平和，百練不傷。' },
  { id: 'hunyuan', name: '混元功', kind: 'internal', apt: 35, mp: 0,
    passive: { mp: 8, atk: 2, def: 2, hp: 8 }, desc: '崑崙派內功，剛柔並濟。' },
  { id: 'guixi', name: '龜息功', kind: 'internal', apt: 30, mp: 0,
    passive: { mp: 10, atk: 0, def: 4, hp: 10 }, desc: '閉氣凝神，可長久潛伏，守禦第一。' },
  { id: 'chunyang', name: '純陽無極功', kind: 'internal', apt: 55, mp: 0,
    passive: { mp: 12, atk: 3, def: 3, hp: 10 }, desc: '武當開派內功，綿綿若存，用之不勤。' },
  { id: 'yijin', name: '易筋經', kind: 'internal', apt: 70, mp: 0, book: true,
    passive: { mp: 16, atk: 3, def: 5, hp: 14 }, desc: '少林至高內功，易人筋骨、洗人骨髓。' },
  { id: 'jiuyang', name: '九陽神功', kind: 'internal', apt: 75, mp: 0, book: true,
    passive: { mp: 18, atk: 5, def: 4, hp: 18 }, desc: '他強由他強，清風拂山崗。內力生生不息。' },
  { id: 'jiuyin', name: '九陰真經', kind: 'internal', apt: 78, mp: 0, book: true,
    passive: { mp: 20, atk: 6, def: 3, hp: 12 }, desc: '天下武學總綱。「天之道，損有餘而補不足。」' },
  { id: 'beiming', name: '北冥神功', kind: 'internal', apt: 65, mp: 0, book: true,
    passive: { mp: 22, atk: 4, def: 2, hp: 10 }, desc: '北冥有魚，其名為鯤。化他人真氣為己用。' },
  { id: 'qiankun', name: '乾坤大挪移', kind: 'internal', apt: 80, mp: 0, book: true,
    passive: { mp: 18, atk: 6, def: 6, hp: 12 }, desc: '明教鎮教神功，借力打力，乾坤倒轉。' },
  { id: 'xixing', name: '吸星大法', kind: 'internal', apt: 60, mp: 0,
    passive: { mp: 24, atk: 4, def: 1, hp: 8 }, desc: '吸人內力為己有，然易生反噬。' },

  // ── 拳掌 ──
  { id: 'yeqiu', name: '野球拳', kind: 'fist', apt: 5, mp: 2, base: 4, power: 3,
    rmin: 1, rmax: 1, shape: 'point', book: true,
    desc: '「一二三四五六七」——粗淺不堪的市井把式。然練至第十層，威力莫可測度。' },
  { id: 'taizu', name: '太祖長拳', kind: 'fist', apt: 15, mp: 3, base: 8, power: 4,
    rmin: 1, rmax: 1, shape: 'point', desc: '宋太祖所傳，天下第一等的拳法，人人會使。' },
  { id: 'weituo', name: '韋陀掌', kind: 'fist', apt: 20, mp: 4, base: 10, power: 5,
    rmin: 1, rmax: 1, shape: 'point', desc: '少林入門掌法，樸實無華。' },
  { id: 'longzhua', name: '龍爪手', kind: 'fist', apt: 35, mp: 8, base: 14, power: 7,
    rmin: 1, rmax: 1, shape: 'point', effect: { type: 'weaken', chance: 0.3, power: 12, turns: 3 },
    desc: '少林七十二絕技之一，爪出如龍，鎖筋錯骨。' },
  { id: 'kongming', name: '空明拳', kind: 'fist', apt: 45, mp: 10, base: 12, power: 8,
    rmin: 1, rmax: 1, shape: 'point', effect: { type: 'mpdrain', chance: 0.5, power: 10 },
    desc: '周伯通自創，以空御實，「空朦洞鬆，風通容夢」。' },
  { id: 'hama', name: '蛤蟆功', kind: 'fist', apt: 50, mp: 14, base: 20, power: 9,
    rmin: 1, rmax: 2, shape: 'point', desc: '西毒絕學，蓄勢如蟾，一擊爆發。' },
  { id: 'qishang', name: '七傷拳', kind: 'fist', apt: 55, mp: 16, base: 24, power: 11,
    rmin: 1, rmax: 1, shape: 'point', recoil: 0.12,
    desc: '「七傷拳，七傷拳，先傷己，再傷人。」' },
  { id: 'huagu', name: '化骨綿掌', kind: 'fist', apt: 50, mp: 15, base: 16, power: 8,
    rmin: 1, rmax: 1, shape: 'point', effect: { type: 'poison', chance: 0.6, power: 14, turns: 4 },
    desc: '掌力綿軟，中者三日之內骨骼盡碎。' },
  { id: 'luoying', name: '落英神劍掌', kind: 'fist', apt: 55, mp: 16, base: 18, power: 9,
    rmin: 1, rmax: 1, shape: 'cross', area: 1,
    desc: '桃花島掌法，如落英繽紛，一招之出漫天皆是。' },
  { id: 'tianshan', name: '天山六陽掌', kind: 'fist', apt: 60, mp: 20, base: 22, power: 11,
    rmin: 1, rmax: 2, shape: 'burst', area: 1,
    desc: '逍遙派陽剛掌力，六道陽氣並發。' },
  { id: 'baigu', name: '九陰白骨爪', kind: 'fist', apt: 60, mp: 18, base: 26, power: 12,
    rmin: 1, rmax: 1, shape: 'point', effect: { type: 'weaken', chance: 0.45, power: 18, turns: 3 },
    desc: '摧堅透骨，五指扣入天靈。九陰真經之邪練。' },
  { id: 'xianglong', name: '降龍十八掌', kind: 'fist', apt: 70, mp: 26, base: 34, power: 15,
    rmin: 1, rmax: 2, shape: 'line', area: 3, book: true,
    desc: '亢龍有悔，飛龍在天。天下至剛至猛，丐幫鎮幫絕學。' },
  { id: 'anran', name: '黯然銷魂掌', kind: 'fist', apt: 75, mp: 30, base: 30, power: 16,
    rmin: 1, rmax: 1, shape: 'burst', area: 2, book: true,
    desc: '「黯然銷魂者，唯別而已矣。」心傷愈重，掌力愈強。' },

  // ── 劍法 ──
  { id: 'quanzhenjian', name: '全真劍法', kind: 'sword', apt: 20, mp: 4, base: 10, power: 5,
    rmin: 1, rmax: 1, shape: 'point', desc: '全真派正宗劍術，堂堂正正。' },
  { id: 'yuenv', name: '越女劍法', kind: 'sword', apt: 30, mp: 6, base: 13, power: 6,
    rmin: 1, rmax: 1, shape: 'point', desc: '阿青所傳，一劍化三千，快而不亂。' },
  { id: 'yunv', name: '玉女劍法', kind: 'sword', apt: 45, mp: 12, base: 17, power: 8,
    rmin: 1, rmax: 1, shape: 'point', pair: true, book: true,
    desc: '古墓派劍法，須得雙劍合璧，威力方顯。' },
  { id: 'taiji', name: '太極劍法', kind: 'sword', apt: 60, mp: 16, base: 20, power: 10,
    rmin: 1, rmax: 1, shape: 'point', effect: { type: 'reflect', chance: 0.35, power: 0.5, turns: 2 },
    desc: '以圓轉之意化他人之力，忘招方能得意。' },
  { id: 'liangyi', name: '兩儀劍法', kind: 'sword', apt: 55, mp: 15, base: 19, power: 9,
    rmin: 1, rmax: 1, shape: 'cross', area: 1, desc: '崑崙派雙劍互補，陰陽相濟。' },
  { id: 'pixie', name: '辟邪劍法', kind: 'sword', apt: 65, mp: 18, base: 24, power: 13,
    rmin: 1, rmax: 1, shape: 'point', extraTurn: 0.25, book: true,
    desc: '「欲練神功，引刀自宮。」快到極處，人所難防。' },
  { id: 'dugu', name: '獨孤九劍', kind: 'sword', apt: 80, mp: 24, base: 32, power: 16,
    rmin: 1, rmax: 2, shape: 'point', pierce: 0.5, book: true,
    desc: '料敵機先，有進無退。天下無不可破之招。' },
  { id: 'liumai', name: '六脈神劍', kind: 'sword', apt: 78, mp: 32, base: 30, power: 15,
    rmin: 2, rmax: 5, shape: 'line', area: 4, book: true,
    desc: '以內力化為無形劍氣，隔空傷人，大理段氏至高絕學。' },

  // ── 刀法 ──
  { id: 'wuhu', name: '五虎斷門刀', kind: 'blade', apt: 25, mp: 6, base: 14, power: 6,
    rmin: 1, rmax: 1, shape: 'point', desc: '江湖流傳最廣的刀法，剛猛直進。' },
  { id: 'hujia', name: '胡家刀法', kind: 'blade', apt: 45, mp: 12, base: 20, power: 10,
    rmin: 1, rmax: 1, shape: 'point', desc: '遼東大俠胡一刀家傳，招招不離要害。' },
  { id: 'kuangfeng', name: '狂風快刀', kind: 'blade', apt: 40, mp: 12, base: 17, power: 9,
    rmin: 1, rmax: 1, shape: 'cross', area: 1, desc: '刀走輕靈，快如狂風捲葉。' },
  { id: 'xuedao', name: '血刀刀法', kind: 'blade', apt: 55, mp: 18, base: 26, power: 12,
    rmin: 1, rmax: 1, shape: 'point', drain: 0.3,
    desc: '血刀門邪功，刀鋒飲血，傷敵愈重，己身愈健。' },

  // ── 特殊兵器 ──
  { id: 'dagou', name: '打狗棒法', kind: 'staff', apt: 65, mp: 20, base: 25, power: 13,
    rmin: 1, rmax: 2, shape: 'point', effect: { type: 'stun', chance: 0.3, turns: 1 }, book: true,
    desc: '丐幫幫主歷代單傳，絆、劈、纏、戳、挑、引、封、轉。' },
  { id: 'tanzhi', name: '彈指神通', kind: 'staff', apt: 60, mp: 16, base: 20, power: 11,
    rmin: 2, rmax: 4, shape: 'point', desc: '東邪絕技，屈指成劍，隔空彈石。' },
  { id: 'yiyang', name: '一陽指', kind: 'staff', apt: 62, mp: 18, base: 22, power: 12,
    rmin: 1, rmax: 3, shape: 'point', pierce: 0.35, desc: '大理段氏指法，一指之力可透金石。' },
  { id: 'shengsi', name: '生死符', kind: 'staff', apt: 70, mp: 26, base: 16, power: 8,
    rmin: 2, rmax: 4, shape: 'burst', area: 1,
    effect: { type: 'poison', chance: 0.8, power: 22, turns: 5 },
    desc: '以薄冰為符，寒熱交攻，中者求生不得求死不能。' },
  { id: 'tianluo', name: '天羅地網勢', kind: 'staff', apt: 50, mp: 14, base: 12, power: 6,
    rmin: 1, rmax: 3, shape: 'burst', area: 2, effect: { type: 'stun', chance: 0.45, turns: 1 },
    desc: '漁網罩落，四方皆縛。' },
  { id: 'jingang', name: '金剛不壞體', kind: 'staff', apt: 55, mp: 20, base: 0, power: 0,
    rmin: 0, rmax: 0, shape: 'self', effect: { type: 'guard', chance: 1, power: 0.5, turns: 4 },
    desc: '少林護體神功，運起後刀劍難傷。' },

  // ── 暗器 ──
  { id: 'mantian', name: '滿天花雨', kind: 'hidden', apt: 40, mp: 10, base: 12, power: 6,
    rmin: 2, rmax: 5, shape: 'burst', area: 1, desc: '暗器出手如花雨紛落，避無可避。' },
  { id: 'yufeng', name: '玉蜂針', kind: 'hidden', apt: 45, mp: 12, base: 14, power: 7,
    rmin: 2, rmax: 5, shape: 'point', effect: { type: 'poison', chance: 0.7, power: 12, turns: 4 },
    desc: '古墓玉蜂尾針，細不可見，見血封喉。' },
  { id: 'binghpo', name: '冰魄銀針', kind: 'hidden', apt: 50, mp: 14, base: 16, power: 8,
    rmin: 2, rmax: 6, shape: 'point', effect: { type: 'stun', chance: 0.35, turns: 1 },
    desc: '寒毒入體，中者渾身如墜冰窟。' },
  { id: 'hansha', name: '含沙射影', kind: 'hidden', apt: 55, mp: 16, base: 18, power: 9,
    rmin: 3, rmax: 7, shape: 'line', area: 3, desc: '暗中發矢，一線穿三。' },

  // ── 醫術與毒 ──
  { id: 'huichun', name: '回春術', kind: 'heal', apt: 35, mp: 12, base: 30, power: 12,
    rmin: 0, rmax: 3, shape: 'point', desc: '推宮過血，續斷接骨。' },
  { id: 'wuduzhang', name: '五毒神掌', kind: 'poison', apt: 50, mp: 16, base: 14, power: 7,
    rmin: 1, rmax: 1, shape: 'point', effect: { type: 'poison', chance: 0.85, power: 20, turns: 5 },
    desc: '五毒教掌法，掌心藏毒，一觸即發。' },
  { id: 'bihai', name: '碧海潮生曲', kind: 'poison', apt: 68, mp: 24, base: 10, power: 5,
    rmin: 0, rmax: 4, shape: 'burst', area: 3, effect: { type: 'mpdrain', chance: 0.9, power: 26 },
    desc: '以簫聲亂人心神，潮生潮落，內息俱散。' },
  { id: 'kuihua', name: '葵花寶典', kind: 'sword', apt: 85, mp: 30, base: 30, power: 17,
    rmin: 1, rmax: 2, shape: 'cross', area: 1, extraTurn: 0.35, book: true,
    desc: '武林至邪至快之典。得之者，可橫行天下。' },
  { id: 'taijiquan', name: '太極拳經', kind: 'fist', apt: 72, mp: 22, base: 26, power: 14,
    rmin: 1, rmax: 1, shape: 'point', effect: { type: 'reflect', chance: 0.5, power: 0.6, turns: 3 },
    book: true, desc: '以慢打快，以柔克剛。張三丰百歲所悟。' },
];

export const SKILL_BY_ID = Object.fromEntries(SKILLS.map(s => [s.id, s]));

export const KIND_NAME = {
  internal: '內功', fist: '拳掌', sword: '劍法', blade: '刀法',
  staff: '特殊', hidden: '暗器', heal: '醫術', poison: '毒功',
};

// 各類武功使用的角色屬性
export const KIND_STAT = {
  fist: 'fist', sword: 'sword', blade: 'blade', staff: 'special',
  hidden: 'hidden', heal: 'medicine', poison: 'poison', internal: null,
};

export function skill(id) {
  const s = SKILL_BY_ID[id];
  if (!s) throw new Error('unknown skill: ' + id);
  return s;
}
