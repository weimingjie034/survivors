/* ★ GEARLOOT · 装备卡牌 / 装备强化卡牌 掉落通道拆分（独立文件，2026-11-03）
 * ---------------------------------------------------------------------------
 * 需求原文：
 *   「将装备卡牌和装备强化卡牌掉落拆分开，降低装备卡牌爆率，
 *     避免游戏后期装备成型并且强化满级后，还高频弹出装备卡牌，影响游戏体验。」
 *
 * 【为什么要拆】
 *   旧实现里两者是同一个队列（game.gearDrops）：
 *     一次掉落 → 打开「战利品」弹层 → 弹层里可能同时给「新装备卡」和「强化卡」，
 *     而且新装备卡总是优先（代码里 picks.length < 2 才轮到强化卡）。
 *   后果：
 *     ① 后期装备已成型（5 件满级）后，avail（可换的新装备）仍可能非空
 *        （玩家学了很多图纸但只带 5 件）→ 弹层里塞满「新装备卡」→
 *        玩家只能点「放弃本次掉落」→ 弹层纯粹是打断，没有任何收益。
 *     ② 强化卡被新装备卡挤掉 → 想强化却总被换装弹层挡路。
 *   拆分后：
 *     - 「新装备卡」走 game.gearDrops，**只在新装备还有意义时**才掉。
 *     - 「强化卡」走 game.gearUpDrops，只在**还有未满级装备**时才掉。
 *     - 两条通道各自独立计数、各自独立概率、各自独立弹层。
 *     - 后期（5 件全满级 + 无新装备可换）→ 两条通道都枯竭 → 不再弹任何卡牌，
 *       掉落自动折算成金币（保持「战斗节奏不被打断」的体验）。
 *
 * 【架构约定】（遵循项目的「独立文件 + 最小挂接点」并行隔离约定）
 *   - 本文件不持有任何游戏状态，所有数据通过 ctx 注入。
 *   - game.js 只在 3 处挂接（见下方 ★ GEARLOOT_HOOK 标记）：
 *       ① killEnemy() 里掷点（rollDrop）
 *       ② pumpPopups() 里消费队列（popUp / hasPending）
 *       ③ openGearPick() 里构建强化卡候选（buildUpPicks）
 *   - 数值唯一真源：本文件内的 GEARLOOT.RATE / GEARLOOT.CFG。
 *
 * 【★ 随机数纪律】
 *   掷点用的 Math.random() 必须在**原位置**求值 —— killEnemy() 里 burst()/FX.burst()
 *   也吃随机数，挪动判定位置会让整个随机序列错位 → 掉落率/暴击率全变 → e2e 断言飘。
 *   因此 rollDrop() 内部按「与旧代码完全相同的调用顺序」求值。
 */
