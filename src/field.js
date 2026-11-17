// field.js — 戦場の地面・空・遠景を手続きで作る。外部素材なし。
'use strict';

const Field = (() => {
  const rgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  // 座標から決まる乱数（毎回同じ景色になる）
  function hash(x, y, z = 0) {
    let n = (x * 73856093 ^ y * 19349663 ^ z * 83492791) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

  // ---- 空（一人称視点）: 夕暮れ。上は煙った紺、地平線に細い残照 ----
  const SKY = { top: rgb('#161b2e'), mid: rgb('#4a3f55'), haze: rgb('#4a4350') };

  // ---- 遠景: 360° のパノラマ（幅 1024、高さ 40）----
  // 奥: 低い丘と送電鉄塔（明るめの紫灰）、手前: 崩れた建物・折れた煙突・傾いたクレーン（暗い）、煙の柱 3 本
  function panorama() {
    const W = 1024, H = 48, cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    seed = 11;
    // 残照の帯
    c.fillStyle = 'rgba(217,138,78,0.55)'; c.fillRect(0, H - 4, W, 2);
    c.fillStyle = 'rgba(138,90,82,0.5)'; c.fillRect(0, H - 8, W, 4);
    // 太陽（つぶれた半円）
    c.fillStyle = '#ffd9a0'; c.fillRect(300, H - 6, 14, 3); c.fillRect(302, H - 8, 10, 2); c.fillRect(305, H - 9, 4, 1);
    // 奥の丘
    c.fillStyle = '#3a3548';
    for (let x = 0; x < W; x++) {
      const h = 7 + Math.sin(x * 0.012) * 3 + Math.sin(x * 0.037 + 1) * 2 + Math.sin(x * 0.11) * 0.8;
      c.fillRect(x, Math.round(H - h), 1, Math.ceil(h));
    }
    // 送電鉄塔
    for (let i = 0; i < 6; i++) {
      const x = 40 + i * 170 + rnd() * 40, h = 16 + rnd() * 4;
      for (let y = 0; y < h; y++) { const w = 1 + Math.round((y / h) * 4); c.fillRect(Math.round(x - w / 2), H - 8 - h + y, w, 1); }
      c.fillRect(x - 4, H - 8 - h + 3, 9, 1); c.fillRect(x - 3, H - 8 - h + 7, 7, 1);
    }
    // 手前の廃墟
    c.fillStyle = '#221f2b';
    let x = 0;
    while (x < W) {
      const w = 6 + Math.floor(rnd() * 22), h = 4 + Math.floor(rnd() * 18), gap = Math.floor(rnd() * 14);
      if (rnd() < 0.7) {
        c.fillRect(x, H - h, w, h);
        // 崩れた上辺（ぎざぎざ）
        for (let k = 0; k < w; k += 2) { const d = Math.floor(rnd() * 4); c.clearRect(x + k, H - h, 2, d); }
        // 窓の穴
        c.fillStyle = '#3a2e3a';
        for (let yy = H - h + 4; yy < H - 3; yy += 4) for (let xx = x + 2; xx < x + w - 2; xx += 4) if (rnd() < 0.35) c.fillRect(xx, yy, 1, 2);
        c.fillStyle = '#221f2b';
      }
      x += w + gap;
    }
    // 折れた煙突と傾いたクレーン
    c.fillRect(520, H - 30, 4, 30); c.fillRect(519, H - 30, 6, 2);
    c.fillRect(812, H - 34, 2, 34);
    for (let k = 0; k < 40; k++) c.fillRect(812 + k, H - 34 + Math.floor(k * 0.25), 1, 2);
    c.fillRect(850, H - 25, 1, 8);
    // 煙の柱（風下へ傾き、縁は市松のディザ）
    for (const sx of [180, 520, 760]) {
      for (let y = H - 2; y >= 0; y--) {
        const t = (H - y) / H, w = 4 + t * 26, cx = sx + t * t * 30;
        for (let xx = Math.floor(cx - w / 2); xx < cx + w / 2; xx++) {
          const edge = Math.min(xx - (cx - w / 2), cx + w / 2 - xx) < 3;
          if (edge && ((xx + y) & 1)) continue;
          if (hash(xx, y, sx) < 0.08 + t * 0.2) continue;
          c.fillStyle = y > H - 5 && sx !== 760 ? '#c2562a' : '#1c1a22';
          c.fillRect(xx, y, 1, 1);
        }
      }
    }
    return cv;
  }


  // ---- 地面: 1 テクセル = 3（= 1 ボクセル）。±1200 を覆い、アリーナ（±900）の外は霞の色へ寄せる ----
  const TEX = 3, GH = 1200, N = (GH * 2) / TEX;   // 800 x 800
  function vnoise(x, y, period, salt) {
    const gx = Math.floor(x / period), gy = Math.floor(y / period), fx = x / period - gx, fy = y / period - gy;
    const s = (t) => t * t * (3 - 2 * t), u = s(fx), v = s(fy);
    const a = hash(gx, gy, salt), b = hash(gx + 1, gy, salt), c = hash(gx, gy + 1, salt), d = hash(gx + 1, gy + 1, salt);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function ground(arenaHalf) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = N;
    const c = cv.getContext('2d'), img = c.createImageData(N, N), D = img.data;
    const col = new Array(N * N);
    seed = 3;
    // 1. 土（2 オクターブの値ノイズを 4 段に量子化）
    const DIRT = ['#2b2724', '#353029', '#3f3a31', '#4a4439'].map(rgb);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const n = vnoise(x, y, 64, 1) * 0.65 + vnoise(x, y, 16, 2) * 0.35 + (hash(x, y, 9) - 0.5) * 0.08;
      col[y * N + x] = DIRT[Math.max(0, Math.min(3, Math.floor((n - 0.2) * 6.5)))];
    }
    const set = (x, y, cc) => { x |= 0; y |= 0; if (x >= 0 && y >= 0 && x < N && y < N) col[y * N + x] = cc; };
    const C = N / 2, A = arenaHalf / TEX;
    // 2. ひび割れた舗装（中央を通る十字の道。ノイズの低い所だけ残る）と、縁の砂利
    const PAVE = rgb('#4a4d50'), PAVE2 = rgb('#5a5e61'), CRACK = rgb('#222324'), LINE = rgb('#b89a3a'), GRAV = [rgb('#6a655a'), rgb('#55504a')];
    const onRoad = (x, y) => Math.abs(x - C) < 35 || Math.abs(y - C) < 35;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (!onRoad(x, y)) continue;
      const n = vnoise(x, y, 24, 5);
      if (n < 0.45) col[y * N + x] = hash(x, y, 4) < 0.15 ? PAVE2 : PAVE;
      else if (n < 0.5 && hash(x, y, 6) < 0.3) col[y * N + x] = GRAV[hash(x, y, 7) < 0.5 ? 0 : 1];
      // 消えかけの中央線
      const mid = (Math.abs(x - C) < 1 && Math.abs(y - C) >= 35) || (Math.abs(y - C) < 1 && Math.abs(x - C) >= 35);
      if (mid && n < 0.45 && ((x + y) >> 3) % 2 && hash(x, y, 8) < 0.35 * 2) col[y * N + x] = LINE;
    }
    // ひび（折れ線）
    for (let i = 0; i < 120; i++) {
      let x = rnd() * N, y = rnd() * N;
      if (!onRoad(x, y)) continue;
      let a = rnd() * Math.PI * 2;
      for (let k = 0; k < 30 + rnd() * 20; k++) {
        if (col[(y | 0) * N + (x | 0)] === PAVE || col[(y | 0) * N + (x | 0)] === PAVE2) set(x, y, CRACK);
        if (k % 6 === 0) a += (rnd() - 0.5) * 1.6;
        x += Math.cos(a); y += Math.sin(a);
      }
    }
    // 3. 轍（2 本 1 組のゆるい曲線）
    const RUT = rgb('#221f1d'), RUTE = rgb('#4f483c');
    for (let i = 0; i < 5; i++) {
      let x = rnd() * N, y = rnd() * N, a = rnd() * Math.PI * 2;
      const turn = (rnd() - 0.5) * 0.01;
      for (let k = 0; k < 500; k++) {
        a += turn;
        const nx = -Math.sin(a), ny = Math.cos(a);
        for (const side of [-5, 5]) for (let w = -1; w <= 1; w++) {
          const px = x + nx * (side + w), py = y + ny * (side + w);
          set(px, py, Math.abs(w) === 1 ? RUTE : (k % 2 ? RUT : RUTE));
        }
        x += Math.cos(a); y += Math.sin(a);
      }
    }
    // 4. 焼け跡（縁は市松でぼかす。中心に残り火）
    const BURN = rgb('#171514'), EMBER = rgb('#c2562a');
    for (let i = 0; i < 22; i++) {
      const cx = rnd() * N, cy = rnd() * N, r = 6 + rnd() * 12;
      for (let y = cy - r; y < cy + r; y++) for (let x = cx - r; x < cx + r; x++) {
        const d = Math.hypot(x - cx, y - cy) / r + (vnoise(x, y, 6, 11) - 0.5) * 0.4;
        if (d < 0.75 || (d < 1 && ((x | 0) + (y | 0)) % 2 === 0 && d < 0.75 + hash(x | 0, y | 0, 12) * 0.25)) set(x, y, BURN);
      }
      for (let k = 0; k < 1 + rnd() * 3; k++) set(cx + (rnd() - 0.5) * 6, cy + (rnd() - 0.5) * 6, EMBER);
    }
    // 5. クレーター（底は暗く、左上の縁に影、右下の縁に光、外へ放射状の筋）
    const CB = rgb('#1c1917'), CI = rgb('#26221f'), CL = rgb('#6a614f'), CS = rgb('#55503f');
    for (let i = 0; i < 12; i++) {
      const cx = rnd() * N, cy = rnd() * N, r = 8 + rnd() * 18;
      for (let k = 0; k < 6 + rnd() * 4; k++) {
        const a = rnd() * Math.PI * 2, L = r * (1.4 + rnd() * 0.8);
        for (let t = r; t < L; t++) if (hash(t | 0, k, i) < 0.7) set(cx + Math.cos(a) * t, cy + Math.sin(a) * t, CS);
      }
      for (let y = cy - r - 2; y < cy + r + 2; y++) for (let x = cx - r - 2; x < cx + r + 2; x++) {
        const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy) / r;
        if (d < 0.55) set(x, y, CB);
        else if (d < 0.9) set(x, y, (dx + dy) < 0 ? CB : CI);
        else if (d < 1.12) set(x, y, (dx + dy) > 0 ? CL : CI);
      }
    }
    // 6. 水たまり（夕空を映す）
    const PU = rgb('#34405a'), PUE = rgb('#1e2433'), PUH = rgb('#8a5a52');
    for (let i = 0; i < 6; i++) {
      const cx = rnd() * N, cy = rnd() * N, rx = 5 + rnd() * 8, ry = 3 + rnd() * 4;
      for (let y = cy - ry - 1; y < cy + ry + 1; y++) for (let x = cx - rx - 1; x < cx + rx + 1; x++) {
        const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
        if (d < 0.7) set(x, y, (y | 0) === (cy | 0) - 1 && hash(x | 0, 1, 2) < 0.6 ? PUH : PU); else if (d < 1) set(x, y, PUE);
      }
    }
    // 7. 中央の発進パッド: 半分埋もれた鉄板の円（縁に水色）
    const PAD = rgb('#4d5258'), PADE = rgb('#5f8a90'), PADD = rgb('#3a3e44');
    for (let y = C - 40; y < C + 40; y++) for (let x = C - 40; x < C + 40; x++) {
      const d = Math.hypot(x - C, y - C), buried = vnoise(x, y, 10, 21) > 0.62;
      if (buried) continue;
      if (d < 34) set(x, y, ((x + y) % 12 === 0 || (x - y) % 12 === 0) ? PADD : PAD);
      else if (d < 36) set(x, y, PADE);
    }
    // 書き出し（アリーナの外は霞へ寄せる）
    const HZ = SKY.haze;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const [r, g, b] = col[y * N + x], o = (y * N + x) * 4;
      const out = Math.max(Math.abs(x - C), Math.abs(y - C)) - A;
      let t = out > 0 ? Math.min(0.6, out / 140) : 0;
      if (t > 0 && BAYER[(y & 3) * 4 + (x & 3)] / 16 < (t * 4) % 1) t = Math.min(0.6, t + 0.08);
      D[o] = r + (HZ[0] - r) * t; D[o + 1] = g + (HZ[1] - g) * t; D[o + 2] = b + (HZ[2] - b) * t; D[o + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    return { canvas: cv, texel: TEX, half: GH };
  }

  return { SKY, panorama, ground, hash, rgb, BAYER };
})();
