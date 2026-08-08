// 江湖地理 — 手寫的拓樸。
//
// 借 Golden Hour（SF Sunset Drive）的做法：城市是純資料，引擎只負責跑。
// 分界在於「拓樸手寫，貼圖生成」——海岸線、河、山脈、官道、城鎮街廓的位置
// 全部是人放的座標；荒野的草木沙石交給有種子的生成器填。
//
// v2 的三個大缺陷（官道穿過城門、襄陽 NPC 圍死中央、大地圖外圈沒清到）
// 都是程序生成的產物。拓樸改成資料之後，那一整類問題不存在了。

export const W = 384, H = 288;

// ── 東海海岸線（由北到南）。x 大於此線者為海 ──
export const COAST = [
  [372, -8], [366, 24], [358, 48], [352, 72], [348, 96], [344, 120],
  [338, 144], [342, 168], [336, 192], [330, 216], [336, 240], [344, 264], [352, 296],
];

// ── 江河 ──
export const RIVERS = [
  { name: '大江', width: 2, pts: [[86, 262], [140, 256], [192, 248], [236, 232], [251, 216]] },
  { name: '大江下游', width: 2, pts: [[266, 188], [292, 176], [316, 166], [340, 156]] },
  { name: '漢水', width: 1, pts: [[200, 60], [204, 108], [198, 142], [202, 178], [212, 208], [230, 226]] },
];

// ── 湖 ──
export const LAKES = [
  { name: '洞庭湖', x: 250, y: 200, rx: 30, ry: 20 },
];

// ── 山脈（脊線段 + 半徑 + 峰高）──
export const RANGES = [
  { name: '崑崙', a: [38, 56], b: [108, 112], r: 26, h: 208 },
  { name: '祁連', a: [96, 40], b: [140, 62], r: 16, h: 168 },
  { name: '終南', a: [172, 42], b: [214, 66], r: 17, h: 176 },
  { name: '黑木崖', a: [126, 62], b: [156, 86], r: 14, h: 192 },
  { name: '西嶽', a: [148, 88], b: [174, 126], r: 18, h: 214 },
  { name: '嵩山', a: [216, 84], b: [250, 106], r: 14, h: 152 },
  { name: '秦嶺', a: [110, 116], b: [150, 132], r: 15, h: 150 },
  { name: '武當', a: [166, 170], b: [196, 192], r: 13, h: 158 },
  { name: '峨嵋', a: [130, 176], b: [160, 200], r: 14, h: 166 },
  { name: '無量', a: [80, 210], b: [122, 238], r: 18, h: 174 },
  { name: '蒼山', a: [96, 240], b: [136, 262], r: 14, h: 142 },
];

// ── 獨立山峰。華山之巔是全圖最高點，遠遠就看得見 ──
export const PEAKS = [
  { name: '華山之巔', x: 158, y: 96, r: 13, h: 255 },
  { name: '光明頂', x: 72, y: 88, r: 10, h: 206 },
];

// ── 十五處城鎮山門。座標照原著相對位置釘死 ──
// style 決定街廓型別；deep 是頭目與秘笈所在（相對於中心的偏移）。
export const DISTRICTS = [
  { id: 'guangming', cx: 72, cy: 88, w: 28, h: 22, style: 'sect', deep: [0, -7] },
  { id: 'heimu', cx: 140, cy: 74, w: 28, h: 22, style: 'sect', deep: [0, -7] },
  { id: 'gumu', cx: 192, cy: 54, w: 26, h: 20, style: 'wild', deep: [0, -6] },
  { id: 'final', cx: 158, cy: 96, w: 16, h: 14, style: 'final', deep: [0, -4] },
  { id: 'huashan', cx: 164, cy: 120, w: 28, h: 22, style: 'sect', deep: [0, -7] },
  { id: 'shaolin', cx: 232, cy: 96, w: 28, h: 22, style: 'sect', deep: [0, -7] },
  { id: 'xiangyang', cx: 222, cy: 156, w: 34, h: 26, style: 'town', deep: [0, -9] },
  { id: 'wudang', cx: 180, cy: 182, w: 28, h: 22, style: 'sect', deep: [0, -7] },
  { id: 'dongting', cx: 250, cy: 200, w: 28, h: 22, style: 'sect', deep: [0, -7] },
  { id: 'yangzhou', cx: 306, cy: 142, w: 34, h: 26, style: 'town', deep: [0, -9] },
  { id: 'taohua', cx: 356, cy: 158, w: 22, h: 18, style: 'wild', deep: [0, -5] },
  { id: 'fuwei', cx: 322, cy: 232, w: 26, h: 20, style: 'wild', deep: [0, -6] },
  { id: 'jueqing', cx: 186, cy: 216, w: 26, h: 20, style: 'wild', deep: [0, -6] },
  { id: 'wuliang', cx: 100, cy: 224, w: 26, h: 20, style: 'wild', deep: [0, -6] },
  { id: 'tianlong', cx: 116, cy: 252, w: 28, h: 22, style: 'sect', deep: [0, -7] },
];

