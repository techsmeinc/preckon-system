/* Preckon — mobile navigation.
   Builds the toggle button and drives the existing .nav-links list as a
   panel below 880px, so there is no duplicated markup to keep in sync.

   The bar cannot hold brand + language + theme + CTA + toggle on a 320px
   phone, so the language select (and, on very narrow screens, the CTA)
   relocate into the panel and move back on resize. */
(function () {
  var nav = document.querySelector('.nav');
  var links = nav && nav.querySelector('.nav-links');
  var wrap = nav && nav.querySelector('.wrap');
  if (!nav || !links || !wrap) return;

  var tools = nav.querySelector('.nav-tools');
  var lang = nav.querySelector('.lang-select');

  // The homepage wraps its CTA in .nav-cta; the other pages put a bare .btn
  // straight into .wrap. Handle both so every page behaves the same.
  var cta = nav.querySelector('.nav-cta');
  if (!cta) {
    cta = Array.prototype.filter.call(wrap.children, function (c) {
      return c.classList && c.classList.contains('btn');
    })[0] || null;
  }
  var rtl = document.documentElement.getAttribute('dir') === 'rtl';

  // where relocated controls live inside the panel
  var extra = document.createElement('div');
  extra.className = 'nav-extra';
  links.appendChild(extra);

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'navtoggle';
  btn.setAttribute('aria-label', rtl ? 'القائمة' : 'Menu');
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML =
    '<svg class="ic-open" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>' +
    '<svg class="ic-close" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  if (!links.id) links.id = 'primary-nav';
  btn.setAttribute('aria-controls', links.id);
  wrap.appendChild(btn);

  var mqPanel = window.matchMedia('(max-width:880px)');

  function place() {
    // Language select moves into the panel on mobile/tablet to free bar space.
    // The CTA deliberately never moves — it stays in the bar at every width so
    // it looks and behaves identically on every device. Below 340px the brand
    // wordmark collapses to the mark instead, which frees the room it needs.
    if (lang) {
      var target = mqPanel.matches ? extra : tools;
      if (lang.parentNode !== target) {
        if (target === tools) target.insertBefore(lang, target.firstChild);
        else target.appendChild(lang);
      }
    }
  }

  function setOpen(open) {
    nav.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    setOpen(!nav.classList.contains('open'));
  });

  links.addEventListener('click', function (e) {
    if (e.target.closest('a')) setOpen(false);
  });
  document.addEventListener('click', function (e) {
    if (nav.classList.contains('open') && !nav.contains(e.target)) setOpen(false);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && nav.classList.contains('open')) { setOpen(false); btn.focus(); }
  });

  function onChange() {
    place();
    if (!mqPanel.matches) setOpen(false);   // don't leave it stuck open on desktop
  }
  if (mqPanel.addEventListener) mqPanel.addEventListener('change', onChange);
  else if (mqPanel.addListener) mqPanel.addListener(onChange);

  place();
})();
