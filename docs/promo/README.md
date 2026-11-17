# 告知動画

X 向けの候補 2 本（1920x1080・30fps・H.264 / AAC 48kHz ステレオ・音量 -14 LUFS）。1 本 約 29MB なので git には入れていない（`.gitignore`）。

- `stackbot-promo-A.mp4`（30 秒）: コックピットで撃って突撃して始まる → 俯瞰 → コックピットで COLOSSUS を倒す → 俯瞰で COLOSSUS 2 体の乱戦 → コックピットで締め
- `stackbot-promo-B.mp4`（28 秒）: 俯瞰で SCUTTLER の群れに突撃して始まる → コックピットで COLOSSUS と撃ち合う → 俯瞰の大乱戦 → コックピット → 俯瞰

## 作り直し方

`tools/promo/` の録画用ページで作る（ゲーム本体は変えていない）。`record.html` が時計・乱数・Web Audio を差し替え、1/60 秒ずつ進めて書き出す。音は OfflineAudioContext にためてから書き出すので、映像とずれない。操作はキー入力の自動操縦（`director.js`。狙いを付けるため機体の向きだけは直接合わせ、装甲は 45 未満に減らさない）。

```sh
python3 -m http.server 8765 &
npm i --prefix /tmp/pp puppeteer-core
PUPPETEER_PATH=/tmp/pp/node_modules/puppeteer-core node tools/promo/record.mjs A docs/promo/stackbot-promo-A.mp4 7
PUPPETEER_PATH=/tmp/pp/node_modules/puppeteer-core node tools/promo/record.mjs B docs/promo/stackbot-promo-B.mp4 21
```
