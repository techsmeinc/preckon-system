const { chromium } = require('playwright');
const BASE = 'http://localhost:8099';
const OUT = 'C:/Users/IKIO/AppData/Local/Temp/claude/c--Users-IKIO-Downloads-New-Preckon-system/5a770684-ae53-43f4-9051-c1b4f7f86bb1/scratchpad/shots-ar';
const PAGES = ['/ar/', '/ar/platform', '/ar/modules', '/ar/why', '/ar/security', '/ar/pricing', '/ar/about', '/ar/demo', '/ar/nope'];

(async () => {
  const browser = await chromium.launch();
  for (const route of PAGES) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errs = [], bad = [];
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('response', r => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url()); });

    await page.goto(BASE + route, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    const info = await page.evaluate(() => {
      const cs = getComputedStyle(document.body);
      // any element whose text is Arabic but still has letter-spacing applied
      let tracked = 0, arabicNodes = 0;
      document.querySelectorAll('*').forEach(el => {
        const t = el.textContent || '';
        if (!/[\u0600-\u06FF]/.test(t)) return;
        if (el.children.length) return;
        arabicNodes++;
        const ls = getComputedStyle(el).letterSpacing;
        if (ls && ls !== 'normal' && parseFloat(ls) !== 0) tracked++;
      });
      return {
        dir: document.documentElement.dir,
        lang: document.documentElement.lang,
        compat: document.compatMode,
        font: cs.fontFamily.split(',')[0].replace(/["']/g, ''),
        title: document.title,
        canonical: document.querySelector('link[rel=canonical]')?.href || null,
        hreflangs: [...document.querySelectorAll('link[rel=alternate]')].map(l => l.hreflang + '→' + l.href),
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
        arabicNodes, tracked,
        latinLeak: (document.body.innerText.match(/\b(the|and|your|with|every|from)\b/gi) || []).length,
        langOpts: [...document.querySelectorAll('.lang-select option')].map(o => o.textContent + '=' + o.value),
      };
    });

    const name = route === '/ar/' ? 'home' : route.replace('/ar/', '');
    await page.screenshot({ path: `${OUT}/${name}.png` });

    console.log(`\n=== ${route}`);
    console.log(`  dir/lang   : ${info.dir} / ${info.lang}   compat: ${info.compat}`);
    console.log(`  body font  : ${info.font}`);
    console.log(`  title      : ${info.title}`);
    console.log(`  canonical  : ${info.canonical}`);
    console.log(`  hreflang   : ${info.hreflangs.join('  ')}`);
    console.log(`  arabic els : ${info.arabicNodes}   with letter-spacing: ${info.tracked}${info.tracked ? '  <-- BREAKS GLYPH JOINS' : ' ✓'}`);
    console.log(`  EN leakage : ${info.latinLeak} common English words in body text`);
    console.log(`  h-overflow : ${info.scrollW > info.clientW ? 'YES ' + info.scrollW + '>' + info.clientW : 'no'}`);
    console.log(`  switcher   : ${info.langOpts.join(' | ')}`);
    if (bad.length) console.log('  BAD REQS   : ' + bad.join(', '));
    if (errs.length) console.log('  JS ERRORS  : ' + errs.slice(0, 2).join(' | '));
    await page.close();
  }
  await browser.close();
})();
