/* ============================================================================
 * hunter.js —— 《艾泽拉斯幸存者》猎人职业重做 v1
 *   「普攻三技能卡牌重做 + AOE 体系 + 全技能伤害提升 + 中毒/流血/灼烧强化」
 *
 * ── 为什么单独成文件（并行开发零冲突）────────────────────────────────────────
 *   game.js 是 50 万字符的核心文件，当前有多个任务并行开发。
 *   本次改动的绝大部分内容（卡牌定义、倍率表、AOE 结算逻辑）全部落在本文件；
 *   game.js 只留少量标记为 ★ HUNTER_HOOK 的挂接点。
 *   即使并行任务覆盖了 game.js，本文件依然完整可用，只需重放挂接点即可恢复。
 *
 * ── 设计原则 ────────────────────────────────────────────────────────────────
 *   ① 本文件不依赖 game.js 的任何内部状态；运行时由 game.js 通过 ctx 注入
 *      （p / game / damageEnemy / aoeDamage / applyPoison / applyBleed / ...）。
 *   ② 数值唯一真源：所有倍率、系数、半径都写在本文件，game.js 里不出现猎人数字。
 *   ③ 绝不挪动 Math.random() 的调用位置：本文件只在「玩家已装备对应卡牌」时才会
 *      触发随机（闪电链的锯齿折线），未装备时全局随机序列完全不变。
 * ========================================================================== */
