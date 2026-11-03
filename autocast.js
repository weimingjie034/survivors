/* ===== 自动施法模块（autocast.js）=====
 * 独立文件的原因：并行开发隔离约定（多任务并行时主体代码不进 game.js）。
 * game.js 只留 3 处挂接点：
 *   ① AUTOCAST_HOOK · 1：attach() 注入上下文（能力访问器，不持有游戏状态）
 *   ② AUTOCAST_HOOK · 2：update() 在战斗主循环里被调用
 *   ③ AUTOCAST_HOOK · 3：UI 按钮事件绑定 + 状态同步
 *
 * 需求（2026-11-03）：战斗时新增一个自动开关，打开后自动释放所有技能
 *   （**技能范围内有怪物时**才释放）。
 *
 * ★ 核心原则：自动施法**只代替玩家按键**，走的仍是 castActive() 这条唯一通路 ——
 *   不绕过冷却、不绕过联机倒地保护、不绕过任何游戏规则。
 *   任何「自动」逻辑都不得直接改伤害/HP/等级。
 */
window.AUTOCAST = (() => {
  // ===== 验收计数（挂接点被并行任务冲掉时，e2e 脚本会立刻失败而不是静默退化）=====
  const CALLS = { update: 0, cast: 0, skip: 0, toggle: 0, attach: 0 };

  const STORAGE_KEY = 'azs_autocast';
  // 两次自动施放之间的最小间隔（秒）—— 防止 4 个技能同帧齐发
  const MIN_GAP = 0.15;

  const state = {
    on: false,          // 开关状态（持久化到 localStorage）
    lastCastAt: -999,  // 上次施放时的 game.elapsed
    castCount: 0,      // 本局自动施放次数（验收用）
  };

  let ctx = null;

  // ===== 技能触发规格表（数值唯一真源）=====
  // mode:
  //   'land' → 落在最近敌人脚下：需要「施放距离内存在敌人」（落点即命中）
  //   'self' → 以自身为中心：需要「敌人在技能作用半径内」
  //   'ahead'→ 朝向前方释放（弹道/扇形/锥形）：需要「朝向扇形内有敌人」
  //   'any'  → 任意方向索敌（自动锁定最近敌人）：需要「索敌距离内有敌人」
  //   'buff' → 自身增益：附近有怪才放（否则纯浪费 CD）
  // reach: 该模式下的判定距离（码）
  // half : 'ahead' 模式的半角（弧度）
  const SPEC = {
    // —— 落在最近敌人脚下 ——
    blizzard:         { mode: 'land', reach: 420 },
    flamestrike:      { mode: 'land', reach: 620 },  // 原实现 nearestEnemy(700)
    arcane_nova:      { mode: 'land', reach: 380 },
    explosive_trap:   { mode: 'land', reach: 420 },
    freezing_trap:    { mode: 'land', reach: 420 },
    // —— 以自身为中心 ——
    war_stomp:        { mode: 'self', reach: 170 },
    blade_storm:      { mode: 'self', reach: 210 },
    demoralizing_shout: { mode: 'self', reach: 200 },
    // —— 朝向前方 ——
    frost_orb:        { mode: 'ahead', reach: 520, half: 0.75 },
    arcane_blast:     { mode: 'ahead', reach: 330, half: 0.75 },
    shockwave:        { mode: 'ahead', reach: 300, half: 0.85 },
    multi_shot:       { mode: 'ahead', reach: 460, half: 0.95 },
    charge:           { mode: 'ahead', reach: 260, half: 1.05 },
    // —— 任意方向索敌 ——
    mortal_strike:    { mode: 'any', reach: 400 },
    kill_command:     { mode: 'any', reach: 520 },
    // —— 自身增益 ——
    ice_barrier:      { mode: 'buff', reach: 340 },
    icy_veins:        { mode: 'buff', reach: 340 },
    mirror_image:     { mode: 'buff', reach: 340 },
    shield_wall:      { mode: 'buff', reach: 340 },
    berserker_rage:   { mode: 'buff', reach: 340 },
    rapid_fire:       { mode: 'buff', reach: 340 },
    call_pet:         { mode: 'buff', reach: 340 },
    aspect_wild:      { mode: 'buff', reach: 340 },
  };

  // ============================================================
  // 持久化
  // ============================================================
  function load() {
    try { state.on = localStorage.getItem(STORAGE_KEY) === '1'; } catch (e) { state.on = false; }
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, state.on ? '1' : '0'); } catch (e) { /* 隐私模式下忽略 */ }
  }

  // ============================================================
  // 开关
  // ============================================================
  function toggle() {
    state.on = !state.on;
    save();
    CALLS.toggle++;
    try { ctx?.onChange?.(state.on); } catch (e) { /* 忽略 UI 回调异常 */ }
    return state.on;
  }
  function setOn(v) {
    state.on = !!v;
    save();
    try { ctx?.onChange?.(state.on); } catch (e) { /* 忽略 */ }
    return state.on;
  }

  // ============================================================
  // 目标判定
  // ============================================================
  /** 最近敌人（扣掉敌人自身半径，避免「擦边」也算命中） */
  function nearest(p, enemies, reach) {
    let best = null, bestD = reach;
    for (const e of enemies) {
      if (!e || e.dead) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y) - (e.r || 0);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  /** 朝向扇形内的最近敌人 */
  function ahead(p, enemies, reach, half) {
    const len = Math.hypot(p.dirX, p.dirY);
    if (!(len > 0.001)) return null;           // 没有朝向 → 不猜，直接不放
    const ux = p.dirX / len, uy = p.dirY / len;
    const cosHalf = Math.cos(half);
    let best = null, bestD = reach;
    for (const e of enemies) {
      if (!e || e.dead) continue;
      const ex = e.x - p.x, ey = e.y - p.y;
      const dist = Math.hypot(ex, ey);
      if (dist < 0.001) { best = best || e; continue; }
      const d = dist - (e.r || 0);
      if (d > reach) continue;
      const dot = (ex * ux + ey * uy) / dist;
      if (dot < cosHalf) continue;             // 不在扇形内
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  /**
   * 该技能此刻是否「值得放」。
   * ★ 判定只看「有没有可命中的目标」，不预判伤害收益 —— 收益最大化属于玩家构筑决策，
   *   自动化的职责是「不要在空地上乱放技能」。
   */
  function shouldCast(sid, p, enemies) {
    const sp = SPEC[sid];
    if (!sp) return false;
    switch (sp.mode) {
      case 'land':
        return !!nearest(p, enemies, sp.reach);
      case 'self': {
        // 技能半径随增益卡变化 → 动态取（ctx.skillRadius 缺省则用表里的基准值）
        let r = sp.reach;
        try { const k = ctx?.skillRadius?.(sid); if (Number.isFinite(k) && k > 0) r = Math.max(r, k); } catch (e) { /* 用默认值 */ }
        return !!nearest(p, enemies, r);
      }
      case 'ahead':
        return !!ahead(p, enemies, sp.reach, sp.half || 0.8);
      case 'any':
        return !!nearest(p, enemies, sp.reach);
      case 'buff':
        return !!nearest(p, enemies, sp.reach);
      default:
        return false;
    }
  }

  // ============================================================
  // 主循环
  // ============================================================
  function update(dt) {
    CALLS.update++;
    if (!state.on) return;
    if (!ctx) return;
    const g = ctx.game;
    if (!g || !g.player) return;
    // ★ 塔防模式不参与：TD 有自己的 AI 施法决策器（td.js），两套同时跑会双重施法。
    if (g.gameMode === 'td') return;
    // 倒地观战 / 非战斗态 → 不施放（注意：不能靠 castActive 里的 toast 兜底，
    //   否则每帧弹「你已倒下」提示）
    if (g.player.downed) return;
    if (g.mode && g.mode !== 'playing') return;
    // 节流：避免 4 个技能同帧齐发
    const now = g.elapsed || 0;
    if (now - state.lastCastAt < MIN_GAP) return;
    const enemies = g.enemies || [];
    if (!enemies.length) return;

    let slots = [];
    try { slots = ctx.slots() || []; } catch (e) { return; }
    for (const slot of slots) {
      if (!slot) continue;
      const p = g.player;
      const sid = p[slot.skill];
      if (!sid) continue;
      const cd = p[slot.cd];
      // ★ 冷却值非有限数（NaN / Infinity）→ **不自动施放**。
      //   NaN 会让 castActive 的「cd > 0」判定失效 → 技能连发（见 e2e-cd-bug）。
      //   自动施法绝不能成为 NaN 污染的放大器。
      if (!Number.isFinite(cd)) continue;
      if (cd > 0) continue;
      if (!shouldCast(sid, p, enemies)) { CALLS.skip++; continue; }
      try {
        ctx.cast(slot.n);
      } catch (e) {
        // 施放异常（不该发生）→ 停下本帧，等下一次 update 再试
        return;
      }
      state.lastCastAt = now;
      state.castCount++;
      CALLS.cast++;
      return; // 每帧最多放一个
    }
  }

  // ============================================================
  // 对外
  // ============================================================
  function attach(c) {
    ctx = c;
    CALLS.attach++;
    load();
    return ctx;
  }

  return {
    attach, update, toggle, setOn, state, CALLS, SPEC,
    // 导出判定函数供 e2e 直接验证（不依赖真实战斗流程）
    shouldCast, nearest, ahead,
  };
})();
