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
  const box = (x0, x1, y0, y1, z0, z1, col, glow = false, wear) => ({ t: 'b', x0, x1, y0, y1, z0, z1, col, glow, wear });
  const cyl = (cx, cy, r, z0, z1, col, glow = false) => ({ t: 'c', cx, cy, r, z0, z1, col, glow });

  // ---- 塗り（Fable への 2 回目の相談をもとに）----
  // 明るさは -2..+2 の 5 段に量子化し、影は青紫へ、光は暖色へ色相をずらす。
  // 断面は XY を 2 倍に細分化し（1 ボクセル = 2x2 画素）、輪郭・パネルラインを半ボクセルの細さで入れる。
  const RES = 2;
  const SH = [38, 28, 66], LT = [255, 214, 160], STEP = [0.5, 0.72, 1], MIX = [0, 0, 0, 0.22, 0.42];
  const DIRT = [92, 80, 64], BARE = [185, 179, 166];
  function ramp(r, g, b, lv) {
    if (lv < 0) {
      const m = STEP[lv + 2], t = (1 - m) * 0.6;
      return [r * m + r * SH[0] / 255 * t, g * m + g * SH[1] / 255 * t, b * m + b * SH[2] / 255 * t];
    }
    const k = MIX[lv + 2];
    return [r + (LT[0] - r) * k, g + (LT[1] - g) * k, b + (LT[2] - b) * k];
  }
  function hash(x, y, z) {
    let n = (x * 73856093 ^ y * 19349663 ^ z * 83492791) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }
  // 光の向き（モデル座標で 8 方位）。光は世界の左上 (-1,-1) から当たる
  const LIGHT8 = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  function lightOf(worldAngle) {
    const lx = -(Math.cos(worldAngle) + Math.sin(worldAngle)), ly = Math.sin(worldAngle) - Math.cos(worldAngle);
    return ((Math.round(Math.atan2(ly, lx) / (Math.PI / 4)) % 8) + 8) % 8;
  }

  // 部品リスト → 断面画像の配列
  function build(def, flash, tint, fog, light, seed) {
    const fk = fog * 0.22;
    const S = def.size, H = def.height, half = S / 2, S2 = S * RES;
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
    const at = (x, y, z) => (x >= 0 && y >= 0 && z >= 0 && x < S && y < S && z < H ? vox[idx(x, y, z)] : null);
    const filled = (x, y, z) => !!at(x, y, z);
    const near = (a, b) => { const A = hex(a.col), B = hex(b.col); return Math.abs(A[0] - B[0]) + Math.abs(A[1] - B[1]) + Math.abs(A[2] - B[2]) < 90; };
    const [lx, ly] = LIGHT8[light];
    const slices = [];
    for (let z = 0; z < H; z++) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = S2;
      const c = cv.getContext('2d');
      const img = c.createImageData(S2, S2);
      let any = false;
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const p = vox[idx(x, y, z)];
          if (!p) continue;
          any = true;
          let [br, bg, bb] = hex(p.col);
          let lv = 0;
          const top = !filled(x, y, z + 1);
          const h = hash(x + seed * 31, y, z);
          if (!p.glow) {
            if (z < H * 0.3) lv -= 1;                                   // 下ほど暗く
            if (top) {
              lv += 1;                                                  // 上面
              if (filled(x - 1, y, z + 1) || filled(x + 1, y, z + 1) || filled(x, y - 1, z + 1) || filled(x, y + 1, z + 1)) lv -= 1; // 段差の付け根
            }
            if (!filled(x + lx, y + ly, z)) lv += 1;                    // 光の当たる側
            else if (!filled(x - lx, y - ly, z)) lv -= 1;               // 反対側
            // 汚れ・傷: 足元は土色、上面の角はときどき地金、光る部品の隣は煤
            if (z < 3) { br += (DIRT[0] - br) * 0.3; bg += (DIRT[1] - bg) * 0.3; bb += (DIRT[2] - bb) * 0.3; }
            const edge = !filled(x - 1, y, z) || !filled(x + 1, y, z) || !filled(x, y - 1, z) || !filled(x, y + 1, z);
            if (top && edge && h < (p.wear || 0.05)) [br, bg, bb] = BARE;
            const g1 = at(x + 1, y, z), g2 = at(x - 1, y, z), g3 = at(x, y + 1, z), g4 = at(x, y - 1, z);
            if ((g1 && g1.glow) || (g2 && g2.glow) || (g3 && g3.glow) || (g4 && g4.glow)) lv -= 1;
          }
          for (let sy = 0; sy < RES; sy++) {
            for (let sx = 0; sx < RES; sx++) {
              let r, g, b;
              if (p.glow) { r = br * 1.15; g = bg * 1.15; b = bb * 1.15; }
              else {
                let l = lv;
                const nx = x + (sx ? 1 : -1), ny = y + (sy ? 1 : -1);
                const qx = at(nx, y, z), qy = at(x, ny, z);
                if (!qx || !qy) l -= 1;                                 // 外周の半ボクセル = 輪郭
                else if ((sx && qx !== p && !qx.glow && near(p, qx)) || (sy && qy !== p && !qy.glow && near(p, qy))) l -= 1; // 部品の継ぎ目
                // リベット: 4x4 以上の箱の上面の四隅
                if (top && p.t === 'b' && p.x1 - p.x0 >= 4 && p.y1 - p.y0 >= 4 && z === p.z1 - 1) {
                  const rx = x - half, ry = y - half;
                  if ((rx === p.x0 + 1 || rx === p.x1 - 2) && (ry === p.y0 + 1 || ry === p.y1 - 2) && sx === (rx === p.x0 + 1 ? 0 : 1) && sy === (ry === p.y0 + 1 ? 0 : 1)) l += 1;
                }
                l = l < -2 ? -2 : l > 2 ? 2 : l;
                [r, g, b] = ramp(br, bg, bb, l);
              }
              if (flash) { r = r * 0.25 + 255 * 0.75; g = g * 0.25 + 255 * 0.75; b = b * 0.25 + 255 * 0.75; }
              else if (tint) { r = r * 0.45 + 255 * 0.55; g = g * 0.45 + 70 * 0.55; b = b * 0.45 + 40 * 0.55; }  // オーバーヒートの赤
              if (fk) { r += (fogColor[0] - r) * fk; g += (fogColor[1] - g) * fk; b += (fogColor[2] - b) * fk; }  // 一人称視点の霞
              const o = ((y * RES + sy) * S2 + x * RES + sx) * 4;
              img.data[o] = Math.min(255, r);
              img.data[o + 1] = Math.min(255, g);
              img.data[o + 2] = Math.min(255, b);
              img.data[o + 3] = 255;
            }
          }
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
  // 3 版目: Fable への 2 回目の相談で、部品と色を足した（当たり判定と外形の範囲は変えていない）
  const defs = {
    // 自機: VANGUARD —「翼のある T 字」。白い肩当てで T 字の輪郭、右にライフル・左に盾で向きが読める。背中に 2 基の推進器。
    vanguard(f) {
      const d = [0, 2, 0, -2][f];
      const th = f % 2 ? 2 : 1; // 推進器の炎の長さ
      const W = '#dcdccf', T = '#1fa39a', TD = '#0f5d63', FR = '#566070', DK = '#2a2f3a', G = '#7ff6ff';
      return {
        size: 24, height: 24, parts: [
          // 脚（左 y<0、右 y>0）。つま先は白
          box(-3 + d, 4 + d, -5, -2, 0, 2, '#3a4458'),
          box(3 + d, 4 + d, -5, -2, 0, 2, W),
          box(-2 + d, 2 + d, -5, -2, 0, 6, FR),
          box(1 + d, 3 + d, -5, -2, 3, 5, W),
          box(-3 - d, 4 - d, 2, 5, 0, 2, '#3a4458'),
          box(3 - d, 4 - d, 2, 5, 0, 2, W),
          box(-2 - d, 2 - d, 2, 5, 0, 6, FR),
          box(1 - d, 3 - d, 2, 5, 3, 5, W),
          // 腰
          box(-3, 3, -4, 4, 5, 8, '#5d6678'),
          box(-2, 3, -3, 3, 8, 10, DK),
          // 胸と吸気口
          box(-4, 4, -5, 5, 10, 16, T),
          box(4, 6, -3, 3, 11, 15, W),
          box(5, 6, -3, -2, 12, 14, DK),
          box(5, 6, 2, 3, 12, 14, DK),
          box(6, 7, -1, 1, 12, 14, G, true),
          box(-3, 4, -4, 4, 16, 17, DK),           // 首の暗い襟（頭を浮かせる）
          // 背負い物・放熱フィン・推進器
          box(-7, -4, -4, 4, 10, 17, TD),
          box(-7, -5, -3, -1, 17, 19, DK),
          box(-7, -5, 1, 3, 17, 19, DK),
          box(-9, -7, -4, -1, 12, 16, DK),
          box(-9, -7, 1, 4, 12, 16, DK),
          box(-9 - th, -9, -3, -2, 13, 15, G, true),
          box(-9 - th, -9, 2, 3, 13, 15, G, true),
          // 左腕と盾（上縁を白に、紋章）
          box(-1, 2, -8, -6, 7, 13, FR),
          box(0, 6, -10, -8, 6, 12, TD, false, 0.25),
          box(0, 6, -10, -8, 12, 13, W, false, 0.25),
          box(1, 5, -11, -10, 7, 11, W),
          box(2, 4, -11, -10, 8, 10, T),
          // 右腕とライフル（被筒）
          box(-1, 3, 6, 8, 8, 13, FR),
          box(0, 9, 6, 9, 9, 12, DK),
          box(6, 9, 6, 9, 10, 12, '#3a4458'),
          box(3, 6, 7, 8, 12, 13, '#5d6678'),
          box(9, 12, 7, 8, 10, 11, '#5d6678'),
          box(11, 12, 7, 8, 10, 11, '#ffb347', true),
          // 肩当て（張り出し）
          box(-3, 4, -9, -5, 13, 18, W),
          box(-2, 3, -10, -9, 14, 17, '#b8bcb2'),
          box(-2, 3, -8, -6, 18, 19, T),
          box(-3, 4, 5, 9, 13, 18, W, false, 0.25),
          box(-2, 3, 9, 10, 14, 17, '#b8bcb2'),
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
      // 三脚歩行: 足先だけ前後にずらす。膝を立てる
      const leg = (x, s, ph, splay) => {
        const y0 = s < 0 ? -8 : 4, y1 = s < 0 ? -4 : 8;
        const fy0 = s < 0 ? -10 : 8, fy1 = s < 0 ? -8 : 10;
        parts.push(box(x, x + 2, y0, y1, 2, 4, LEG));
        parts.push(box(x, x + 2, s < 0 ? -9 : 7, s < 0 ? -7 : 9, 3, 5, '#8a4450'));
        parts.push(box(x + splay + ph * d, x + 2 + splay + ph * d, fy0, fy1, 0, 3, BONE));
      };
      leg(3, -1, 1, 1); leg(3, 1, -1, 1);
      leg(-1, -1, -1, 0); leg(-1, 1, 1, 0);
      leg(-5, -1, 1, -1); leg(-5, 1, -1, -1);
      parts.push(
        box(-6, 5, -3, 3, 2, 3, '#5c1220'),       // 暗い腹
        box(-9, -7, -1, 1, 5, 7, RD),             // 持ち上げた尾と針
        box(-10, -9, -1, 1, 4, 6, BONE),
        box(-7, -6, -1, 1, 3, 5, RD),
        box(-6, 2, -4, 4, 3, 6, R),               // 楔形の胴
        box(2, 5, -3, 3, 2, 6, R),
        box(5, 7, -2, 2, 2, 5, '#b3263b'),
        box(6, 9, -4, -3, 2, 4, BONE),            // 大あご（先は暗い骨色）
        box(8, 10, -3 + m, -2 + m, 2, 4, '#b8a898'),
        box(6, 9, 3, 4, 2, 4, BONE),
        box(8, 10, 2 - m, 3 - m, 2, 4, '#b8a898'),
        box(-5, -3, -3, 3, 6, 8, RD),             // 甲羅（2 節、x=-3 に溝）
        box(-2, 1, -3, 3, 6, 8, '#a8243a'),
        box(-6, -4, -5, 5, 5, 7, RD),
        box(2, 5, -1, 1, 6, 7, '#f0627a'),        // 頭の稜線
        box(-4, 0, -1, 1, 8, 9, G, true),         // 背筋の光
        box(3, 5, -3, -1, 6, 7, G, true),         // 目
        box(3, 5, 1, 3, 6, 7, G, true),
      );
      return { size: 20, height: 9, parts };
    },
    // 敵: WARDEN —「警告縞の攻城戦車」。前に長い砲塔と 2 本の砲身、前甲板に黄黒の縞、後ろに機関部、回るレーダー。
    warden(f) {
      const O = '#e0812b', OD = '#b5651f', DK = '#2b2b30', ST = '#6f6a5e', SD = '#4f4a47', TR = '#74747c';
      const parts = [
        box(-8, 8, -9, -5, 0, 4, DK),            // 履帯と泥よけ
        box(-8, 8, 5, 9, 0, 4, DK),
        box(-7, 5, -9, -5, 4, 5, OD),
        box(-7, 5, 5, 9, 4, 5, OD),
        box(-6, 6, -5, 5, 2, 7, ST),             // 車体
        box(6, 8, -4, 4, 2, 5, SD),
        box(8, 9, -5, 5, 1, 4, TR),              // 前面のドーザー板
        box(8, 9, -1, 1, 1, 4, '#ffc233'),
        box(4, 6, -5, 5, 7, 8, '#ffc233'),       // 警告縞
        box(4, 6, -3, -1, 7, 8, DK),
        box(4, 6, 1, 3, 7, 8, DK),
        box(-5, -1, 5, 8, 5, 7, '#5a5f3c'),      // 右の寝袋、左の工具箱
        box(-6, -3, -8, -6, 5, 7, SD),
        box(-9, -5, -4, 4, 7, 11, SD),           // 機関部と排気管
        box(-9, -6, -3, -2, 11, 12, DK),
        box(-9, -6, -1, 1, 11, 12, DK),
        box(-9, -6, 2, 3, 11, 12, DK),
        box(-10, -9, -3, -1, 8, 12, DK),
        box(-10, -9, 1, 3, 8, 12, DK),
        cyl(-1, 0, 5.4, 7, 12, O),               // 砲塔
        box(1, 5, -4, 4, 8, 12, O),
        box(5, 6, -5, 5, 8, 11, OD),
        box(6, 11, -4, -2, 9, 11, DK),           // 2 連砲と放熱帯
        box(7, 8, -4, -2, 9, 11, TR),
        box(9, 11, -5, -1, 9, 11, '#3d3d46'),
        box(11, 12, -4, -2, 9, 11, '#ff6b3d', true),
        box(6, 11, 2, 4, 9, 11, DK),
        box(7, 8, 2, 4, 9, 11, TR),
        box(9, 11, 1, 5, 9, 11, '#3d3d46'),
        box(11, 12, 2, 4, 9, 11, '#ff6b3d', true),
        box(-4, -2, -4, 4, 12, 13, '#f2e6d0'),   // 砲塔の上の識別帯
        cyl(-1, 0, 3.6, 12, 14, OD),             // 司令塔と赤いセンサー
        box(2, 4, -1, 1, 12, 14, '#ff3d3d', true),
        box(-2, 0, -1, 1, 14, 15, DK),
      ];
      const [rx, ry] = [[1, -1], [-3, 1], [-3, -3]][f % 3]; // 回るレーダー
      parts.push(box(rx - 1, rx + 1, ry, ry + 2, 15, 16, '#ffd9a8'));
      for (let i = -8; i < 8; i += 3) {          // 流れる履帯の突起
        const x = i + f % 3;
        if (x >= 8) continue;
        parts.push(box(x, x + 1, -10, -9, 1, 3, TR));
        parts.push(box(x, x + 1, 9, 10, 1, 3, TR));
      }
      return { size: 24, height: 16, parts };
    },
    // 敵: COLOSSUS —「冠の炉」。幅広の猫背、大きな肩、前に突き出た籠手、背中に開いた桃色の炉と 4 本の放電柱。
    colossus(f) {
      const d = [0, 2, 0, -2][f];
      const a = d / 2;                           // 腕は脚と逆に振る
      const P = '#7a4fd1', PD = '#4a2f86', FR = '#4a4560', GY = '#5b5568', BONE = '#c9c2b8', G = '#ff4fd8', FT = '#3a3452';
      const tipF = f % 2 === 0, tipR = !tipF;    // 放電柱の先が前後交互に光る
      return {
        size: 32, height: 28, parts: [
          box(-5 + d, 6 + d, -10, -2, 0, 3, FT),  // 脚
          box(-3 + d, 4 + d, -9, -3, 0, 9, FR),
          box(3 + d, 5 + d, -8, -4, 5, 9, P),
          box(-5 - d, 6 - d, 2, 10, 0, 3, FT),
          box(-3 - d, 4 - d, 3, 9, 0, 9, FR),
          box(3 - d, 5 - d, 4, 8, 5, 9, P),
          box(-5, 5, -7, 7, 8, 11, FR),                 // 腰
          box(-2, 3, -14, -10, 8, 14, FR),              // 腕と籠手（上に帯）
          box(0 - a, 11 - a, -15, -9, 4, 11, GY, false, 0.25),
          box(3 - a, 5 - a, -15, -9, 11, 12, P),
          box(6 - a, 9 - a, -15, -9, 11, 12, PD),
          box(11 - a, 13 - a, -14, -10, 5, 10, BONE, false, 0.3),
          box(-2, 3, 10, 14, 8, 14, FR),
          box(0 + a, 11 + a, 9, 15, 4, 11, GY, false, 0.25),
          box(3 + a, 5 + a, 9, 15, 11, 12, P),
          box(6 + a, 9 + a, 9, 15, 11, 12, PD),
          box(11 + a, 13 + a, 10, 14, 5, 10, BONE, false, 0.3),
          box(-8, 7, -10, 10, 11, 20, P),               // 胴
          box(7, 9, -7, 7, 12, 18, PD, false, 0.3),
          box(9, 10, -4, 4, 14, 16, G, true),
          box(-11, -8, -7, 7, 12, 21, PD),
          box(-5, 5, -15, -10, 14, 22, PD),             // 肩（前縁は明るい紫、外側に骨色の角）
          box(4, 5, -15, -10, 15, 21, '#9a74e8'),
          box(-4, 4, -15, -11, 22, 23, P),
          box(-5, -3, -16, -15, 16, 20, BONE),
          box(-5, 5, 10, 15, 14, 22, PD),
          box(4, 5, 10, 15, 15, 21, '#9a74e8'),
          box(-4, 4, 11, 15, 22, 23, P),
          box(-5, -3, 15, 16, 16, 20, BONE),
          box(-5, -3, -10, -5, 20, 21, '#2c2740'),      // 炉から肩への配管
          box(-5, -3, 5, 10, 20, 21, '#2c2740'),
          box(-1, 1, -9, -4, 20, 21, BONE),             // 骨色の襟板
          box(-1, 1, 4, 9, 20, 21, BONE),
          cyl(-4, 0, 5.4, 20, 21, '#8a8496'),           // 背中の炉（金属の縁と白い芯）
          cyl(-4, 0, 4.6, 20, 22, '#2c2740'),
          cyl(-4, 0, 3.0, 20, 23, G, true),
          cyl(-4, 0, 1.4, 23, 24, '#ffd0f4', true),
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
    // ---- 戦場の障害物（当たり半径: 柱枠 7 / 木箱枠 9.5 ボクセル）----
    // 竜の歯（コンクリの対戦車障害物）
    teeth() {
      return {
        size: 16, height: 18, parts: [
          box(-7, 7, -7, 7, 0, 3, '#5d5f58'), box(-6, 6, -6, 6, 3, 8, '#77796f'), box(-4, 4, -4, 4, 8, 14, '#84867b'),
          box(-3, 3, -3, 3, 14, 18, '#939588'), box(-1, 1, -1, 1, 17, 18, '#b89a3a'),
        ],
      };
    },
    // 折れたコンクリ柱と錆びた鉄筋
    stump() {
      return {
        size: 16, height: 22, parts: [
          cyl(0, 0, 7.2, 0, 4, '#5d5f58'), cyl(0, 0, 6, 4, 14, '#77796f'), box(-6, 2, -6, 3, 14, 18, '#84867b'),
          box(-5, -1, -5, 0, 18, 21, '#6a6c62'), box(1, 2, -2, -1, 14, 22, '#8a4a2c'), box(-3, -2, 2, 3, 14, 20, '#8a4a2c'),
        ],
      };
    },
    // 土嚢の陣地（コの字、中に弾薬箱）
    nest() {
      return {
        size: 20, height: 9, parts: [
          box(-9, 9, -9, -5, 0, 3, '#857553'), box(-9, 9, 5, 9, 0, 3, '#857553'), box(5, 9, -5, 5, 0, 3, '#857553'),
          box(-8, 8, -9, -6, 3, 6, '#94835d'), box(-8, 8, 6, 9, 3, 6, '#94835d'), box(6, 9, -6, 6, 3, 6, '#94835d'),
          box(-7, 7, -8, -6, 6, 8, '#a8976a'), box(-7, 7, 6, 8, 6, 8, '#a8976a'), box(-3, 1, -2, 2, 0, 5, '#4a5238'),
          box(-3, 1, -2, 2, 5, 6, '#b89a3a'),
        ],
      };
    },
    // 擱座した装甲車（開いたハッチ、折れた砲身、焦げと残り火）
    wreck() {
      return {
        size: 20, height: 11, parts: [
          box(-9, 9, -9, -6, 0, 4, '#26262a'), box(-9, 7, 6, 9, 0, 3, '#26262a'), box(-8, 8, -6, 6, 2, 7, '#4f5340'),
          box(8, 9, -5, 5, 2, 5, '#3f4233'), box(-5, 3, -5, 5, 7, 9, '#5c6048'), box(-3, 1, -2, 2, 9, 10, '#171514'),
          box(2, 8, 3, 5, 8, 9, '#3a3836'), box(-8, -5, -4, 4, 7, 8, '#171514'), box(-7, -6, -1, 1, 8, 11, '#c2562a', true),
        ],
      };
    },
    // ドラム缶 3 本
    drums() {
      return {
        size: 20, height: 11, parts: [
          cyl(-4, -4, 4.2, 0, 9, '#4a5238'), cyl(4, -3, 4.2, 0, 9, '#7a3b2e'), cyl(0, 4, 4.2, 0, 10, '#55585c'),
          cyl(-4, -4, 4.4, 3, 4, '#2f3424'), cyl(4, -3, 4.4, 6, 7, '#4f241c'), cyl(0, 4, 3.2, 10, 11, '#2a2c2e'),
        ],
      };
    },
    // ---- 外周（長さ 16 ボクセルの区間を並べる。x が壁の向き）----
    // コンクリ障壁: 下は幅広、上は細い 2 段。frame 1 は黄黒の縞入り
    barrier(f) {
      const parts = [box(-8, 8, -4, 5, 0, 7, '#77796f'), box(-8, 8, -2, 3, 7, 12, '#84867b'), box(-8, -7, -4, 5, 0, 12, '#5d5f58')];
      if (f === 1) for (let x = -6; x < 8; x += 4) parts.push(box(x, x + 2, -4, 5, 4, 6, '#e3b23c'), box(x + 2, x + 4, -4, 5, 4, 6, '#26262a'));
      return { size: 18, height: 12, parts };
    },
    // 土嚢: 層ごとに半個ずらして積む
    sandbags() {
      const parts = [];
      for (let z = 0; z < 4; z++) {
        const off = z % 2 ? 2 : 0;
        for (let x = -8 + off; x < 8; x += 4) {
          const x1 = Math.min(8, x + 4), w = 4 - z * 0.5;
          parts.push(box(x, x1 - 1, -Math.ceil(w), Math.ceil(w), z * 2, z * 2 + 2, z === 3 ? '#a8976a' : '#857553'));
          parts.push(box(x1 - 1, x1, -Math.ceil(w), Math.ceil(w), z * 2, z * 2 + 2, '#5c5038'));
        }
      }
      return { size: 18, height: 8, parts };
    },
    // 四隅: 監視塔の残骸
    tower() {
      return {
        size: 20, height: 22, parts: [
          box(-8, -6, -8, -6, 0, 18, '#3a3836'), box(6, 8, -8, -6, 0, 20, '#3a3836'), box(-8, -6, 6, 8, 0, 14, '#3a3836'), box(6, 8, 6, 8, 0, 20, '#3a3836'),
          box(-7, 7, -7, 7, 8, 9, '#4f4a47'), box(-8, 8, -8, 8, 18, 20, '#5d5f58'), box(-4, 8, -8, 8, 20, 22, '#6a6c62'),
          box(-8, 8, -8, -7, 20, 22, '#77796f'),
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

  const FRAMES = { vanguard: 4, scuttler: 4, warden: 3, colossus: 4, barrier: 2 };
  const cache = {};
  let fogColor = [0, 0, 0];
  function setFogColor(c) { fogColor = c; }
  // fog: 0..4。一人称視点で遠くの物を霞の色へ寄せた版。light: lightOf(世界での向き)
  function get(name, frame = 0, flash = false, tint = false, fog = 0, light = 5) {
    const key = name + ':' + frame + ':' + (flash ? 1 : 0) + (tint ? 't' : '') + fog + ':' + light;
    if (!cache[key]) {
      const def = defs[name](frame);
      let seed = 0;
      for (const ch of name) seed = (seed * 7 + ch.charCodeAt(0)) % 997;
      cache[key] = { size: def.size, res: RES, slices: build(def, flash, tint, fog, light, seed) };
    }
    return cache[key];
  }
  function frames(name) { return FRAMES[name] || 1; }

  return { get, frames, setFogColor, lightOf, RES };
})();