export const DISTRICT_BY_ID = Object.fromEntries(DISTRICTS.map(d => [d.id, d]));

export function districtRect(d) {
  return {
    x0: d.cx - (d.w >> 1), y0: d.cy - (d.h >> 1),
    x1: d.cx + (d.w >> 1), y1: d.cy + (d.h >> 1),
  };
}

// ── 官道網。路只在路口交會；經過的 via 點就是路口 ──
// 端點可寫地點 id，也可寫 NODES 裡的路口名。
export const NODES = {
  dongtingShore: [250, 176],      // 洞庭北岸，君山石橋的橋頭
  taohuaDock: [330, 150],         // 東海渡口（本土側）
};

export const ROADS = [
  { a: 'yangzhou', b: 'xiangyang', via: [[276, 146], [252, 152]] },
  { a: 'yangzhou', b: 'fuwei', via: [[312, 178], [318, 206]] },
  { a: 'yangzhou', b: 'taohuaDock', via: [[320, 146]] },
  { a: 'xiangyang', b: 'shaolin', via: [[228, 128]] },
  { a: 'xiangyang', b: 'huashan', via: [[196, 140]] },
  { a: 'xiangyang', b: 'wudang', via: [[206, 172]] },
  { a: 'xiangyang', b: 'dongtingShore', via: [[236, 166]] },
  { a: 'shaolin', b: 'huashan', via: [[202, 104]] },
  { a: 'huashan', b: 'gumu', via: [[178, 88], [188, 70]] },
  { a: 'huashan', b: 'final', via: [] },
  { a: 'huashan', b: 'heimu', via: [[148, 104]] },
  { a: 'heimu', b: 'guangming', via: [[112, 78]] },
  { a: 'guangming', b: 'wuliang', via: [[78, 138], [90, 190]] },
  { a: 'wuliang', b: 'tianlong', via: [[106, 238]] },
  { a: 'tianlong', b: 'jueqing', via: [[148, 246], [172, 230]] },
  { a: 'jueqing', b: 'dongtingShore', via: [[204, 206], [224, 184]] },
  { a: 'wudang', b: 'dongtingShore', via: [[212, 182], [234, 178]] },
  { a: 'fuwei', b: 'dongtingShore', via: [[292, 214], [274, 174]] },
];

// ── 君山石橋（洞庭湖上的長堤）──
export const CAUSEWAY = { from: [250, 176], to: [250, 190], width: 3 };

// ── 渡口：東海往桃花島。踏上渡口即渡海，是唯一的「非徒步」移動 ──
export const FERRY = {
  a: { x: 330, y: 150, name: '東海渡口' },
  b: { x: 346, y: 167, name: '桃花島渡口' },
  island: 'taohua', fare: 12, hours: 6,
};

// ── 出生點：揚州城外的官道上 ──
export const SPAWN = { x: 306, y: 161 };

