// 江湖 —— Golden Hour 引擎的一座「城市」，只是你下了車。
//
// 尺度恰好對得上：香港那張圖約 1200×1000 units，江湖 384 格 × 2 公尺 = 768×576。
// 不是巧合——一座可步行的世界與一座可行駛的城市，本來就是相近的尺度問題。
//
// 這個檔只負責「把世界組起來」：真相全部在 src/world3d/*（場、零件、地形、聚落）
// 與 src/data/*（那張已經驗過 87 項的圖）。

import * as THREE from 'three';
import * as F from '../src/world3d/field.js';
import { InstancePool } from '../src/world3d/kit.js';
import { buildTerrain, buildWater, buildRoadSurfaces, buildStairs, buildScatter, WATER_Y } from '../src/world3d/scenery.js';
import { buildSettlements } from '../src/world3d/settlements.js';
import { LOC_BY_ID } from '../src/data/maps.js';

const DEBUG = /(^|[?&#])debug/.test(location.search + location.hash);

export const CITY = {
  id: 'jianghu',
  name: '金庸群俠傳',
  subtitle: '第一人稱．只靠走的江湖',
  daySeconds: 210,               // 一個遊戲日約三分半實時——太陽會在你走路的時候看得見地移動
  eye: F.EYE,
  shadowSpan: 130,
  timeOfDay: 8.0,
  start: { x: F.SPAWN.x, z: F.SPAWN.z, heading: Math.PI * 0.82 },

  build(api) {
    const { scene } = api;

    // ── 除錯參數。?pos= 用格座標（跟 2D 版同一個慣例），#at= 用公尺（跟 Golden Hour 同形）。
    //    把「得先走到第五關才測得到」壓成一次跳轉。 ──
    {
      const q = new URLSearchParams(location.search);
      const pos = q.get('pos');
      if (pos) {
        const [gx, gy, hd] = pos.split(',').map(Number);
        if (Number.isFinite(gx) && Number.isFinite(gy)) {
          CITY.start = { x: F.tx2x(gx), z: F.ty2z(gy), heading: Number.isFinite(hd) ? hd : CITY.start.heading };
        }
      }
      const at = /at=(-?[\d.]+),(-?[\d.]+)(?:,(-?[\d.]+))?/.exec(location.hash || '');
      if (at) CITY.start = { x: +at[1], z: +at[2], heading: at[3] !== undefined ? +at[3] : CITY.start.heading };
      const tm = q.get('time');
      if (tm !== null && Number.isFinite(+tm)) CITY.timeOfDay = +tm;
    }

    const t0 = performance.now();
    const field = F.makeField();
    const roads = F.buildRoads(field);
    const groundH = F.makeGround(field, roads);
    const mask = F.buildWalkMask(field, roads, groundH);
    const speedAt = F.makeSpeed(field, mask);
    const tField = performance.now() - t0;

    const pool = new InstancePool(scene);
    const ctx = { scene, pool, field, roads, groundH, mask, sc: field.sc };

    const t1 = performance.now();
    const terrain = buildTerrain(ctx);
    const water = buildWater(ctx);
    const roadSurf = buildRoadSurfaces(ctx);
    const stairs = buildStairs(ctx);
    const scatter = buildScatter(ctx);
    const towns = buildSettlements(ctx);
    const pooled = pool.build();
    const tGeo = performance.now() - t1;

    // 出生點站得住嗎？站不住就往外找一格——出生在牆裡是最蠢也最容易發生的一種上線事故。
    if (!F.canStand(mask, CITY.start.x, CITY.start.z)) {
      let fixed = null;
      for (let r = 1; r <= 12 && !fixed; r++) {
        for (let dy = -r; dy <= r && !fixed; dy++) for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = CITY.start.x + dx * F.S, z = CITY.start.z + dy * F.S;
          if (F.canStand(mask, x, z)) { fixed = { x, z }; break; }
        }
      }
      if (fixed) { CITY.start.x = fixed.x; CITY.start.z = fixed.z; }
    }

    // ── 地名 ──
    const places = F.PLACES.map(p => ({
      ...p, name: (LOC_BY_ID[p.id] && LOC_BY_ID[p.id].name) || p.id,
    }));
    const peakPlace = places.find(p => p.id === 'final');
    function locationLabel(x, z) {
      let best = null, bd = 1e9;
      for (const p of places) {
        const dx = Math.abs(x - p.x) - p.w / 2, dz = Math.abs(z - p.z) - p.d / 2;
        const inside = dx <= 0 && dz <= 0;
        const d = inside ? -1 : Math.hypot(Math.max(dx, 0), Math.max(dz, 0));
        if (d < bd) { bd = d; best = p; }
      }
      if (best && bd < 0) return best.name;
      if (best && bd < 46) return `近 ${best.name}`;
      const gx = F.clamp(Math.round(F.x2tx(x)), 0, F.W - 1), gy = F.clamp(Math.round(F.z2ty(z)), 0, F.H - 1);
      const t = field.sc.tiles[gy * F.W + gx];
      const y = groundH(x, z);
      if (t === F.T.ROAD || t === F.T.BRIDGE) return '官道上';
      if (t === F.T.TREE) return '林中';
      if (t === F.T.BAMBOO) return '竹林';
      if (t === F.T.SNOW || y > 60) return '雪線之上';
      if (t === F.T.ROCK || t === F.T.MOUNTAIN) return '山中';
      if (t === F.T.SAND) return '沙磧';
      if (t === F.T.FARM) return '田間';
      return '荒野';
    }

    const stats = {
      tField: +tField.toFixed(1), tGeo: +tGeo.toFixed(1),
      terrainVerts: terrain.verts,
      drawCalls: pooled.meshes + 3,          // 實例網格 + 地形 + 水 + 路面
      instances: pooled.instances,
      ...towns, ...stairs, ...scatter,
      roads: roads.length,
      roadGradeMax: +Math.max(...roads.map(r => r.grade)).toFixed(3),
      peakY: +groundH(field.peak.x, field.peak.z).toFixed(2),
      spawnY: +groundH(CITY.start.x, CITY.start.z).toFixed(2),
      walkableTiles: mask.reduce((n, v) => n + v, 0),
    };
    if (DEBUG) console.log('江湖 debug —', JSON.stringify(stats, null, 1));

    let elapsed = 0;
    return {
      groundH,
      canStand: (x, z) => F.canStand(mask, x, z),
      speedAt,
      locationLabel,
      places, peakPlace,
      bounds: {
        x0: -F.WORLD_W / 2 + 3, x1: F.WORLD_W / 2 - 3,
        z0: -F.WORLD_D / 2 + 3, z1: F.WORLD_D / 2 - 3,
      },
      size: F.WORLD_W,
      stats,
      // 測試與除錯要的原料
      field, roads, mask, waterY: WATER_Y,
      update(dt) {
        elapsed += dt;
        water.material.uniforms.time.value = elapsed;
      },
    };
  },
};

export default CITY;
