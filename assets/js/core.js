/* ЯДРО ПЛИТЫ — сантехника без облика. Подключается после gsap, ScrollTrigger, lenis и до main.js.
   Экспорт: window.site (сборщика нет). Длительностей и кривых сайта в этом файле нет —
   они читаются из tokens.css объектом T; цифры механики (сдвиг, stagger, скорость) приходят из main.js по паспортам.

   window.site = {
     RM, STATIC, T, lenis, $, $$,
     boot(init, opts), ready(cb), refresh(),
     scrollTo(target, opts), anchors(),
     reveal(recipes, scope), splitWords(el, opts),
     marquee(el, opts), overlay(el, opts), pin(el, opts),
     counter(el, opts), draw(path, opts),
     visible(el, cb, opts), onResize(cb), debounce(fn, ms),
     styles(), flag(name, on), copy(text, fallbackUrl)
   }

   Правила, которые держит ядро (у каждой функции — грабля, которую она закрывает):
   · start/end у ScrollTrigger — только px, % или функция: 'top 2.5rem' не парсится, смещение шапки — () => 'top ' + h + 'px';
   · стартовое состояние твина отдаётся GSAP целиком (в CSS трансформа не держать), to → fromTo;
   · после въезда — clearProps, иначе инлайн GSAP глушит CSS-hover и адаптивные значения;
   · бесконечные петли стоят вне кадра (visible), ждущие элементы — без transform. */
