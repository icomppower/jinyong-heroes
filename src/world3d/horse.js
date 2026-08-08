// 馬。零美術資產，跟全專案一樣——盒子、圓柱、幾個角度，靠剪影認。
//
// 十四處聚落各拴一匹（桃花島隔著東海，馬過不去）。走近按 F 上馬。
// 馬只走得了平地與官道；華山石階整條不給騎，到了山門就得下馬——
// 於是「快」是官道的獎賞，而登頂仍然是兩條腿的事。

import * as THREE from 'three';
import { mat } from './kit.js';

const COATS = [
  { body: 0x6b4526, mane: 0x2b1d12, name: '棗騮' },
  { body: 0x8a6a44, mane: 0x4a3320, name: '黃驃' },
  { body: 0x2a2622, mane: 0x171412, name: '烏騅' },
  { body: 0x9a958c, mane: 0x6d6862, name: '照夜白' },
  { body: 0x5a4030, mane: 0x33241a, name: '赤兔' },
];

const G = {
  body: new THREE.BoxGeometry(1, 1, 1),
  leg: new THREE.CylinderGeometry(0.5, 0.42, 1, 6),
  ear: new THREE.ConeGeometry(0.5, 1, 5),
};
G.leg.translate(0, -0.5, 0);          // 以髖為原點，好擺動

function limb(matr, x, y, z, w, h, d) {
  const m = new THREE.Mesh(G.leg, matr);
  m.position.set(x, y, z); m.scale.set(w, h, d);
  m.castShadow = true;
  return m;
}

/** 一匹馬。+z 是馬頭朝向（跟引擎的 forward = (sinθ, cosθ) 一致）。 */
export function makeHorse(coat) {
  const g = new THREE.Group();
  const body = mat(coat.body, { roughness: 0.85 });
  const mane = mat(coat.mane, { roughness: 0.9 });
  const tack = mat(0x3c2a1c, { roughness: 0.7 });

  const barrel = new THREE.Mesh(G.body, body);
  barrel.position.set(0, 1.42, 0); barrel.scale.set(0.72, 0.86, 2.06);
  barrel.castShadow = true; g.add(barrel);

  const chest = new THREE.Mesh(G.body, body);
  chest.position.set(0, 1.5, 0.78); chest.scale.set(0.78, 0.92, 0.7);
  chest.castShadow = true; g.add(chest);

  // 頸：往前上方斜
  const neck = new THREE.Mesh(G.body, body);
  neck.position.set(0, 1.95, 1.06); neck.scale.set(0.46, 1.06, 0.56);
  neck.rotation.x = -0.62; neck.castShadow = true; g.add(neck);

  const head = new THREE.Mesh(G.body, body);
  head.position.set(0, 2.36, 1.45); head.scale.set(0.34, 0.42, 0.86);
  head.rotation.x = -0.24; head.castShadow = true; g.add(head);

  const muzzle = new THREE.Mesh(G.body, mane);
  muzzle.position.set(0, 2.22, 1.79); muzzle.scale.set(0.3, 0.3, 0.28);
  g.add(muzzle);

  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(G.ear, body);
    ear.position.set(s * 0.13, 2.62, 1.2); ear.scale.set(0.16, 0.3, 0.16);
    g.add(ear);
  }
  // 鬃：頸背上一排薄片
  const crest = new THREE.Mesh(G.body, mane);
  crest.position.set(0, 2.06, 1.0); crest.scale.set(0.13, 0.9, 0.62);
  crest.rotation.x = -0.62; g.add(crest);

  // 鞍與韁
  const saddle = new THREE.Mesh(G.body, tack);
  saddle.position.set(0, 1.9, -0.12); saddle.scale.set(0.8, 0.2, 0.82);
  g.add(saddle);
  const rein = new THREE.Mesh(G.body, tack);
  rein.position.set(0, 2.16, 1.3); rein.scale.set(0.42, 0.06, 0.06);
  g.add(rein);

  // 尾
  const tail = new THREE.Mesh(G.body, mane);
  tail.position.set(0, 1.62, -1.06); tail.scale.set(0.16, 0.9, 0.2);
  tail.rotation.x = 0.42; g.add(tail);

  // 四條腿：前後各一對，記下來好擺動
  const legs = [];
  for (const [lx, lz, ph] of [[-0.34, 0.72, 0], [0.34, 0.72, Math.PI], [-0.34, -0.68, Math.PI], [0.34, -0.68, 0]]) {
    const upper = limb(body, lx, 1.28, lz, 0.24, 0.72, 0.24);
    const lower = limb(mane, 0, -0.72, 0, 0.7, 0.62, 0.7);
    upper.add(lower);
    g.add(upper);
    legs.push({ mesh: upper, phase: ph });
  }
  return { group: g, legs, coat };
}

