// Capture the three dashboard screenshots at 1440x900 with headless Chrome.
// Usage: node scripts/capture.mjs <outputDir> <shotsDir>
import { createRequire } from 'node:module';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
const require = createRequire('/home/hatch/.npm/_npx/7d92d9a2d2ccc630/x.js');
const puppeteer = require('puppeteer-core');
const CHROME = '/home/hatch/.cache/puppeteer/chrome/linux-157.0.8103.50/chrome-linux64/chrome';
const outDir = resolve(process.argv[2] || '/home/hatch/.hermes/cache/scratch/out-k');
const shotsDir = resolve(process.argv[3] || '/home/hatch/workspace/makefun/projects/token-radar-01/r4/repo/screenshots');
const url = 'file://' + outDir + '/dashboard/index.html';

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--force-color-profile=srgb', '--font-render-hinting=none'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
await page.waitForFunction(() => !!document.querySelector('#selfcheck .ok'), { timeout: 30000 });
await new Promise(r => setTimeout(r, 400));
const selfCheck = await page.$eval('#selfcheck', el => el.textContent.replace(/\s+/g, ' ').trim());
console.log('self-check line:', selfCheck);
const clip = { x: 0, y: 0, width: 1440, height: 900 };
await page.screenshot({ path: shotsDir + '/1-board.png', clip });
// detail of a top FARM row (the Detail tab opens the first FARM row by default)
await page.evaluate(() => document.querySelector('.tab[data-v="detail"]').click());
await page.waitForSelector('#detail .steps li', { timeout: 10000 });
await new Promise(r => setTimeout(r, 250));
const detailName = await page.$eval('#detail .vhead', el => el.textContent.trim());
console.log('detail row:', detailName);
await page.screenshot({ path: shotsDir + '/2-detail.png', clip });
// set aside
await page.evaluate(() => document.querySelector('.tab[data-v="setaside"]').click());
await page.waitForSelector('#setaside .satable tbody tr', { timeout: 10000 });
await new Promise(r => setTimeout(r, 250));
await page.screenshot({ path: shotsDir + '/3-setaside.png', clip });
await browser.close();
console.log('console errors:', errors.length);
errors.forEach(e => console.log('  ERR', e));
for (const f of ['1-board.png', '2-detail.png', '3-setaside.png']) console.log(f, statSync(shotsDir + '/' + f).size, 'bytes');
