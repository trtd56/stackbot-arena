// game.js — STACKBOT ARENA 本体
'use strict';

(() => {
  const SC = 3;                 // 1ボクセル = 3px。断面1枚を3回ずつ重ねて隙間を埋める
  const HALF = 900;             // アリーナの半径（正方形の半分）
  const WALL = 36;
  const params = new URLSearchParams(location.search);
  const DEMO = params.has('demo');

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

  // ---------------- 音（WebAudioで合成） ----------------
  let actx = null, muted = false, noiseBuf = null;
  function initAudio() {
    if (actx) return;
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      noiseBuf = actx.createBuffer(1, actx.sampleRate * 0.5, actx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { actx = null; }
  }
  function tone(type, f0, f1, dur, vol) {
    const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur);
  }
  function noise(dur, vol, freq) {
    const t = actx.currentTime, s = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
    s.buffer = noiseBuf; f.type = 'lowpass'; f.frequency.value = freq;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(actx.destination); s.start(t); s.stop(t + dur);
  }
  function sfx(name) {
    if (!actx || muted || mode === 'title' || DEMO) return;
    switch (name) {
      case 'shoot': tone('square', 900, 420, 0.06, 0.025); break;
      case 'eshoot': tone('sawtooth', 300, 160, 0.12, 0.03); break;
      case 'hit': noise(0.05, 0.08, 3000); break;
      case 'boom': noise(0.45, 0.25, 900); tone('sine', 120, 40, 0.4, 0.2); break;
      case 'hurt': tone('sawtooth', 220, 70, 0.25, 0.08); break;
      case 'dash': noise(0.18, 0.09, 6000); tone('sawtooth', 160, 520, 0.16, 0.05); break;
      case 'vent': noise(0.6, 0.05, 1800); break;
      case 'ready': tone('sine', 700, 1050, 0.08, 0.04); break;
      case 'pickup': tone('sine', 500, 1200, 0.2, 0.08); break;
      case 'slam': noise(0.5, 0.2, 400); break;
      case 'wave': tone('triangle', 440, 880, 0.3, 0.06); break;
    }
  }

  // ---------------- 入力 ----------------
  // キーボードだけで遊ぶ。照準 = 機体の向き（+ 前方の狭い範囲の敵へ軽く吸い付く）
  const keys = new Set();
  const GAME_KEYS = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyZ', 'KeyX'];
  addEventListener('keydown', (e) => {
    initAudio();
    if (GAME_KEYS.includes(e.code)) e.preventDefault();
    keys.add(e.code);
    if (e.repeat) return;
    if (e.code === 'KeyX' || e.code === 'Space') wantDash = true;
    if (e.code === 'KeyM') muted = !muted;
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

  const OBSTACLES = [
    ['pillar', -450, -450], ['pillar', 450, -450], ['pillar', -450, 450], ['pillar', 450, 450],
    ['crate', -250, 162], ['crate', -294, 206], ['crate', 288, -212], ['crate', -625, -75],
    ['crate', 625, 188], ['crate', 575, 238], ['crate', -75, -550], ['crate', 112, 562],
    ['crate', -562, 588], ['crate', 700, -650], ['pillar', 0, -775], ['pillar', 0, 775],
  ];

  function reset() {
    player = {
      x: 0, y: 60, a: -Math.PI / 2, r: 7 * SC, hp: 100, maxHp: 100, fireCd: 0, dashT: 0, heat: 0,
      dashDir: 0, inv: 0, walk: 0, hurt: 0, alive: true, strafe: 1, strafeT: 0, rammed: null, recoil: 0,
    };
    enemies = []; bullets = []; particles = []; pickups = []; spawns = [];
    obstacles = OBSTACLES.map(([m, x, y]) => ({ model: m, x, y, a: m === 'crate' ? rand(-0.4, 0.4) : 0, r: m === 'crate' ? 9.5 * SC : 7 * SC }));
    wave = 0; kills = 0; queue = []; spawnTimer = 0; intermission = 1.2; banner = null; shake = 0; deadTimer = 0; time = 0;
    cam.x = player.x; cam.y = player.y;
  }

  function startGame() {
    reset();
    mode = 'play';
    $('title').hidden = true;
    $('over').hidden = true;
  }

  // ---------------- 座標変換 ----------------
  function camCenter() { return [VW / 2, VH * 0.56]; }
  function toScreen(wx, wy) {
    const [cx, cy] = camCenter(), dx = wx - cam.x, dy = wy - cam.y, c = Math.cos(cam.a), s = Math.sin(cam.a);
    return [cx + dx * c + dy * s, cy - dx * s + dy * c];
  }
  function worldTransform(lift = 0) {
    const [cx, cy] = camCenter();
    ctx.setTransform(1, 0, 0, 1, cx, cy - lift);
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
  function keyControl(p, dt) {
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
    if (!auto) {
      if (keys.has('KeyQ')) cam.a -= 2.2 * dt;
      if (keys.has('KeyE')) cam.a += 2.2 * dt;
    } else cam.a += 0.12 * dt;

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
        p.x += mx * sp * dt; p.y += my * sp * dt; p.walk += dt * (p.heat > 0 ? 5 : 9);
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
        const mxp = p.x + c * 11 * SC - s * 7.5 * SC, myp = p.y + s * 11 * SC + c * 7.5 * SC;  // 右腕ライフルの銃口
        // 照準: 機体の正面。正面 ±14° 以内・720 以内の敵がいれば、いちばん近い敵へ弾を吸い付かせる
        let ba = p.a;
        if (!auto) {
          const t = assistTarget(p);
          if (t) ba = Math.atan2(t.y - myp, t.x - mxp);
        }
        fire('p', mxp, myp, ba + rand(-0.03, 0.03), 900, 1, 9.5 * SC);
        particles.push({ k: 'flash', x: mxp, y: myp, z: 9.5 * SC, life: 0.05, max: 0.05, size: 12 });
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
      const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1, toP = Math.atan2(dy, dx);
      let mvx = 0, mvy = 0;
      e.flash -= dt; e.cd -= dt;
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
        if (e.cd <= 0 && d < 720 && p.alive) {
          e.cd = rand(1.5, 2.3);
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
      } else if (q.k === 'smoke' || q.k === 'steam') {
        q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      }
    }
    particles = particles.filter((q) => q.life > 0);
    if (particles.length > 900) particles.splice(0, particles.length - 900);

    // ---- カメラ ----
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
  let floorCanvas = null;
  function buildFloor() {
    const S = HALF * 2, cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const c = cv.getContext('2d'), T = 80;
    for (let y = 0; y < S; y += T) {
      for (let x = 0; x < S; x += T) {
        c.fillStyle = ((x + y) / T) % 2 ? '#1c2130' : '#20263a';
        c.fillRect(x, y, T, T);
        c.fillStyle = '#2b3349';
        c.fillRect(x, y, T, 1); c.fillRect(x, y, 1, T);
        c.fillStyle = '#323b55';
        for (const [rx, ry] of [[6, 6], [T - 8, 6], [6, T - 8], [T - 8, T - 8]]) c.fillRect(x + rx, y + ry, 2, 2);
      }
    }
    // 汚れ・焦げ跡
    for (let i = 0; i < 40; i++) {
      c.fillStyle = `rgba(0,0,0,${rand(0.04, 0.1)})`;
      c.beginPath(); c.ellipse(rand(0, S), rand(0, S), rand(10, 50), rand(6, 30), rand(0, 3), 0, Math.PI * 2); c.fill();
    }
    // 中央の発進パッド
    c.strokeStyle = 'rgba(127,246,255,0.18)'; c.lineWidth = 4;
    c.beginPath(); c.arc(HALF, HALF, 110, 0, Math.PI * 2); c.stroke();
    c.lineWidth = 1; c.beginPath(); c.arc(HALF, HALF, 125, 0, Math.PI * 2); c.stroke();
    // 外周の警告ライン
    c.save();
    c.beginPath(); c.rect(0, 0, S, S); c.rect(40, 40, S - 80, S - 80); c.clip('evenodd');
    for (let i = -S; i < S * 2; i += 40) {
      c.fillStyle = 'rgba(227,178,60,0.22)';
      c.beginPath(); c.moveTo(i, 0); c.lineTo(i + 20, 0); c.lineTo(i + 20 - S, S); c.lineTo(i - S, S); c.fill();
    }
    c.restore();
    floorCanvas = cv;
  }

  function drawStack(model, sx, sy, ang, lift = 0, alpha = 1) {
    const sl = model.slices, h = model.size / 2, c = Math.cos(ang) * SC, s = Math.sin(ang) * SC;
    if (alpha < 1) ctx.globalAlpha = alpha;
    for (let i = 0; i < sl.length; i++) {
      const img = sl[i];
      if (!img) continue;
      for (let k = 0; k < SC; k++) {
        ctx.setTransform(c, s, -s, c, sx, sy - lift - (i * SC + k));
        ctx.drawImage(img, -h, -h);
      }
    }
    ctx.globalAlpha = 1;
  }

  function frameOf(name, walk) { const n = Models.frames(name); return Math.floor(walk) % n; }

  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#0a0c12';
    ctx.fillRect(0, 0, VW, VH);

    const shx = rand(-shake, shake), shy = rand(-shake, shake);
    cam.x += shx; cam.y += shy;

    // 床
    worldTransform();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(floorCanvas, -HALF, -HALF);
    ctx.imageSmoothingEnabled = false;

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
    // 影
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    const shadow = (x, y, r) => { ctx.beginPath(); ctx.arc(x + 3, y + 3, r, 0, Math.PI * 2); ctx.fill(); };
    for (const o of obstacles) shadow(o.x, o.y, o.r + 2);
    for (const e of enemies) shadow(e.x, e.y, e.r);
    if (player.alive) shadow(player.x, player.y, player.r);
    for (const b of bullets) shadow(b.x, b.y, 3);

    // 外周の壁（これも断面の積み重ね）
    for (let z = 0; z < WALL; z++) {
      worldTransform(z);
      const f = 0.55 + 0.45 * z / WALL;
      ctx.fillStyle = z === WALL - 1 ? '#8590ad' : `rgb(${50 * f | 0},${56 * f | 0},${74 * f | 0})`;
      const o = HALF + 26;
      ctx.fillRect(-o, -o, o * 2, 26); ctx.fillRect(-o, HALF, o * 2, 26);
      ctx.fillRect(-o, -HALF, 26, HALF * 2); ctx.fillRect(HALF, -HALF, 26, HALF * 2);
      if (z === WALL - 1) {
        ctx.fillStyle = '#e3b23c';
        ctx.fillRect(-HALF, -HALF - 3, HALF * 2, 3); ctx.fillRect(-HALF, HALF, HALF * 2, 3);
        ctx.fillRect(-HALF - 3, -HALF, 3, HALF * 2); ctx.fillRect(HALF, -HALF, 3, HALF * 2);
      }
    }

    // 立体物を画面のY順に並べて描く
    const list = [];
    for (const o of obstacles) { const [sx, sy] = toScreen(o.x, o.y); list.push({ sy, f: () => drawStack(Models.get(o.model), sx, sy, o.a - cam.a) }); }
    for (const k of pickups) {
      if (k.t < 3 && Math.floor(k.t * 8) % 2) continue;
      const [sx, sy] = toScreen(k.x, k.y);
      list.push({ sy, f: () => drawStack(Models.get('repair'), sx, sy, k.a, 8 + Math.sin(k.a * 2) * 4) });
    }
    for (const e of enemies) {
      const [sx, sy] = toScreen(e.x, e.y);
      const lift = e.charge > 0 ? Math.sin(time * 60) * 1.5 : 0;
      list.push({ sy, f: () => drawStack(Models.get(e.type, frameOf(e.type, e.walk), e.flash > 0 || (e.charge > 0 && Math.sin(time * 40) > 0)), sx + lift, sy, e.a - cam.a) });
    }
    if (player.alive) {
      const [sx, sy] = toScreen(player.x, player.y);
      const blink = player.inv > 0 && player.dashT <= 0 && Math.floor(time * 20) % 2;
      list.push({ sy, f: () => drawStack(Models.get('vanguard', frameOf('vanguard', player.walk), blink), sx, sy, player.a - cam.a) });
    }
    for (const q of particles) {
      if (q.k === 'ghost') {
        const [sx, sy] = toScreen(q.x, q.y);
        list.push({ sy: sy - 0.1, f: () => drawStack(Models.get('vanguard', 0, true), sx, sy, q.a - cam.a, 0, (q.life / q.max) * 0.35) });
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
      const [sx, sy0] = toScreen(q.x, q.y), sy = sy0 - q.z, k = q.life / q.max;
      if (q.k === 'debris') { ctx.fillStyle = q.col; ctx.fillRect(sx - q.size / 2, sy - q.size / 2, q.size, q.size); }
      else if (q.k === 'spark') { ctx.fillStyle = q.col; ctx.globalAlpha = k; ctx.fillRect(sx - 1.5, sy - 1.5, 3, 3); ctx.globalAlpha = 1; }
      else if (q.k === 'steam') {
        ctx.fillStyle = `rgba(220,230,240,${k * 0.35})`;
        ctx.beginPath(); ctx.arc(sx, sy, q.size * (1.8 - k), 0, Math.PI * 2); ctx.fill();
      } else if (q.k === 'smoke') {
        ctx.fillStyle = `rgba(60,58,66,${k * 0.55})`;
        ctx.beginPath(); ctx.arc(sx, sy, q.size * (1.6 - k * 0.6), 0, Math.PI * 2); ctx.fill();
      } else if (q.k === 'flash') {
        ctx.fillStyle = `rgba(255,240,200,${k})`;
        ctx.beginPath(); ctx.arc(sx, sy, q.size * (0.6 + 0.4 * k), 0, Math.PI * 2); ctx.fill();
      }
    }

    cam.x -= shx; cam.y -= shy;
    drawHud();
  }

  function drawBullet(b, sx, sy) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (b.owner === 'p') {
      const [px, py] = toScreen(b.px, b.py);
      ctx.strokeStyle = 'rgba(127,246,255,0.45)'; ctx.lineWidth = 6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(px, py - b.z); ctx.lineTo(sx, sy - b.z); ctx.stroke();
      ctx.strokeStyle = '#eaffff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(px, py - b.z); ctx.lineTo(sx, sy - b.z); ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(255,107,61,0.35)';
      ctx.beginPath(); ctx.arc(sx, sy - b.z, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ff6b3d';
      ctx.beginPath(); ctx.arc(sx, sy - b.z, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff1d6';
      ctx.beginPath(); ctx.arc(sx, sy - b.z, 2.2, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawHud() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const p = player;
    if (p.hurt > 0) {
      const g = ctx.createRadialGradient(VW / 2, VH / 2, Math.min(VW, VH) * 0.3, VW / 2, VH / 2, Math.max(VW, VH) * 0.7);
      g.addColorStop(0, 'rgba(255,40,60,0)'); g.addColorStop(1, `rgba(255,40,60,${p.hurt * 0.45})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, VW, VH);
    }
    if (mode === 'title' || mode === 'over') return;

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

    const font = (px, w = 700) => `${w} ${px}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
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
      ctx.fillText('矢印/WASD 移動 / Z 射撃（正面へ） / X ダッシュ突撃 / Shift 向き固定 / Q・E 視点回転 / M 消音', 20, VH - 30);
    }

    // 照準
    if (mode === 'play' && p.alive) {
      const t = assistTarget(p);
      let x, y;
      if (t) [x, y] = toScreen(t.x, t.y);
      else [x, y] = toScreen(p.x + Math.cos(p.a) * 200, p.y + Math.sin(p.a) * 200);
      y -= 9.5 * SC;
      ctx.strokeStyle = t ? '#ffd27a' : 'rgba(127,246,255,0.7)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 15, y); ctx.lineTo(x - 5, y); ctx.moveTo(x + 5, y); ctx.lineTo(x + 15, y);
      ctx.moveTo(x, y - 15); ctx.lineTo(x, y - 5); ctx.moveTo(x, y + 5); ctx.lineTo(x, y + 15);
      ctx.stroke();
    }
  }

  // ---------------- ループ ----------------
  buildFloor();
  reset();
  if (DEMO) { $('title').hidden = true; }
  document.body.classList.toggle('playing', false);
  // ?warp=秒 で開始直後にその秒数だけ進める（スクリーンショット確認用）
  // ?debug で状態を覗けるようにする（ヘッドレスでの動作確認用）
  if (params.has('debug')) {
    window.__stack = { get player() { return player; }, get enemies() { return enemies; }, get mode() { return mode; },
      get kills() { return kills; }, get wave() { return wave; }, get bullets() { return bullets; }, cam,
      spawn(type, dx, dy) { enemies.push(makeEnemy(type, player.x + dx, player.y + dy)); } };
  }
  const warp = +params.get('warp') || 0;
  for (let i = 0; i < warp * 60; i++) update(1 / 60);
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    document.body.classList.toggle('playing', mode === 'play');
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