(function (global) {
  'use strict';

  const VERSION = 1;

  // ==========================================================================
  // 1. 数值底座（唯一真源 —— game.js 里不出现任何猎人数字）
  // ==========================================================================
  const BALANCE = {
    // 精研卡：猎人 18%/级（其余职业 12%/级）
    masteryPerLevel: .18,

    // DoT 三件套倍率（中毒 / 流血 / 灼烧）
    poisonMult: 1.40, poisonDurMult: 1.15,
    bleedMult: 1.40, bleedDurMult: 1.15,
    burnMult: 1.20,

    // AOE 底座
    shatter: { radius: 55, radiusStep: 15, dmg: .40, dmgStep: .15 },                 // 双重射击 · 爆裂箭簇
    chain: { jumps: 2, range: 150, dmg: .45, dmgStep: .10, color: '#bfeaff' },      // 瞄准射击 · 雷链穿心
    cloud: { radius: 90, radiusStep: 30, dps: .22, dpsStep: .08, dur: 3, color: '#9fd86a' }, // 毒蛇钉刺 · 毒云领域
    bleedArrow: { dps: .18, dpsStep: .08, dur: 4 },                                 // 毒蛇钉刺 · 裂血箭簇
    piercePoison: { dmg: .60, dmgStep: .20, dur: 4 },                               // 毒蛇钉刺 · 贯穿毒刃
    mshSpread: { radius: 60, dmg: .35 },                                            // 多重射击 · 贯穿爆裂
    mshPoison: { dps: .15, dur: 4 },                                                // 多重射击 · 淬毒箭雨
    petSpread: { radius: 50, dmg: .25 },                                            // 兽王 · 撕咬裂伤
    etChain: { jumps: 3, range: 220, dmg: .40 },                                    // 爆炸陷阱 · 连环雷爆
    ftBurst: { radius: 80, dmg: .70 },                                              // 冰冻陷阱 · 碎冰爆裂
  };

  // 各技能伤害倍率（在 damageEnemy 单点收口 —— game.js 里只留一行倍率入口）
  const SKILL_MULT = {
    double_shot: 1.22,     // 双重射击
    aimed_shot: 1.18,      // 瞄准射击
    serpent_sting: 1.28,   // 毒蛇钉刺
    multi_shot: 1.18,      // 多重射击
    explosive_trap: 1.14,  // 爆炸陷阱
    freezing_trap: 1.30,   // 冰冻陷阱
    kill_command: 1.12,    // 杀戮命令
    pet: 1.16,             // 兽王幽灵狼
  };

  // ==========================================================================
  // 2. 卡牌定义
  //   · 三个普攻技能整体重做，各自获得**不同的 AoE 身份**（避免同质化）：
  //       双重射击 → 爆裂箭簇（近距溅射）
  //       瞄准射击 → 雷链穿心（链式多目标）
  //       毒蛇钉刺 → 毒云领域 + 贯穿流血（范围持续 + 贯穿 DoT）
  //   · 主动技能补 AoE 卡，并让「纯增益型」主动（急速射击 / 野性守护）真正加伤害
  // ==========================================================================
  const CARDS = {
    // ── 普攻 ①：双重射击 —— 定位「爆裂箭簇」
    double_shot: {
      desc: '一次射出两支箭矢，灵巧而致命。箭矢命中时会炸裂，波及目标周围的敌人。',
      mods: [
        { id: 'twin_focus', name: '双星汇聚', rar: 0, desc: '双重射击的箭矢伤害提高 20%（每级）。', max: 2 },
        { id: 'ds_shatter', name: '爆裂箭簇', rar: 2, desc: '命中的箭矢炸裂，对目标周围 55 码（每级 +15 码）内的敌人造成 40%（每级 +15%）武器伤害。', max: 2 },
        { id: 'ds_barrage', name: '箭雨齐射', rar: 3, desc: '双重射击额外射出 1 支箭矢（每级 +1）。', max: 2 },
        { id: 'ds_mark', name: '猎杀印记', rar: 2, desc: '命中的敌人受到伤害提高 12%（4 秒，每级 +6%）。', max: 2 },
        { id: 'bullseye', name: '百发百中', rar: 4, desc: '终极天赋：每点「分裂攻击」使双重射击的箭矢伤害额外提高 18%，并使爆裂溅射范围每点扩大 10 码。' },
      ],
    },

    // ── 普攻 ②：瞄准射击 —— 定位「雷链穿心」
    aimed_shot: {
      desc: '蓄力射出强力一箭，伤害极高并额外穿透 2 个敌人。命中时雷光顺导，劈向附近的敌人。',
      mods: [
        { id: 'aim_crit', name: '致命瞄准', rar: 1, desc: '瞄准射击的暴击率提高 25%。' },
        { id: 'aim_rate', name: '快速瞄准', rar: 0, desc: '瞄准射击的攻击间隔缩短 15%。', max: 2 },
        { id: 'aim_power', name: '破甲重箭', rar: 2, desc: '瞄准射击伤害提高 35%（每级），并使命中目标易伤 20%（3 秒）。', max: 2 },
        { id: 'aim_range', name: '远程狙击', rar: 1, desc: '瞄准射击的射程与索敌距离提高 25%（每级）。', max: 2 },
        { id: 'piercing_arrow', name: '穿透箭头', rar: 2, desc: '瞄准射击额外穿透 1 个敌人。' },
        { id: 'deadly_duo', name: '致命律动', rar: 3, desc: '与急速射击联动：急速射击期间瞄准射击必定暴击。', req: ['aim_crit'], reqSkill: 'rapid_fire' },
        { id: 'aim_chain', name: '雷链穿心', rar: 3, desc: '瞄准射击命中后闪电链劈向附近 2 个敌人（每级 +1），每跳造成 45%（每级 +10%）武器伤害。', max: 3 },
        { id: 'aim_stun', name: '雷霆震慑', rar: 2, desc: '闪电链每一跳眩晕敌人 0.6 秒（每级 +0.3 秒）。', max: 2 },
        { id: 'aim_fork', name: '双生弩箭', rar: 3, desc: '瞄准射击额外射出 1 支蓄力箭（每级 +1），伤害为原箭的 70%。', max: 2 },
        { id: 'aim_thunderstorm', name: '雷霆风暴', rar: 4, desc: '终极天赋：闪电链跳跃数额外 +2，每跳伤害提高 35%，且被闪电劈中的敌人受到伤害提高 15%（4 秒）。' },
      ],
    },

    // ── 普攻 ③：毒蛇钉刺 —— 定位「毒云 + 贯穿流血」
    serpent_sting: {
      desc: '射出淬毒箭矢，使命中的敌人中毒，4 秒内持续受到伤害。毒液会在命中处蔓延成毒云，贯穿命中则撕裂出流血伤口。',
      mods: [
        { id: 'venom', name: '剧毒', rar: 1, desc: '中毒伤害提高 50%（每级）。', max: 2 },
        { id: 'venom_range', name: '毒雾扩散', rar: 1, desc: '钉刺命中时对目标周围 70 码内的敌人施加中毒（每级）。', max: 2 },
        { id: 'venom_pierce', name: '贯穿毒刃', rar: 2, desc: '钉刺箭矢额外穿透 1 个敌人（每级 +1），且每次贯穿命中施加 60%（每级 +20%）持续 4 秒的中毒。', max: 2 },
        { id: 'spread', name: '瘟疫传播', rar: 2, desc: '中毒的敌人死亡时，将毒素传染给周围 130 码内的敌人。' },
        { id: 'bleed_pierce', name: '裂血箭簇', rar: 3, desc: '钉刺箭矢每次贯穿命中都使目标流血，每秒受到 18%（每级 +8%）武器伤害，持续 4 秒。', max: 2 },
        { id: 'venom_cloud', name: '毒云领域', rar: 3, desc: '钉刺命中处生成毒云，半径 90 码（每级 +30 码），持续 3 秒，每秒对云内敌人施加 22%（每级 +8%）武器伤害的中毒。', max: 2 },
        { id: 'venom_nova', name: '剧毒新星', rar: 4, desc: '终极天赋：中毒的敌人死亡时爆发剧毒新星，对周围敌人造成 120% 伤害并施加中毒。' },
      ],
    },

    // ── 主动技能：补 AoE / 让增益型主动真正加伤害 ──
    rapid_fire: {
      mods: [
        { id: 'rapid_hunt', name: '疾猎', rar: 3, desc: '急速射击期间所有伤害提高 12%（每级）。', max: 2 },
      ],
    },
    call_pet: {
      mods: [
        { id: 'pet_spread', name: '撕咬裂伤', rar: 3, desc: '狼伴命中时对目标周围 50 码内的敌人造成 25% 武器伤害的溅射。', max: 2 },
      ],
    },
    multi_shot: {
      mods: [
        { id: 'msh_spread', name: '贯穿爆裂', rar: 3, desc: '多重射击的箭矢命中时爆裂，对周围 60 码内的敌人造成 35% 武器伤害。', max: 2 },
        { id: 'msh_poison', name: '淬毒箭雨', rar: 3, desc: '多重射击的箭矢使命中的敌人中毒，每秒受到 15% 武器伤害，持续 4 秒。', max: 2 },
      ],
    },
    explosive_trap: {
      mods: [
        { id: 'et_chain', name: '连环雷爆', rar: 3, desc: '爆炸产生闪电链，劈向附近 3 个敌人，每个造成 40% 武器伤害。', max: 2 },
      ],
    },
    freezing_trap: {
      mods: [
        { id: 'ft_burst', name: '碎冰爆裂', rar: 3, desc: '冻结结束时冰爆，对周围 80 码内的敌人造成 70% 武器伤害。', max: 2 },
      ],
    },
    kill_command: {
      mods: [
        { id: 'kc_multi', name: '双重指令', rar: 3, desc: '同时攻击 2 个最近的敌人（每级 +1）。', max: 3 },
        { id: 'kc_sweep', name: '猎杀横扫', rar: 3, desc: '猎杀视野的溅射范围扩大 60 码（每级），溅射伤害提高 30%（每级）。', max: 2 },
      ],
    },
    aspect_wild: {
      mods: [
        { id: 'aw_hunter', name: '荒野猎杀', rar: 2, desc: '野性守护期间所有伤害提高 15%（每级）。', max: 2 },
      ],
    },
  };

  // ==========================================================================
  // 3. 卡牌补丁：把 CARDS 合并进 SKILLS.hunter
  //   · 同 id 的旧卡被整体替换（新定义覆盖旧 desc / max）
  //   · 未在补丁里出现的旧卡原样保留
  //   · 精研卡文案改写为猎人专属（数值走 masteryPerLevel，不写死在这里）
  // ==========================================================================
  function patchSkills(SKILLS) {
    const list = SKILLS && SKILLS.hunter;
    if (!list) return;
    for (const s of list) {
      const patch = CARDS[s.id];
      if (!patch) continue;
      if (patch.desc) s.desc = patch.desc;
      if (patch.mods && patch.mods.length) {
        const ids = new Set(patch.mods.map(x => x.id));
        s.mods = (s.mods || []).filter(x => !ids.has(x.id)).concat(patch.mods.map(x => ({ ...x })));
      }
    }
    for (const s of list) {
      const m = (s.mods || []).find(x => x.id === `${s.id}_dmg`);
      if (m) m.desc = `${s.name}伤害提高 ${Math.round(BALANCE.masteryPerLevel * 100)}%（猎人专属）。`;
    }
  }

  // ==========================================================================
  // 4. 运行时钩子
  // ==========================================================================
  // 调用计数：验收脚本用它证明 game.js 的挂接点仍然活着（防并行任务覆盖后静默失效）
  const CALLS = { onAttack: 0, onProjHit: 0, onZoneTick: 0, onPetHit: 0, onTrapBoom: 0, onPoisonDeath: 0, damageMult: 0, dotBoost: 0 };

  // 精研卡每级加成（猎人 18%，其余 12%）
  function masteryPerLevel(p) {
    return (p && p.type === 'hunter') ? BALANCE.masteryPerLevel : .12;
  }

  // 猎人所有技能的伤害倍率（在 damageEnemy 单点收口）
  function damageMult(skill, p) {
    if (!p || p.type !== 'hunter') return 1;
    CALLS.damageMult++;
    const m = p.mods || {};
    let k = SKILL_MULT[skill] || 1;
    // 急速射击（疾猎）：期间所有伤害提高
    if (p.rapidT > 0 && m.rapid_hunt) k *= 1 + .12 * m.rapid_hunt;
    // 野性守护（荒野猎杀）：期间所有伤害提高
    if (p.aspectT > 0 && m.aw_hunter) k *= 1 + .15 * m.aw_hunter;
    return k;
  }

  // DoT 增益：中毒 / 流血 / 灼烧
  function dotBoost(kind, e, dps, dur, p) {
    if (!p || p.type !== 'hunter') return null;
    CALLS.dotBoost++;
    let d = dps, t = dur;
    if (kind === 'poison') { d *= BALANCE.poisonMult; t *= BALANCE.poisonDurMult; }
    else if (kind === 'bleed') { d *= BALANCE.bleedMult; t *= BALANCE.bleedDurMult; }
    else if (kind === 'burn') { d *= BALANCE.burnMult; }
    return { dps: d, dur: t };
  }

  // ── 闪电链：从起点依次劈向最近的敌人 ──
  function chainLightning(ctx, from, opt) {
    const { game } = ctx;
    let src = from;
    const seen = new Set([from]);
    const jumped = [];
    for (let i = 0; i < opt.jumps; i++) {
      let best = null, bd = opt.range;
      for (const e of game.enemies) {
        if (e.dead || seen.has(e)) continue;
        const d = ctx.distance(e, src);
        if (d < bd) { bd = d; best = e; }
      }
      if (!best) break;
      seen.add(best);
      game.effects.push({
        type: 'bolt', pts: ctx.boltPoints(src.x, src.y, best.x, best.y, 6),
        life: .22, maxLife: .22, color: opt.color || '#bfeaff', w: 3
      });
      ctx.damageEnemy(best, opt.dmg, Math.atan2(best.y - src.y, best.x - src.x), opt.skill);
      if (opt.stun) ctx.applyStun(best, opt.stun);
      if (opt.vuln) { best.vulnT = Math.max(best.vulnT || 0, 4); best.vulnAmt = Math.max(best.vulnAmt || 0, opt.vuln); }
      jumped.push(best);
      src = best;
    }
    return jumped;
  }

  // ── 毒云：借 game.zones 承载，但用 noDmg 跳过直伤，毒性完全走 onZoneTick ──
  function spawnPoisonCloud(ctx, x, y, r, dps, dur) {
    ctx.game.zones.push({
      x, y, r, life: dur, maxLife: dur, tick: 0, dmg: 0, slow: 0,
      noDmg: true, hPoison: dps, hPoisonDur: Math.min(1.2, dur), poisonCloud: true
    });
    ctx.game.effects.push({ type: 'warning', x, y, r: 10, maxR: r, life: .35, maxLife: .35, color: BALANCE.cloud.color });
  }

  // ── 复制已生成的箭矢为额外箭矢（沿用原速度 / 寿命 / 颜色，只改角度与伤害）──
  function spawnExtraArrows(ctx, count, spread, dmgScale) {
    const { game, newProj } = ctx;
    const proto = newProj[newProj.length - 1];
    if (!proto) return;
    for (let i = 0; i < count; i++) {
      const off = (i - (count - 1) / 2) * spread;
      const a = Math.atan2(proto.vy, proto.vx) + off;
      const sp = Math.hypot(proto.vx, proto.vy) || 1;
      game.projectiles.push({
        ...proto, x: proto.x, y: proto.y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        damage: proto.damage * dmgScale, hit: new Set()
      });
    }
  }

  // ── 钩子 ①：普攻发箭瞬间（额外箭矢 / 穿透加成）──
  function onAttack(ctx) {
    const { p, skill, newProj } = ctx;
    if (!p || p.type !== 'hunter' || !newProj || !newProj.length) return;
    CALLS.onAttack++;
    const m = p.mods || {};
    if (skill === 'double_shot' && m.ds_barrage > 0) {
      spawnExtraArrows(ctx, m.ds_barrage, .10, 1);
    } else if (skill === 'aimed_shot' && m.aim_fork > 0) {
      spawnExtraArrows(ctx, m.aim_fork, .07, .70);
    } else if (skill === 'serpent_sting' && m.venom_pierce > 0) {
      for (const q of newProj) q.pierce = (q.pierce || 0) + m.venom_pierce;
    }
  }

  // ── 钩子 ②：投射物命中瞬间（全部 AoE 效果的主入口）──
  function onProjHit(ctx) {
    const { q, e, p } = ctx;
    if (!p || p.type !== 'hunter' || !q || !e) return;
    CALLS.onProjHit++;
    const m = p.mods || {};
    const sk = q.skill;
    const D = p.damage;

    // 双重射击 · 爆裂箭簇
    if (sk === 'double_shot' && m.ds_shatter > 0) {
      const lvl = m.ds_shatter;
      let r = BALANCE.shatter.radius + BALANCE.shatter.radiusStep * (lvl - 1);
      if (m.bullseye) r += 10 * (p.multishot || 0);   // 百发百中：每点分裂攻击 +10 码
      const dmg = D * (BALANCE.shatter.dmg + BALANCE.shatter.dmgStep * (lvl - 1));
      ctx.aoeDamage(e.x, e.y, r, dmg, 'double_shot');
      ctx.game.effects.push({ type: 'warning', x: e.x, y: e.y, r: 8, maxR: r, life: .24, maxLife: .24, color: '#d4e99b' });
    }
    // 双重射击 · 猎杀印记
    if (sk === 'double_shot' && m.ds_mark > 0) {
      const amt = .12 + .06 * (m.ds_mark - 1);
      e.vulnT = Math.max(e.vulnT || 0, 4);
      e.vulnAmt = Math.max(e.vulnAmt || 0, amt);
    }
    // 瞄准射击 · 雷链穿心
    if (sk === 'aimed_shot' && m.aim_chain > 0) {
      const lvl = m.aim_chain;
      const ult = m.aim_thunderstorm ? 1 : 0;
      chainLightning(ctx, e, {
        skill: 'aimed_shot',
        jumps: lvl + (ult ? 2 : 0),
        range: BALANCE.chain.range,
        dmg: D * (BALANCE.chain.dmg + BALANCE.chain.dmgStep * (lvl - 1)) * (ult ? 1.35 : 1),
        stun: m.aim_stun > 0 ? .6 + .3 * (m.aim_stun - 1) : 0,
        vuln: ult ? .15 : 0,
        color: BALANCE.chain.color
      });
    }
    // 毒蛇钉刺 · 毒云领域
    if (sk === 'serpent_sting' && m.venom_cloud > 0) {
      const lvl = m.venom_cloud;
      spawnPoisonCloud(ctx, e.x, e.y,
        BALANCE.cloud.radius + BALANCE.cloud.radiusStep * (lvl - 1),
        D * (BALANCE.cloud.dps + BALANCE.cloud.dpsStep * (lvl - 1)),
        BALANCE.cloud.dur);
    }
    // 毒蛇钉刺 · 贯穿毒刃（额外中毒）
    if (sk === 'serpent_sting' && m.venom_pierce > 0) {
      const lvl = m.venom_pierce;
      ctx.applyPoison(e, D * (BALANCE.piercePoison.dmg + BALANCE.piercePoison.dmgStep * (lvl - 1)), BALANCE.piercePoison.dur);
    }
    // 毒蛇钉刺 · 裂血箭簇（贯穿流血）
    if (sk === 'serpent_sting' && m.bleed_pierce > 0) {
      const lvl = m.bleed_pierce;
      ctx.applyBleed(e, D * (BALANCE.bleedArrow.dps + BALANCE.bleedArrow.dpsStep * (lvl - 1)), BALANCE.bleedArrow.dur);
    }
    // 多重射击 · 贯穿爆裂
    if (sk === 'multi_shot' && m.msh_spread > 0) {
      const lvl = m.msh_spread;
      const r = BALANCE.mshSpread.radius * (1 + .25 * (lvl - 1));
      const dmg = D * BALANCE.mshSpread.dmg * (1 + .3 * (lvl - 1));
      ctx.aoeDamage(e.x, e.y, r, dmg, 'multi_shot');
      ctx.game.effects.push({ type: 'warning', x: e.x, y: e.y, r: 8, maxR: r, life: .22, maxLife: .22, color: '#d4e99b' });
    }
    // 多重射击 · 淬毒箭雨
    if (sk === 'multi_shot' && m.msh_poison > 0) {
      const lvl = m.msh_poison;
      ctx.applyPoison(e, D * BALANCE.mshPoison.dps * (1 + .25 * (lvl - 1)), BALANCE.mshPoison.dur);
    }
  }

  // ── 钩子 ③：区域 tick（毒云的持续中毒）──
  function onZoneTick(ctx, z, e) {
    if (!z || !z.hPoison) return;
    CALLS.onZoneTick++;
    ctx.applyPoison(e, z.hPoison, z.hPoisonDur || 1.2);
  }

  // ── 钩子 ④：狼伴命中（撕咬裂伤溅射）──
  function onPetHit(ctx) {
    const { target, p } = ctx;
    if (!p || p.type !== 'hunter' || !target) return;
    CALLS.onPetHit++;
    const m = p.mods || {};
    if (!m.pet_spread) return;
    const lvl = m.pet_spread;
    const r = BALANCE.petSpread.radius * (1 + .25 * (lvl - 1));
    const dmg = p.damage * BALANCE.petSpread.dmg * (1 + .3 * (lvl - 1));
    ctx.aoeDamage(target.x, target.y, r, dmg, 'pet');
  }

  // ── 钩子 ⑤：陷阱爆炸（连环雷爆 / 碎冰爆裂）──
  function onTrapBoom(ctx) {
    const { tr, p } = ctx;
    if (!p || p.type !== 'hunter' || !tr) return;
    CALLS.onTrapBoom++;
    const m = p.mods || {};
    if (tr.type === 'explosive' && m.et_chain > 0) {
      const lvl = m.et_chain;
      chainLightning(ctx, tr, {
        skill: 'explosive_trap',
        jumps: BALANCE.etChain.jumps + (lvl - 1),
        range: BALANCE.etChain.range,
        dmg: p.damage * BALANCE.etChain.dmg * (1 + .25 * (lvl - 1)),
        color: '#bfeaff'
      });
    }
    if (tr.type === 'freezing' && m.ft_burst > 0) {
      const lvl = m.ft_burst;
      const r = BALANCE.ftBurst.radius * (1 + .2 * (lvl - 1));
      const dmg = p.damage * BALANCE.ftBurst.dmg * (1 + .25 * (lvl - 1));
      ctx.aoeDamage(tr.x, tr.y, r, dmg, 'freezing_trap');
      ctx.game.effects.push({ type: 'warning', x: tr.x, y: tr.y, r: 10, maxR: r, life: .3, maxLife: .3, color: '#9fe4ff' });
    }
  }

  // ── 钩子 ⑥：中毒目标死亡（剧毒新星附加中毒）──
  function onPoisonDeath(ctx) {
    const { e, p } = ctx;
    if (!p || p.type !== 'hunter' || !e) return;
    CALLS.onPoisonDeath++;
    if (!p.mods?.venom_nova) return;
    for (const o of ctx.game.enemies) {
      if (o.dead || o === e) continue;
      if (ctx.distance(o, e) < 100 + o.r) ctx.applyPoison(o, p.damage * .3, 3);
    }
  }

  // ==========================================================================
  // 5. 导出
  // ==========================================================================
  global.HUNTER = {
    VERSION,
    BALANCE,
    SKILL_MULT,
    CARDS,
    CALLS,
    // 卡牌补丁
    patchSkills,
    // 数值钩子
    masteryPerLevel,
    damageMult,
    dotBoost,
    // 运行时钩子
    onAttack,
    onProjHit,
    onZoneTick,
    onPetHit,
    onTrapBoom,
    onPoisonDeath,
  };

})(typeof window !== 'undefined' ? window : globalThis);
