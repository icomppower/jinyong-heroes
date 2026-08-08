// 小地圖 —— **指北**（compass oriented）。
//
// 預設北在上、羅盤圈的四個方位字固定不動，玩家那支箭轉；按 M 可切成「朝向在上」，
// 這時候整張圖轉、羅盤圈跟著轉——所以無論哪一種模式，北在哪永遠讀得到。
//
// 世界底圖只畫一次（384×288 一格一像素），每幀只是把它以玩家為中心貼一塊出來。
// 這一層跟畫面其他部分一樣：顏色照地形型別，看得出那張圖還是那張圖。

import { W, H, S, tx2x, ty2z, x2tx, z2ty, T, PLACES, clamp } from './field.js';

// 底圖用的色，比場景裡的稍微亮一點——小圖上要讀得出分別
const MINI_TINT = {
  [T.GRASS]: [86, 108, 58], [T.ROAD]: [196, 168, 116], [T.WALL]: [126, 120, 112],
  [T.WATER]: [42, 74, 92], [T.TREE]: [52, 82, 44], [T.BUILDING]: [136, 126, 114],
  [T.ROOF]: [96, 86, 84], [T.SAND]: [186, 170, 122], [T.MOUNTAIN]: [104, 98, 86],
  [T.COUNTER]: [130, 116, 96], [T.BRIDGE]: [176, 156, 122], [T.FLOWER]: [122, 126, 74],
  [T.FLOOR]: [150, 138, 118], [T.RUG]: [128, 96, 82], [T.ROCK]: [138, 132, 124],
  [T.SNOW]: [232, 238, 244], [T.BAMBOO]: [76, 110, 56], [T.FARM]: [140, 120, 74],
  [T.STREET]: [162, 156, 146],
};

/** 純資料：整張世界底圖的像素。不碰 canvas，Node 也算得出來（好驗它不是一片死色）。 */
export function worldPixels(field, groundH) {
  const px = new Uint8ClampedArray(W * H * 4);
  const tiles = field.sc.tiles;
  for (let gy = 0; gy < H; gy++) for (let gx = 0; gx < W; gx++) {
    const i = gy * W + gx;
    const t = tiles[i];
    let [r, g, b] = MINI_TINT[t] || MINI_TINT[T.GRASS];
    // 山用明暗畫，不是用等高線——小圖上一眼看得出哪邊是高的
    const y = groundH(tx2x(gx), ty2z(gy));
    const yE = groundH(tx2x(gx + 1), ty2z(gy)), yN = groundH(tx2x(gx), ty2z(gy - 1));
    const shade = clamp(((yN - y) + (y - yE)) * 0.42, -0.45, 0.45);
    const lift = clamp(y / 110, 0, 1) * 0.3;
    r = clamp(r * (1 + shade + lift), 0, 255);
    g = clamp(g * (1 + shade + lift), 0, 255);
    b = clamp(b * (1 + shade + lift * 0.8), 0, 255);
    const o = i * 4;
    px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = 255;
  }
  return px;
}

const DIRS = [
  { a: 0, label: '北' }, { a: Math.PI / 2, label: '東' },
  { a: Math.PI, label: '南' }, { a: -Math.PI / 2, label: '西' },
];

