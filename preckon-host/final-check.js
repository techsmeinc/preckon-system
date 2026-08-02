const { chromium } = require('playwright');
const PAGES = ['/index.html','/preckon-platform.html','/preckon-modules.html','/preckon-why.html',
  '/preckon-security.html','/preckon-pricing.html','/preckon-about.html','/preckon-demo.html','/404.html',
  '/ar/index.html','/ar/preckon-platform.html','/ar/preckon-modules.html','/ar/preckon-why.html',
  '/ar/preckon-security.html','/ar/preckon-pricing.html','/ar/preckon-about.html','/ar/preckon-demo.html','/ar/404.html'];
const W = [320,360,375,390,414,430,480,600,768,820,1024,1280,1440,1920];
(async () => {
  const b = await chromium.launch(); const bad = [];
  for (const w of W) {
    const p = await b.newPage({ viewport: { width: w, height: 900 }, isMobile: w < 900, hasTouch: w < 900 });
    for (const path of PAGES) {
      await p.goto('http://127.0.0.1:8100' + path, { waitUntil: 'domcontentloaded' });
      await p.waitForTimeout(260);
      const r = await p.evaluate(() => {
        const de = document.documentElement;
        const t = document.querySelector('.navtoggle');
        const l = document.querySelector('.nav-links');
        const vis = e => e && getComputedStyle(e).display !== 'none';
        const kids = [...document.querySelectorAll('.nav .wrap > *')]
          .filter(e => !e.classList.contains('nav-links'));
        return {
          over: de.scrollWidth - de.clientWidth,
          navOK: vis(t) || vis(l),                       // menu button OR inline links
          barFits: kids.every(e => { const r = e.getBoundingClientRect();
                                     return r.left >= -1 && r.right <= innerWidth + 1; }),
        };
      });
      if (r.over > 1) bad.push(`OVERFLOW ${w} ${path} +${r.over}`);
      if (!r.navOK)   bad.push(`NAV      ${w} ${path} unreachable`);
      if (!r.barFits) bad.push(`BAR      ${w} ${path} item outside viewport`);
    }
    await p.close();
  }
  console.log(bad.length ? bad.join('\n')
    : `CLEAN — ${W.length} widths x ${PAGES.length} pages = ${W.length*PAGES.length} checks, 0 issues`);
  await b.close();
})();
