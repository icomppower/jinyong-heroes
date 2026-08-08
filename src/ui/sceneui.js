// 世界畫面：地圖繪製、高度陰影、日夜、鏡頭跟隨、鍵盤／方向鍵／點地移動。

import { T, isWalkable, heightAt, districtAt } from '../data/maps.js';
import * as F from '../core/field.js';
import * as G from '../core/game.js';

const TILE_FILL = {
  [T.GRASS]: '#9cae87', [T.ROAD]: '#d9caa6', [T.WALL]: '#8a8072',
  [T.WATER]: '#6f8ea0', [T.TREE]: '#5f7a52', [T.BUILDING]: '#a08a70',
  [T.ROOF]: '#8c5f4d', [T.SAND]: '#dcd0aa', [T.MOUNTAIN]: '#8d8577',
  [T.COUNTER]: '#b0916c', [T.BRIDGE]: '#b99a72', [T.FLOWER]: '#c3a5b2',
  [T.FLOOR]: '#cfc3a8', [T.RUG]: '#b0857a', [T.ROCK]: '#6f6a61',
  [T.SNOW]: '#e8e6e0', [T.BAMBOO]: '#6f8a55', [T.FARM]: '#bcae7e',
  [T.STREET]: '#cfc0a0',
};

const ENT_STYLE = {
  door: { c: '#7d211b', t: '門' },
  exit: { c: '#7d211b', t: '出' },
  ferry: { c: '#2f5d8a', t: '渡' },
  shop: { c: '#8a6d3b', t: '商' },
  inn: { c: '#8a6d3b', t: '宿' },
  recruit: { c: '#2f5d8a', t: '俠' },
  talk: { c: '#6b6257', t: '民' },
  train: { c: '#3d6b57', t: '靜' },
  boss: { c: '#9c2b23', t: '敵' },
  sign: { c: '#7a6a5a', t: '碑' },
  book: { c: '#c9a227', t: '笈' },
  actor: { c: '#5a4a86', t: '行' },
};

const STEP_MS = 125;

export class SceneUI {
  constructor(stage, game, opts = {}) {
    this.stage = stage;
    this.g = game;
    this.opts = opts;
    this.queue = [];
    this.held = new Set();
    this.anim = null;
    this.paused = false;
    this.lastStep = 0;
    this.lockView = opts.lockView || null;    // ?cam= 用

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

  // 站得高看得遠：視野格寬隨腳下高度變寬
  viewTiles() {
    if (this.lockView) return this.lockView;
    const sc = G.curScene(this.g);
    if (sc.kind === 'interior') return 15;
    return 20 + Math.floor(heightAt(sc, this.g.pos.x, this.g.pos.y) / 40);
  }

  resize() {
    const r = this.stage.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, r.width * dpr);
    this.canvas.height = Math.max(1, r.height * dpr);
    this.vw = r.width; this.vh = r.height; this.dpr = dpr;
    const view = this.viewTiles();
    this.ts = Math.max(12, Math.floor(Math.min(r.width / view, r.height / (view * 0.7))));
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
    const opts = G.pathOpts(this.g, sc);
    const target = F.entityAt(sc, tx, ty, opts.ents);
    let path;
    if (target) {
      path = F.pathToEntity(sc, this.g.pos, e2 => e2 === target, opts.ents, opts);
    } else if (isWalkable(F.tileAt(sc, tx, ty))) {
      path = F.pathTo(sc, this.g.pos, { x: tx, y: ty }, opts);
    }
    if (path && path.length) { this.queue = path.slice(0, 900); this.held.clear(); }
    else if (!path) this.opts.onMessage?.('那邊過不去。');
  }

  press(dir) { this.queue.length = 0; this.step(dir); }

