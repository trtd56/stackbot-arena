// fps.js — 一人称（コックピット）視点の描画。
// 低解像度のバッファに、Mode 7 式の床（画面の行ごとに距離を求めて地面のテクスチャを引く）と、
// 距離で縮めた断面スタック（スプライトスタッキングの断面を、遠近に合わせて 1 枚ずつ縮めて重ねる）を描き、
// その上にコックピットの枠と計器を重ねてから、整数倍で画面へ拡大する。
'use strict';

const FPS = (() => {
  const SC = 3;
  const EYE = 13 * SC;          // 目の高さ = 胸のコックピット（ワールドの px）
  const NEAR = 14;              // これより近い物は描かない
  const FOG0 = 260, FOG1 = 2300; // 霧のかかり始めと、完全に霞む距離

  let lb = null, lctx = null, limg = null, l32 = null, LS = 3, LW = 0, LH = 0;
  const fc = { x: 0, y: 0, a: 0, c: 1, s: 0, f: 300, hz: 100 };

  // ---- 色 ----
  const pack = (r, g, b) => (255 << 24) | (b << 16) | (g << 8) | r;
  let SKY = null;               // { top, mid, haze } [r,g,b]

  function ensureBuffer(VW, VH) {
    const s = Math.max(2, Math.round(VH / 270));
    const w = Math.ceil(VW / s), h = Math.ceil(VH / s);
    if (lb && w === LW && h === LH && s === LS) return;
    LS = s; LW = w; LH = h;
    lb = lb || document.createElement('canvas');
    lb.width = w; lb.height = h;
    lctx = lb.getContext('2d');
    limg = lctx.createImageData(w, h);
    l32 = new Uint32Array(limg.data.buffer);
  }

  // ---- 地面のテクスチャ（ミップマップ付き）----
  // ground: { canvas, texel(ワールドの px / 1 テクセル), half(覆う範囲の半分) }
  let mips = null, gTexel = 2, gHalf = 1200;
  function setGround(canvas, texel, half) {
    gTexel = texel; gHalf = half;
    const w = canvas.width, h = canvas.height;
    const d = canvas.getContext('2d').getImageData(0, 0, w, h).data;
    let cur = { w, h, r: new Float32Array(w * h), g: new Float32Array(w * h), b: new Float32Array(w * h) };
    for (let i = 0; i < w * h; i++) { cur.r[i] = d[i * 4]; cur.g[i] = d[i * 4 + 1]; cur.b[i] = d[i * 4 + 2]; }
    mips = [];
    for (let lv = 0; lv < 5; lv++) {
      mips.push(cur);
      const nw = cur.w >> 1, nh = cur.h >> 1;
      const nx = { w: nw, h: nh, r: new Float32Array(nw * nh), g: new Float32Array(nw * nh), b: new Float32Array(nw * nh) };
      for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
        const a = (y * 2) * cur.w + x * 2, b = a + cur.w, o = y * nw + x;
        nx.r[o] = (cur.r[a] + cur.r[a + 1] + cur.r[b] + cur.r[b + 1]) / 4;
        nx.g[o] = (cur.g[a] + cur.g[a + 1] + cur.g[b] + cur.g[b + 1]) / 4;
        nx.b[o] = (cur.b[a] + cur.b[a + 1] + cur.b[b] + cur.b[b + 1]) / 4;
      }
      cur = nx;
    }
  }

  // ---- 遠景（360° のパノラマ）----
  let pano = null;
  function setSky(sky, panorama) { SKY = sky; pano = panorama; }

  // ---- 投影 ----
  // ワールドの点 (wx, wy, 高さ wz) → バッファ上の [x, y, 1 ワールド px あたりの拡大率, 奥行き]
  function proj(wx, wy, wz) {
    const dx = wx - fc.x, dy = wy - fc.y, z = dx * fc.c + dy * fc.s;
    if (z < NEAR) return null;
    const lat = -dx * fc.s + dy * fc.c, k = fc.f / z;
    return [LW / 2 + lat * k, fc.hz + (EYE - wz) * k, k, z];
  }
  const fogK = (z) => { const t = (z - FOG0) / (FOG1 - FOG0); return t <= 0 ? 0 : t >= 1 ? 1 : t; };
  const fogLevel = (z) => Math.min(4, Math.round(fogK(z) * 0.9 / 0.22));

  // ---- 床と空（ピクセル単位で書く）----
  function drawGroundSky() {
    const [hr, hg, hb] = SKY.haze, [tr, tg, tb] = SKY.top, [mr, mg, mb] = SKY.mid;
    const hz = fc.hz, hzi = Math.floor(hz);
    for (let y = 0; y < LH; y++) {
      const row = y * LW;
      if (y < hzi) {
        // 空: 上は暗い煙の色 → 地平線近くは霞の色
        const t = Math.min(1, (hz - y) / (LH * 0.42));
        let r, g, b;
        if (t > 0.35) { const u = (t - 0.35) / 0.65; r = mr + (tr - mr) * u; g = mg + (tg - mg) * u; b = mb + (tb - mb) * u; }
        else { const u = t / 0.35; r = hr + (mr - hr) * u; g = hg + (mg - hg) * u; b = hb + (mb - hb) * u; }
        // 4x4 の規則ディザで帯を目立たなくする
        const v = pack(r | 0, g | 0, b | 0), v2 = pack(Math.min(255, r + 3) | 0, Math.min(255, g + 3) | 0, Math.min(255, b + 3) | 0);
        for (let x = 0; x < LW; x++) l32[row + x] = ((x + y) & 3) === 0 && (y & 1) ? v2 : v;
        continue;
      }
      const dy = y - hz + 0.5, dist = EYE * fc.f / dy;
      const fk = fogK(dist);
      if (fk >= 1) { const v = pack(hr, hg, hb); for (let x = 0; x < LW; x++) l32[row + x] = v; continue; }
      const step = dist / fc.f;                          // 1 画素あたりのワールド px
      const lv = Math.max(0, Math.min(4, Math.floor(Math.log2(Math.max(1, step / gTexel * 1.2)))));
      const m = mips[lv], mw = m.w, mh = m.h, unit = gTexel * (1 << lv);
      // 行の左端のワールド座標と、右へ 1 画素進むぶんの差分
      const lat0 = (-LW / 2 + 0.5) * step;
      let wx = fc.x + fc.c * dist - fc.s * lat0, wy = fc.y + fc.s * dist + fc.c * lat0;
      const sx = -fc.s * step, sy = fc.c * step;
      const f1 = 1 - fk;
      const fr = hr * fk, fg = hg * fk, fb = hb * fk;
      for (let x = 0; x < LW; x++) {
        let u = Math.floor((wx + gHalf) / unit) % mw, v = Math.floor((wy + gHalf) / unit) % mh;
        if (u < 0) u += mw; if (v < 0) v += mh;
        const o = v * mw + u;
        l32[row + x] = pack((m.r[o] * f1 + fr) | 0, (m.g[o] * f1 + fg) | 0, (m.b[o] * f1 + fb) | 0);
        wx += sx; wy += sy;
      }
    }
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.putImageData(limg, 0, 0);
    // 遠景のシルエット（機体の向きに合わせて横に流れる）
    if (pano) {
      const k = (fc.f * Math.PI * 2) / pano.width;                       // 1 ラジアン = f 画素
      const pw = pano.width * k, ph = pano.height * k;
      let a = fc.a % (Math.PI * 2); if (a < 0) a += Math.PI * 2;
      let x0 = LW / 2 - (a / (Math.PI * 2)) * pw - pw / 2;
      while (x0 > 0) x0 -= pw;
      lctx.imageSmoothingEnabled = false;
      for (let x = x0; x < LW; x += pw) lctx.drawImage(pano, Math.round(x), Math.round(hz - ph + 1), Math.ceil(pw), Math.ceil(ph));
    }
  }

  // ---- 断面スタックを遠近で描く ----
  // 高さ h の断面は、目の高さとの差 (EYE - h) と奥行き z から、縦に (EYE - h) / z 倍につぶれて見える。
  // 目より上の断面は下から見上げることになるので、上から目の高さへ向けて逆順に描く（近い断面が手前に来る）。
  function drawStack(model, wx, wy, ang, lift = 0, alpha = 1) {
    const dx = wx - fc.x, dy = wy - fc.y, z = dx * fc.c + dy * fc.s;
    if (z < NEAR + 6) return;
    const lat = -dx * fc.s + dy * fc.c, k = fc.f / z, X = LW / 2 + lat * k;
    const sl = model.slices, h = model.size / 2, rad = model.size * SC * k;
    if (X < -rad || X > LW + rad) return;
    const r = ang - fc.a, cr = Math.cos(r), sr = Math.sin(r), Zs = k * SC;
    const step = SC * k, n = Math.min(14, Math.max(1, Math.ceil(step)));
    if (alpha < 1) lctx.globalAlpha = alpha;
    const one = (i) => {
      const img = sl[i];
      if (!img) return;
      const hb = lift + i * SC, kk = (EYE - (hb + SC / 2)) / z;
      const baseY = fc.hz + (EYE - hb) * k;
      for (let j = 0; j < n; j++) {
        lctx.setTransform(Zs * sr, -Zs * kk * cr, Zs * cr, Zs * kk * sr, X, baseY - (j * step) / n);
        lctx.drawImage(img, -h, -h);
      }
    };
    const eyeI = Math.floor((EYE - lift) / SC);
    for (let i = 0; i < sl.length && i <= eyeI; i++) one(i);
    for (let i = sl.length - 1; i > eyeI && i >= 0; i--) one(i);
    lctx.globalAlpha = 1;
    lctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // 地面の楕円（影・衝撃波・出現予告）
  function groundEllipse(wx, wy, r, fill, stroke, lw) {
    const P = proj(wx, wy, 0);
    if (!P) return;
    const [x, y, k, z] = P, rx = r * k, ry = r * k * Math.max(0.06, EYE / z);
    if (x + rx < 0 || x - rx > LW) return;
    lctx.beginPath(); lctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    if (fill) { lctx.fillStyle = fill; lctx.fill(); }
    if (stroke) { lctx.strokeStyle = stroke; lctx.lineWidth = Math.max(1, lw * k); lctx.stroke(); }
  }

  // ---- 小さなドットの文字（3x5）----
  const GL = {
    A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
    F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
    K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010',
    P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
    U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
    Z: '111001010100111', 0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110',
    4: '101101111001001', 5: '111100110001110', 6: '011100111101111', 7: '111001010010010', 8: '111101111101111',
    9: '111101111001110', '/': '001001010100100', ':': '000010000010000', '-': '000000111000000', '.': '000000000000010',
    '!': '010010010000010', '[': '110100100100110', ']': '011001001001011', '>': '100010001010100', '<': '001010100010001',
  };
  function text(str, x, y, col, s = 1, align = 'left') {
    str = String(str).toUpperCase();
    const w = str.length * 4 * s - s;
    if (align === 'right') x -= w; else if (align === 'center') x -= Math.floor(w / 2);
    lctx.fillStyle = col;
    for (let i = 0; i < str.length; i++) {
      const g = GL[str[i]];
      if (!g) continue;
      for (let p = 0; p < 15; p++) if (g[p] === '1') lctx.fillRect(Math.round(x + i * 4 * s + (p % 3) * s), Math.round(y + Math.floor(p / 3) * s), s, s);
    }
  }

  // ---- コックピット ----
  function poly(pts, col) {
    lctx.fillStyle = col; lctx.beginPath();
    pts.forEach(([x, y], i) => (i ? lctx.lineTo(x, y) : lctx.moveTo(x, y)));
    lctx.closePath(); lctx.fill();
  }
  const COL = {
    frame: '#23262d', frameHi: '#3a3f4a', frameLo: '#121418', bolt: '#4d5360', panel: '#191b20',
    glass: '#0c1410', glassEdge: '#2d3a34', ok: '#7ff6ff', warn: '#ffb347', bad: '#ff4a3c', dim: '#4c5a66', amber: '#e3b23c',
  };

  // 右腕のライフル（ガラスの外。反動で少し下がる）
  function drawGun(S) {
    const p = S.player, rc = p.recoil * 5, t = S.time;
    const bx = LW * 0.80 + rc * 0.6, by = LH * 0.74 + rc;
    const tipX = LW * 0.64 + rc * 0.9, tipY = LH * 0.585 + rc * 0.7;
    // 腕と銃身（台形を重ねる。上面を明るく、下面を暗く）
    poly([[LW + 4, LH * 0.66 + rc], [bx, by - 16], [bx + 10, by + 6], [LW + 4, LH * 0.95 + rc]], '#2a2f3a');
    poly([[bx - 6, by - 20], [tipX + 6, tipY - 6], [tipX + 8, tipY + 3], [bx + 6, by + 4]], '#3b4250');
    poly([[bx - 6, by - 20], [tipX + 6, tipY - 6], [tipX + 6, tipY - 3], [bx - 4, by - 14]], '#6b7486');
    poly([[bx - 2, by - 4], [tipX + 8, tipY + 1], [tipX + 8, tipY + 3], [bx + 6, by + 4]], '#1b1e25');
    poly([[tipX - 4, tipY - 5], [tipX + 9, tipY - 7], [tipX + 10, tipY + 4], [tipX - 3, tipY + 5]], '#4a5262');
    lctx.fillStyle = '#ffb347'; lctx.fillRect(Math.round(tipX - 4), Math.round(tipY - 1), 2, 3);
    // 白い装甲板
    poly([[bx + 2, by - 26], [bx + 30, by - 30], [bx + 34, by - 16], [bx + 4, by - 12]], '#c9d1da');
    poly([[bx + 4, by - 12], [bx + 34, by - 16], [bx + 34, by - 13], [bx + 5, by - 9]], '#7d8794');
    // 銃口炎
    if (p.recoil > 0.7) {
      const r = 6 + Math.random() * 6;
      lctx.fillStyle = 'rgba(255,200,120,0.85)'; lctx.beginPath(); lctx.arc(tipX - 6, tipY, r, 0, Math.PI * 2); lctx.fill();
      lctx.fillStyle = '#fff6dc'; lctx.beginPath(); lctx.arc(tipX - 6, tipY, r * 0.45, 0, Math.PI * 2); lctx.fill();
    }
    void t;
  }

  function drawCockpit(S) {
    const p = S.player, t = S.time;
    const W = LW, H = LH;
    const consoleY = Math.round(H * 0.79);
    // ガラスの汚れと反射（斜めの薄い帯）
    lctx.fillStyle = 'rgba(180,220,210,0.035)';
    poly([[W * 0.18, 0], [W * 0.27, 0], [W * 0.1, H], [W * 0.01, H]], 'rgba(180,220,210,0.035)');
    poly([[W * 0.31, 0], [W * 0.33, 0], [W * 0.16, H], [W * 0.14, H]], 'rgba(180,220,210,0.03)');

    // 上の梁（中央が少し下がる）
    const topH = Math.round(H * 0.07);
    poly([[0, 0], [W, 0], [W, topH + 6], [W * 0.62, topH], [W * 0.38, topH], [0, topH + 6]], COL.frame);
    poly([[0, topH + 4], [W * 0.38, topH - 2], [W * 0.62, topH - 2], [W, topH + 4], [W, topH + 6], [W * 0.62, topH], [W * 0.38, topH], [0, topH + 6]], COL.frameHi);
    // 左右の支柱（下へ向かって内側へ寄る）
    // 左右の支柱（画面の端に寄せた細い柱。内側の縁を明るく、青緑の配管を 1 本）
    const side0 = Math.round(H * 0.72);
    const pl = [[0, 0], [W * 0.05, 0], [W * 0.075, side0], [0, side0]];
    const pr = pl.map(([x, y]) => [W - x, y]);
    poly(pl, COL.frame); poly(pr, COL.frame);
    poly([[W * 0.045, topH], [W * 0.05, topH], [W * 0.075, side0], [W * 0.068, side0]], '#4a5670');
    poly([[W - W * 0.045, topH], [W - W * 0.05, topH], [W - W * 0.075, side0], [W - W * 0.068, side0]], '#4a5670');
    lctx.fillStyle = '#147069';
    for (let y = topH; y < side0; y++) { const t = y / side0; lctx.fillRect(Math.round(W * (0.02 + 0.02 * t)), y, 1, 1); lctx.fillRect(Math.round(W - W * (0.02 + 0.02 * t)), y, 1, 1); }
    // 上の梁の表示（ウェーブ・撃破数）
    text('WAVE ' + Math.max(1, S.wave), W * 0.4, 3, COL.amber, 1, 'center');
    text('KILLS ' + S.kills, W * 0.6, 3, COL.ok, 1, 'center');
    text('BEST ' + S.best, W - 6, 3, COL.dim, 1, 'right');

    // 計器盤（中央が低く、左右が少し高い）
    const cy0 = consoleY, side = Math.round(H * 0.72);
    poly([[0, side], [W * 0.075, side], [W * 0.3, cy0], [W * 0.7, cy0], [W * 0.925, side], [W, side], [W, H], [0, H]], COL.frame);
    poly([[0, side], [W * 0.075, side], [W * 0.3, cy0], [W * 0.7, cy0], [W * 0.925, side], [W, side], [W, side + 2], [W * 0.925, side + 2], [W * 0.7, cy0 + 2], [W * 0.3, cy0 + 2], [W * 0.075, side + 2], [0, side + 2]], '#4a5670');
    // 黄黒の警告縞（計器盤の縁）
    for (let x = Math.round(W * 0.3); x < W * 0.7; x += 8) {
      lctx.fillStyle = COL.amber; lctx.fillRect(x, cy0 + 3, 4, 2);
    }

    // 左の画面: 装甲
    const sW = Math.round(W * 0.2), sH = Math.round(H * 0.15);
    const lx = Math.round(W * 0.04), ly = H - sH - 6;
    screen(lx, ly, sW, sH);
    text('ARMOR', lx + 4, ly + 4, COL.dim);
    const hpk = p.hp / p.maxHp, hcol = hpk > 0.5 ? '#1fd1c1' : hpk > 0.25 ? COL.warn : COL.bad;
    text(String(Math.ceil(p.hp)).padStart(3, ' '), lx + sW - 4, ly + 4, hcol, 1, 'right');
    const segs = 10, gw = sW - 8, sgw = Math.floor((gw - (segs - 1)) / segs);
    for (let i = 0; i < segs; i++) {
      const on = hpk * segs > i + 0.01, blink = hpk <= 0.25 && Math.floor(t * 6) % 2;
      lctx.fillStyle = on ? (blink ? '#5a1a16' : hcol) : '#16211f';
      lctx.fillRect(lx + 4 + i * (sgw + 1), ly + 13, sgw, Math.max(4, sH - 30));
    }
    text(hpk <= 0.25 ? 'DANGER' : 'HULL OK', lx + 4, ly + sH - 9, hpk <= 0.25 ? COL.bad : COL.dim);

    // 右の画面: オーバーヒート / 突撃
    const rx = W - sW - Math.round(W * 0.04), ry = ly;
    screen(rx, ry, sW, sH);
    const hot = p.heat > 0;
    text(hot ? 'OVERHEAT' : 'RAM READY', rx + 4, ry + 4, hot ? (Math.floor(t * 8) % 2 ? COL.bad : COL.warn) : COL.ok);
    const hk = hot ? p.heat / S.HEAT_T : 0;
    lctx.fillStyle = '#16211f'; lctx.fillRect(rx + 4, ry + 13, sW - 8, Math.max(4, sH - 30));
    lctx.fillStyle = hot ? (Math.floor(t * 10) % 2 ? '#ff5a3c' : COL.warn) : '#1b4a55';
    lctx.fillRect(rx + 4, ry + 13, Math.round((sW - 8) * (hot ? hk : 1)), Math.max(4, sH - 30));
    text('HEAT', rx + 4, ry + sH - 9, COL.dim);
    text('[X]', rx + sW - 4, ry + sH - 9, COL.dim, 1, 'right');
    // 警告灯
    const lampOn = hot && Math.floor(t * 6) % 2;
    lctx.fillStyle = lampOn ? COL.bad : '#3a1512';
    lctx.fillRect(rx - 10, ry + 2, 6, 6);
    lctx.fillStyle = p.hurt > 0.2 ? COL.warn : '#3a2a12';
    lctx.fillRect(lx + sW + 4, ly + 2, 6, 6);

    // 中央: レーダー（前が上。半径 = 750）
    const R = Math.round(Math.min(H * 0.13, W * 0.09)), cx = Math.round(W / 2), cyR = H - R - 4;
    lctx.fillStyle = COL.frameLo; lctx.beginPath(); lctx.arc(cx, cyR, R + 3, 0, Math.PI * 2); lctx.fill();
    lctx.fillStyle = '#07120e'; lctx.beginPath(); lctx.arc(cx, cyR, R, 0, Math.PI * 2); lctx.fill();
    lctx.strokeStyle = '#163a2c'; lctx.lineWidth = 1;
    lctx.beginPath(); lctx.arc(cx, cyR, R * 0.5, 0, Math.PI * 2); lctx.stroke();
    lctx.beginPath(); lctx.moveTo(cx - R, cyR + 0.5); lctx.lineTo(cx + R, cyR + 0.5); lctx.moveTo(cx + 0.5, cyR - R); lctx.lineTo(cx + 0.5, cyR + R); lctx.stroke();
    // 視野の扇
    const half = Math.atan((LW / 2) / fc.f);
    lctx.fillStyle = 'rgba(127,246,255,0.08)';
    lctx.beginPath(); lctx.moveTo(cx, cyR); lctx.arc(cx, cyR, R, -Math.PI / 2 - half, -Math.PI / 2 + half); lctx.closePath(); lctx.fill();
    // 走査線
    const sw = (t * 2.4) % (Math.PI * 2);
    lctx.strokeStyle = 'rgba(77,255,136,0.35)';
    lctx.beginPath(); lctx.moveTo(cx, cyR); lctx.lineTo(cx + Math.cos(sw) * R, cyR + Math.sin(sw) * R); lctx.stroke();
    const RANGE = 750;
    const blip = (wx, wy, col, size) => {
      const dx = wx - p.x, dy = wy - p.y, depth = dx * fc.c + dy * fc.s, lat = -dx * fc.s + dy * fc.c;
      let bx = lat / RANGE * R, by = -depth / RANGE * R;
      const d = Math.hypot(bx, by);
      if (d > R - 2) { bx *= (R - 2) / d; by *= (R - 2) / d; }
      lctx.fillStyle = col; lctx.fillRect(Math.round(cx + bx - size / 2), Math.round(cyR + by - size / 2), size, size);
    };
    for (const s of S.spawns) if (Math.floor(t * 8) % 2) blip(s.x, s.y, '#ff5470', 2);
    for (const k of S.pickups) blip(k.x, k.y, '#4dff88', 2);
    for (const e of S.enemies) blip(e.x, e.y, e.type === 'colossus' ? '#ff4fd8' : e.type === 'warden' ? '#ff9a3c' : '#ff5470', e.type === 'colossus' ? 4 : 3);
    lctx.fillStyle = COL.ok; lctx.fillRect(cx - 1, cyR - 1, 2, 2);
    text('RADAR', cx, cyR - R - 9, COL.dim, 1, 'center');

    // 計器盤のボルト
    lctx.fillStyle = COL.bolt;
    for (const xx of [W * 0.02, W * 0.27, W * 0.73, W * 0.98]) lctx.fillRect(Math.round(xx), H - 4, 2, 2);
  }
  function screen(x, y, w, h) {
    lctx.fillStyle = COL.frameLo; lctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    lctx.fillStyle = COL.glass; lctx.fillRect(x, y, w, h);
    lctx.fillStyle = 'rgba(127,246,255,0.05)';
    for (let yy = y; yy < y + h; yy += 2) lctx.fillRect(x, yy, w, 1);   // 走査線
    lctx.fillStyle = COL.glassEdge; lctx.fillRect(x, y, w, 1);
  }

  // 照準: 中央の十字。前方の吸い付き先がいれば、その敵を囲む枠
  function drawReticle(S) {
    const p = S.player, cx = Math.round(LW / 2);
    const P = proj(p.x + Math.cos(p.a) * 320, p.y + Math.sin(p.a) * 320, 10.5 * SC);
    const cy = P ? Math.round(P[1]) : Math.round(fc.hz);
    const tgt = S.assistTarget(p);
    lctx.fillStyle = tgt ? '#ffd27a' : 'rgba(127,246,255,0.85)';
    lctx.fillRect(cx - 9, cy, 6, 1); lctx.fillRect(cx + 4, cy, 6, 1);
    lctx.fillRect(cx, cy - 7, 1, 4); lctx.fillRect(cx, cy + 4, 1, 4);
    lctx.fillRect(cx, cy, 1, 1);
    if (tgt) {
      const Q = proj(tgt.x, tgt.y, 0);
      if (Q) {
        const [x, , k] = Q, ht = { scuttler: 9, warden: 16, colossus: 28 }[tgt.type] * SC;
        const top = fc.hz + (EYE - ht) * k, bot = Q[1], half = Math.max(5, tgt.r * k * 1.1);
        const L = Math.max(3, Math.round(half * 0.4));
        lctx.fillStyle = '#ffd27a';
        const x0 = Math.round(x - half), x1 = Math.round(x + half), y0 = Math.round(top - 2), y1 = Math.round(bot + 2);
        for (const [ax, ay, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
          lctx.fillRect(sx > 0 ? ax : ax - L + 1, ay, L, 1);
          lctx.fillRect(ax, sy > 0 ? ay : ay - L + 1, 1, L);
        }
        text('LOCK', x1 + 3, y0, '#ffd27a');
      }
    }
  }

  // 視野の外にいる敵の方向（左右の端に矢印）
  function drawSideArrows(S) {
    const half = Math.atan((LW / 2) / fc.f);
    for (const e of S.enemies) {
      const dx = e.x - fc.x, dy = e.y - fc.y, d = Math.hypot(dx, dy);
      const rel = Math.atan2(-dx * fc.s + dy * fc.c, dx * fc.c + dy * fc.s);
      if (Math.abs(rel) < half * 0.95 || d > 900) continue;
      const right = rel > 0, x = right ? LW * 0.91 : LW * 0.09;
      const y = fc.hz + Math.max(-20, Math.min(30, (Math.abs(rel) - half) * 30));
      const col = e.type === 'colossus' ? '#ff4fd8' : e.type === 'warden' ? '#ff9a3c' : '#ff5470';
      if (d < 300 && Math.floor(S.time * 8) % 2) continue;
      const sx = right ? 1 : -1;
      poly([[x + sx * 6, y], [x - sx * 3, y - 7], [x - sx * 3, y - 3], [x + sx * 1, y], [x - sx * 3, y + 3], [x - sx * 3, y + 7]], col);
    }
  }

  // ---- 1 フレーム ----
  // S: ゲームの状態（player, enemies, ... と描画に要る関数）
  function render(ctx, VW, VH, S) {
    ensureBuffer(VW, VH);
    const p = S.player, M = S.Models;
    const dashing = p.dashT > 0;
    const fov = (78 + (dashing ? 12 : 0) + Math.min(6, S.shake * 0.4)) * Math.PI / 180;
    fc.f = (LW / 2) / Math.tan(fov / 2);
    const bob = p.alive ? Math.sin(p.walk * Math.PI) * 1.3 : 0;
    const sh = S.shake * 0.35;
    fc.a = p.a + (Math.random() - 0.5) * sh * 0.004;
    fc.c = Math.cos(fc.a); fc.s = Math.sin(fc.a);
    fc.x = p.x; fc.y = p.y;
    fc.hz = LH * 0.4 + bob + (Math.random() - 0.5) * sh;
    lctx.imageSmoothingEnabled = false;
    M.setFogColor(SKY.haze);

    drawGroundSky();

    // 地面に描くもの（影・輪・予告）
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const o of S.obstacles) groundEllipse(o.x + 6, o.y + 6, o.r + 2, 'rgba(0,0,0,0.3)');
    for (const e of S.enemies) groundEllipse(e.x, e.y, e.r, 'rgba(0,0,0,0.38)');
    for (const b of S.bullets) groundEllipse(b.x, b.y, 3, 'rgba(0,0,0,0.3)');
    for (const s of S.spawns) {
      const k = 1 - s.t / 0.9;
      groundEllipse(s.x, s.y, 34 - k * 18, null, `rgba(255,84,112,${0.4 + 0.5 * Math.sin(S.time * 30) ** 2})`, 3);
    }
    for (const q of S.particles) if (q.k === 'ring') { const k = 1 - q.life / q.max; groundEllipse(q.x, q.y, q.size * k, null, `rgba(255,220,180,${(1 - k) * 0.7})`, 4 * (1 - k) + 1); }
    for (const e of S.enemies) if (e.charge > 0) groundEllipse(e.x, e.y, e.r + 10 + (e.charge / 0.7) * 70, null, `rgba(255,79,216,${0.9 - (e.charge / 0.7) * 0.5})`, 3);

    // 立体物と粒子を奥から手前へ
    const list = [];
    const depth = (x, y) => (x - fc.x) * fc.c + (y - fc.y) * fc.s;
    const add = (x, y, f) => { const z = depth(x, y); if (z > NEAR) list.push({ z, f }); };
    for (const o of S.scenery) add(o.x, o.y, () => drawStack(M.get(o.model, 0, false, false, fogLevel(depth(o.x, o.y))), o.x, o.y, o.a));
    for (const o of S.obstacles) add(o.x, o.y, () => drawStack(M.get(o.model, 0, false, false, fogLevel(depth(o.x, o.y))), o.x, o.y, o.a));
    for (const k of S.pickups) {
      if (k.t < 3 && Math.floor(k.t * 8) % 2) continue;
      add(k.x, k.y, () => drawStack(M.get('repair'), k.x, k.y, k.a, 8 + Math.sin(k.a * 2) * 4));
    }
    for (const e of S.enemies) {
      add(e.x, e.y, () => {
        let ox = 0, oy = 0;
        if (e.type === 'scuttler') { ox += (Math.random() - 0.5) * 1.6; oy += (Math.random() - 0.5) * 1.6; }
        if (e.recoil) { ox -= Math.cos(e.a) * e.recoil * 3; oy -= Math.sin(e.a) * e.recoil * 3; }
        const fl = e.flash > 0 || (e.charge > 0 && Math.sin(S.time * 40) > 0);
        drawStack(M.get(e.type, S.frameOf(e.type, e.walk), fl, false, fl ? 0 : fogLevel(depth(e.x, e.y))), e.x + ox, e.y + oy, e.a);
      });
    }
    for (const b of S.bullets) add(b.x, b.y, () => drawBullet(b));
    for (const q of S.particles) if (q.k !== 'ring' && q.k !== 'ghost') add(q.x, q.y, () => drawParticle(q));
    list.sort((a, b) => b.z - a.z);
    for (const it of list) it.f();
    lctx.setTransform(1, 0, 0, 1, 0, 0);

    // 突撃中の流れる線
    if (dashing) {
      lctx.strokeStyle = 'rgba(220,250,255,0.5)'; lctx.lineWidth = 1;
      for (let i = 0; i < 26; i++) {
        const a = Math.random() * Math.PI * 2, r0 = LW * (0.25 + Math.random() * 0.2), r1 = r0 + LW * 0.2;
        lctx.beginPath(); lctx.moveTo(LW / 2 + Math.cos(a) * r0, fc.hz + Math.sin(a) * r0 * 0.6);
        lctx.lineTo(LW / 2 + Math.cos(a) * r1, fc.hz + Math.sin(a) * r1 * 0.6); lctx.stroke();
      }
    }
    if (p.alive) { drawReticle(S); drawSideArrows(S); drawGun(S); }
    // オーバーヒートの蒸気（ガラスの下の方に白い靄）
    if (p.heat > 0) {
      for (let i = 0; i < 10; i++) {
        const x = ((i * 97 + S.time * 40 * (i % 2 ? 1 : -1)) % LW + LW) % LW, y = LH * 0.6 + Math.sin(S.time * 3 + i) * 8;
        lctx.fillStyle = `rgba(230,236,240,${0.08 * (p.heat / S.HEAT_T)})`;
        lctx.beginPath(); lctx.arc(x, y, 16 + (i % 3) * 6, 0, Math.PI * 2); lctx.fill();
      }
    }
    drawCockpit(S);
    // 被弾: 赤い明滅と、画面の横ずれ（ノイズ）
    if (p.hurt > 0) {
      lctx.fillStyle = `rgba(255,40,40,${p.hurt * 0.25})`; lctx.fillRect(0, 0, LW, LH);
      for (let i = 0; i < 6 * p.hurt; i++) {
        const y = Math.random() * LH, h = 1 + Math.random() * 3;
        lctx.drawImage(lb, 0, y, LW, h, (Math.random() - 0.5) * 16 * p.hurt, y, LW, h);
      }
    }
    if (!p.alive) {
      // 撃破: 砂嵐と「信号喪失」
      const img = lctx.getImageData(0, 0, LW, LH), d = img.data;
      for (let i = 0; i < d.length; i += 4) { const v = Math.random() * 200; d[i] = d[i] * 0.3 + v; d[i + 1] = d[i + 1] * 0.3 + v; d[i + 2] = d[i + 2] * 0.3 + v; }
      lctx.putImageData(img, 0, 0);
      text('SIGNAL LOST', LW / 2, LH * 0.4, '#ff5470', 2, 'center');
    }
    if (S.switchFx > 0) {
      lctx.fillStyle = `rgba(200,255,240,${S.switchFx * 0.5})`;
      for (let y = 0; y < LH; y += 2) lctx.fillRect(0, y, LW, 1);
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(lb, 0, 0, LW * LS, LH * LS);
  }

  function drawBullet(b) {
    const A = proj(b.x, b.y, b.z);
    if (!A) return;
    const [x, y, k] = A;
    if (b.owner === 'p') {
      if (A[3] < 70) return;   // 銃口のすぐ前は描かない（画面を覆うため）
      const B = proj(b.px - b.vx * 0.012, b.py - b.vy * 0.012, b.z);
      const [x0, y0] = B || [x, y];
      lctx.lineCap = 'round';
      lctx.strokeStyle = 'rgba(255,190,90,0.55)'; lctx.lineWidth = Math.min(4, Math.max(1.5, 5 * k));
      lctx.beginPath(); lctx.moveTo(x0, y0); lctx.lineTo(x, y); lctx.stroke();
      lctx.strokeStyle = '#fff4d6'; lctx.lineWidth = Math.min(1.6, Math.max(1, 1.8 * k));
      lctx.beginPath(); lctx.moveTo(x0, y0); lctx.lineTo(x, y); lctx.stroke();
    } else {
      const r = Math.max(1.5, 5 * k);
      lctx.fillStyle = 'rgba(255,107,61,0.35)'; lctx.beginPath(); lctx.arc(x, y, r * 1.9, 0, Math.PI * 2); lctx.fill();
      lctx.fillStyle = '#ff6b3d'; lctx.beginPath(); lctx.arc(x, y, r, 0, Math.PI * 2); lctx.fill();
      lctx.fillStyle = '#fff1d6'; lctx.beginPath(); lctx.arc(x, y, r * 0.45, 0, Math.PI * 2); lctx.fill();
    }
  }

  function drawParticle(q) {
    const A = proj(q.x, q.y, q.z);
    if (!A) return;
    const [x, y, k0, z] = A, l = q.life / q.max;
    if (z < 60 && (q.k === 'flash' || q.k === 'smoke' || q.k === 'steam')) return;   // 目の前の煙や閃光は視界をふさぐので描かない
    const k = Math.min(k0, 4);
    if (q.k === 'debris') { const s = Math.max(1, q.size * k); lctx.fillStyle = q.col; lctx.fillRect(x - s / 2, y - s / 2, s, s); }
    else if (q.k === 'spark') { lctx.globalAlpha = l; lctx.fillStyle = q.col; const s = Math.max(1, 2.5 * k); lctx.fillRect(x - s / 2, y - s / 2, s, s); lctx.globalAlpha = 1; }
    else if (q.k === 'steam') { lctx.fillStyle = `rgba(220,230,240,${l * 0.3})`; lctx.beginPath(); lctx.arc(x, y, q.size * k * (1.8 - l), 0, Math.PI * 2); lctx.fill(); }
    else if (q.k === 'smoke') { lctx.fillStyle = `rgba(52,48,50,${l * 0.6})`; lctx.beginPath(); lctx.arc(x, y, q.size * k * (1.6 - l * 0.6), 0, Math.PI * 2); lctx.fill(); }
    else if (q.k === 'fire') { lctx.fillStyle = `rgba(255,${120 + l * 100 | 0},40,${l * 0.8})`; lctx.beginPath(); lctx.arc(x, y, q.size * k * (0.5 + l * 0.5), 0, Math.PI * 2); lctx.fill(); }
    else if (q.k === 'flash') { lctx.fillStyle = `rgba(255,240,200,${l})`; lctx.beginPath(); lctx.arc(x, y, q.size * k * (0.6 + 0.4 * l), 0, Math.PI * 2); lctx.fill(); }
  }

  return { render, setGround, setSky, EYE };
})();
