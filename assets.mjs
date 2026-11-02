/* assets.mjs — 素材清单 + 预加载 + 降级（阶段 2：高清贴图接入）
 * 全局挂载 window.ASSETS，fx.js 之前加载。任一素材缺失时自动回退到程序化矢量绘制。
 *
 * 第 14 项：启动阶段把「单机 + 联机」用到的全部素材一次加载完（含 138 个图标 PNG），
 *           加载完成前页面停留在加载等待页，不进入首页，避免玩家看到无图标的空首页。
 * 第 15 项：场景贴图只保留一个四边连续的变体（详见 sceneVariants 处注释）。
 */
window.ASSETS = (() => {
  'use strict';

  // ===== #66 素材版本自愈 =====
  // 素材走长缓存（max-age=31536000）后，浏览器一年内不再向服务器验证 → 素材被替换时
  // 玩家会一直用旧素材，直到缓存自然过期。做法：服务端把素材指纹注入 HTML 的
  // <meta name="asset-version">，这里启动时比对本地记录的指纹；指纹变了就清掉
  // assets/ 的缓存条目并强制重载，让新素材立刻生效。
  // 注意：只清 assets/，不动存档（localStorage 里存档和素材是两回事）。
  (() => {
    try {
      const meta = document.querySelector('meta[name="asset-version"]');
      const ver = meta && meta.getAttribute('content');
      if (!ver) return;
      const KEY = 'azs-asset-version';
      const old = localStorage.getItem(KEY);
      if (old === ver) return;           // 版本一致 → 缓存有效，什么都不用做
      if (old) {
        // 版本变了：清掉素材缓存（保留存档键）
        const doomed = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.indexOf('assets/') === 0) doomed.push(k);
        }
        for (const k of doomed) localStorage.removeItem(k);
        if (window.caches && caches.keys) {
          try { caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))); } catch { }
        }
      }
      localStorage.setItem(KEY, ver);
    } catch { }
  })();

  const MANIFEST = {
    mage: 'assets/sprites/mage.png',
    warrior: 'assets/sprites/warrior.png',
    hunter: 'assets/sprites/hunter.png',
    mage_attack: 'assets/sprites/mage_attack.png',
    warrior_attack: 'assets/sprites/warrior_attack.png',
    hunter_attack: 'assets/sprites/hunter_attack.png',
    wolf: 'assets/sprites/wolf.png',
    gnoll: 'assets/sprites/gnoll.png',
    murloc: 'assets/sprites/murloc.png',
    cultist: 'assets/sprites/cultist.png',
    ooze: 'assets/sprites/ooze.png',
    troll: 'assets/sprites/troll.png',
    golem: 'assets/sprites/golem.png',
    boss1: 'assets/sprites/boss1.png',
    boss2: 'assets/sprites/boss2.png',
    boss3: 'assets/sprites/boss3.png',
    // 装备图标（AI 生成手绘风，替代 Unicode 符号）
    mage_w: 'assets/icons/mage_w.png', mage_a: 'assets/icons/mage_a.png', mage_t: 'assets/icons/mage_t.png',
    warrior_w: 'assets/icons/warrior_w.png', warrior_a: 'assets/icons/warrior_a.png', warrior_t: 'assets/icons/warrior_t.png',
    hunter_w: 'assets/icons/hunter_w.png', hunter_a: 'assets/icons/hunter_a.png', hunter_t: 'assets/icons/hunter_t.png'
  };
  const SVG_MANIFEST = {}; // SVG 改为 icons-data.js 内联（支持 file:// 直开）

  // ===== 战斗场景贴图（第 7 项）=====
  // 5 张 AI 生成的写实风格俯视地面贴图：4 个副本各一张 + 无尽模式一张。
  // 由 tools/scene-tiles.py 做无缝化 / 去水印 / 去重复处理；此处只负责按需加载。
  const SCENE_MANIFEST = {
    adventure: 'assets/scenes/adventure.jpg',
    ragefire: 'assets/scenes/ragefire.jpg',
    lordaeron: 'assets/scenes/lordaeron.jpg',
    wailing: 'assets/scenes/wailing.jpg',
    shadowfang: 'assets/scenes/shadowfang.jpg',
    moltencore: 'assets/scenes/moltencore.jpg'   // 熔火之心（团队副本）
  };
  const images = {}, svgs = window.ICON_SVGS || {};
  const sceneImages = {};

  // ===== 并发限流 =====
  // ★ 踩坑记录（2026-11-02，GitHub Pages 部署时暴露）：
  //   启动阶段原本一次性并发发出 138 个图标 + 27 个精灵 + 6 个场景 + 4 个副本缩略图 = 175 个请求，
  //   再叠加 spine.js 的 189 个请求（合计 ~360 个），打满浏览器每主机连接池：
  //   队列堆积到 165 秒还没排完，期间成批失败 → 素材大面积回退 → 启动页卡死。
  //   本地磁盘服务器测不出来，只有走网络（Pages / natapp 隧道）才必现。
  // 现在统一限流：同时最多 8 个请求。
  const LOAD_CONCURRENCY = 8;

  // 并发执行 items，limit 个 worker，顺序保持不变。
  // （JS 单线程，idx++ 是安全的；每个 worker 串行取一个任务）
  function mapLimit(items, limit, fn) {
    const list = items || [];
    if (!list.length) return Promise.resolve([]);
    const out = new Array(list.length);
    let idx = 0;
    const worker = async () => {
      while (idx < list.length) {
        const i = idx++;
        out[i] = await fn(list[i], i);
      }
    };
    const n = Math.max(1, Math.min(limit, list.length));
    return Promise.all(Array.from({ length: n }, worker)).then(() => out);
  }
  // 第 15 项：场景贴图只保留「原图」一个变体。
  //   旧实现是「原图 + 旋转 90°」按棋盘交替铺贴，但旋转会把上/下边换到左/右边，
  //   旋转块与原图的公共边内容并不连续 → 相邻块交界处出现明显的横向硬接缝。
  //   现在：地面块本身四边连续（tools/scene-tiles.py 保证），重复感改由
  //   「贴图内 2×2 象限去重复」与「低频斑块扰动」打散，不再靠旋转硬拼。
  const sceneVariants = {};
  let loaded = 0, failed = 0, spineDone = 0;
  let scenePromise = null;

  // 场景贴图的实际绘制尺寸（世界像素）。原图 768px 直接以 1:1 位图搬运（无缩放），
  // 避免每帧做重采样；同时 768 的贴图在 1920 宽的屏幕上只重复约 2.5 次，
  // 加上贴图内部 2×2 象限各不相同，肉眼几乎看不出重复。
  const SCENE_TILE = 768;

  // 预加载场景贴图：单独于素材主流程，后台进行，不阻塞首页
  // onProgress(done, total) 用于把场景贴图纳入启动进度条（第 7 项）
  let sceneLoaded = 0;
  function preloadScenes(onProgress) {
    const entries = Object.entries(SCENE_MANIFEST);
    if (scenePromise) return scenePromise;
    let done = 0;
    scenePromise = mapLimit(entries, 4, ([key, src]) => new Promise((resolve) => {
      const im = new Image();
      const finish = () => { done++; sceneLoaded++; onProgress?.(sceneLoaded, entries.length); resolve(); };
      im.onload = () => {
        try {
          // 场景贴图本身就是无缝循环图，直接缓存原图，之后每帧 1:1 贴图
          sceneImages[key] = im;
          sceneVariants[key] = [im];
        } catch { sceneImages[key] = im; sceneVariants[key] = [im]; }
        finish();
      };
      im.onerror = () => { console.warn('[ASSETS] 场景贴图缺失，使用程序化地面:', src); finish(); };
      im.src = src;
    }));
    return scenePromise;
  }

  // 预热任意图片列表（副本缩略图等），提前走完解码，避免进页面时卡一下
  function preloadImages(urls) {
    return mapLimit(urls || [], 4, (src) => new Promise((resolve) => {
      const im = new Image();
      im.onload = () => resolve();
      im.onerror = () => resolve();
      im.src = src;
    }));
  }

  // 第 5 项 / 第 14 项：图标 PNG（assets/icons/selected/）。
  // keys.js 由 tools/gen-icon-keys.mjs 生成，列出全部精选图标，
  // 启动阶段整体预加载 → 页面里的 <img> 直接命中浏览器缓存，不再出现「进战斗才开始加载」。
  const ICON_DIR = './assets/icons/selected/';
  const ICON_KEYS = Array.isArray(window.ICON_PNG_KEYS) ? window.ICON_PNG_KEYS : [];
  const iconImages = {};
  function preloadIcons(keys) {
    return mapLimit(keys || [], LOAD_CONCURRENCY, (k) => new Promise((resolve) => {
      if (iconImages[k]) { resolve(iconImages[k]); return; }
      const im = new Image();
      im.onload = () => { iconImages[k] = im; resolve(im); };
      im.onerror = () => resolve(null);
      im.src = ICON_DIR + k + '.png';
    }));
  }

  // 启动加载：一次性把精灵图 / 场景贴图 / Spine 骨骼 / 全部图标 / 额外图片拉齐。
  // onProgress(progress 0~1, label) —— label 用于在加载等待页显示当前阶段。
  function load(onProgress, extraUrls) {
    const extras = extraUrls || [];
    const spineCount = window.SPINE?.count() || 0;
    const total = Object.keys(MANIFEST).length + Object.keys(SCENE_MANIFEST).length
      + spineCount + ICON_KEYS.length + extras.length;
    let imgDone = 0, sceneDone = 0, spineDone = 0, iconDone = 0, extraDone = 0;
    let label = '角色与装备贴图';
    const progress = (l) => {
      if (l) label = l;
      const p = (imgDone + sceneDone + spineDone + iconDone + extraDone) / Math.max(1, total);
      onProgress?.(Math.min(1, p), label);
    };

    const imgLoads = mapLimit(Object.entries(MANIFEST), LOAD_CONCURRENCY, ([key, src]) => new Promise((resolve) => {
      const im = new Image();
      im.onload = () => { images[key] = im; loaded++; imgDone++; progress(); resolve(); };
      im.onerror = () => { failed++; console.warn('[ASSETS] 素材缺失，使用矢量回退:', src); imgDone++; progress(); resolve(); };
      im.src = src;
    }));

    // 第 5 项：场景贴图纳入启动加载 —— 进战斗时地面贴图已解码完毕，不再卡主线程
    const sceneLoad = preloadScenes(d => { sceneDone = d; progress('场景贴图'); });

    // Spine 骨骼：按骨骼数比例计入进度
    const spineLoad = window.SPINE
      ? SPINE.load(p => { spineDone = p * spineCount; progress('骨骼动画'); })
      : Promise.resolve();

    // 第 14 项：全部图标 PNG 在进入首页前加载完成
    const iconLoad = preloadIcons(ICON_KEYS).then(() => { iconDone = ICON_KEYS.length; progress('技能与功能图标'); });

    // 副本缩略图等额外图片
    const extraLoad = preloadImages(extras).then(() => { extraDone = extras.length; progress('副本资料'); });

    // 注意：imgLoads 现在是 Promise（mapLimit 的返回值），不是数组，
    //       不能用 [...imgLoads] 展开 —— 展开 Promise 会抛
    //       "imgLoads is not iterable"，导致 load() 整个 reject，
    //       连带 body.assets-ready 永不置位、首页进不去。
    return Promise.all([imgLoads, sceneLoad, spineLoad, iconLoad, extraLoad]);
  }

  return {
    load, preloadScenes, preloadImages, preloadIcons,
    get: (k) => images[k] || null,
    getSvg: (k) => svgs[k] || null,
    getIcon: (k) => iconImages[k] || null,
    iconKeys: () => ICON_KEYS.slice(),
    getScene: (k) => sceneImages[k] || null,
    getSceneVariants: (k) => sceneVariants[k] || null,
    sceneTile: SCENE_TILE,
    stats: () => ({ loaded, failed, total: Object.keys(MANIFEST).length + Object.keys(SCENE_MANIFEST).length + (window.SPINE?.count() || 0) + ICON_KEYS.length, spine: window.SPINE?.stats(), icons: ICON_KEYS.length })
  };
})();
