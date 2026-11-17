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
  function build(def, flash, tint) {
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
          else if (tint) { r = r * 0.45 + 255 * 0.55; g = g * 0.45 + 70 * 0.55; b = b * 0.45 + 40 * 0.55; }  // オーバーヒートの赤
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
    // 自機: VANGUARD —「翼のある T 字」。白い肩当てで T 字の輪郭、右にライフル・左に盾で向きが読める。背中に 2 基の推進器。
    vanguard(f) {
      const d = [0, 2, 0, -2][f];
      const th = f % 2 ? 2 : 1; // 推進器の炎の長さ
      const W = '#e8eef2', T = '#1fa39a', TD = '#147069', FR = '#4a5670', DK = '#2a2f3a', G = '#7ff6ff';
      return {
        size: 24, height: 24, parts: [
          // 脚（左 y<0、右 y>0）
          box(-3 + d, 4 + d, -5, -2, 0, 2, '#3a4458'),
          box(-2 + d, 2 + d, -5, -2, 0, 6, FR),
          box(1 + d, 3 + d, -5, -2, 3, 5, W),
          box(-3 - d, 4 - d, 2, 5, 0, 2, '#3a4458'),
          box(-2 - d, 2 - d, 2, 5, 0, 6, FR),
          box(1 - d, 3 - d, 2, 5, 3, 5, W),
          // 腰
          box(-3, 3, -4, 4, 5, 8, '#5d6678'),
          box(-2, 3, -3, 3, 8, 10, DK),
          // 胸
          box(-4, 4, -5, 5, 10, 16, T),
          box(4, 6, -3, 3, 11, 15, W),
          box(6, 7, -1, 1, 12, 14, G, true),
          box(-3, 3, -4, 4, 16, 17, TD),
          // 背負い物と推進器
          box(-7, -4, -4, 4, 10, 17, TD),
          box(-9, -7, -4, -1, 12, 16, DK),
          box(-9, -7, 1, 4, 12, 16, DK),
          box(-9 - th, -9, -3, -2, 13, 15, G, true),
          box(-9 - th, -9, 2, 3, 13, 15, G, true),
          // 左腕と盾
          box(-1, 2, -8, -6, 7, 13, FR),
          box(0, 6, -10, -8, 6, 12, TD),
          box(1, 5, -11, -10, 7, 11, W),
          // 右腕とライフル
          box(-1, 3, 6, 8, 8, 13, FR),
          box(0, 9, 6, 9, 9, 12, DK),
          box(3, 6, 7, 8, 12, 13, '#5d6678'),
          box(9, 12, 7, 8, 10, 11, '#5d6678'),
          box(11, 12, 7, 8, 10, 11, '#ffb347', true),
          // 肩当て（張り出し）
          box(-3, 4, -9, -5, 13, 18, W),
          box(-2, 3, -10, -9, 14, 17, '#c4ccd4'),
          box(-2, 3, -8, -6, 18, 19, T),
          box(-3, 4, 5, 9, 13, 18, W),
          box(-2, 3, 9, 10, 14, 17, '#c4ccd4'),
          box(-2, 3, 6, 8, 18, 19, T),
          // 頭（横一文字のバイザー、青緑のとさか、アンテナ）
          box(-2, 3, -3, 3, 17, 21, W),
          box(3, 4, -3, 3, 18, 20, G, true),
          box(-3, 2, -1, 1, 21, 22, T),
          box(-3, -2, 2, 3, 21, 23, '#5d6678'),
          box(-3, -2, 2, 3, 23, 24, '#ff5470', true),
        ],
      };
    },
    // 敵: SCUTTLER —「矢じりの虫」。前に細くなる楔形の胴、骨色の大あご、6 本脚。黄色く光る背筋。
    scuttler(f) {
      const d = [1, 0, -1, 0][f];
      const m = f % 2; // 大あごの開閉
      const LEG = '#6a323c', BONE = '#e6ddd0', R = '#d6334a', RD = '#8f1d2e', G = '#ffe14d';
      const parts = [];
      // 三脚歩行: 足先だけ前後にずらす
      const leg = (x, s, ph, splay) => {
        const y0 = s < 0 ? -8 : 4, y1 = s < 0 ? -4 : 8;
        const fy0 = s < 0 ? -10 : 8, fy1 = s < 0 ? -8 : 10;
        parts.push(box(x, x + 2, y0, y1, 2, 4, LEG));
        parts.push(box(x + splay + ph * d, x + 2 + splay + ph * d, fy0, fy1, 0, 3, BONE));
      };
      leg(3, -1, 1, 1); leg(3, 1, -1, 1);
      leg(-1, -1, -1, 0); leg(-1, 1, 1, 0);
      leg(-5, -1, 1, -1); leg(-5, 1, -1, -1);
      parts.push(
        box(-9, -6, -1, 1, 3, 5, RD),            // 尾
        box(-6, 2, -4, 4, 2, 6, R),              // 楔形の胴
        box(2, 5, -3, 3, 2, 6, R),
        box(5, 7, -2, 2, 2, 5, '#b3263b'),
        box(6, 9, -4, -3, 2, 4, BONE),           // 大あご
        box(8, 10, -3 + m, -2 + m, 2, 4, BONE),
        box(6, 9, 3, 4, 2, 4, BONE),
        box(8, 10, 2 - m, 3 - m, 2, 4, BONE),
        box(-5, 1, -3, 3, 6, 8, RD),             // 甲羅
        box(-6, -4, -5, 5, 5, 7, RD),
        box(-4, 0, -1, 1, 8, 9, G, true),        // 背筋の光
        box(3, 5, -3, -1, 6, 7, G, true),        // 目
        box(3, 5, 1, 3, 6, 7, G, true),
      );
      return { size: 20, height: 9, parts };
    },
    // 敵: WARDEN —「警告縞の攻城戦車」。前に長い砲塔と 2 本の砲身、前甲板に黄黒の縞、後ろに機関部、回るレーダー。
    warden(f) {
      const O = '#e0812b', OD = '#a3561a', DK = '#2b2b30', ST = '#6b6460', SD = '#4f4a47';
      const parts = [
        box(-8, 8, -9, -5, 0, 4, DK),            // 履帯と泥よけ
        box(-8, 8, 5, 9, 0, 4, DK),
        box(-7, 5, -9, -5, 4, 5, OD),
        box(-7, 5, 5, 9, 4, 5, OD),
        box(-6, 6, -5, 5, 2, 7, ST),             // 車体
        box(6, 8, -4, 4, 2, 5, SD),
        box(4, 6, -5, 5, 7, 8, '#ffc233'),       // 警告縞
        box(4, 6, -3, -1, 7, 8, DK),
        box(4, 6, 1, 3, 7, 8, DK),
        box(-9, -5, -4, 4, 7, 11, SD),           // 機関部
        box(-9, -6, -3, -2, 11, 12, DK),
        box(-9, -6, -1, 1, 11, 12, DK),
        box(-9, -6, 2, 3, 11, 12, DK),
        cyl(-1, 0, 5.4, 7, 12, O),               // 砲塔
        box(1, 5, -4, 4, 8, 12, O),
        box(5, 6, -5, 5, 8, 11, OD),
        box(6, 11, -4, -2, 9, 11, DK),           // 2 連砲
        box(9, 11, -5, -1, 9, 11, '#3d3d46'),
        box(11, 12, -4, -2, 9, 11, '#ff6b3d', true),
        box(6, 11, 2, 4, 9, 11, DK),
        box(9, 11, 1, 5, 9, 11, '#3d3d46'),
        box(11, 12, 2, 4, 9, 11, '#ff6b3d', true),
        cyl(-1, 0, 3.6, 12, 14, OD),             // 司令塔と赤いセンサー
        box(2, 4, -1, 1, 12, 14, '#ff3d3d', true),
        box(-2, 0, -1, 1, 14, 15, DK),
      ];
      const [rx, ry] = [[1, -1], [-3, 1], [-3, -3]][f % 3]; // 回るレーダー
      parts.push(box(rx - 1, rx + 1, ry, ry + 2, 15, 16, '#ffd9a8'));
      for (let i = -8; i < 8; i += 3) {          // 流れる履帯の突起
        const x = i + f % 3;
        if (x >= 8) continue;
        parts.push(box(x, x + 1, -10, -9, 1, 3, '#55555e'));
        parts.push(box(x, x + 1, 9, 10, 1, 3, '#55555e'));
      }
      return { size: 24, height: 16, parts };
    },
    // 敵: COLOSSUS —「冠の炉」。幅広の猫背、大きな肩、前に突き出た籠手、背中に開いた桃色の炉と 4 本の放電柱。
    colossus(f) {
      const d = [0, 2, 0, -2][f];
      const a = d / 2;                           // 腕は脚と逆に振る
      const P = '#7a4fd1', PD = '#4a2f86', FR = '#3b3550', GY = '#5b5568', BONE = '#c9c2b8', G = '#ff4fd8';
      const tipF = f % 2 === 0, tipR = !tipF;    // 放電柱の先が前後交互に光る
      return {
        size: 32, height: 28, parts: [
          box(-5 + d, 6 + d, -10, -2, 0, 3, '#2c2740'),  // 脚
          box(-3 + d, 4 + d, -9, -3, 0, 9, FR),
          box(3 + d, 5 + d, -8, -4, 5, 9, P),
          box(-5 - d, 6 - d, 2, 10, 0, 3, '#2c2740'),
          box(-3 - d, 4 - d, 3, 9, 0, 9, FR),
          box(3 - d, 5 - d, 4, 8, 5, 9, P),
          box(-5, 5, -7, 7, 8, 11, FR),                 // 腰
          box(-2, 3, -14, -10, 8, 14, FR),              // 腕と籠手
          box(0 - a, 11 - a, -15, -9, 4, 11, GY),
          box(3 - a, 5 - a, -15, -9, 11, 12, P),
          box(11 - a, 13 - a, -14, -10, 5, 10, BONE),
          box(-2, 3, 10, 14, 8, 14, FR),
          box(0 + a, 11 + a, 9, 15, 4, 11, GY),
          box(3 + a, 5 + a, 9, 15, 11, 12, P),
          box(11 + a, 13 + a, 10, 14, 5, 10, BONE),
          box(-8, 7, -10, 10, 11, 20, P),               // 胴
          box(7, 9, -7, 7, 12, 18, PD),
          box(9, 10, -4, 4, 14, 16, G, true),
          box(-11, -8, -7, 7, 12, 21, PD),
          box(-5, 5, -15, -10, 14, 22, PD),             // 肩
          box(-4, 4, -15, -11, 22, 23, P),
          box(-5, 5, 10, 15, 14, 22, PD),
          box(-4, 4, 11, 15, 22, 23, P),
          cyl(-4, 0, 4.6, 20, 22, '#2c2740'),           // 背中の炉
          cyl(-4, 0, 3.0, 20, 23, G, true),
          box(2, 7, -3, 3, 20, 24, P),                  // 頭
          box(7, 8, -2, 2, 21, 23, G, true),
          box(2, 6, -2, 2, 24, 25, BONE),
          box(2, 4, -14, -12, 23, 26, BONE),            // 放電柱
          box(2, 4, 12, 14, 23, 26, BONE),
          box(-4, -2, -14, -12, 23, 27, BONE),
          box(-4, -2, 12, 14, 23, 27, BONE),
          box(2, 4, -14, -12, 26, 27, tipF ? G : PD, tipF),
          box(2, 4, 12, 14, 26, 27, tipF ? G : PD, tipF),
          box(-4, -2, -14, -12, 27, 28, tipR ? G : PD, tipR),
          box(-4, -2, 12, 14, 27, 28, tipR ? G : PD, tipR),
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
  function get(name, frame = 0, flash = false, tint = false) {
    const key = name + ':' + frame + ':' + (flash ? 1 : 0) + (tint ? 't' : '');
    if (!cache[key]) {
      const def = defs[name](frame);
      cache[key] = { size: def.size, slices: build(def, flash, tint) };
    }
    return cache[key];
  }
  function frames(name) { return FRAMES[name] || 1; }

  return { get, frames };
})();
