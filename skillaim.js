/* ★ SKILLAIM · 范围技能落点统一为「最近的敌人脚下」（独立文件，2026-11-03）
 * ---------------------------------------------------------------------------
 * 需求原文：
 *   「将法师和猎人的所有范围技能（暴风雪、爆炸陷阱等）改为烈焰风暴一样
 *     在最近的敌人脚下释放。」
 *
 * 【为什么要统一】
 *   旧实现里各范围技能落点各不相同：
 *     - 烈焰风暴 flamestrike → nearestEnemy(700)，落在**最近敌人脚下**（已是新基准）
 *     - 暴风雪 blizzard      → 落在**玩家自己脚下**（打不中远处的怪）
 *     - 魔爆术 arcane_nova   → 落在**玩家自己脚下**（近战式范围技，法师却要贴脸）
 *     - 爆炸陷阱 explosive_trap / 冰冻陷阱 freezing_trap → 落在**玩家身后 40/80 码**
 *   玩家操作时需要「放出去就打中」，而不是「先跑过去再放」。
 *   统一后：所有范围技能都自动索敌 → 落在敌人脚下 → 站桩输出即可。
 *
 * 【落点规则】（与烈焰风暴完全一致）
 *   1. 有敌人 → 落在**最近敌人的脚下**（不是身上偏移，是正下方）
 *   2. 无敌人 → 回退到「玩家朝向方向前方 220 码」（保持技能的"向前施放"语义）
 *   3. 索敌距离上限：默认 700 码（与烈焰风暴一致）→ 超出射程的怪不选
 *
 * 【架构约定】（遵循项目的「独立文件 + 最小挂接点」并行隔离约定）
 *   - 本文件不持有任何游戏状态，需要的数据通过 ctx 注入。
 *   - game.js 只在 1 处桥接（attach）+ 各技能一行调用。
 *   - 数值唯一真源：本文件内的 SKILLAIM.RANGE / SKILLAIM.FALLBACK_DIST。
 */
(function () {
  'use strict';

  // ===== 数值唯一真源 =====
  const RANGE = 700;          // 索敌距离上限（与烈焰风暴一致）
  const FALLBACK_DIST = 220;  // 无敌人时，向玩家朝向前方回退的距离（与烈焰风暴一致）

  let ctx = null;
  let CALLS = { aim: 0 };

  /**
   * 注入上下文（由 game.js 调用 attach 注入）
   * @param {object} c
   *   c.player     → () => 当前玩家对象（读 x/y/dirX/dirY）
   *   c.nearestEnemy → (maxRange) => 最近的敌人对象或 null
   */
  function attach(c) { ctx = c; }

  /**
   * 计算范围技能的落点。
   *
   * @param {object} p  施法者（通常是玩家；联机时可能是队友）
   * @param {number} range  索敌距离上限（缺省 700）
   * @returns {{x:number, y:number, target:object|null}}
   */
  function aim(p, range) {
    CALLS.aim++;
    const R = range || RANGE;
    const pl = p || ctx.player();
    const a = Math.atan2(pl.dirY || 0, pl.dirX || 1);
    const tgt = ctx.nearestEnemy(R);
    // ★ 有敌人 → 落在最近敌人脚下；无敌人 → 回退到朝向前方
    if (tgt) return { x: tgt.x, y: tgt.y, target: tgt };
    return { x: pl.x + Math.cos(a) * FALLBACK_DIST, y: pl.y + Math.sin(a) * FALLBACK_DIST, target: null };
  }

  window.SKILLAIM = {
    RANGE, FALLBACK_DIST,
    attach,
    aim,
    CALLS,
  };
})();
