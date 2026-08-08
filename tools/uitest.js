// 頁內測試 harness：由 index.html?autotest=1 載入，把數值結果寫進 #testout 讓 Node 讀回。
// 不截圖——截圖既貴又常常什麼都證明不了。這裡量的是幾何量、日夜光、幀時，
// 以及那條唯一的通過條件：揚州出生，第一人稱走到華山之巔，不准傳送、不准開地圖。

import * as F from '../src/world3d/field.js';

const out = (obj) => {
  let el = document.getElementById('testout');
  if (!el) { el = document.createElement('div'); el.id = 'testout'; el.style.display = 'none'; document.body.appendChild(el); }
  el.textContent = JSON.stringify(obj);
};

const wait = ms => new Promise(r => setTimeout(r, ms));
async function framesAtLeast(G, n, timeoutMs = 60000) {
  const t0 = Date.now();
  while (G.frames < n && Date.now() - t0 < timeoutMs) await wait(60);
  return G.frames >= n;
}

(async function run() {
  const R = { checks: [], stats: null, error: null };
  const ok = (name, cond, detail) => R.checks.push({ name, pass: !!cond, detail: detail === undefined ? '' : String(detail) });
  try {
    const t0 = Date.now();
    let G = window.__jianghu;
    while (!G && Date.now() - t0 < 40000) { await wait(80); G = window.__jianghu; }
    if (!G) throw new Error('runWalk 沒有掛上 window.__jianghu');

    const st = G.stats;
    R.stats = st;

    // ── 幾何真的長出來了嗎 ──
    ok('地形網格建起來了', st.terrainVerts > 100000, st.terrainVerts + ' 頂點');
    ok('十五處聚落都有建物', st.buildings >= 90, st.buildings + ' 棟');
    ok('城門建出來了', st.gates >= 8, st.gates + ' 座');
    ok('門是看得見的幾何（雖然這一期打不開）', st.doors >= 20, st.doors + ' 扇');
    ok('少林塔林撒出來了', st.stupas >= 40, st.stupas + ' 座');
    ok('華山石階鋪出來了', st.steps >= 150, st.steps + ' 階');
    ok('長空棧道有懸空段', st.planks >= 1, st.planks + ' 塊');
    ok('荒野有林', st.tree >= 3000, st.tree + ' 棵');
    ok('荒野有竹', st.bamboo >= 200, st.bamboo + ' 竿');
    ok('岩石散佈出來了', st.rock >= 400, st.rock + ' 塊');
    ok('draw call 沒有失控（一種零件一個實例網格）', st.drawCalls < 90, st.drawCalls + ' 個');
    ok('實例總數在預算內', st.instances < 90000, st.instances + ' 個');
    ok('建場在三秒內跑完', st.tField + st.tGeo < 3000, `場 ${st.tField}ms + 幾何 ${st.tGeo}ms`);

    // ── 高度場的硬規則，畫面這邊再確認一次 ──
    ok('華山之巔是全圖最高（畫面層讀到的也是這個數）', st.peakY > 90, st.peakY + ' 公尺');
    const dropped = new URLSearchParams(location.search).has('pos');
    if (!dropped) ok('出生點在平地上', st.spawnY > 0 && st.spawnY < 40, st.spawnY + ' 公尺');

    // ── 日夜是照明，不是濾鏡 ──
    const clock0 = G.clock;                       // 量完要放回去，不然 ?time= 的斷言會量到自己
    G.setTime(12); const noon = G.lightState();
    G.setTime(1);  const night = G.lightState();
    G.setTime(19); const dusk = G.lightState();
    ok('正午的日照比深夜強', noon.sunInt > night.sunInt * 3, `${noon.sunInt} vs ${night.sunInt}`);
    ok('深夜看得到星（night 係數拉滿）', night.night > 0.9, night.night);
    ok('黃昏是介於兩者之間的', dusk.sunInt > night.sunInt && dusk.sunInt < noon.sunInt, dusk.sunInt);
    ok('霧的濃度隨時辰在動', Math.abs(night.fogD - noon.fogD) > 1e-4, `${noon.fogD} → ${night.fogD}`);
    G.setTime(clock0);

    // ── 唯一的通過條件 ──
    // 沿「最快走法」自走：走的是同一套步速與碰撞，不是另外寫一條捷徑。
    const world = G.world;
    const droppedIn = dropped;
    const peakG = F.GEO.PEAKS.find(p => p.name === '華山之巔');
    const route = F.routeFast(world.mask, world.speedAt, world.groundH,
      { x: F.SPAWN.gx, y: F.SPAWN.gy }, { x: peakG.x, y: peakG.y });
    ok('排得出從出生點到峰頂的路', !!route, route ? route.length + ' 格' : '無');
    // 第二幕是「用除錯參數直接落地」那一幕，不必再走一次全程
    if (route && !droppedIn) {
      // 航點一格一個，不要抽稀。抽成三格一個、容忍三公尺，直線切過去就會削到牆角，
      // 人卡在城門邊上動不了——第一次跑就是這樣死的（走了 11 公尺，卡了 920 秒）。
      const pts = route.map(p => ({ x: F.tx2x(p.x), z: F.ty2z(p.y) }));
      G.teleport(F.SPAWN.x, F.SPAWN.z);
      G.autowalk(pts, 1.4);
      // dt 用 1/15：容忍半徑 1.4 公尺、步速 1.55 m/s，一步走 0.1 公尺，夠精細了；
      // 用 1/30 會多跑一倍的迴圈，無頭那邊的虛擬時間預算撐不到寫結果就被 dump 掉。
      const budget = Math.ceil(route.seconds * 1.6);
      const sim = G.simulate(budget, 1 / 15);
      const a = G.autoState;
      const dToPeak = Math.hypot(G.x - F.tx2x(peakG.x), G.z - F.ty2z(peakG.y));
      R.walk = {
        routeTiles: route.length, routeSeconds: +route.seconds.toFixed(1),
        travelled: a ? +a.travelled.toFixed(1) : null,
        reachedIdx: a ? a.i : pts.length, waypoints: pts.length,
        stuck: a ? +a.stuck.toFixed(2) : 0, distToPeak: +dToPeak.toFixed(1),
        finalY: +G.y.toFixed(1), place: G.place,
      };
      ok('自走到得了華山之巔（不傳送、不開地圖）', dToPeak < 9, dToPeak.toFixed(1) + ' 公尺');
      ok('全程沒有卡住', !a || a.stuck < 3, a ? a.stuck.toFixed(2) + ' 秒沒動' : '');
      ok('終點站在峰頂高度上', G.y > 85, G.y.toFixed(1) + ' 公尺');
    }


    // ── 馬 ──
    ok('十四匹馬擺出來了', st.horses === 14, st.horses + ' 匹');
    ok('騎得到的地方比走得到的少', st.rideableTiles < st.walkableTiles,
      `${st.rideableTiles} / ${st.walkableTiles}`);
    {
      // 站在揚州拴馬樁旁邊，上馬、跑一段、再下馬
      const spot = F.horseSpots(world.rideMask).find(s => s.id === 'yangzhou');
      G.teleport(spot.x, spot.z + 2.4, Math.PI);
      G.mountToggle();
      ok('按得上馬', !!G.mounted, G.mounted || '沒上去');
      let far = null;
      if (G.mounted) {
        const x0 = G.x, z0 = G.z;
        G.autowalk([{ x: F.tx2x(276), z: F.ty2z(146) }], 4);
        G.simulate(90, 1 / 15);
        const rode = Math.hypot(G.x - x0, G.z - z0);
        ok('馬真的跑得動', rode > 20, rode.toFixed(0) + ' 公尺');
        far = { x: G.x, z: G.z };            // 這裡騎得到，等一下拿來測喚馬
        G.mountToggle();
        ok('下得了馬', !G.mounted);
      }
      // 呼哨喚馬：離最近的馬再遠，只要腳下騎得了，按 F 馬就到。
      // 先把剛下的那匹騎回拴馬樁附近放掉，才量得到真正的距離。
      if (far) {
        G.mountToggle();
        if (G.mounted) { G.teleport(spot.x, spot.z + 2.4, Math.PI); G.mountToggle(); }
        G.teleport(far.x, far.z, Math.PI);
        const d = G.nearestHorseDist();
        G.mountToggle();
        ok('離最近的馬很遠也喚得到（呼哨即到）', !!G.mounted && d > 20,
          `${d === null ? '?' : d.toFixed(0)} 公尺外 · ${G.mounted || '沒上去'}`);
        if (G.mounted) { G.teleport(spot.x, spot.z + 2.4, Math.PI); G.mountToggle(); }
      }
      // 但論劍台上仍舊喚不出馬——設計的支點沒被喚馬繞過
      const pk = F.GEO.PEAKS.find(p => p.name === '華山之巔');
      G.teleport(F.tx2x(pk.x), F.ty2z(pk.y), Math.PI);
      G.mountToggle();
      ok('華山之巔喚不出馬（走得上去、騎不上去）', !G.mounted, G.mounted || '（沒上馬）');
      if (G.mounted) G.mountToggle();
    }

    // ── 小地圖：指北 ──
    if (G.minimapState()) {
      const s0 = G.minimapState();
      ok('小地圖預設指北（不是朝向在上）', s0.headingUp === false);
      const flipped = G.minimapToggle();
      ok('M 切得動朝向在上', flipped === true);
      G.minimapToggle();
      ok('再按一次切回指北', G.minimapState().headingUp === false);
      const smp = G.minimapSample();
      R.minimap = smp;
      ok('小地圖畫得出東西（不是一片空白）', smp.pixels > 2000, smp.pixels + ' px');
      ok('小地圖有地形分色（不是一片死色）', smp.colours >= 12, smp.colours + ' 色');
      ok('小地圖不是全黑也不是全白', smp.mean > 25 && smp.mean < 225, smp.mean.toFixed(0));
    }

    R.pass = R.checks.filter(c => c.pass).length; R.fail = R.checks.length - R.pass; out(R);

    // ── 幀時：先讓它跑一陣子再取 p95 ──
    G.start();
    await framesAtLeast(G, 40, 30000);
    R.p95 = G.p95();
    R.frames = G.frames;
    // ⚠️ 無頭是 SwiftShader 軟體算的，一秒跑不了幾幀——所以這裡只斷言「畫得出來、
    //    而且會繼續畫」，p95 當參考值印出來。真的效能數字要在有 GPU 的機器上量。
    ok('畫得出來而且會繼續畫', G.frames >= 2, G.frames + ' 幀（軟體算圖）');

    // ── 除錯參數：?pos= 真的落得下去 ──
    const q = new URLSearchParams(location.search);
    if (q.has('pos')) {
      const [gx, gy] = q.get('pos').split(',').map(Number);
      R.landed = { want: [gx, gy], gotY: +G.y.toFixed(1), place: G.place, clock: +G.clock.toFixed(2) };
      ok('?pos= 落在請求的地方（站得住）', G.y > 0, `海拔 ${G.y.toFixed(1)} 公尺，${G.place}`);
    }
    if (q.has('time')) {
      ok('?time= 設定得了時辰', Math.abs(G.clock - Number(q.get('time'))) < 4, G.clock.toFixed(2));
    }
  } catch (e) {
    R.error = (e && e.stack) || String(e);
  }
  R.pass = R.checks.filter(c => c.pass).length;
  R.fail = R.checks.filter(c => !c.pass).length;
  out(R);
})();