// ── 江湖自己會動：商隊、鏢局押鏢、各派巡山弟子 ──
// route 由建圖時沿官道尋路算出；pos 是 steps 的純函式，不必存檔。
export const ACTORS = [
  { id: 'caravan_yx', kind: 'caravan', from: 'yangzhou', to: 'xiangyang', speed: 2, offset: 0, name: '行商隊' },
  { id: 'caravan_xd', kind: 'caravan', from: 'xiangyang', to: 'dongtingShore', speed: 2, offset: 11, name: '鹽幫商隊' },
  { id: 'escort_yf', kind: 'escort', from: 'yangzhou', to: 'fuwei', speed: 3, offset: 5, name: '福威鏢隊' },
  { id: 'escort_hs', kind: 'escort', from: 'huashan', to: 'shaolin', speed: 3, offset: 17, name: '鎮遠鏢隊' },
  { id: 'patrol_shaolin', kind: 'patrol', from: 'shaolin', to: 'xiangyang', speed: 4, offset: 3, name: '少林巡山僧' },
  { id: 'patrol_wudang', kind: 'patrol', from: 'wudang', to: 'dongtingShore', speed: 4, offset: 9, name: '武當巡山道人' },
  { id: 'patrol_heimu', kind: 'patrol', from: 'heimu', to: 'guangming', speed: 4, offset: 13, name: '神教巡崖使' },
  { id: 'caravan_tw', kind: 'caravan', from: 'tianlong', to: 'wuliang', speed: 3, offset: 7, name: '馬幫' },
];

export const ACTOR_LINES = {
  caravan: [
    '「客官讓讓，貨要趕在天黑前進城。」',
    '「這條道近來不太平，夜裡別走。」',
    '「要買點傷藥麼？路上用得著。」',
  ],
  escort: [
    '「鏢車過路，借光借光！」',
    '「福威鏢局的旗子，如今也不太管用了。」',
    '「趟子手喊得再響，遇上真高手也是白搭。」',
  ],
  patrol: [
    '「本派地界，閒人止步。」',
    '「山裡起霧，早些下去罷。」',
    '「見過師兄。——啊，認錯人了。」',
  ],
};

// ── 地標型別庫（日後 reskin 成大唐、三國，真正該抽出來的就是這個）──
export const LANDMARK_TYPES = [
  'gate', 'inn', 'sectgate', 'pagoda', 'stonebridge', 'dock',
  'tomb', 'grotto', 'drillground', 'temple', 'bamboo', 'pass', 'custom',
];

// 各地點額外的地標（純風景或加味用），照原著手放
export const LANDMARKS = [
  { loc: 'shaolin', type: 'pagoda', dx: -8, dy: 4, name: '塔林' },
  { loc: 'shaolin', type: 'temple', dx: 7, dy: 2, name: '大雄寶殿' },
  { loc: 'gumu', type: 'tomb', dx: 0, dy: 2, name: '活死人墓' },
  { loc: 'wuliang', type: 'grotto', dx: 3, dy: -1, name: '瑯嬛玉洞' },
  { loc: 'huashan', type: 'custom', dx: -8, dy: -2, name: '思過崖' },
  { loc: 'xiangyang', type: 'drillground', dx: 9, dy: 4, name: '校場' },
  { loc: 'yangzhou', type: 'dock', dx: -12, dy: 6, name: '運河碼頭' },
  { loc: 'taohua', type: 'bamboo', dx: -5, dy: 3, name: '桃花陣' },
  { loc: 'jueqing', type: 'custom', dx: 6, dy: 2, name: '斷腸崖' },
  { loc: 'dongting', type: 'dock', dx: -7, dy: 6, name: '君山渡頭' },
  { loc: 'guangming', type: 'temple', dx: 7, dy: 3, name: '聖火壇' },
  { loc: 'tianlong', type: 'pagoda', dx: -8, dy: 3, name: '三塔' },
  { loc: 'wudang', type: 'temple', dx: 7, dy: 3, name: '紫霄宮' },
  { loc: 'heimu', type: 'pass', dx: -9, dy: 5, name: '鐵索關' },
  { loc: 'fuwei', type: 'custom', dx: 6, dy: 2, name: '枯井' },
  { loc: 'final', type: 'custom', dx: 0, dy: 3, name: '論劍台' },
];
