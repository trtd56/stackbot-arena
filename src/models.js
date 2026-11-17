// models.js — ボクセル風の部品定義から、スプライトスタッキング用の「水平断面の絵」を生成する。
// 外部素材は使わず、すべてコードで描く。
// 座標: x = 前方(+), y = 右(+), z = 高さ(0 = 地面)。部品の範囲は [from, to) の半開区間。
'use strict';

const Models = (() => {
  const hexCache = {};
  function hex(c) {
    if (hexCache[c]) return hexCache[c];
    const n = parseInt(c.slice(1), 16);
    return (hexCache[c] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]);
  }

  // 部品ヘルパー
  const box = (x0, x1, y0, y1, z0, z1, col, glow = false) => ({ t: 'b', x0, x1, y0, y1, z0, z1, col, glow });
  const cyl = (cx, cy, r, z0, z1, col, glow = false) => ({ t: 'c', cx, cy, r, z0, z1, col, glow });

  // 部品リスト → 断面画像の配列
  function build(def, flash) {
    const S = def.size, H = def.height, half = S / 2;
    const vox = new Array(S * S * H).fill(null);
    const idx = (x, y, z) => (z * S + y) * S + x;
    for (const p of def.parts) {
      const z0 = Math.max(0, p.z0), z1 = Math.min(H, p.z1);
      for (let z = z0; z < z1; z++) {
        for (let gy = 0; gy < S; gy++) {
          for (let gx = 0; gx < S; gx++) {
            const rx = gx - half, ry = gy - half;
            let inside;
            if (p.t === 'b') inside = rx >= p.x0 && rx < p.x1 && ry >= p.y0 && ry < p.y1;
            else {
              const dx = rx + 0.5 - p.cx, dy = ry + 0.5 - p.cy;
              inside = dx * dx + dy * dy <= p.r * p.r;
            }
            if (inside) vox[idx(gx, gy, z)] = p;
          }
        }
      }
    }
    const filled = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < S && y < S && z < H && vox[idx(x, y, z)];
    const slices = [];
    for (let z = 0; z < H; z++) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = S;
      const c = cv.getContext('2d');
      const img = c.createImageData(S, S);
      let any = false;
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const p = vox[idx(x, y, z)];
          if (!p) continue;
          any = true;
          let [r, g, b] = hex(p.col);
          let f;
          if (p.glow) f = 1.15;
          else {
            f = 0.66 + 0.34 * (z + 1) / H;                     // 下ほど暗く
            if (!filled(x, y, z + 1)) f += 0.14;                // 上面は明るく
            if (!filled(x - 1, y, z) || !filled(x + 1, y, z) ||
                !filled(x, y - 1, z) || !filled(x, y + 1, z)) f -= 0.16; // 輪郭
          }
          r *= f; g *= f; b *= f;
          if (flash) { r = r * 0.25 + 255 * 0.75; g = g * 0.25 + 255 * 0.75; b = b * 0.25 + 255 * 0.75; }
          const o = (y * S + x) * 4;
          img.data[o] = Math.min(255, r);
          img.data[o + 1] = Math.min(255, g);
          img.data[o + 2] = Math.min(255, b);
          img.data[o + 3] = 255;
        }
      }
      if (!any) { slices.push(null); continue; }
      c.putImageData(img, 0, 0);
      slices.push(cv);
    }
    // 最上段の空の断面は落とす
    while (slices.length && !slices[slices.length - 1]) slices.pop();
    return slices;
  }

  // ---- モデル定義（frame: 0..3 の歩行フェーズ）----
  const defs = {
    // 自機: VANGUARD — 青緑と白の人型。右腕がライフル。
    vanguard(f) {
      const d = [0, 2, 0, -2][f];
      return {
        size: 24, height: 23, parts: [
          box(-2 + d, 2 + d, -5, -2, 0, 6, '#3a4252'),
          box(-3 + d, 3 + d, -5, -2, 0, 1, '#262b36'),
          box(-2 - d, 2 - d, 2, 5, 0, 6, '#3a4252'),
          box(-3 - d, 3 - d, 2, 5, 0, 1, '#262b36'),
          box(-3, 3, -4, 4, 5, 7, '#5d6678'),
          box(-4, 4, -5, 5, 7, 14, '#1fa39a'),
          box(4, 5, -3, 3, 9, 13, '#e8eef2'),
          box(5, 6, -1, 1, 10, 12, '#7ff6ff', true),
          box(-6, -4, -3, 3, 9, 15, '#147069'),
          box(-7, -6, -2, -1, 12, 16, '#2a2f3a'),
          box(-7, -6, 1, 2, 12, 16, '#2a2f3a'),
          box(-3, 3, -8, -5, 11, 15, '#e8eef2'),
          box(-3, 3, 5, 8, 11, 15, '#e8eef2'),
          box(-1, 2, -8, -6, 6, 11, '#5d6678'),
          box(-1, 3, 6, 8, 7, 11, '#5d6678'),
          box(1, 10, 6, 9, 8, 11, '#2a2f3a'),
          box(10, 11, 7, 8, 9, 10, '#ffb347', true),
          box(-2, 3, -3, 3, 15, 19, '#e8eef2'),
          box(3, 4, -2, 2, 16, 18, '#7ff6ff', true),
          box(-2, -1, 2, 3, 19, 22, '#5d6678'),
          box(-2, -1, 2, 3, 22, 23, '#ff5470', true),
        ],
      };
    },
    // 敵: SCUTTLER — 低く速い多脚の突撃型。
    scuttler(f) {
      const d = [1, 0, -1, 0][f];
      return {
        size: 20, height: 8, parts: [
          box(2 + d, 4 + d, -9, -4, 0, 4, '#3b2025'),
          box(2 - d, 4 - d, 4, 9, 0, 4, '#3b2025'),
          box(-4 - d, -2 - d, -9, -4, 0, 4, '#3b2025'),
          box(-4 + d, -2 + d, 4, 9, 0, 4, '#3b2025'),
          cyl(0, 0, 4.6, 2, 6, '#d6334a'),
          cyl(-0.5, 0, 3.2, 6, 8, '#8f1d2e'),
          box(4, 7, -3, -2, 2, 4, '#c9c2b8'),
          box(4, 7, 2, 3, 2, 4, '#c9c2b8'),
          box(3, 5, -1, 1, 4, 6, '#ffe14d', true),
        ],
      };
    },
    // 敵: WARDEN — 履帯の砲台型。距離をとって2連砲で撃つ。
    warden(f) {
      const parts = [
        box(-6, 6, -7, -4, 0, 4, '#2b2b30'),
        box(-6, 6, 4, 7, 0, 4, '#2b2b30'),
        box(-5, 5, -4, 4, 2, 6, '#6b6460'),
        cyl(0, 0, 5.2, 6, 12, '#e0812b'),
        box(0, 10, -4, -2, 9, 11, '#2b2b30'),
        box(0, 10, 2, 4, 9, 11, '#2b2b30'),
        box(10, 11, -4, -2, 9, 11, '#ff6b3d', true),
        box(10, 11, 2, 4, 9, 11, '#ff6b3d', true),
        cyl(0, 0, 3.4, 12, 15, '#a3561a'),
        box(2, 4, -1, 1, 12, 14, '#ff3d3d', true),
      ];
      for (let i = -6; i < 6; i += 3) {
        const x = i + f % 3;
        parts.push(box(x, x + 1, -7, -4, 3, 4, '#4b4b52'));
        parts.push(box(x, x + 1, 4, 7, 3, 4, '#4b4b52'));
      }
      return { size: 24, height: 15, parts };
    },
    // 敵: COLOSSUS — 大型の重装型。衝撃波を放つ。
    colossus(f) {
      const d = [0, 2, 0, -2][f];
      return {
        size: 32, height: 26, parts: [
          box(-3 + d, 3 + d, -8, -3, 0, 9, '#2f2a3d'),
          box(-4 + d, 4 + d, -9, -2, 0, 2, '#221e2d'),
          box(-3 - d, 3 - d, 3, 8, 0, 9, '#2f2a3d'),
          box(-4 - d, 4 - d, 2, 9, 0, 2, '#221e2d'),
          box(-7, 6, -9, 9, 8, 19, '#7a4fd1'),
          box(6, 7, -5, 5, 10, 17, '#4a2f86'),
          box(7, 8, -2, 2, 12, 15, '#ff4fd8', true),
          box(-3, 3, -13, -9, 13, 19, '#4a2f86'),
          box(-3, 3, 9, 13, 13, 19, '#4a2f86'),
          box(-2, 2, -12, -10, 19, 22, '#c9c2b8'),
          box(-2, 2, 10, 12, 19, 22, '#c9c2b8'),
          box(2, 10, -14, -9, 5, 11, '#5b5568'),
          box(2, 10, 9, 14, 5, 11, '#5b5568'),
          box(-1, 5, -3, 3, 19, 23, '#7a4fd1'),
          box(5, 6, -2, 2, 20, 22, '#ff4fd8', true),
          box(-4, -2, -1, 1, 23, 26, '#c9c2b8'),
        ],
      };
    },
    crate() {
      return {
        size: 20, height: 13, parts: [
          box(-9, 9, -9, 9, 0, 12, '#8a6a3c'),
          box(-9, 9, -9, 9, 5, 7, '#5e4626'),
          box(-8, 8, -8, 8, 12, 13, '#a3824f'),
          box(-1, 1, -8, 8, 12, 13, '#5e4626'),
          box(-8, 8, -1, 1, 12, 13, '#5e4626'),
        ],
      };
    },
    pillar() {
      return {
        size: 16, height: 30, parts: [
          cyl(0, 0, 7.5, 0, 3, '#3d4456'),
          cyl(0, 0, 6.2, 3, 26, '#59627a'),
          cyl(0, 0, 6.4, 20, 22, '#e3b23c'),
          cyl(0, 0, 6.4, 22, 23, '#1d2030'),
          cyl(0, 0, 6.4, 23, 25, '#e3b23c'),
          cyl(0, 0, 7.5, 26, 29, '#3d4456'),
          cyl(0, 0, 2.5, 29, 30, '#7ff6ff', true),
        ],
      };
    },
    repair() {
      return {
        size: 10, height: 4, parts: [
          box(-4, 4, -1, 1, 0, 4, '#4dff88', true),
          box(-1, 1, -4, 4, 0, 4, '#4dff88', true),
          box(-4, 4, -1, 1, 0, 1, '#1d8f48'),
          box(-1, 1, -4, 4, 0, 1, '#1d8f48'),
        ],
      };
    },
  };

  const FRAMES = { vanguard: 4, scuttler: 4, warden: 3, colossus: 4 };
  const cache = {};
  function get(name, frame = 0, flash = false) {
    const key = name + ':' + frame + ':' + (flash ? 1 : 0);
    if (!cache[key]) {
      const def = defs[name](frame);
      cache[key] = { size: def.size, slices: build(def, flash) };
    }
    return cache[key];
  }
  function frames(name) { return FRAMES[name] || 1; }

  return { get, frames };
})();
