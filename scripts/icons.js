// Génère les icônes PNG à partir de public/icons/icon.svg (nécessite Playwright).
// Usage : node scripts/icons.js
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');

(async () => {
  const svg = fs.readFileSync(path.join(__dirname, '..', 'public', 'icons', 'icon.svg'), 'utf8');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  // iOS arrondit lui-même les coins : l'icône Apple doit être carrée et opaque.
  for (const [size, name, square] of [
    [192, 'icon-192.png', false],
    [512, 'icon-512.png', false],
    [180, 'apple-touch-icon.png', true],
  ]) {
    const source = square ? svg.replace('rx="112"', 'rx="0"') : svg;
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}</style>` +
        source.replace('<svg ', `<svg width="${size}" height="${size}" style="display:block" `),
    );
    await page.screenshot({ path: path.join(__dirname, '..', 'public', 'icons', name), omitBackground: true });
  }
  await browser.close();
})();
