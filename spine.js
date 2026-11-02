/* spine.js — Spine 4.1 实时骨骼渲染层
 * 英雄/首领/技能特效共用加载与实例管理；任何失败均由调用方回退 PNG/矢量。 */
window.SPINE = (() => {
  'use strict';
  const A = 'assets/spine/', F = 'assets/spine-fx/';
  const actor = (file, height, extra = {}) => ({ dir: A, file, height, baseline: 16, ...extra });
  const effect = (file, height, extra = {}) => ({ dir: F, file, height, anchor: 'center', ...extra });
  const CONFIG = {
    mage: actor('Jianna', 88),
    warrior: actor('Jianshen', 94),
    hunter: actor('Xierwanasi', 88, { anim: { cast: 'attack_2' } }),
    boss_hogger: actor('Langwang', 150),
    boss_molten: actor('Lagenaluosi_boss', 170, { anim: { walk: 'stand_1' } }),
    boss_abyss: actor('Enzuosi', 165, { anim: { walk: 'stand_1' } }),
    boss_lich: actor('Keersujiade', 158),
    boss_barren: actor('Keduoshou', 158),
    boss_plague: actor('Shishigui', 158, { anim: { cast: 'attack_2' } }),
    // ===== 第 10 项：冒险模式 20 个唯一 Boss 模型 =====
    // 四个副本各 5 个首领，模型互不重复；无尽模式复用同一批模型（需求：副本 Boss 全部进入无尽池）。
    boss_yougesalong: actor('Yougesalong', 162, { anim: { walk: 'stand_1', cast: 'attack_1' } }),
    boss_heishou: actor('Heishou', 156),
    boss_huimiezhe: actor('Huimiezhe', 160, { anim: { cast: 'skill1_1_01' } }),
    boss_lieyandeluyi: actor('Lieyandeluyi', 154),
    boss_shixianggui: actor('Shixianggui', 152),
    boss_anubalake: actor('Anubalake', 168),
    boss_mengjingshuyao: actor('Mengjingshuyao', 158, { anim: { stun: 'stunt_1_01' } }),
    boss_tikediaosi: actor('Tikediaosi_boss_1', 166),
    boss_jumo: actor('Jumolietouzhe', 154),
    boss_fenghe: actor('Fengheguai', 160),
    boss_fankelifu: actor('Fankelifu', 150, { anim: { cast: 'skill1_1_01' } }),
    boss_aoshu: actor('Aoshujuxiang', 176),
    boss_yilidan: actor('Yilidan_01', 158),
    boss_xindagousa: actor('Xindagousa', 164),
    boss_qinglong: actor('Qinglong', 156),
    boss_baihu: actor('Baihu', 154, { anim: { stun: 'stunt_1_01' } }),
    pet_wolf: actor('Xianzhi_youlinglang', 54, { baseline: 9 }),

    // ===== 熔火之心团队副本（8 位 Boss + 4 种小怪，模型与前 22 位首领全局互不重复）=====
    // 路基弗隆：熔岩石巨人（地狱火领主）—— 抛射火球 / 熔岩喷吐
    boss_lucifron: actor('Diyuhuolingzhu', 172, { anim: { cast: 'skill1_1' } }),
    // 玛格达拉：重甲法师 —— 灼热新星 / 陨石雨
    boss_magmadar: actor('Dianyuzhang', 166, { anim: { cast: 'skill1_1' } }),
    // 沙兹拉克：火焰女巫 —— 恐惧尖啸 / 召唤荆棘
    boss_shazzrah: actor('Huoyannvwu', 158, { anim: { cast: 'attack_1' } }),
    // 古尔戈：食人魔 —— 横扫 / 怒吼加速
    boss_goregg: actor('Shirenmo', 178, { anim: { cast: 'attack_1' } }),
    // 金度·六爪：甲壳恶魔 —— 恐惧光环 / 召唤蛛群
    boss_jindo: actor('Dixueemo', 164, { anim: { cast: 'skill1_1' } }),
    // 萨卡托斯：巨型石巨人 —— 猛击 / 震地
    boss_sarkoth: actor('Shanlingjuren', 182, { anim: { cast: 'skill1_1' } }),
    // 萨弗拉斯·炎魔之手（最终 BOSS）：巨型恶魔 —— 熔火爆发 / 召唤 / 狂暴
    boss_sulfuras: actor('naifalian', 176, { anim: { cast: 'attack_1', death: 'death_1' } }),
    // 炎魔之王·拉格纳罗斯（原 boss_molten 的拉格纳罗斯模型让给团本，熔岩暴君改用熔岩红龙）
    boss_ragnaros: actor('Lagenaluosi_boss', 178, { anim: { walk: 'stand_1', cast: 'skill1_1' } }),
    // 玛尔科多莫·奥利加尔（原版熔火之心元素领主段）：大魔法师 —— 元素新星 / 元素召唤
    boss_majordomo: actor('Damofashi', 172, { anim: { cast: 'skill1_1' } }),
    // 小怪：熔岩傀儡 / 地狱猎犬 / 火焰行者 / 灼热峡谷飞翼
    mob_lavaspawn: actor('Aoshujuxiang_hong', 96, { baseline: 14 }),
    mob_corehound: actor('Xuanniu', 86, { baseline: 13 }),
    mob_flamewarden: actor('Shourenbubing', 88, { baseline: 13 }),
    mob_sparkswirl: actor('Bianfuqishi', 82, { baseline: 12 }),

    mage_ice: effect('Buff_Effect_bingdong_1_tx', 100, { bounds: 'first' }),
    magic_circle: effect('Buff_Effect_qimen_tx_2', 135, { bounds: 'first' }),
    warrior_shockwave: effect('xuchu_skill_tx_2', 145, { dynamic: 1.55 }),
    hunter_arrow: effect('huangzhong_atk_zd_1', 34, { bounds: 'first' }),
    warrior_slash: effect('dianwei_skill_tx_1', 145, { dynamic: 1.65 }),
    warrior_bladestorm: effect('xuchu_skill_tx_1', 170, { dynamic: 1.5 }),
    mage_fire: effect('Buff_Effect_yuhuo_1', 245, { bounds: 'first' }),
    mage_shield: effect('dianwei_skill_buff_1', 118, { bounds: 'first' }),
    hunter_trap: effect('Buff_Effect_fengyin_2', 100, { bounds: 'first' }),
    mage_arcane: effect('simayi_skill_1', 190, { dynamic: 1.6 }),
    warrior_charge: effect('taishici_dd_1', 90, { dynamic: 1.35 }),
    common_aura: effect('Buff_Effect_dieying_1_tx', 125, { bounds: 'first' }),
    // 探针实测（tools/spine-orient.mjs）：该素材各帧面积重心 Y ≈ +95（骨骼空间朝上），
    // 画布渲染默认已做 Y 轴翻转，视觉本来就是向上喷发 —— 此前的 flipY 反而把它翻成了向下。
    common_explosion: effect('wanju5_beaten_1', 185, { dynamic: 1.8 }),

    // ===== 熔火之心团本专用特效 =====
    fx_magma_pool: effect('wanju3_beaten_1', 210, { dynamic: 1.5 }),       // 岩浆池：地面火环 + 上升火焰
    fx_magma_ring: effect('wanju4_beaten_1', 200, { dynamic: 1.5 }),      // 岩浆池涟漪底纹
    fx_fire_column: effect('M_zhurongfuren_skill_beaten_2', 260, { dynamic: 1.6 }), // 炎魔火柱
    fx_flame_breath: effect('M_zhurongfuren_skill_tx_1', 240, { dynamic: 1.7 }),    // 熔火喷吐长廊
    fx_meteor_rain: effect('M_zhurongfuren_atk_beaten_1', 230, { dynamic: 1.7 }),   // 熔岩陨石雨
    fx_ash_rain: effect('menghuo_skill1_beaten_1', 220, { dynamic: 1.7 }),          // 灰烬火雨
    fx_ground_fire: effect('Buff_Effect_huoyou_1_tx', 180, { dynamic: 1.6 }),       // 地面持续燃烧
    fx_flame_burst: effect('machao_skill_beaten_1', 210, { dynamic: 1.7 }),         // 多段火焰冲击波
    fx_meteor_strike: effect('huangyueying_skill_beaten_2', 200, { dynamic: 1.6 }),  // 陨石落点光柱
    fx_ground_burst: effect('wanju6_beaten_1', 160, { dynamic: 1.5 }),              // 地面爆点
    fx_shock_ring: effect('wanju1_beaten_1', 200, { dynamic: 1.7 })                 // 冲击环 + 火星
  };
  const DEFAULT_ANIM = { idle: 'stand_1', walk: 'run_1', attack: 'attack_1', cast: 'skill1_1', death: 'fall_1', hit: 'hit_1', stun: 'stunt_1' };
  const resources = {}, actorViews = new WeakMap(), fxViews = new WeakMap();
  let renderer = null, actorsCreated = 0, fxCreated = 0, loaded = 0, failed = 0;
  let enabled = typeof spine !== 'undefined' && location.protocol !== 'file:' && new URLSearchParams(location.search).get('spine') !== '0';
  const keys = Object.keys(CONFIG);
  const has = key => !!resources[key];

  async function loadOne(key, cfg) {
    const manager = new spine.AssetManager(cfg.dir + key + '/');
    manager.loadJson(cfg.file + '.json');
    manager.loadTextureAtlas(cfg.file + '.atlas');
    await manager.loadAll();
    const atlas = manager.require(cfg.file + '.atlas');
    const json = new spine.SkeletonJson(new spine.AtlasAttachmentLoader(atlas));
    const data = json.readSkeletonData(manager.require(cfg.file + '.json'));
    const skeleton = new spine.Skeleton(data);
    skeleton.setToSetupPose();
    // 多数特效在 setup pose/第 0 帧没有可见附件，采样动画时间轴寻找首个有效帧。
    let bounds;
    if (cfg.anchor === 'center' && data.animations.length) {
      const state = new spine.AnimationState(new spine.AnimationStateData(data));
      const animation = data.animations[0]; state.setAnimation(0, animation.name, false);
      const frames = Math.min(150, Math.ceil((animation.duration || 1) * 30) + 1);
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i < frames; i++) {
        state.update(1 / 30); state.apply(skeleton); skeleton.updateWorldTransform();
        const b = skeleton.getBoundsRect();
        if (!Number.isFinite(b.width + b.height) || b.height <= 0) continue;
        if (cfg.bounds === 'first') { bounds = b; break; }
        minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
        maxX = Math.max(maxX, b.x + b.width); maxY = Math.max(maxY, b.y + b.height);
      }
      if (!bounds && Number.isFinite(minX + minY + maxX + maxY)) bounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    } else {
      skeleton.updateWorldTransform(); bounds = skeleton.getBoundsRect();
    }
    if (!bounds || !Number.isFinite(bounds.width + bounds.height) || bounds.height <= 0) throw new Error('invalid animation bounds');
    let mesh = false, tris = 0;
    for (const skin of data.skins) for (const attachments of Object.values(skin.attachments)) {
      for (const attachment of Object.values(attachments)) {
        if (attachment instanceof spine.MeshAttachment) { mesh = true; tris += (attachment.triangles?.length || 0) / 3; }
      }
    }
    resources[key] = { key, cfg, data, bounds, mesh, tris: Math.round(tris) };
  }

  function load(onProgress) {
    if (!enabled) { onProgress?.(1); return Promise.resolve(); }
    let done = 0;
    return Promise.all(keys.map(key => loadOne(key, CONFIG[key]).catch(err => {
      failed++; console.warn('[SPINE] 素材加载失败，使用回退:', key, err.message || err);
    }).finally(() => { done++; loaded++; onProgress?.(done / keys.length); })));
  }

  function animationName(res, semantic) {
    const wanted = res.cfg.anim?.[semantic] || DEFAULT_ANIM[semantic] || semantic;
    const choices = Array.isArray(wanted) ? wanted : [wanted];
    for (const name of choices) if (name && res.data.findAnimation(name)) return name;
    const fallbacks = semantic === 'cast' ? ['attack_2', 'attack_1', 'stand_1'] : semantic === 'death' ? ['fall_1', 'stand_1'] : ['stand_1', 'texiao', 'animation', 'attack'];
    for (const name of fallbacks) if (res.data.findAnimation(name)) return name;
    return res.data.animations[0]?.name || null;
  }

  function createView(key, effectView) {
    const res = resources[key]; if (!res) return null;
    const skeleton = new spine.Skeleton(res.data);
    skeleton.setToSetupPose();
    if (effectView && res.cfg.screen !== false) {
      // 黑底候选使用 Screen；本身含烟雾/半透明灰阶的素材保留原始混合。
      for (const slot of skeleton.slots) {
        const data = Object.assign(Object.create(Object.getPrototypeOf(slot.data)), slot.data);
        data.blendMode = spine.BlendMode.Screen; slot.data = data;
      }
    }
    const stateData = new spine.AnimationStateData(res.data); stateData.defaultMix = .08;
    const state = new spine.AnimationState(stateData);
    // 重骨骼（BOSS 等上千三角形的网格）走离屏帧缓存 + 30Hz 动画更新：
    // canvas 2D 下逐三角形填充极贵，缓存后每帧只剩一次贴图。
    const view = { res, skeleton, state, base: '', prev: {}, effectView, heavy: res.tris > 1000, acc: 0, ticked: true };
    if (effectView) fxCreated++; else actorsCreated++;
    return view;
  }

  function setBase(view, semantic, loop) {
    const name = animationName(view.res, semantic);
    if (!name || (view.base === name && view.baseLoop === loop)) return;
    view.base = name; view.baseLoop = loop;
    view.state.setAnimation(0, name, loop);
  }

  function trigger(view, semantic) {
    const name = animationName(view.res, semantic); if (!name) return;
    const entry = view.state.setAnimation(1, name, false);
    entry.mixDuration = .04; entry.timeScale = view.res.cfg.actionScale || 1.35;
    view.state.addEmptyAnimation(1, .06, 0);
  }

  function updateActor(owner, key, desc, dt) {
    if (!enabled || !resources[key]) return false;
    let view = actorViews.get(owner);
    if (!view || view.res.key !== key) { view = createView(key, false); if (!view) return false; actorViews.set(owner, view); }
    const dead = !!desc.dead;
    setBase(view, dead ? 'death' : desc.stun ? 'stun' : desc.moving ? 'walk' : 'idle', !dead);
    if (!dead) {
      if (desc.cast > 0 && !(view.prev.cast > 0)) trigger(view, 'cast');
      else if (desc.attack > 0 && !(view.prev.attack > 0)) trigger(view, 'attack');
    }
    view.prev = { ...desc };
    if (view.heavy) {
      // 30Hz 更新：两次刷新之间直接复用缓存帧，视觉上仍是流畅的动作（骨骼动画 30 帧已足够）
      view.acc = Math.min((view.acc || 0) + dt, .25);
      if (view.acc < 1 / 30) { view.ticked = false; return true; }
      dt = view.acc; view.acc = 0; view.ticked = true;
    }
    view.state.update(dt); view.state.apply(view.skeleton); view.skeleton.updateWorldTransform();
    return true;
  }

  function updateFx(owner, key, dt, opts = {}) {
    if (!enabled || !resources[key]) return false;
    let view = fxViews.get(owner);
    if (!view || view.res.key !== key) {
      view = createView(key, true); if (!view) return false;
      fxViews.set(owner, view);
      const name = animationName(view.res, 'fx');
      if (name) view.state.setAnimation(0, name, !!opts.loop);
    }
    view.state.timeScale = opts.timeScale || 1;
    view.state.update(dt); view.state.apply(view.skeleton); view.skeleton.updateWorldTransform();
    return true;
  }

  function place(view, opts, actorMode) {
    const { res, skeleton } = view, cfg = res.cfg;
    let b = res.bounds;
    if (cfg.dynamic && !actorMode) {
      // 先清除上一帧的绘制变换，否则动态边界会被旧 scale 二次放大/缩小。
      skeleton.x = 0; skeleton.y = 0; skeleton.scaleX = 1; skeleton.scaleY = 1;
      skeleton.updateWorldTransform();
      const current = skeleton.getBoundsRect();
      if (Number.isFinite(current.width + current.height) && current.height > .001) b = current;
    }
    const target = opts.size || cfg.height;
    // 范围技能按最大视觉直径适配，避免横向长弧仅按高度缩放后越出实际判定。
    const dimension = opts.fit === 'diameter' ? Math.max(b.width, b.height) : b.height;
    const baseDimension = opts.fit === 'diameter' ? Math.max(res.bounds.width, res.bounds.height) : res.bounds.height;
    let scale = target / Math.max(.001, dimension);
    // 数值型 dynamic 同时作为放大上限，防止细小首帧被拉满全屏。
    if (typeof cfg.dynamic === 'number') scale = Math.min(scale, target / Math.max(.001, baseDimension) * cfg.dynamic);
    const flip = opts.flip ? -1 : 1;
    const flipY = opts.flipY ?? cfg.flipY;
    skeleton.scaleX = scale * flip; skeleton.scaleY = -scale * (flipY ? -1 : 1);
    const cx = b.x + b.width / 2;
    if (actorMode) {
      skeleton.x = -cx * scale * flip;
      skeleton.y = (opts.baseline ?? cfg.baseline ?? 0) + b.y * scale;
    } else {
      skeleton.x = -cx * scale * flip;
      skeleton.y = (b.y + b.height / 2) * scale * (flipY ? -1 : 1);
    }
    skeleton.color.a = opts.alpha ?? 1;
    const tint = opts.tint || cfg.tint;
    skeleton.color.r = tint?.[0] ?? 1; skeleton.color.g = tint?.[1] ?? 1; skeleton.color.b = tint?.[2] ?? 1;
    // 动态测量会先重置变换；最终缩放与锚点必须在绘制前重新应用到骨骼顶点。
    skeleton.updateWorldTransform();
  }

  function drawActor(owner, opts = {}) {
    const view = actorViews.get(owner); if (!view || !enabled) return false;
    if (!renderer) renderer = new spine.SkeletonRenderer(opts.ctx);
    renderer.ctx = opts.ctx; renderer.triangleRendering = view.res.mesh;
    place(view, opts, true);
    if (!view.heavy) { renderer.draw(view.skeleton); return true; }
    // 重骨骼：把当前姿态渲染到离屏画布，之后每帧只做一次贴图（BOSS 战卡顿的主要优化点）
    const sig = `${opts.size || ''}|${opts.flip ? 1 : 0}|${(opts.alpha ?? 1).toFixed(2)}|${opts.tint ? opts.tint.join(',') : ''}`;
    if (!view.cache || view.ticked || view.sig !== sig) { renderActorCache(view); view.sig = sig; }
    const r = view.cacheRect;
    if (r) opts.ctx.drawImage(view.cache, 0, 0, r.w, r.h, r.x, r.y, r.w, r.h);
    return true;
  }

  // 离屏帧缓存：以实体原点为基准记录包围盒，重绘时平移到画布内，绘制时按包围盒偏移贴回
  function renderActorCache(view) {
    const b = view.skeleton.getBoundsRect();
    if (!b || !Number.isFinite(b.width + b.height) || b.width <= 0 || b.height <= 0) { renderer.draw(view.skeleton); view.ticked = false; return; }
    const pad = 8;
    const w = Math.ceil(b.width + pad * 2), h = Math.ceil(b.height + pad * 2);
    if (!view.cache) { view.cache = document.createElement('canvas'); view.cache.width = w; view.cache.height = h; view.cacheCtx = view.cache.getContext('2d'); }
    else if (view.cache.width < w || view.cache.height < h) { view.cache.width = Math.max(w, view.cache.width); view.cache.height = Math.max(h, view.cache.height); }
    const c = view.cacheCtx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, view.cache.width, view.cache.height);
    c.save(); c.translate(-b.x + pad, -b.y + pad);
    const prev = renderer.ctx; renderer.ctx = c; renderer.draw(view.skeleton); renderer.ctx = prev;
    c.restore();
    view.cacheRect = { x: b.x - pad, y: b.y - pad, w: view.cache.width, h: view.cache.height };
    view.ticked = false;
  }

  function drawFx(owner, opts = {}) {
    const view = fxViews.get(owner); if (!view || !enabled) return false;
    if (!renderer) renderer = new spine.SkeletonRenderer(opts.ctx);
    const ctx = opts.ctx; renderer.ctx = ctx; renderer.triangleRendering = view.res.mesh;
    ctx.save(); ctx.translate(opts.x || 0, opts.y || 0); if (opts.angle) ctx.rotate(opts.angle);
    place(view, opts, false); renderer.draw(view.skeleton); ctx.restore();
    return true;
  }

  // 第 5 项：预热 —— 在首页后台把每个素材渲染一次到离屏画布，
  // 提前完成图集纹理上传 / 三角形光栅化路径的 JIT 编译，
  // 避免玩家点「开始远征」后第一帧卡住（尤其重骨骼首领的离屏帧缓存首次构建）。
  let warmed = false;
  function warmup() {
    if (!enabled || warmed) return;
    warmed = true;
    const c = document.createElement('canvas'); c.width = 48; c.height = 48;
    const cx = c.getContext('2d');
    for (const key of keys) {
      if (!resources[key]) continue;
      const owner = {};
      try {
        if (CONFIG[key].dir === F) {
          updateFx(owner, key, 1 / 60, { loop: true });
          drawFx(owner, { ctx: cx, x: 24, y: 24, size: 24 });
        } else {
          updateActor(owner, key, { moving: false }, 1 / 60);
          drawActor(owner, { ctx: cx });
        }
      } catch (e) { /* 预热失败不影响正式游戏 */ }
    }
  }

  return {
    load, has, updateActor, drawActor, updateFx, drawFx, warmup,
    count: () => enabled ? keys.length : 0,
    stats: () => ({ loaded: loaded - failed, failed, total: enabled ? keys.length : 0, actorsCreated, fxCreated, enabled }),
    setEnabled: value => { enabled = !!value && typeof spine !== 'undefined'; }
  };
})();
