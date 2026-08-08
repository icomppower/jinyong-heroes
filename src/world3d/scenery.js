// 地形、水、官道路面、山道石階、荒野散佈。
//
// 地形網格就是那張 384×288 的高度場，一格一個四邊形——一次 draw call，
// 頂點色照地形型別上，所以三維世界看起來仍然是那張圖，只是站進去了。

import * as THREE from 'three';
import {
  S, W, H, WORLD_W, WORLD_D, HSCALE, tx2x, ty2z, x2tx, z2ty, T, GEO, lerp, clamp, smoothstep,
} from './field.js';
import { pineGeo, broadleafGeo, trunkGeo, bambooGeo, rockGeo, mat, place } from './kit.js';

export const WATER_Y = 0.55;

// 地形型別 → 底色。雪線、峭壁、竹林、田——那張圖上分得出來的，站進去也要分得出來。
const TINT = {
  [T.GRASS]:   [0.30, 0.40, 0.19],
  [T.ROAD]:    [0.55, 0.47, 0.34],
  [T.WALL]:    [0.47, 0.45, 0.42],
  [T.WATER]:   [0.10, 0.19, 0.21],
  [T.TREE]:    [0.19, 0.31, 0.15],
  [T.BUILDING]:[0.45, 0.42, 0.38],
  [T.ROOF]:    [0.30, 0.32, 0.34],
  [T.SAND]:    [0.66, 0.60, 0.42],
  [T.MOUNTAIN]:[0.38, 0.36, 0.31],
  [T.COUNTER]: [0.45, 0.40, 0.34],
  [T.BRIDGE]:  [0.50, 0.46, 0.40],
  [T.FLOWER]:  [0.42, 0.44, 0.26],
  [T.FLOOR]:   [0.52, 0.48, 0.42],
  [T.RUG]:     [0.44, 0.33, 0.28],
  [T.ROCK]:    [0.49, 0.47, 0.44],
  [T.SNOW]:    [0.85, 0.88, 0.91],
  [T.BAMBOO]:  [0.28, 0.40, 0.20],
  [T.FARM]:    [0.48, 0.42, 0.25],
  [T.STREET]:  [0.55, 0.53, 0.49],
};

const hashf = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };

// ══════════════════════════════════════════════════════════
// 地形網格
// ══════════════════════════════════════════════════════════
export function buildTerrain(ctx) {
  const { scene, groundH, sc } = ctx;
  const geo = new THREE.PlaneGeometry(WORLD_W, WORLD_D, W, H);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const tileAt = (X, Z) => {
    const gx = clamp(Math.round(x2tx(X)), 0, W - 1), gy = clamp(Math.round(z2ty(Z)), 0, H - 1);
    return sc.tiles[gy * W + gx];
  };
  for (let i = 0; i < pos.count; i++) {
    const X = pos.getX(i), Z = pos.getZ(i);
    const y = groundH(X, Z);
    pos.setY(i, y);
    const t = tileAt(X, Z);
    let [r, g, b] = TINT[t] || TINT[T.GRASS];
    // 微雜訊，免得整片草地是一塊死板的綠
    const n = (hashf(X * 0.7, Z * 0.7) - 0.5) * 0.075;
    r += n; g += n * 1.15; b += n * 0.7;
    // 陡的地方露岩：坡度是算出來的，不是用高度猜的
    const e = 2.2;
    const slope = Math.hypot(groundH(X + e, Z) - groundH(X - e, Z), groundH(X, Z + e) - groundH(X, Z - e)) / (2 * e);
    if (slope > 0.45) {
      const k = smoothstep(0.45, 1.25, slope) * 0.82;
      r = lerp(r, 0.42, k); g = lerp(g, 0.39, k); b = lerp(b, 0.35, k);
    }
    // 雪線：高處自己會白，不必等地形型別
    if (y > 62 * (HSCALE / 0.38)) {
      const k = smoothstep(62 * (HSCALE / 0.38), 86 * (HSCALE / 0.38), y) * 0.9;
      r = lerp(r, 0.88, k); g = lerp(g, 0.90, k); b = lerp(b, 0.93, k);
    }
    // 水線上那條濕沙
    if (y > -1.2 && y < WATER_Y + 1.0) { const k = 0.7; r = lerp(r, 0.55, k); g = lerp(g, 0.50, k); b = lerp(b, 0.40, k); }
    colors[i * 3] = r; colors[i * 3 + 1] = g; colors[i * 3 + 2] = b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 1, metalness: 0, envMapIntensity: 0.16,
  }));
  m.receiveShadow = true;
  scene.add(m);
  return { verts: pos.count };
}

