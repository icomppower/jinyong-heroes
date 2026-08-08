// 建築零件庫 —— 「遠看認得出來」用的四樣東西：屋頂形、山牆輪廓、顏色區塊、量體堆疊。
//
// 全部做成 **單位幾何**（x,z ∈ [-0.5,0.5]，y ∈ [0,1]，原點在底面中心），
// 一種零件一個 InstancedMesh，用非等比縮放擺上去。所以十五處城鎮山門加起來
// 是幾十個 draw call，不是幾千個。
//
// 時代取明中期當官方圖式，零件庫只做一份；真正看得出年代的兩個參數
// （屋面凹曲程度 curve、斗拱佔柱高的比例 bracket）只在大理轉向「更古」。
//
// ⚠️ 面數花在屋頂形、山牆／脊線輪廓、顏色區塊、量體堆疊；不花在單朵斗拱、脊獸、
//    窗欄花格。第一人稱是貼地近景，斗拱那一項在蓋完第一座之後實測過——見 README。

import * as THREE from 'three';

// ══════════════════════════════════════════════════════════
// 屋頂：識別系統的全部
// ══════════════════════════════════════════════════════════

/**
 * 屋面用「一圈一圈往上收」的方式放樣。
 * @param kind  'wudian' 廡殿 · 'xieshan' 歇山 · 'xuanshan' 懸山/硬山 · 'zanjian' 攢尖
 * @param curve 屋面凹曲程度：1.15 宋（平緩）… 1.65 明清（陡垂）
 */