/**
 * 十四匹拴著的馬 + 上馬後的第一人稱馬頭。
 * ctx: { scene, groundH, camera }
 * spots: field.horseSpots(rideMask) 的結果
 */
export function buildHorses(ctx, spots) {
  const { scene, groundH, camera } = ctx;
  const horses = spots.map((s, i) => {
    const coat = COATS[i % COATS.length];
    const h = makeHorse(coat);
    h.group.position.set(s.x, groundH(s.x, s.z), s.z);
    h.group.rotation.y = (i * 1.7) % (Math.PI * 2);
    scene.add(h.group);
    return { ...s, ...h, name: coat.name, ridden: false, gait: 0 };
  });

  // 拴馬樁：一根木樁加橫木，讓馬看起來是拴著的而不是站在路中間
  {
    const post = mat(0x5b4029, { roughness: 0.95 });
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const inst = new THREE.InstancedMesh(geo, post, spots.length * 3);
    const m = new THREE.Matrix4(); let k = 0;
    for (const s of spots) {
      const y = groundH(s.x, s.z);
      for (const dx of [-1.5, 1.5]) {
        m.compose(new THREE.Vector3(s.x + dx, y + 0.7, s.z + 1.4), new THREE.Quaternion(), new THREE.Vector3(0.16, 1.4, 0.16));
        inst.setMatrixAt(k++, m);
      }
      m.compose(new THREE.Vector3(s.x, y + 1.25, s.z + 1.4), new THREE.Quaternion(), new THREE.Vector3(3.2, 0.14, 0.14));
      inst.setMatrixAt(k++, m);
    }
    inst.count = k; inst.castShadow = true; scene.add(inst);
  }

  // ── 上馬之後看得到的那一截：頸、鬃、耳、韁，掛在相機底下 ──
  const view = new THREE.Group();
  {
    const coat = COATS[0];
    const body = mat(coat.body, { roughness: 0.85 });
    const mane = mat(coat.mane, { roughness: 0.9 });
    const tack = mat(0x3c2a1c, { roughness: 0.7 });
    const box = new THREE.BoxGeometry(1, 1, 1);
    const add = (matr, x, y, z, sx, sy, sz, rx = 0) => {
      const m = new THREE.Mesh(box, matr);
      m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.x = rx;
      view.add(m); return m;
    };
    // 相機是往 -z 看的（three 的慣例），所以馬頭擺在負 z
    add(body, 0, -0.62, -1.05, 0.46, 1.15, 0.55, 0.58);
    add(mane, 0, -0.5, -0.9, 0.14, 1.0, 0.6, 0.58);
    add(body, 0, -1.05, -1.62, 0.34, 0.4, 0.9, 0.2);
    add(mane, 0, -1.16, -1.98, 0.3, 0.3, 0.3, 0.2);
    for (const s of [-1, 1]) add(body, s * 0.13, -0.74, -1.4, 0.1, 0.26, 0.1, -0.1);
    add(tack, 0, -0.95, -1.48, 0.44, 0.05, 0.05);
    for (const s of [-1, 1]) {
      const r = add(tack, s * 0.2, -0.72, -1.1, 0.04, 0.04, 0.95, 0.42);
      r.rotation.z = s * 0.06;
    }
    view.visible = false;
    camera.add(view);
  }

  const api = {
    horses, view,
    /** 最近的一匹（沒被騎走的） */
    nearest(x, z) {
      let best = null, bd = 1e9;
      for (const h of horses) {
        if (h.ridden) continue;
        const d = Math.hypot(x - h.group.position.x, z - h.group.position.z);
        if (d < bd) { bd = d; best = h; }
      }
      return { horse: best, dist: bd };
    },
    mount(h) {
      h.ridden = true; h.group.visible = false;
      view.visible = true;
      return h;
    },
    dismount(h, x, z, heading) {
      // 下馬就把馬放在身邊一步遠，牠會在原地等
      const ox = Math.cos(heading) * 2.0, oz = -Math.sin(heading) * 2.0;
      h.group.position.set(x + ox, groundH(x + ox, z + oz), z + oz);
      h.group.rotation.y = heading;
      h.ridden = false; h.group.visible = true;
      view.visible = false;
    },
    update(dt, st) {
      // 沒騎的馬偶爾晃一下頭；騎著的那匹用步態擺鏡頭底下那截
      if (st.mounted) {
        const gait = st.speed * 1.05;
        st.horseGait = (st.horseGait || 0) + gait * dt;
        const b = Math.sin(st.horseGait * 2) * 0.05 * Math.min(1, st.speed / 3);
        view.position.y = b;
        view.rotation.z = Math.cos(st.horseGait) * 0.022 * Math.min(1, st.speed / 3);
      }
      for (const h of horses) {
        if (h.ridden) continue;
        h.gait += dt;
        for (const l of h.legs) l.mesh.rotation.x = Math.sin(h.gait * 0.6 + l.phase) * 0.035;
      }
    },
  };
  return api;
}
