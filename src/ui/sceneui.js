// 場景畫面：地圖繪製、鏡頭跟隨、鍵盤／方向鍵／點地移動。

import { T, isWalkable } from '../data/maps.js';
import * as F from '../core/field.js';
import * as G from '../core/game.js';

const TILE_FILL = {
  [T.GRASS]: '#9cae87', [T.PATH]: '#d9caa6', [T.WALL]: '#8a8072',
  [T.WATER]: '#7d99a8', [T.TREE]: '#5f7a52', [T.BUILDING]: '#a08a70',
  [T.ROOF]: '#8c5f4d', [T.SAND]: '#dcd0aa', [T.MOUNTAIN]: '#8d8577',
  [T.COUNTER]: '#b0916c', [T.BRIDGE]: '#b99a72', [T.FLOWER]: '#c3a5b2',
  [T.FLOOR]: '#cfc3a8', [T.RUG]: '#b0857a',
};

const ENT_STYLE = {
  gate: { c: '#9c2b23', t: '門' },
  exit: { c: '#9c2b23', t: '出' },
  shop: { c: '#8a6d3b', t: '商' },
  inn: { c: '#8a6d3b', t: '宿' },
  recruit: { c: '#2f5d8a', t: '俠' },
  talk: { c: '#6b6257', t: '民' },
  train: { c: '#3d6b57', t: '靜' },
  boss: { c: '#9c2b23', t: '敵' },
  sign: { c: '#7a6a5a', t: '碑' },
  book: { c: '#c9a227', t: '笈' },
};

const STEP_MS = 125;

export class SceneUI {
  constructor(stage, game, opts = {}) {
    this.stage = stage;
    this.g = game;
    this.opts = opts;          // { onInteract, onEncounter, onSceneChange, onChanged, onMessage }
    this.queue = [];
    this.held = new Set();
    this.anim = null;
    this.paused = false;
    this.lastStep = 0;

    stage.innerHTML = '';
    this.canvas = document.createElement('canvas');
    stage.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    this._resize = () => this.resize();
    this._key = e => this.onKey(e, true);
    this._keyup = e => this.onKey(e, false);
    window.addEventListener('resize', this._resize);
    window.addEventListener('keydown', this._key);
    window.addEventListener('keyup', this._keyup);
    this.canvas.addEventListener('pointerdown', e => this.onTap(e));

    this.resize();
    this.loop = t => this.frame(t);
    this.raf = requestAnimationFrame(this.loop);
    this.timer = setInterval(() => this.tick(), 30);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    clearInterval(this.timer);
    window.removeEventListener('resize', this._resize);
    window.removeEventListener('keydown', this._key);
    window.removeEventListener('keyup', this._keyup);
  }

