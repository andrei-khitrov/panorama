/* scene.js — белый макет пилотного двора (корпус 1, ЖК «Life Варшавская»), three.js r160 UMD.
   Геометрия корпусов — по листу ПЗУ (1197-04-ПЗУ, графическая часть) и схемам концепции
   благоустройства (листы 8, 23, 53.1) в масштабе 1 pt = 0,3528 м. Двор — по плану 53.1.
   Состояния сцены соответствуют шагам секции «Как работает» (паспорт 03, CASTING.md).

   API: window.stage = {
     ok,                       — WebGL поднялся
     run(on),                  — крутить кадр или стоять (вне кадра сцена не рисуется)
     hero(p),                  — первый экран, p — уход по скроллу 0…1
     flow(step, local),        — шаг 1…5 и прогресс внутри шага 0…1
     resize()
   }
   Движение — демпфирование к целевым значениям (камера и состояния), без собственных кривых:
   скорость сходимости одна на всю сцену. При reduced-motion значения ставятся сразу. */
(function () {
  'use strict';
  var THREE = window.THREE;
  var canvas = document.querySelector('.stage__canvas');
  var labelsHost = document.querySelector('.stage__labels');
  if (!THREE || !canvas) return;

  var RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var css = getComputedStyle(document.documentElement);
  function tok(name) { return css.getPropertyValue(name).trim(); }
  function col(name) { return new THREE.Color(tok(name)); }
  var C = {
    scene: col('--c-scene'), accent: col('--c-accent'), ink: col('--c-text'),
    white: col('--m-white'), slab: col('--m-slab'), paving: col('--m-paving'), lane: col('--m-lane'),
    green: col('--m-green'), sand: col('--m-sand'), court: col('--m-court'), canopy: col('--m-canopy'),
    trunk: col('--m-trunk'), pipeIdle: col('--m-pipe'), off: col('--m-pipe-off'),
    shadow: col('--m-shadow'), sky: col('--m-sky'), bounce: col('--m-bounce'), sun: col('--m-sun'), dataLo: col('--m-data-lo')
  };

  /* ── WebGL ── */
  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  } catch (e) { console.warn('[stage] WebGL недоступен — остаётся постер'); return; }
  var COARSE = matchMedia('(max-width: 767px)').matches;
  /* плотность пикселей: потолок 1.5 (на ретине 1.75 давал +36 % пикселей при той же картинке);
     если кадры тяжёлые — снижается сама до 1 (см. adapt) */
  var DPR_MAX = Math.min(window.devicePixelRatio || 1, 1.5), dpr = DPR_MAX;
  renderer.setPixelRatio(dpr);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(C.scene, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;   // тени пересчитываются только во время переходов (shadowSig)

  var scene = new THREE.Scene();
  scene.fog = new THREE.Fog(C.scene, 420, 980);
  var camera = new THREE.PerspectiveCamera(40, 1, 1, 2000);   // fov 40 — как у донора

  scene.add(new THREE.HemisphereLight(C.sky, C.bounce, 2.0));
  var sun = new THREE.DirectionalLight(C.sun, 2.3);
  sun.position.set(-70, 120, 95);     // солнце с юго-запада: тень южных секций ложится во двор, как на схеме инсоляции
  sun.castShadow = true;
  sun.shadow.mapSize.set(COARSE ? 1024 : 2048, COARSE ? 1024 : 2048);
  var sc = sun.shadow.camera; sc.left = -95; sc.right = 95; sc.top = 95; sc.bottom = -95; sc.near = 20; sc.far = 400;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.35;
  scene.add(sun);

  /* ── Координаты: лист ПЗУ/концепции (pt) и план двора 53.1 (px) → метры от центра корпуса 1 ── */
  var KPT = 0.3528;
  function P(x, y) { return [(x - 602) * KPT, (y - 544.9) * KPT]; }
  function Q(x, y) { return [(x - 365) / 12.52 - 35.85, (y - 160) / 12.52 - 33.94]; }
  function QQ(list) { return list.map(function (p) { return Q(p[0], p[1]); }); }

  function shape(pts) {
    var s = new THREE.Shape();
    pts.forEach(function (p, i) { if (i) s.lineTo(p[0], -p[1]); else s.moveTo(p[0], -p[1]); });
    s.closePath();
    return s;
  }
  function smooth(pts, n) {
    var c = new THREE.CatmullRomCurve3(pts.map(function (p) { return new THREE.Vector3(p[0], 0, p[1]); }), true, 'centripetal');
    return c.getPoints(n || 72).slice(0, -1).map(function (v) { return [v.x, v.z]; });
  }
  function roundRect(x0, z0, x1, z1, r, n) {
    var pts = [], seg = n || 10;
    function arc(cx, cz, a0) { for (var i = 0; i <= seg; i++) { var a = a0 + (i / seg) * Math.PI / 2; pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); } }
    arc(x1 - r, z1 - r, 0); arc(x0 + r, z1 - r, Math.PI / 2); arc(x0 + r, z0 + r, Math.PI); arc(x1 - r, z0 + r, Math.PI * 1.5);
    return pts;
  }
  function std(color, extra) {
    return new THREE.MeshStandardMaterial(Object.assign({ color: color, roughness: 0.92, metalness: 0 }, extra || {}));
  }
  function slab(pts, h, y0, mat, holes) {
    var s = shape(pts);
    (holes || []).forEach(function (hp) { s.holes.push(shape(hp)); });
    var g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 4 });
    g.rotateX(-Math.PI / 2);
    var m = new THREE.Mesh(g, mat);
    m.position.y = y0; m.receiveShadow = true;
    return m;
  }
  function inside(pt, poly) {
    var x = pt[0], z = pt[1], c = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
      if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) c = !c;
    }
    return c;
  }
  var seed = 7;
  function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }

  /* ── Земля и двор ── */
  /* земля — ровно цвета поля (без света): мир бесшовный, как у донора; тени — отдельным прозрачным слоем */
  var ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), new THREE.MeshBasicMaterial({ color: C.scene }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.03;
  scene.add(ground);
  var shadowLayer = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.ShadowMaterial({ color: C.shadow, opacity: 0.2 }));
  shadowLayer.rotation.x = -Math.PI / 2; shadowLayer.position.y = -0.01; shadowLayer.receiveShadow = true;
  scene.add(shadowLayer);

  var COURT = QQ([[365, 160], [1198, 160], [1198, 265], [1494, 265], [1494, 365], [1334, 365], [1334, 680], [1265, 680], [1265, 1005], [365, 1005]]);
  scene.add(slab(COURT, 0.04, 0, std(C.slab)));       // плита над паркингом — на ней лежит трасса

  /* ── Корпус 1: одиннадцать секций и одноэтажный блок (лист ПЗУ) ── */
  var SECTIONS = [
    [451.5, 402.6, 501.2, 470.3, 13], [451.5, 470.3, 500.4, 566.2, 13], [454.7, 566.2, 500.4, 640.1, 9],
    [501.2, 402.6, 597.3, 448.7, 9], [597.3, 403.6, 688.7, 448.7, 9], [689.0, 400.8, 752.5, 472.4, 25],
    [719.5, 495.1, 750.5, 565.5, 1], [704.1, 565.5, 750.5, 640.1, 9],
    [451.5, 640.1, 550.2, 689.0, 25], [550.2, 640.1, 624.2, 685.9, 9], [624.2, 640.1, 682.8, 689.0, 13], [682.8, 640.1, 750.5, 689.0, 13]
  ];
  var bMat = std(C.white, { roughness: 0.85 });
  bMat.onBeforeCompile = function (sh) {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;\nvarying vec3 vWN;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;\nvarying vec3 vWN;')
      .replace('#include <color_fragment>', [
        '#include <color_fragment>',
        'float vert = 1.0 - step(0.5, abs(vWN.y));',
        'float fy = fract(vWP.y / 3.0);',
        'float slabLine = 1.0 - smoothstep(0.0, 0.045, min(fy, 1.0 - fy));',
        'float along = abs(vWN.x) > 0.5 ? vWP.z : vWP.x;',
        'float fx = fract(along / 3.6);',
        'float pier = 1.0 - smoothstep(0.0, 0.03, min(fx, 1.0 - fx));',
        'float glaze = step(0.25, fy) * step(fy, 0.8) * (1.0 - pier);',
        'diffuseColor.rgb *= 1.0 - vert * (0.16 * slabLine + 0.05 * glaze);'
      ].join('\n'));
  };
  var buildings = SECTIONS.map(function (s) {
    var a = P(s[0], s[1]), b = P(s[2], s[3]);
    var w = b[0] - a[0], d = b[1] - a[1], h = s[4] === 1 ? 5 : s[4] * 3 + 1.5;
    var g = new THREE.BoxGeometry(w - 0.3, h, d - 0.3); g.translate(0, h / 2, 0);
    var m = new THREE.Mesh(g, bMat);
    m.position.set((a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2);
    m.castShadow = true; m.receiveShadow = true;
    m.userData.h = h;
    scene.add(m);
    return m;
  });
  var PODIUM = 4.5;   // высота «разреза» корпусов, когда смотрим во двор

  /* ── Сад: слой, который поднимается на шаге 04 и открывает трассу ── */
  var garden = new THREE.Group(); scene.add(garden);
  var gardenMats = [];
  function gm(color, extra) { var m = std(color, Object.assign({ transparent: true }, extra || {})); gardenMats.push(m); return m; }
  var mPaving = gm(C.paving), mLane = gm(C.lane), mGreen = gm(C.green), mSand = gm(C.sand), mCourt = gm(C.court), mPav = gm(C.white);
  garden.add(slab(COURT, 0.08, 0.04, mPaving));
  var LANE_OUT = roundRect.apply(null, Q(432, 262).concat(Q(1205, 945), [120 / 12.52]));
  var LANE_IN = roundRect.apply(null, Q(485, 318).concat(Q(1150, 890), [75 / 12.52]));
  garden.add(slab(LANE_OUT, 0.02, 0.12, mLane, [LANE_IN]));

  var ISL = {
    play: QQ([[520, 370], [560, 348], [700, 342], [860, 342], [930, 350], [942, 410], [900, 432], [840, 438], [800, 500], [762, 560], [720, 600], [650, 600], [590, 560], [540, 515], [518, 450]]),
    B: QQ([[490, 470], [515, 468], [548, 522], [602, 580], [620, 632], [600, 690], [568, 742], [535, 792], [505, 822], [490, 822]]),
    C: QQ([[965, 445], [988, 400], [1040, 362], [1100, 346], [1145, 362], [1150, 425], [1150, 770], [1130, 782], [1085, 742], [1040, 682], [1010, 620], [985, 560], [970, 500]]),
    D: QQ([[648, 628], [700, 620], [768, 628], [784, 664], [758, 698], [690, 704], [652, 686]]),
    E: QQ([[845, 470], [890, 455], [935, 470], [962, 520], [948, 578], [900, 592], [856, 578], [836, 524]]),
    F: QQ([[812, 650], [860, 606], [965, 600], [1010, 640], [1004, 700], [960, 750], [905, 770], [850, 745], [815, 700]]),
    G: QQ([[530, 832], [566, 792], [640, 740], [720, 718], [800, 728], [856, 772], [880, 840], [870, 888], [530, 888]]),
    H: QQ([[935, 880], [946, 822], [990, 768], [1040, 738], [1095, 756], [1148, 802], [1148, 888]]),
    T1: QQ([[458, 180], [618, 180], [618, 250], [458, 250]]),
    T2: QQ([[680, 180], [1045, 180], [1045, 250], [680, 250]]),
    L1: QQ([[382, 272], [428, 272], [428, 520], [382, 520]]),
    L2: QQ([[382, 562], [428, 562], [428, 938], [382, 938]]),
    S1: QQ([[470, 952], [655, 952], [655, 996], [470, 996]]),
    S2: QQ([[700, 952], [1050, 952], [1050, 996], [700, 996]]),
    R: QQ([[1212, 375], [1324, 375], [1324, 672], [1258, 672], [1258, 828], [1212, 828]])
  };
  var SMOOTH = { B: 1, C: 1, D: 1, E: 1, F: 1, G: 1, H: 1, play: 1 };
  var islands = {};
  Object.keys(ISL).forEach(function (k) {
    var pts = SMOOTH[k] ? smooth(ISL[k], 64) : ISL[k];
    ISL[k] = pts;
    var mat = k === 'play' ? mSand : k === 'F' ? mCourt : gm(C.green);
    var h = k === 'play' || k === 'F' ? 0.08 : 0.5;
    var m = slab(pts, h, 0.12, mat);
    m.castShadow = h > 0.2;
    garden.add(m);
    islands[k] = m;
  });
  var pavs = [];
  [[556, 700, 30], [1255, 550, 33]].forEach(function (c) {   // павильоны «8» и «9»
    var p = Q(c[0], c[1]), r = c[2] / 12.52;
    var m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 3.2, 40), mPav);
    m.position.set(p[0], 1.6 + 0.12, p[1]); m.castShadow = true; m.receiveShadow = true;
    garden.add(m); pavs.push(m);
  });

  /* деревья: пенопластовые кроны макета, плотность — по плану */
  var treePts = [];
  function scatter(poly, n, rMin, rMax, avoid) {
    var xs = poly.map(function (p) { return p[0]; }), zs = poly.map(function (p) { return p[1]; });
    var x0 = Math.min.apply(0, xs), x1 = Math.max.apply(0, xs), z0 = Math.min.apply(0, zs), z1 = Math.max.apply(0, zs);
    for (var t = 0, got = 0; t < n * 40 && got < n; t++) {
      var p = [x0 + rnd() * (x1 - x0), z0 + rnd() * (z1 - z0)];
      if (!inside(p, poly) || (avoid && inside(p, avoid))) continue;
      var ok = treePts.every(function (q) { return Math.hypot(q[0] - p[0], q[1] - p[1]) > 3.4; });
      if (!ok) continue;
      treePts.push([p[0], p[1], rMin + rnd() * (rMax - rMin)]); got++;
    }
  }
  scatter(ISL.C, 16, 1.7, 2.8); scatter(ISL.B, 7, 1.6, 2.5); scatter(ISL.G, 12, 1.7, 2.8); scatter(ISL.H, 8, 1.5, 2.4);
  scatter(ISL.D, 2, 1.4, 2.0); scatter(ISL.E, 3, 1.4, 2.2); scatter(ISL.play, 3, 1.5, 2.2);
  scatter(ISL.T1, 5, 1.4, 2.0); scatter(ISL.T2, 10, 1.4, 2.1); scatter(ISL.L1, 5, 1.3, 1.8); scatter(ISL.L2, 7, 1.3, 1.8);
  scatter(ISL.S1, 4, 1.3, 1.8); scatter(ISL.S2, 8, 1.3, 1.8); scatter(ISL.R, 8, 1.4, 2.0);
  var canopyMat = gm(C.canopy, { flatShading: true, roughness: 0.95 });
  var trunkMat = gm(C.trunk);
  var canopies = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), canopyMat, treePts.length);
  var trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.14, 0.2, 1, 6), trunkMat, treePts.length);
  canopies.castShadow = true; canopies.receiveShadow = true; trunks.castShadow = true;
  var M4 = new THREE.Matrix4(), Q4 = new THREE.Quaternion(), V3 = new THREE.Vector3(), S3 = new THREE.Vector3();
  treePts.forEach(function (t, i) {
    var r = t[2], trunkH = 1.6 + r * 0.9;
    Q4.setFromEuler(new THREE.Euler(0, rnd() * Math.PI, 0));
    M4.compose(V3.set(t[0], 0.62 + trunkH + r * 0.8, t[1]), Q4, S3.set(r, r * 1.15, r)); canopies.setMatrixAt(i, M4);
    M4.compose(V3.set(t[0], 0.62 + trunkH / 2, t[1]), Q4, S3.set(1, trunkH, 1)); trunks.setMatrixAt(i, M4);
  });
  garden.add(canopies); garden.add(trunks);

  /* ── Зоны полива: 10 из 16 каналов шкафа ── */
  var ZONES = [
    { id: 1, isl: 'T2', valve: [860, 262], sensor: [880, 214], k: .34, tag: 'Зона 1 · солнце · кустарники, капельная линия', pr: 2 },
    { id: 2, isl: 'B', valve: [496, 640], sensor: [552, 610], k: .5, tag: 'Зона 2 · газон и деревья, дождеватели', pr: 1 },
    { id: 3, isl: 'L2', valve: [432, 760], sensor: [405, 700], k: .26, tag: 'Зона 3 · живая изгородь, капельная трубка', pr: 3 },
    { id: 4, isl: 'R', valve: [1212, 640], sensor: [1290, 610], k: .7, tag: 'Зона 4 · тень менее 1 ч · папоротник, хоста', pr: 1 },
    { id: 5, isl: 'C', valve: [1146, 600], sensor: [1080, 540], k: .58, tag: 'Зона 5 · деревья, капельные кольца', pr: 1 },
    { id: 6, isl: 'E', valve: [952, 470], sensor: [900, 525], k: .42, tag: 'Зона 6 · кустарники, капельный', pr: 3 },
    { id: 7, isl: 'D', valve: [710, 622], sensor: [716, 664], k: .3, tag: 'Зона 7 · многолетники, микрокапельный', pr: 3 },
    { id: 8, isl: 'G', valve: [610, 888], sensor: [705, 815], k: .46, tag: 'Зона 8 · газон, MP Rotator', pr: 2 },
    { id: 9, isl: 'H', valve: [1010, 884], sensor: [1065, 835], k: .64, tag: 'Зона 9 · хвойные, отдельной зоной', pr: 2 },
    { id: 10, isl: 'S2', valve: [880, 950], sensor: [905, 975], k: .54, tag: 'Зона 10 · тень, многолетники', pr: 3 }
  ];
  var ACTIVE = 8;   // зона, которую поливают на шагах 04–05
  ZONES.forEach(function (z) { z.mesh = islands[z.isl]; z.base = z.mesh.material.color.clone(); });

  /* ── Трасса под садом: кольцевая магистраль, подвод от шкафа, ветки к клапанам ── */
  var pipes = new THREE.Group(); pipes.visible = false; scene.add(pipes);
  var pipeMats = [];
  function pipeMat(len, active) {
    var m = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uFlow: { value: 0 }, uLen: { value: len }, uActive: { value: active ? 1 : 0 }, uA: { value: 0 }, uPulse: { value: active === 'flow' ? 1 : 0 },
        uBase: { value: C.pipeIdle.clone() }, uAcc: { value: C.accent.clone() }, uOff: { value: C.off.clone() }, uStop: { value: 0 }
      },
      transparent: true, depthTest: false, depthWrite: false,
      vertexShader: 'varying vec2 vUv; varying vec3 vN; void main(){ vUv = uv; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: [
        'uniform float uTime, uFlow, uLen, uActive, uA, uStop, uPulse; uniform vec3 uBase, uAcc, uOff;',
        'varying vec2 vUv; varying vec3 vN;',
        'void main(){',
        '  float lit = 0.78 + 0.22 * max(dot(vN, normalize(vec3(0.2, 0.9, 0.4))), 0.0);',
        '  float s = fract(vUv.x * uLen / 6.0 - uTime * 1.6);',
        '  float pulse = smoothstep(0.0, 0.12, s) * (1.0 - smoothstep(0.3, 0.55, s));',
        '  vec3 base = mix(uBase, uOff, uStop);',
        '  vec3 c = mix(base, uAcc, uActive * uFlow * mix(0.5, 0.62 + 0.38 * pulse, uPulse));',
        '  gl_FragColor = vec4(c * lit, uA);',
        '  #include <colorspace_fragment>',
        '}'
      ].join('\n')
    });
    pipeMats.push(m);
    return m;
  }
  function tube(curve, r, active, segs) {
    var len = curve.getLength();
    var m = new THREE.Mesh(new THREE.TubeGeometry(curve, segs || Math.max(8, Math.round(len * 1.5)), r, 10, curve.closed), pipeMat(len, active));
    m.renderOrder = 5;
    pipes.add(m);
    return m;
  }
  var Y = 0.42;
  var ringPts = roundRect.apply(null, Q(458, 290).concat(Q(1178, 918), [96 / 12.52, 12]));
  var ring = new THREE.CatmullRomCurve3(ringPts.map(function (p) { return new THREE.Vector3(p[0], Y, p[1]); }), true, 'centripetal');
  var ringMesh = tube(ring, 0.42, 'pressure', 420);
  var CAB = Q(1300, 420);
  function poly(list) {
    var path = new THREE.CurvePath();
    for (var i = 1; i < list.length; i++) path.add(new THREE.LineCurve3(new THREE.Vector3(list[i - 1][0], Y, list[i - 1][1]), new THREE.Vector3(list[i][0], Y, list[i][1])));
    return path;
  }
  var ringNear = function (p) {
    var best = null, bd = 1e9;
    for (var i = 0; i <= 400; i++) { var v = ring.getPointAt(i / 400), d = Math.hypot(v.x - p[0], v.z - p[1]); if (d < bd) { bd = d; best = [v.x, v.z]; } }
    return best;
  };
  var feedAt = ringNear(Q(1178, 420));
  tube(poly([[CAB[0] + 1.6, CAB[1]], [feedAt[0], CAB[1]], feedAt]), 0.42, 'flow');
  ZONES.forEach(function (z) {
    var v = Q(z.valve[0], z.valve[1]), a = ringNear(v);
    z.valvePos = v;
    z.branch = tube(poly([a, v]), 0.26, z.id === ACTIVE ? 'flow' : false);
    var box = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.8, 1.0), new THREE.MeshBasicMaterial({ color: C.white, transparent: true, depthTest: false }));
    box.position.set(v[0], 0.5, v[1]); box.renderOrder = 6;
    z.box = box; pipes.add(box);
  });
  /* капельный контур активной зоны: петля внутри острова и подводка от клапана */
  (function () {
    var z = ZONES[ACTIVE - 1], pts = ISL[z.isl];
    var cx = 0, cz = 0; pts.forEach(function (p) { cx += p[0]; cz += p[1]; }); cx /= pts.length; cz /= pts.length;
    var inner = pts.filter(function (p, i) { return i % 4 === 0; }).map(function (p) { return new THREE.Vector3(cx + (p[0] - cx) * 0.62, Y + 0.25, cz + (p[1] - cz) * 0.62); });
    var loop = new THREE.CatmullRomCurve3(inner, true, 'centripetal');
    tube(loop, 0.18, 'flow', 160);
    var near = inner.reduce(function (a, v) { return Math.hypot(v.x - z.valvePos[0], v.z - z.valvePos[1]) < Math.hypot(a.x - z.valvePos[0], a.z - z.valvePos[1]) ? v : a; });
    tube(poly([z.valvePos, [near.x, near.z]]), 0.18, 'flow');
  })();
  // шкаф PANORAMA и ввод воды из корпуса
  var cab = new THREE.Group(); scene.add(cab);
  var cabMat = std(C.white, { roughness: .55 });
  var cabBody = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.3, 2.6), cabMat);
  cabBody.position.set(CAB[0] + 2.4, 1.15, CAB[1]); cabBody.castShadow = true; cab.add(cabBody);
  var pump = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 1.3, 24), cabMat);
  pump.rotation.z = Math.PI / 2; pump.position.set(CAB[0] + 0.6, 0.7, CAB[1]); pump.castShadow = true; cab.add(pump);
  var cabStripe = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.16, 2.62), new THREE.MeshBasicMaterial({ color: C.accent }));
  cabStripe.position.set(CAB[0] + 2.4, 2.0, CAB[1]); cab.add(cabStripe);
  var cabLamp = cabStripe.material;

  /* датчики: стойки в зонах, расходомер и давление у шкафа, метеостанция */
  var sensors = new THREE.Group(); garden.add(sensors);
  var sensorMat = gm(C.white, { roughness: .6 });
  var capMat = new THREE.MeshBasicMaterial({ color: C.accent, transparent: true });
  var ringMat = new THREE.MeshBasicMaterial({ color: C.accent, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  var pulses = [];
  ZONES.forEach(function (z, i) {
    var p = Q(z.sensor[0], z.sensor[1]);
    z.sensorPos = p;
    var post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.6, 8), sensorMat);
    post.position.set(p[0], 0.62 + 0.8, p[1]); sensors.add(post);
    var cap = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), capMat);
    cap.position.set(p[0], 0.62 + 1.7, p[1]); sensors.add(cap);
    var rg = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 48), ringMat.clone());
    rg.rotation.x = -Math.PI / 2; rg.position.set(p[0], 0.66, p[1]); sensors.add(rg);
    pulses.push({ m: rg, off: i * 0.37 });
  });
  var WEATHER = P(735, 528);
  var mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 3.4, 8), std(C.white));
  mast.position.set(WEATHER[0], 5 + 1.7, WEATHER[1]); scene.add(mast);
  var vane = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), capMat); vane.position.set(WEATHER[0], 5 + 3.5, WEATHER[1]); scene.add(vane);

  /* утечка на ветке зоны 5 */
  var LEAK = (function () { var z = ZONES[ACTIVE - 1], a = ringNear(z.valvePos); return [a[0] + (z.valvePos[0] - a[0]) * .55, a[1] + (z.valvePos[1] - a[1]) * .55]; })();
  var leakMat = new THREE.MeshBasicMaterial({ color: C.ink, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  var leakRings = [0, 1, 2].map(function (i) {
    var m = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.05, 48), leakMat.clone());
    m.rotation.x = -Math.PI / 2; m.position.set(LEAK[0], 0.12, LEAK[1]); m.visible = false; scene.add(m);
    return { m: m, off: i / 3 };
  });
  var leakDot = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), new THREE.MeshBasicMaterial({ color: C.ink, transparent: true }));
  leakDot.position.set(LEAK[0], Y, LEAK[1]); leakDot.visible = false; scene.add(leakDot);

  /* ── Карты проекта: солнце и глубина грунта, перекрашены в акцент ── */
  var MAPS = window.PANORAMA_MAPS, dataPlane = null, dataMat = null;
  if (MAPS) {
    var W = MAPS.w, H = MAPS.h;
    var mk = function (str, n) {
      var buf = new Uint8Array(W * H * 4);
      var lo = C.dataLo, c = new THREE.Color();
      for (var j = 0; j < H; j++) for (var i = 0; i < W; i++) {
        var ch = str.charAt(j * W + i), o = ((H - 1 - j) * W + i) * 4;
        if (ch === '-') { buf[o + 3] = 0; continue; }
        var t = (+ch + 0.5) / n;
        c.copy(lo).lerp(C.accent, 0.08 + t * 0.86).convertLinearToSRGB();
        buf[o] = c.r * 255; buf[o + 1] = c.g * 255; buf[o + 2] = c.b * 255; buf[o + 3] = 205;
      }
      var tx = new THREE.DataTexture(buf, W, H, THREE.RGBAFormat);
      tx.magFilter = THREE.NearestFilter; tx.minFilter = THREE.NearestFilter; tx.colorSpace = THREE.SRGBColorSpace; tx.needsUpdate = true;
      return tx;
    };
    dataMat = new THREE.ShaderMaterial({
      uniforms: { uA: { value: mk(MAPS.ins, 6) }, uB: { value: mk(MAPS.soil, 6) }, uMix: { value: 0 }, uOp: { value: 0 } },
      transparent: true, depthWrite: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: [
        'uniform sampler2D uA, uB; uniform float uMix, uOp; varying vec2 vUv;',
        'void main(){ vec4 a = texture2D(uA, vUv); vec4 b = texture2D(uB, vUv); vec4 c = mix(a, b, uMix);',
        '  gl_FragColor = vec4(c.rgb, c.a * uOp);',
        '  #include <colorspace_fragment>',
        '}'
      ].join('\n')
    });
    dataPlane = new THREE.Mesh(new THREE.PlaneGeometry(W, H), dataMat);
    dataPlane.rotation.x = -Math.PI / 2;
    dataPlane.position.set(MAPS.x0 + W / 2, 0.9, MAPS.z0 + H / 2);
    dataPlane.renderOrder = 3; dataPlane.visible = false;
    scene.add(dataPlane);
  }

  /* ── Подписи (DOM поверх холста) ── */
  var tags = [];
  function tag(text, pos3, steps, prio, kind) {
    var el = document.createElement('div');
    el.className = 'tag' + (kind ? ' tag--' + kind : '');
    el.innerHTML = '<span class="tag__dot"></span><span class="tag__text"></span>';
    el.lastChild.textContent = text;
    labelsHost.appendChild(el);
    tags.push({ el: el, p: new THREE.Vector3(pos3[0], pos3[1], pos3[2]), steps: steps, prio: prio || 1, on: false, lift: kind === 'garden' });
  }
  var SUN = Q(640, 300), SHADE = Q(1296, 600), MOUND = [7.1, -7.0], SHALLOW = Q(1180, 840);
  tag('до 7 ч солнца', [SUN[0], 1, SUN[1]], ['1a'], 1);
  tag('менее 1 ч', [SHADE[0], 1, SHADE[1]], ['1a'], 1);
  tag('холмы под деревьями — до 2,7 м', [MOUND[0], 1, MOUND[1]], ['1b'], 1);
  tag('около 1 м грунта', [SHALLOW[0], 1, SHALLOW[1]], ['1b'], 2);
  ZONES.forEach(function (z) { if (z.id === 5 || z.id === 8) tag('Влажность почвы · зона ' + z.id, [z.sensorPos[0], 2.6, z.sensorPos[1]], ['2'], z.id === 5 ? 1 : 2, 'garden'); });
  tag('Расход и давление', [CAB[0] + 0.6, 1.6, CAB[1]], ['2'], 1);
  tag('Погода', [WEATHER[0], 9, WEATHER[1]], ['2'], 2);
  ZONES.forEach(function (z) { tag(z.tag, [z.sensorPos[0], 2.4, z.sensorPos[1]], ['3'], z.pr, 'garden'); });
  tag('Шкаф PANORAMA · насос 230 В · 16 × 24 В', [CAB[0] + 2.4, 2.8, CAB[1]], ['4'], 1);
  tag('Клапан зоны ' + ACTIVE + ' открыт · полив газона', [ZONES[ACTIVE - 1].valvePos[0], 1.2, ZONES[ACTIVE - 1].valvePos[1]], ['4'], 1);
  var RP = ringPts[Math.round(ringPts.length * 0.36)];
  tag('Кольцевая магистраль', [RP[0], 1, RP[1]], ['4'], 2);
  tag('Расход выше профиля зоны — утечка', [LEAK[0], 1.4, LEAK[1]], ['5'], 1, 'alert');
  tag('Контактор KM1 разомкнут · насос остановлен', [CAB[0] + 2.4, 2.8, CAB[1]], ['5'], 1, 'alert');

  /* ── Состояния ── */
  var STATES = {
    hero: { cam: [0, 0, 6, 232, 36, 34, 0, .36], build: 1, data: 0, trees: 1, sens: 0, zone: .4, lift: 0, pipes: 0, flow: 0, leak: 0 },
    1: { cam: [3, 0, 2, 158, 22, 18, .16, 0], build: 0, data: 1, trees: 0, sens: 0, zone: 0, lift: 0, pipes: 0, flow: 0, leak: 0 },
    2: { cam: [2, 0, 3, 128, 40, -28, .17, .02], build: 0, data: 0, trees: 1, sens: 1, zone: 0, lift: 0, pipes: 0, flow: 0, leak: 0 },
    3: { cam: [4, 0, 2, 132, 36, 14, .17, .02], build: 0, data: 0, trees: 1, sens: .6, zone: 1, lift: 0, pipes: 0, flow: 0, leak: 0 },
    4: { cam: [4, 2, 1, 124, 46, 40, .16, .03], build: 0, data: 0, trees: 0, sens: 0, zone: .7, lift: 0, xray: 1, pipes: 1, flow: 1, leak: 0 },
    5: { cam: [4, 1, 2, 132, 44, 36, .16, .03], build: 0, data: 0, trees: 0, sens: 0, zone: .7, lift: 0, xray: 1, pipes: 1, flow: 0, leak: 1 }
  };
  var cur = JSON.parse(JSON.stringify(STATES.hero)), goal = STATES.hero, stepKey = 'hero', heroP = 0, local = 0, mix = 0;
  var tagKey = 'hero';

  function lerp(a, b, t) { return a + (b - a) * t; }
  function damp(a, b, k, dt) { return RM ? b : lerp(a, b, 1 - Math.exp(-k * dt)); }

  var size = { w: 1, h: 1 }, HEAD = parseFloat(tok('--head-h')) || 80;
  function resize() {
    var w = window.innerWidth, h = window.innerHeight;
    size.w = w; size.h = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  var target = new THREE.Vector3(), t0 = performance.now(), last = t0, running = false, raf = 0;
  /* Кадр рисуется только по необходимости: пока камера и состояния сходятся к цели или идёт анимация
     (пульс датчиков, вода, утечка). Сошлось и стоит — цикл засыпает до wake(): смены шага, скролла,
     курсора, ресайза. Так неподвижная сцена не грузит видеокарту. */
  var pointer = { x: 0, y: 0 }, shadowSig = '', slow = 0, fast = 0;
  function wake() { if (running && !raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }
  function frame(now) {
    raf = 0;
    var dt = Math.min(0.05, (now - last) / 1000); last = now;
    var time = (now - t0) / 1000;
    var g = goal;

    /* камера: [tx, ty, tz, R, наклон от вертикали °, азимут °, сдвиг кадра x, y] */
    var drift = stepKey === 'hero' ? heroP : local;
    var cg = g.cam.slice();
    if (stepKey === 'hero') { cg[5] += pointer.x * 3 - heroP * 10; cg[4] += pointer.y * 1.5 + heroP * 6; cg[3] += heroP * 30; }
    else { cg[5] += (drift - .5) * 10 + pointer.x * 1.5; cg[3] -= drift * 6; }
    var aspect = size.w / size.h, narrow = aspect < 1;
    if (narrow) {
      if (stepKey === 'hero') { cg[3] *= 1.45; cg[6] = .1; cg[7] = .3; }
      else { cg[3] *= Math.min(2.1, 0.95 / aspect); cg[6] = 0; cg[7] = -.1; }
    }
    var moving = false;
    for (var i = 0; i < 8; i++) { cur.cam[i] = damp(cur.cam[i], cg[i], 2.6, dt); if (Math.abs(cur.cam[i] - cg[i]) > (i < 6 ? 0.01 : 0.0004)) moving = true; }
    ['build', 'data', 'trees', 'sens', 'zone', 'lift', 'xray', 'pipes', 'flow', 'leak'].forEach(function (k) {
      cur[k] = damp(cur[k] || 0, g[k] || 0, k === 'flow' ? 1.6 : 3.2, dt);
      if (Math.abs(cur[k] - (g[k] || 0)) > 0.002) moving = true; else cur[k] = g[k] || 0;
    });

    var c = cur.cam, pol = c[4] * Math.PI / 180, az = c[5] * Math.PI / 180;
    target.set(c[0], c[1], c[2]);
    camera.position.set(c[0] + c[3] * Math.sin(pol) * Math.sin(az), c[1] + c[3] * Math.cos(pol), c[2] + c[3] * Math.sin(pol) * Math.cos(az));
    camera.lookAt(target);
    camera.setViewOffset(size.w, size.h, -c[6] * size.w, -c[7] * size.h, size.w, size.h);

    buildings.forEach(function (b) { var s = lerp(PODIUM / b.userData.h, 1, cur.build); b.scale.y = Math.min(1, Math.max(s, 0.001)); });

    if (dataPlane) { var mg = local > 0.5 && stepKey === '1' ? 1 : 0; dataPlane.visible = cur.data > 0.01; dataMat.uniforms.uOp.value = cur.data; mix = damp(mix, mg, 3.2, dt); if (Math.abs(mix - mg) > 0.002) moving = true; dataMat.uniforms.uMix.value = mix; }

    garden.position.y = cur.lift * 8;
    var gOp = lerp(1, 0.12, cur.lift) * lerp(1, 0.3, cur.xray);
    gardenMats.forEach(function (m) { m.opacity = gOp; m.depthWrite = gOp > 0.98; });
    ZONES.forEach(function (z) { z.mesh.material.opacity = lerp(gOp, 0.62, cur.xray); });
    canopyMat.opacity = trunkMat.opacity = gOp * cur.trees;
    canopies.visible = trunks.visible = cur.trees > 0.02;
    var shade = cur.lift < 0.5 && cur.xray < 0.5;
    if (shade !== garden.userData.shade) { garden.userData.shade = shade; garden.traverse(function (o) { if (o.isMesh) o.castShadow = shade && o.userData.cast !== false; }); }

    pavs.forEach(function (m) { m.visible = cur.data < 0.5; });
    sensors.visible = cur.sens > 0.02;
    capMat.opacity = cur.sens; sensorMat.opacity = Math.min(gOp, cur.sens);
    pulses.forEach(function (p) {
      var f = RM ? .5 : (time * 0.45 + p.off) % 1;
      p.m.scale.setScalar(1 + f * 5); p.m.material.opacity = cur.sens * (1 - f) * 0.7;
    });
    vane.visible = mast.visible = cur.sens > 0.8;

    ZONES.forEach(function (z) {
      z.mesh.material.color.copy(z.base).lerp(C.accent, z.k * cur.zone);
      var active = z.id === ACTIVE;
      z.box.material.color.copy(C.white).lerp(active ? C.accent : C.white, cur.flow);
      z.box.material.opacity = cur.pipes;
    });

    pipes.visible = cur.pipes > 0.02;
    pipeMats.forEach(function (m) {
      m.uniforms.uTime.value = RM ? 0 : time;
      m.uniforms.uA.value = cur.pipes;
      m.uniforms.uFlow.value = cur.flow;
      m.uniforms.uStop.value = cur.leak;
    });
    cabLamp.color.copy(C.accent).lerp(C.ink, cur.leak);
    cab.visible = cur.pipes > 0.02 || cur.sens > 0.8;

    leakDot.visible = cur.leak > 0.02; leakDot.material.opacity = cur.leak;
    leakRings.forEach(function (r) {
      r.m.visible = leakDot.visible;
      var f = RM ? .5 : (time * 0.7 + r.off) % 1;
      r.m.scale.setScalar(1 + f * 6); r.m.material.opacity = cur.leak * (1 - f) * 0.8;
    });

    var sig = [cur.build, cur.xray, cur.trees, cur.lift, cur.data > 0.5].map(function (v) { return typeof v === 'number' ? v.toFixed(3) : v; }).join();
    if (sig !== shadowSig) { shadowSig = sig; renderer.shadowMap.needsUpdate = true; }
    renderer.render(scene, camera);
    placeTags();

    var animating = !RM && ((cur.sens > 0.02) || (cur.pipes > 0.02 && cur.flow > 0.02) || cur.leak > 0.02);
    if (running && (moving || animating)) raf = requestAnimationFrame(frame);
    adapt(dt, moving || animating);
  }

  /* качество под устройство: стабильно тяжёлые кадры (> 22 мс) снижают плотность пикселей шагом 0.25 до 1 */
  function adapt(dt, busy) {
    if (!busy || dt <= 0) return;
    if (dt > 0.022) { slow++; fast = 0; } else { fast++; if (fast > 120) slow = 0; }
    if (slow > 45 && dpr > 1) { dpr = Math.max(1, dpr - 0.25); slow = 0; renderer.setPixelRatio(dpr); resize(); }
  }


  var v = new THREE.Vector3(), placed = [];
  /* подписи: проекция якоря; у правого края текст уходит влево; пересечение с уже поставленной —
     младшая по приоритету прячется (на телефоне подписи крупнее относительно сцены) */
  function placeTags() {
    var narrow = size.w < 768;
    placed.length = 0;
    tags.slice().sort(function (a, b) { return a.prio - b.prio; }).forEach(function (t) {
      var want = t.steps.indexOf(tagKey) > -1 && t.prio <= (narrow ? 1 : 2);
      if (want) {
        v.copy(t.p); if (t.lift) v.y += garden.position.y;
        v.project(camera);
        var x = (v.x * 0.5 + 0.5) * size.w, y = (-v.y * 0.5 + 0.5) * size.h;
        if (v.z > 1 || x < 8 || x > size.w - 8 || y < HEAD + 8 || y > size.h - 8) want = false;
        else {
          if (!t.w) { t.w = t.el.offsetWidth; t.h = t.el.offsetHeight; }
          var left = x > size.w - t.w - 24;
          var r = { x0: left ? x - t.w + 12 : x - 12, y0: y - t.h / 2 - 3 };
          r.x1 = r.x0 + t.w; r.y1 = r.y0 + t.h + 6;
          var hit = placed.some(function (q) { return r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0; });
          if (hit) want = false;
          else {
            placed.push(r);
            t.el.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0)';
            t.el.classList.toggle('is-left', left);
          }
        }
      }
      if (want !== t.on) { t.on = want; t.el.classList.toggle('is-on', want); }
    });
  }

  function setGoal(key) {
    stepKey = String(key);
    goal = STATES[stepKey] || STATES.hero;
  }

  var drawQ = 0;
  function draw() { if (!drawQ) drawQ = requestAnimationFrame(function (t) { drawQ = 0; last = t; frame(t); }); }
  /* высота окна на телефоне меняется вместе с адресной строкой — ядро такие ресайзы глушит, холст следит сам */
  var rq = 0;
  addEventListener('resize', function () { if (!rq) rq = requestAnimationFrame(function () { rq = 0; resize(); if (RM) draw(); else wake(); }); });
  /* курсор: лёгкий параллакс камеры (у донора сцена тоже ведётся указателем); только мышь, не тач */
  if (!RM && matchMedia('(pointer: fine)').matches) {
    addEventListener('pointermove', function (e) {
      pointer.x = e.clientX / size.w * 2 - 1; pointer.y = e.clientY / size.h * 2 - 1; wake();
    }, { passive: true });
  }
  resize();

  /* шейдеры компилируются заранее (под загрузочным экраном), а не на первом скролле до шага 4 */
  var hidden = [pipes, sensors, dataPlane, leakDot, cab].filter(Boolean);
  hidden.forEach(function (o) { o.userData.v = o.visible; o.visible = true; });
  renderer.compile(scene, camera);
  hidden.forEach(function (o) { o.visible = o.userData.v; });

  var api = {
    ok: true,
    run: function (on) {
      if (RM) { if (on) draw(); return; }        // без движения: кадр по требованию, цикла нет
      if (on === running) return;
      running = on;
      if (on) wake();
    },
    hero: function (p) { setGoal('hero'); heroP = p || 0; tagKey = 'hero'; if (RM) draw(); else wake(); },
    flow: function (step, l) {
      setGoal(step); local = l || 0;
      tagKey = step === 1 ? (local > 0.5 ? '1b' : '1a') : String(step);
      if (RM) draw(); else wake();
    },
    snap: function () { cur = JSON.parse(JSON.stringify(goal)); mix = local > 0.5 && stepKey === '1' ? 1 : 0; },
    once: function () { last = performance.now(); frame(last); },
    resize: resize,
    renderer: renderer
  };
  window.stage = api;
  document.documentElement.classList.add('has-stage');
  /* готовность — после первого нарисованного кадра: загрузочный экран уходит, когда сцена уже есть */
  requestAnimationFrame(function (t) {
    last = t; frame(t);
    requestAnimationFrame(function () { document.dispatchEvent(new CustomEvent('stage:ready')); });
  });
})();