  frame(t) {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.anim) return;
    this.anim.t = Math.min(1, (t - this.anim.start) / STEP_MS);
    if (this.anim.t >= 1) this.anim = null;
    this.draw();
  }

  // 走路節奏交給計時器，rAF 只畫補間——背景分頁與無頭虛擬時間下 rAF 是不跑的
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
    const beforeView = this.viewTiles();
    const r = G.walk(this.g, dir);

    if (r.bumped) {
      this.draw();
      this.queue.length = 0;
      this.opts.onInteract?.(r.bumped);
      return;
    }
    if (r.refused) { this.queue.length = 0; this.opts.onMessage?.(r.refused); this.draw(); return; }
    if (!r.moved) { this.draw(); return; }

    this.anim = { from, start: performance.now(), t: 0 };
    if (this.viewTiles() !== beforeView) this.resize();

    if (r.sceneChanged) { this.queue.length = 0; this.anim = null; this.opts.onSceneChange?.(); return; }
    if (r.ferry) { this.queue.length = 0; this.anim = null; this.opts.onFerry?.(r.ferry); return; }
    if (r.book) { this.queue.length = 0; this.opts.onBook?.(r.book); }
    if (r.arrived) { this.queue.length = 0; this.opts.onArrive?.(r.arrived); }
    if (r.actor) this.opts.onActor?.(r.actor);
    if (r.nightfall) this.opts.onMessage?.('天黑了。夜路上不太平，客棧也快打烊。');
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

  // 日夜不是濾鏡，但畫面上總得看得出來
  nightAlpha() {
    const h = G.hourOf(this.g);
    if (h >= 8 && h < 17) return 0;
    if (h >= 17 && h < 19) return (h - 17) / 2 * 0.34;
    if (h >= 19 || h < 4) return 0.44;
    if (h >= 4 && h < 6) return 0.44 - (h - 4) / 2 * 0.24;
    return 0.2 - (h - 6) / 2 * 0.2;
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

      // 高度陰影：山勢遠遠就看得出起伏
      if (sc.kind !== 'interior') {
        const h = heightAt(sc, x, y);
        const hw = heightAt(sc, x - 1, y);
        if (h > 96) {
          ctx.fillStyle = `rgba(60,52,40,${Math.min(0.34, (h - 96) / 460)})`;
          ctx.fillRect(x * ts, y * ts, ts, ts);
        }
        if (h - hw > 12) {
          ctx.fillStyle = 'rgba(255,250,235,.16)';
          ctx.fillRect(x * ts, y * ts, Math.max(1, ts * 0.16), ts);
        }
      }

      if (t === T.TREE || t === T.BAMBOO) {
        ctx.fillStyle = t === T.TREE ? '#47603d' : '#8fae6a';
        ctx.beginPath(); ctx.arc(x * ts + ts / 2, y * ts + ts / 2, ts * 0.3, 0, 7); ctx.fill();
      } else if (t === T.MOUNTAIN || t === T.ROCK) {
        ctx.fillStyle = t === T.MOUNTAIN ? '#736c60' : '#585349';
        ctx.beginPath();
        ctx.moveTo(x * ts + ts * 0.15, y * ts + ts * 0.82);
        ctx.lineTo(x * ts + ts * 0.5, y * ts + ts * 0.18);
        ctx.lineTo(x * ts + ts * 0.85, y * ts + ts * 0.82);
        ctx.closePath(); ctx.fill();
      } else if (t === T.FLOWER) {
        ctx.fillStyle = '#9c2b23';
        ctx.beginPath(); ctx.arc(x * ts + ts * 0.5, y * ts + ts * 0.5, ts * 0.11, 0, 7); ctx.fill();
      } else if (t === T.FARM) {
        ctx.strokeStyle = 'rgba(120,100,60,.35)'; ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x * ts, y * ts + ts * 0.5); ctx.lineTo(x * ts + ts, y * ts + ts * 0.5);
        ctx.stroke();
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
    const labels = [];
    for (const e of ents) {
      if (e.x < x0 - 1 || e.x > x1 + 1 || e.y < y0 - 1 || e.y > y1 + 1) continue;
      const st = ENT_STYLE[e.type] || { c: '#555', t: '?' };
      const cx = e.x * ts + ts / 2, cy = e.y * ts + ts / 2;
      if (e.type === 'door' || e.type === 'exit') {
        ctx.fillStyle = st.c;
        ctx.fillRect(e.x * ts + ts * 0.18, e.y * ts + ts * 0.12, ts * 0.64, ts * 0.78);
        ctx.fillStyle = '#f2ece0';
        ctx.font = `600 ${Math.floor(ts * 0.42)}px "Noto Serif TC",serif`;
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
      if (e.type === 'ferry' || e.type === 'actor' || e.type === 'boss') {
        labels.push({ text: e.name, x: cx, y: e.y * ts + ts * 0.94 });
      }
    }

    // 地名：站在街廓裡就把名字寫在中心
    if (sc.kind !== 'interior') {
      for (const d of (sc.districtOrder || [])) {
        const p = G.locPos(d);
        if (p.x < x0 - 4 || p.x > x1 + 4 || p.y < y0 - 4 || p.y > y1 + 4) continue;
        labels.push({
          text: G.LOC_BY_ID[d].name, x: p.x * ts + ts / 2, y: p.y * ts - ts * 0.4, big: true,
        });
      }
    }
    for (const l of labels) {
      ctx.font = `${Math.floor(ts * (l.big ? 0.5 : 0.32))}px "Noto Serif TC",serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(20,18,14,.75)';
      ctx.strokeText(l.text, l.x, l.y);
      ctx.fillStyle = l.big ? '#f7e9c8' : '#f2ece0';
      ctx.fillText(l.text, l.x, l.y);
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
    const d = F.DIRS[this.g.facing] || [0, 1];
    ctx.fillStyle = '#9c2b23';
    ctx.beginPath();
    ctx.arc(px + d[0] * ts * 0.24, py + d[1] * ts * 0.24, ts * 0.09, 0, 7);
    ctx.fill();

    ctx.restore();

    // 夜色
    const na = sc.kind === 'interior' ? 0 : this.nightAlpha();
    if (na > 0) {
      ctx.save();
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.fillStyle = `rgba(18,24,52,${na})`;
      ctx.fillRect(0, 0, this.vw, this.vh);
      const lx = px - cam.x, ly = py - cam.y;
      const grd = ctx.createRadialGradient(lx, ly, ts * 0.6, lx, ly, ts * 5);
      grd.addColorStop(0, `rgba(255,224,160,${na * 0.5})`);
      grd.addColorStop(1, 'rgba(255,224,160,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, this.vw, this.vh);
      ctx.restore();
    }
  }
}