  resize() {
    const r = this.stage.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, r.width * dpr);
    this.canvas.height = Math.max(1, r.height * dpr);
    this.vw = r.width; this.vh = r.height; this.dpr = dpr;
    // 視野固定約 21 格寬，畫面小就自動縮
    this.ts = Math.max(16, Math.floor(Math.min(r.width / 21, r.height / 15)));
    this.draw();
  }

  onKey(e, down) {
    const map = {
      ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
      w: 'up', s: 'down', a: 'left', d: 'right',
      W: 'up', S: 'down', A: 'left', D: 'right',
    };
    const dir = map[e.key];
    if (!dir) return;
    e.preventDefault();
    if (down) { this.held.add(dir); this.queue.length = 0; }
    else this.held.delete(dir);
  }

  // 點地圖：自動尋路過去（手機上主要靠這個）
  onTap(e) {
    if (this.paused) return;
    const r = this.canvas.getBoundingClientRect();
    const cam = this.camera();
    const tx = Math.floor((e.clientX - r.left + cam.x) / this.ts);
    const ty = Math.floor((e.clientY - r.top + cam.y) / this.ts);
    const sc = G.curScene(this.g);
    if (tx < 0 || ty < 0 || tx >= sc.w || ty >= sc.h) return;
    const ents = G.activeEntities(this.g, sc);
    const target = F.entityAt(sc, tx, ty, ents);
    let path;
    if (target) {
      path = F.pathToEntity(sc, this.g.pos, e2 => e2 === target, ents);
    } else if (isWalkable(F.tileAt(sc, tx, ty))) {
      path = F.pathTo(sc, this.g.pos, { x: tx, y: ty }, { ents });
    }
    if (path && path.length) { this.queue = path.slice(0, 400); this.held.clear(); }
  }

  press(dir) { this.queue.length = 0; this.step(dir); }

  // 只畫補間
  frame(t) {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.anim) return;
    this.anim.t = Math.min(1, (t - this.anim.start) / STEP_MS);
    if (this.anim.t >= 1) this.anim = null;
    this.draw();
  }

  // 走路節奏
  tick() {
    if (this.paused) return;
    const now = performance.now();
    if (now - this.lastStep < STEP_MS) return;
    let dir = null;
    if (this.held.size) dir = [...this.held][this.held.size - 1];
    else if (this.queue.length) dir = this.queue.shift();
    if (!dir) return;
    this.lastStep = now;
    this.step(dir);
  }

  step(dir) {
    if (this.paused) return;
    const from = { ...this.g.pos };
    const r = G.walk(this.g, dir);

    if (r.bumped) {
      this.draw();
      this.queue.length = 0;
      this.opts.onInteract?.(r.bumped);
      return;
    }
    if (!r.moved) { this.draw(); return; }

    this.anim = { from, start: performance.now(), t: 0 };

    if (r.refused) { this.queue.length = 0; this.opts.onMessage?.(r.refused); this.draw(); return; }
    if (r.sceneChanged) { this.queue.length = 0; this.anim = null; this.opts.onSceneChange?.(); return; }
    if (r.book) { this.queue.length = 0; this.opts.onBook?.(r.book); }
    if (r.encounter) { this.queue.length = 0; this.anim = null; this.opts.onEncounter?.(r.encounter); return; }
    this.opts.onChanged?.();
    this.draw();
  }

  camera() {
    const sc = G.curScene(this.g);
    const p = this.drawPos();
    let x = (p.x + 0.5) * this.ts - this.vw / 2;
    let y = (p.y + 0.5) * this.ts - this.vh / 2;
    const maxX = sc.w * this.ts - this.vw, maxY = sc.h * this.ts - this.vh;
    x = maxX <= 0 ? maxX / 2 : Math.max(0, Math.min(maxX, x));
    y = maxY <= 0 ? maxY / 2 : Math.max(0, Math.min(maxY, y));
    return { x, y };
  }

  drawPos() {
    if (!this.anim) return this.g.pos;
    const a = this.anim, t = a.t;
    return { x: a.from.x + (this.g.pos.x - a.from.x) * t, y: a.from.y + (this.g.pos.y - a.from.y) * t };
  }

  draw() {
    const { ctx } = this;
    const sc = G.curScene(this.g);
    const ts = this.ts;
    const cam = this.camera();
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#2a2620';
    ctx.fillRect(0, 0, this.vw, this.vh);
    ctx.translate(-cam.x, -cam.y);

    const x0 = Math.max(0, Math.floor(cam.x / ts));
    const y0 = Math.max(0, Math.floor(cam.y / ts));
    const x1 = Math.min(sc.w - 1, Math.ceil((cam.x + this.vw) / ts));
    const y1 = Math.min(sc.h - 1, Math.ceil((cam.y + this.vh) / ts));

    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const t = sc.tiles[y * sc.w + x];
      ctx.fillStyle = TILE_FILL[t] || '#999';
      ctx.fillRect(x * ts, y * ts, ts, ts);
      if (t === T.TREE) {
        ctx.fillStyle = '#47603d';
        ctx.beginPath(); ctx.arc(x * ts + ts / 2, y * ts + ts / 2, ts * 0.32, 0, 7); ctx.fill();
      } else if (t === T.MOUNTAIN) {
        ctx.fillStyle = '#736c60';
        ctx.beginPath();
        ctx.moveTo(x * ts + ts * 0.15, y * ts + ts * 0.82);
        ctx.lineTo(x * ts + ts * 0.5, y * ts + ts * 0.18);
        ctx.lineTo(x * ts + ts * 0.85, y * ts + ts * 0.82);
        ctx.closePath(); ctx.fill();
      } else if (t === T.FLOWER) {
        ctx.fillStyle = '#9c2b23';
        ctx.beginPath(); ctx.arc(x * ts + ts * 0.5, y * ts + ts * 0.5, ts * 0.11, 0, 7); ctx.fill();
      } else if (t === T.WATER) {
        ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x * ts + 2, y * ts + ts * 0.62);
        ctx.lineTo(x * ts + ts - 2, y * ts + ts * 0.62);
        ctx.stroke();
      }
      if (t === T.BUILDING || t === T.WALL || t === T.ROOF) {
        ctx.strokeStyle = 'rgba(40,34,26,.22)'; ctx.lineWidth = 1;
        ctx.strokeRect(x * ts + .5, y * ts + .5, ts - 1, ts - 1);
      }
    }

    // 實體
    const ents = G.activeEntities(this.g, sc);
    for (const e of ents) {
      if (e.x < x0 - 1 || e.x > x1 + 1 || e.y < y0 - 1 || e.y > y1 + 1) continue;
      const st = ENT_STYLE[e.type] || { c: '#555', t: '?' };
      const cx = e.x * ts + ts / 2, cy = e.y * ts + ts / 2;
      if (e.type === 'gate' || e.type === 'exit') {
        ctx.fillStyle = st.c;
        ctx.fillRect(e.x * ts + ts * 0.14, e.y * ts + ts * 0.1, ts * 0.72, ts * 0.8);
        ctx.fillStyle = '#f2ece0';
        ctx.font = `600 ${Math.floor(ts * 0.44)}px "Noto Serif TC",serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(st.t, cx, cy + 1);
      } else {
        ctx.fillStyle = st.c;
        ctx.beginPath(); ctx.arc(cx, cy, ts * 0.34, 0, 7); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(cx, cy, ts * 0.34, 0, 7); ctx.stroke();
        ctx.fillStyle = '#f6efe2';
        ctx.font = `600 ${Math.floor(ts * 0.36)}px "Noto Serif TC",serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(st.t, cx, cy + 1);
      }
      // 地名／可招募者的名牌
      if (e.type === 'gate') {
        ctx.font = `${Math.floor(ts * 0.34)}px "Noto Serif TC",serif`;
        ctx.textBaseline = 'top';
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(20,18,14,.75)';
        ctx.strokeText(e.name, cx, e.y * ts + ts * 0.92);
        ctx.fillStyle = '#f2ece0';
        ctx.fillText(e.name, cx, e.y * ts + ts * 0.92);
      }
    }

    // 玩家
    const p = this.drawPos();
    const px = p.x * ts + ts / 2, py = p.y * ts + ts / 2;
    ctx.fillStyle = '#1f1b16';
    ctx.beginPath(); ctx.ellipse(px, py + ts * 0.3, ts * 0.28, ts * 0.1, 0, 0, 7);
    ctx.globalAlpha = .25; ctx.fill(); ctx.globalAlpha = 1;
    ctx.fillStyle = '#f0e6d2';
    ctx.beginPath(); ctx.arc(px, py, ts * 0.34, 0, 7); ctx.fill();
    ctx.strokeStyle = '#9c2b23'; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.arc(px, py, ts * 0.34, 0, 7); ctx.stroke();
    // 面向
    const d = F.DIRS[this.g.facing] || [0, 1];
    ctx.fillStyle = '#9c2b23';
    ctx.beginPath();
    ctx.arc(px + d[0] * ts * 0.24, py + d[1] * ts * 0.24, ts * 0.09, 0, 7);
    ctx.fill();

    ctx.restore();
  }
}