// ══════════════════════════════════════════════════════════
// 水：東海、大江、漢水、洞庭湖
// ══════════════════════════════════════════════════════════
export function buildWater(ctx) {
  const { scene } = ctx;
  const material = new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      time: { value: 0 },
      sunDir: { value: new THREE.Vector3(0.4, 0.5, -0.7).normalize() },
      deepCol: { value: new THREE.Color(0x1b3b3c) },
      skyCol: { value: new THREE.Color(0x8fb4c8) },
    }]),
    vertexShader: `
      #include <fog_pars_vertex>
      varying vec3 vWorld;
      void main(){vec4 wp=modelMatrix*vec4(position,1.0);vWorld=wp.xyz;
        vec4 mvPosition=viewMatrix*wp;gl_Position=projectionMatrix*mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      #include <fog_pars_fragment>
      varying vec3 vWorld;uniform float time;uniform vec3 sunDir,deepCol,skyCol;
      void main(){vec3 p=vWorld;float t=time;
        vec3 n=normalize(vec3(
          sin(p.x*0.21+t*0.9)*0.045+sin(p.x*0.53+p.z*0.24+t*1.7)*0.028,1.0,
          sin(p.z*0.19+t*0.8)*0.045+sin((p.z-p.x)*0.44+t*1.35)*0.026));
        vec3 V=normalize(cameraPosition-p);
        float fres=pow(1.0-max(dot(V,n),0.0),3.0);
        vec3 col=mix(deepCol,skyCol,0.12+0.62*fres);
        vec3 Hh=normalize(V+sunDir);
        col+=vec3(1.0,0.96,0.86)*pow(max(dot(Hh,n),0.0),190.0)*1.9;
        col+=vec3(0.85,0.92,0.90)*pow(max(dot(Hh,n),0.0),22.0)*0.16;
        gl_FragColor=vec4(col,1.0);
        #include <fog_fragment>
      }`,
  });
  const w = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_W * 3.2, WORLD_D * 3.2, 1, 1), material);
  w.rotation.x = -Math.PI / 2;
  w.position.y = WATER_Y;
  scene.add(w);
  return { material };
}

// ══════════════════════════════════════════════════════════
// 官道路面：沿折線鋪一條帶子，比地面抬高一點點
// ══════════════════════════════════════════════════════════
export function buildRoadSurfaces(ctx) {
  const { scene, roads, groundH } = ctx;
  const pos = [], col = [], idx = [];
  const LIFT = 0.09;
  let count = 0;
  for (const r of roads) {
    const halfW = r.width / 2;
    const base = r.kind === 'stair' ? [0.50, 0.48, 0.45]
      : r.kind === 'causeway' ? [0.52, 0.50, 0.46] : [0.53, 0.45, 0.31];
    const start = pos.length / 3;
    for (let i = 0; i < r.pts.length; i++) {
      const p = r.pts[i];
      const q = r.pts[Math.min(i + 1, r.pts.length - 1)], q0 = r.pts[Math.max(i - 1, 0)];
      let dx = q.x - q0.x, dz = q.z - q0.z;
      const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
      for (const s of [-1, 1]) {
        const vx = p.x - dz * halfW * s, vz = p.z + dx * halfW * s;
        pos.push(vx, Math.max(p.y, groundH(vx, vz)) + LIFT, vz);
        const n = (hashf(vx, vz) - 0.5) * 0.06;
        col.push(base[0] + n, base[1] + n, base[2] + n);
      }
      if (i > 0) {
        const a = start + (i - 1) * 2, b = a + 1, c = start + i * 2, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
    count++;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, envMapIntensity: 0.1 }));
  m.receiveShadow = true;
  scene.add(m);
  return { roads: count };
}

