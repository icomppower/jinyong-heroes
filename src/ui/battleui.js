// 戰鬥畫面：方格繪製、玩家操作、敵方 AI 推進。

import {
  advance, reachable, moveTo, useSkill, useItem, rest, endTurn, tryFlee,
  unitAt, alive, affectedTiles, inRange, canUse, skillTargets,
  tileAt, TERRAIN,
} from '../core/battle.js';
import { SKILL_BY_ID, KIND_NAME } from '../data/skills.js';
import { derived, moveRange, BASIC_ATTACK } from '../core/rules.js';
import { aiAct } from '../core/ai.js';

const TERRAIN_FILL = {
  [TERRAIN.OPEN]: '#ded4bb',
  [TERRAIN.ROUGH]: '#c9bb9b',
  [TERRAIN.BLOCK]: '#8d8069',
  [TERRAIN.WATER]: '#94a7ad',
};

const STATUS_MARK = {
  poison: { t: '毒', c: '#4b7d3a' }, stun: { t: '暈', c: '#8a6d3b' },
  weaken: { t: '傷', c: '#9c2b23' }, guard: { t: '護', c: '#2f5d8a' },
  reflect: { t: '反', c: '#5d3f7a' },
};

export class BattleUI {
  constructor(root, battle, opts) {
    this.root = root;             // { stage, actions, hud, side }
    this.b = battle;
    this.opts = opts;             // { onEnd(result), speed }
    this.mode = 'idle';
    this.skillId = null;
    this.hover = null;
    this.busy = false;
    this.speed = opts.speed ?? 340;

    this.canvas = document.createElement('canvas');
    root.stage.innerHTML = '';
    root.stage.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.canvas.addEventListener('pointerdown', e => this.onClick(e));
    this.canvas.addEventListener('pointermove', e => this.onMove(e));
    this.canvas.addEventListener('pointerleave', () => { this.hover = null; this.draw(); });

    this.resize();
    this.step();
  }

  destroy() { window.removeEventListener('resize', this._onResize); }

