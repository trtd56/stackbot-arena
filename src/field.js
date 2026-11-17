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

  return { SKY, panorama, hash, rgb, BAYER };
})();
