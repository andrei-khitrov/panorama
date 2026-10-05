/* main.js — сборка PANORAMA. По одному init на паспорт CASTING.md; цифры механик — от vectrfl.com,
   длительности и кривые — токены (site.T). */
(function () {
  'use strict';

  /* [?] Адрес для заявок — в материалах проекта контактов нет. Заменить перед публикацией. */
  var CONTACT_EMAIL = 'invest@panorama.example';

  site.boot(function (site) {
    var $ = site.$, $$ = site.$$, T = site.T, G = window.gsap, ST = window.ScrollTrigger;
    var root = document.documentElement;

    var loader = initLoader();
    initHeader(loader.done);
    initHero(loader.done);
    var flow = initFlow();
    initStage(flow, loader);
    initCards();
    initSeasons();
    initFaq();
    initBars();
    initAlloc();
    initFly();
    initFooter();
    initForm();

    site.reveal({
      /* .sub-section донора: opacity 0, translateY(60px) → 0, 1 с (.16,1,.3,1); тело позже заголовка на .1 с */
      text: { from: { y: 60 }, dur: T.d2, ease: T.eOut, stagger: 0.1, start: 0.92 },
      media: { from: { y: 60 }, dur: T.d2, ease: T.eOut, stagger: 0.167, start: 0.95 }
    });

    return loader.done;

    /* ── 01 · шапка: въезд translateY(-100%) → 0 за 1.2 с (.25,1,.5,1); над тёмными секциями — светлая (header--white),
       над светлым контентом — подложка и линия (header.sub-page донора), над сценой — прозрачная ── */
    function initHeader(done) {
      var head = $('.head');
      done.then(function () { head.classList.add('show'); });
      var dark = $$('.theme-dark'), scenes = [$('.hero'), $('.flow')];
      var tick = false;
      function check() {
        tick = false;
        var h = head.offsetHeight;
        var over = function (el) { var r = el.getBoundingClientRect(); return r.top < h && r.bottom > 0; };
        var onDark = dark.some(over), onScene = scenes.some(function (el) { return el && over(el); });
        head.classList.toggle('head--white', onDark);
        head.classList.toggle('head--solid', !onDark && !onScene);
      }
      addEventListener('scroll', function () { if (!tick) { tick = true; requestAnimationFrame(check); } }, { passive: true });
      site.onResize(check);
      check();
    }

    /* ── 01 · первый экран: влёт заголовка — CSS-переход по .show (1.5 с, perspective-поворот донора);
       уход по скроллу — fromTo(Ii, Di, .7) с прогрессом scrollY / (0.4 · innerHeight), Di.ease = sine.in ── */
    function initHero(done) {
      var hero = $('.hero'), content = $('.hero__content');
      done.then(function () { requestAnimationFrame(function () { hero.classList.add('show'); }); });
      if (site.STATIC || !G) return;
      var Ii = { opacity: 1, xPercent: 0, x: 0, y: 0, rotateY: 0, rotateX: 0, transformPerspective: 1000 };
      var Di = { opacity: 0, xPercent: -50, x: 222.2, y: -88, rotateY: -60, rotateX: -35, transformPerspective: 1000, ease: 'sine.in', immediateRender: false };
      var tl = null, armed = false, tick = false;
      function update() {
        tick = false;
        var y = window.scrollY, p = Math.max(0, Math.min(1, y / (innerHeight * 0.4)));
        hero.classList.toggle('hide', y > 8);
        if (!armed && p > 0) {
          armed = true;
          content.style.transition = 'none';
          tl = G.timeline({ paused: true }).fromTo(content, Ii, Object.assign({}, Di, { duration: 0.7 }), 0);
        }
        if (tl) tl.progress(p);
        if (window.stage && window.stage.ok && !flowActive()) window.stage.hero(Math.min(1, y / innerHeight));
      }
      function flowActive() { var f = $('.flow').getBoundingClientRect(); return f.top < innerHeight * 0.5; }
      addEventListener('scroll', function () { if (!tick) { tick = true; requestAnimationFrame(update); } }, { passive: true });
      setTimeout(update, 1600);
    }

    /* ── 03 · flow: секция 570svh, обёртка sticky 100svh; шаги — 5 равных долей прогресса;
       заливка трека scaleY по прогрессу шага; клик по шагу — lenis.scrollTo(h, { duration: 1.2 }) ── */
    function initFlow() {
      var sec = $('.flow'), wrap = $('.flow__wrapper');
      var steps = $$('.flow__step', sec), fills = steps.map(function (s) { return $('.flow__track-fill', s); });
      var legend = $('[data-legend]'), lt = $('[data-legend-title]'), llo = $('[data-legend-lo]'), lhi = $('[data-legend-hi]');
      var N = steps.length, cur = -1, legendMode = '';
      sec.classList.add('flow--live');
      var state = { step: 1, local: 0, inside: false };

      function setLegend(mode) {
        if (mode === legendMode) return;
        legendMode = mode;
        legend.hidden = !mode;
        if (mode === 'sun') { lt.textContent = 'Прямое солнце во дворе, часов в день'; llo.textContent = 'менее 1'; lhi.textContent = '7'; }
        if (mode === 'soil') { lt.textContent = 'Грунт над паркингом, метров'; llo.textContent = '1'; lhi.textContent = '2,7'; }
      }
      var span = 1, secTop = 0, tick = false;
      function measure() {
        span = Math.max(sec.offsetHeight - wrap.offsetHeight, 1);
        secTop = sec.getBoundingClientRect().top + window.scrollY;
      }
      function schedule() { if (!tick) { tick = true; requestAnimationFrame(function () { tick = false; update(); }); } }
      function update() {
        var top = secTop - window.scrollY;
        var p = Math.max(0, Math.min(1, -top / span));
        var i = Math.min(N - 1, Math.floor(p * N)), local = p * N - i;
        if (i !== cur) {
          steps.forEach(function (s, k) {
            var on = k === i;
            if (s.classList.contains('flow__step--active') && !on) s.classList.add('flow__step--visited');
            s.classList.toggle('flow__step--active', on);
            $('.flow__btn', s).setAttribute('aria-current', on ? 'step' : 'false');
          });
          cur = i;
        }
        fills.forEach(function (f, k) { var b = p * N >= k + 1 ? 1 : p * N > k ? p * N - k : 0; f.style.transform = 'scaleY(' + b.toFixed(4) + ')'; });
        state.step = i + 1; state.local = local;
        state.inside = top < innerHeight * 0.5 && top + span + innerHeight > innerHeight * 0.5;
        var live = window.stage && window.stage.ok;
        setLegend(live && state.inside && i === 0 ? (local > 0.5 ? 'soil' : 'sun') : '');
        if (window.stage && window.stage.ok && state.inside) window.stage.flow(state.step, local);
      }
      steps.forEach(function (s, d) {
        $('.flow__header', s).addEventListener('click', function () {
          if (s.classList.contains('flow__step--active')) return;
          measure();
          site.scrollTo(secTop + (d / N + 0.04) * span, { duration: 1.2, offset: 0 });
        });
      });
      if (ST) ST.create({ trigger: sec, start: 'top bottom', end: 'bottom top', onUpdate: schedule, onRefresh: function () { measure(); update(); } });
      else addEventListener('scroll', schedule, { passive: true });
      document.addEventListener('stage:ready', schedule);
      measure(); update();
      return state;
    }

    /* ── Сцена: three.js грузится после первого кадра (preload в head уже тянет файл), постер — до готовности.
       Рисует только когда в кадре первый экран или пин flow ── */
    function initStage(flowState, loader) {
      var stageEl = $('.stage'), hero = $('.hero'), sec = $('.flow');
      var vis = { hero: true, flow: false };
      function load(src) {
        return new Promise(function (res, rej) {
          var s = document.createElement('script'); s.src = src; s.async = false;
          s.onload = res; s.onerror = function () { rej(new Error('не загрузился ' + src)); };
          document.head.appendChild(s);
        });
      }
      function sync() {
        var st = window.stage; if (!st || !st.ok) return;
        var on = vis.hero || vis.flow;
        stageEl.classList.toggle('is-idle', !on);
        st.run(on);
      }
      site.visible(hero, function (v) { vis.hero = v; sync(); });
      site.visible(sec, function (v) { vis.flow = v; sync(); });
      document.addEventListener('stage:ready', function () {
        var st = window.stage;
        if (flowState.inside) st.flow(flowState.step, flowState.local); else st.hero(Math.min(1, window.scrollY / innerHeight));
        st.snap();
        st.run(true);
        loader.step(100);
        loader.done.then(function () { stageEl.classList.add('is-live'); sync(); });
        site.onResize(function () { st.resize(); });
      });
      /* three.js — сразу (под загрузочным экраном), а не после всех картинок */
      load('assets/js/vendor/three.min.js')
        .then(function () { loader.step(72); return load('assets/js/scene-data.js'); })
        .then(function () { return load('assets/js/scene.js'); })
        .then(function () { if (!window.stage) loader.fail(); })   // нет WebGL — сцены не будет, остаётся постер
        .catch(function (err) { console.warn('[stage]', err.message); loader.fail(); });
    }

    /* ── 00 · загрузочный экран (vectrfl.com #loader): уходит, когда 3D-макет нарисовал первый кадр.
       Не меньше времени прорисовки (первый заход 2 с, повторный в сессии 0.7 с), не дольше 7 с.
       Прогресс — по этапам: ядро 20, шрифты 35, three.js 72, первый кадр 100. Возвращает done — промис ухода ── */
    function initLoader() {
      var el = $('.loader'), pct = $('[data-loader-pct]');
      var t0 = performance.now(), KEY = 'panorama-loaded', seen = false;
      try { seen = sessionStorage.getItem(KEY) === '1'; sessionStorage.setItem(KEY, '1'); } catch (e) { /* приватный режим */ }
      var MIN = site.RM ? 0 : seen ? 700 : 2000, CAP = 7000;
      var shown = { v: 0 }, target = 0, finished = false, resolveDone;
      var done = new Promise(function (r) { resolveDone = r; });
      /* пока грузится: прокрутка стоит, фокус не уходит под загрузочный экран */
      var locked = [$('.head'), $('main'), $('.foot')].filter(Boolean);
      if (el && !site.RM) {
        locked.forEach(function (n) { n.inert = true; });
        if (site.lenis) site.lenis.stop();
      }
      done.then(function () {
        locked.forEach(function (n) { n.inert = false; });
        if (site.lenis) site.lenis.start();
      });
      var zones = el ? $$('.loader__zone', el) : [];
      function paint() {
        if (pct) pct.textContent = Math.round(shown.v) + '\u202f%';
        var on = Math.round(shown.v / 100 * zones.length);       // 16 зон — 16 делений
        zones.forEach(function (z, i) { z.classList.toggle('is-on', i < on); });
      }
      function step(v) {
        if (v <= target) return;
        target = v;
        if (G && !site.RM) G.to(shown, { v: v, duration: T.d1 * 2, ease: T.eOut, overwrite: true, onUpdate: paint });
        else { shown.v = v; paint(); }
        if (v >= 100) finish();
      }
      function finish() {
        if (finished) return; finished = true;
        var wait = Math.max(0, MIN - (performance.now() - t0)) + 250;
        setTimeout(function () {
          if (!el) { root.classList.remove('is-loading'); resolveDone(); return; }
          el.classList.add('hide');
          /* первый экран влетает, пока стираются эллипсы: через .5 с — как уход знака у донора */
          setTimeout(function () { root.classList.remove('is-loading'); resolveDone(); }, site.RM ? 0 : 500);
          setTimeout(function () { el.hidden = true; }, site.RM ? 0 : 2400);
        }, wait);
      }
      step(20);
      (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(function () { step(35); });
      setTimeout(function () { step(100); }, CAP);              // страховка: сцена не поднялась — сайт всё равно открывается
      return { done: done, step: step, fail: function () { step(100); } };
    }

    /* ── 02, 07 · карточки (features донора): {opacity:0, y:80} → {1, 0}, 1 с power2.out;
       прогресс карточки L = (u − y)/(ŷ − y), h = 1/n, f = .3h. Пина нет (паспорт 02) — u = проход сетки через окно.
       Как у донора, только при ширине от 1201px ── */
    function initCards() {
      if (site.STATIC || !G || !ST) return;
      $$('[data-cards]').forEach(function (grid) {
        var items = $$('.card4__content', grid);
        var mm = G.matchMedia();
        mm.add('(min-width: 1201px)', function () {
          G.set(items, { opacity: 0, y: 80 });
          var tws = items.map(function (el) { return G.to(el, { opacity: 1, y: 0, duration: 1, ease: 'power2.out', paused: true }); });
          var n = items.length, h = 1 / n, f = h * 0.3;
          var stt = ST.create({
            trigger: grid, start: 'top 88%', end: 'bottom 62%',
            onUpdate: function (self) {
              var u = self.progress;
              tws.forEach(function (tw, w) {
                var y = w * h - (w > 0 ? f : 0), y2 = y + h + f;
                tw.progress(Math.max(0, Math.min(1, (u - y) / (y2 - y))));
              });
            },
            onRefresh: function (self) { if (self.progress >= 1) tws.forEach(function (tw) { tw.progress(1); }); }
          });
          return function () { stt.kill(); tws.forEach(function (tw) { tw.kill(); }); G.set(items, { clearProps: 'opacity,transform' }); };
        });
      });
    }

    /* ── 06 · сезоны (stat-carousel донора): is-active у кадра, индикатора и текста; стрелки disabled на краях ── */
    function initSeasons() {
      var box = $('[data-seasons]'); if (!box) return;
      var slides = $$('.seasons__slide', box), texts = $$('.seasons__text', box), tabs = $$('.seasons__tab', box);
      var prev = $('.seasons__arrow--prev', box), next = $('.seasons__arrow--next', box), cur = 0;
      function go(i, focus) {
        if (i < 0 || i >= slides.length || i === cur) return;
        slides[cur].classList.remove('is-active'); slides[cur].setAttribute('aria-hidden', 'true');
        slides[i].classList.add('is-active'); slides[i].removeAttribute('aria-hidden');
        texts[cur].classList.remove('is-active'); texts[cur].hidden = true; texts[i].hidden = false; texts[i].classList.add('is-active');
        tabs[cur].classList.remove('is-active'); tabs[cur].setAttribute('aria-selected', 'false'); tabs[cur].tabIndex = -1;
        tabs[i].classList.add('is-active'); tabs[i].setAttribute('aria-selected', 'true'); tabs[i].tabIndex = 0;
        if (focus) tabs[i].focus();
        cur = i;
        prev.disabled = cur === 0; next.disabled = cur === slides.length - 1;
      }
      tabs.forEach(function (t, i) {
        t.tabIndex = i ? -1 : 0;
        t.addEventListener('click', function () { go(i); });
        t.addEventListener('keydown', function (e) {
          if (e.key === 'ArrowRight') { e.preventDefault(); go(Math.min(slides.length - 1, cur + 1), true); }
          if (e.key === 'ArrowLeft') { e.preventDefault(); go(Math.max(0, cur - 1), true); }
          if (e.key === 'Home') { e.preventDefault(); go(0, true); }
          if (e.key === 'End') { e.preventDefault(); go(slides.length - 1, true); }
        });
      });
      prev.addEventListener('click', function () { go(cur - 1); });
      next.addEventListener('click', function () { go(cur + 1); });
      /* кадры соседних сезонов — заранее, чтобы смена не мигала */
      site.visible(box, function (v) { if (v) slides.forEach(function (s) { var im = $('img', s); if (im.loading === 'lazy') im.loading = 'eager'; }); }, { margin: '50% 0px' });
    }

    /* ── 10 · FAQ донора: max-height 0 ↔ scrollHeight, .6 с ease; шеврон rotate(180deg) → 0 за .3 с ── */
    function initFaq() {
      $$('.faq-item').forEach(function (item, i) {
        var btn = $('.faq-item__header', item), body = $('.faq-item__content', item);
        function open() { item.classList.add('faq-item--open'); btn.setAttribute('aria-expanded', 'true'); body.style.maxHeight = '0px'; void body.offsetHeight; body.style.maxHeight = body.scrollHeight + 'px'; }
        function close() { body.style.maxHeight = body.scrollHeight + 'px'; void body.offsetHeight; body.style.maxHeight = '0px'; item.classList.remove('faq-item--open'); btn.setAttribute('aria-expanded', 'false'); }
        btn.addEventListener('click', function () { if (item.classList.contains('faq-item--open')) close(); else open(); });
        body.addEventListener('transitionend', function () { site.refresh(); });
        if (i === 0) open();
      });
      site.onResize(function () { $$('.faq-item--open .faq-item__content').forEach(function (b) { b.style.maxHeight = b.scrollHeight + 'px'; }); });
    }

    /* ── 08 · полосы цен: scaleX 0 → 1 за --d-3 со сдвигом .08 с при входе ── */
    function initBars() {
      var box = $('[data-bars]'); if (!box || site.STATIC || !G) return;
      var fills = $$('.bars__fill', box);
      G.set(fills, { scaleX: 0, transformOrigin: '0% 50%' });
      var off = site.visible(box, function (v) {
        if (!v) return; off();
        G.to(fills, { scaleX: 1, duration: T.d3, ease: T.eOut, stagger: 0.08, clearProps: 'transform' });
      }, { margin: '0px 0px -20% 0px' });
    }
    function initAlloc() {
      var box = $('[data-alloc]'); if (!box || site.STATIC || !G) return;
      var segs = $$('.alloc__seg', box);
      G.set(segs, { scaleX: 0, transformOrigin: '0% 50%' });
      var off = site.visible(box, function (v) {
        if (!v) return; off();
        G.to(segs, { scaleX: 1, duration: T.d3, ease: T.eOut, stagger: 0.08, clearProps: 'transform' });
      }, { margin: '0px 0px -20% 0px' });
    }

    /* ── 11 · заголовки-влёты (.request-crew__title донора): тот же perspective-переход, по входу в кадр ── */
    function initFly() {
      $$('.fly').forEach(function (el) {
        var off = site.visible(el, function (v) { if (v) { el.classList.add('is-shown'); off(); } }, { margin: '0px 0px -15% 0px' });
      });
    }

    /* ── подвал: строки знака translateY(calc(100% + 2px)) → 0, .8 с, шаг .06 с; IntersectionObserver порог .2 ── */
    function initFooter() {
      var bottom = $('.foot__bottom');
      site.visible(bottom, function (v) { if (v) bottom.classList.add('is-visible'); }, { threshold: 0.2 });
    }

    /* ── 12 · форма: клиентская валидация, состояния focus / error / success; письмо — в почтовом клиенте ── */
    function initForm() {
      var form = $('#contact-form'); if (!form) return;
      var success = $('.form__success', form);
      var fields = {
        name: { el: $('#f-name'), err: $('#f-name-err'), test: function (v) { return v.trim().length >= 2 ? '' : 'Напишите, как к вам обращаться'; } },
        contact: { el: $('#f-contact'), err: $('#f-contact-err'), test: function (v) {
          v = v.trim();
          if (!v) return 'Нужна почта или телефон для ответа';
          var mail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v), phone = v.replace(/\D/g, '').length >= 10 && /^[+\d\s()\-]+$/.test(v);
          return mail || phone ? '' : 'Проверьте адрес или номер';
        } },
        consent: { el: $('#f-consent'), err: $('#f-consent-err'), test: function () { return $('#f-consent').checked ? '' : 'Без согласия мы не сможем ответить'; } }
      };
      function check(key) {
        var f = fields[key], msg = f.test(f.el.type === 'checkbox' ? '' : f.el.value);
        f.err.textContent = msg;
        f.el.classList.toggle('is-error', !!msg);
        f.el.setAttribute('aria-invalid', msg ? 'true' : 'false');
        if (msg) f.el.setAttribute('aria-describedby', f.err.id); else f.el.removeAttribute('aria-describedby');
        return !msg;
      }
      Object.keys(fields).forEach(function (k) {
        var el = fields[k].el;
        el.addEventListener(el.type === 'checkbox' ? 'change' : 'blur', function () { if (el.value || el.type === 'checkbox' || el.classList.contains('is-error')) check(k); });
        el.addEventListener('input', function () { if (el.classList.contains('is-error')) check(k); });
      });
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var ok = Object.keys(fields).map(check).every(Boolean);
        if (!ok) { var bad = $('.is-error', form); if (bad) bad.focus(); return; }
        var data = new FormData(form);
        var body = [
          'Роль: ' + data.get('role'),
          'Имя: ' + data.get('name'),
          'Организация: ' + (data.get('org') || '—'),
          'Контакт: ' + data.get('contact'),
          '',
          String(data.get('message') || '')
        ].join('\n');
        var href = 'mailto:' + CONTACT_EMAIL + '?subject=' + encodeURIComponent('PANORAMA — заявка: ' + data.get('role')) + '&body=' + encodeURIComponent(body);
        var mail = $('[data-mail]', success);
        mail.textContent = CONTACT_EMAIL; mail.href = 'mailto:' + CONTACT_EMAIL;
        $('[data-copy]', success).onclick = function () {
          var btn = this;
          site.copy('Кому: ' + CONTACT_EMAIL + '\n\n' + body).then(function (done) { if (done) btn.textContent = 'Скопировано'; });
        };
        success.hidden = false;
        success.setAttribute('tabindex', '-1');
        success.focus();
        window.location.href = href;
      });
    }
  });
})();