// ══════════════════════════════════════════════════════════
// 華山山道：石階 + 鐵索欄杆 + 長空棧道
// 「終局地點的型別就是地形加扶手。」
// ══════════════════════════════════════════════════════════
export function buildStairs(ctx) {
  const { pool: P, roads, groundH } = ctx;
  const stair = roads.find(r => r.kind === 'stair');
  if (!stair) return { steps: 0 };
  const box = new THREE.BoxGeometry(1, 1, 1);
  const stone = mat(0x8d867a, { roughness: 0.95 });
  const iron = mat(0x2f3134, { roughness: 0.55, metalness: 0.6, env: 0.5 });
  const plank = mat(0x6d543a, { roughness: 0.95 });
  let steps = 0, posts = 0, planks = 0;
  const pts = stair.pts;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dx = b.x - a.x, dz = b.z - a.z;
    const L = Math.hypot(dx, dz); if (L < 0.01) continue;
    const rot = Math.atan2(dx, dz);
    const n = Math.max(1, Math.round(L / 0.62));            // 一階約 62 公分
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const x = a.x + dx * t, z = a.z + dz * t, y = lerp(a.y, b.y, t);
      P.add('box', box, 'stair:stone', stone, place(x, y - 0.12, z, stair.width, 0.34, 0.66, rot));
      steps++;
    }
    // 鐵索：外側望柱，兩公尺一根
    const m = Math.max(1, Math.round(L / 2.2));
    for (let k = 0; k < m; k++) {
      const t = (k + 0.5) / m;
      const x = a.x + dx * t, z = a.z + dz * t, y = lerp(a.y, b.y, t);
      const ox = -dz / L * stair.width * 0.5, oz = dx / L * stair.width * 0.5;
      P.add('box', box, 'stair:iron', iron, place(x + ox, y + 0.55, z + oz, 0.14, 1.15, 0.14, rot));
      P.add('box', box, 'stair:iron', iron, place(x + ox, y + 1.05, z + oz, 0.08, 0.08, 2.2, rot));
      posts++;
      // 長空棧道：路面外側懸空超過兩公尺，就架板子
      const gx = x + ox * 1.9, gz = z + oz * 1.9;
      if (y - groundH(gx, gz) > 2.0) {
        P.add('box', box, 'stair:plank', plank, place(x + ox * 1.5, y - 0.2, z + oz * 1.5, 1.0, 0.16, 2.2, rot));
        P.add('box', box, 'stair:iron', iron, place(x + ox * 1.5, y - 0.95, z + oz * 1.5, 0.1, 1.5, 0.1, rot));
        planks++;
      }
    }
  }
  return { steps, posts, planks };
}

