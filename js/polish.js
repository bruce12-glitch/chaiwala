/* ══════════════════════════════════════════════════════════════════════════
   CHAIWALA — polish.js
   The elevation layer: parallax depth field, scroll-linked 3D, section
   transitions, reveal enrichment and micro-interactions.

   Loaded as a module AFTER main.js, so GSAP/ScrollTrigger are already on
   window and main.js has finished building its own timelines.

   Design constraints honoured here:
     · every animation touches only `transform` / `opacity`  → compositor only
     · all injected DOM is decorative: position:absolute|fixed,
       pointer-events:none, aria-hidden="true" → zero layout impact,
       zero accessibility-tree impact
     · nothing touches the elements main.js already owns ([data-reveal] items,
       .card, .hero__title chars) — depth is applied to their *containers* so
       the two layers can never fight over the same transform
     · gsap.matchMedia() scopes everything and auto-reverts on breakpoint or
       reduced-motion changes; injected DOM is removed in the cleanup fn
   ══════════════════════════════════════════════════════════════════════════ */

(function () {
  if (typeof window.gsap === 'undefined' || typeof window.ScrollTrigger === 'undefined') return;

  const gsap = window.gsap;
  const ScrollTrigger = window.ScrollTrigger;
  gsap.registerPlugin(ScrollTrigger);

  const $  = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));

  /* every node we create, so cleanup can remove it again */
  const injected = [];

  function make(tag, cls, parent, position) {
    const el = document.createElement(tag);
    el.className = cls;
    el.setAttribute('aria-hidden', 'true');
    if (position === 'prepend') parent.prepend(el);
    else parent.appendChild(el);
    injected.push(el);
    return el;
  }

  const mm = gsap.matchMedia();

  /* ══════════════════════════════════════════════════════════════════════
     Everything below only exists when motion is welcome.
     ══════════════════════════════════════════════════════════════════ */
  mm.add({
    motion:  '(prefers-reduced-motion: no-preference)',
    desktop: '(min-width: 821px)',
    mobile:  '(max-width: 820px)',
  }, (ctx) => {
    const { motion, mobile } = ctx.conditions;
    if (!motion) return;

    /* parallax is halved on touch: big drifting planes cost real frames
       there, and the effect reads the same at a smaller amplitude */
    const amp = mobile ? 0.45 : 1;

    /* ─────────────────────────────────────────────────────────────────
       1 · ATMOSPHERE — a fixed light field that drifts behind the page
       ───────────────────────────────────────────────────────────────── */
    const canvas = $('#gl');
    if (canvas) {
      const atmos = document.createElement('div');
      atmos.id = 'atmos';
      atmos.setAttribute('aria-hidden', 'true');
      atmos.innerHTML =
        '<span class="orb orb--a"></span>' +
        '<span class="orb orb--b"></span>' +
        '<span class="orb orb--c"></span>';
      canvas.insertAdjacentElement('afterend', atmos);
      injected.push(atmos);

      const depths = [0.10, 0.17, 0.065];
      $$('.orb', atmos).forEach((orb, i) => {
        // scroll parallax
        gsap.to(orb, {
          y: () => -window.innerHeight * depths[i] * amp,
          ease: 'none',
          scrollTrigger: { start: 0, end: 'max', scrub: 1.1, invalidateOnRefresh: true },
        });
        // slow independent drift so it never feels bolted to the scrollbar
        gsap.to(orb, {
          xPercent: i % 2 ? -5 : 6,
          yPercent: i === 1 ? 4 : -3,
          duration: 22 + i * 7,
          ease: 'sine.inOut',
          yoyo: true,
          repeat: -1,
        });
      });
    }

    /* ─────────────────────────────────────────────────────────────────
       2 · SECTION DECOR — ambient wash + seam divider per section
       ───────────────────────────────────────────────────────────────── */
    const sections = [
      ['#story',   ''],
      ['#menu',    ''],
      ['#process', 'sec-glow--low'],
      ['#numbers', ''],
      ['#voices',  'sec-glow--low'],
      ['#find',    ''],
    ].map(([sel, mod]) => ({ el: $(sel), mod })).filter((s) => s.el);

    sections.forEach(({ el, mod }, i) => {
      // ambient glow sits directly after the scrim so section content,
      // which follows in DOM order, still paints on top of it
      const scrim = el.querySelector(':scope > [class$="__scrim"]');
      const glow = document.createElement('span');
      glow.className = 'sec-glow' + (mod ? ' ' + mod : '');
      glow.setAttribute('aria-hidden', 'true');
      if (scrim) scrim.insertAdjacentElement('afterend', glow);
      else el.prepend(glow);
      injected.push(glow);

      gsap.fromTo(glow,
        { y: 90 * amp, scale: 1.08 },
        {
          y: -90 * amp, scale: 1,
          ease: 'none',
          scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: 1.2 },
        });

      // seam: a hairline of light that draws itself in as the section arrives
      const seam = document.createElement('span');
      seam.className = 'seam';
      seam.setAttribute('aria-hidden', 'true');
      el.prepend(seam);
      injected.push(seam);

      gsap.to(seam, {
        scaleX: 1,
        duration: 1.5,
        ease: 'expo.out',
        scrollTrigger: { trigger: el, start: 'top 92%', once: true },
      });
    });

    /* ─────────────────────────────────────────────────────────────────
       3 · SCROLL-LINKED 3D DEPTH
       Applied to CONTAINERS only — main.js owns the individual cards,
       steps and reveal items, so the two layers never share a transform.
       ───────────────────────────────────────────────────────────────── */
    const depthTargets = [
      { sel: '.menu__head',    rot: 9,  scale: 0.955 },
      { sel: '.grid',          rot: 6,  scale: 0.975 },
      { sel: '.process__aside',rot: 10, scale: 0.95  },
      { sel: '.steps',         rot: 5,  scale: 0.985 },
      { sel: '.numbers__grid', rot: 7,  scale: 0.965 },
      { sel: '.carousel',      rot: 6,  scale: 0.97  },
      { sel: '.find__left',    rot: 9,  scale: 0.955 },
      { sel: '.places',        rot: 5,  scale: 0.985 },
    ];

    depthTargets.forEach(({ sel, rot, scale }) => {
      const el = $(sel);
      if (!el) return;
      gsap.fromTo(el,
        {
          rotateX: rot * amp,
          scale,
          transformPerspective: 1200,
          transformOrigin: '50% 100%',
        },
        {
          rotateX: 0,
          scale: 1,
          ease: 'none',
          scrollTrigger: {
            trigger: el,
            start: 'top 90%',
            end: 'top 42%',
            scrub: 1,
          },
        });
    });

    /* ─────────────────────────────────────────────────────────────────
       4 · HERO EXIT — the content recedes as the story takes over
       ───────────────────────────────────────────────────────────────── */
    const heroContent = $('.hero__content');
    if (heroContent) {
      gsap.to(heroContent, {
        yPercent: -14 * amp,
        scale: 1 - 0.07 * amp,
        opacity: 0.25,
        ease: 'none',
        scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: 1 },
      });
    }
    const heroRail = $('.hero__rail');
    if (heroRail) {
      gsap.to(heroRail, {
        yPercent: 34 * amp, opacity: 0, ease: 'none',
        scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: 1 },
      });
    }

    /* ─────────────────────────────────────────────────────────────────
       5 · FOOTER WORDMARK — deeper parallax + a tilt toward the viewer
       ───────────────────────────────────────────────────────────────── */
    const wordmark = $('.foot__wordmark');
    if (wordmark) {
      gsap.fromTo(wordmark,
        { rotateX: 26 * amp, yPercent: 12 * amp, transformPerspective: 1400, transformOrigin: '50% 100%' },
        {
          rotateX: 0, yPercent: -12 * amp, ease: 'none',
          scrollTrigger: { trigger: '.foot', start: 'top bottom', end: 'bottom bottom', scrub: 1.2 },
        });
    }

    /* ─────────────────────────────────────────────────────────────────
       6 · GRADIENT WORDS — subtle animated gradient on the serif accents
       ───────────────────────────────────────────────────────────────── */
    $$('.menu__title em.serif, .find__title em.serif, .process__title em.serif, .voices__title em.serif')
      .forEach((el) => el.classList.add('grad-text'));

    /* ─────────────────────────────────────────────────────────────────
       7 · NAV — reflect the section you are actually in
       ───────────────────────────────────────────────────────────────── */
    const navLinks = $$('.nav__link');
    if (navLinks.length) {
      const linkFor = (id) => navLinks.find((a) => a.getAttribute('href') === '#' + id);
      ['story', 'menu', 'process', 'find'].forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        ScrollTrigger.create({
          trigger: el,
          start: 'top 45%',
          end: 'bottom 45%',
          onToggle: (self) => {
            const link = linkFor(id);
            if (link) link.classList.toggle('is-active', self.isActive);
          },
        });
      });
    }

    /* ─────────────────────────────────────────────────────────────────
       8 · MICRO-INTERACTIONS that need a little JS
       ───────────────────────────────────────────────────────────────── */
    if (!window.matchMedia('(hover: none)').matches) {
      // stat tiles lift toward the pointer
      $$('.stat').forEach((el) => {
        const rx = gsap.quickTo(el, 'rotationX', { duration: 0.5, ease: 'power3' });
        const ry = gsap.quickTo(el, 'rotationY', { duration: 0.5, ease: 'power3' });
        el.style.transformPerspective = '700px';
        el.addEventListener('pointermove', (e) => {
          const r = el.getBoundingClientRect();
          const nx = (e.clientX - r.left) / r.width - 0.5;
          const ny = (e.clientY - r.top) / r.height - 0.5;
          rx(-ny * 9); ry(nx * 10);
        });
        el.addEventListener('pointerleave', () => { rx(0); ry(0); });
      });

      // place rows lean in the direction you came from
      $$('.place').forEach((el) => {
        const x = gsap.quickTo(el, 'x', { duration: 0.5, ease: 'power3' });
        el.addEventListener('pointerenter', (e) => {
          const r = el.getBoundingClientRect();
          x(e.clientX < r.left + r.width / 2 ? 6 : 10);
        });
        el.addEventListener('pointerleave', () => x(0));
      });
    }

    /* measure once everything has settled */
    requestAnimationFrame(() => ScrollTrigger.refresh());

    /* gsap.matchMedia cleanup: remove everything we created */
    return () => {
      injected.splice(0).forEach((el) => el.remove());
      $$('.grad-text').forEach((el) => el.classList.remove('grad-text'));
      $$('.nav__link.is-active').forEach((el) => el.classList.remove('is-active'));
    };
  });
})();
