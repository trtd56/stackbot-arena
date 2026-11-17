// record.mjs — 告知動画を書き出す。
//   python3 -m http.server 8765   （リポジトリ直下で）
//   NODE_PATH=<puppeteer-core を入れた node_modules> node tools/promo/record.mjs A docs/promo/stackbot-A.mp4
// ヘッドレス Chrome で tools/promo/record.html を開き、1/60 秒ずつ進めて 2 回に 1 回画面を取り（30fps）、
// 最後に OfflineAudioContext に溜めた音を書き出して ffmpeg で MP4（H.264・AAC）にまとめる。
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
const require = createRequire(import.meta.url);
const puppeteer = require(process.env.PUPPETEER_PATH || 'puppeteer-core');

const shot = process.argv[2] || 'A', out = process.argv[3] || `docs/promo/stackbot-${shot}.mp4`;
const seed = process.argv[4] || '7';
// 画面は 1280x720 で描き（俯瞰でロボットが小さくなりすぎない）、書き出しで 1920x1080 に拡大する
const W = 1280, H = 720, FPS = 30, PER = 60 / FPS;
const tmp = join(process.env.TMPDIR || '/tmp', `promo-${shot}`);
rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
page.on('console', (m) => console.log('[page]', m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:8765/tools/promo/record.html?debug&view=top&shot=${shot}&seed=${seed}&audioLen=200`);
const info = await page.evaluate(() => window.__rec.presim());
const len = await page.evaluate(() => window.__rec.shot.length);
console.log('presim', info, 'length', len);

const n = Math.round(len * FPS);
for (let i = 0; i < n; i++) {
  const url = await page.evaluate((per) => { window.__rec.frame(per); return document.getElementById('game').toDataURL('image/jpeg', 0.97); }, PER);
  writeFileSync(join(tmp, `f${String(i).padStart(5, '0')}.jpg`), Buffer.from(url.split(',')[1], 'base64'));
  if (i % 90 === 0) console.log(i, await page.evaluate(() => window.__rec.state()));
}
const t1 = info.t0 + len;
const bytes = await page.evaluate((a, b) => window.__rec.renderAudio(a, b), info.t0, t1);
const parts = [];
for (let off = 0; off < bytes; off += 4 << 20) parts.push(Buffer.from(await page.evaluate((o) => window.__rec.pcmChunk(o, 4 << 20), off), 'base64'));
writeFileSync(join(tmp, 'audio.raw'), Buffer.concat(parts));
await browser.close();

mkdirSync(dirname(out), { recursive: true });
execFileSync('ffmpeg', ['-y', '-loglevel', 'error',
  '-framerate', String(FPS), '-i', join(tmp, 'f%05d.jpg'),
  '-f', 's16le', '-ar', '48000', '-ac', '2', '-i', join(tmp, 'audio.raw'),
  '-vf', 'scale=1920:1080:flags=bicubic', '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11', '-ar', '48000',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-movflags', '+faststart',
  '-c:a', 'aac', '-b:a', '192k', '-shortest', out], { stdio: 'inherit' });
console.log('wrote', out);