  // ── 版面 ──
  resize() {
    const r = this.root.stage.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, r.width * dpr);
    this.canvas.height = Math.max(1, r.height * dpr);
    const g = this.b.grid;
    const pad = 8;
    this.ts = Math.max(14, Math.floor(Math.min((r.width - pad * 2) / g.w, (r.height - pad * 2) / g.h)));
    this.ox = Math.floor((r.width - this.ts * g.w) / 2);
    this.oy = Math.floor((r.height - this.ts * g.h) / 2);
    this.dpr = dpr;
    this.draw();
  }

  toTile(e) {
    const r = this.canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left - this.ox) / this.ts);
    const y = Math.floor((e.clientY - r.top - this.oy) / this.ts);
    const g = this.b.grid;
    if (x < 0 || y < 0 || x >= g.w || y >= g.h) return null;
    return { x, y };
  }

  // ── 繪製 ──
  draw() {
    const { ctx, b } = this;
    const g = b.grid, ts = this.ts;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // 地形
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
      const t = tileAt(g, x, y);
      ctx.fillStyle = TERRAIN_FILL[t];
      ctx.fillRect(this.ox + x * ts, this.oy + y * ts, ts - 1, ts - 1);
      if (t === TERRAIN.BLOCK) {
        ctx.fillStyle = 'rgba(50,44,34,.35)';
        ctx.beginPath();
        ctx.arc(this.ox + x * ts + ts / 2, this.oy + y * ts + ts / 2, ts * 0.3, 0, 7);
        ctx.fill();
      }
    }

    // 高亮
    const hl = this.highlights();
    for (const h of hl) {
      ctx.fillStyle = h.c;
      ctx.fillRect(this.ox + h.x * ts, this.oy + h.y * ts, ts - 1, ts - 1);
    }

    // 網格
    ctx.strokeStyle = 'rgba(60,52,40,.14)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= g.w; x++) {
      ctx.beginPath();
      ctx.moveTo(this.ox + x * ts - .5, this.oy - .5);
      ctx.lineTo(this.ox + x * ts - .5, this.oy + g.h * ts - .5);
      ctx.stroke();
    }
    for (let y = 0; y <= g.h; y++) {
      ctx.beginPath();
      ctx.moveTo(this.ox - .5, this.oy + y * ts - .5);
      ctx.lineTo(this.ox + g.w * ts - .5, this.oy + y * ts - .5);
      ctx.stroke();
    }

    // 人物
    for (const u of b.units) {
      if (u.down) continue;
      const cx = this.ox + u.x * ts + ts / 2, cy = this.oy + u.y * ts + ts / 2;
      const r = ts * 0.36;
      const isActive = b.active === u;
      if (isActive) {
        ctx.strokeStyle = '#8a6d3b'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(cx, cy, r + 4, 0, 7); ctx.stroke();
      }
      ctx.fillStyle = u.side === 'ally' ? '#2f5d8a' : '#9c2b23';
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.stroke();

      ctx.fillStyle = '#f6efe2';
      ctx.font = `600 ${Math.floor(ts * 0.36)}px "Noto Serif TC","Songti TC",serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(u.char.name[0], cx, cy + 1);

      // 血條
      const bw = ts * 0.78, bh = 3.5;
      const bx = cx - bw / 2, by = cy + r + 2.5;
      ctx.fillStyle = 'rgba(40,34,26,.35)'; ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = u.side === 'ally' ? '#4d8f5c' : '#c0392b';
      ctx.fillRect(bx, by, bw * Math.max(0, u.hp / u.maxHp), bh);

      // 狀態
      const marks = u.statuses.map(s => STATUS_MARK[s.type]).filter(Boolean);
      marks.slice(0, 3).forEach((m, i) => {
        ctx.fillStyle = m.c;
        ctx.font = `600 ${Math.floor(ts * 0.24)}px serif`;
        ctx.fillText(m.t, cx - r + i * ts * 0.24, cy - r - 3);
      });
    }
    ctx.restore();
  }

  highlights() {
    const out = [];
    const u = this.b.active;
    if (!u || u.side !== 'ally') return out;
    if (this.mode === 'move') {
      for (const t of reachable(this.b, u)) out.push({ x: t.x, y: t.y, c: 'rgba(47,93,138,.34)' });
      if (this.hover) out.push({ x: this.hover.x, y: this.hover.y, c: 'rgba(47,93,138,.5)' });
    } else if (this.mode === 'target') {
      const sk = this.sk();
      for (const t of skillTargets(this.b, u, sk)) {
        const occ = unitAt(this.b, t.x, t.y);
        out.push({ x: t.x, y: t.y, c: occ && occ.side !== u.side ? 'rgba(156,43,35,.3)' : 'rgba(138,109,59,.2)' });
      }
      if (this.hover && inRange(u, sk, this.hover.x, this.hover.y)) {
        for (const t of affectedTiles(this.b, u, sk, this.hover.x, this.hover.y)) {
          out.push({ x: t.x, y: t.y, c: 'rgba(192,57,43,.46)' });
        }
      }
    }
    return out;
  }

  sk() { return this.skillId === '_basic' ? BASIC_ATTACK : SKILL_BY_ID[this.skillId]; }

  // ── 互動 ──
  onMove(e) {
    if (this.mode === 'idle' || this.busy) return;
    const t = this.toTile(e);
    const same = this.hover && t && this.hover.x === t.x && this.hover.y === t.y;
    if (!same) { this.hover = t; this.draw(); }
  }

  onClick(e) {
    if (this.busy) return;
    const t = this.toTile(e);
    if (!t) return;
    const u = this.b.active;
    if (!u || u.side !== 'ally') return;

    if (this.mode === 'move') {
      if (moveTo(this.b, u, t.x, t.y)) { this.mode = 'idle'; this.hover = null; this.render(); }
      return;
    }
    if (this.mode === 'target') {
      const sk = this.sk();
      if (!inRange(u, sk, t.x, t.y)) return;
      this.doSkill(u, this.skillId, t.x, t.y);
      return;
    }
    // idle：點人看資料
    const v = unitAt(this.b, t.x, t.y);
    if (v) this.opts.onInspect?.(v);
  }

  async doSkill(u, skId, tx, ty) {
    this.busy = true;
    this.mode = 'idle';
    this.hover = null;
    const before = this.b.units.map(x => ({ u: x, hp: x.hp }));
    const r = useSkill(this.b, u, skId, tx, ty);
    this.draw();
    if (r.ok) {
      for (const x of before) {
        const d = x.hp - x.u.hp;
        if (d > 0) this.popup(x.u, '-' + d, '#9c2b23');
        else if (d < 0) this.popup(x.u, '+' + -d, '#3d6b57');
      }
    }
    await this.wait(this.speed);
    this.busy = false;
    this.afterAction(u);
  }

  popup(u, text, color) {
    const el = document.createElement('div');
    el.className = 'fx';
    el.textContent = text;
    el.style.color = color;
    el.style.left = (this.ox + u.x * this.ts + this.ts / 2 - 14) + 'px';
    el.style.top = (this.oy + u.y * this.ts) + 'px';
    this.root.stage.appendChild(el);
    requestAnimationFrame(() => {
      el.style.transform = 'translateY(-26px)';
      el.style.opacity = '0';
    });
    setTimeout(() => el.remove(), 760);
  }

  wait(ms) { return new Promise(r => setTimeout(r, ms)); }

  afterAction(u) {
    if (this.b.over) return this.finish();
    // 快招：useSkill 會把 acted 重置，讓同一人再動一次
    if (!u.down && !u.acted) { this.render(); return; }
    endTurn(this.b, u);
    this.step();
  }

  // ── 主迴圈 ──
  async step() {
    if (this.b.over) return this.finish();
    let u = this.b.active;
    if (!u || u.acted || u.down) {
      this.b.active = null;
      u = advance(this.b);
    }
    if (!u) return this.finish();
    if (u.side === 'enemy') {
      this.busy = true;
      this.render();
      await this.wait(Math.max(160, this.speed * 0.8));
      const before = this.b.units.map(x => ({ u: x, hp: x.hp }));
      aiAct(this.b, u);
      this.draw();
      for (const x of before) {
        const d = x.hp - x.u.hp;
        if (d > 0) this.popup(x.u, '-' + d, '#9c2b23');
        else if (d < 0) this.popup(x.u, '+' + -d, '#3d6b57');
      }
      this.renderLog();
      await this.wait(this.speed);
      this.busy = false;
      if (this.b.over) return this.finish();
      if (!u.acted && !u.down) return this.step();  // 敵方快招
      this.b.active = null;
      return this.step();
    }
    this.mode = 'idle';
    this.render();
  }

  finish() {
    this.render();
    this.opts.onEnd?.(this.b.over || 'draw');
  }

  // ── HTML 面板 ──
  render() {
    this.draw();
    this.renderHud();
    this.renderActions();
    this.renderSide();
    this.renderLog();
  }

  renderHud() {
    const b = this.b;
    const order = b.units.filter(u => !u.down)
      .slice().sort((x, y) => (y.ap - x.ap) || (derived(y.char).qinggong - derived(x.char).qinggong));
    this.root.hud.innerHTML =
      `<b>${b.name}</b><span class="muted">第 ${b.round} 回合</span><span class="sp"></span>` +
      order.slice(0, 8).map(u =>
        `<span class="turnpill ${u.side}${b.active === u ? ' now' : ''}">${u.char.name}</span>`).join('');
  }

  renderActions() {
    const u = this.b.active;
    const el = this.root.actions;
    if (!u || u.side !== 'ally' || this.busy) {
      el.innerHTML = `<div class="muted small">${this.b.over ? '戰鬥結束' : '對方行動中……'}</div>`;
      return;
    }
    if (this.mode === 'move') {
      el.innerHTML = `<div class="row"><span class="small">點選格子移動（移動力 ${moveRange(u.char)}）</span>
        <span class="sp"></span><button class="btn sm" data-a="cancel">取消</button></div>`;
    } else if (this.mode === 'target') {
      const sk = this.sk();
      el.innerHTML = `<div class="row"><span class="small">【${sk.name}】選擇目標</span>
        <span class="sp"></span><button class="btn sm" data-a="cancel">取消</button></div>`;
    } else {
      el.innerHTML = `<div class="row">
        <button class="btn" data-a="move" ${u.moved ? 'disabled' : ''}>移動</button>
        <button class="btn primary" data-a="skill">武功</button>
        <button class="btn" data-a="item">物品</button>
        <button class="btn" data-a="rest">調息</button>
        <button class="btn" data-a="flee" ${this.b.canFlee ? '' : 'disabled'}>逃走</button>
        <span class="sp"></span>
        <button class="btn" data-a="wait">結束</button>
      </div>`;
    }
    el.querySelectorAll('[data-a]').forEach(btn => {
      btn.onclick = () => this.action(btn.dataset.a, u);
    });
  }

  action(a, u) {
    switch (a) {
      case 'move': this.mode = 'move'; this.render(); break;
      case 'cancel': this.mode = 'idle'; this.hover = null; this.skillId = null; this.render(); break;
      case 'skill': this.opts.onPickSkill(u, id => {
        this.skillId = id;
        const sk = this.sk();
        if (sk.shape === 'self') this.doSkill(u, id, u.x, u.y);
        else { this.mode = 'target'; this.render(); }
      }); break;
      case 'item': this.opts.onPickItem(u, (itemId, target) => {
        useItem(this.b, u, itemId, target);
        this.render();
        this.afterAction(u);
      }); break;
      case 'rest': rest(this.b, u); this.render(); this.afterAction(u); break;
      case 'wait': endTurn(this.b, u); this.step(); break;
      case 'flee':
        if (tryFlee(this.b, u)) this.finish();
        else { this.render(); this.afterAction(u); }
        break;
    }
  }

  renderSide() {
    const b = this.b;
    const card = u => {
      const D = derived(u.char);
      const st = u.statuses.map(s => STATUS_MARK[s.type]?.t).filter(Boolean).join('');
      return `<div class="pc ${b.active === u ? 'sel' : ''}" style="${u.down ? 'opacity:.4' : ''}">
        <div class="nm"><b>${u.char.name}</b>
          <span class="tiny muted">${u.char.title || ''} Lv.${u.char.lvl}</span>
          <span class="sp"></span><span class="tiny" style="color:var(--red)">${st}</span></div>
        <div class="bar hp"><i style="width:${Math.max(0, u.hp / u.maxHp * 100)}%"></i></div>
        <div class="tiny muted">氣血 ${u.hp}/${u.maxHp}　內力 ${u.mp}/${u.maxMp}　輕功 ${D.qinggong}</div>
      </div>`;
    };
    this.root.side.innerHTML =
      `<div class="small muted" style="letter-spacing:.2em">我方</div>` +
      alive(b, 'ally').concat(b.units.filter(u => u.side === 'ally' && u.down)).map(card).join('') +
      `<div class="small muted" style="letter-spacing:.2em;margin-top:8px">敵方</div>` +
      b.units.filter(u => u.side === 'enemy').map(card).join('');
  }

  renderLog() {
    const el = this.root.log;
    el.innerHTML = this.b.log.slice(-40).map(l => `<div>${l}</div>`).join('');
    el.scrollTop = el.scrollHeight;
  }
}

export function skillRows(unit, battle) {
  const rows = [{ id: '_basic', sk: BASIC_ATTACK, lvl: 1 }];
  for (const s of unit.char.skills) {
    const sk = SKILL_BY_ID[s.id];
    if (sk && sk.kind !== 'internal') rows.push({ id: s.id, sk, lvl: s.lvl });
  }
  return rows.map(r => ({ ...r, ok: canUse(battle, unit, r.id) }));
}

export { KIND_NAME };
