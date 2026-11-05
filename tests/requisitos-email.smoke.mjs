import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildRequisitosEmail } from '../lib/requisitos-checkin.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined),
  headless: true,
});
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  for (const destino of ['MIA', 'MAD', 'COR']) {
    const { html } = buildRequisitosEmail({
      reserva: { piernas: [{ fecha: '2026-11-10T09:00', vuelo: 'PRUEBA', origen: 'EZE', destino }] },
      pasajeros: [{ id: 'demo', lastname: 'PRUEBA', firstname: 'PASAJERO', parg: { num: 'DEMO' } }],
      alCrear: true,
      now: Date.parse('2026-11-05T12:00:00-03:00'),
    });
    for (const colorScheme of ['dark', 'light']) {
      await page.emulateMedia({ colorScheme });
      await page.setContent(html);
      const failures = await page.locator('p, a').evaluateAll(elements => {
        const rgb = color => color.match(/[\d.]+/g).slice(0, 3).map(Number);
        const luminance = color => rgb(color).map(v => {
          v /= 255;
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
        return elements.filter(el => el.textContent.trim()).flatMap(el => {
          let ancestor = el;
          while (getComputedStyle(ancestor).backgroundColor === 'rgba(0, 0, 0, 0)') ancestor = ancestor.parentElement;
          const ink = luminance(getComputedStyle(el).color);
          const paper = luminance(getComputedStyle(ancestor).backgroundColor);
          const contrast = (Math.max(ink, paper) + 0.05) / (Math.min(ink, paper) + 0.05);
          return contrast < 4.5 ? [{ text: el.textContent.slice(0, 65), contrast: contrast.toFixed(2) }] : [];
        });
      });
      assert.deepEqual(failures, [], `${destino}, ${colorScheme}: el texto del mail debe ser legible`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Sin scroll horizontal');
    }
  }
  console.log('Mails de requisitos: contraste >= 4.5:1 en claro/oscuro, internacional y cabotaje.');
} finally {
  await browser.close();
}
