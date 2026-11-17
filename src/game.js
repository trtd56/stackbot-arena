// game.js — STACKBOT ARENA 本体
'use strict';

(() => {
  const SC = 3;                 // 1ボクセル = 3px。断面1枚を3回ずつ重ねて隙間を埋める
  const HALF = 900;             // アリーナの半径（正方形の半分）
  const WALL = 36;
  const params = new URLSearchParams(location.search);
  const DEMO = params.has('demo');
  // ?scene … 画面確認用の止まった場面（敵を自機の前に並べ、敵は動かず撃たない。ウェーブも進まない）。&fire で撃ち続ける
  const SCENE = params.has('scene');

  const cvs = document.getElementById('game');
  const ctx = cvs.getContext('2d');
  let VW = 0, VH = 0;
  function resize() { VW = cvs.width = innerWidth; VH = cvs.height = innerHeight; }
  addEventListener('resize', resize);
  resize();

  const $ = (id) => document.getElementById(id);
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

  let best = 0;
  try { best = +localStorage.getItem('stackbot-best') || 0; } catch (e) { /* 保存できない環境 */ }

  // ---------------- 音（WebAudio で合成。外部の音源なし） ----------------
  // 重く無骨にするための部品: 低い音の急降下（胴鳴り）、歪み（WaveShaper）、ノイズの破裂（帯域を絞る）、
  // 手続きで作った残響（減衰するノイズのインパルス応答）、全体を締めるコンプレッサー。
  let actx = null, muted = false, noiseBuf = null, master = null, verbIn = null, curves = {};
  function initAudio() {
    if (actx) return;
    try { setupAudio(new (window.AudioContext || window.webkitAudioContext)()); } catch (e) { actx = null; }
  }
  function setupAudio(c) {
    {
      actx = c;
      const sr = actx.sampleRate;
      noiseBuf = actx.createBuffer(1, sr * 2, sr);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const comp = actx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.knee.value = 6; comp.ratio.value = 5; comp.attack.value = 0.002; comp.release.value = 0.2;
      master = actx.createGain(); master.gain.value = 0.85;
      master.connect(comp).connect(actx.destination);
      // 残響: 2.4 秒、低域寄りに減衰するノイズ（屋外の広い反響）
      const ir = actx.createBuffer(2, sr * 2.4, sr);
      for (let ch = 0; ch < 2; ch++) {
        const o = ir.getChannelData(ch);
        let lp = 0;
        for (let i = 0; i < o.length; i++) { const t = i / o.length; lp += (Math.random() * 2 - 1 - lp) * (0.5 - t * 0.42); o[i] = lp * Math.pow(1 - t, 3.2); }
      }
      const verb = actx.createConvolver(); verb.buffer = ir;
      verbIn = actx.createGain(); verbIn.gain.value = 0.6;
      verbIn.connect(verb).connect(master);
    }
  }
  // __stack.sfxTest()（?debug のとき）: 全部の音を OfflineAudioContext に書き出し、ピーク・鳴っている長さ・200Hz 未満の割合を表にする（ヘッドレスでの確認用）
  async function sfxTest() {
    const out = {};
    for (const name of ['shoot', 'eshoot', 'hit', 'boom', 'hurt', 'dash', 'vent', 'ready', 'pickup', 'slam', 'wave', 'step']) {
      const sr = 44100, off = new OfflineAudioContext(1, sr * 3, sr);
      actx = null; curves = {}; setupAudio(off);
      sfx(name);
      const d = (await off.startRendering()).getChannelData(0);
      let peak = 0, all = 0, low = 0, lp = 0, last = 0;
      for (let i = 0; i < d.length; i++) {
        const v = d[i]; peak = Math.max(peak, Math.abs(v)); all += v * v;
        lp += (v - lp) * (2 * Math.PI * 200 / sr); low += lp * lp;
        if (Math.abs(v) > 0.01) last = i;
      }
      out[name] = { peak: +peak.toFixed(2), ms: Math.round(last / sr * 1000), low: +(low / (all || 1)).toFixed(2) };
    }
    actx = null;
    return out;
  }
  function curve(k) {
    if (curves[k]) return curves[k];
    const n = 1024, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = ((1 + k) * x) / (1 + k * Math.abs(x)); }
    return (curves[k] = c);
  }
  // 1 つの音: 発音体 → (歪み) → (フィルタ) → 音量の包絡 → 出力と残響へ
  function voice(src, { dur, vol, at = 0, attack = 0.002, dist = 0, filter, f0, f1, q = 0.8, wet = 0.15 }) {
    const t = actx.currentTime + at;
    let node = src;
    if (dist) { const w = actx.createWaveShaper(); w.curve = curve(dist); w.oversample = '4x'; node.connect(w); node = w; }
    if (filter) {
      const f = actx.createBiquadFilter(); f.type = filter; f.Q.value = q;
      f.frequency.setValueAtTime(f0, t);
      if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
      node.connect(f); node = f;
    }
    const g = actx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    node.connect(g); g.connect(master);
    if (wet) { const s = actx.createGain(); s.gain.value = wet; g.connect(s).connect(verbIn); }
    // ノイズは毎回違う所から鳴らす（同じノイズの繰り返しに聞こえないように）
    if (src.buffer) src.start(t, Math.random() * 1.5); else src.start(t);
    src.stop(t + dur + 0.05);
  }
  function osc(type, p0, p1, o) {
    const s = actx.createOscillator(), t = actx.currentTime + (o.at || 0);
    s.type = type; s.frequency.setValueAtTime(p0, t); s.frequency.exponentialRampToValueAtTime(p1, t + (o.bend || o.dur));
    voice(s, o);
  }
  function nz(o) {
    const s = actx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    voice(s, o);
  }
  const jit = (v, k = 0.06) => v * (1 + (Math.random() * 2 - 1) * k);
  function sfx(name) {
    if (!actx || muted || mode === 'title' || DEMO) return;
    switch (name) {
      case 'shoot': // 機関砲: 乾いた破裂 + 低い胴鳴り + 短い残響
        nz({ dur: 0.07, vol: 0.32, filter: 'bandpass', f0: jit(1600), f1: 500, q: 0.7, dist: 30, wet: 0.35 });
        osc('sine', jit(150), 42, { dur: 0.16, vol: 0.55, dist: 6, wet: 0.2 });
        osc('square', jit(85), 50, { dur: 0.06, vol: 0.12, filter: 'lowpass', f0: 900, dist: 20, wet: 0 });
        break;
      case 'eshoot': // 敵の砲: より低く、長い尾
        osc('sine', jit(95), 30, { dur: 0.3, vol: 0.45, dist: 8, wet: 0.25 });
        nz({ dur: 0.28, vol: 0.28, filter: 'lowpass', f0: 1400, f1: 250, dist: 12, wet: 0.3 });
        break;
      case 'hit': // 装甲に当たる金属音: 短いノイズ + 不協和な金属の鳴り
        nz({ dur: 0.05, vol: 0.2, filter: 'highpass', f0: 2200, dist: 8, wet: 0.1 });
        for (const f of [jit(523, 0.1), jit(1187, 0.1)]) osc('square', f, f * 0.94, { dur: 0.09, vol: 0.035, filter: 'bandpass', f0: f * 2, q: 4, wet: 0.15 });
        osc('sine', jit(220), 90, { dur: 0.06, vol: 0.18, dist: 4, wet: 0 });
        break;
      case 'boom': // 爆発: 歪んだ低音の轟き + 閉じていくノイズ + ぱちぱちと散る破片 + 長い残響
        osc('sine', jit(80), 22, { dur: 1.1, vol: 0.9, dist: 10, wet: 0.35, attack: 0.004 });
        nz({ dur: 1.3, vol: 0.55, filter: 'lowpass', f0: 2600, f1: 120, dist: 25, wet: 0.5, attack: 0.003 });
        nz({ dur: 0.12, vol: 0.4, filter: 'bandpass', f0: 900, q: 0.5, dist: 40, wet: 0.2 });
        for (let i = 0; i < 6; i++) nz({ at: 0.08 + Math.random() * 0.5, dur: 0.03, vol: 0.12, filter: 'highpass', f0: 1800, dist: 20, wet: 0.3 });
        break;
      case 'hurt': // 被弾: 機体を叩く鈍い衝撃 + 歪んだ警報の一声
        osc('sawtooth', 120, 38, { dur: 0.3, vol: 0.4, filter: 'lowpass', f0: 700, dist: 20, wet: 0.2 });
        nz({ dur: 0.16, vol: 0.35, filter: 'lowpass', f0: 1800, f1: 300, dist: 30, wet: 0.15 });
        osc('square', 380, 380, { at: 0.05, dur: 0.18, vol: 0.05, filter: 'bandpass', f0: 800, q: 2, dist: 5, wet: 0.1 });
        break;
      case 'dash': // 突撃: 噴射の轟音（帯域が上がっていくノイズ）+ 低い唸り + 踏み切りの衝撃
        osc('sine', 110, 40, { dur: 0.16, vol: 0.6, dist: 8, wet: 0.1 });
        nz({ dur: 0.38, vol: 0.4, filter: 'bandpass', f0: 280, f1: 2400, q: 0.9, dist: 18, wet: 0.25, attack: 0.02 });
        osc('sawtooth', 55, 110, { dur: 0.32, vol: 0.18, filter: 'lowpass', f0: 600, dist: 25, wet: 0.15 });
        break;
      case 'vent': // オーバーヒート: 金属のきしみ + 蒸気の噴出
        osc('square', 70, 60, { dur: 0.12, vol: 0.2, filter: 'lowpass', f0: 500, dist: 10, wet: 0.1 });
        nz({ at: 0.05, dur: 0.9, vol: 0.07, filter: 'highpass', f0: 3200, f1: 1500, attack: 0.03, wet: 0.2 });
        break;
      case 'ready': // 復帰: 機械の 2 回のかちり
        for (const at of [0, 0.07]) nz({ at, dur: 0.025, vol: 0.25, filter: 'bandpass', f0: 2600, q: 3, dist: 10, wet: 0.05 });
        osc('sine', 160, 120, { at: 0.07, dur: 0.08, vol: 0.2, wet: 0 });
        break;
      case 'pickup': // 修理: 工具の締め付け音
        osc('square', 180, 360, { dur: 0.22, vol: 0.06, filter: 'lowpass', f0: 1200, dist: 6, wet: 0.1 });
        nz({ at: 0.18, dur: 0.04, vol: 0.15, filter: 'bandpass', f0: 3000, q: 3, wet: 0.05 });
        break;
      case 'slam': // COLOSSUS の全方位弾: 地面を叩く重い衝撃
        osc('sine', 60, 18, { dur: 1.2, vol: 0.9, dist: 12, wet: 0.4 });
        nz({ dur: 0.9, vol: 0.5, filter: 'lowpass', f0: 700, f1: 80, dist: 20, wet: 0.45 });
        break;
      case 'wave': // ウェーブ開始: 歪んだ警報（2 音のずれたうなり）
        for (const f of [196, 207]) osc('sawtooth', f, f, { dur: 0.9, vol: 0.06, filter: 'lowpass', f0: 1100, dist: 8, wet: 0.3, attack: 0.05 });
        for (const f of [196, 207]) osc('sawtooth', f * 0.75, f * 0.75, { at: 0.45, dur: 0.8, vol: 0.05, filter: 'lowpass', f0: 900, dist: 8, wet: 0.3, attack: 0.05 });
        break;
      case 'step': // 自機の足音: 重い金属の着地
        osc('sine', jit(70), 35, { dur: 0.16, vol: 0.22, dist: 3, wet: 0.05 });
        nz({ dur: 0.05, vol: 0.06, filter: 'lowpass', f0: 600, wet: 0 });
        break;
    }
  }

  // ---------------- 入力 ----------------
  // キーボードだけで遊ぶ。照準 = 機体の向き（+ 前方の狭い範囲の敵へ軽く吸い付く）
  const keys = new Set();
  const GAME_KEYS = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyZ', 'KeyX', 'KeyC'];
  addEventListener('keydown', (e) => {
    initAudio();
    if (GAME_KEYS.includes(e.code)) e.preventDefault();
    keys.add(e.code);
    if (e.repeat) return;
    if (e.code === 'KeyX' || e.code === 'Space') wantDash = true;
    if (e.code === 'KeyM') muted = !muted;
    if (e.code === 'KeyC') setView(viewIdx + 1);
    if ((e.code === 'KeyR' || e.code === 'Enter') && mode === 'over') startGame();
    if (e.code === 'Enter' && mode === 'title') startGame();
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());
  $('start').addEventListener('click', () => { initAudio(); startGame(); });
  $('retry').addEventListener('click', () => { initAudio(); startGame(); });
  let wantDash = false;

  // ---------------- 世界 ----------------
  const cam = { x: 0, y: 0, a: 0 };
  let mode = DEMO ? 'demo' : 'title';
  let player, enemies, bullets, particles, pickups, spawns, obstacles;
  let wave, kills, queue, spawnTimer, intermission, banner, shake, deadTimer, time;

  // 戦場の障害物。小さい物（竜の歯・折れた柱）は半径 7、大きい物（土嚢の陣地・装甲車の残骸・ドラム缶）は半径 9.5 ボクセル
  const SMALL = { teeth: 1, stump: 1 };
  const OBSTACLES = [
    ['teeth', -450, -450], ['stump', 450, -450], ['stump', -450, 450], ['teeth', 450, 450],
    ['nest', -250, 162], ['drums', -294, 206], ['wreck', 288, -212], ['nest', -625, -75],
    ['wreck', 625, 188], ['drums', 575, 238], ['nest', -75, -550], ['wreck', 112, 562],
    ['drums', -562, 588], ['nest', 700, -650], ['teeth', 0, -775], ['stump', 0, 775],
  ];
  // 外周: 長さ 48 の区間を並べる（コンクリ障壁・縞入り・土嚢を 3 区間ずつ切り替え）。四隅に監視塔の残骸。
  // 外の景色: 当たり判定のない残骸や障害物（一人称視点で地平線までの距離感を出す）
  const WALLS = [], SCENERY = [];
  {
    const n = 38, L = (HALF * 2) / n, o = HALF + 4 * SC;
    for (let side = 0; side < 4; side++) {
      for (let i = 0; i < n; i++) {
        const t = -HALF + (i + 0.5) * L, kind = Math.floor(i / 3) % 3;
        const [x, y, a] = [[t, -o, 0], [o, t, Math.PI / 2], [-t, o, Math.PI], [-o, -t, -Math.PI / 2]][side];
        WALLS.push({ model: kind === 2 ? 'sandbags' : 'barrier', frame: kind === 1 ? 1 : 0, x, y, a });
      }
    }
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) WALLS.push({ model: 'tower', frame: 0, x: sx * (o + 10), y: sy * (o + 10), a: 0.3 });
    const kinds = ['wreck', 'teeth', 'stump', 'drums', 'teeth', 'wreck', 'nest', 'stump'];
    for (let i = 0; i < 26; i++) {
      const ang = (i / 26) * Math.PI * 2 + (i % 3) * 0.07, r = 1060 + ((i * 37) % 5) * 45;
      SCENERY.push({ model: kinds[i % kinds.length], x: Math.cos(ang) * r * 1.05, y: Math.sin(ang) * r * 1.05, a: i * 1.3 });
    }
  }

  function reset() {
    player = {
      x: 0, y: 60, a: -Math.PI / 2, r: 7 * SC, hp: 100, maxHp: 100, fireCd: 0, dashT: 0, heat: 0,
      dashDir: 0, inv: 0, walk: 0, hurt: 0, alive: true, strafe: 1, strafeT: 0, rammed: null, recoil: 0,
    };
    enemies = []; bullets = []; particles = []; pickups = []; spawns = [];
    obstacles = OBSTACLES.map(([m, x, y]) => ({ model: m, x, y, a: SMALL[m] ? rand(0, 1.5) : rand(-0.4, 0.4) + Math.floor(rand(0, 4)) * Math.PI / 2, r: SMALL[m] ? 7 * SC : 9.5 * SC }));
    wave = 0; kills = 0; queue = []; spawnTimer = 0; intermission = 1.2; banner = null; shake = 0; deadTimer = 0; time = 0;
    cam.x = player.x; cam.y = player.y;
  }

  function startGame() {
    reset();
    mode = 'play';
    $('title').hidden = true;
    $('over').hidden = true;
  }

  // ---------------- 視点と座標変換 ----------------
  // 視点は「床をどれだけ縦に縮めるか（k）」「高さ 1 あたり何 px 持ち上げるか（L）」「拡大率（Z）」「自機を画面のどの高さに置くか（cy）」で決まる。
  // k = 1, L = 1 が真上からの俯瞰。k を小さくすると床が寝て、斜めに見下ろす形になる（正射影のまま。遠近は付けない）。
  // follow の視点は、カメラが自機の背中側へ回り込み、機体の前方が常に画面の上になる。
  const VIEWS = [
    { id: 'top', name: '俯瞰', k: 1, L: 1, Z: 1, cy: 0.56, follow: false },
    // 一人称: 別の描画（fps.js）。k などは切り替えの途中（俯瞰との行き来）で使う値
    { id: 'cockpit', name: 'コックピット', k: 0.56, L: 1.2, Z: 1.2, cy: 0.7, follow: true, fps: true },
  ];
  let viewIdx = 0;
  try { viewIdx = Math.max(0, VIEWS.findIndex((v) => v.id === localStorage.getItem('stackbot-view-id'))); } catch (e) { /* 保存できない環境 */ }
  if (params.has('view')) viewIdx = clamp(VIEWS.findIndex((v) => v.id === params.get('view')), 0, VIEWS.length - 1);
  const view = { ...VIEWS[viewIdx] };   // いまの値（切り替え時はなめらかに近づける）
  let viewBanner = 0, switchFx = 0;
  function setView(i) {
    const was = VIEWS[viewIdx].fps;
    viewIdx = (i + VIEWS.length) % VIEWS.length; viewBanner = 1.6;
    if (was !== !!VIEWS[viewIdx].fps) switchFx = 0.35;   // 一人称への出入りは走査線で切り替える
    try { localStorage.setItem('stackbot-view-id', VIEWS[viewIdx].id); } catch (e) { /* 無視 */ }
  }
  function updateView(dt) {
    const T = VIEWS[viewIdx], k = Math.min(1, dt * 6);
    for (const f of ['k', 'L', 'Z', 'cy']) view[f] += (T[f] - view[f]) * k;
    view.follow = T.follow;
    viewBanner = Math.max(0, viewBanner - dt);
    switchFx = Math.max(0, switchFx - dt);
  }
  function camCenter() { return [VW / 2, VH * view.cy]; }
  function toScreen(wx, wy) {
    const [cx, cy] = camCenter(), dx = wx - cam.x, dy = wy - cam.y, c = Math.cos(cam.a), s = Math.sin(cam.a);
    return [cx + (dx * c + dy * s) * view.Z, cy + (-dx * s + dy * c) * view.Z * view.k];
  }
  const up = (z) => z * view.Z * view.L;   // 高さ z（ワールドの px）を画面の持ち上げ量へ
  function worldTransform(lift = 0) {
    const [cx, cy] = camCenter();
    ctx.setTransform(1, 0, 0, 1, cx, cy - up(lift));
    ctx.scale(view.Z, view.Z * view.k);
    ctx.rotate(-cam.a);
    ctx.translate(-cam.x, -cam.y);
  }

  // ---------------- 敵の種類 ----------------
  const TYPES = {
    scuttler: { r: 7 * SC, hp: 3, speed: 175, dmg: 12, score: 1, debris: ['#d6334a', '#3b2025', '#ffe14d'] },
    warden: { r: 8.5 * SC, hp: 6, speed: 95, dmg: 8, score: 2, debris: ['#e0812b', '#2b2b30', '#a3561a'] },
    colossus: { r: 13 * SC, hp: 22, speed: 70, dmg: 24, score: 5, debris: ['#7a4fd1', '#2f2a3d', '#ff4fd8'] },
  };

  function makeEnemy(type, x, y) {
    const T = TYPES[type];
    const hpScale = 1 + Math.floor((wave - 1) / 4) * 0.35;
    return {
      type, x, y, a: Math.atan2(player.y - y, player.x - x), r: T.r, hp: Math.ceil(T.hp * hpScale), flash: 0,
      walk: 0, cd: rand(1, 2), strafe: Math.random() < 0.5 ? -1 : 1, wob: rand(0, 6), vx: 0, vy: 0, charge: 0,
    };
  }

  function startWave(n) {
    wave = n;
    const list = [];
    const sc = Math.min(2 + n * 2, 18), wd = Math.min(Math.max(0, n - 1), 8), co = Math.min(Math.floor(n / 3), 4);
    for (let i = 0; i < sc; i++) list.push('scuttler');
    for (let i = 0; i < wd; i++) list.push('warden');
    for (let i = 0; i < co; i++) list.push('colossus');
    for (let i = list.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [list[i], list[j]] = [list[j], list[i]]; }
    queue = list; spawnTimer = 0.4;
    banner = { text: 'WAVE ' + n, sub: '敵 ' + list.length + ' 体', t: 2.2 };
    sfx('wave');
  }

  function freeSpot(minDist) {
    for (let tries = 0; tries < 40; tries++) {
      const x = rand(-HALF + 60, HALF - 60), y = rand(-HALF + 60, HALF - 60);
      if (Math.hypot(x - player.x, y - player.y) < minDist) continue;
      if (obstacles.some((o) => Math.hypot(o.x - x, o.y - y) < o.r + 40)) continue;
      return [x, y];
    }
    return [rand(-HALF + 60, HALF - 60), -HALF + 60];
  }

  // ---------------- 生成物 ----------------
  function fire(owner, x, y, a, speed, dmg, z, kind) {
    bullets.push({ owner, x, y, px: x, py: y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, dmg, z, life: owner === 'p' ? 0.9 : 3, kind });
  }
  function burst(x, y, z, n, colors, power = 1) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), s = rand(40, 220) * power;
      particles.push({ k: 'debris', x, y, z, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: rand(80, 320) * power,
        life: rand(0.6, 1.3), max: 1.3, col: colors[i % colors.length], size: rand(2, 5) });
    }
  }
  function sparks(x, y, z, n, col) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), s = rand(80, 260);
      particles.push({ k: 'spark', x, y, z, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: rand(0, 150), life: rand(0.15, 0.35), max: 0.35, col });
    }
  }
  function explosion(x, y, scale, colors) {
    burst(x, y, 16, Math.round(26 * scale), colors, Math.sqrt(scale));
    for (let i = 0; i < 8 * scale; i++) {
      particles.push({ k: 'smoke', x: x + rand(-12, 12) * scale, y: y + rand(-12, 12) * scale, z: rand(5, 25), vx: rand(-20, 20), vy: rand(-20, 20),
        vz: rand(20, 60), life: rand(0.6, 1.1), max: 1.1, size: rand(8, 16) * scale });
    }
    for (let i = 0; i < 7 * scale; i++) {
      particles.push({ k: 'fire', x: x + rand(-10, 10) * scale, y: y + rand(-10, 10) * scale, z: rand(6, 22), vx: rand(-30, 30), vy: rand(-30, 30),
        vz: rand(30, 90), life: rand(0.25, 0.5), max: 0.5, size: rand(7, 13) * scale });
    }
    particles.push({ k: 'ring', x, y, z: 0, life: 0.35, max: 0.35, size: 70 * scale });
    particles.push({ k: 'flash', x, y, z: 15, life: 0.12, max: 0.12, size: 40 * scale });
    shake = Math.max(shake, 6 * scale);
    sfx('boom');
  }

  // ---------------- 衝突 ----------------
  function collideWorld(e) {
    const lim = HALF - e.r;
    e.x = clamp(e.x, -lim, lim); e.y = clamp(e.y, -lim, lim);
    for (const o of obstacles) {
      const dx = e.x - o.x, dy = e.y - o.y, d = Math.hypot(dx, dy), min = e.r + o.r;
      if (d < min && d > 0.001) { e.x = o.x + (dx / d) * min; e.y = o.y + (dy / d) * min; }
    }
  }

  function hurtPlayer(dmg, fromX, fromY) {
    if (player.inv > 0 || !player.alive || mode !== 'play') return;
    player.hp -= dmg; player.inv = 0.55; player.hurt = 1; shake = Math.max(shake, 8);
    const a = Math.atan2(player.y - fromY, player.x - fromX);
    player.x += Math.cos(a) * 14; player.y += Math.sin(a) * 14;
    sparks(player.x, player.y, 20, 10, '#ff8a5c');
    sfx('hurt');
    if (player.hp <= 0) {
      player.hp = 0; player.alive = false; deadTimer = 1.6;
      explosion(player.x, player.y, 1.8, ['#1fa39a', '#e8eef2', '#7ff6ff', '#3a4252']);
    }
  }

  function killEnemy(e) {
    const T = TYPES[e.type];
    kills++;
    explosion(e.x, e.y, e.type === 'colossus' ? 1.8 : e.type === 'warden' ? 1.2 : 0.9, T.debris);
    const chance = e.type === 'colossus' ? 1 : e.type === 'warden' ? 0.25 : 0.1;
    if (Math.random() < chance) pickups.push({ x: e.x, y: e.y, t: 12, a: 0 });
  }

  // ---------------- 更新 ----------------
  function aiControl() {
    // タイトル画面・デモ用の自動操縦: 最も近い敵を狙い、距離を保って周回する
    let target = null, bd = 1e9;
    for (const e of enemies) { const d = Math.hypot(e.x - player.x, e.y - player.y); if (d < bd) { bd = d; target = e; } }
    let mx = 0, my = 0, aim = player.a, shoot = false;
    player.strafeT -= 1 / 60;
    if (player.strafeT <= 0) { player.strafe *= -1; player.strafeT = rand(1.5, 3); }
    if (target) {
      const a = Math.atan2(target.y - player.y, target.x - player.x);
      aim = a; shoot = bd < 650;
      const radial = bd > 340 ? 1 : bd < 250 ? -1 : 0;
      mx = Math.cos(a) * radial + Math.cos(a + Math.PI / 2) * player.strafe;
      my = Math.sin(a) * radial + Math.sin(a + Math.PI / 2) * player.strafe;
    }
    if (Math.abs(player.x) > HALF - 140) mx -= Math.sign(player.x) * 1.5;
    if (Math.abs(player.y) > HALF - 140) my -= Math.sign(player.y) * 1.5;
    return { mx, my, aim, shoot };
  }

  const DASH_T = 0.22, HEAT_T = 1.1, RAM_DMG = 4, ASSIST = 0.25, ASSIST_R = 720;

  function assistTarget(p) {
    let best = null, bd = ASSIST_R;
    for (const e of enemies) {
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d < bd && Math.abs(angDiff(p.a, Math.atan2(e.y - p.y, e.x - p.x))) < ASSIST) { bd = d; best = e; }
    }
    return best;
  }

  // 俯瞰: 矢印/WASD は画面の向き基準で移動し、機体は進む方向を向く。Shift を押している間は向きを固定（横歩き・後退撃ち）
  // 後ろからの視点: ↑↓ で前進・後退、←→ で旋回、Q / E で横歩き（画面の上が常に機体の前）
  function keyControl(p, dt) {
    if (view.follow) {
      const fw = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
      const turn = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
      const st = (keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0);
      if (p.dashT <= 0) p.a += turn * 2.7 * dt;
      const c = Math.cos(p.a), s = Math.sin(p.a);
      return { mx: c * fw - s * st, my: s * fw + c * st, aim: p.a };
    }
    const ix = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    const iy = (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0);
    const c = Math.cos(cam.a), s = Math.sin(cam.a);
    const mx = ix * c - iy * s, my = ix * s + iy * c;
    const lock = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const aim = (mx || my) && !lock ? Math.atan2(my, mx) : p.a;
    return { mx, my, aim };
  }

  function update(dt) {
    time += dt;
    const auto = mode !== 'play';

    // カメラ回転（Q/E）
    updateView(dt);
    if (!view.follow) {
      if (!auto) {
        if (keys.has('KeyQ')) cam.a -= 2.2 * dt;
        if (keys.has('KeyE')) cam.a += 2.2 * dt;
      } else cam.a += 0.12 * dt;
    }

    // ---- 自機 ----
    const p = player;
    if (p.alive) {
      let mx, my, aim, shoot;
      if (auto) ({ mx, my, aim, shoot } = aiControl());
      else {
        ({ mx, my, aim } = keyControl(p, dt));
        shoot = keys.has('KeyZ');
      }
      const ml = Math.hypot(mx, my);
      if (ml > 0) { mx /= ml; my /= ml; }
      // X: ダッシュ突撃。突進中は無敵で、ぶつかった敵に大ダメージ。終わるとオーバーヒート（射撃・ダッシュ不可、移動が遅い）
      if (wantDash && p.heat <= 0 && p.dashT <= 0 && !auto) {
        p.dashT = DASH_T; p.inv = Math.max(p.inv, DASH_T + 0.08); p.rammed = new Set();
        p.dashDir = ml > 0 ? Math.atan2(my, mx) : p.a;
        if (ml > 0) p.a = p.dashDir;
        sfx('dash');
      }
      wantDash = false;
      if (p.dashT > 0) {
        p.dashT -= dt;
        p.x += Math.cos(p.dashDir) * 980 * dt; p.y += Math.sin(p.dashDir) * 980 * dt;
        particles.push({ k: 'ghost', x: p.x, y: p.y, z: 0, a: p.a, life: 0.2, max: 0.2 });
        for (const e of enemies) {
          if (e.hp <= 0 || p.rammed.has(e) || Math.hypot(e.x - p.x, e.y - p.y) > e.r + p.r + 6) continue;
          p.rammed.add(e); e.hp -= RAM_DMG; e.flash = 0.12;
          const k = e.type === 'colossus' ? 120 : 420;
          e.vx += Math.cos(p.dashDir) * k; e.vy += Math.sin(p.dashDir) * k;
          sparks(e.x, e.y, 12 * SC, 16, '#ffd27a'); sfx('hit'); shake = Math.max(shake, 7);
          if (e.hp <= 0) killEnemy(e);
        }
        if (p.dashT <= 0) { p.heat = HEAT_T; sfx('vent'); }
      } else if (ml > 0) {
        const sp = p.heat > 0 ? 150 : 270;
        const w0 = p.walk;
        p.x += mx * sp * dt; p.y += my * sp * dt; p.walk += dt * (p.heat > 0 ? 5 : 9);
        if (Math.floor(w0 / 2) !== Math.floor(p.walk / 2)) sfx('step');   // 2 コマごとに 1 歩
      }
      if (p.heat > 0) {
        p.heat -= dt;
        if (p.heat <= 0) sfx('ready');
        if (Math.random() < dt * 30) particles.push({ k: 'steam', x: p.x + rand(-10, 10), y: p.y + rand(-10, 10), z: rand(14, 20) * SC,
          vx: rand(-15, 15), vy: rand(-15, 15), vz: rand(40, 90), life: rand(0.4, 0.8), max: 0.8, size: rand(4, 8) });
      }
      p.inv -= dt; p.hurt = Math.max(0, p.hurt - dt * 2.5); p.recoil = Math.max(0, p.recoil - dt * 8);
      if (p.dashT <= 0) p.a += angDiff(p.a, aim) * Math.min(1, dt * (auto ? 18 : 14));
      collideWorld(p);

      p.fireCd -= dt;
      if (shoot && p.fireCd <= 0 && p.heat <= 0 && p.dashT <= 0) {
        p.fireCd = 0.11; p.recoil = 1;
        const c = Math.cos(p.a), s = Math.sin(p.a);
        const mxp = p.x + c * 12 * SC - s * 7.5 * SC, myp = p.y + s * 12 * SC + c * 7.5 * SC;  // 右腕ライフルの銃口
        // 照準: 機体の正面。正面 ±14° 以内・720 以内の敵がいれば、いちばん近い敵へ弾を吸い付かせる
        let ba = p.a;
        if (!auto) {
          const t = assistTarget(p);
          if (t) ba = Math.atan2(t.y - myp, t.x - mxp);
        }
        fire('p', mxp, myp, ba + rand(-0.03, 0.03), 900, 1, 10.5 * SC);
        particles.push({ k: 'flash', x: mxp, y: myp, z: 10.5 * SC, life: 0.05, max: 0.05, size: 12 });
        sfx('shoot');
      }
    } else if (mode === 'play') {
      deadTimer -= dt;
      if (deadTimer <= 0) gameOver();
    }

    // ---- ウェーブ進行 ----
    if (intermission > 0) {
      intermission -= dt;
      if (intermission <= 0) startWave(wave + 1);
    } else {
      spawnTimer -= dt;
      if (queue.length && spawnTimer <= 0) {
        const [x, y] = freeSpot(450);
        spawns.push({ type: queue.shift(), x, y, t: 0.9 });
        spawnTimer = Math.max(0.25, 0.75 - wave * 0.04);
      }
      if (!queue.length && !spawns.length && !enemies.length && p.alive) {
        intermission = 2.4;
        p.hp = Math.min(p.maxHp, p.hp + 15);
        banner = { text: 'WAVE ' + wave + ' CLEAR', sub: '装甲 +15', t: 2 };
      }
    }
    for (const s of spawns) {
      s.t -= dt;
      if (s.t <= 0) { enemies.push(makeEnemy(s.type, s.x, s.y)); sparks(s.x, s.y, 4, 14, '#ff5470'); }
    }
    spawns = spawns.filter((s) => s.t > 0);
    if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }

    // ---- 敵 ----
    for (const e of enemies) {
      const T = TYPES[e.type];
      if (SCENE) { e.walk += dt * 6; e.flash -= dt; continue; }
      const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1, toP = Math.atan2(dy, dx);
      let mvx = 0, mvy = 0;
      e.flash -= dt; e.cd -= dt; e.recoil = Math.max(0, (e.recoil || 0) - dt * 6);
      if (e.type === 'scuttler') {
        const wob = Math.sin(time * 5 + e.wob) * 0.6;
        mvx = Math.cos(toP + wob); mvy = Math.sin(toP + wob);
        e.a += angDiff(e.a, toP + wob) * Math.min(1, dt * 10);
      } else if (e.type === 'warden') {
        if (Math.random() < dt * 0.3) e.strafe *= -1;
        const radial = d > 430 ? 1 : d < 300 ? -1 : 0;
        mvx = Math.cos(toP) * radial + Math.cos(toP + Math.PI / 2) * e.strafe * 0.7;
        mvy = Math.sin(toP) * radial + Math.sin(toP + Math.PI / 2) * e.strafe * 0.7;
        e.a += angDiff(e.a, toP) * Math.min(1, dt * 4);
        if (e.cd < 0.16 && e.cd > 0 && d < 720 && p.alive) e.flash = Math.max(e.flash, 0.02); // 撃つ直前に光る
        if (e.cd <= 0 && d < 720 && p.alive) {
          e.cd = rand(1.5, 2.3); e.recoil = 1;
          const c = Math.cos(e.a), s = Math.sin(e.a);
          for (const side of [-3 * SC, 3 * SC]) fire('e', e.x + c * 11 * SC - s * side, e.y + s * 11 * SC + c * side, e.a, 340, T.dmg, 10 * SC, 'orb');
          sfx('eshoot');
        }
      } else if (e.type === 'colossus') {
        if (e.charge > 0) {
          e.charge -= dt;
          if (e.charge <= 0) {
            for (let i = 0; i < 14; i++) fire('e', e.x, e.y, (i / 14) * Math.PI * 2 + e.a, 250, 10, 5 * SC, 'orb');
            particles.push({ k: 'ring', x: e.x, y: e.y, z: 0, life: 0.5, max: 0.5, size: 140 });
            shake = Math.max(shake, 5); sfx('slam');
          }
        } else {
          mvx = Math.cos(toP); mvy = Math.sin(toP);
          if (e.cd <= 0 && d < 560) { e.cd = rand(3.2, 4.2); e.charge = 0.7; }
        }
        e.a += angDiff(e.a, toP) * Math.min(1, dt * 2.5);
      }
      const sp = T.speed * (e.charge > 0 ? 0 : 1);
      e.x += (mvx * sp + e.vx) * dt; e.y += (mvy * sp + e.vy) * dt;
      e.vx *= Math.pow(0.02, dt); e.vy *= Math.pow(0.02, dt);
      if (mvx || mvy) e.walk += dt * (e.type === 'scuttler' ? 18 : 7);
      // 体当たり
      if (p.alive && d < e.r + p.r + 2 && e.type !== 'warden') {
        hurtPlayer(T.dmg, e.x, e.y);
        e.vx -= (dx / d) * 200; e.vy -= (dy / d) * 200;
      }
    }
    // 敵同士の押し合い
    for (let i = 0; i < enemies.length; i++) {
      for (let j = i + 1; j < enemies.length; j++) {
        const a = enemies[i], b = enemies[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), min = a.r + b.r;
        if (d < min && d > 0.01) {
          const push = (min - d) / 2, nx = dx / d, ny = dy / d;
          a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
        }
      }
    }
    for (const e of enemies) collideWorld(e);

    // ---- 弾 ----
    for (const b of bullets) {
      b.px = b.x; b.py = b.y;
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      if (Math.abs(b.x) > HALF || Math.abs(b.y) > HALF) { b.life = 0; sparks(b.x, b.y, b.z, 4, '#ffd27a'); continue; }
      for (const o of obstacles) {
        if (Math.hypot(b.x - o.x, b.y - o.y) < o.r + 3) { b.life = 0; sparks(b.x, b.y, b.z, 5, '#ffd27a'); break; }
      }
      if (b.life <= 0) continue;
      if (b.owner === 'p') {
        for (const e of enemies) {
          if (e.hp > 0 && Math.hypot(b.x - e.x, b.y - e.y) < e.r + 4) {
            b.life = 0; e.hp -= b.dmg; e.flash = 0.07;
            const k = e.type === 'colossus' ? 20 : 90;
            e.vx += (b.vx / 900) * k; e.vy += (b.vy / 900) * k;
            sparks(b.x, b.y, b.z, 6, '#7ff6ff'); sfx('hit');
            if (e.hp <= 0) killEnemy(e);
            break;
          }
        }
      } else if (p.alive && Math.hypot(b.x - p.x, b.y - p.y) < p.r + 5) {
        b.life = 0; hurtPlayer(b.dmg, b.x - b.vx, b.y - b.vy);
      }
    }
    bullets = bullets.filter((b) => b.life > 0);
    enemies = enemies.filter((e) => e.hp > 0);

    // ---- 回復アイテム ----
    for (const k of pickups) {
      k.t -= dt; k.a += dt * 2;
      if (p.alive && Math.hypot(k.x - p.x, k.y - p.y) < 32) {
        k.t = 0; p.hp = Math.min(p.maxHp, p.hp + 25); sfx('pickup');
        sparks(k.x, k.y, 10, 12, '#4dff88');
      }
    }
    pickups = pickups.filter((k) => k.t > 0);

    // ---- パーティクル ----
    for (const q of particles) {
      q.life -= dt;
      if (q.k === 'debris' || q.k === 'spark') {
        q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt; q.vz -= 700 * dt;
        if (q.z < 0) { q.z = 0; q.vz *= -0.35; q.vx *= 0.6; q.vy *= 0.6; }
      } else if (q.k === 'smoke' || q.k === 'steam' || q.k === 'fire') {
        q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      }
    }
    particles = particles.filter((q) => q.life > 0);
    if (particles.length > 900) particles.splice(0, particles.length - 900);

    // ---- カメラ ----
    if (view.follow) cam.a += angDiff(cam.a, p.a + Math.PI / 2) * Math.min(1, dt * 5);  // 機体の前 = 画面の上
    cam.x += (p.x - cam.x) * Math.min(1, dt * 6);
    cam.y += (p.y - cam.y) * Math.min(1, dt * 6);
    shake = Math.max(0, shake - dt * 30);

    // デモ中にやられた/全滅したら作り直す（自機は無敵ではないが、デモは被弾しない）
    if (auto && wave > 6 && !enemies.length && !queue.length) { reset(); }
  }

  function gameOver() {
    mode = 'over';
    const newBest = kills > best;
    if (newBest) { best = kills; try { localStorage.setItem('stackbot-best', String(best)); } catch (e) { /* 無視 */ } }
    $('over-kills').textContent = kills;
    $('over-wave').textContent = wave;
    $('over-best').textContent = best + (newBest ? '  NEW!' : '');
    $('over').hidden = false;
    reset();
    // 背景はデモとして動かし続ける
  }

  // ---------------- 描画 ----------------
  // 地面は field.js で作る（1 テクセル = 1 ボクセル = 3）。俯瞰でも一人称でも同じ絵を使う
  let ground = null;

  // 断面を下から 1 枚ずつ、回転 → 縦に k 倍 → 高さぶん持ち上げて描く。1 層の持ち上げ量ぶん同じ断面を重ねて隙間を埋める
  function drawStack(model, sx, sy, ang, lift = 0, alpha = 1) {
    const sl = model.slices, h = (model.size * model.res) / 2, Z = (view.Z * SC) / model.res, k = view.k;
    const c = Math.cos(ang), s = Math.sin(ang), step = up(SC), n = Math.max(1, Math.ceil(step));
    if (alpha < 1) ctx.globalAlpha = alpha;
    for (let i = 0; i < sl.length; i++) {
      const img = sl[i];
      if (!img) continue;
      for (let j = 0; j < n; j++) {
        ctx.setTransform(c * Z, s * Z * k, -s * Z, c * Z * k, sx, sy - up(lift) - i * step - (j * step) / n);
        ctx.drawImage(img, -h, -h);
      }
    }
    ctx.globalAlpha = 1;
  }

  function frameOf(name, walk) { const n = Models.frames(name); return ((Math.floor(walk) % n) + n) % n; }

  // 一人称の描画へ渡す状態
  const fpsState = {
    get player() { return player; }, get enemies() { return enemies; }, get obstacles() { return obstacles; },
    get bullets() { return bullets; }, get particles() { return particles; }, get pickups() { return pickups; },
    get spawns() { return spawns; }, get time() { return time; }, get shake() { return shake; }, get wave() { return wave; },
    get kills() { return kills; }, get best() { return best; }, get switchFx() { return switchFx / 0.35; },
    scenery: WALLS.concat(SCENERY), HEAT_T: 1.1, Models, assistTarget: (p) => assistTarget(p), frameOf: (n, w) => frameOf(n, w),
  };

  function draw() {
    if (VIEWS[viewIdx].fps) {
      FPS.render(ctx, VW, VH, fpsState);
      drawHud(true);
      return;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#2e2a34';
    ctx.fillRect(0, 0, VW, VH);

    const shx = rand(-shake, shake), shy = rand(-shake, shake);
    cam.x += shx; cam.y += shy;

    // 床
    worldTransform();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(ground.canvas, -ground.half, -ground.half, ground.half * 2, ground.half * 2);

    // 出現予告
    for (const s of spawns) {
      const k = 1 - s.t / 0.9;
      ctx.strokeStyle = `rgba(255,84,112,${0.4 + 0.5 * Math.sin(time * 30) ** 2})`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(s.x, s.y, 34 - k * 18, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(s.x - 10, s.y); ctx.lineTo(s.x + 10, s.y); ctx.moveTo(s.x, s.y - 10); ctx.lineTo(s.x, s.y + 10); ctx.stroke();
    }
    // 地面の衝撃波リング
    for (const q of particles) {
      if (q.k !== 'ring') continue;
      const k = 1 - q.life / q.max;
      ctx.strokeStyle = `rgba(255,220,180,${(1 - k) * 0.7})`; ctx.lineWidth = 4 * (1 - k) + 1;
      ctx.beginPath(); ctx.arc(q.x, q.y, q.size * k, 0, Math.PI * 2); ctx.stroke();
    }
    // COLOSSUS の溜め: 足元に縮んでいく桃色の輪（全方位の弾が来る合図）
    for (const e of enemies) {
      if (!(e.charge > 0)) continue;
      const k = e.charge / 0.7;
      ctx.strokeStyle = `rgba(255,79,216,${0.9 - k * 0.5})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 10 + k * 70, 0, Math.PI * 2); ctx.stroke();
    }
    // 影
    // 影: 光は左上から。右下へ伸ばした青紫の楕円
    ctx.fillStyle = 'rgba(20,14,34,0.45)';
    const shadow = (x, y, r) => { ctx.beginPath(); ctx.ellipse(x + 7, y + 7, r * 1.15, r * 0.8, Math.PI / 4, 0, Math.PI * 2); ctx.fill(); };
    for (const o of obstacles) shadow(o.x, o.y, o.r + 2);
    for (const o of SCENERY) shadow(o.x, o.y, 9 * SC);
    for (const e of enemies) shadow(e.x, e.y, e.r);
    if (player.alive) shadow(player.x, player.y, player.r);
    for (const b of bullets) shadow(b.x, b.y, 3);

    // 立体物を画面のY順に並べて描く
    const list = [];
    // 後ろからの視点では、自機より手前（画面の下）にあって自機に重なる障害物を半透明にする
    const [psx, psy] = toScreen(player.x, player.y);
    const onScreen = (sx, sy) => sx > -120 && sx < VW + 120 && sy > -160 && sy < VH + 160;
    for (const w of WALLS.concat(SCENERY)) {
      const [sx, sy] = toScreen(w.x, w.y);
      if (onScreen(sx, sy)) list.push({ sy, f: () => drawStack(Models.get(w.model, w.frame || 0, false, false, 0, Models.lightOf(w.a)), sx, sy, w.a - cam.a) });
    }
    for (const o of obstacles) {
      const [sx, sy] = toScreen(o.x, o.y);
      const cover = view.follow && player.alive && sy > psy && sy - psy < up(30 * SC) && Math.abs(sx - psx) < (o.r + player.r) * view.Z;
      list.push({ sy, f: () => drawStack(Models.get(o.model, 0, false, false, 0, Models.lightOf(o.a)), sx, sy, o.a - cam.a, 0, cover ? 0.35 : 1) });
    }
    for (const k of pickups) {
      if (k.t < 3 && Math.floor(k.t * 8) % 2) continue;
      const [sx, sy] = toScreen(k.x, k.y);
      list.push({ sy, f: () => drawStack(Models.get('repair'), sx, sy, k.a, 8 + Math.sin(k.a * 2) * 4) });
    }
    for (const e of enemies) {
      const [sx, sy] = toScreen(e.x, e.y);
      let ox = e.charge > 0 ? Math.sin(time * 60) * 1.5 : 0, oy = 0;
      if (e.type === 'scuttler') { ox += rand(-0.8, 0.8); oy += rand(-0.8, 0.8); }   // 突っ込むときの小刻みな震え
      if (e.recoil) { const k = e.recoil * 3; ox -= Math.cos(e.a - cam.a) * k; oy -= Math.sin(e.a - cam.a) * k; }
      list.push({ sy, f: () => drawStack(Models.get(e.type, frameOf(e.type, e.walk), e.flash > 0 || (e.charge > 0 && Math.sin(time * 40) > 0), false, 0, Models.lightOf(e.a)), sx + ox, sy + oy, e.a - cam.a) });
    }
    if (player.alive) {
      const [sx, sy] = toScreen(player.x, player.y);
      const blink = player.inv > 0 && player.dashT <= 0 && Math.floor(time * 20) % 2;
      const bob = Math.sin(time * 3) > 0.6 ? 1 : 0;           // 待機中の上下動（1px）
      const rk = player.recoil * 2.5, ra = player.a - cam.a;  // 射撃の反動
      const hot = player.heat > 0 && Math.floor(time * 8) % 2;  // オーバーヒート中は赤く点滅
      list.push({ sy, f: () => drawStack(Models.get('vanguard', frameOf('vanguard', player.walk), blink, hot, 0, Models.lightOf(player.a)), sx - Math.cos(ra) * rk, sy - Math.sin(ra) * rk, ra, bob) });
    }
    for (const q of particles) {
      if (q.k === 'ghost') {
        const [sx, sy] = toScreen(q.x, q.y);
        list.push({ sy: sy - 0.1, f: () => drawStack(Models.get('vanguard', 0, true, false, 0, Models.lightOf(q.a)), sx, sy, q.a - cam.a, 0, (q.life / q.max) * 0.35) });
      }
    }
    for (const b of bullets) {
      const [sx, sy] = toScreen(b.x, b.y);
      list.push({ sy: sy + 4, f: () => drawBullet(b, sx, sy) });
    }
    list.sort((a, b) => a.sy - b.sy);
    for (const it of list) it.f();

    // 粒子（上に重ねる）
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const q of particles) {
      if (q.k === 'ring' || q.k === 'ghost') continue;
      const [sx, sy0] = toScreen(q.x, q.y), sy = sy0 - up(q.z), k = q.life / q.max, Z = view.Z;
      if (q.k === 'debris') { ctx.fillStyle = q.col; ctx.fillRect(sx - q.size * Z / 2, sy - q.size * Z / 2, q.size * Z, q.size * Z); }
      else if (q.k === 'spark') { ctx.fillStyle = q.col; ctx.globalAlpha = k; ctx.fillRect(sx - 1.5, sy - 1.5, 3, 3); ctx.globalAlpha = 1; }
      else if (q.k === 'steam') {
        ctx.fillStyle = `rgba(220,230,240,${k * 0.35})`;
        ctx.beginPath(); ctx.arc(sx, sy, q.size * Z * (1.8 - k), 0, Math.PI * 2); ctx.fill();
      } else if (q.k === 'smoke') {
        ctx.fillStyle = `rgba(60,58,66,${k * 0.55})`;
        ctx.beginPath(); ctx.arc(sx, sy, q.size * Z * (1.6 - k * 0.6), 0, Math.PI * 2); ctx.fill();
      } else if (q.k === 'fire') {
        ctx.fillStyle = `rgba(255,${120 + k * 100 | 0},40,${k * 0.8})`;
        ctx.beginPath(); ctx.arc(sx, sy, q.size * Z * (0.5 + k * 0.5), 0, Math.PI * 2); ctx.fill();
      } else if (q.k === 'flash') {
        ctx.fillStyle = `rgba(255,240,200,${k})`;
        ctx.beginPath(); ctx.arc(sx, sy, q.size * Z * (0.6 + 0.4 * k), 0, Math.PI * 2); ctx.fill();
      }
    }

    cam.x -= shx; cam.y -= shy;
    drawHud();
  }

  function drawBullet(b, sx, sy) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const bz = up(b.z), Z = view.Z;
    if (b.owner === 'p') {
      const [px, py] = toScreen(b.px, b.py);
      ctx.strokeStyle = 'rgba(127,246,255,0.45)'; ctx.lineWidth = 6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(px, py - bz); ctx.lineTo(sx, sy - bz); ctx.stroke();
      ctx.strokeStyle = '#eaffff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(px, py - bz); ctx.lineTo(sx, sy - bz); ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(255,107,61,0.35)';
      ctx.beginPath(); ctx.arc(sx, sy - bz, 9 * Z, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ff6b3d';
      ctx.beginPath(); ctx.arc(sx, sy - bz, 5 * Z, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff1d6';
      ctx.beginPath(); ctx.arc(sx, sy - bz, 2.2 * Z, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawHud(fps = false) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const p = player;
    if (p.hurt > 0 && !fps) {
      const g = ctx.createRadialGradient(VW / 2, VH / 2, Math.min(VW, VH) * 0.3, VW / 2, VH / 2, Math.max(VW, VH) * 0.7);
      g.addColorStop(0, 'rgba(255,40,60,0)'); g.addColorStop(1, `rgba(255,40,60,${p.hurt * 0.45})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, VW, VH);
    }
    if (mode === 'title' || mode === 'over') return;
    const font = (px, w = 700) => `${w} ${px}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
    if (fps) { drawTexts(font, true); return; }   // 計器はコックピットの中に描いてある

    // 画面外の敵の方向
    for (const e of enemies) {
      const [sx, sy] = toScreen(e.x, e.y);
      if (sx > 0 && sx < VW && sy > 0 && sy < VH) continue;
      const cx = VW / 2, cy = VH / 2, a = Math.atan2(sy - cy, sx - cx);
      const m = 22, t = Math.min((cx - m) / Math.abs(Math.cos(a) || 1e-6), (cy - m) / Math.abs(Math.sin(a) || 1e-6));
      const x = cx + Math.cos(a) * t, y = cy + Math.sin(a) * t;
      ctx.setTransform(Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), x, y);
      ctx.fillStyle = e.type === 'colossus' ? '#ff4fd8' : e.type === 'warden' ? '#e0812b' : '#ff5470';
      ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-6, -7); ctx.lineTo(-6, 7); ctx.fill();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // 装甲ゲージ
    const bx = 20, by = 20, bw = Math.min(260, VW * 0.4);
    ctx.fillStyle = 'rgba(10,12,18,0.7)'; ctx.fillRect(bx - 6, by - 6, bw + 12, 54);
    ctx.font = font(12); ctx.fillStyle = '#9fb3c8'; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    ctx.fillText('ARMOR', bx, by);
    ctx.fillText(Math.ceil(p.hp) + ' / ' + p.maxHp, bx + 60, by);
    ctx.fillStyle = '#2a3145'; ctx.fillRect(bx, by + 17, bw, 10);
    const hpk = p.hp / p.maxHp;
    ctx.fillStyle = hpk > 0.5 ? '#1fd1c1' : hpk > 0.25 ? '#e3b23c' : '#ff5470';
    ctx.fillRect(bx, by + 17, bw * hpk, 10);
    const hot = p.heat > 0;
    ctx.font = font(10); ctx.fillStyle = hot ? '#ff8a5c' : '#9fb3c8';
    ctx.fillText(hot ? 'OVERHEAT' : 'RAM  [X]', bx, by + 32);
    ctx.fillStyle = '#2a3145'; ctx.fillRect(bx + 70, by + 34, 80, 5);
    ctx.fillStyle = hot ? (Math.floor(time * 10) % 2 ? '#ff5a3c' : '#ffb347') : '#7ff6ff';
    ctx.fillRect(bx + 70, by + 34, 80 * (hot ? p.heat / HEAT_T : 1), 5);

    // 撃破数とウェーブ
    ctx.textAlign = 'right';
    ctx.font = font(30, 800); ctx.fillStyle = '#e8eef2'; ctx.fillText(String(kills), VW - 20, 16);
    ctx.font = font(11); ctx.fillStyle = '#9fb3c8';
    ctx.fillText('KILLS', VW - 20, 50);
    ctx.fillText('WAVE ' + Math.max(1, wave) + '   BEST ' + best, VW - 20, 66);
    drawTexts(font, false);

    // 照準
    if (mode === 'play' && p.alive) {
      const t = assistTarget(p);
      let x, y;
      if (t) [x, y] = toScreen(t.x, t.y);
      else [x, y] = toScreen(p.x + Math.cos(p.a) * 200, p.y + Math.sin(p.a) * 200);
      y -= up(10.5 * SC);
      ctx.strokeStyle = t ? '#ffd27a' : 'rgba(127,246,255,0.7)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 15, y); ctx.lineTo(x - 5, y); ctx.moveTo(x + 5, y); ctx.lineTo(x + 15, y);
      ctx.moveTo(x, y - 15); ctx.lineTo(x, y - 5); ctx.moveTo(x, y + 5); ctx.lineTo(x, y + 15);
      ctx.stroke();
    }
  }

  // 視点の名前・バナー・操作ヒント（どの視点でも全解像度の文字で重ねる）
  function drawTexts(font, fps) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // 視点の名前（切り替えた直後は大きく）
    ctx.textAlign = 'right'; ctx.font = font(11); ctx.fillStyle = '#6b7a90';
    if (!fps) ctx.fillText('VIEW ' + VIEWS[viewIdx].name + '  [C]', VW - 20, VH - 30);
    if (viewBanner > 0) {
      ctx.textAlign = 'center'; ctx.globalAlpha = Math.min(1, viewBanner * 2);
      ctx.font = font(18, 800); ctx.fillStyle = '#7ff6ff';
      ctx.fillText('視点: ' + VIEWS[viewIdx].name, VW / 2, VH * 0.32);
      ctx.globalAlpha = 1;
    }

    // バナー
    if (banner) {
      const a = Math.min(1, banner.t * 2);
      ctx.textAlign = 'center'; ctx.globalAlpha = a;
      ctx.font = font(Math.min(44, VW / 12), 800); ctx.fillStyle = '#ffffff';
      ctx.fillText(banner.text, VW / 2, VH * 0.2);
      ctx.font = font(14); ctx.fillStyle = '#9fb3c8';
      ctx.fillText(banner.sub, VW / 2, VH * 0.2 + 52);
      ctx.globalAlpha = 1;
    }

    // 操作ヒント（最初のウェーブだけ）
    if (wave <= 1 && mode === 'play') {
      ctx.textAlign = 'left'; ctx.font = font(12, 400); ctx.fillStyle = 'rgba(159,179,200,0.8)';
      const hint = view.follow
        ? '↑↓ 前進・後退 / ←→ 旋回 / Q・E 横歩き / Z 射撃 / X ダッシュ突撃 / C 視点切替 / M 消音'
        : '矢印/WASD 移動 / Z 射撃（正面へ） / X ダッシュ突撃 / Shift 向き固定 / Q・E 視点回転 / C 視点切替 / M 消音';
      if (fps) { ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(200,215,230,0.85)'; ctx.fillText(hint, VW / 2, VH * 0.1); }
      else ctx.fillText(hint, 20, VH - 30);
    }

  }

  // ---------------- ループ ----------------
  ground = Field.ground(HALF);
  FPS.setGround(ground.canvas, ground.texel, ground.half);
  FPS.setSky(Field.SKY, Field.panorama());
  reset();
  if (DEMO) { $('title').hidden = true; }
  if (SCENE) {
    startGame();
    intermission = 1e9; player.x = 0; player.y = 300; player.a = -Math.PI / 2; cam.a = 0;
    for (const [t, dx, dy, a] of [['scuttler', -40, -150, 1.2], ['warden', 110, -260, 2.2], ['colossus', -120, -380, 1.4], ['scuttler', 60, -470, 2], ['warden', -260, -560, 0.6]]) {
      const e = makeEnemy(t, player.x + dx, player.y + dy); e.a = a; enemies.push(e);
    }
    if (params.has('fire')) keys.add('KeyZ');
  }
  document.body.classList.toggle('playing', false);
  // ?warp=秒 で開始直後にその秒数だけ進める（スクリーンショット確認用）
  // ?debug で状態を覗けるようにする（ヘッドレスでの動作確認用）
  if (params.has('debug')) {
    window.__stack = { get player() { return player; }, get enemies() { return enemies; }, get mode() { return mode; },
      get kills() { return kills; }, get wave() { return wave; }, get bullets() { return bullets; }, cam, VIEWS, view, get viewIdx() { return viewIdx; },
      spawn(type, dx, dy) { enemies.push(makeEnemy(type, player.x + dx, player.y + dy)); }, sfxTest };
  }
  const warp = +params.get('warp') || 0;
  for (let i = 0; i < warp * 60; i++) update(1 / 60);
  let last = performance.now();
  function loop(now) {
    const dt = Math.max(0, Math.min(0.033, (now - last) / 1000));
    last = now;
    document.body.classList.toggle('playing', mode === 'play');
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
