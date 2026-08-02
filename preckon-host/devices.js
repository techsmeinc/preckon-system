const { chromium } = require('playwright');

// Real device viewports, portrait + landscape where the phone is plausible in hand.
const DEVICES = [
  ['Galaxy Fold (closed)', 280, 653],
  ['Galaxy Z Flip cover',  344, 882],
  ['iPhone SE (1st gen)',  320, 568],
  ['Galaxy S8/S9',         360, 740],
  ['Galaxy S20/S21',       360, 800],
  ['iPhone SE 2/3',        375, 667],
  ['iPhone 12/13 Mini',    375, 812],
  ['iPhone 13/14',         390, 844],
  ['iPhone 14/15 Pro',     393, 852],
  ['Pixel 7/8',            412, 915],
  ['iPhone 14 Pro Max',    430, 932],
  ['iPhone 15 Plus',       430, 932],
  ['Galaxy Fold (open)',   512, 717],
  ['iPad Mini',            744, 1133],
  ['iPad 10.9 portrait',   820, 1180],
  ['iPad Pro 11 portrait', 834, 1194],
  ['iPad Pro 12.9 port',  1024, 1366],
  ['iPhone 13 landscape',  844, 390],
  ['iPhone 15 Pro land',   852, 393],
  ['iPhone 14 PM land',    932, 430],
  ['iPad 10.9 landscape', 1180, 820],
  ['Laptop 1280',         1280, 800],
  ['Laptop 1440',         1440, 900],
  ['Desktop 1920',        1920, 1080],
];

const PAGES = ['/index.html', '/preckon-pricing.html', '/preckon-demo.html',
               '/ar/index.html', '/ar/preckon-demo.html'];

(async () => {
  const b = await chromium.launch();
  const bad = [];

  for (const [name, w, h] of DEVICES) {
    const p = await b.newPage({ viewport: { width: w, height: h }, isMobile: w < 900, hasTouch: w < 900 });
    for (const path of PAGES) {
      await p.goto('http://127.0.0.1:8100' + path, { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => !!document.querySelector('.nav .wrap'), { timeout: 5000 });
      await p.waitForTimeout(220);

      const r = await p.evaluate(() => {
        const de = document.documentElement;
        const vis = e => e && getComputedStyle(e).display !== 'none';
        const toggle = document.querySelector('.navtoggle');
        const links = document.querySelector('.nav-links');
        const barKids = [...document.querySelectorAll('.nav .wrap > *')]
          .filter(e => !e.classList.contains('nav-links'));
        // does anything in the bar wrap onto a second line or clip?
        const barTop = barKids.length ? Math.min(...barKids.map(e => e.getBoundingClientRect().top)) : 0;
        const barBot = barKids.length ? Math.max(...barKids.map(e => e.getBoundingClientRect().bottom)) : 0;
        const cta = document.querySelector('.nav .wrap > .nav-cta .btn, .nav .wrap > .btn');
        return {
          over: de.scrollWidth - de.clientWidth,
          navReachable: vis(toggle) || vis(links),
          barFits: barKids.every(e => { const b = e.getBoundingClientRect();
                                        return b.left >= -1 && b.right <= innerWidth + 1; }),
          barHeight: Math.round(barBot - barTop),
          ctaLines: cta ? Math.round(cta.getBoundingClientRect().height / parseFloat(getComputedStyle(cta).lineHeight || 20)) : 0,
        };
      });

      const tag = `${name} ${w}x${h}`.padEnd(30);
      if (r.over > 1)        bad.push(`OVERFLOW  ${tag} ${path} +${r.over}px`);
      if (!r.navReachable)   bad.push(`NAV       ${tag} ${path}`);
      if (!r.barFits)        bad.push(`BAR-CLIP  ${tag} ${path}`);
      if (r.barHeight > 56)  bad.push(`BAR-WRAP  ${tag} ${path} bar item ${r.barHeight}px tall (CTA wrapping?)`);
    }

    // menu must open and be fully usable
    await p.goto('http://127.0.0.1:8100/index.html', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(400);
    const hasToggle = await p.evaluate(() => {
      const t = document.querySelector('.navtoggle');
      return t && getComputedStyle(t).display !== 'none';
    });
    if (hasToggle) {
      await p.click('.navtoggle');
      await p.waitForTimeout(350);
      const m = await p.evaluate(() => {
        const l = document.querySelector('.nav-links');
        const links = [...l.querySelectorAll('a')];
        const lb = l.getBoundingClientRect();
        return {
          opens: getComputedStyle(l).opacity === '1',
          bottomBeyondViewport: Math.round(lb.bottom - innerHeight),
          scrollable: l.scrollHeight > l.clientHeight,
          allReachable: links.every(a => { const r = a.getBoundingClientRect(); return r.left >= -1 && r.right <= innerWidth + 1; }),
          over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      const tag = `${name} ${w}x${h}`.padEnd(30);
      if (!m.opens) bad.push(`MENU-OPEN ${tag}`);
      if (!m.allReachable) bad.push(`MENU-CLIP ${tag}`);
      if (m.over > 1) bad.push(`MENU-OVER ${tag} +${m.over}px`);
      if (m.bottomBeyondViewport > 0 && !m.scrollable)
        bad.push(`MENU-TALL ${tag} extends ${m.bottomBeyondViewport}px past viewport without scrolling`);
    }
    await p.close();
  }

  console.log(bad.length ? bad.join('\n')
    : `CLEAN — ${DEVICES.length} devices x ${PAGES.length} pages, 0 issues`);
  await b.close();
})();
