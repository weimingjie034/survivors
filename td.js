/* ============================================================================
 * td.js —— 《艾泽拉斯幸存者》塔防模式（gameMode = 'td'）
 *
 * 设计原则（与主设计案一致）：
 *   ① 本文件只放「数据 + 纯逻辑」，不放任何依赖 game.js 内部状态（game/mode/p）的代码。
 *      运行时状态由 game.js 的 TD 运行时持有，调用方通过 ctx 参数传入。
 *   ② 几何必须数据驱动 —— 地图坐标来自 tools/td/td-map-v6.mjs 的反解结果
 *      （用户手绘左下象限的像素级保真重建，IoU 98.19%），AI 只提供美术材质。
 *   ③ 数值必须同源 —— 波次表与配平表由 tools/td/td-waves.mjs / td-balance.mjs 生成，
 *      不要在本文件手写第二份公式。
 *
 * 单位：地图坐标一律为「码」（= 2 lu）。lu 是设计稿的逻辑单位。
 * ========================================================================== */
(function (global) {
  'use strict';

  // ==========================================================================
  // 1. 地图数据（tools/td/td-map-v6.mjs 导出 · 已通过四项自校验）
  //    - 四路等长（各 3444 码）
  //    - 圈不压路、圈不重叠
  //    - 起点在刷怪区、终点在心脏内
  //    - 传送网络 20/20 全连通
  // ==========================================================================
  const MAP = {
    W: 3072, H: 1918,            // 世界尺寸（码）
    heart: { x: 1536, y: 960, r: 64 },
    // 道路半宽（码）。手绘走廊 46~64 lu → 中位 54 lu → 108 码宽 → 半宽 54
    roadHalf: 54,
    // 阵位覆盖半径（码）。20 圈到最近路径 104~132 码 → 400 码让「站上去就能打到一整段路」。
    //   ★ 由 tools/td/td-sim.mjs（真实几何 + 离散战斗模型）定标：320 码时单个阵位只盖住本路 ~25%，
    //     1 人局 30 波三职业普遍漏怪 40~64 只（容差只有 15）；400 码时
    //     1 人局法师 4 / 战士 4 / 猎人 12，联机局也才有压力。
    reach: 400,
    // 传送冷却（秒）
    tpCd: 5,
    lanes: [
      { id: 'LL', length: 3444, pts: [[180, 1788], [180, 1236], [766, 1236], [766, 1866], [1536, 1866], [1536, 960]] },
      { id: 'LR', length: 3444, pts: [[2892, 1788], [2892, 1236], [2306, 1236], [2306, 1866], [1536, 1866], [1536, 960]] },
      { id: 'UL', length: 3444, pts: [[180, 130], [180, 682], [766, 682], [766, 52], [1536, 52], [1536, 958]] },
      { id: 'UR', length: 3444, pts: [[2892, 130], [2892, 682], [2306, 682], [2306, 52], [1536, 52], [1536, 958]] }
    ],
    nodes: [
      { id: 'LL-3', seq: 1, x: 294, y: 1348, quad: 'LL', links: ['UL-3', 'LL-5', 'LL-2'] },
      { id: 'LL-2', seq: 2, x: 624, y: 1340, quad: 'LL', links: ['UL-2', 'LL-5', 'LL-3', 'LL-1'] },
      { id: 'LL-5', seq: 3, x: 910, y: 1738, quad: 'LL', links: ['LL-2', 'LL-3', 'LL-4'] },
      { id: 'LL-4', seq: 4, x: 1396, y: 1734, quad: 'LL', links: ['LL-1', 'LL-5', 'LR-4'] },
      { id: 'LL-1', seq: 5, x: 1408, y: 1168, quad: 'LL', links: ['UL-1', 'LL-4', 'LL-2', 'LR-1'] },
      { id: 'LR-3', seq: 1, x: 2778, y: 1348, quad: 'LR', links: ['UR-3', 'LR-5', 'LR-2'] },
      { id: 'LR-2', seq: 2, x: 2448, y: 1340, quad: 'LR', links: ['UR-2', 'LR-5', 'LR-1', 'LR-3'] },
      { id: 'LR-5', seq: 3, x: 2162, y: 1738, quad: 'LR', links: ['LR-2', 'LR-4', 'LR-3'] },
      { id: 'LR-4', seq: 4, x: 1676, y: 1734, quad: 'LR', links: ['LR-1', 'LL-4', 'LR-5'] },
      { id: 'LR-1', seq: 5, x: 1664, y: 1168, quad: 'LR', links: ['UR-1', 'LR-4', 'LL-1', 'LR-2'] },
      { id: 'UL-3', seq: 1, x: 294, y: 570, quad: 'UL', links: ['UL-5', 'LL-3', 'UL-2'] },
      { id: 'UL-2', seq: 2, x: 624, y: 578, quad: 'UL', links: ['UL-5', 'LL-2', 'UL-3', 'UL-1'] },
      { id: 'UL-5', seq: 3, x: 910, y: 180, quad: 'UL', links: ['UL-2', 'UL-3', 'UL-4'] },
      { id: 'UL-4', seq: 4, x: 1396, y: 184, quad: 'UL', links: ['UL-1', 'UL-5', 'UR-4'] },
      { id: 'UL-1', seq: 5, x: 1408, y: 750, quad: 'UL', links: ['UL-4', 'LL-1', 'UL-2', 'UR-1'] },
      { id: 'UR-3', seq: 1, x: 2778, y: 570, quad: 'UR', links: ['UR-5', 'LR-3', 'UR-2'] },
      { id: 'UR-2', seq: 2, x: 2448, y: 578, quad: 'UR', links: ['UR-5', 'LR-2', 'UR-1', 'UR-3'] },
      { id: 'UR-5', seq: 3, x: 2162, y: 180, quad: 'UR', links: ['UR-2', 'UR-4', 'UR-3'] },
      { id: 'UR-4', seq: 4, x: 1676, y: 184, quad: 'UR', links: ['UR-1', 'UL-4', 'UR-5'] },
      { id: 'UR-1', seq: 5, x: 1664, y: 750, quad: 'UR', links: ['UR-4', 'LR-1', 'UL-1', 'UR-2'] }
    ]
  };

  // 节点索引（按 id）
  const NODE_BY_ID = new Map(MAP.nodes.map(n => [n.id, n]));
  const LANE_BY_ID = new Map(MAP.lanes.map(l => [l.id, l]));

  // 象限归属：LL/LR 在下方，UL/UR 在上方
  const QUAD_UPPER = { LL: false, LR: false, UL: true, UR: true };

  // ==========================================================================
  // 2. 几何工具（纯函数，可独立测试）
  // ==========================================================================

  /**
   * 规范化折线点：兼容 [x, y] 数组与 { x, y } 对象两种写法。
   * ★ MAP.lanes 的 pts 用数组（便于直接嵌进 game.js 数据表），
   *   而内部几何运算统一用对象，避免各处重复解包。
   */
  function normPts(pts) {
    return pts.map(p => (Array.isArray(p) ? { x: p[0], y: p[1] } : p));
  }

  /** 折线总弧长 */
  function pathLength(pts) {
    const q = normPts(pts);
    let s = 0;
    for (let i = 0; i < q.length - 1; i++) {
      const a = q[i], b = q[i + 1];
      s += Math.hypot(b.x - a.x, b.y - a.y);
    }
    return s;
  }

  /** 把折线转成「累积弧长 → 点」的查表结构 */
  function buildArc(pts) {
    const q = normPts(pts);
    const segs = [];
    let acc = 0;
    for (let i = 0; i < q.length - 1; i++) {
      const a = q[i], b = q[i + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      segs.push({ a, b, len, start: acc });
      acc += len;
    }
    return { segs, total: acc };
  }

  /**
   * 按弧长取路径上的点（t ∈ [0,1]，0 = 出生点，1 = 心脏）。
   * ★ 注意：t 是「归一化弧长参数」，不是像素步长。
   */
  function samplePath(arc, t) {
    const segs = arc.segs;
    if (!segs.length) return { x: 0, y: 0, dirX: 1, dirY: 0 };
    const target = Math.max(0, Math.min(1, t)) * arc.total;
    let seg = segs[segs.length - 1];
    for (let i = 0; i < segs.length; i++) {
      if (target <= segs[i].start + segs[i].len) { seg = segs[i]; break; }
    }
    const u = seg.len > 0 ? (target - seg.start) / seg.len : 0;
    const x = seg.a.x + (seg.b.x - seg.a.x) * u;
    const y = seg.a.y + (seg.b.y - seg.a.y) * u;
    const d = seg.len > 0 ? Math.hypot(seg.b.x - seg.a.x, seg.b.y - seg.a.y) : 1;
    return { x, y, dirX: (seg.b.x - seg.a.x) / d, dirY: (seg.b.y - seg.a.y) / d };
  }

  /** 点到折线的最短距离 */
  function distToPath(arc, x, y) {
    let best = Infinity;
    for (const seg of arc.segs) {
      const vx = seg.b.x - seg.a.x, vy = seg.b.y - seg.a.y;
      const L2 = vx * vx + vy * vy;
      let u = L2 > 0 ? ((x - seg.a.x) * vx + (y - seg.a.y) * vy) / L2 : 0;
      u = Math.max(0, Math.min(1, u));
      const px = seg.a.x + vx * u, py = seg.a.y + vy * u;
      const d = Math.hypot(x - px, y - py);
      if (d < best) best = d;
    }
    return best;
  }

  /**
   * 点到折线的最近点 → { x, y, t, dist }
   * t = 归一化弧长位置（用于判断「怪的进度」与「阵位覆盖到哪一段」）
   */
  function nearestOnPath(arc, x, y) {
    let best = null;
    for (const seg of arc.segs) {
      const vx = seg.b.x - seg.a.x, vy = seg.b.y - seg.a.y;
      const L2 = vx * vx + vy * vy;
      let u = L2 > 0 ? ((x - seg.a.x) * vx + (y - seg.a.y) * vy) / L2 : 0;
      u = Math.max(0, Math.min(1, u));
      const px = seg.a.x + vx * u, py = seg.a.y + vy * u;
      const d = Math.hypot(x - px, y - py);
      if (!best || d < best.dist) {
        const s = seg.start + u * seg.len;
        best = { x: px, y: py, dist: d, t: arc.total > 0 ? s / arc.total : 0 };
      }
    }
    return best;
  }

  // 各路的弧长查表（构建一次，全局复用）
  const ARCS = new Map();
  for (const l of MAP.lanes) ARCS.set(l.id, buildArc(l.pts));

  /** 某条路在弧长位置 t 的坐标 */
  function lanePoint(laneId, t) {
    const arc = ARCS.get(laneId);
    return arc ? samplePath(arc, t) : { x: 0, y: 0, dirX: 1, dirY: 0 };
  }

  /** 某条路的总弧长（码） */
  function laneLength(laneId) {
    const arc = ARCS.get(laneId);
    return arc ? arc.total : 0;
  }

  /**
   * 阵位覆盖判定：阵位 radius 半径内是否有该路的怪
   * 返回覆盖到的进度区间（用于 HUD 覆盖条）
   */
  function padCoverage(node, laneId, reach) {
    const arc = ARCS.get(laneId);
    if (!arc) return null;
    let lo = null, hi = null;
    const steps = 64;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const p = samplePath(arc, t);
      if (Math.hypot(p.x - node.x, p.y - node.y) <= reach) {
        if (lo === null) lo = t;
        hi = t;
      }
    }
    return lo === null ? null : { lo, hi };
  }

  // ==========================================================================
  // 3. 波次表（tools/td/td-waves.mjs 生成 —— 不要手写第二份）
  //    count = 每路怪量；lanes = 本波同时出怪的路数
  // ==========================================================================
  const WAVES = {
    total: 30,
    // 每波时长（秒）。无整备期，战斗连续推进。
    // ★ 2026-11-04：改为**逐波递增**（14s → 37s），存在每一行的 `seconds` 字段里。
    //   怪量必须与波次时长同比例增长 —— 英雄的清怪吞吐量有硬上限
    //   （每次普攻最多命中 1+穿透 只 → 猎人 ≈ 4.2 只/秒），出怪速率一旦超过它，
    //   覆盖段就会堵死、漏怪暴涨（见 tools/td/td-sim.mjs 实测记录）。
    //   waveSeconds 保留为「兜底值」（旧数据/异常时用）。
    waveSeconds: 28,
    rows: [
      { w:1, count:25, hp:3, bossHp:21, seconds:14, speed:104, lanes:1, xp:1.2, lv:3, tags:['普通'] },
      { w:2, count:26, hp:3, bossHp:23, seconds:15, speed:105, lanes:1, xp:1.32, lv:4, tags:['普通'] },
      { w:3, count:27, hp:4, bossHp:25, seconds:15.5, speed:106, lanes:1, xp:1.44, lv:5, tags:['普通'] },
      { w:4, count:29, hp:5, bossHp:27, seconds:16.5, speed:107, lanes:1, xp:1.56, lv:5, tags:['普通'] },
      { w:5, count:30, hp:6, bossHp:30, seconds:17, speed:108, lanes:2, xp:1.68, lv:6, tags:['普通'] },
      { w:6, count:32, hp:7, bossHp:33, seconds:18, speed:109, lanes:2, xp:1.8, lv:7, tags:['普通'] },
      { w:7, count:33, hp:9, bossHp:35, seconds:19, speed:110, lanes:2, xp:1.92, lv:7, tags:['普通','快速'] },
      { w:8, count:34, hp:11, bossHp:38, seconds:19.5, speed:111, lanes:2, xp:2.04, lv:8, tags:['普通','快速'] },
      { w:9, count:36, hp:13, bossHp:41, seconds:20.5, speed:112, lanes:2, xp:2.16, lv:8, tags:['普通','快速'] },
      { w:10, count:37, hp:15, bossHp:45, seconds:21, speed:113, lanes:3, xp:2.28, lv:9, tags:['普通','快速','BOSS#1'] },
      { w:11, count:39, hp:18, bossHp:48, seconds:22, speed:114, lanes:3, xp:2.39, lv:10, tags:['普通','快速','装甲'] },
      { w:12, count:40, hp:20, bossHp:52, seconds:23, speed:115, lanes:3, xp:2.51, lv:10, tags:['普通','快速','装甲'] },
      { w:13, count:41, hp:23, bossHp:56, seconds:23.5, speed:116, lanes:3, xp:2.63, lv:11, tags:['普通','快速','装甲','飞行'] },
      { w:14, count:43, hp:26, bossHp:60, seconds:24.5, speed:118, lanes:3, xp:2.75, lv:11, tags:['普通','快速','装甲','飞行'] },
      { w:15, count:44, hp:30, bossHp:64, seconds:25, speed:119, lanes:3, xp:2.87, lv:12, tags:['普通','快速','装甲','飞行'] },
      { w:16, count:46, hp:33, bossHp:68, seconds:26, speed:120, lanes:4, xp:2.99, lv:13, tags:['普通','快速','装甲','飞行','施法'] },
      { w:17, count:47, hp:37, bossHp:73, seconds:27, speed:121, lanes:4, xp:3.11, lv:13, tags:['普通','快速','装甲','飞行','施法'] },
      { w:18, count:48, hp:41, bossHp:77, seconds:27.5, speed:122, lanes:4, xp:3.23, lv:14, tags:['普通','快速','装甲','飞行','施法'] },
      { w:19, count:50, hp:45, bossHp:82, seconds:28.5, speed:123, lanes:4, xp:3.35, lv:14, tags:['普通','快速','装甲','飞行','施法','治疗'] },
      { w:20, count:51, hp:50, bossHp:87, seconds:29, speed:124, lanes:4, xp:3.47, lv:15, tags:['普通','快速','装甲','飞行','施法','治疗','BOSS#2'] },
      { w:21, count:53, hp:54, bossHp:92, seconds:30, speed:125, lanes:4, xp:3.59, lv:16, tags:['普通','快速','装甲','飞行','施法','治疗','分裂'] },
      { w:22, count:54, hp:59, bossHp:98, seconds:31, speed:126, lanes:4, xp:3.71, lv:16, tags:['普通','快速','装甲','飞行','施法','治疗','分裂'] },
      { w:23, count:55, hp:65, bossHp:103, seconds:31.5, speed:127, lanes:4, xp:3.83, lv:17, tags:['普通','快速','装甲','飞行','施法','治疗','分裂'] },
      { w:24, count:57, hp:70, bossHp:109, seconds:32.5, speed:128, lanes:4, xp:3.94, lv:17, tags:['普通','快速','装甲','飞行','施法','治疗','分裂'] },
      { w:25, count:58, hp:75, bossHp:115, seconds:33, speed:129, lanes:4, xp:4.06, lv:18, tags:['普通','快速','装甲','飞行','施法','治疗','分裂','精英波'] },
      { w:26, count:60, hp:81, bossHp:121, seconds:34, speed:130, lanes:4, xp:4.18, lv:19, tags:['普通','快速','装甲','飞行','施法','治疗','分裂'] },
      { w:27, count:61, hp:87, bossHp:127, seconds:35, speed:131, lanes:4, xp:4.3, lv:19, tags:['普通','快速','装甲','飞行','施法','治疗','分裂'] },
      { w:28, count:62, hp:93, bossHp:133, seconds:35.5, speed:132, lanes:4, xp:4.42, lv:20, tags:['普通','快速','装甲','飞行','施法','治疗','分裂'] },
      { w:29, count:64, hp:100, bossHp:140, seconds:36.5, speed:133, lanes:4, xp:4.54, lv:20, tags:['普通','快速','装甲','飞行','施法','治疗','分裂'] },
      { w:30, count:65, hp:107, bossHp:146, seconds:37, speed:134, lanes:4, xp:4.66, lv:21, tags:['普通','快速','装甲','飞行','施法','治疗','分裂','BOSS#3'] },
    ],




    // 经验曲线（塔防专用）：xpNeed(lv) = 6.12 × lv^1.45
    xpNeed: lv => Math.floor(6.12 * Math.pow(lv, 1.45)),
    // 波次里的怪类型标记（供小怪外观与特性使用）
    feature: (w, tag) => WAVES.rows[w - 1].tags.includes(tag)
  };

  // ==========================================================================
  // 4. 多人配平（tools/td/td-balance.mjs 生成 —— 不要手写第二份）
  //    核心恒等式：
  //      每人整局经验 恒定 8675  → 最终 Lv28 → 27 张强化卡（全模式一致）
  //      每人每波需清总血量 恒定 19667
  // ==========================================================================
  const BALANCE = {
    // 各人数局：每人负责的路（1 人局只激活下方两条 —— 用户拍板）
    laneOwners: {
      1: { LL: 0, LR: 0 },
      2: { LL: 0, LR: 0, UL: 1, UR: 1 },
      3: { LL: 0, LR: 0, UL: 1, UR: 2 },
      4: { LL: 0, LR: 1, UL: 2, UR: 3 }
    },
    // 首领血量倍率（★ 塔防专属口径，与副本团本不同）
    //   副本里首领在场地中央，全队一起打 → 人越多血越厚（1 + 0.8×(P-1)）。
    //   塔防里首领只走**一条路**，只有覆盖到那一段的 1~2 人能打到它 →
    //   血量不能随总人数线性膨胀，否则四人局的首领变成血墙。
    //   实测（tools/td/td-sim.mjs）：首领不吃 laneHpMult（本路怪密度系数），
    //   人数只给很轻的成长（1 / 1.1 / 1.2 / 1.3）。
    bossHpMult: players => 1 + .1 * (Math.max(1, players || 1) - 1),
    // 人多时的每路血量系数：
    //   1~2 人局时每个玩家要守 2 路（一个英雄覆盖两条路，覆盖吃紧）；
    //   3~4 人局时每人守 1 路（覆盖宽裕）→ 若不按人数加血，联机局实测 **0 漏怪**（毫无压力）。
    //   实测（tools/td/td-sim.mjs，3 种子平均）：1 人 4/4/12、2 人 4/4/10、3 人 0/3/17、4 人 0/11/21。
    playerHpFactor: { 1: 1, 2: 1, 3: 1.5, 4: 1.75 },
    // 单路怪量倍率：每人守 1 路时该路怪量 ×2（守路数少 → 单位时间压力翻倍）
    laneHpMult: (players, laneId) => {
      const own = BALANCE.laneOwners[players] || BALANCE.laneOwners[1];
      const owner = own[laneId];
      if (owner == null) return 0;                    // 该路不激活
      let count = 0;
      for (const k in own) if (own[k] === owner) count++;
      const base = count === 1 ? 2 : 1;               // 守 1 路 → ×2；守 2 路 → ×1
      return base * (BALANCE.playerHpFactor[players] ?? 1);
    },
    // 漏怪容差：四人共享 30 只，按激活路数缩放（1 人 2 路 → 15）
    leakLimit: players => {
      const own = BALANCE.laneOwners[players] || BALANCE.laneOwners[1];
      const active = Object.keys(own).length;
      return Math.round(30 * active / 4);
    },
    // 玩家金币（局末折算用）
    goldPerKill: 1,
    goldPerWave: 10
  };

  // ==========================================================================
  // 5. 战术指令（玩家用卡牌给自动施法决策器编程 —— 塔防版的「操作」）
  // ==========================================================================
  const COMMANDS = {
    focus: { id: 'focus', name: '集火', pick: 'furthest', desc: '优先攻击最靠近心脏的怪' },
    sweep: { id: 'sweep', name: '清场', pick: 'densest', desc: '优先攻击覆盖范围内最密集处' },
    exec: { id: 'exec', name: '斩首', pick: 'lowest_hp', desc: '优先攻击残血目标' },
    guard: { id: 'guard', name: '守序', pick: 'own', desc: '只打自己覆盖段，不抢队友的怪' }
  };
  const COMMAND_ORDER = ['focus', 'sweep', 'exec', 'guard'];

  /**
   * 目标选取（依指令）
   * @param enemies  覆盖范围内的敌人数组
   * @param cmd      指令 id
   * @param laneT    各怪的进度（Map: enemy → 归一化进度，越大越靠近心脏）
   */
  function pickTarget(enemies, cmd, laneT, fallback) {
    if (!enemies.length) return null;
    const rule = COMMANDS[cmd] || COMMANDS.focus;
    const mode = rule.pick;
    if (mode === 'own') {
      // 守序：取最靠近心脏但仍在自己覆盖段内的怪（由调用方预先过滤）
      let best = null, bt = -1;
      for (const e of enemies) { const t = laneT.get(e) || 0; if (t > bt) { bt = t; best = e; } }
      return best || enemies[0];
    }
    if (mode === 'lowest_hp') {
      let best = enemies[0];
      for (const e of enemies) if (e.hp / (e.maxHp || 1) < best.hp / (best.maxHp || 1)) best = e;
      return best;
    }
    if (mode === 'densest') {
      // 密集度：在候选中选「周围同类最密」的（用相邻怪数量近似）
      let best = enemies[0], bd = -1;
      for (const e of enemies) {
        let d = 0;
        for (const o of enemies) if (o !== e && Math.hypot(o.x - e.x, o.y - e.y) < 120) d++;
        if (d > bd) { bd = d; best = e; }
      }
      return best;
    }
    // furthest：最靠近心脏（进度最大）
    let best = enemies[0], bt = -1;
    for (const e of enemies) { const t = laneT.get(e) || 0; if (t > bt) { bt = t; best = e; } }
    return best;
  }

  // ==========================================================================
  // 6. 自动施法规则表
  //    need: 释放条件枚举
  //      'any'      覆盖范围内有怪
  //      'dense'    覆盖范围内有 ≥N 只怪（AOE 专用，避免单目标浪费）
  //      'never'    塔防下无效（仅作用于自身）
  //    prio: 优先级，大者先放。AOE > 控制 > 输出。
  // ==========================================================================

  /**
   * ★ 塔防模式为三职业各指定一个「默认主动技」。
   *   为什么必须单独指定：
   *     ① 普通模式里主动技来自装备（默认存档 equipped.*.active 全是 null），
   *        而塔防**不产装备** → 玩家永远拿不到主动技；
   *     ② 塔防的核心玩法是「自动施法」，没有主动技就等于没有技能。
   *   选型原则：覆盖型 / 群伤型，天然适配「站在阵位上覆盖一段路径」。
   *     法师 烈焰风暴 → 落点在最近的怪身上，AoE 持续灼烧
   *     战士 剑刃风暴 → 环身 AoE，绕自身旋转（塔防下半径 = 覆盖半径）
   *     猎人 多重射击 → 穿透箭，串一条直线上的怪
   *   注：猎人的「兽王」是跟随宠物（塔防下英雄不能移动 → 宠物无处可跟），
   *     改由 TD_UPGRADE_POOL 的「召唤守卫」卡承担同一职能。
   */
  const TD_DEFAULT_ACTIVE = { mage: 'flamestrike', warrior: 'blade_storm', hunter: 'multi_shot' };

  // ★ 本表必须覆盖 game.js 里**全部 20 个 kind:'active' 主动技**（tools/td/selftest.mjs 会断言）。
  //   漏一条 = 该技能在塔防下永远不会被自动施放（曾经漏 flamestrike 导致法师整局不放技能）。
  //   need: 'any'   覆盖范围内有怪就放
  //        'dense' 覆盖范围内有 ≥min 只怪才放（AOE 专用，避免单目标浪费）
  //        'never' 塔防下无效（仅作用于自身 / 位移 / 跟随宠物）
  const AUTO_CAST = {
    // ---- 法师 mage（8 个主动技）----
    frost_orb: { need: 'any', pick: 'cmd', prio: 3 },
    blizzard: { need: 'dense', min: 3, pick: 'cmd', prio: 5 },
    flamestrike: { need: 'any', pick: 'cmd', prio: 5 },
    arcane_nova: { need: 'any', pick: 'cmd', prio: 6 },
    arcane_blast: { need: 'any', pick: 'cmd', prio: 4 },
    ice_barrier: { need: 'never', prio: 0 },           // 自身护盾
    icy_veins: { need: 'never', prio: 0 },             // 自身血脉（爆发也在阵位中心 → 打不到路）
    mirror_image: { need: 'never', prio: 0 },          // 自身分身
    // ---- 战士 warrior（8 个主动技）----
    blade_storm: { need: 'any', pick: 'cmd', prio: 6 },
    war_stomp: { need: 'any', pick: 'cmd', prio: 5 },
    shockwave: { need: 'any', pick: 'cmd', prio: 5 },
    mortal_strike: { need: 'any', pick: 'cmd', prio: 4 },
    demoralizing_shout: { need: 'any', pick: 'cmd', prio: 3 },
    shield_wall: { need: 'never', prio: 0 },           // 自身无敌
    berserker_rage: { need: 'never', prio: 0 },        // 自身狂暴
    charge: { need: 'never', prio: 0 },                // 位移
    // ---- 猎人 hunter（6 个主动技）----
    multi_shot: { need: 'any', pick: 'cmd', prio: 4 },
    explosive_trap: { need: 'any', pick: 'cmd', prio: 3 },
    freezing_trap: { need: 'any', pick: 'cmd', prio: 5 },
    kill_command: { need: 'any', pick: 'cmd', prio: 6 },
    rapid_fire: { need: 'never', prio: 0 },            // 自身攻速
    call_pet: { need: 'never', prio: 0 },              // 跟随宠物（塔防改由「召唤守卫」卡承担）
    // ---- 普攻类（塔防由覆盖判定自动打，不进自动施法池）----
    arcane_missiles: { need: 'never', prio: 0 },
    whirlwind: { need: 'never', prio: 0 },
    double_shot: { need: 'never', prio: 0 }
  };

  /** 该技能在塔防下是否可自动释放 */
  function autoCastEnabled(skillId) {
    const r = AUTO_CAST[skillId];
    return !!(r && r.need !== 'never');
  }

  // ==========================================================================
  // 7. TD 专属卡池（36 张）
  //    ★ 通用卡在塔防下「全部改写、一张不剔」（见 TD_GENERIC_OVERRIDE）
  //    apply(p, ctx)：p = 玩家对象，ctx = { td, game }
  //      td = TD 运行时状态（守卫、指令、覆盖半径等）
  // ==========================================================================
  const TD_UPGRADE_POOL = [
    // ===== A 类 · 站位与覆盖 =====
    { id: 'td_wide_field', icon: '◉', name: '广域感应', type: '站位强化', rar: 0, tags: ['覆盖'],
      desc: '阵位覆盖半径 +20%',
      apply: (p, ctx) => { ctx.td.reachMul *= 1.2; } },
    { id: 'td_cross_fire', icon: '✜', name: '交叉火力', type: '站位强化', rar: 1, tags: ['覆盖'],
      desc: '覆盖范围额外包含相邻象限的路径（+60 码）',
      apply: (p, ctx) => { ctx.td.crossReach += 60; } },
    { id: 'td_far_sight', icon: '◎', name: '远眺', type: '站位强化', rar: 0, tags: ['覆盖'],
      desc: '覆盖半径 +12%，但所有技能伤害 -8%',
      apply: (p, ctx) => { ctx.td.reachMul *= 1.12; p.damage *= .92; } },
    { id: 'td_near_guard', icon: '◈', name: '贴身守望', type: '站位强化', rar: 1, tags: ['覆盖'],
      desc: '覆盖半径 -10%，但伤害 +18%',
      apply: (p, ctx) => { ctx.td.reachMul *= .9; p.damage *= 1.18; } },
    { id: 'td_twin_node', icon: '◍', name: '双生阵位', type: '站位强化', rar: 2, tags: ['覆盖', '召唤'],
      desc: '在相邻阵位召唤一个镜像守卫（属性 60%）',
      apply: (p, ctx) => { ctx.td.requestGuard(p, 'twin'); } },
    { id: 'td_root', icon: '⚓', name: '扎根', type: '站位强化', rar: 0, tags: ['覆盖'],
      desc: '传送冷却 -30%，但换阵位后 2 秒内无法施法',
      apply: (p, ctx) => { ctx.td.tpCdMax *= .7; ctx.td.rootLock = 2; } },

    // ===== B 类 · 火力输出 =====
    { id: 'td_power', icon: '✦', name: '奥能灌注', type: '火力强化', rar: 0, tags: ['输出'],
      desc: '技能伤害 +15%',
      apply: p => { p.damage *= 1.15; } },
    { id: 'td_pierce', icon: '↟', name: '破甲符文', type: '火力强化', rar: 1, tags: ['输出'],
      desc: '无视目标 30% 护甲',
      apply: (p, ctx) => { ctx.td.armorPierce = Math.max(ctx.td.armorPierce, .3); } },
    { id: 'td_burn', icon: '🔥', name: '灼烧印记', type: '火力强化', rar: 1, tags: ['输出', '燃烧'],
      desc: '技能命中附加 4 秒燃烧（每秒 40% 伤害）',
      apply: (p, ctx) => { ctx.td.burnOnHit = .4; } },
    { id: 'td_chain', icon: '⚡', name: '雷链传导', type: '火力强化', rar: 1, tags: ['输出'],
      desc: '击杀时对 120 码内最多 2 只怪造成 50% 伤害',
      apply: (p, ctx) => { ctx.td.chainKill += .5; } },
    { id: 'td_burst', icon: '✸', name: '临界爆发', type: '火力强化', rar: 2, tags: ['输出'],
      desc: '同一目标连续命中 3 次后，下一击翻倍',
      apply: (p, ctx) => { ctx.td.burstStack += 1; } },
    { id: 'td_execute', icon: '☠', name: '斩杀线', type: '火力强化', rar: 1, tags: ['输出'],
      desc: '对低于 15% 血量的目标伤害翻倍',
      apply: (p, ctx) => { ctx.td.executeTh = .15; } },

    // ===== C 类 · 召唤守卫（解决「只能控制一个英雄」）=====
    { id: 'td_turret', icon: '⌖', name: '魔能炮台', type: '召唤强化', rar: 1, tags: ['召唤'],
      desc: '在当前阵位召唤 1 座自动炮台',
      apply: (p, ctx) => { ctx.td.requestGuard(p, 'turret'); } },
    { id: 'td_totem', icon: '⌂', name: '守护图腾', type: '召唤强化', rar: 1, tags: ['召唤'],
      desc: '召唤图腾：范围内（含队友阵位）伤害 +12%',
      apply: (p, ctx) => { ctx.td.requestGuard(p, 'totem'); } },
    { id: 'td_wolf_pack', icon: '🐺', name: '兽群', type: '召唤强化', rar: 2, tags: ['召唤'],
      desc: '召唤 2 只自动攻击的幽灵狼（沿路追击）',
      apply: (p, ctx) => { ctx.td.requestGuard(p, 'wolf', 2); } },
    { id: 'td_thorn', icon: '✻', name: '荆棘守卫', type: '召唤强化', rar: 1, tags: ['召唤'],
      desc: '召唤守卫；守卫每 5 秒反弹一次伤害',
      apply: (p, ctx) => { ctx.td.requestGuard(p, 'thorn'); } },
    { id: 'td_mine', icon: '◈', name: '地雷', type: '召唤强化', rar: 1, tags: ['召唤'],
      desc: '在你覆盖的路段布 3 枚地雷（每 20 秒补充 1 枚，上限 6）',
      apply: (p, ctx) => { ctx.td.requestGuard(p, 'mine'); } },
    { id: 'td_sentry', icon: '⚑', name: '哨戒守卫', type: '召唤强化', rar: 2, tags: ['召唤', '指令'],
      desc: '召唤守卫，优先攻击最靠近心脏的怪',
      apply: (p, ctx) => { ctx.td.requestGuard(p, 'sentry'); } },

    // ===== D 类 · 战术指令（把「不能操作」变成「可构筑」）=====
    { id: 'td_cmd_focus', icon: '◎', name: '战术指令·集火', type: '指令强化', rar: 1, tags: ['指令'],
      desc: '主指令：优先攻击最靠近心脏的怪',
      apply: (p, ctx) => { ctx.td.setCommand('focus'); } },
    { id: 'td_cmd_clear', icon: '✳', name: '战术指令·清场', type: '指令强化', rar: 1, tags: ['指令'],
      desc: '主指令：优先攻击覆盖范围内最密集处',
      apply: (p, ctx) => { ctx.td.setCommand('sweep'); } },
    { id: 'td_cmd_exec', icon: '☠', name: '战术指令·斩首', type: '指令强化', rar: 1, tags: ['指令'],
      desc: '主指令：优先攻击残血目标',
      apply: (p, ctx) => { ctx.td.setCommand('exec'); } },
    { id: 'td_cmd_hold', icon: '◈', name: '战术指令·守序', type: '指令强化', rar: 0, tags: ['指令'],
      desc: '主指令：只攻击自己覆盖段，不抢队友的怪',
      apply: (p, ctx) => { ctx.td.setCommand('guard'); } },
    { id: 'td_cmd_dual', icon: '⧉', name: '双指令', type: '指令强化', rar: 2, tags: ['指令'],
      desc: '可同时装备 2 条主指令',
      apply: (p, ctx) => { ctx.td.dualCmd = true; } },
    { id: 'td_cmd_focus2', icon: '◉', name: '集火强化', type: '指令强化', rar: 2, tags: ['指令', '燃烧'],
      desc: '集火指令升级：目标判定改为覆盖段内最后 40% 的怪',
      apply: (p, ctx) => { ctx.td.focusDeep = true; } },

    // ===== E 类 · 节奏与资源 =====
    { id: 'td_haste', icon: '⌁', name: '急速咏唱', type: '节奏强化', rar: 0, tags: ['节奏'],
      desc: '技能冷却 -20%',
      apply: (p, ctx) => { ctx.td.cdScale *= .8; } },
    { id: 'td_threshold', icon: '◑', name: '触发阈值', type: '节奏强化', rar: 1, tags: ['节奏'],
      desc: '自动施放阈值降低 25%（更早开火）',
      apply: (p, ctx) => { ctx.td.threshold *= .75; } },
    { id: 'td_double_cast', icon: '✜', name: '双重施法', type: '节奏强化', rar: 2, tags: ['节奏'],
      desc: 'AOE 技能有 35% 概率在 0.6 秒后再放一次',
      apply: (p, ctx) => { ctx.td.doubleCast = .35; } },
    { id: 'td_xp', icon: '✧', name: '战术经验', type: '节奏强化', rar: 0, tags: ['节奏'],
      desc: '击杀经验 +25%（升级更快）',
      apply: (p, ctx) => { ctx.td.xpBonus += .25; } },
    { id: 'td_gold', icon: '◎', name: '战术掠夺', type: '节奏强化', rar: 0, tags: ['节奏'],
      desc: '击杀金币 +50%',
      apply: (p, ctx) => { ctx.td.goldBonus += .5; } },
    { id: 'td_overcharge', icon: '⩕', name: '超载', type: '节奏强化', rar: 1, tags: ['节奏'],
      desc: '技能伤害 +30%，但技能冷却 +25%',
      apply: (p, ctx) => { p.damage *= 1.3; ctx.td.cdScale *= 1.25; } },

    // ===== F 类 · 支援与团队 =====
    { id: 'td_aid', icon: '✚', name: '战场援助', type: '支援强化', rar: 0, tags: ['支援'],
      desc: '支援他人象限时，你的加成从 +5% 提到 +15%',
      apply: (p, ctx) => { ctx.td.aidBonus = .15; } },
    { id: 'td_beacon', icon: '⚑', name: '支援信标', type: '支援强化', rar: 0, tags: ['支援'],
      desc: '每 30 秒可向队友发出「请求支援」标记（全队可见）',
      apply: (p, ctx) => { ctx.td.beacon = true; } },
    { id: 'td_guard_pact', icon: '◈', name: '守望契约', type: '支援强化', rar: 1, tags: ['支援'],
      desc: '你在自己象限时，队友在你覆盖段内伤害 +10%',
      apply: (p, ctx) => { ctx.td.guardPact = .1; } },
    { id: 'td_rescue', icon: '⇄', name: '紧急牵引', type: '支援强化', rar: 1, tags: ['支援'],
      desc: '紧急救援冷却 -40%，可把队友拖到你相邻的阵位',
      apply: (p, ctx) => { ctx.td.rescueCd *= .6; } },
    { id: 'td_rally', icon: '⚑', name: '集结号令', type: '支援强化', rar: 2, tags: ['支援'],
      desc: '全队伤害 +8%，持续 10 秒（每局一次）',
      apply: (p, ctx) => { ctx.td.rally = true; } },
    { id: 'td_soul_link', icon: '∞', name: '灵魂链接', type: '支援强化', rar: 2, tags: ['支援'],
      desc: '与一名队友共享伤害：你的技能也打他那条路上的怪',
      apply: (p, ctx) => { ctx.td.soulLink = true; } }
  ];

  // ==========================================================================
  // 8. 通用卡在塔防下的改写（15 张 → 一张不剔，全部换成塔防语义）
  //    键 = 原 upgradePool 的 id；值为覆盖后的卡定义（不填则原样沿用）
  // ==========================================================================
  const TD_GENERIC_OVERRIDE = {
    damage: { name: '锋利武器', desc: '所有攻击伤害提高 18%' },
    haste: { name: '急速咏唱', desc: '攻击间隔缩短 12%' },
    vitality: { name: '坚韧意志', desc: '技能冷却缩短 6%', apply: (p, ctx) => { ctx.td.cdScale *= .94; } },
    speed: { name: '疾行阵位', desc: '传送冷却缩短 8%', apply: (p, ctx) => { ctx.td.tpCdMax *= .92; } },
    magnet: { name: '战场共鸣', desc: '击杀经验 +12%', apply: (p, ctx) => { ctx.td.xpBonus += .12; } },
    multishot: { name: '分裂攻击', desc: '远程攻击额外发射 1 枚投射物；战士获得 12% 范围' },
    pierce: { name: '穿透打击', desc: '投射物额外穿透 1 个敌人；战士伤害 +12%' },
    armor: { name: '护甲符文', desc: '你召唤的守卫减伤 30%', apply: (p, ctx) => { ctx.td.guardArmor = .3; } },
    crit: { name: '精准弱点', desc: '暴击率提高 8%' },
    regen: { name: '生命共鸣', desc: '每 8 次施法额外多放一次技能', apply: (p, ctx) => { ctx.td.extraCast += 8; } },
    dash: { name: '相位折跃', desc: '传送冷却缩短 15%', apply: (p, ctx) => { ctx.td.tpCdMax *= .85; } },
    velocity: { name: '强弓劲弩', desc: '投射物速度 +18%，攻击范围 +8%' },
    arcane_surge: { name: '奥术洪流', desc: '每次攻击有 18% 概率额外释放 2 枚奥术飞弹' },
    titan_blood: { name: '统御之心', desc: '阵位覆盖半径 +12%', apply: (p, ctx) => { ctx.td.reachMul *= 1.12; } },
    windrun: { name: '风行者之魂', desc: '传送冷却缩短 25%', apply: (p, ctx) => { ctx.td.tpCdMax *= .75; } }
  };

  // ==========================================================================
  // 8.5 局内核心（TD 版的「装备卡」）
  //   ★ 用户口径的矛盾点与解法：
  //     「装备卡要在杀怪过程中弹出、不暂停」 ＋「塔防不产装备」= 看似互斥。
  //     解法：塔防产出的是**局内核心** —— 和装备卡一样在击杀时三选一弹出、
  //     一样不暂停战斗，但效果只在本局生效，**绝不写 save.gearLearned / save.bag**。
  //     塔防的持久产出改由成就系统给金币。
  //   与强化卡（TD_UPGRADE_POOL）的区别：
  //     强化卡 = 每局固定的 36 + 15 张池子，靠升级弹出；
  //     核心   = 靠击杀掉落、可重复叠加（有等级上限），更接近「装备」。
  //   apply(p, ctx) 与强化卡同签名；ctx.td = TDR 运行时状态。
  //   max = 该核心的等级上限（可重复拾取叠加）。
  // ==========================================================================
  const TD_CORE_POOL = [
    // ===== 攻击核心 =====
    { id: 'core_flame', icon: '✸', name: '烈焰核心', rar: 0, max: 3, desc: '所有伤害 +12%',
      apply: (p) => { p.damage *= 1.12; } },
    { id: 'core_pierce', icon: '↟', name: '贯穿核心', rar: 1, max: 2, desc: '投射物额外穿透 1 个敌人',
      apply: (p) => { p.pierce += 1; } },
    { id: 'core_keen', icon: '✧', name: '锐目核心', rar: 1, max: 3, desc: '暴击率 +8%',
      apply: (p) => { p.crit = Math.min(.7, p.crit + .08); } },
    { id: 'core_sunder', icon: '⛨', name: '破甲核心', rar: 2, max: 2, desc: '无视目标 20% 护甲',
      apply: (p, ctx) => { ctx.td.armorPierce += .2; } },
    { id: 'core_burn', icon: '♨', name: '灼烧核心', rar: 2, max: 3, desc: '命中附加持续灼烧',
      apply: (p, ctx) => { ctx.td.burnOnHit += .12; } },
    { id: 'core_chain', icon: '⚡', name: '连锁核心', rar: 3, max: 2, desc: '击杀时 25% 概率引爆周围怪',
      apply: (p, ctx) => { ctx.td.chainKill += .25; } },
    // ===== 防御核心 =====
    { id: 'core_bulwark', icon: '⬟', name: '壁垒核心', rar: 0, max: 3, desc: '最大生命 +30',
      apply: (p) => { p.maxHp += 30; p.hp += 30; } },
    { id: 'core_regen', icon: '✚', name: '再生核心', rar: 0, max: 3, desc: '每秒回复 0.8 生命',
      apply: (p) => { p.regen += .8; } },
    { id: 'core_guardarmor', icon: '⛨', name: '荆棘核心', rar: 1, max: 2, desc: '守卫受到的伤害 -25%',
      apply: (p, ctx) => { ctx.td.guardArmor += .25; } },
    { id: 'core_aegis', icon: '◈', name: '庇护核心', rar: 2, max: 2, desc: '守卫上限 +1',
      apply: (p, ctx) => { ctx.td.guardMax += 1; } },
    // ===== 奥能核心 =====
    { id: 'core_arcane', icon: '✦', name: '奥能核心', rar: 1, max: 3, desc: '技能冷却缩短 8%',
      apply: (p, ctx) => { ctx.td.cdScale *= .92; } },
    { id: 'core_echo', icon: '❋', name: '回响核心', rar: 2, max: 2, desc: '每 3 次施法额外再放一次',
      apply: (p, ctx) => { ctx.td.extraCast = Math.max(3, ctx.td.extraCast - 3); } },
    { id: 'core_double', icon: '✺', name: '双重核心', rar: 2, max: 3, desc: '范围技能 20% 概率再放一次',
      apply: (p, ctx) => { ctx.td.doubleCast += .2; } },
    { id: 'core_gold', icon: '◉', name: '聚财核心', rar: 1, max: 3, desc: '击杀金币 +25%',
      apply: (p, ctx) => { ctx.td.goldBonus += .25; } },
    // ===== 机动核心 =====
    { id: 'core_swift', icon: '➤', name: '疾行核心', rar: 0, max: 3, desc: '传送冷却缩短 12%',
      apply: (p, ctx) => { ctx.td.tpCdMax *= .88; } },
    { id: 'core_farsight', icon: '◎', name: '远眺核心', rar: 1, max: 3, desc: '阵位覆盖半径 +10%',
      apply: (p, ctx) => { ctx.td.reachMul *= 1.10; } },
    { id: 'core_cross', icon: '✜', name: '交叉核心', rar: 2, max: 2, desc: '覆盖额外延伸 40 码到邻路',
      apply: (p, ctx) => { ctx.td.crossReach += 40; } },
    { id: 'core_command', icon: '❖', name: '指令核心', rar: 2, max: 2, desc: '范围技触发门槛放宽 20%',
      apply: (p, ctx) => { ctx.td.threshold *= .8; } }
  ];

  // ==========================================================================
  // 9. 守卫定义（绑定阵位，玩家传送时留在原阵）
  // ==========================================================================
  const GUARD_KINDS = {
    turret: { name: '魔能炮台', r: 16, range: 300, dps: .9, color: '#7fc6ff' },
    totem: { name: '守护图腾', r: 18, range: 260, dps: 0, color: '#ffd98a' },
    wolf: { name: '幽灵狼', r: 12, range: 220, dps: .7, color: '#9fd3ff' },
    thorn: { name: '荆棘守卫', r: 14, range: 240, dps: .6, color: '#8fd8a0' },
    mine: { name: '地雷', r: 10, range: 90, dps: 2.4, color: '#ffb257' },
    sentry: { name: '哨戒守卫', r: 15, range: 280, dps: 1.1, color: '#e0a0ff' },
    twin: { name: '镜像守卫', r: 16, range: 260, dps: .6, color: '#c8b0ff' }
  };

  // ==========================================================================
  // 10.5 波次 BOSS（10 / 20 / 30 波各 1 只）
  //    ★ 模型与名字复用 game.js 的 BOSS_ROSTER（31 位），这里只放「名册索引 + 塔防数值」。
  //      roster 是 0 基索引；名字/模型由 game.js 从 BOSS_ROSTER[roster] 取。
  //    ★ 首领血量不套 laneHpMult 的 2/c 公式 —— 用 BALANCE.bossHpMult(P) = 1 + 0.1 × (P-1)，
  //      理由：塔防首领只走一条路，1~2 人能打到它，所以人数系数必须比副本团本（0.8）小得多。
  //    ★ hpMul 由 tools/td/td-sim.mjs 的 `bossscan <波次>` 逐波扫描定标：
  //      目标是「首领死在路径 30%~70% 处」—— 太早秒掉 = 没有威胁，太晚 = 必漏。
  //      扫描结果（1 人局 · mid 成长 · 3 种子）：
  //        波10 ×24 → 法师 28/34/32  战士 28/31/40  猎人 45/46/44（进度 %）
  //        波20 ×24 → 法师 33/29/28  战士 29/16/25  猎人 20/51/26
  //        波30 ×18 → 法师 18/51/34  战士 35/36/94  猎人 80/71/67
  //    ★ 漏 1 只 BOSS 扣 5 只漏怪额度（设计案 §4 约定）。
  // ==========================================================================
  const BOSS_BY_WAVE = {
    10: { roster: 5,  label: 'BOSS#1', hpMul: 24, r: 34, speedMul: .70, xpMul: 8,  leakCost: 5 },
    20: { roster: 14, label: 'BOSS#2', hpMul: 24, r: 36, speedMul: .66, xpMul: 11, leakCost: 5 },
    30: { roster: 30, label: 'BOSS#3', hpMul: 18, r: 40, speedMul: .60, xpMul: 15, leakCost: 5 }
  };
  const bossOfWave = (w) => BOSS_BY_WAVE[w] || null;

  // ==========================================================================
  // 11. 小怪类型（按波次 tag 决定外观与特性）
  // ==========================================================================
  const MOB_TYPES = {
    normal: { name: '兽群步兵', r: 15, speedMul: 1, color: '#a58a64', sprite: 'gnoll' },
    fast: { name: '迅捷掠兽', r: 12, speedMul: 1.5, color: '#7e93a8', sprite: 'wolf' },
    tank: { name: '重甲兽', r: 22, speedMul: .8, color: '#87918b', sprite: 'golem' },
    caster: { name: '施法者', r: 14, speedMul: .95, color: '#9c6aac', sprite: 'cultist' },
    healer: { name: '治愈祭司', r: 15, speedMul: .9, color: '#8fb6c9', sprite: 'cultist' },
    splitter: { name: '裂体虫', r: 16, speedMul: 1.05, color: '#6a9c7a', sprite: 'ooze' },
    flyer: { name: '飞行畸变', r: 13, speedMul: 1.5, color: '#b05a8a', sprite: 'felhound', flying: true }
  };

  // ==========================================================================
  // 导出
  // ==========================================================================
  global.TD = {
    MAP, NODE_BY_ID, LANE_BY_ID, QUAD_UPPER,
    WAVES, BALANCE, COMMANDS, COMMAND_ORDER, AUTO_CAST, TD_DEFAULT_ACTIVE,
    TD_UPGRADE_POOL, TD_GENERIC_OVERRIDE, TD_CORE_POOL, GUARD_KINDS, MOB_TYPES,
    BOSS_BY_WAVE, bossOfWave,
    // 几何
    normPts, pathLength, buildArc, samplePath, distToPath, nearestOnPath,
    lanePoint, laneLength, padCoverage,
    // 规则
    pickTarget, autoCastEnabled
  };

})(typeof window !== 'undefined' ? window : globalThis);