export function roofGeo(kind, { curve = 1.5, sides = 4, rings = 5, upturn = 0.10 } = {}) {
  if (kind === 'zanjian') return spireGeo(sides, curve, upturn);
  const ridgeZ = 0.045;                       // 正脊在進深方向收到多細
  const ridgeX = kind === 'wudian' ? 0.30 : 0.5;
  const hipBreak = 0.52;                      // 歇山：收山的高度，以下四坡、以上山牆
  const pos = [], idx = [], nrm = [];

  const halfX = t => {
    if (kind === 'xuanshan') return 0.5;                       // 懸山：兩端出挑，不收山
    if (kind === 'wudian') return 0.5 + (ridgeX - 0.5) * t;
    return 0.5 + (ridgeX - 0.5) * Math.min(t / hipBreak, 1) * 0.42;   // 歇山：只收下半
  };
  const halfZ = t => 0.5 + (ridgeZ - 0.5) * t;
  const yOf = t => Math.pow(t, curve);

  // 每一圈四個角，角上加起翹
  const ringVerts = t => {
    const hx = halfX(t), hz = halfZ(t), y = yOf(t);
    const lift = upturn * (1 - t) * (1 - t);
    return [
      [-hx, y + lift, -hz], [hx, y + lift, -hz],
      [hx, y + lift, hz], [-hx, y + lift, hz],
    ];
  };
  for (let r = 0; r <= rings; r++) {
    for (const v of ringVerts(r / rings)) pos.push(...v);
  }
  for (let r = 0; r < rings; r++) {
    for (let k = 0; k < 4; k++) {
      const a = r * 4 + k, b = r * 4 + (k + 1) % 4, c = (r + 1) * 4 + k, d = (r + 1) * 4 + (k + 1) % 4;
      idx.push(a, c, b, b, c, d);
    }
  }
  // 歇山／懸山的兩端山牆：把 t=hipBreak 以上的端面補起來，不然側面是空的
  if (kind !== 'wudian') {
    const base = pos.length / 3;
    for (const sx of [-1, 1]) {
      const t0 = kind === 'xieshan' ? hipBreak : 0;
      const b0 = ringVerts(t0), b1 = ringVerts(1);
      const i0 = sx < 0 ? 0 : 1, i1 = sx < 0 ? 3 : 2;
      pos.push(...b0[i0], ...b0[i1], ...b1[i1], ...b1[i0]);
    }
    for (let s = 0; s < 2; s++) {
      const o = base + s * 4;
      if (s === 0) idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
      else idx.push(o, o + 2, o + 1, o, o + 3, o + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// 攢尖頂：收尖無正脊。換底部多邊形就是四／六／八角亭，也是塔剎。
function spireGeo(sides, curve, upturn) {
  const pos = [], idx = [], rings = 5;
  const ringVerts = t => {
    const r = 0.5 * (1 - t), y = Math.pow(t, curve), lift = upturn * (1 - t) * (1 - t);
    const out = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2 + Math.PI / sides;
      out.push([Math.cos(a) * r, y + lift, Math.sin(a) * r]);
    }
    return out;
  };
  for (let r = 0; r <= rings; r++) for (const v of ringVerts(r / rings)) pos.push(...v);
  for (let r = 0; r < rings; r++) for (let k = 0; k < sides; k++) {
    const a = r * sides + k, b = r * sides + (k + 1) % sides;
    const c = (r + 1) * sides + k, d = (r + 1) * sides + (k + 1) % sides;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// 馬頭牆：白牆高出屋面，二到四階鐵齒。江南的識別記號。
export function horseHeadGeo(steps = 3) {
  const pos = [], idx = [];
  const push = (x0, x1, y0, y1, z0, z1) => {
    const o = pos.length / 3;
    const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
               [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
    for (const p of v) pos.push(...p);
    idx.push(o, o + 1, o + 2, o, o + 2, o + 3, o + 4, o + 6, o + 5, o + 4, o + 7, o + 6,
             o, o + 4, o + 5, o, o + 5, o + 1, o + 3, o + 2, o + 6, o + 3, o + 6, o + 7,
             o, o + 3, o + 7, o, o + 7, o + 4, o + 1, o + 5, o + 6, o + 1, o + 6, o + 2);
  };
  const th = 0.055;
  for (let i = 0; i < steps; i++) {
    const f = i / (steps - 1 || 1);
    const x0 = -0.5 + f * 0.5 * 0.86, x1 = 0.5 - f * 0.5 * 0.86;
    const y1 = 0.42 + f * 0.58;
    push(x0, x1, 0, y1, -th, th);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// 燕尾脊：脊線凹、兩端分叉高翹。福建的識別記號（福威鏢局）。
export function swallowRidgeGeo() {
  const pos = [], idx = [];
  const N = 18, th = 0.035;
  const yOf = t => { const u = (t - 0.5) * 2; return 0.12 + 0.55 * Math.pow(Math.abs(u), 3.2); };
  for (let i = 0; i <= N; i++) {
    const t = i / N, x = -0.5 + t, y = yOf(t);
    pos.push(x, y - 0.075, -th, x, y + 0.075, -th, x, y + 0.075, th, x, y - 0.075, th);
  }
  for (let i = 0; i < N; i++) {
    const a = i * 4, b = (i + 1) * 4;
    for (let k = 0; k < 4; k++) {
      const k2 = (k + 1) % 4;
      idx.push(a + k, b + k, a + k2, a + k2, b + k, b + k2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// 城牆：夯土包青磚，要有收分（梯形斷面）。單位長 1（沿 x），高 1，底寬 1。
export function wallGeo(batter = 0.24) {
  const pos = [], idx = [];
  const b = 0.5, t = 0.5 * (1 - batter);
  const V = [
    [-0.5, 0, -b], [0.5, 0, -b], [0.5, 1, -t], [-0.5, 1, -t],
    [-0.5, 0, b], [0.5, 0, b], [0.5, 1, t], [-0.5, 1, t],
  ];
  for (const v of V) pos.push(...v);
  idx.push(0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 3, 2, 6, 3, 6, 7,
           0, 5, 1, 0, 4, 5, 0, 3, 7, 0, 7, 4, 1, 5, 6, 1, 6, 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// 垛口：牆頭的鋸齒。一段牆撒幾顆，遠看就是城牆而不是圍籬。
export const merlonGeo = () => new THREE.BoxGeometry(1, 1, 1);

// 塔的一節：座身 + 出簷。少林塔林與大理三塔都用這個堆。
export function pagodaTierGeo(sides = 4) {
  const g = new THREE.CylinderGeometry(0.5, 0.5, 1, sides);
  g.translate(0, 0.5, 0);
  return g;
}
export function eaveRingGeo(sides = 4) {
  const g = new THREE.CylinderGeometry(0.5, 0.62, 1, sides);
  g.translate(0, 0.5, 0);
  return g;
}

// 石階：一級一級的踏步（華山山道、武當登山道）
export const stepGeo = () => new THREE.BoxGeometry(1, 1, 1);

// 樹、竹、岩、田
export function pineGeo() {
  const g = new THREE.ConeGeometry(0.5, 1, 6);
  g.translate(0, 0.5, 0);
  return g;
}
export function broadleafGeo() {
  const g = new THREE.SphereGeometry(0.5, 6, 5);
  g.scale(1, 0.86, 1); g.translate(0, 0.62, 0);
  return g;
}
export function trunkGeo() {
  const g = new THREE.CylinderGeometry(0.5, 0.62, 1, 5);
  g.translate(0, 0.5, 0);
  return g;
}
export function bambooGeo() {
  const g = new THREE.CylinderGeometry(0.36, 0.5, 1, 5);
  g.translate(0, 0.5, 0);
  return g;
}
export function rockGeo() {
  const g = new THREE.IcosahedronGeometry(0.5, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const s = 0.72 + ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1 * 0.55;
    p.setXYZ(i, p.getX(i) * s, Math.abs(p.getY(i)) * s * 1.25, p.getZ(i) * s);
  }
  g.computeVertexNormals();
  return g;
}

// ══════════════════════════════════════════════════════════
// 顏色規則 —— 全圖沒有黃瓦。黃色琉璃瓦專屬皇家，越用是僭越。
// ══════════════════════════════════════════════════════════
export const PALETTES = {
  // 灰磚灰瓦：北方、寺院、城牆、庶民
  grey:    { wall: 0x9a938a, trim: 0x6d675f, tile: 0x4e5257, plinth: 0x7a736a, curve: 1.50 },
  // 粉牆黛瓦：江南——揚州、桃花島、絕情谷
  jiangnan:{ wall: 0xe6e2d8, trim: 0x8d8578, tile: 0x3c4147, plinth: 0x8a837a, curve: 1.55, horseHead: true },
  // 紅牆碧瓦：只給武當，因為武當是明廷出錢蓋的。一眼就說完「這個門派有朝廷背景」。
  wudang:  { wall: 0xa8402f, trim: 0x7d2f22, tile: 0x2f6a52, plinth: 0x8f8579, curve: 1.60 },
  // 白灰牆加彩繪影壁：大理白族，非漢。斗拱大而疏、屋面平緩——兩個旋鈕轉向更古。
  dali:    { wall: 0xf0ece2, trim: 0x9a6f4a, tile: 0x5a5f63, plinth: 0x9c958a, curve: 1.18, ancient: true },
  // 赭黃夯土：光明頂，西域。顏色完全不同於其他十四處，這就夠了。
  rammed:  { wall: 0xbb9257, trim: 0x8e6c3d, tile: 0x8a6b3e, plinth: 0xa8834e, curve: 1.30 },
  // 木構山居：荒野型的莊院、古墓、絕情谷外圍
  timber:  { wall: 0x9c7b56, trim: 0x6b5138, tile: 0x4a4a48, plinth: 0x7d7469, curve: 1.45 },
};

export const DISTRICT_PALETTE = {
  yangzhou: 'jiangnan', taohua: 'jiangnan', jueqing: 'jiangnan',
  wudang: 'wudang',
  tianlong: 'dali', wuliang: 'dali',
  guangming: 'rammed', heimu: 'rammed',
  shaolin: 'grey', xiangyang: 'grey', dongting: 'grey', huashan: 'grey', final: 'grey',
  gumu: 'timber', fuwei: 'timber',
};

export function mat(color, opt = {}) {
  return new THREE.MeshStandardMaterial({
    color, roughness: opt.roughness ?? 0.92, metalness: opt.metalness ?? 0,
    envMapIntensity: opt.env ?? 0.22, flatShading: !!opt.flat,
    side: opt.side || THREE.FrontSide,
  });
}

// 一種零件一個 InstancedMesh。擺完再一次 build，count 才對得上。
export class InstancePool {
  constructor(scene) { this.scene = scene; this.groups = new Map(); }
  key(geoKey, matKey) { return geoKey + '|' + matKey; }
  add(geoKey, geo, matKey, material, m) {
    const k = this.key(geoKey, matKey);
    let g = this.groups.get(k);
    if (!g) { g = { geo, material, list: [] }; this.groups.set(k, g); }
    g.list.push(m);
  }
  build({ castShadow = true, receiveShadow = true } = {}) {
    let meshes = 0, instances = 0;
    for (const [, g] of this.groups) {
      if (!g.list.length) continue;
      const inst = new THREE.InstancedMesh(g.geo, g.material, g.list.length);
      g.list.forEach((m, i) => inst.setMatrixAt(i, m));
      inst.castShadow = castShadow; inst.receiveShadow = receiveShadow;
      inst.instanceMatrix.needsUpdate = true;
      inst.frustumCulled = false;                 // 實例散佈全圖，單一包圍盒沒有意義
      this.scene.add(inst);
      meshes++; instances += g.list.length;
    }
    return { meshes, instances };
  }
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3();
export function place(x, y, z, sx, sy, sz, rotY = 0) {
  _e.set(0, rotY, 0); _q.setFromEuler(_e);
  return _m.compose(_v.set(x, y, z), _q, new THREE.Vector3(sx, sy, sz)).clone();
}
