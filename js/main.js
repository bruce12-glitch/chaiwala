/* ══════════════════════════════════════════════════════════════════════════
   CHAIWALA — main.js
   Motion layer: smooth scroll, scroll-driven reveals, the preloader,
   the custom cursor, and the bridge that feeds scroll state to the 3D world.
   ══════════════════════════════════════════════════════════════════════ */

import { createWorld } from './world.js';

const doc = document.documentElement;
doc.classList.remove('no-js');

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isTouch      = window.matchMedia('(hover: none)').matches;

const $  = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp  = (a, b, t) => a + (b - a) * t;

/* ══════════════════════════════════════════════════════════════════════
   TEXT SPLITTING
   ══════════════════════════════════════════════════════════════════ */
function splitText(el, mode = 'chars'){
  const source = el.textContent.trim().replace(/\s+/g, ' ');
  if (!source) return { lines: [], words: [], chars: [] };

  el.innerHTML = '';
  const wordEls = [];

  source.split(' ').forEach((word) => {
    const w = document.createElement('span');
    w.className = 'split-word';
    if (mode === 'chars'){
      Array.from(word).forEach((ch) => {
        const c = document.createElement('span');
        c.className = 'char';
        c.textContent = ch;
        w.appendChild(c);
      });
    } else {
      w.textContent = word;
    }
    el.appendChild(w);
    el.appendChild(document.createTextNode(' '));
    wordEls.push(w);
  });

  // group words into visual lines so each line can be masked independently
  const rows = [];
  let current = null;
  let lastTop = null;
  wordEls.forEach((w) => {
    const top = w.offsetTop;
    if (lastTop === null || Math.abs(top - lastTop) > 3){
      current = [];
      rows.push(current);
      lastTop = top;
    }
    current.push(w);
  });

  const frag = document.createDocumentFragment();
  rows.forEach((row) => {
    const line = document.createElement('span');
    line.className = 'split-line';
    row.forEach((w, i) => {
      line.appendChild(w);
      if (i < row.length - 1) line.appendChild(document.createTextNode(' '));
    });
    frag.appendChild(line);
  });

  el.innerHTML = '';
  el.appendChild(frag);

  return {
    lines: $$('.split-line', el),
    words: $$('.split-word', el),
    chars: $$('.char', el),
  };
}

/* ══════════════════════════════════════════════════════════════════════
   SHARED STATE (consumed by the 3D world every frame)
   ══════════════════════════════════════════════════════════════════ */
const state = {
  progress: 0,
  smoothProgress: 0,
  velocity: 0,
  mouse: { x: 0, y: 0 },
  mouseTarget: { x: 0, y: 0 },
  chapter: 0,
  hoveredCard: -1,
  ready: false,
};

/* ══════════════════════════════════════════════════════════════════════
   WEBGL CAPABILITY
   ══════════════════════════════════════════════════════════════════ */
function hasWebGL(){
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext &&
      (c.getContext('webgl2') || c.getContext('webgl')));
  } catch { return false; }
}

/* ══════════════════════════════════════════════════════════════════════
   BOOT
   ══════════════════════════════════════════════════════════════════ */
