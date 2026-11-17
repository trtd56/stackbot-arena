// director.js — 録画用の自動操縦と演出の台本（record.html だけが読む。ゲーム本体には入らない）
// 操作はすべてキー入力（KeyboardEvent）で行う。ただし狙いを付けるため、機体の向き（player.a）だけは直接合わせる。
// 撮影の都合で装甲は一定以下に減らさない（倒されて終わらないように）。
'use strict';
(() => {
  const S = window.__stack, R = window.__rec;
  const params = new URLSearchParams(location.search);
  const HALF = 900, STEP = 1000 / 60;
  const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

  // ---- キー ----
  const held = new Set();
  const send = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, key: code, bubbles: true }));
  function setKeys(want) {
    for (const k of [...held]) if (!want.has(k)) { send('keyup', k); held.delete(k); }
    for (const k of want) if (!held.has(k)) { send('keydown', k); held.add(k); }
  }
  function tap(code) { send('keydown', code); send('keyup', code); }
  const isCockpit = () => !!S.VIEWS[S.viewIdx].fps;

  // ---- 自動操縦 ----
  const bot = { prefer: null, dash: false, strafe: 1, strafeT: 2, turnRate: 6, minHp: 45, range: [230, 380], hold: false };
  function pickTarget(p) {
    let best = null, bd = 1e9;
    for (const e of S.enemies) {
      if (e.hp <= 0) continue;
      let d = Math.hypot(e.x - p.x, e.y - p.y);
      if (bot.prefer && e.type === bot.prefer) d *= 0.25;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  function think(dt) {
    const p = S.player, want = new Set();
    if (!p || !p.alive) { setKeys(want); return; }
    p.hp = Math.max(p.hp, bot.minHp);
    const t = pickTarget(p);
    bot.strafeT -= dt;
    if (bot.strafeT <= 0) { bot.strafe *= -1; bot.strafeT = 1.4 + Math.random() * 1.6; }
    let fw = 0, st = 0;   // 機体基準の 前後・左右（+ が前・右）
    if (t) {
      const d = Math.hypot(t.x - p.x, t.y - p.y), ta = Math.atan2(t.y - p.y, t.x - p.x), err = angDiff(p.a, ta);
      if (p.dashT <= 0) p.a += err * Math.min(1, dt * bot.turnRate);
      if (Math.abs(err) < 0.18 && d < 700) want.add('KeyZ');
      if (!bot.hold) {
        fw = d > bot.range[1] ? 1 : d < bot.range[0] ? -1 : 0;
        st = bot.strafe;
      }
      if (bot.dash && p.heat <= 0 && p.dashT <= 0 && Math.abs(err) < 0.12 && d < 330) { tap('KeyX'); bot.dash = false; }
    }
    // 外周に寄りすぎたら内へ
    let wx = Math.cos(p.a) * fw - Math.sin(p.a) * st, wy = Math.sin(p.a) * fw + Math.cos(p.a) * st;
    if (Math.abs(p.x) > HALF - 160) wx -= Math.sign(p.x) * 1.5;
    if (Math.abs(p.y) > HALF - 160) wy -= Math.sign(p.y) * 1.5;
    if (isCockpit()) {
      // ↑↓ = 前後、Q/E = 横歩き（機体基準）
      const f = wx * Math.cos(p.a) + wy * Math.sin(p.a), r = -wx * Math.sin(p.a) + wy * Math.cos(p.a);
      if (f > 0.3) want.add('ArrowUp'); else if (f < -0.3) want.add('ArrowDown');
      if (r > 0.3) want.add('KeyE'); else if (r < -0.3) want.add('KeyQ');
    } else {
      // 俯瞰: Shift で向きを固定し、画面基準の矢印で動く
      want.add('ShiftLeft');
      const c = Math.cos(S.cam.a), s = Math.sin(S.cam.a);
      const sx = wx * c + wy * s, sy = -wx * s + wy * c;
      if (sx > 0.35) want.add('ArrowRight'); else if (sx < -0.35) want.add('ArrowLeft');
      if (sy > 0.35) want.add('ArrowDown'); else if (sy < -0.35) want.add('ArrowUp');
    }
    setKeys(want);
  }

  // ---- 演出 ----
  // 自機の前方 d・右へ r の位置に敵を出す
  function spawnAhead(type, d, r = 0) {
    const p = S.player, c = Math.cos(p.a), s = Math.sin(p.a);
    S.spawn(type, c * d - s * r, s * d + c * r);
  }
  function view(id) { if (S.VIEWS[S.viewIdx].id !== id) tap('KeyC'); }

  // 台本: [録画開始からの秒, 動作]。setup は録画開始の直前に行う
  const SHOTS = {
    // A: コックピットで突撃して始まり、俯瞰とコックピットを行き来しながら COLOSSUS を倒す
    A: {
      wave: 3, startView: 'cockpit',
      setup() {
        spawnAhead('scuttler', 170, 0); spawnAhead('scuttler', 260, -50); spawnAhead('scuttler', 300, 70); spawnAhead('scuttler', 470, -120);
        spawnAhead('warden', 560, 140);
      },
      cues: [
        [0.7, () => { bot.dash = true; }],
        [4.6, () => view('top')],
        [6.5, () => { spawnAhead('scuttler', 380, -150); spawnAhead('scuttler', 420, 150); spawnAhead('scuttler', 480, 0); }],
        [8.0, () => { bot.dash = true; }],
        [10.5, () => { bot.prefer = 'colossus'; }],
        [11.0, () => view('cockpit')],
        [13.5, () => { bot.dash = true; }],
        [17.0, () => view('top')],
        [17.5, () => { bot.prefer = null; spawnAhead('colossus', 420, 0); spawnAhead('scuttler', 350, -200); spawnAhead('scuttler', 350, 200); }],
        [20.5, () => { bot.dash = true; }],
        [23.0, () => view('cockpit')],
        [24.5, () => { bot.dash = true; }],
      ],
      length: 30,
    },
    // B: 俯瞰の大乱戦の爆発で始まり、コックピットで COLOSSUS と正面から撃ち合う
    B: {
      wave: 4, startView: 'top', center: [0, 120],
      setup() {
        bot.range = [160, 260];
        spawnAhead('scuttler', 150, 0); spawnAhead('scuttler', 190, -45); spawnAhead('scuttler', 190, 45);
        for (let i = 0; i < 4; i++) spawnAhead('scuttler', 290, (i - 1.5) * 80);
        spawnAhead('warden', 420, -160); spawnAhead('warden', 420, 160);
      },
      cues: [
        [0.9, () => { bot.dash = true; }],
        [3.4, () => { bot.dash = true; }],
        [5.5, () => { bot.range = [230, 380]; spawnAhead('colossus', 520, 0); bot.prefer = 'colossus'; }],
        [6.0, () => view('cockpit')],
        [9.0, () => { bot.dash = true; }],
        [12.5, () => view('top')],
        [13.0, () => { bot.prefer = null; for (let i = 0; i < 4; i++) spawnAhead('scuttler', 330, (i - 1.5) * 110); }],
        [15.0, () => { bot.dash = true; }],
        [18.0, () => view('cockpit')],
        [18.5, () => { spawnAhead('warden', 450, 60); spawnAhead('scuttler', 300, -80); }],
        [20.0, () => { bot.dash = true; }],
        [23.0, () => view('top')],
        [24.0, () => { bot.dash = true; }],
      ],
      length: 28,
    },
  };

  const shot = SHOTS[params.get('shot') || 'A'];
  let cue = 0, t0 = 0;
  function step() { think(STEP / 1000); R.step(STEP); }

  // 録画前: 開始して、指定のウェーブの始まりまで進める（画面は捨てる）
  R.presim = () => {
    tap('Enter');
    let n = 0;
    view('top');
    while (n < 60 * 120 && !(S.wave >= shot.wave)) { step(); n++; }
    view(shot.startView);
    if (shot.center) { S.player.x = shot.center[0]; S.player.y = shot.center[1]; }
    for (let i = 0; i < 60 * 2.2; i++) step();   // ウェーブと視点の表示が消えるまで
    shot.setup();
    for (let i = 0; i < 6; i++) step();
    t0 = R.t;
    return { t0, wave: S.wave, kills: S.kills };
  };
  // 1 コマぶん（per 回の 1/60 秒）進める。録画開始からの秒を返す
  R.frame = (per) => {
    for (let i = 0; i < per; i++) {
      const rt = R.t - t0;
      // 敵が尽きてウェーブが終わらないよう、少なくなったら近くに足す
      if (rt > 2 && S.enemies.length < 4 && Math.random() < 0.03) {
        const a = Math.random() * Math.PI * 2, p = S.player, d = 420 + Math.random() * 150;
        const x = Math.max(-750, Math.min(750, p.x + Math.cos(a) * d)) - p.x, y = Math.max(-750, Math.min(750, p.y + Math.sin(a) * d)) - p.y;
        S.spawn(Math.random() < 0.7 ? 'scuttler' : 'warden', x, y);
      }
      while (cue < shot.cues.length && shot.cues[cue][0] <= rt) shot.cues[cue++][1]();
      step();
    }
    return R.t - t0;
  };
  R.shot = shot;
  R.state = () => ({ t: R.t - t0, wave: S.wave, kills: S.kills, hp: S.player.hp, enemies: S.enemies.length, view: S.VIEWS[S.viewIdx].id });
})();
