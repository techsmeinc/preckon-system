const { chromium } = require('playwright');
const PAGES = ['/index.html','/preckon-platform.html','/preckon-modules.html','/preckon-why.html',
  '/preckon-security.html','/preckon-pricing.html','/preckon-about.html','/preckon-demo.html',
  '/ar/index.html','/ar/preckon-pricing.html','/ar/preckon-demo.html'];
const W = [320,360,375,390,414,430,480,600,768,820,1024,1280,1440];
(async () => {
  const b = await chromium.launch(); const bad = [];
  for (const w of W) {
    const p = await b.newPage({ viewport: { width: w, height: 900 }, isMobile: w < 900, hasTouch: w < 900 });
    for (const path of PAGES) {
      await p.goto('http://127.0.0.1:8100' + path, { waitUntil: 'domcontentloaded' });
      await p.waitForTimeout(280);
      const r = await p.evaluate(() => {
        const de = document.documentElement;
        const nav = document.querySelector('.nav');
        const t = document.querySelector('.navtoggle');
        const reachable = t ? getComputedStyle(t).display !== 'none'
          : getComputedStyle(document.querySelector('.nav-links')).display !== 'none';
        // is every bar item inside the viewport?
        const kids = [...document.querySelectorAll('.nav .wrap > *')].filter(e => e.className !== 'nav-links' && !e.classList.contains('nav-links'));
        const fits = kids.every(e => { const r = e.getBoundingClientRect(); return r.left >= -1 && r.right <= innerWidth + 1; });
        return { over: de.scrollWidth - de.clientWidth, navOK: reachable, barFits: fits };
      });
      if (r.over > 1) bad.push(`OVERFLOW ${w} ${path} +${r.over}`);
      if (!r.navOK) bad.push(`NAV      ${w} ${path}`);
      if (!r.barFits) bad.push(`BAR      ${w} ${path} item outside viewport`);
    }
    await p.close();
  }
  console.log(bad.length ? bad.join('\n') : `clean: ${W.length} widths x ${PAGES.length} pages = ${W.length*PAGES.length} checks, 0 issues`);
  await b.close();
})();
