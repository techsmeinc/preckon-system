const { chromium } = require('playwright');

const BASE = 'http://127.0.0.1:8100';
const PAGES = [
  ['home', '/index.html'], ['platform', '/preckon-platform.html'], ['modules', '/preckon-modules.html'],
  ['why', '/preckon-why.html'], ['security', '/preckon-security.html'], ['pricing', '/preckon-pricing.html'],
  ['about', '/preckon-about.html'], ['demo', '/preckon-demo.html'],
  ['ar-home', '/ar/index.html'], ['ar-pricing', '/ar/preckon-pricing.html'], ['ar-why', '/ar/preckon-why.html'],
];
const SIZES = [
  ['320  iPhone SE',   320, 568],
  ['360  Android',     360, 740],
  ['390  iPhone 13',   390, 844],
  ['430  iPhone ProMax',430, 932],
  ['600  small tablet',600, 900],
  ['768  iPad port',   768, 1024],
  ['820  iPad Air',    820, 1180],
  ['1024 iPad land',  1024, 768],
  ['1280 laptop',     1280, 800],
  ['1440 laptop',     1440, 900],
];

(async () => {
  const b = await chromium.launch();
  const problems = [];

  for (const [label, w, h] of SIZES) {
    const page = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    for (const [name, path] of PAGES) {
      await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(350);

      const r = await page.evaluate((vw) => {
        const out = { overflow: 0, offenders: [], navVisible: false, navHref: 0, tiny: [], touch: [] };
        const de = document.documentElement;
        out.overflow = de.scrollWidth - de.clientWidth;

        // elements sticking out past the viewport
        if (out.overflow > 1) {
          document.querySelectorAll('body *').forEach(el => {
            const b = el.getBoundingClientRect();
            if (b.width === 0 || b.height === 0) return;
            const over = Math.round(Math.max(b.right - vw, -b.left));
            if (over > 2 && el.children.length <= 3) {
              out.offenders.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]}(+${over})`);
            }
          });
          out.offenders = [...new Set(out.offenders)].slice(0, 4);
        }

        // is primary navigation reachable?
        const nav = document.querySelector('.nav-links');
        out.navVisible = !!nav && getComputedStyle(nav).display !== 'none';
        out.navHref = document.querySelectorAll('.nav a[href]').length;
        const toggle = document.querySelector('.navtoggle,.menu-toggle,[data-menu]');
        out.hasMenuButton = !!toggle;

        // text below 12px is hard to read on a phone
        document.querySelectorAll('p,li,td,span,a,label,div').forEach(el => {
          if (!el.textContent || el.children.length) return;
          const fs = parseFloat(getComputedStyle(el).fontSize);
          if (fs && fs < 11) out.tiny.push(`${(el.className||'').toString().split(' ')[0]||el.tagName}:${fs}px`);
        });
        out.tiny = [...new Set(out.tiny)].slice(0, 3);

        // interactive targets smaller than ~40px
        document.querySelectorAll('a.btn,button,select,input,textarea').forEach(el => {
          const b = el.getBoundingClientRect();
          if (b.height > 0 && b.height < 38) out.touch.push(`${el.tagName.toLowerCase()}.${(el.className||'').toString().split(' ')[0]}:${Math.round(b.height)}px`);
        });
        out.touch = [...new Set(out.touch)].slice(0, 3);
        return r0 = out;
      }, w);

      if (r.overflow > 1) problems.push(`OVERFLOW  ${label.padEnd(20)} ${name.padEnd(11)} +${r.overflow}px  ${r.offenders.join(' ')}`);
      if (w <= 880 && !r.navVisible && !r.hasMenuButton) problems.push(`NO-NAV    ${label.padEnd(20)} ${name.padEnd(11)} nav hidden, no menu button (${r.navHref} links in header)`);
      if (r.tiny.length) problems.push(`TINY-TEXT ${label.padEnd(20)} ${name.padEnd(11)} ${r.tiny.join(' ')}`);
      if (r.touch.length && w <= 820) problems.push(`SMALL-TAP ${label.padEnd(20)} ${name.padEnd(11)} ${r.touch.join(' ')}`);
    }
    await page.close();
  }

  const uniq = [...new Set(problems)];
  console.log(`\n${uniq.length} findings\n`);
  const byKind = {};
  uniq.forEach(p => { const k = p.split(' ')[0]; (byKind[k] ||= []).push(p); });
  for (const k of Object.keys(byKind)) {
    console.log(`--- ${k} (${byKind[k].length}) ---`);
    byKind[k].slice(0, 14).forEach(p => console.log('  ' + p));
    if (byKind[k].length > 14) console.log(`  ... +${byKind[k].length - 14} more`);
    console.log();
  }
  await b.close();
})();