function boot(){
  window.__chaiBoot?.();
  gsap.registerPlugin(ScrollTrigger);

  const glOk = hasWebGL();
  if (!glOk) doc.classList.add('no-webgl');

  /* ── custom cursor ─────────────────────────────────────────────── */
  const cursorEl = $('#cursor');
  const cursorLabel = $('.cursor__label span', cursorEl);

  if (!isTouch){
    const ring = $('.cursor__ring', cursorEl);
    const dot  = $('.cursor__dot', cursorEl);
    const cx = gsap.quickTo(ring, 'x', { duration: 0.42, ease: 'power3' });
    const cy = gsap.quickTo(ring, 'y', { duration: 0.42, ease: 'power3' });
    const dx = gsap.quickTo(dot,  'x', { duration: 0.10, ease: 'power2' });
    const dy = gsap.quickTo(dot,  'y', { duration: 0.10, ease: 'power2' });

    window.addEventListener('pointermove', (e) => {
      cursorEl.classList.add('is-on');
      cx(e.clientX); cy(e.clientY);
      dx(e.clientX); dy(e.clientY);
    }, { passive: true });

    window.addEventListener('pointerdown', () => cursorEl.classList.add('is-down'));
    window.addEventListener('pointerup',   () => cursorEl.classList.remove('is-down'));

    $$('[data-cursor]').forEach((el) => {
      el.addEventListener('pointerenter', () => {
        const text = el.dataset.cursorLabel;
        if (!text) return;
        cursorLabel.textContent = text;
        cursorEl.classList.add('is-label');
      });
      el.addEventListener('pointerleave', () => cursorEl.classList.remove('is-label'));
    });
  }

  /* ── magnetic elements ─────────────────────────────────────────── */
  if (!isTouch && !reduceMotion){
    $$('[data-magnetic]').forEach((el) => {
      const strength = 0.32;
      const xTo = gsap.quickTo(el, 'x', { duration: 0.5, ease: 'power3' });
      const yTo = gsap.quickTo(el, 'y', { duration: 0.5, ease: 'power3' });
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        xTo((e.clientX - (r.left + r.width / 2)) * strength);
        yTo((e.clientY - (r.top + r.height / 2)) * strength);
      });
      el.addEventListener('pointerleave', () => { xTo(0); yTo(0); });
    });
  }

  /* ── nav / drawer ──────────────────────────────────────────────── */
  const nav = $('#nav');
  const burger = $('#burger');
  const drawer = $('#drawer');

  burger.addEventListener('click', () => {
    const open = drawer.classList.toggle('is-open');
    burger.setAttribute('aria-expanded', String(open));
    drawer.setAttribute('aria-hidden', String(!open));
    document.body.classList.toggle('menu-open', open);
  });
  $$('.drawer__link').forEach((a) => a.addEventListener('click', () => {
    drawer.classList.remove('is-open');
    burger.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('menu-open');
  }));

  /* ── smooth scroll ─────────────────────────────────────────────── */
  let lenis = null;
  if (!reduceMotion && typeof Lenis !== 'undefined'){
    lenis = new Lenis({
      duration: 1.15,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      wheelMultiplier: 1,
      touchMultiplier: 1.5,
    });
    lenis.on('scroll', (e) => {
      ScrollTrigger.update();
      state.progress = e.progress ?? 0;
      state.velocity = e.velocity ?? 0;
    });
    gsap.ticker.add((time) => lenis.raf(time * 1000));
    gsap.ticker.lagSmoothing(0);
  }

  const scrollTo = (target) => {
    const el = typeof target === 'string' ? $(target) : target;
    if (!el) return;
    if (lenis) lenis.scrollTo(el, { offset: -60, duration: 1.5 });
    else el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
  };
  $$('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href');
      if (id.length < 2) return;
      e.preventDefault();
      scrollTo(id);
    });
  });

  // small hook so the scroll position can be driven programmatically
  window.__chai = { state, get lenis(){ return lenis; }, scrollTo };

  /* ── text splitting ────────────────────────────────────────────── */
  const heroTitle = $('.hero__title');
  const heroSplit = heroTitle ? splitText(heroTitle, 'chars') : null;

  const statementEl = $('.statement');
  const statementSplit = statementEl ? splitText(statementEl, 'words') : null;

  /* ── hidden-until-revealed targets ─────────────────────────────── */
  const heroReveals = $$('.hero [data-reveal="up"]');
  const pageReveals = $$('[data-reveal="up"]').filter((el) => !el.closest('.hero'));

  if (!reduceMotion){
    gsap.set('[data-reveal="up"]', { opacity: 0, y: 34 });
  }

  /* ══════════════════════════════════════════════════════════════════
     PRELOADER → HERO REVEAL
     ══════════════════════════════════════════════════════════════════ */
  const preloader = $('#preloader');
  const loadBar   = $('#loadBar');
  const loadPct   = $('#loadPct');
  const letters   = $$('.preloader__word span');
  const brewFill  = $('.brew__fill');

  const load = { v: 0 };

  gsap.timeline({ defaults: { ease: 'power3.out' } })
    .set(letters, { yPercent: 110, opacity: 0 })
    .set(brewFill, { y: 0 })
    .to(letters, { yPercent: 0, opacity: 1, duration: 0.85, stagger: 0.045, ease: 'expo.out' }, 0.15)
    .fromTo('.preloader__mark', { opacity: 0, scale: 0.82 }, { opacity: 1, scale: 1, duration: 0.8 }, 0.1)
    .to(load, {
      v: 100, duration: 2.0, ease: 'power2.inOut',
      onUpdate(){
        const v = Math.round(load.v);
        loadPct.textContent = String(v).padStart(3, '0');
        loadBar.style.width = v + '%';
        // the cup fills as the site loads
        gsap.set(brewFill, { y: -(v / 100) * 86 });
      },
    }, 0.3)
    .to('.preloader__inner', { opacity: 0, y: -26, duration: 0.6, ease: 'power2.in' }, '+=0.15')
    .to(preloader, {
      yPercent: -100, duration: 1.05, ease: 'expo.inOut',
      onComplete(){
        preloader.style.display = 'none';
        preloader.classList.add('is-done');
      },
    }, '-=0.2')
    .add(revealHero, '-=0.6');

  function revealHero(){
    document.body.classList.remove('is-loading');
    document.body.classList.add('is-ready');
    state.ready = true;
    ScrollTrigger.refresh();

    /* the hero wordmark */
    if (heroSplit && !reduceMotion){
      const chars = heroSplit.chars;
      gsap.set(chars, { transformPerspective: 720, yPercent: 118, opacity: 0, rotateX: -55 });
      gsap.to(chars, {
        yPercent: 0, opacity: 1, rotateX: 0,
        duration: 1.3, ease: 'expo.out', stagger: { each: 0.036, from: 'start' },
      });

      if (!isTouch){
        const charTos = chars.map((c) => ({
          ry: gsap.quickTo(c, 'rotationY', { duration: 0.75, ease: 'power3' }),
          rx: gsap.quickTo(c, 'rotationX', { duration: 0.75, ease: 'power3' }),
          y:  gsap.quickTo(c, 'y',         { duration: 0.9,  ease: 'power3' }),
        }));
        window.addEventListener('pointermove', (e) => {
          const nx = (e.clientX / window.innerWidth) * 2 - 1;
          const ny = (e.clientY / window.innerHeight) * 2 - 1;
          charTos.forEach((t, i) => {
            const falloff = 1 - Math.abs(i / Math.max(1, chars.length - 1) - 0.5) * 1.3;
            t.ry(nx * 13 * falloff);
            t.rx(-ny * 9 * falloff);
            t.y(-ny * 5 * falloff);
          });
        }, { passive: true });
      }
    }

    /* hero copy + chrome settle in behind the wordmark */
    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
    if (heroReveals.length){
      tl.to(heroReveals, { opacity: 1, y: 0, duration: 1.0, stagger: 0.09 }, 0.35);
    }
    tl.from('.nav__inner', { y: -24, opacity: 0, duration: 0.9 }, 0.4)
      .from('.hero__stats li', { y: 26, opacity: 0, duration: 0.8, stagger: 0.08 }, 0.6)
      .from('.scrollcue', { opacity: 0, duration: 0.8 }, 0.8);

    setupPageReveals();
  }

  /* ── page reveals (created only after the intro, so nothing fires early) ── */
  function setupPageReveals(){
    if (reduceMotion || !pageReveals.length) return;
    ScrollTrigger.batch(pageReveals, {
      start: 'top 88%',
      once: true,
      onEnter: (batch) => gsap.to(batch, {
        opacity: 1, y: 0, duration: 1.05, stagger: 0.08, ease: 'power3.out', overwrite: true,
      }),
    });
    ScrollTrigger.refresh();
  }

  /* ── story chapters ────────────────────────────────────────────── */
  const chapters = $$('.chapter');
  const storyMeter = $('#storyMeter');
  const storySection = $('.story');

  if (storySection && chapters.length){
    chapters[0].classList.add('is-active');
    ScrollTrigger.create({
      trigger: storySection,
      start: 'top top',
      end: 'bottom bottom',
      onUpdate: (self) => {
        const p = self.progress;
        const idx = clamp(Math.floor(p * chapters.length), 0, chapters.length - 1);
        if (idx !== state.chapter){
          state.chapter = idx;
          chapters.forEach((c, i) => c.classList.toggle('is-active', i === idx));
        }
        if (storyMeter) storyMeter.style.width = (p * 100).toFixed(2) + '%';
      },
    });
  }

  /* ── statement: word-by-word as you scroll ─────────────────────── */
  if (statementSplit && statementSplit.words.length && !reduceMotion){
    gsap.from(statementSplit.words, {
      opacity: 0.12, yPercent: 40, duration: 0.7, ease: 'power2.out', stagger: 0.06,
      scrollTrigger: { trigger: '.story__head', start: 'top 78%', end: 'top 34%', scrub: 1 },
    });
  }

  /* ── menu heading ──────────────────────────────────────────────── */
  if (!reduceMotion){
    gsap.from('.menu__title', {
      yPercent: 26, opacity: 0, duration: 1.1, ease: 'expo.out',
      scrollTrigger: { trigger: '.menu__head', start: 'top 82%', once: true },
    });
  }

  /* ── product cards: entrance + 3D tilt + 3D porthole hover ─────── */
  $$('.card').forEach((card, i) => {
    if (!reduceMotion){
      gsap.from(card, {
        y: 60, opacity: 0, rotateX: 8, duration: 1.0, ease: 'expo.out',
        delay: (i % 3) * 0.08,
        scrollTrigger: { trigger: card, start: 'top 90%', once: true },
      });
    }

    if (!isTouch && !reduceMotion){
      const rX = gsap.quickTo(card, 'rotationX', { duration: 0.6, ease: 'power3' });
      const rY = gsap.quickTo(card, 'rotationY', { duration: 0.6, ease: 'power3' });
      const tY = gsap.quickTo(card, 'y',         { duration: 0.6, ease: 'power3' });

      card.addEventListener('pointermove', (e) => {
        const r = card.getBoundingClientRect();
        const nx = (e.clientX - r.left) / r.width - 0.5;
        const ny = (e.clientY - r.top) / r.height - 0.5;
        rX(-ny * 11); rY(nx * 13); tY(-8);
      });
      card.addEventListener('pointerleave', () => { rX(0); rY(0); tY(0); });
    }

    card.addEventListener('pointerenter', () => { state.hoveredCard = i; });
    card.addEventListener('pointerleave', () => {
      if (state.hoveredCard === i) state.hoveredCard = -1;
    });
  });

  /* ── process steps ─────────────────────────────────────────────── */
  ScrollTrigger.batch('[data-step]', {
    start: 'top 86%',
    once: true,
    onEnter: (batch) => batch.forEach((el, i) => {
      gsap.delayedCall(i * 0.08, () => el.classList.add('is-in'));
    }),
  });

  /* ── the 90-second dial ────────────────────────────────────────── */
  const ringFill = $('#ringFill');
  const ringLabel = $('#ringLabel');
  if (ringFill){
    const LEN = 326.7;
    ScrollTrigger.create({
      trigger: '.process',
      start: 'top 72%',
      end: 'bottom bottom',
      scrub: true,
      onUpdate: (self) => {
        const p = self.progress;
        // counts the brew up from 0 to 90 seconds as the section scrolls
        ringFill.style.strokeDashoffset = String(LEN * (1 - p));
        if (ringLabel) ringLabel.textContent = Math.round(90 * p) + 's';
      },
    });
  }

  /* ── counters ──────────────────────────────────────────────────── */
  $$('[data-count]').forEach((el) => {
    const end = parseFloat(el.dataset.count);
    const suffix = el.dataset.suffix || '';
    const obj = { v: 0 };
    ScrollTrigger.create({
      trigger: el, start: 'top 90%', once: true,
      onEnter: () => gsap.to(obj, {
        v: end, duration: 2.0, ease: 'power2.out',
        onUpdate: () => { el.textContent = Math.round(obj.v) + suffix; },
      }),
    });
  });

  /* ── marquee ───────────────────────────────────────────────────── */
  if (!reduceMotion){
    gsap.to('[data-marquee]', { xPercent: -50, duration: 30, ease: 'none', repeat: -1 });
    gsap.fromTo('.numbers__marquee', { xPercent: 6 }, {
      xPercent: -10, ease: 'none',
      scrollTrigger: { trigger: '.numbers', start: 'top bottom', end: 'bottom top', scrub: 1 },
    });
  }

  /* ── quote carousel ────────────────────────────────────────────── */
  const track = $('#carouselTrack');
  const quotes = $$('.quote');
  const qCount = $('#qCount');
  let qIndex = 0;

  function gotoQuote(i){
    if (!track || !quotes.length) return;
    qIndex = (i + quotes.length) % quotes.length;

    const target = quotes[qIndex];
    const offset = target.offsetLeft - (track.parentElement.clientWidth - target.clientWidth) / 2;
    gsap.to(track, { x: -Math.max(0, offset), duration: 1.0, ease: 'expo.out' });

    quotes.forEach((q, k) => {
      const d = k - qIndex;
      q.classList.toggle('is-current', k === qIndex);
      gsap.to(q, {
        rotateY: d * -7,
        scale: k === qIndex ? 1 : 0.94,
        duration: 1.0, ease: 'expo.out',
      });
    });

    if (qCount){
      qCount.textContent = String(qIndex + 1).padStart(2, '0') +
        ' / ' + String(quotes.length).padStart(2, '0');
    }
  }

  $('#nextQ')?.addEventListener('click', () => gotoQuote(qIndex + 1));
  $('#prevQ')?.addEventListener('click', () => gotoQuote(qIndex - 1));

  if (quotes.length){
    gotoQuote(0);
    ScrollTrigger.create({
      trigger: '.voices', start: 'top 75%', once: true,
      onEnter: () => gotoQuote(0),
    });

    let dragging = false, startX = 0;
    const carousel = $('#carousel');
    carousel.addEventListener('pointerdown', (e) => { dragging = true; startX = e.clientX; });
    window.addEventListener('pointerup', (e) => {
      if (!dragging) return;
      dragging = false;
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 60) gotoQuote(qIndex + (dx < 0 ? 1 : -1));
    });
  }

  /* ── signup ────────────────────────────────────────────────────── */
  const signupForm = $('.signup');
  const signupHint = $('#signupHint');
  signupForm?.addEventListener('submit', () => {
    const input = $('#email');
    if (!input.value || !input.value.includes('@')){
      if (signupHint){
        signupHint.textContent = 'THAT DOES NOT LOOK LIKE AN EMAIL.';
        signupHint.style.color = 'var(--clay)';
      }
      return;
    }
    if (signupHint){
      signupHint.textContent = 'WELCOME TO THE KETTLE. CHECK YOUR INBOX.';
      signupHint.classList.add('is-ok');
      signupHint.style.color = '';
    }
    input.value = '';
    gsap.fromTo('.signup__row', { scale: 1 }, { scale: 1.02, duration: 0.22, yoyo: true, repeat: 1 });
  });

  /* ── nav show/hide + progress bar ──────────────────────────────── */
  ScrollTrigger.create({
    start: 0,
    end: 'max',
    onUpdate: (self) => {
      const y = self.scroll();
      nav.classList.toggle('is-stuck', y > 60);
      const deep = y > window.innerHeight * 0.9;
      nav.classList.toggle('is-hidden',
        self.direction === 1 && deep && !drawer.classList.contains('is-open'));
    },
  });

  const progressFill = $('#progressFill');
  ScrollTrigger.create({
    start: 0,
    end: 'max',
    onUpdate: (self) => {
      if (progressFill) progressFill.style.width = (self.progress * 100).toFixed(2) + '%';
    },
  });

  /* ── footer wordmark parallax ──────────────────────────────────── */
  if (!reduceMotion){
    $$('[data-parallax]').forEach((el) => {
      const amt = parseFloat(el.dataset.parallax) || 0.1;
      gsap.fromTo(el, { yPercent: amt * 100 }, {
        yPercent: -amt * 100, ease: 'none',
        scrollTrigger: { trigger: '.foot', start: 'top bottom', end: 'bottom bottom', scrub: 1 },
      });
    });
  }

  const yearEl = $('#year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  /* ══════════════════════════════════════════════════════════════════
     THE 3D WORLD
     ══════════════════════════════════════════════════════════════ */
  let world = null;
  if (glOk){
    try {
      world = createWorld({ canvas: $('#gl'), stages: $$('[data-stage]') });
    } catch (err){
      console.error('[chaiwala] WebGL world failed to start:', err);
      doc.classList.add('no-webgl');
      world = null;
    }
  }

  /* ── pointer → parallax state ──────────────────────────────────── */
  window.addEventListener('pointermove', (e) => {
    state.mouseTarget.x = (e.clientX / window.innerWidth) * 2 - 1;
    state.mouseTarget.y = (e.clientY / window.innerHeight) * 2 - 1;
  }, { passive: true });

  window.addEventListener('pointerleave', () => {
    state.mouseTarget.x = 0;
    state.mouseTarget.y = 0;
  });

  /* ── resize ────────────────────────────────────────────────────── */
  let resizeRaf = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      world?.resize();
      ScrollTrigger.refresh();
    });
  });

  /* ── render loop ───────────────────────────────────────────────── */
  let last = performance.now();

  function loop(now){
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    if (document.hidden) return;

    state.mouse.x = lerp(state.mouse.x, state.mouseTarget.x, 0.055);
    state.mouse.y = lerp(state.mouse.y, state.mouseTarget.y, 0.055);

    if (!lenis){
      const max = document.documentElement.scrollHeight - window.innerHeight;
      state.progress = clamp(window.scrollY / Math.max(1, max), 0, 1);
    }
    state.smoothProgress = lerp(state.smoothProgress, state.progress, 0.075);

    if (world) world.update(dt, state);
  }
  requestAnimationFrame(loop);

  document.addEventListener('visibilitychange', () => { last = performance.now(); });

  /* ── once webfonts land, re-measure the split lines ────────────── */
  if (document.fonts?.ready){
    document.fonts.ready.then(() => {
      ScrollTrigger.refresh();
      if (!state.ready || reduceMotion || !heroTitle) return;
      // re-split so line breaks match the loaded face, then restore the final state
      splitText(heroTitle, 'chars');
      gsap.set($$('.char', heroTitle), { transformPerspective: 720, yPercent: 0, opacity: 1, rotateX: 0 });
    });
  }
}

/* ══════════════════════════════════════════════════════════════════════
   GO
   ══════════════════════════════════════════════════════════════════ */
if (document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
