const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  for (const w of [320, 375, 390, 430, 600]) {
    const p = await b.newPage({ viewport: { width: w, height: 900 } });
    await p.goto('http://127.0.0.1:8100/preckon-pricing.html', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(500);
    const r = await p.evaluate(() => {
      const row = document.querySelector('.crow');
      if (!row) return null;
      // walk up to find the clipping ancestor
      let el = row.parentElement, chain = [];
      while (el && el !== document.body) {
        const cs = getComputedStyle(el);
        chain.push(`${el.className.split(' ')[0]||el.tagName}:${cs.overflowX}`);
        el = el.parentElement;
      }
      const container = row.parentElement;
      return {
        rowW: Math.round(row.getBoundingClientRect().width),
        containerW: Math.round(container.getBoundingClientRect().width),
        containerScrollW: container.scrollWidth,
        canScroll: container.scrollWidth > container.clientWidth && ['auto','scroll'].includes(getComputedStyle(container).overflowX),
        chain: chain.slice(0, 3),
        headVisible: getComputedStyle(document.querySelector('.crow.chead')).display,
      };
    });
    console.log(`${w}px:`, JSON.stringify(r));
    await p.close();
  }
  await b.close();
})();