(function () {
  'use strict';

  var d = document, root = d.documentElement;
  var $ = function (s, c) { return (c || d).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || d).querySelectorAll(s)); };
  var G = window.gsap, ST = window.ScrollTrigger;

  /* Гейт движения. RM — системная настройка; LATE — страховка из index.html уже показала всё
     (ядро поднялось позже 4 с): прятать показанное нельзя, работаем без появлений. */
  var RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var LATE = root.classList.contains('is-static');
  var STATIC = RM || LATE || !G;
  var COARSE = matchMedia('(pointer: coarse)').matches;
  var PIN_MIN_H = 780;     // ниже — пин 100vh режет высокую карточку на ноутбуке
  var FONTS_CAP = 2000;    // сколько ждать шрифты перед refresh, мс
  var READY_CAP = 5000;    // потолок ожидания загрузчика/интро до html.is-ready, мс (kit ждёт класс 6 с)
  var RESIZE_MS = 150;

  var warned = {};
  function warn(key, msg) { if (!warned[key]) { warned[key] = 1; console.warn('[site] ' + msg); } }
  function debounce(fn, ms) { var t; return function () { var a = arguments, c = this; clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, ms); }; }

  /* ── T: длительности и кривые из CSS-переменных. В JS нет литералов движения — шов «easing/длительность» закрыт.
     Кривая tokens.css — cubic-bezier(); здесь она становится функцией для GSAP (решатель вместо CustomEase, минус 7 КБ). ── */
  function bezier(x1, y1, x2, y2) {
    var cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    var cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    var fx = function (t) { return ((ax * t + bx) * t + cx) * t; };
    var fy = function (t) { return ((ay * t + by) * t + cy) * t; };
    var dx = function (t) { return (3 * ax * t + 2 * bx) * t + cx; };
    return function (x) {
      if (x <= 0) return 0; if (x >= 1) return 1;
      var t = x, i, e, s;
      for (i = 0; i < 8; i++) { e = fx(t) - x; if (Math.abs(e) < 1e-6) return fy(t); s = dx(t); if (Math.abs(s) < 1e-6) break; t -= e / s; }
      var lo = 0, hi = 1; t = x;
      while (lo < hi) { e = fx(t); if (Math.abs(e - x) < 1e-6) break; if (x > e) lo = t; else hi = t; t = (hi - lo) / 2 + lo; if (hi - lo < 1e-7) break; }
      return fy(t);
    };
  }
  var CSS_EASE = { 'ease': [0.25, 0.1, 0.25, 1], 'ease-in': [0.42, 0, 1, 1], 'ease-out': [0, 0, 0.58, 1], 'ease-in-out': [0.42, 0, 0.58, 1] };
  var cache = {};
  function cssVar(name) { return getComputedStyle(root).getPropertyValue(name).trim(); }
  function parseEase(v, name) {
    var m = /^cubic-bezier\(([^)]+)\)$/.exec(v), n;
    if (m) { n = m[1].split(',').map(Number); if (n.length === 4 && n.every(isFinite)) return bezier(n[0], n[1], n[2], n[3]); }
    if (v === 'linear') return 'none';
    if (CSS_EASE[v]) { n = CSS_EASE[v]; return bezier(n[0], n[1], n[2], n[3]); }
    warn(name, 'токен ' + name + ' не заполнен или не кривая: «' + v + '»');
    return 'none';
  }
  function parseTime(v, name) {
    var m = /^(-?[\d.]+)(ms|s)$/.exec(v);
    if (m) return m[2] === 'ms' ? +m[1] / 1000 : +m[1];
    warn(name, 'токен ' + name + ' не заполнен или не длительность: «' + v + '»');
    return 0;
  }
  var T = {
    dur: function (name) { var k = 'd' + name; if (!(k in cache)) cache[k] = parseTime(cssVar(name), name); return cache[k]; },
    ease: function (name) { var k = 'e' + name; if (!(k in cache)) cache[k] = parseEase(cssVar(name), name); return cache[k]; },
    num: function (name) { return parseFloat(cssVar(name)); },
    raw: cssVar,
    /* подпись: T.sig(1) → { ease, dur } из --sig-1-ease / --sig-1-dur (паспорт — в комментарии tokens.css) */
    sig: function (n) { return { ease: T.ease('--sig-' + n + '-ease'), dur: T.dur('--sig-' + n + '-dur') }; },
    refresh: function () { cache = {}; }
  };
  ['1', '2', '3'].forEach(function (n) { Object.defineProperty(T, 'd' + n, { get: function () { return T.dur('--d-' + n); } }); });
  Object.defineProperty(T, 'eOut', { get: function () { return T.ease('--e-out'); } });
  Object.defineProperty(T, 'eInOut', { get: function () { return T.ease('--e-inout'); } });

  /* ── Lenis + GSAP. window.lenis обязателен: по нему крутят страницу buildcheck и kit.
     При reduced-motion Lenis не создаётся — прокрутка нативная (kit падает назад на window.scrollTo). ── */
  var lenis = null;
  function setupScroll(lenisOpts) {
    if (G && ST) {
      G.registerPlugin(ST);
      ['SplitText', 'Flip', 'CustomEase', 'Observer', 'Draggable'].forEach(function (n) { if (window[n]) G.registerPlugin(window[n]); });
      /* resize у ScrollTrigger забран: один общий обработчик ниже (onResize) сначала перестраивает модули, потом refresh.
         ignoreMobileResize — панель адреса телефона не дёргает пины. */
      ST.config({ ignoreMobileResize: true, autoRefreshEvents: 'visibilitychange,DOMContentLoaded,load' });
      /* твин без своих цифр берёт токены, а не power1.out / 0.5 с GSAP — лишняя кривая не появится случайно */
      if (T.d2 > 0) G.defaults({ duration: T.d2, ease: T.eOut });
    }
    if (!STATIC && ST && window.Lenis) {
      lenis = new window.Lenis(Object.assign({ autoRaf: false }, lenisOpts || {}));
      window.lenis = lenis;
      lenis.on('scroll', ST.update);
      G.ticker.add(function (t) { lenis.raf(t * 1000); });
      G.ticker.lagSmoothing(0);
    }
  }

  /* ── Прокрутка к цели. force:true — остановленный Lenis (открыта модалка) молча съедает scrollTo;
     повтор кадром позже — ранний scrollTo теряется, если раскладку только что перестроили.
     target: число px | элемент | селектор. Отступ по умолчанию — высота закреплённой шапки [data-head]. ── */
  function headOffset() {
    var h = $('[data-head]'); if (!h) return 0;
    var pos = getComputedStyle(h).position;
    return pos === 'fixed' || pos === 'sticky' ? -h.offsetHeight : 0;
  }
  function scrollTo(target, opts) {
    opts = opts || {};
    var t = typeof target === 'string' ? $(target) : target;
    if (t == null) return;
    var offset = opts.offset != null ? opts.offset : (typeof t === 'number' ? 0 : headOffset());
    if (lenis) {
      var o = Object.assign({}, opts, { offset: offset, force: true });
      lenis.scrollTo(t, o);
      if (opts.immediate) requestAnimationFrame(function () { lenis.scrollTo(t, o); });
      return;
    }
    var y = (typeof t === 'number' ? t : t.getBoundingClientRect().top + window.scrollY) + offset;
    window.scrollTo({ top: Math.max(0, y), behavior: opts.immediate || RM ? 'auto' : 'smooth' });
    if (opts.onComplete) opts.onComplete();
  }

  /* ── Якоря: плавно через Lenis, фокус переносится на цель (клавиатура и скринридер не остаются в шапке),
     адрес обновляется без прыжка. Ссылка внутри открытого оверлея сначала закрывает его. ── */
  var anchorsOn = false;
  function anchors() {
    if (anchorsOn) return; anchorsOn = true;
    d.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target.closest && e.target.closest('a[href^="#"]');
      if (!a) return;
      var hash = a.getAttribute('href'), el = null;
      if (hash.length < 2) return;
      try { el = d.getElementById(decodeURIComponent(hash.slice(1))); } catch (_) { /* битый %-код — оставляем браузеру */ }
      if (!el) return;
      e.preventDefault();
      var ov = a.closest('[data-overlay]');
      if (ov && ov.__overlay && ov.__overlay.isOpen()) ov.__overlay.close({ restoreFocus: false });
      scrollTo(el);
      if (!el.hasAttribute('tabindex') && !/^(A|BUTTON|INPUT|TEXTAREA|SELECT|SUMMARY)$/.test(el.tagName)) el.setAttribute('tabindex', '-1');
      el.focus({ preventScroll: true });
      if (history.replaceState) history.replaceState(null, '', hash);
    });
  }

  /* ── Один resize на весь сайт вместо пяти разных: модули перестраиваются, потом один refresh.
     Только высота на тач-устройстве (панель адреса) — не повод. ── */
  var resizeCbs = [], lastW = innerWidth, lastH = innerHeight, resizeBound = false;
  function bindResize() {
    if (resizeBound) return; resizeBound = true;
    addEventListener('resize', debounce(function () {
      var w = innerWidth, h = innerHeight, wChanged = w !== lastW, hChanged = h !== lastH;
      if (!wChanged && (!hChanged || COARSE)) return;
      lastW = w; lastH = h;
      resizeCbs.slice().forEach(function (cb) { try { cb({ w: w, h: h, wChanged: wChanged, hChanged: hChanged }); } catch (err) { console.error('[site] resize:', err); } });
      refresh();
    }, RESIZE_MS));
  }
  function onResize(cb) {
    resizeCbs.push(cb); bindResize();
    return function () { var i = resizeCbs.indexOf(cb); if (i > -1) resizeCbs.splice(i, 1); };
  }
  /* пины раньше триггеров: sort() ставит триггеры в порядок страницы, иначе старты считаются без pin-spacer
     и состояния сбиваются на высоту пина. Звать после любого позднего создания триггеров. */
  function refresh() { if (ST) { ST.sort(); ST.refresh(); } }

  /* ── visible: колбэк при входе/выходе из кадра. Петли rAF, ленты, шейдеры вне кадра стоят —
     иначе Chrome растеризует невидимое и прокрутка лагает. Возвращает функцию отключения. ── */
  function visible(el, cb, opts) {
    opts = opts || {};
    if (!('IntersectionObserver' in window)) { cb(true); return function () {}; }
    var io = new IntersectionObserver(function (es) { var e = es[es.length - 1]; cb(e.isIntersecting, e); },
      { rootMargin: opts.margin || '0px', threshold: opts.threshold || 0 });
    io.observe(el);
    return function () { io.disconnect(); };
  }

  /* ── Готовность: html.is-ready — флаг для проверок kit (кадр не снимается посреди boot) и старт появлений. ── */
  var isReady = false, readyCbs = [];
  function ready(cb) { if (isReady) cb(); else readyCbs.push(cb); }
  function setReady() {
    if (isReady) return; isReady = true;
    root.classList.add('is-ready');
    readyCbs.splice(0).forEach(function (cb) { try { cb(); } catch (err) { console.error('[site] ready:', err); } });
  }

  /* ── reveal: оболочка стандартного появления [data-in="text|media|line"].
     Рецепт на род — из main.js, от стиль-донора буквально: { from, to?, fade, dur, ease, stagger, delay, start }.
       from    — стартовые свойства GSAP (y, yPercent, scale, clipPath…); конец выводится сам (0 / 1), иное — в to;
       fade    — вести ли opacity (по умолчанию да); dur, ease — по умолчанию T.d2, T.eOut;
       stagger — шаг между элементами, вошедшими одним кадром; start — линия срабатывания, доля высоты окна (1 = низ).
     Без рецепта — чистое проявление на токенах.
     Что закрыто: ждущий элемент скрыт CSS без transform (лаг растеризации); старт ставит GSAP через fromTo
     (CSS-трансформ + yPercent складываются, «to» застревает); clearProps после въезда (hover и адаптив живы);
     страховка-таймер (скрытая вкладка: тикер стоит, текст не должен остаться невидимым);
     прыжок через пол-страницы и конец страницы — всё выше линии показывается, ничего не застревает. ── */
  var MOVE = /^(x|y|z|xPercent|yPercent|scale|scaleX|scaleY|rotation|rotate|rotationX|rotationY|skewX|skewY)$/;
  var NEUTRAL = { scale: 1, scaleX: 1, scaleY: 1, opacity: 1, clipPath: 'inset(0% 0% 0% 0%)' };
  function revealTo(from) {
    var to = {};
    Object.keys(from).forEach(function (k) {
      if (k === 'transformOrigin') return;
      if (k in NEUTRAL) to[k] = NEUTRAL[k]; else if (MOVE.test(k)) to[k] = 0;
    });
    return to;
  }
  function clearList(a, b) {
    var s = { opacity: 1, visibility: 1 };
    [a, b].forEach(function (o) {
      Object.keys(o).forEach(function (k) {
        if (MOVE.test(k) || k === 'transformOrigin') { s.transform = s.translate = s.rotate = s.scale = s.transformOrigin = 1; }
        else if (k !== 'autoAlpha') s[k] = 1;
      });
    });
    return Object.keys(s).join(',');
  }
  function reveal(recipes, scope) {
    recipes = recipes || {};
    var els = $$('[data-in]', scope).filter(function (el) { return !el.__in; });
    if (!els.length) return;
    var showNow = function (el) { el.__in = 2; el.classList.add('is-in'); };
    if (STATIC || !('IntersectionObserver' in window)) { els.forEach(showNow); return; }
    var recipe = function (el) {
      return Object.assign({ from: {}, fade: true, dur: T.d2, ease: T.eOut, stagger: 0, delay: 0, start: 1 },
        recipes[el.getAttribute('data-in')] || recipes['default'] || {});
    };
    var pending = els.slice(), ios = [];
    els.forEach(function (el) { el.__in = 1; });

    function play(el, i) {
      var r = recipe(el);
      var from = Object.assign(r.fade ? { autoAlpha: 0 } : {}, r.from);
      var to = Object.assign(r.fade ? { autoAlpha: 1 } : {}, revealTo(r.from), r.to || {});
      var delay = r.delay + i * r.stagger, guard;
      Object.keys(r.from).forEach(function (k) { if (k !== 'transformOrigin' && !(k in to)) warn('to-' + k, 'рецепт появления: у свойства «' + k + '» нет конечного значения — допиши to'); });
      Object.assign(to, {
        duration: r.dur, ease: r.ease, delay: delay, overwrite: 'auto', clearProps: clearList(from, to),
        onComplete: function () { clearTimeout(guard); el.__in = 2; }
      });
      el.classList.add('is-in');                 // CSS-гейт снят, в том же кадре GSAP ставит старт — вспышки нет
      var tw = G.fromTo(el, from, to);
      guard = setTimeout(function () { if (tw.progress() < 1) tw.progress(1); }, (delay + r.dur) * 1000 + 600);
    }
    function enter(list) {
      var i = 0;
      list.forEach(function (el) {
        var at = pending.indexOf(el); if (at < 0) return;
        pending.splice(at, 1);
        if (el.getBoundingClientRect().bottom <= 0) showNow(el); else play(el, i++);   // уже выше окна — без анимации
      });
      if (!pending.length) stop();
    }
    function inView(el) { var r = el.getBoundingClientRect(); return (r.width || r.height) && r.top < innerHeight && r.bottom > 0; }
    /* низ страницы и страница короче окна: линия срабатывания недостижима — показываем всё, что в кадре */
    function atEnd() { if (innerHeight + window.scrollY >= root.scrollHeight - 2) enter(pending.filter(inView)); }
    function stop() { ios.forEach(function (io) { io.disconnect(); }); ios = []; removeEventListener('scroll', atEnd); }

    ready(function () {
      var groups = {};
      pending.forEach(function (el) { var s = Math.min(1, Math.max(0.05, recipe(el).start)); (groups[s] = groups[s] || []).push(el); });
      Object.keys(groups).forEach(function (s) {
        /* зона — всё, что выше линии (огромный запас вверх): быстрый прыжок вниз тоже засчитывается, как once у ScrollTrigger */
        var io = new IntersectionObserver(function (es) {
          enter(es.filter(function (e) { return e.isIntersecting; }).map(function (e) { return e.target; }));
        }, { rootMargin: '100000px 0px ' + (-Math.round((1 - s) * 100)) + '% 0px' });
        groups[s].forEach(function (el) { io.observe(el); });
        ios.push(io);
      });
      addEventListener('scroll', atEnd, { passive: true });
      atEnd();
    });
    return { flush: function () { pending.slice().forEach(function (el) { pending.splice(pending.indexOf(el), 1); showNow(el); }); stop(); } };
  }

  /* ── splitWords: слова в .wd (не рвутся и не переносятся посередине).
     Делит по /([ \t\n\r\f]+)/, а не по \s: \s съедает неразрывный пробел, и висячие предлоги возвращаются.
     Исходный текст уходит в .sr-only, видимая копия — aria-hidden: скринридер читает «Шесть», а не «Ш Е С Т Ь».
     opts: { chars: буквы в .ch, mask: слово в маске .wd--mask > .wd__in (въезд из-под обреза) }.
     Возвращает { words, chars, revert }. Ссылки внутри не сплитить — окажутся в aria-hidden. ── */
  var WS = /([ \t\n\r\f]+)/, WS_ONLY = /^[ \t\n\r\f]+$/;
  function splitWords(el, opts) {
    opts = opts || {};
    if (el.__split) return el.__split;
    var src = Array.prototype.slice.call(el.childNodes), words = [], chars = [], label = '';
    var vis = d.createElement('span'); vis.setAttribute('aria-hidden', 'true');
    var sr = d.createElement('span'); sr.className = 'sr-only';
    function span(cls, text) { var s = d.createElement('span'); s.className = cls; if (text != null) s.textContent = text; return s; }
    function walk(node, into) {
      if (node.nodeType === 3) {
        node.textContent.split(WS).forEach(function (part) {
          if (!part) return;
          if (WS_ONLY.test(part)) { into.appendChild(d.createTextNode(' ')); label += ' '; return; }
          label += part;
          var w = span(opts.mask ? 'wd wd--mask' : 'wd'), host = w;
          if (opts.mask) { host = span('wd__in'); w.appendChild(host); }
          if (opts.chars) Array.from(part.normalize('NFC')).forEach(function (c) { var ch = span('ch', c); chars.push(ch); host.appendChild(ch); });
          else host.textContent = part;
          words.push(host); into.appendChild(w);
        });
      } else if (node.nodeType === 1) {
        if (node.nodeName === 'BR') { into.appendChild(node.cloneNode(false)); label += ' '; return; }
        var c = node.cloneNode(false);
        Array.prototype.forEach.call(node.childNodes, function (n) { walk(n, c); });
        into.appendChild(c);
      }
    }
    src.forEach(function (n) { walk(n, vis); });
    sr.textContent = label.replace(/[ \t\n\r\f]+/g, ' ').trim();
    while (el.firstChild) el.removeChild(el.firstChild);
    el.appendChild(sr); el.appendChild(vis);
    el.__split = {
      words: words, chars: chars, el: vis,
      revert: function () { while (el.firstChild) el.removeChild(el.firstChild); src.forEach(function (n) { el.appendChild(n); }); el.__split = null; }
    };
    return el.__split;
  }

  /* ── marquee: бегущая строка. Разметка: <div data-marquee><div class="трек"><div class="звено">…</div></div></div>.
     opts: { speed: px/с (от донора, обязателен) | dur: с на звено, dir: 1 | -1, extra: px запаса, lazy: true }.
     Что закрыто: клоны считаются от ширины ЗВЕНА + окна (от окна — лента пустеет на треть цикла, если звено шире окна);
     пересборка на fonts.ready и на смену ширины (иначе шаг остаётся от старого шрифта);
     вне кадра стоит; lazy — клоны и их картинки создаются только на подходе (первый экран не тяжелеет);
     extra — запас под scrub-сдвиг обёртки: самой обёртке в CSS дать width: calc(100% + сдвиг), иначе справа пустота. ── */
  function marquee(el, opts) {
    opts = opts || {};
    var track = opts.track ? $(opts.track, el) : el.firstElementChild;
    var unit = track && track.firstElementChild;
    if (!unit) return null;
    var tween = null, shown = false, built = false, offVisible = null, offResize = null;
    function build() {
      built = true;
      if (tween) { tween.kill(); tween = null; }
      Array.prototype.slice.call(track.children, 1).forEach(function (n) { n.remove(); });
      if (G) G.set(track, { x: 0 });
      var w = unit.getBoundingClientRect().width, guard = 0;
      if (!w) return;
      var cover = Math.max(innerWidth, el.getBoundingClientRect().width) + (opts.extra || 0);
      do {
        var c = unit.cloneNode(true);
        c.setAttribute('aria-hidden', 'true'); c.inert = true;
        $$('[id]', c).forEach(function (n) { n.removeAttribute('id'); });
        track.appendChild(c);
      } while (track.scrollWidth < w + cover && guard++ < 60);
      var step = track.children[1].getBoundingClientRect().left - unit.getBoundingClientRect().left;   // шаг с учётом gap
      var speed = opts.speed || (opts.dur ? step / opts.dur : 0);
      if (STATIC || !speed) { if (!STATIC) warn('marquee', 'marquee: не задана скорость (opts.speed, px/с) — лента стоит'); return; }
      var back = opts.dir === -1;
      tween = G.fromTo(track, { x: back ? -step : 0 }, { x: back ? 0 : -step, duration: step / speed, ease: 'none', repeat: -1, paused: !shown });
    }
    function start() {
      build();
      offVisible = visible(el, function (v) { shown = v; if (tween) { if (v) tween.play(); else tween.pause(); } });
      offResize = onResize(function (r) { if (r.wChanged) build(); });
      if (d.fonts && d.fonts.ready && d.fonts.status !== 'loaded') d.fonts.ready.then(function () { if (built) build(); });
    }
    if (opts.lazy && 'IntersectionObserver' in window) {
      var offLazy = visible(el, function (v) { if (v) { offLazy(); start(); } }, { margin: '100% 0px' });
    } else start();
    return {
      rebuild: build,
      get tween() { return tween; },
      kill: function () { if (tween) tween.kill(); if (offVisible) offVisible(); if (offResize) offResize(); }
    };
  }

  /* ── overlay: меню и модальные окна. Разметка: <div id="menu" data-overlay="menu|modal" hidden>,
     открывающая кнопка — aria-controls="menu", закрывающие внутри — [data-close].
     opts: { onOpen(el), onClose(el, done), focus: селектор первого фокуса, keep: селектор того, что остаётся живым }.
     Что закрыто: гард isOpen (Enter на карточке + обработчик библиотеки открывали дважды, фокус терялся);
     killTweensOf и гард в done (быстрые клики); inert на фоне вместо ловушки Tab; Esc; фокус возвращается
     открывшему через rAF после снятия inert; Lenis стоит, сам оверлей крутится нативно (data-lenis-prevent);
     флаг состояния — на body (селектор .секция.is-open не достаёт до элементов в другой секции). ── */
  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  function overlay(el, opts) {
    if (!el) return null;
    if (el.__overlay) return el.__overlay;
    opts = opts || {};
    var isOpen = false, opener = null;
    var kind = el.getAttribute('data-overlay') || 'menu';
    var keep = opts.keep || (kind === 'modal' ? null : '[data-head]');
    var flagName = 'is-' + (el.id || 'overlay') + '-open';
    el.setAttribute('data-lenis-prevent', '');
    function behind() {
      return Array.prototype.filter.call(d.body.children, function (n) {
        return n !== el && !n.contains(el) && !/^(SCRIPT|STYLE|LINK)$/.test(n.nodeName) && !(keep && n.matches(keep));
      });
    }
    function controls() { return el.id ? $$('[aria-controls="' + el.id + '"]') : []; }
    function sync() {
      controls().forEach(function (c) { c.setAttribute('aria-expanded', String(isOpen)); });
      d.body.classList.toggle(flagName, isOpen);
    }
    function open(from) {
      if (isOpen) return;
      isOpen = true;
      opener = (from && from.focus ? from : null) || d.activeElement;
      if (G) G.killTweensOf(el);
      el.hidden = false;
      behind().forEach(function (n) { n.inert = true; });
      if (lenis) lenis.stop();
      sync();
      if (opts.onOpen) opts.onOpen(el);
      if (opts.focus !== false) requestAnimationFrame(function () { var f = $(opts.focus || FOCUSABLE, el); if (f && isOpen) f.focus(); });
    }
    function close(o) {
      if (!isOpen) return;
      isOpen = false;
      if (G) G.killTweensOf(el);
      behind().forEach(function (n) { n.inert = false; });
      if (lenis) lenis.start();
      sync();
      var done = function () { if (!isOpen) el.hidden = true; };   // успели открыть снова — не прятать
      if (opts.onClose) opts.onClose(el, done); else done();
      if (!o || o.restoreFocus !== false) requestAnimationFrame(function () { if (opener && opener.focus) opener.focus(); });
    }
    controls().forEach(function (c) { c.addEventListener('click', function () { if (isOpen) close(); else open(c); }); });
    el.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('[data-close]')) close(); });
    d.addEventListener('keydown', function (e) { if (e.key === 'Escape' && isOpen) close(); });
    sync();
    el.__overlay = { open: open, close: close, toggle: function (from) { if (isOpen) close(); else open(from); }, isOpen: function () { return isOpen; } };
    return el.__overlay;
  }

  /* ── pin: оболочка закреплённой секции [data-pin].
     opts: { media: доп. условие, build(el) → твин/таймлайн под scrub, end: функция или '+=px',
             panels: селектор панелей, scrub, st: доп. поля ScrollTrigger, cleanup(el) }.
     Что закрыто: пин живёт только при (min-height: 780px) и без reduced-motion — иначе секция идёт потоком (.is-static);
     focusin ведёт прокрутку к панели с фокусом (Tab не уходит за экран) и возвращает scrollLeft бокса;
     ветка gsap.matchMedia сама откатывает твины, а всё, что ставилось через el.style, — в cleanup
     (иначе после ресайза десктоп получает мобильные инлайн-стили; помощник — site.styles()).
     В CSS у секции overflow: clip (base.css), не hidden. tabindex у ссылок — только в активной панели. ── */
  function pin(el, opts) {
    opts = opts || {};
    if (STATIC || !ST) { el.classList.add('is-static'); return null; }
    var cond = [opts.media, '(min-height: ' + (opts.minHeight || PIN_MIN_H) + 'px)', '(prefers-reduced-motion: no-preference)'].filter(Boolean).join(' and ');
    var st = null, mm = G.matchMedia();
    if (!matchMedia(cond).matches) el.classList.add('is-static');
    mm.add(cond, function () {
      el.classList.remove('is-static'); el.classList.add('is-pinned');
      var anim = opts.build ? opts.build(el) : null;
      st = ST.create(Object.assign({
        trigger: el, start: 'top top', end: opts.end || function () { return '+=' + innerHeight; },
        pin: true, scrub: opts.scrub != null ? opts.scrub : true, animation: anim || undefined,
        invalidateOnRefresh: true, anticipatePin: 1
      }, opts.st || {}));
      var panels = opts.panels ? $$(opts.panels, el) : [];
      function onFocus(e) {
        var i = -1;
        panels.forEach(function (p, k) { if (p.contains(e.target)) i = k; });
        if (i < 0 || !st) return;
        scrollTo(st.start + (st.end - st.start) * i / Math.max(1, panels.length - 1), { immediate: true, offset: 0 });
        for (var n = e.target.parentElement; n && n !== d.body; n = n.parentElement) { if (n.scrollLeft) n.scrollLeft = 0; if (n === el) break; }
      }
      if (panels.length) el.addEventListener('focusin', onFocus);
      return function () {
        el.removeEventListener('focusin', onFocus);
        el.classList.remove('is-pinned'); el.classList.add('is-static');
        if (opts.cleanup) opts.cleanup(el);
        st = null;
      };
    });
    return { mm: mm, get trigger() { return st; }, kill: function () { mm.revert(); } };
  }

  /* ── counter: счётчик от from до числа в тексте элемента. Конечный текст остаётся в разметке (без JS виден он),
     скринридеру отдаётся он же. opts: { from, to, dur, ease, format(n) }.
     Кривая по умолчанию — --e-inout: с резкой out-кривой 90 % значений проскакивают за первые 100 мс.
     Ширина цифр не дёргает строку — класс .num (tabular-nums). ── */
  function counter(el, opts) {
    opts = opts || {};
    var text = el.textContent, m = /^(\D*?)(\d(?:[\d\s.,]*\d)?)(.*)$/.exec(text.trim());
    var to = opts.to != null ? opts.to : (m ? parseFloat(m[2].replace(/\s/g, '').replace(',', '.')) : NaN);
    if (STATIC || !isFinite(to)) return null;
    var fmt = opts.format || function (n) { return (m ? m[1] : '') + Math.round(n).toLocaleString('ru-RU') + (m ? m[3] : ''); };
    var o = { v: opts.from || 0 };
    var sr = d.createElement('span'); sr.className = 'sr-only'; sr.textContent = text;
    var vis = d.createElement('span'); vis.setAttribute('aria-hidden', 'true'); vis.textContent = fmt(o.v);
    el.textContent = ''; el.appendChild(sr); el.appendChild(vis);
    var off = visible(el, function (v) {
      if (!v) return; off();
      G.to(o, { v: to, duration: opts.dur || T.d3, ease: opts.ease || T.eInOut,
        onUpdate: function () { vis.textContent = fmt(o.v); }, onComplete: function () { vis.textContent = text; } });
    });
    return { kill: off };
  }

  /* ── draw: рисование линии svg. pathLength=100 и дробный offset вручную:
     GSAP округляет stroke-dashoffset до целых px, при pathLength=1 линия «рисуется» одним прыжком.
     Без JS и при reduced-motion линия просто видна. opts: { dur, ease, tween: доп. поля (paused, delay…) }. ── */
  function draw(path, opts) {
    opts = opts || {};
    var set = function (v) { path.style.strokeDashoffset = String(v); };
    path.setAttribute('pathLength', '100');
    path.style.strokeDasharray = '100';
    if (STATIC) { set(0); return null; }
    var o = { v: 100 }; set(100);
    return G.to(o, Object.assign({ v: 0, duration: opts.dur || T.d3, ease: opts.ease || T.eInOut, onUpdate: function () { set(o.v); } }, opts.tween || {}));
  }

  /* ── styles: запоминает инлайн-стили, поставленные руками, и возвращает их в cleanup ветки matchMedia/пина. ── */
  function styles() {
    var log = [];
    return {
      set: function (el, props) {
        Object.keys(props).forEach(function (k) {
          var custom = k.indexOf('--') === 0;
          log.push([el, k, custom ? el.style.getPropertyValue(k) : el.style[k]]);
          if (custom) el.style.setProperty(k, props[k]); else el.style[k] = props[k];
        });
      },
      revert: function () {
        while (log.length) { var r = log.pop(); if (r[1].indexOf('--') === 0) r[0].style.setProperty(r[1], r[2]); else r[0].style[r[1]] = r[2]; }
      }
    };
  }

  /* флаг состояния — на body: летящие элементы и их цели живут в разных секциях */
  function flag(name, on) { d.body.classList.toggle(name, on); }

  /* копирование (ник, почта). Запасной путь — window.open, не location.href:
     навигация на tg:/mailto: оставляет страницу в «ожидании перехода» и ломает всё, что после */
  function copy(text, fallbackUrl) {
    var fb = function () { if (fallbackUrl) window.open(fallbackUrl, '_blank', 'noopener'); return false; };
    if (!navigator.clipboard || !navigator.clipboard.writeText) return Promise.resolve(fb());
    return navigator.clipboard.writeText(text).then(function () { return true; }, fb);
  }

  /* ── boot: единственный вход. main.js: site.boot(function (site) { …по одному init на паспорт… }).
     Порядок: Lenis+GSAP → init (сначала пины, потом триггеры) → оверлеи, якоря, появление для оставшихся [data-in]
     → ScrollTrigger.sort() → document.fonts.ready (шрифт меняет высоты) → sort + refresh → html.is-ready.
     init может вернуть Promise (загрузчик, интро) — is-ready дождётся его, но не дольше READY_CAP.
     Исключение в init не прячет сайт: всё показывается статикой, ошибка остаётся в консоли для проверок. ── */
  var booted = false;
  function boot(init, opts) {
    if (booted) return; booted = true;
    opts = opts || {};
    function run() {
      var wait = null, t0 = Date.now();
      site.booted = true;                        // страховка в index.html больше не вмешивается: до is-ready доводит ядро
      try {
        if (!G) { root.classList.add('is-static'); warn('gsap', 'gsap не загружен — сайт показан статикой'); }
        setupScroll(opts.lenis);
        bindResize();
        if (init) wait = init(site);
      } catch (err) {
        root.classList.add('is-static');
        console.error('[site] init:', err);
      }
      try { $$('[data-overlay]').forEach(function (el) { overlay(el); }); anchors(); reveal(); } catch (err) { root.classList.add('is-static'); console.error('[site] boot:', err); }
      if (ST) ST.sort();
      var fonts = d.fonts && d.fonts.ready ? d.fonts.ready : Promise.resolve();
      var cap = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
      Promise.race([fonts, cap(FONTS_CAP)])
        .then(function () { refresh(); return wait && wait.then ? Promise.race([wait, cap(Math.max(0, READY_CAP - (Date.now() - t0)))]) : null; })
        .catch(function (err) { console.error('[site] boot:', err); })
        .then(function () {
          /* адрес с якорем: нативный прыжок не знает про pin-spacer и шапку */
          var el = null;
          try { el = location.hash.length > 1 ? d.getElementById(decodeURIComponent(location.hash.slice(1))) : null; } catch (_) { /* битый хеш */ }
          if (el) scrollTo(el, { immediate: true });
          setReady();
        });
    }
    if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', run, { once: true }); else run();
  }

  var site = {
    RM: RM, STATIC: STATIC, booted: false, T: T, $: $, $$: $$,
    boot: boot, ready: ready, refresh: refresh,
    scrollTo: scrollTo, anchors: anchors,
    reveal: reveal, splitWords: splitWords,
    marquee: marquee, overlay: overlay, pin: pin,
    counter: counter, draw: draw,
    visible: visible, onResize: onResize, debounce: debounce,
    styles: styles, flag: flag, copy: copy
  };
  Object.defineProperty(site, 'lenis', { get: function () { return lenis; } });
  window.site = site;
})();