export function buildMinimap(field, groundH, canvas) {
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  const off = document.createElement('canvas');
  off.width = W; off.height = H;
  off.getContext('2d').putImageData(new ImageData(worldPixels(field, groundH), W, H), 0, 0);

  const state = { headingUp: false, span: 116 };   // span：小地圖上看得見多少公尺

  function draw(player) {
    const px = canvas.width, py = canvas.height;
    const R = px / 2, ring = 13;                    // ring：羅盤圈佔掉的邊
    const mapR = R - ring;
    ctx.clearRect(0, 0, px, py);

    // 底盤
    ctx.save();
    ctx.beginPath(); ctx.arc(R, R, R - 1, 0, 7); ctx.closePath();
    ctx.fillStyle = 'rgba(14,18,26,0.82)'; ctx.fill();

    // 地圖：裁成圓，以玩家為中心
    ctx.save();
    ctx.beginPath(); ctx.arc(R, R, mapR, 0, 7); ctx.closePath(); ctx.clip();
    const rot = state.headingUp ? -(player.heading + Math.PI) : 0;
    const scale = (mapR * 2) / state.span * S;     // 每一格底圖像素對應幾個畫布像素
    ctx.translate(R, R);
    ctx.rotate(rot);
    ctx.imageSmoothingEnabled = true;
    ctx.scale(scale, scale);
    ctx.translate(-x2tx(player.x) - 0.5, -z2ty(player.z) - 0.5);
    ctx.drawImage(off, 0, 0);
    ctx.restore();

    // 地點名：只畫看得到範圍內的
    ctx.save();
    ctx.beginPath(); ctx.arc(R, R, mapR, 0, 7); ctx.closePath(); ctx.clip();
    ctx.font = '9px "PingFang TC",-apple-system,sans-serif';
    ctx.textAlign = 'center';
    for (const p of PLACES) {
      const dx = p.x - player.x, dz = p.z - player.z;
      if (Math.hypot(dx, dz) > state.span * 0.62) continue;
      const k = (mapR * 2) / state.span;
      let sx = dx * k, sy = dz * k;
      if (state.headingUp) {
        const c = Math.cos(rot), s = Math.sin(rot);
        [sx, sy] = [sx * c - sy * s, sx * s + sy * c];
      }
      ctx.fillStyle = '#ffd98a';
      ctx.beginPath(); ctx.arc(R + sx, R + sy, 2.6, 0, 7); ctx.fill();
      if (p.name) {
        ctx.fillStyle = 'rgba(10,14,20,0.75)';
        const wdt = p.name.length * 9 + 6;
        ctx.fillRect(R + sx - wdt / 2, R + sy - 15, wdt, 11);
        ctx.fillStyle = '#f2e6c8';
        ctx.fillText(p.name, R + sx, R + sy - 6);
      }
    }
    ctx.restore();

    // 玩家：北在上時箭頭轉，朝向在上時箭頭固定朝上
    const hdg = state.headingUp ? 0 : player.heading + Math.PI;
    ctx.save();
    ctx.translate(R, R); ctx.rotate(-hdg);
    // 視錐
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, mapR * 0.5, -Math.PI / 2 - 0.52, -Math.PI / 2 + 0.52);
    ctx.closePath();
    ctx.fillStyle = 'rgba(240,232,214,0.13)'; ctx.fill();
    // 箭
    ctx.beginPath();
    ctx.moveTo(0, -7.5); ctx.lineTo(5, 5); ctx.lineTo(0, 2); ctx.lineTo(-5, 5);
    ctx.closePath();
    ctx.fillStyle = '#e8613f'; ctx.fill();
    ctx.restore();

    // 羅盤圈
    ctx.strokeStyle = 'rgba(230,214,180,0.30)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(R, R, mapR + 1.5, 0, 7); ctx.stroke();
    ctx.font = '10px "PingFang TC",-apple-system,sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const d of DIRS) {
      const a = d.a + rot;
      const lx = R + Math.sin(a) * (R - ring / 2 - 1);
      const ly = R - Math.cos(a) * (R - ring / 2 - 1);
      ctx.fillStyle = d.label === '北' ? '#e8613f' : 'rgba(234,226,210,0.72)';
      ctx.fillText(d.label, lx, ly);
    }
    // 刻度
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2 + rot;
      const r0 = mapR + 2, r1 = mapR + (i % 4 === 0 ? 6 : 4);
      ctx.beginPath();
      ctx.moveTo(R + Math.sin(a) * r0, R - Math.cos(a) * r0);
      ctx.lineTo(R + Math.sin(a) * r1, R - Math.cos(a) * r1);
      ctx.strokeStyle = i % 4 === 0 ? 'rgba(230,214,180,0.55)' : 'rgba(230,214,180,0.22)';
      ctx.stroke();
    }
    ctx.restore();
  }

  return {
    draw, state,
    toggleOrientation() { state.headingUp = !state.headingUp; return state.headingUp; },
    zoom(f) { state.span = clamp(state.span * f, 48, 420); return state.span; },
    /** 給測試讀的：畫完之後畫布上有幾種顏色、亮度平均多少 */
    sample() {
      const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let sum = 0, n = 0; const seen = new Set();
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 8) continue;
        sum += (d[i] + d[i + 1] + d[i + 2]) / 3; n++;
        if (n % 7 === 0) seen.add((d[i] >> 4) << 8 | (d[i + 1] >> 4) << 4 | (d[i + 2] >> 4));
      }
      return { mean: n ? sum / n : 0, colours: seen.size, pixels: n };
    },
  };
}