// ══════════════════════════════════════════════════════════
// 荒野散佈：林、竹、岩、石碑
// 密度是照「總實例數上限」調的，不是照手感。⚠️ 削預算先削數量，不要削種類。
// ══════════════════════════════════════════════════════════
export function buildScatter(ctx, budget = 34000) {
  const { pool: P, groundH, sc, field } = ctx;
  const rnd = (() => { let h = 20260808; return () => { h = (h * 1103515245 + 12345) & 0x7fffffff; return h / 0x7fffffff; }; })();
  const geoms = {
    pine: pineGeo(), leaf: broadleafGeo(), trunk: trunkGeo(), bamboo: bambooGeo(), rock: rockGeo(),
  };
  const mats = {
    pine: mat(0x2c4a24, { roughness: 1, flat: true }),
    pineHi: mat(0x35502a, { roughness: 1, flat: true }),
    leaf: mat(0x3d5c2a, { roughness: 1, flat: true }),
    trunk: mat(0x5a4530, { roughness: 1 }),
    bamboo: mat(0x6f8c3d, { roughness: 0.85 }),
    rock: mat(0x7d766c, { roughness: 1, flat: true }),
    snowrock: mat(0xb9c0c6, { roughness: 0.95, flat: true }),
  };
  // 先數一次，再決定取樣率——不要憑感覺撒
  const tally = {};
  for (let i = 0; i < sc.tiles.length; i++) tally[sc.tiles[i]] = (tally[sc.tiles[i]] || 0) + 1;
  // 一格竹地會種出兩三竿，所以估算要乘回去——第一版忘了乘，竹子把預算吃掉九成，
  // 岩石只剩兩百多塊，山看起來是光的。
  const want = { [T.TREE]: 0.55, [T.BAMBOO]: 0.30, [T.MOUNTAIN]: 0.085, [T.ROCK]: 0.17, [T.SNOW]: 0.05 };
  const perTile = { [T.TREE]: 2, [T.BAMBOO]: 2.5, [T.MOUNTAIN]: 1, [T.ROCK]: 1, [T.SNOW]: 1 };
  let est = 0;
  for (const k in want) est += (tally[k] || 0) * want[k] * (perTile[k] || 1);
  const scale = est > budget ? budget / est : 1;

  const counts = { tree: 0, bamboo: 0, rock: 0 };
  for (let gy = 1; gy < H - 1; gy++) for (let gx = 1; gx < W - 1; gx++) {
    const t = sc.tiles[gy * W + gx];
    const p = want[t]; if (!p) continue;
    if (rnd() > p * scale) continue;
    const X = tx2x(gx) + (rnd() - 0.5) * S * 0.85, Z = ty2z(gy) + (rnd() - 0.5) * S * 0.85;
    const y = groundH(X, Z);
    if (y < WATER_Y + 0.2) continue;
    const a = rnd() * Math.PI * 2;
    if (t === T.TREE) {
      const tall = 3.4 + rnd() * 4.2, wide = 1.5 + rnd() * 1.5;
      const conifer = y > 26 || rnd() < 0.42;
      P.add('trunk', geoms.trunk, 'trunk', mats.trunk, place(X, y, Z, wide * 0.20, tall * 0.42, wide * 0.20, a));
      if (conifer) {
        P.add('pine', geoms.pine, y > 34 ? 'pineHi' : 'pine', y > 34 ? mats.pineHi : mats.pine,
          place(X, y + tall * 0.22, Z, wide, tall * 0.95, wide, a));
      } else {
        P.add('leaf', geoms.leaf, 'leaf', mats.leaf, place(X, y + tall * 0.34, Z, wide * 1.35, tall * 0.72, wide * 1.35, a));
      }
      counts.tree++;
    } else if (t === T.BAMBOO) {
      const n = 2 + ((rnd() * 2) | 0);
      for (let k = 0; k < n; k++) {
        const bx = X + (rnd() - 0.5) * 1.5, bz = Z + (rnd() - 0.5) * 1.5;
        P.add('bamboo', geoms.bamboo, 'bamboo', mats.bamboo,
          place(bx, groundH(bx, bz), bz, 0.13, 5.5 + rnd() * 3.5, 0.13, rnd() * 6.28));
      }
      counts.bamboo += n;
    } else {
      const s = 0.9 + rnd() * 2.8;
      const snowy = y > 62 * (HSCALE / 0.38);
      P.add('rock', geoms.rock, snowy ? 'snowrock' : 'rock', snowy ? mats.snowrock : mats.rock,
        place(X, y - s * 0.2, Z, s * (1 + rnd() * 0.5), s * (0.7 + rnd() * 0.7), s, a));
      counts.rock++;
    }
  }
  return counts;
}