(function () {
  'use strict';

  // ===== 数值唯一真源 =====
  const RATE = {
    // ★ 新装备卡（小怪基础概率）—— **比旧值下调**（旧：.025 / 副本 .03）
    //   用户诉求：「降低装备卡牌爆率，避免游戏后期装备成型并且强化满级后，
    //   还高频弹出装备卡牌，影响游戏体验。」
    gear: .012,
    gearDungeon: .015,
    // 新装备卡（精英额外概率）—— 旧 .1 → .05
    gearElite: .05,
    // 首领必定掉一张（走通道分流，见 rollDrop）

    // ★ 强化卡（**独立通道**）：与新装备卡互斥分流，不抢同一张弹层。
    //   概率低于新装备卡 —— 强化是「锦上添花」，不该和换装抢焦点。
    //   后期（新装备通道枯竭时）它是唯一还有收益的通道 → 战斗不再被空卡打断。
    up: .008,
    upDungeon: .01,
    upElite: .025,
  };

  // 强化卡每次提升的等级上限（与 game.js 的 c.lvl < 3 一致）
  const UP_MAX_LVL = 3;

  // 追踪注入的上下文（由 game.js 调用 attach 注入）
  let ctx = null;
  let CALLS = { roll: 0, pop: 0, buildUp: 0, fold: 0 };

  /**
   * 注入上下文。
   * @param {object} c
   *   c.game      → game 对象（读 gear / gameMode）
   *   c.player    → 当前玩家（读 type）
   *   c.learned   → () => save.gearLearned（已研习的装备 id 数组）
   *   c.gearDef   → (id) => GEAR[id]
   *   c.rand      → () => Math.random（**必须**与 game.js 共用同一个随机源）
   *   c.dungeon   → () => 当前是否副本模式
   *   c.folder    → (gold) => 折算金币（掉落空池时的既有行为）
   */
  function attach(c) { ctx = c; }

  // ===== 资格判定 =====

  /** 玩家身上还有未满级（lvl < 3）的装备？—— 强化卡通道的前提 */
  function hasUpgradable() {
    const g = ctx.game.gear || [];
    for (const c of g) if (c.lvl < UP_MAX_LVL) return true;
    return false;
  }

  /** 还有「未装备且已研习」的同职业装备可换？—— 新装备卡通道的前提 */
  function hasReplaceable() {
    const p = ctx.player, learned = ctx.learned() || [];
    const owned = new Set((ctx.game.gear || []).map(c => c.id));
    for (const gid of learned) {
      const def = ctx.gearDef(gid);
      if (!def) continue;
      if (def.cls !== p.type) continue;
      if (owned.has(gid)) continue;
      return true;
    }
    return false;
  }

  /**
   * 装备栏是否已「成型」—— 5 件全满级。
   * 成型后新装备卡的价值 = 0（换掉一件满级装备去带一件新的 Lv.1，是净亏），
   * 所以此时必须彻底停掉新装备卡通道。
   */
  function isGearMaxed() {
    const g = ctx.game.gear || [];
    if (g.length < 5) return false;
    for (const c of g) if (c.lvl < UP_MAX_LVL) return false;
    return true;
  }

  /**
   * 新装备卡通道是否还有意义。
   * 规则（按用户诉求「后期装备成型并且强化满级后不再高频弹出」）：
   *   ① 装备栏未满（<5 件）→ 有意义（还能装新的）
   *   ② 装备栏已满但存在未满级装备 → 有意义（换装可以让某件变强/补短板）
   *   ③ 装备栏已满且全部满级 → **无意义** → 该通道彻底停止
   */
  function gearChannelUseful() {
    const g = ctx.game.gear || [];
    if (g.length < 5) return true;
    return hasUpgradable();
  }

  /** 强化卡通道是否还有意义 */
  function upChannelUseful() {
    return hasUpgradable();
  }

  /**
   * 掷点：决定这次击杀掉几个新装备卡 / 几个强化卡。
   *
   * ★★ 随机数纪律（本项目最易踩的坑之一）：
   *   `Math.random()` 的**调用次数与位置**都不能变 —— killEnemy() 里 burst()/FX.burst()
   *   内部也吃随机数，一旦这里多调或少调一次，后面所有判定（掉落率/暴击率）的
   *   随机序列全部错位 → e2e 断言变成「有时过有时不过」的 flaky。
   *   旧实现的调用结构是：
   *       if (e.boss) gearDropCount = 1;                       // 首领：不调 random
   *       else { if (rand() < p) gearDropCount++;               // 小怪：1 次
   *                if (e.elite && rand() < .1) gearDropCount++; } // 精英：再 1 次
   *   本函数**严格保持同样的调用次数**（首领 0 次 / 小怪 1 次 / 精英 2 次），
   *   只把同一次 random 的结果**分流**到两个通道：
   *       r < gearRate            → 新装备卡
   *       gearRate <= r < gearRate + upRate → 强化卡
   *   这样两个通道独立可调、互不挤占，且不新增任何 random 调用。
   *
   * @param {object} o
   *   o.boss   → 是否首领
   *   o.elite  → 是否精英
   *   o.mode   → 'adventure' | 'dungeon' | 'td'
   * @returns {{gear:number, up:number}}
   */
  function rollDrop(o) {
    CALLS.roll++;
    let gear = 0, up = 0;
    const isDungeon = o.mode === 'dungeon';
    // —— 以下 random 调用次数与旧实现严格一致 ——
    if (o.boss) {
      // 首领：必定掉一张。走哪条通道由「哪条通道有意义」决定。
      //   装备栏已满且全部满级 → 装备卡通道无意义 → 改掉强化卡（若也满级则折算金币）
      if (gearChannelUseful()) gear += 1;
      else if (upChannelUseful()) up += 1;
      else gear += 1;   // 两条通道都枯竭 → 仍记 1 张，由上层折算金币（不弹空卡）
    } else {
      // 小怪 / 精英：基础档（1 次 random）
      const r = ctx.rand();
      const gearRate = isDungeon ? RATE.gearDungeon : RATE.gear;
      const upRate = isDungeon ? RATE.upDungeon : RATE.up;
      if (r < gearRate) {
        if (gearChannelUseful()) gear += 1;
      } else if (r < gearRate + upRate) {
        if (upChannelUseful()) up += 1;
      }
      // 精英额外档（再 1 次 random）
      if (o.elite) {
        const r2 = ctx.rand();
        if (r2 < RATE.gearElite) {
          if (gearChannelUseful()) gear += 1;
        } else if (r2 < RATE.gearElite + RATE.upElite) {
          if (upChannelUseful()) up += 1;
        }
      }
    }
    return { gear, up };
  }

  /**
   * 构建「强化卡」候选列表（强化已有装备）。
   * 与新装备卡完全独立：不占用新装备的候选位，也不再被新装备挤掉。
   *
   * @param {number} n 最多给几张（通常 1~2）
   * @returns {Array<{kind:'up', gearId:string, rarity:number}>}
   */
  function buildUpPicks(n) {
    CALLS.buildUp++;
    const g = ctx.game.gear || [];
    const out = [];
    const used = new Set();
    const pool = g.filter(c => c.lvl < UP_MAX_LVL && !used.has(c.id));
    if (!pool.length) return out;
    const rand = ctx.rand;
    for (let i = 0; i < n && pool.length; i++) {
      const idx = Math.floor(rand() * pool.length) % pool.length;
      const c = pool.splice(idx, 1)[0];
      used.add(c.id);
      const def = ctx.gearDef(c.id);
      out.push({ kind: 'up', gearId: c.id, rarity: Math.min(4, (def ? def.rarity : 1) + c.lvl) });
    }
    return out;
  }

  /**
   * 队列消费：取出一条待弹的卡牌弹层内容。
   * ★ 优先级：强化卡优先于新装备卡 —— 强化卡是「确定收益」，
   *   新装备卡在装备栏满时还要多一步「指定替换目标」，交互更重。
   *
   * @returns {{kind:'gear'|'up', ...}|null}
   */
  function popUp() {
    CALLS.pop++;
    const game = ctx.game;
    // 强化卡队列
    if ((game.gearUpDrops || 0) > 0 && upChannelUseful()) {
      const picks = buildUpPicks(Math.min(3, game.gearUpDrops));
      if (picks.length) {
        game.gearUpDrops -= 1;
        return { kind: 'up-pick', picks };
      }
    }
    // 新装备卡队列
    if ((game.gearDrops || 0) > 0 && gearChannelUseful()) {
      game.gearDrops -= 1;
      return { kind: 'gear-pick' };
    }
    return null;
  }

  /** 是否有待弹的卡牌（供 pumpPopups 判断是否要开弹层） */
  function hasPending() {
    const game = ctx.game;
    return ((game.gearUpDrops || 0) > 0 && upChannelUseful())
      || ((game.gearDrops || 0) > 0 && gearChannelUseful());
  }

  /**
   * 掉落被判定为「无意义」时的折算：直接给金币，不再弹空弹层。
   * 旧行为是 `p.gold += 20; announce('战利品折算 · +20 金币')`，
   * 这里沿用同样的口径，避免玩家觉得「白打一场」。
   */
  function foldToGold(n) {
    if (!n) return 0;
    CALLS.fold++;
    const p = ctx.player;
    const gold = 20 * n;
    p.gold += gold;
    if (ctx.announce) ctx.announce(`战利品折算 · +${gold} 金币`, '#ffe094', 1.4);
    return gold;
  }

  window.GEARLOOT = {
    RATE, UP_MAX_LVL,
    attach,
    rollDrop,
    buildUpPicks,
    popUp,
    hasPending,
    foldToGold,
    // 状态查询（给 e2e 断言用）
    hasUpgradable, hasReplaceable, isGearMaxed,
    gearChannelUseful, upChannelUseful,
    CALLS,
  };
})();
