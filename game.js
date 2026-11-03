(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  const TAU = Math.PI * 2;
  const DURATION = 300;
  // ===== 第 11 项：战复技能（联机专属 · 每位玩家默认佩戴）=====
  const REVIVE_CHANNEL = 5;    // 读条时长 5 秒
  const REVIVE_CD = 60;        // 冷却 60 秒
  const REVIVE_OVERLAP = 46;   // 「重合站位」判定半径（玩家半径 17，留出容差）
  const REVIVE_HP = .5;        // 复活后恢复 50% 生命

  // ===== 第 20 项：主动技能携带上限提升至 4 个 =====
  // 统一抽象：槽位序号 1~4 → 存档字段 active/active2/active3/active4、
  // 玩家字段 skillActive/skillActive2/skillActive3/skillActive4、
  // 冷却字段 activeCd/activeCd2/activeCd3/activeCd4、快捷键 Q / R / C / V。
  const ACTIVE_SLOTS = [
    { n: 1, key: 'active',  skill: 'skillActive',  cd: 'activeCd',  max: 'activeMax',  hotkey: 'Q', label: '主动技能 I · Q' },
    { n: 2, key: 'active2', skill: 'skillActive2', cd: 'activeCd2', max: 'activeMax2', hotkey: 'R', label: '主动技能 II · R' },
    { n: 3, key: 'active3', skill: 'skillActive3', cd: 'activeCd3', max: 'activeMax3', hotkey: 'C', label: '主动技能 III · C' },
    { n: 4, key: 'active4', skill: 'skillActive4', cd: 'activeCd4', max: 'activeMax4', hotkey: 'V', label: '主动技能 IV · V' }
  ];
  const ACTIVE_SLOT_KEYS = ACTIVE_SLOTS.map(s => s.key);
  const ACTIVE_MAX_COUNT = ACTIVE_SLOTS.length;
  const ACTIVE_HOTKEYS = { KeyQ: 1, KeyR: 2, KeyC: 3, KeyV: 4 };

  // ===== 塔防模式数据（td.js：地图 / 波次 / 配平 / 卡池 / 几何）=====
  // 独立文件的原因：TD 的地图坐标与数值表都由 tools/td/ 的生成器产出，
  // 放在独立文件里可以脱离游戏运行时单独跑校验（见 tools/td/selftest.mjs）。
  const TD = window.TD;
  if (!TD) console.warn('[塔防] td.js 未加载，塔防模式不可用');

  const heroes = {
    mage: { name: '奥术法师', icon: '✦', color: '#70d8f2', hp: 85, damage: 22, speed: 220, rate: .54, range: 560, armor: 0 },
    warrior: { name: '无畏战士', icon: '⚔', color: '#ed9a6d', hp: 125, damage: 28, speed: 205, rate: .68, range: 118, armor: 2 },
    hunter: { name: '荒野猎人', icon: '➶', color: '#9bd37e', hp: 95, damage: 15, speed: 245, rate: .48, range: 580, armor: 0 }
  };

  // ===== 技能数据（参考魔兽 60 级天赋，适配幸存者模式；升级效果通过局内升级卡获得）=====
  const SKILLS = {
    mage: [
      { id: 'arcane_missiles', kind: 'basic', name: '奥术飞弹', icon: '✦', cost: 0,
        desc: '快速发射穿透飞弹，贯穿直线上的敌人。奥术伤害天生高于其他职业。',
        mods: [
          { id: 'arcane_echo', name: '奥术回响', rar: 1, desc: '飞弹伤害提高 20%。', max: 3 },
          { id: 'arcane_pierce', name: '奥术穿透', rar: 1, desc: '奥术飞弹额外穿透 1 个敌人。', max: 2 },
          { id: 'arcane_velocity', name: '法术洪流', rar: 1, desc: '奥术飞弹的速度与射程提高 15%（每级）。', max: 2 },
          { id: 'barrage', name: '弹幕风暴', rar: 4, desc: '终极天赋：每第 4 次攻击额外齐射 2 枚飞弹。' }
        ] },
      { id: 'frostbolt', kind: 'basic', name: '寒冰箭', icon: '❄', cost: 150,
        desc: '射出寒冷箭矢，伤害更高并使命中目标减速 50%（持续 3 秒）。',
        mods: [
          { id: 'chill', name: '刺骨之寒', rar: 2, desc: '寒冰箭命中时，同时减速目标周围 90 码内的敌人。' },
          { id: 'deepfreeze', name: '深度冻结', rar: 1, desc: '减速效果提升至 70%，持续时间延长至 4.2 秒。' },
          { id: 'shatter', name: '碎冰', rar: 2, desc: '寒冰箭对被减速的敌人伤害提高 50%。' },
          { id: 'fingers', name: '寒冰指', rar: 1, desc: '寒冰箭的攻击间隔缩短 18%。', max: 2 },
          { id: 'frost_mastery', name: '寒冰掌握', rar: 3, desc: '碎冰与深度冻结共鸣：寒冰箭对被减速敌人的暴击率提高 25%。', req: ['shatter', 'deepfreeze'] },
          { id: 'frost_chill', name: '冰封领域', rar: 2, desc: '寒冰箭命中时冻结目标 1 秒（首领 0.4 秒）。', max: 2 },
          { id: 'absolute_zero', name: '绝对零度', rar: 4, desc: '终极天赋：被减速的敌人受到的所有伤害提高 20%。' }
        ] },
      { id: 'fireball', kind: 'basic', name: '火球术', icon: '♦', cost: 200,
        desc: '射出爆裂火球，命中时对小范围敌人造成 70% 溅射伤害，并点燃目标（3 秒）。',
        mods: [
          { id: 'ignite', name: '烈焰附魔', rar: 2, desc: '火球点燃的持续伤害提高 60%。', max: 2 },
          { id: 'pyroblast', name: '炎爆', rar: 2, desc: '火球爆炸范围扩大 60%，溅射伤害提高至 100%。' },
          { id: 'scorch', name: '灼烧', rar: 1, desc: '火球对燃烧的敌人暴击率提高 20%。' },
          { id: 'wildfire', name: '野火燎原', rar: 3, desc: '点燃与炎爆共鸣：溅射命中的敌人也会被点燃。', req: ['ignite', 'pyroblast'] },
          { id: 'embers', name: '燃烬', rar: 1, desc: '燃烧持续时间延长 2 秒。', max: 2 },
          { id: 'fireball_range', name: '炽热散射', rar: 1, desc: '火球溅射范围扩大 25%（每级）。', max: 2 },
          { id: 'meteor', name: '流星火雨', rar: 4, desc: '终极天赋：火球命中后，2 颗小陨石随即坠落轰击目标区域。' }
        ] },
      { id: 'frost_orb', kind: 'active', name: '寒冰宝珠', icon: '◉', cost: 300, cd: 9,
        desc: '按 Q 向前释放缓慢前进的宝珠，持续冻伤周围敌人。',
        mods: [
          { id: 'orb_slow', name: '冰霜之环', rar: 1, desc: '宝珠使周围敌人减速 45%。' },
          { id: 'orb_power', name: '冰川强化', rar: 0, desc: '宝珠伤害提高 45%。', max: 2 },
          { id: 'orb_cd', name: '急冻思维', rar: 0, desc: '宝珠冷却缩短 3 秒。' },
          { id: 'orb_range', name: '极地扩张', rar: 1, desc: '宝珠的冻伤范围扩大 40%（每级）。', max: 2 },
          { id: 'orb_len', name: '漫长霜冻', rar: 1, desc: '宝珠持续时间延长 2 秒。', max: 2 },
          { id: 'eternal_frost', name: '永恒冰霜', rar: 4, desc: '终极天赋：宝珠消散时爆发冰环，伤害并冻结周围敌人 1 秒。' }
        ] },
      { id: 'blizzard', kind: 'active', name: '暴风雪', icon: '❆', cost: 350, cd: 11,
        desc: '按 Q 在脚下召唤暴风雪，4 秒内持续伤害并减速范围内敌人。',
        mods: [
          { id: 'bliz_power', name: '刺骨冰寒', rar: 0, desc: '暴风雪伤害提高 40%。', max: 2 },
          { id: 'bliz_len', name: '漫长寒冬', rar: 1, desc: '暴风雪持续延长 2 秒。', max: 2 },
          { id: 'bliz_range', name: '风暴之眼', rar: 1, desc: '暴风雪范围扩大 25%（每级）。', max: 2 },
          { id: 'bliz_storm', name: '永冬之息', rar: 3, desc: '暴风雪期间每 2 秒额外降下一道冰锥，造成 80% 伤害。' },
          { id: 'ice_tomb', name: '冰封陵墓', rar: 4, desc: '终极天赋：暴风雪中的敌人受到的所有伤害提高 15%。' }
        ] },
      { id: 'ice_barrier', kind: 'active', name: '寒冰护体', icon: '⬡', cost: 300, cd: 13,
        desc: '按 Q 召唤寒冰护盾，5 秒内吸收伤害。护盾破裂时寒冰四溅。',
        mods: [
          { id: 'barrier_power', name: '屏障加固', rar: 1, desc: '护盾吸收量提高 40%。' },
          { id: 'barrier_cd', name: '急速冷却', rar: 0, desc: '寒冰护体冷却缩短 4 秒。' },
          { id: 'barrier_burst', name: '寒冰爆裂', rar: 2, desc: '护盾结束时爆裂，伤害并减速周围敌人。' },
          { id: 'barrier_range', name: '极寒结界', rar: 1, desc: '护盾持续时间延长 2 秒，破裂时的冰爆范围扩大 35%。', max: 2 },
          { id: 'shatter_guard', name: '碎冰反噬', rar: 3, desc: '护盾吸收量额外提高 25%。', max: 2 }
        ] },
      // ===== #50 法师新主动技能 =====
      { id: 'arcane_nova', kind: 'active', name: '魔爆术', icon: '✺', cost: 350, cd: 8,
        desc: '以自身为中心爆发奥术冲击，伤害并击退周围敌人。',
        mods: [
          { id: 'nova_range', name: '奥术扩容', rar: 0, desc: '魔爆术范围扩大 20%。', max: 2 },
          { id: 'nova_knock', name: '冲击震荡', rar: 1, desc: '击退距离加倍，命中敌人减速 30%。' },
          { id: 'nova_haste', name: '奥术涌动', rar: 1, desc: '一次命中 4 个以上敌人时，冷却缩短 2 秒。' },
          { id: 'nova_mark', name: '奥术印记', rar: 2, desc: '被命中的敌人受到伤害提高 12%，持续 4 秒。' },
          { id: 'nova_shield', name: '奥术屏障', rar: 2, desc: '施放后获得相当于 15% 生命的护盾，持续 3 秒。' },
          { id: 'nova_echo', name: '回响爆鸣', rar: 3, desc: '1 秒后在原位置回响第二次爆鸣，造成 60% 伤害。' },
          { id: 'nova_len', name: '余响不绝', rar: 2, desc: '回响爆鸣的二次爆鸣范围扩大 40%，伤害提高 30%。' },
          { id: 'nova_surge', name: '法力倾泻', rar: 3, desc: '魔爆术伤害提高 40%，但冷却延长 2 秒。' },
          { id: 'nova_master', name: '奥术大师', rar: 4, desc: '终极天赋：范围扩大 40%，每命中一个敌人冷却缩短 0.4 秒。' }
        ] },
      { id: 'flamestrike', kind: 'active', name: '烈焰风暴', icon: '♨', cost: 350, cd: 9,
        desc: '在最近的敌人脚下召唤火海，3 秒内持续灼烧区域内的敌人。',
        mods: [
          { id: 'fs_power', name: '烈焰强化', rar: 0, desc: '火海伤害提高 25%。', max: 2 },
          { id: 'fs_range', name: '燎原之势', rar: 1, desc: '火海半径扩大 25%。', max: 2 },
          { id: 'fs_len', name: '不灭之火', rar: 1, desc: '火海持续延长 2 秒。', max: 2 },
          { id: 'fs_burn', name: '余烬缠身', rar: 2, desc: '火海中的敌人被点燃。' },
          { id: 'fs_melt', name: '熔甲烈焰', rar: 2, desc: '火海中的敌人受到伤害提高 12%。' },
          { id: 'fs_double', name: '双生火海', rar: 3, desc: '同时在自己脚下燃起第二片火海。' },
          { id: 'fs_slow', name: '窒息浓烟', rar: 3, desc: '火海中的敌人减速 45%。' },
          { id: 'fs_pillar', name: '炎柱喷发', rar: 4, desc: '终极天赋：施放时火柱喷发，立即造成 180% 范围伤害。' }
        ] },
      { id: 'icy_veins', kind: 'active', name: '冰冷血脉', icon: '❅', cost: 400, cd: 14,
        desc: '6 秒内血脉冻结：攻击间隔缩短 25%，移动速度提高 15%。',
        mods: [
          { id: 'iv_len', name: '绵长寒意', rar: 0, desc: '持续时间延长 2 秒。', max: 2 },
          { id: 'iv_regen', name: '冰霜活力', rar: 1, desc: '血脉期间每秒恢复 1% 生命。' },
          { id: 'iv_speed', name: '疾风步', rar: 1, desc: '血脉期间移速额外提高 12%。' },
          { id: 'iv_power', name: '深寒', rar: 2, desc: '攻速效果提升至 38%。' },
          { id: 'iv_shield', name: '寒冰结界', rar: 2, desc: '激活时获得相当于 20% 生命的冰盾。' },
          { id: 'iv_crit', name: '冰锥之心', rar: 3, desc: '血脉期间暴击率提高 15%。' },
          { id: 'iv_surge', name: '极寒倾泻', rar: 3, desc: '血脉期间伤害提高 12%。' },
          { id: 'iv_burst', name: '极寒爆发', rar: 3, desc: '血脉结束时爆发冰环，造成 120% 范围伤害。' },
          { id: 'iv_endless', name: '永恒寒冬', rar: 4, desc: '终极天赋：血脉期间每次击杀延长 1 秒（上限 12 秒）。' }
        ] },
      // 第 19 项：镜像持续时间 6 → 9 秒，伤害系数 .45 → .62（施放处同步调整）
      { id: 'mirror_image', kind: 'active', name: '镜像', icon: '❖', cost: 400, cd: 18,
        desc: '召唤 2 个奥术镜像，9 秒内自动向敌人发射飞弹。',
        mods: [
          { id: 'mi_len', name: '凝影', rar: 0, desc: '镜像持续延长 2 秒。', max: 2 },
          { id: 'mi_rate', name: '疾影', rar: 1, desc: '镜像攻击间隔缩短 20%。' },
          { id: 'mi_dmg', name: '实影', rar: 1, desc: '镜像伤害提高 25%。' },
          { id: 'mi_three', name: '三重幻影', rar: 2, desc: '镜像数量 +1。' },
          { id: 'mi_shield', name: '护主幻影', rar: 2, desc: '镜像存在时，你受到的伤害降低 8%。' },
          { id: 'mi_range', name: '奥术共鸣', rar: 1, desc: '镜像的索敌范围扩大 150 码，且飞弹伤害提高 15%（每级）。', max: 2 },
          { id: 'mi_burst', name: '降临冲击', rar: 3, desc: '召唤镜像时对周围敌人造成 80% 伤害。' },
          { id: 'mi_split', name: '分裂幻影', rar: 3, desc: '镜像的飞弹额外分裂 1 枚。' },
          { id: 'mi_explode', name: '镜影爆裂', rar: 4, desc: '终极天赋：镜像消失时爆炸，对周围敌人造成 150% 伤害。' }
        ] },
      { id: 'arcane_blast', kind: 'active', name: '奥术冲击', icon: '◭', cost: 350, cd: 7,
        desc: '向前方扇形区域爆发奥能冲击波（射程 330 码）。',
        mods: [
          { id: 'ab_power', name: '冲能', rar: 0, desc: '冲击伤害提高 20%。', max: 2 },
          { id: 'ab_wide', name: '广域冲击', rar: 1, desc: '扇形角度扩大 25°。', max: 2 },
          { id: 'ab_range', name: '远程冲击', rar: 1, desc: '冲击距离提高 20%。', max: 2 },
          { id: 'ab_spread', name: '奥能扩散', rar: 2, desc: '冲击波在命中点额外炸开，范围扩大 120 码的余波造成 60% 伤害。' },
          { id: 'ab_mark', name: '奥能烙印', rar: 2, desc: '命中的敌人受到伤害提高 10%，持续 3 秒。' },
          { id: 'ab_knock', name: '冲退波', rar: 2, desc: '击退敌人并减速 25%。' },
          { id: 'ab_charge', name: '奥术充能', rar: 3, desc: '每命中 3 个敌人，下次冲击伤害提高 25%（最多 3 层）。' },
          { id: 'ab_recoil', name: '余波', rar: 3, desc: '施放后 2 秒内攻击间隔缩短 15%。' },
          { id: 'ab_arcane', name: '奥术残响', rar: 4, desc: '终极天赋：冲击后留下奥术残响区域，2.5 秒持续伤害。' }
        ] }
    ],
    warrior: [
      { id: 'whirlwind', kind: 'basic', name: '旋风斩', icon: '⚔', cost: 0,
        desc: '横扫周身所有敌人，正面迎敌的招牌技艺。',
        mods: [
          { id: 'wide', name: '横扫千军', rar: 0, desc: '旋风斩范围扩大 15%。', max: 2 },
          { id: 'endless_rage', name: '无尽怒火', rar: 4, desc: '终极天赋：旋风斩击杀敌人后 2 秒内范围扩大 30%（可刷新）。' }
        ] },
      { id: 'bloodthirst', kind: 'basic', name: '嗜血', icon: '♥', cost: 150,
        desc: '猛击最近的敌人，造成 150% 伤害并汲取生命。',
        mods: [
          { id: 'sweep', name: '横扫', rar: 2, desc: '嗜血对目标周围 80 码内的敌人造成 50% 溅射伤害。' },
          { id: 'cleave', name: '顺劈', rar: 2, desc: '嗜血额外攻击 1 个附近的敌人。' },
          { id: 'fury', name: '狂怒', rar: 1, desc: '嗜血造成击杀后，5 秒内攻击间隔缩短 25%。' },
          { id: 'rampage', name: '嗜血狂暴', rar: 3, desc: '横扫与顺劈共鸣：横扫的溅射伤害提升至与主目标相同。', req: ['sweep', 'cleave'] },
          { id: 'blood_rush', name: '血脉贲张', rar: 1, desc: '狂怒期间移动速度提高 20%。' }
        ] },
      { id: 'thunderclap', kind: 'basic', name: '雷霆一击', icon: '⚡', cost: 150,
        desc: '重击大地，伤害并减速周围敌人 40%。',
        mods: [
          { id: 'shock', name: '震荡', rar: 1, desc: '减速效果提升至 60%，影响范围扩大 25%。' },
          { id: 'revenge', name: '复仇', rar: 2, desc: '受到伤害后的下一次雷霆一击伤害提高 80%。' },
          { id: 'thorim', name: '雷神的愤怒', rar: 4, desc: '终极天赋：雷霆一击额外召唤 3 道追踪闪电打击最近的敌人。' }
        ] },
      { id: 'slam', kind: 'basic', name: '猛击', icon: '◆', cost: 200,
        desc: '挥动重锤猛击最近的敌人，造成 200% 伤害并眩晕 1 秒。',
        mods: [
          { id: 'heavy_slam', name: '毁灭重击', rar: 0, desc: '猛击伤害提高至 260%。' },
          { id: 'stun_len', name: '震荡猛击', rar: 1, desc: '眩晕时间延长至 2 秒。' },
          { id: 'stun_burst', name: '破敌之势', rar: 3, desc: '毁灭重击与震荡猛击共鸣：猛击眩晕目标时对周围敌人造成 50% 伤害。', req: ['heavy_slam', 'stun_len'] },
          { id: 'executioner', name: '处决者', rar: 2, desc: '猛击对眩晕目标的伤害提高 40%。', max: 2 }
        ] },
      { id: 'shield_wall', kind: 'active', name: '盾墙', icon: '⬟', cost: 250, cd: 16,
        desc: '按 Q 举起盾墙：2.5 秒无敌，并在随后数秒内护甲 +8。',
        mods: [
          { id: 'wall_len', name: '坚韧壁垒', rar: 0, desc: '盾墙持续时间延长 1.5 秒。' },
          { id: 'wall_cd', name: '沉着备战', rar: 0, desc: '盾墙冷却缩短 4 秒。' }
        ] },
      { id: 'blade_storm', kind: 'active', name: '剑刃风暴', icon: '❂', cost: 300, cd: 18,
        desc: '按 Q 化作利刃旋风，3 秒内持续斩击周围敌人。',
        mods: [
          { id: 'storm_dmg', name: '利刃狂舞', rar: 0, desc: '剑刃风暴伤害提高 30%。', max: 2 },
          { id: 'storm_len', name: '风暴不息', rar: 1, desc: '剑刃风暴持续时间延长 1 秒。' },
          { id: 'storm_fury', name: '风暴之怒', rar: 1, desc: '剑刃风暴期间移动速度提高 25%。' }
        ] },
      { id: 'war_stomp', kind: 'active', name: '战争践踏', icon: '◎', cost: 300, cd: 14,
        desc: '按 Q 践踏大地，击退周围敌人并使其眩晕 1.5 秒。',
        mods: [
          { id: 'stomp_r', name: '地动山摇', rar: 1, desc: '践踏范围扩大 40%。' },
          { id: 'stomp_cd', name: '不屈意志', rar: 0, desc: '践踏冷却缩短 4 秒。' },
          { id: 'earthshatter', name: '碎地者', rar: 4, desc: '终极天赋：践踏使大地龟裂，3 秒内持续灼烧践踏范围内的敌人。' }
        ] },
      // ===== #50 战士新主动技能 =====
      { id: 'charge', kind: 'active', name: '冲锋', icon: '➹', cost: 350, cd: 12,
        desc: '向当前方向突进，撞开并眩晕路径上的敌人。',
        mods: [
          { id: 'ch_len', name: '长途奔袭', rar: 0, desc: '冲锋距离提高 20%。', max: 2 },
          { id: 'ch_dmg', name: '蛮力冲撞', rar: 1, desc: '冲撞伤害提高 35%。' },
          { id: 'ch_stun', name: '当头棒喝', rar: 1, desc: '眩晕时间延长 0.8 秒。' },
          { id: 'ch_wide', name: '横扫突进', rar: 2, desc: '冲撞判定宽度扩大 50%。' },
          { id: 'ch_haste', name: '气势如虹', rar: 2, desc: '冲锋后 3 秒内攻击间隔缩短 15%。' },
          { id: 'ch_reset', name: '乘胜追击', rar: 3, desc: '冲锋击杀敌人时立即重置冷却。' },
          { id: 'ch_quake', name: '大地震颤', rar: 3, desc: '冲锋终点震击大地，对周围敌人造成 80% 伤害。' },
          { id: 'ch_shield', name: '无畏壁垒', rar: 4, desc: '终极天赋：冲锋后 4 秒内受到伤害降低 25%，移速提高 15%。' }
        ] },
      { id: 'shockwave', kind: 'active', name: '震荡波', icon: '≋', cost: 350, cd: 14,
        desc: '向前方释放锥形震荡波，伤害并眩晕敌人 1.2 秒。',
        mods: [
          { id: 'sw_power', name: '蓄力震荡', rar: 0, desc: '震荡波伤害提高 15%。', max: 2 },
          { id: 'sw_wide', name: '广域震荡', rar: 1, desc: '锥形宽度扩大 30%。' },
          { id: 'sw_stun', name: '重击昏厥', rar: 1, desc: '眩晕时间延长 0.8 秒。' },
          { id: 'sw_slow', name: '余震', rar: 2, desc: '命中的敌人减速 40%，持续 2 秒。' },
          { id: 'sw_cd_hit', name: '以战养战', rar: 2, desc: '每命中 3 个敌人，冷却缩短 1 秒（最多缩短 7 秒）。' },
          { id: 'sw_double', name: '双重震波', rar: 3, desc: '1.5 秒后爆发第二波，造成 60% 伤害。' },
          { id: 'sw_range', name: '远程震波', rar: 3, desc: '冲击距离提高 35%。' },
          { id: 'sw_earth', name: '裂地者', rar: 4, desc: '终极天赋：震荡波留下龟裂区域，3 秒内持续灼烧。' }
        ] },
      { id: 'mortal_strike', kind: 'active', name: '致死打击', icon: '⚒', cost: 400, cd: 10,
        desc: '对最近的敌人发动致命一击，造成 300% 伤害并使其易伤 5 秒。',
        mods: [
          { id: 'ms_power', name: '致命强化', rar: 0, desc: '致死打击伤害提高 15%。', max: 2 },
          { id: 'ms_len', name: '伤口撕裂', rar: 1, desc: '易伤持续延长 2 秒。' },
          { id: 'ms_heal', name: '嗜血渴望', rar: 1, desc: '命中后恢复 8% 生命。' },
          { id: 'ms_vuln', name: '重创', rar: 2, desc: '易伤效果提升至 25%。' },
          { id: 'ms_aoe', name: '横扫重击', rar: 2, desc: '同时对目标周围 90 码的敌人造成 50% 伤害。' },
          { id: 'ms_momentum', name: '乘胜追击', rar: 3, desc: '致死打击击杀后 5 秒内伤害提高 15%。' },
          { id: 'ms_crit', name: '弱点洞悉', rar: 3, desc: '致死打击暴击率提高 25%。' },
          { id: 'ms_execute', name: '斩杀灭绝', rar: 4, desc: '终极天赋：对生命低于 35% 的敌人伤害提高 80%。' }
        ] },
      { id: 'berserker_rage', kind: 'active', name: '狂暴之怒', icon: '♦', cost: 400, cd: 20,
        desc: '6 秒内陷入狂暴：攻击速度提高 30%，攻击伤害的 8% 转化为生命。',
        mods: [
          { id: 'br_len', name: '怒意绵长', rar: 0, desc: '狂暴持续延长 1.5 秒。', max: 2 },
          { id: 'br_speed', name: '狂风之势', rar: 1, desc: '狂暴期间移速提高 12%。' },
          { id: 'br_regen', name: '战斗渴望', rar: 1, desc: '狂暴期间每秒恢复 1% 生命。' },
          { id: 'br_leech', name: '嗜血如命', rar: 2, desc: '吸血效果提升至 14%。' },
          { id: 'br_haste', name: '狂怒加速', rar: 2, desc: '攻速效果提升至 40%。' },
          { id: 'br_thorns', name: '以牙还牙', rar: 3, desc: '狂暴期间反弹 35% 近战伤害。' },
          { id: 'br_fury', name: '怒击', rar: 3, desc: '狂暴期间暴击率提高 12%。' },
          { id: 'br_undying', name: '不灭之怒', rar: 4, desc: '终极天赋：狂暴期间受到致命伤害时保留 1 点生命并无敌 1.5 秒（每场一次）。' }
        ] },
      { id: 'demoralizing_shout', kind: 'active', name: '破胆怒吼', icon: '☠', cost: 350, cd: 16,
        desc: '发出震慑人心的怒吼，击退并眩晕周围敌人 1.5 秒。',
        mods: [
          { id: 'ds_range', name: '声震四野', rar: 0, desc: '怒吼范围扩大 15%。', max: 2 },
          { id: 'ds_stun', name: '魂飞魄散', rar: 1, desc: '眩晕时间延长 0.7 秒。' },
          { id: 'ds_armor', name: '同仇敌忾', rar: 1, desc: '怒吼后 4 秒内护甲 +6。' },
          { id: 'ds_slow', name: '腿软脚麻', rar: 2, desc: '被震慑的敌人减速 35%，持续 3 秒。' },
          { id: 'ds_weak', name: '破绽百出', rar: 2, desc: '被震慑的敌人受到伤害提高 12%，持续 4 秒。' },
          { id: 'ds_cd', name: '威慑', rar: 3, desc: '每震慑 4 个敌人，冷却缩短 1 秒（最多缩短 8 秒）。' },
          { id: 'ds_terror', name: '恐惧化身', rar: 3, desc: '怒吼范围额外扩大 30%。' },
          { id: 'ds_doom', name: '末日吼声', rar: 4, desc: '终极天赋：被震慑的敌人同时被点燃，3 秒内持续燃烧。' }
        ] }
    ],
    hunter: [
      { id: 'double_shot', kind: 'basic', name: '双重射击', icon: '➶', cost: 0,
        desc: '一次射出两支箭矢，灵巧而致命。',
        mods: [
          { id: 'twin_focus', name: '双星汇聚', rar: 0, desc: '双重射击的箭矢伤害提高 20%（每级）。', max: 2 },
          { id: 'bullseye', name: '百发百中', rar: 4, desc: '终极天赋：每点「分裂攻击」使双重射击的箭矢伤害额外提高 18%。' }
        ] },
      { id: 'aimed_shot', kind: 'basic', name: '瞄准射击', icon: '◎', cost: 150,
        desc: '蓄力射出强力一箭，伤害极高并额外穿透 2 个敌人。',
        mods: [
          { id: 'aim_crit', name: '致命瞄准', rar: 1, desc: '瞄准射击的暴击率提高 25%。' },
          { id: 'aim_rate', name: '快速瞄准', rar: 0, desc: '瞄准射击的攻击间隔缩短 15%。', max: 2 },
          { id: 'deadly_duo', name: '致命律动', rar: 3, desc: '与急速射击联动：急速射击期间瞄准射击必定暴击。', req: ['aim_crit'], reqSkill: 'rapid_fire' },
          { id: 'piercing_arrow', name: '穿透箭头', rar: 2, desc: '瞄准射击额外穿透 1 个敌人。' },
          { id: 'aim_range', name: '远程狙击', rar: 1, desc: '瞄准射击的射程与索敌距离提高 25%（每级）。', max: 2 },
          { id: 'aim_power', name: '破甲重箭', rar: 2, desc: '瞄准射击伤害提高 35%（每级），并使命中目标易伤 20%（3 秒）。', max: 2 }
        ] },
      { id: 'serpent_sting', kind: 'basic', name: '毒蛇钉刺', icon: '≋', cost: 200,
        desc: '射出淬毒箭矢，使命中的敌人中毒，4 秒内持续受到伤害。',
        mods: [
          { id: 'venom', name: '剧毒', rar: 1, desc: '中毒伤害提高 50%（每级）。', max: 2 },
          { id: 'spread', name: '瘟疫传播', rar: 2, desc: '中毒的敌人死亡时，将毒素传染给周围 130 码内的敌人。' },
          { id: 'venom_nova', name: '剧毒新星', rar: 4, desc: '终极天赋：中毒的敌人死亡时爆发剧毒新星，对周围敌人造成 120% 伤害。' },
          { id: 'venom_range', name: '毒雾扩散', rar: 1, desc: '钉刺命中时对目标周围 70 码内的敌人施加中毒（每级）。', max: 2 }
        ] },
      { id: 'rapid_fire', kind: 'active', name: '急速射击', icon: '≫', cost: 250, cd: 13,
        desc: '按 Q 全神贯注，5 秒内攻击速度提高 70%。',
        mods: [
          { id: 'rapid_len', name: '持久速射', rar: 0, desc: '急速射击持续时间延长 1.5 秒。' },
          { id: 'rapid_cd', name: '伺机待发', rar: 0, desc: '急速射击冷却缩短 4 秒。' },
          { id: 'focus', name: '心无旁骛', rar: 1, desc: '急速射击期间暴击率提高 18%。' },
          { id: 'rapid_range', name: '全域视野', rar: 1, desc: '急速射击期间攻击距离提高 20%（每级）。', max: 2 }
        ] },
      { id: 'call_pet', kind: 'active', name: '兽王', icon: '◮', cost: 300, cd: 20,
        desc: '携带本技能即永久召唤幽灵狼并肩作战（狼伤害 80% 武器伤害）；按 Q 释放兽王威压，为所有宠物赋予强化（伤害、攻速与攻击范围全面提升）。',
        mods: [
          { id: 'pet_power', name: '野性呼唤', rar: 1, desc: '幽灵狼伤害提高 35%（每级）。', max: 3 },
          { id: 'pet_count', name: '兽群增殖', rar: 1, desc: '永久召唤的幽灵狼 +1 只（数量不设上限）。', max: 8 },
          { id: 'pet_speed', name: '猎犬迅捷', rar: 0, desc: '幽灵狼攻击速度提高 18%（每级）。', max: 3 },
          { id: 'pet_range', name: '猎杀本能', rar: 1, desc: '幽灵狼索敌范围扩大 120 码，追踪速度提高（每级）。', max: 2 },
          { id: 'pet_aura_len', name: '兽王buff·延持', rar: 1, desc: '兽王威压的持续时间延长 4 秒（每级）。', max: 3 },
          { id: 'pet_aura_dmg', name: '兽王buff·伤害', rar: 2, desc: '兽王威压使全体宠物伤害提高 45%（每级）。', max: 3 },
          { id: 'pet_aura_rate', name: '兽王buff·攻速', rar: 2, desc: '兽王威压使全体宠物攻击速度提高 25%（每级）。', max: 3 },
          { id: 'pet_aura_leap', name: '兽王buff·突进', rar: 3, desc: '兽王威压使全体宠物攻击距离扩大并对命中目标造成击退（每级）。', max: 2 },
          { id: 'pet_bleed', name: '撕裂之爪', rar: 3, desc: '幽灵狼命中后使目标流血，每秒受到 25% 武器伤害（每级）。', max: 2 },
          { id: 'pack_tactics', name: '兽群战术', rar: 3, desc: '与毒蛇钉刺联动：狼伴攻击中毒目标时伤害提高 50%。', reqSkill: 'serpent_sting' },
          { id: 'pack_leader', name: '狼群领袖', rar: 4, desc: '终极天赋：幽灵狼攻击速度额外提高 20%，且兽王威压冷却缩短 6 秒。' }
        ] },
      // ===== #50 猎人新主动技能 =====
      { id: 'multi_shot', kind: 'active', name: '多重射击', icon: '⋔', cost: 350, cd: 11,
        desc: '向前方扇形射出 7 支利箭，覆盖大片敌人（每箭 78% 武器伤害）。',
        mods: [
          { id: 'msh_power', name: '劲矢', rar: 0, desc: '箭矢伤害提高 15%。', max: 2 },
          { id: 'msh_count', name: '箭雨', rar: 1, desc: '箭矢数量 +2。' },
          { id: 'msh_speed', name: '疾风箭', rar: 1, desc: '箭矢速度提高 25%。' },
          { id: 'msh_pierce', name: '贯穿箭', rar: 2, desc: '箭矢穿透 +1。' },
          { id: 'msh_crit', name: '瞄准要害', rar: 2, desc: '多重射击暴击率提高 15%。' },
          { id: 'msh_focus', name: '集中射击', rar: 3, desc: '扇形收窄 45%，伤害提高 35%。' },
          { id: 'msh_wide', name: '散射', rar: 3, desc: '扇形扩大 50%，箭矢 +1。' },
          { id: 'msh_reach', name: '远射覆盖', rar: 2, desc: '多重射击的射程与扇形扩大 25%（每级）。', max: 2 },
          { id: 'msh_storm', name: '箭矢风暴', rar: 4, desc: '终极天赋：多重射击击杀敌人后 2.5 秒内攻速提高 30%（可刷新）。' }
        ] },
      { id: 'explosive_trap', kind: 'active', name: '爆炸陷阱', icon: '✸', cost: 350, cd: 13,
        desc: '在脚下放置陷阱，敌人靠近或 6 秒后爆炸，造成大范围伤害（205% 武器伤害）。',
        mods: [
          { id: 'et_power', name: '烈性炸药', rar: 0, desc: '爆炸伤害提高 15%。', max: 2 },
          { id: 'et_range', name: '广域爆破', rar: 1, desc: '爆炸范围扩大 20%。' },
          { id: 'et_arm', name: '灵敏引信', rar: 1, desc: '陷阱触发半径扩大 60%。' },
          { id: 'et_burn', name: '燃烧弹', rar: 2, desc: '爆炸点燃敌人，2 秒内持续燃烧。' },
          { id: 'et_knock', name: '冲击装药', rar: 2, desc: '爆炸强力击退敌人。' },
          { id: 'et_two', name: '双重陷阱', rar: 3, desc: '一次放置 2 个陷阱。' },
          { id: 'et_sticky', name: '连环引爆', rar: 3, desc: '爆炸伤害提高 30%，并对首领有效击退。' },
          { id: 'et_reach', name: '遥控引信', rar: 2, desc: '陷阱的触发半径与爆炸范围同时扩大 30%（每级）。', max: 2 },
          { id: 'et_nova', name: '烈焰余波', rar: 4, desc: '终极天赋：爆炸后留下火焰区域，3 秒内持续灼烧。' }
        ] },
      { id: 'freezing_trap', kind: 'active', name: '冰冻陷阱', icon: '❆', cost: 350, cd: 15,
        desc: '在脚下放置冰霜陷阱，触发时冻结范围内敌人 2 秒（130% 武器伤害）。',
        mods: [
          { id: 'ft_range', name: '广域冰霜', rar: 0, desc: '冻结范围扩大 15%。', max: 2 },
          { id: 'ft_len', name: '极寒', rar: 1, desc: '冻结时间延长 0.8 秒。' },
          { id: 'ft_slow', name: '冻僵', rar: 1, desc: '冻结结束后敌人减速 40%，持续 2 秒。' },
          { id: 'ft_shatter', name: '脆化', rar: 2, desc: '冻结的敌人受到伤害提高 15%。' },
          { id: 'ft_two', name: '双重冰阱', rar: 2, desc: '一次放置 2 个陷阱。' },
          { id: 'ft_brittle', name: '碎冰者', rar: 3, desc: '对被冻结的敌人暴击率提高 20%。' },
          { id: 'ft_nova', name: '冰封爆裂', rar: 3, desc: '冻结结束时冰爆，造成 60% 伤害。' },
          { id: 'ft_apex', name: '绝对冰封', rar: 4, desc: '终极天赋：冻结时间 +1 秒，首领也会被冻结 0.8 秒。' }
        ] },
      { id: 'kill_command', kind: 'active', name: '杀戮命令', icon: '✖', cost: 400, cd: 9,
        desc: '对最近的敌人发动致命指令，造成 320% 伤害；狼伴会立即扑向目标。',
        mods: [
          { id: 'kc_power', name: '致命指令', rar: 0, desc: '杀戮命令伤害提高 18%（每级）。', max: 2 },
          { id: 'kc_reach', name: '猎杀视野', rar: 1, desc: '杀戮命令的索敌距离提高 25%，并使命中目标周围 90 码的敌人受同等伤害（每级）。', max: 2 },
          { id: 'kc_swift', name: '猎手步伐', rar: 1, desc: '施放后 2 秒内移速提高 10%。' },
          { id: 'kc_bleed', name: '撕裂伤口', rar: 1, desc: '目标中毒，3 秒内持续受到伤害。' },
          { id: 'kc_pack', name: '群兽围攻', rar: 2, desc: '场上有狼伴时，杀戮命令伤害提高 40%。' },
          { id: 'kc_focus', name: '狩猎连击', rar: 2, desc: '击杀后 2 秒内攻击速度提高 25%，并使目标获得易伤 10%（3 秒）。' },
          { id: 'kc_multi', name: '双重指令', rar: 3, desc: '同时攻击 2 个最近的敌人。' },
          { id: 'kc_haste', name: '狂化狼群', rar: 3, desc: '施放后狼伴 4 秒内攻击速度提高 30%。' },
          { id: 'kc_execute', name: '终结猎杀', rar: 4, desc: '终极天赋：对生命低于 35% 的敌人伤害提高 70%。' }
        ] },
      { id: 'aspect_wild', kind: 'active', name: '野性守护', icon: '❈', cost: 400, cd: 18,
        desc: '5 秒内激活野性守护：移速提高 25%，25% 概率完全闪避攻击。',
        mods: [
          { id: 'aw_len', name: '持久守护', rar: 0, desc: '持续延长 1.5 秒。', max: 2 },
          { id: 'aw_speed', name: '风行者', rar: 1, desc: '移速效果提升至 35%。' },
          { id: 'aw_regen', name: '猎手专注', rar: 1, desc: '守护期间攻击速度额外提高 10%（每级）。', max: 2 },
          { id: 'aw_dodge', name: '荒野奔袭', rar: 2, desc: '守护期间攻击距离提高 20%（每级），移速额外提高 12%。', max: 2 },
          { id: 'aw_haste', name: '猎豹迅捷', rar: 2, desc: '守护期间攻速提高 15%。' },
          { id: 'aw_pack', name: '兽群守护', rar: 3, desc: '守护期间狼伴伤害提高 30%。' },
          { id: 'aw_pack_dmg', name: '兽王统御', rar: 2, desc: '守护期间狼伴伤害额外提高 20%（每级），并使狼伴索敌范围扩大 120 码。', max: 2 },
          { id: 'aw_focus', name: '鹰眼', rar: 3, desc: '守护期间暴击率提高 10%。' },
          { id: 'aw_apex', name: '荒野之王', rar: 4, desc: '终极天赋：守护期间每次击杀延长 0.5 秒（上限 +4 秒）。' }
        ] }
    ]
  };
  const skillDef = (cls, id) => SKILLS[cls].find(s => s.id === id);
  // #35 全品质技能卡：每个技能程序化追加白卡（精研·伤害）与绿卡（娴熟·冷却）
  for (const cls of Object.keys(SKILLS)) for (const s of SKILLS[cls]) {
    s.mods.push({ id: `${s.id}_dmg`, name: '精研', rar: 0, desc: `${s.name}伤害提高 12%。`, max: 3 });
    if (s.kind === 'active') s.mods.push({ id: `${s.id}_cd`, name: '娴熟', rar: 1, desc: `${s.name}冷却缩短 10%。`, max: 2 });
  }
  /* ★ HUNTER_HOOK · ①：猎人职业重做 v1 —— 普攻三技能卡牌重做 + AOE 体系 + 全技能伤害提升。
     卡牌定义、倍率表、AOE 结算逻辑全部在独立文件 hunter.js（数值唯一真源）。
     本行只做挂接：并行任务若覆盖了 game.js，重放本行 + 下方同名标记的挂接点即可恢复猎人平衡。 */
  if (window.HUNTER) window.HUNTER.patchSkills(SKILLS);

  // ===== 专业（装备图谱流派）/ 材料 / 药水（暗黑3式无尽药水）/ 装备图鉴 =====
  // 第 18 项：专业本身默认已学习（不再需要金币学习），只有「图纸/图样」需要花金币研习。
  // cost 字段保留仅为兼容旧存档展示，UI 不再出现「学习专业」按钮。
  const PROFESSIONS = {
    tailoring: { name: '裁缝', icon: '✂', cost: 0, desc: '法师布甲图谱：默认已解锁，可在本页花金币研习法师装备图样，图样装备在冒险中击杀怪物时有几率掉落为装备卡牌。' },
    leatherworking: { name: '制皮', icon: '⬗', cost: 0, desc: '猎人皮甲图谱：默认已解锁，可花金币研习猎人装备图样，冒险中掉落为装备卡牌。' },
    blacksmithing: { name: '锻造', icon: '⚒', cost: 0, desc: '战士板甲图谱：默认已解锁，可花金币研习战士装备图样，冒险中掉落为装备卡牌。' }
  };
  const MATERIALS = {
    hide: { name: '兽皮', icon: '⬗', color: '#b08a5a', sell: 3, from: '豺狼人/幽灵狼' },
    scale: { name: '鱼人鳞片', icon: '◈', color: '#68a888', sell: 3, from: '鱼人' },
    cloth: { name: '暗影布', icon: '✧', color: '#9c6aac', sell: 4, from: '暗影教徒/巨魔' },
    core: { name: '岩石之核', icon: '⬢', color: '#87918b', sell: 5, from: '岩石傀儡/软泥怪' },
    essence: { name: '生命精华', icon: '❖', color: '#ffd66e', sell: 15, from: '首领' }
  };
  // 暗黑破坏神3「无尽药水」复刻：首领掉落/成就获取，背包配置，冒险中按 E 使用，冷却 30 秒
  const ITEMS = {
    pot_heal: { name: '无尽治疗药水', icon: '✚', color: '#e86a5e', kind: 'potion', sell: 30, desc: '按 E 使用：立即恢复 60% 生命。冷却 30 秒。' },
    pot_kulleaid: { name: '无尽卡奈之助', icon: '⌘', color: '#8fd8ef', kind: 'potion', sell: 60, desc: '恢复 60% 生命，并重置闪现冷却、解除自身减速。' },
    pot_amplify: { name: '无尽增幅药水', icon: '⚔', color: '#e8a45e', kind: 'potion', sell: 60, desc: '恢复 60% 生命，随后 5 秒内伤害提高 20%。' },
    pot_rejuvenate: { name: '无尽回复药水', icon: '❋', color: '#8fe3a0', kind: 'potion', sell: 60, desc: '恢复 60% 生命，随后 5 秒持续恢复 25% 生命。' },
    pot_leech: { name: '无尽吸血药水', icon: '♥', color: '#d96a7a', kind: 'potion', sell: 60, desc: '恢复 60% 生命，随后 6 秒内攻击伤害的 15% 转化为生命。' },
    pot_mutilate: { name: '无尽变异药水', icon: '☠', color: '#b07fe0', kind: 'potion', sell: 60, desc: '恢复 60% 生命，8 秒内对生命低于 35% 的敌人伤害提高 30%。' },
    pot_tower: { name: '无尽塔楼药水', icon: '⬟', color: '#c9c2a8', kind: 'potion', sell: 60, desc: '恢复 60% 生命，8 秒内护甲 +12。' },
    pot_fear: { name: '无尽恐惧药水', icon: '❂', color: '#9c6aac', kind: 'potion', sell: 60, desc: '恢复 60% 生命，并恐惧周围敌人（击退并眩晕 1.5 秒）。' },
    pot_diamond: { name: '无尽钻石药水', icon: '◆', color: '#a8d8e8', kind: 'potion', sell: 60, desc: '恢复 60% 生命，6 秒内受到的伤害降低 30%。' },
    pot_chaos: { name: '无尽混沌药水', icon: '✦', color: '#ffd66e', kind: 'potion', sell: 60, desc: '恢复 60% 生命，并随机触发一种其他药水的特效。' },
    plan_arcane: { name: '图样：提瑞斯法之心', icon: '❖', color: '#e8d090', kind: 'plan', gearId: 'mage_heart', sell: 30, desc: '使用后学会传说装备图样「提瑞斯法之心」（需要裁缝）。' },
    plan_dragonscale: { name: '图样：巨龙追猎者之弓', icon: '♛', color: '#e8d090', kind: 'plan', gearId: 'hunter_dragonbow', sell: 30, desc: '使用后学会传说装备图样「巨龙追猎者之弓」（需要制皮）。' },
    plan_bulwark: { name: '图纸：泰坦之力腰带', icon: '❂', color: '#e8d090', kind: 'plan', gearId: 'warrior_belt', sell: 30, desc: '使用后学会传说装备图样「泰坦之力腰带」（需要锻造）。' },
    // 熔火之心团本：橙装图纸（萨弗拉斯·炎魔之手 三职业变体）
    plan_sulfuras: { name: '图样：萨弗拉斯·炎魔之手', icon: '❈', color: '#e8a45e', kind: 'plan', gearId: 'warrior_sulfuras', sell: 60, desc: '使用后学会传说装备图样「萨弗拉斯·炎魔之手」（需要锻造）。' },
    plan_sulfuras_mage: { name: '图样：萨弗拉斯·炎魔之心', icon: '❈', color: '#e8a45e', kind: 'plan', gearId: 'mage_sulfuras', sell: 60, desc: '使用后学会传说装备图样「萨弗拉斯·炎魔之心」（需要裁缝）。' },
    plan_sulfuras_hunter: { name: '图样：萨弗拉斯·炎魔之弓', icon: '❈', color: '#e8a45e', kind: 'plan', gearId: 'hunter_sulfuras', sell: 60, desc: '使用后学会传说装备图样「萨弗拉斯·炎魔之弓」（需要制皮）。' }
  };
  const PLANS = ['plan_arcane', 'plan_dragonscale', 'plan_bulwark'];
  const POTION_IDS = ['pot_heal','pot_kulleaid','pot_amplify','pot_rejuvenate','pot_leech','pot_mutilate','pot_tower','pot_fear','pot_diamond','pot_chaos'];

  // 装备品质：白/绿/蓝/紫/橙
  const RARITY = [
    { name: '普通', color: '#c9d4ce', weight: 40 },
    { name: '优秀', color: '#7fb98f', weight: 28 },
    { name: '精良', color: '#6fa8dc', weight: 18 },
    { name: '史诗', color: '#b07fe0', weight: 10 },
    { name: '传说', color: '#e8a45e', weight: 4 }
  ];
  // 装备图鉴：专业训练师处学习图样（传说需首领图纸），冒险中击杀怪物概率掉落装备卡牌，最多携带 5 件
  const GEAR = {
    mage_staff1: { name: '学徒法杖', icon: '⚚', cls: 'mage', school: 'tailoring', rarity: 0, learn: 30, desc: '伤害 +8%', fx: { damageMult: 1.08 } },
    mage_robe1: { name: '织法者长袍', icon: '✦', cls: 'mage', school: 'tailoring', rarity: 1, learn: 60, desc: '最大生命 +30', fx: { maxHp: 30 } },
    mage_frost_sigil: { name: '寒冰纹章', icon: '❄', cls: 'mage', school: 'tailoring', rarity: 2, learn: 120, desc: '你施加的减速效果 +12%', fx: { slowBonus: .12 } },
    mage_orb: { name: '奥术洪流宝珠', icon: '◉', cls: 'mage', school: 'tailoring', rarity: 3, learn: 220, desc: '攻击有 15% 概率额外释放 2 枚奥术飞弹', fx: { surgeChance: .15 }, spec: { surgeChance: .03 } },
    mage_heart: { name: '提瑞斯法之心', icon: '❖', cls: 'mage', school: 'tailoring', rarity: 4, learn: 0, plan: 'plan_arcane', desc: '施放主动技能后 3 秒内伤害 +30%', fx: { castSurge: .3 }, spec: { castSurge: .06 } },
    warrior_sword1: { name: '铁剑', icon: '†', cls: 'warrior', school: 'blacksmithing', rarity: 0, learn: 30, desc: '伤害 +8%', fx: { damageMult: 1.08 } },
    warrior_plate1: { name: '精钢护胸', icon: '⬟', cls: 'warrior', school: 'blacksmithing', rarity: 1, learn: 60, desc: '最大生命 +35、护甲 +1', fx: { maxHp: 35, armor: 1 } },
    warrior_totem: { name: '雷霆图腾', icon: '⚡', cls: 'warrior', school: 'blacksmithing', rarity: 2, learn: 120, desc: '雷霆一击与战争践踏范围 +25%', fx: { stompRange: 1.25 }, spec: { stompRange: 1.06 } },
    warrior_helm: { name: '狂暴战盔', icon: '♞', cls: 'warrior', school: 'blacksmithing', rarity: 3, learn: 220, desc: '狂怒期间伤害 +20%', fx: { furyDmg: .2 }, spec: { furyDmg: .06 } },
    warrior_belt: { name: '泰坦之力腰带', icon: '❂', cls: 'warrior', school: 'blacksmithing', rarity: 4, learn: 0, plan: 'plan_bulwark', desc: '每击败 10 个敌人伤害 +2%（上限 +30%）', fx: { killStacks: true }, spec: { executeBonus: .08 } },
    hunter_bow1: { name: '猎手短弓', icon: '➶', cls: 'hunter', school: 'leatherworking', rarity: 0, learn: 30, desc: '伤害 +8%', fx: { damageMult: 1.08 } },
    hunter_leather1: { name: '兽皮护甲', icon: '⬗', cls: 'hunter', school: 'leatherworking', rarity: 1, learn: 60, desc: '最大生命 +25、移速 +5%', fx: { maxHp: 25, speedMult: 1.05 } },
    hunter_eye: { name: '毒蛇之眼', icon: '≋', cls: 'hunter', school: 'leatherworking', rarity: 2, learn: 120, desc: '中毒伤害 +25%', fx: { poisonBonus: .25 } },
    hunter_quiver: { name: '疾风箭袋', icon: '≫', cls: 'hunter', school: 'leatherworking', rarity: 3, learn: 220, desc: '攻击间隔缩短 12%', fx: { rateMult: .88 } },
    hunter_dragonbow: { name: '巨龙追猎者之弓', icon: '♛', cls: 'hunter', school: 'leatherworking', rarity: 4, learn: 0, plan: 'plan_dragonscale', desc: '箭矢穿透 +1，暴击伤害提高至 2.2 倍', fx: { pierce: 1, critDmg: 2.2 }, spec: { critDmgAdd: .1 } },
    // ===== 装备库扩充（参考魔兽 60 级装备库）=====
    // 法师 · 裁缝
    mage_skywall: { name: '碧空之歌', icon: '⚚', cls: 'mage', school: 'tailoring', rarity: 2, learn: 130, desc: '暴击率 +6%，伤害 +6%', fx: { critFlat: .06, damageMult: 1.06 } },
    mage_ring_archmage: { name: '大法师之戒', icon: '◉', cls: 'mage', school: 'tailoring', rarity: 3, learn: 230, desc: '攻击间隔缩短 7%，暴击率 +4%', fx: { rateMult: .93, critFlat: .04 } }, // #56
    mage_frost_pendant: { name: '霜语坠饰', icon: '❄', cls: 'mage', school: 'tailoring', rarity: 2, learn: 130, desc: '每秒恢复 0.8 生命，减速效果 +8%', fx: { regenFlat: .8, slowBonus: .08 } }, // #56
    mage_domination: { name: '统御法杖', icon: '⚚', cls: 'mage', school: 'tailoring', rarity: 3, learn: 230, desc: '伤害 +15%，最大生命 +20', fx: { damageMult: 1.15, maxHp: 20 } },
    mage_netherwind: { name: '灵风长袍', icon: '✦', cls: 'mage', school: 'tailoring', rarity: 2, learn: 130, desc: '最大生命 +40，每秒恢复 0.5 生命', fx: { maxHp: 40, regenFlat: .5 } },
    mage_scholar: { name: '博学者衬肩', icon: '✧', cls: 'mage', school: 'tailoring', rarity: 1, learn: 70, desc: '经验拾取范围 +30%', fx: { magnetMult: 1.3 } },
    mage_arcanist: { name: '奥术师手套', icon: '⌁', cls: 'mage', school: 'tailoring', rarity: 2, learn: 130, desc: '攻击间隔缩短 8%', fx: { rateMult: .92 } },
    mage_frost_rune: { name: '冰霜符文坠饰', icon: '❄', cls: 'mage', school: 'tailoring', rarity: 3, learn: 230, desc: '减速效果 +15%，寒冰护体吸收 +25%', fx: { slowBonus: .15, barrierBonus: .25 }, spec: { barrierBonus: .08 } },
    mage_talisman: { name: '短暂能量护符', icon: '◉', cls: 'mage', school: 'tailoring', rarity: 3, learn: 230, desc: '施放主动技能后 3 秒内移速 +20%、伤害 +15%', fx: { castSurge: .15, castHaste: .2 }, spec: { castHaste: .05 } },
    mage_atiesh: { name: '埃提耶什·守护者传说之杖', icon: '❖', cls: 'mage', school: 'tailoring', rarity: 4, learn: 0, plan: 'plan_atiesh', desc: '伤害 +20%，暴击率 +8%（传说 · 团本图纸）', fx: { damageMult: 1.2, critFlat: .08 }, spec: { surgeChance: .04 } },
    // 熔火之心团本橙装（法师变体）：与战士版同机制「熔火之心」岩浆池
    mage_sulfuras: { name: '萨弗拉斯·炎魔之心', icon: '❈', cls: 'mage', school: 'tailoring', rarity: 4, learn: 0, plan: 'plan_sulfuras_mage', desc: '伤害 +30%，暴击率 +8%，攻击有 5% 概率在最近敌人脚下召唤岩浆池（传说 · 团本图纸）', fx: { damageMult: 1.30, critFlat: .08, moltenCore: 1 }, spec: { moltenPower: 1 } },
    // 战士 · 锻造
    warrior_quel: { name: '奎尔塞拉', icon: '†', cls: 'warrior', school: 'blacksmithing', rarity: 3, learn: 230, desc: '伤害 +14%，护甲 +2', fx: { damageMult: 1.14, armor: 2 } },
    warrior_ring_valor: { name: '勇气指环', icon: '◉', cls: 'warrior', school: 'blacksmithing', rarity: 2, learn: 130, desc: '暴击率 +5%，伤害 +5%', fx: { critFlat: .05, damageMult: 1.05 } }, // #56
    warrior_warsong_boots: { name: '战歌重靴', icon: '⌂', cls: 'warrior', school: 'blacksmithing', rarity: 2, learn: 130, desc: '移动速度 +8%，护甲 +2', fx: { speedMult: 1.08, armor: 2 } }, // #56
    warrior_arcanite: { name: '奥金斧', icon: '⚔', cls: 'warrior', school: 'blacksmithing', rarity: 2, learn: 130, desc: '伤害 +12%', fx: { damageMult: 1.12 } },
    warrior_demonshear: { name: '恶魔之击', icon: '☠', cls: 'warrior', school: 'blacksmithing', rarity: 3, learn: 230, desc: '对生命低于 35% 的敌人伤害 +25%', fx: { executeBonus: .25 }, spec: { executeBonus: .06 } },
    warrior_might: { name: '力量胸甲', icon: '⬟', cls: 'warrior', school: 'blacksmithing', rarity: 2, learn: 130, desc: '最大生命 +50，护甲 +2', fx: { maxHp: 50, armor: 2 } },
    warrior_wrath: { name: '愤怒腿铠', icon: '⬗', cls: 'warrior', school: 'blacksmithing', rarity: 2, learn: 130, desc: '闪现冷却缩短 20%', fx: { dashMult: .8 } },
    warrior_windboots: { name: '风行铁靴', icon: '➤', cls: 'warrior', school: 'blacksmithing', rarity: 1, learn: 70, desc: '移速 +8%', fx: { speedMult: 1.08 } },
    warrior_slayer: { name: '屠夫面甲', icon: '♞', cls: 'warrior', school: 'blacksmithing', rarity: 1, learn: 70, desc: '暴击率 +4%', fx: { critFlat: .04 } },
    warrior_sulfuras: { name: '萨弗拉斯·炎魔之手', icon: '❂', cls: 'warrior', school: 'blacksmithing', rarity: 4, learn: 0, plan: 'plan_sulfuras', desc: '伤害 +30%，暴击率 +8%，攻击有 5% 概率在最近敌人脚下召唤岩浆池（传说 · 团本图纸）', fx: { damageMult: 1.30, critFlat: .08, moltenCore: 1 }, spec: { moltenPower: 1 } },
    // 猎人 · 制皮
    hunter_rhok: { name: '伦鲁迪洛尔·上古守护者长弓', icon: '♛', cls: 'hunter', school: 'leatherworking', rarity: 4, learn: 0, plan: 'plan_rhok', desc: '伤害 +18%，箭矢穿透 +1（传说 · 团本图纸）', fx: { damageMult: 1.18, pierce: 1 }, spec: { extraShotChance: .05 } },
    // 熔火之心团本橙装（猎人变体）：与战士版同机制「熔火之心」岩浆池
    hunter_sulfuras: { name: '萨弗拉斯·炎魔之弓', icon: '❈', cls: 'hunter', school: 'leatherworking', rarity: 4, learn: 0, plan: 'plan_sulfuras_hunter', desc: '伤害 +30%，暴击率 +8%，攻击有 5% 概率在最近敌人脚下召唤岩浆池（传说 · 团本图纸）', fx: { damageMult: 1.30, critFlat: .08, moltenCore: 1 }, spec: { moltenPower: 1 } },
    hunter_windrunner_ring: { name: '风行者之戒', icon: '◉', cls: 'hunter', school: 'leatherworking', rarity: 3, learn: 230, desc: '攻击间隔缩短 6%，额外箭矢概率 +5%', fx: { rateMult: .94, extraShotChance: .05 } }, // #56
    hunter_trackless_boots: { name: '无踪软靴', icon: '⌂', cls: 'hunter', school: 'leatherworking', rarity: 1, learn: 70, desc: '移动速度 +7%，拾取范围 +15%', fx: { speedMult: 1.07, magnetMult: 1.15 } }, // #56
    hunter_nerub: { name: '蛛魔制奴者', icon: '➶', cls: 'hunter', school: 'leatherworking', rarity: 3, learn: 230, desc: '伤害 +14%，暴击率 +3%', fx: { damageMult: 1.14, critFlat: .03 } },
    hunter_beastlord: { name: '巨兽之王护肩', icon: '⋔', cls: 'hunter', school: 'leatherworking', rarity: 2, learn: 130, desc: '每次攻击 12% 概率额外射出一箭', fx: { extraShotChance: .12 }, spec: { extraShotChance: .03 } },
    hunter_beasttamer: { name: '驭兽者手套', icon: '◮', cls: 'hunter', school: 'leatherworking', rarity: 2, learn: 130, desc: '狼伴伤害 +25%', fx: { petBonus: .25 }, spec: { petBonus: .08 } },
    hunter_swift: { name: '疾行者长靴', icon: '≫', cls: 'hunter', school: 'leatherworking', rarity: 1, learn: 70, desc: '移速 +8%', fx: { speedMult: 1.08 } },
    hunter_marsh: { name: '沼泽之眼', icon: '≋', cls: 'hunter', school: 'leatherworking', rarity: 3, learn: 230, desc: '中毒伤害 +20%，中毒持续时间 +1 秒', fx: { poisonBonus: .2, poisonDur: 1 }, spec: { poisonDur: .5 } },
    hunter_keeper: { name: '驯犬者项圈', icon: '◎', cls: 'hunter', school: 'leatherworking', rarity: 1, learn: 70, desc: '每秒恢复 0.4 生命', fx: { regenFlat: .4 } }
  };

  // ===== 副本（仿魔兽 60 级副本）：独立小怪组 / 五首领 / 尾王通关 / 套装图纸 =====
  const CLS_SCHOOL = { mage: 'tailoring', warrior: 'blacksmithing', hunter: 'leatherworking' };
  // ===== 第 10 项：首领名册 =====
  // 20 位副本首领（4 副本 × 5）+ 2 位无尽专属，模型与名称全局互不重复。
  // kind 决定首领技能行为；hp / dmg 为该首领相对同批首领的强度微调。
  const BOSS_ROSTER = [
    // 烈焰峡谷（熔岩烈焰）
    { name: '焰喉·熔岩暴君', spine: 'boss_molten', kind: 'flame', dungeon: 'ragefire', hp: 1.00, dmg: 1.00 },
    { name: '赤羽·烈焰德鲁伊', spine: 'boss_lieyandeluyi', kind: 'volley', dungeon: 'ragefire', hp: .92, dmg: 1.05 },
    { name: '焚风黑手·摩尔加', spine: 'boss_heishou', kind: 'summon', dungeon: 'ragefire', hp: .96, dmg: .98 },
    { name: '灰烬法师·法尔科', spine: 'boss_fankelifu', kind: 'quake', dungeon: 'ragefire', hp: .94, dmg: 1.02 },
    { name: '毁灭者·炎魔统帅', spine: 'boss_huimiezhe', kind: 'flame', dungeon: 'ragefire', hp: 1.35, dmg: 1.12 },
    // 洛丹伦废墟（亡灵巫妖）
    { name: '掘墓者·安萨伦', spine: 'boss_lich', kind: 'frost', dungeon: 'lordaeron', hp: 1.00, dmg: 1.00 },
    { name: '食尸鬼统领·古尔丹', spine: 'boss_barren', kind: 'summon', dungeon: 'lordaeron', hp: .92, dmg: 1.06 },
    { name: '缝合怪·缝合者', spine: 'boss_fenghe', kind: 'plague', dungeon: 'lordaeron', hp: .95, dmg: .99 },
    { name: '石狮鬼守卫·图勒', spine: 'boss_plague', kind: 'quake', dungeon: 'lordaeron', hp: .93, dmg: 1.03 },
    { name: '幽魂萨隆·亡者低语', spine: 'boss_yougesalong', kind: 'drain', dungeon: 'lordaeron', hp: 1.32, dmg: 1.10 },
    // 哀嚎洞穴（毒雾德鲁伊）
    { name: '尖牙德鲁伊·瑟芬迪斯', spine: 'boss_mengjingshuyao', kind: 'plague', dungeon: 'wailing', hp: 1.00, dmg: 1.00 },
    { name: '石像鬼·沙格', spine: 'boss_shixianggui', kind: 'volley', dungeon: 'wailing', hp: .91, dmg: 1.04 },
    { name: '巨魔头目·祖格', spine: 'boss_jumo', kind: 'summon', dungeon: 'wailing', hp: .97, dmg: .97 },
    { name: '奥术巨像·艾奥', spine: 'boss_aoshu', kind: 'quake', dungeon: 'wailing', hp: .98, dmg: 1.05 },
    { name: '剧毒之龙·辛达苟萨', spine: 'boss_xindagousa', kind: 'frost', dungeon: 'wailing', hp: 1.30, dmg: 1.11 },
    // 影牙城堡（狼人暗影）
    { name: '狼王·南杜斯', spine: 'boss_hogger', kind: 'volley', dungeon: 'shadowfang', hp: 1.00, dmg: 1.00 },
    { name: '幽影猎手·伊利丹', spine: 'boss_yilidan', kind: 'drain', dungeon: 'shadowfang', hp: .93, dmg: 1.06 },
    { name: '阿努巴拉克·白刃', spine: 'boss_anubalake', kind: 'summon', dungeon: 'shadowfang', hp: .96, dmg: .98 },
    { name: '梦魇领主·提克迪亚斯', spine: 'boss_tikediaosi', kind: 'drain', dungeon: 'shadowfang', hp: .95, dmg: 1.03 },
    { name: '冰霜白虎·凯', spine: 'boss_baihu', kind: 'frost', dungeon: 'shadowfang', hp: 1.33, dmg: 1.12 },
    // 无尽专属（不出现在副本，但与副本首领共处无尽池）
    { name: '虚空触须·恩祖奥西', spine: 'boss_abyss', kind: 'plague', dungeon: null, hp: 1.05, dmg: 1.05 },
    { name: '霜蚀青龙·敖乾', spine: 'boss_qinglong', kind: 'flame', dungeon: null, hp: 1.05, dmg: 1.05 },
    // ===== 熔火之心团队副本（9 位首领，模型与前 22 位全局互不重复）=====
    // 每个 Boss ≥2 个主动技能（尾王 6 个）；技能由独立 raidSkills 数组调度，不走 kind 单分支。
    { name: '路基弗隆·焚炉', spine: 'boss_lucifron', kind: 'flame', dungeon: 'moltencore', hp: 1.00, dmg: 1.00, raid: true,
      skills: [
        { id: 'lg_blast_wave', name: '爆炸波', cd: 9 },
        { id: 'lg_slag_splash', name: '熔渣喷溅', cd: 7 },
        { id: 'lg_twin_roar', name: '双头咆哮', cd: 15 }
      ] },
    { name: '玛格达拉·熔岩', spine: 'boss_magmadar', kind: 'flame', dungeon: 'moltencore', hp: 1.05, dmg: 1.02, raid: true,
      skills: [
        { id: 'mg_immolation', name: '献祭火焰', cd: 11 },
        { id: 'mg_magma_spit', name: '熔岩喷发', cd: 8 },
        { id: 'mg_blazing_inferno', name: '炽热召唤', cd: 20 }
      ] },
    { name: '沙兹拉克·渊影', spine: 'boss_shazzrah', kind: 'plague', dungeon: 'moltencore', hp: 1.02, dmg: 1.04, raid: true,
      skills: [
        { id: 'sz_fear_nova', name: '恐惧新星', cd: 12 },
        { id: 'sz_shadow_rain', name: '暗影箭雨', cd: 8 },
        { id: 'sz_abyss_rift', name: '深渊裂隙', cd: 16 }
      ] },
    { name: '古尔戈·岩拳', spine: 'boss_goregg', kind: 'quake', dungeon: 'moltencore', hp: 1.08, dmg: 1.02, raid: true,
      skills: [
        { id: 'gg_earthquake', name: '大地践踏', cd: 14 },
        { id: 'gg_rock_lob', name: '岩石飞掷', cd: 7 }
      ] },
    { name: '金度·六爪', spine: 'boss_jindo', kind: 'summon', dungeon: 'moltencore', hp: 1.00, dmg: 1.05, raid: true,
      skills: [
        { id: 'jd_pounce', name: '猛扑', cd: 10 },
        { id: 'jd_claw_combo', name: '六爪连击', cd: 8 },
        { id: 'jd_feline_roar', name: '猫科战吼', cd: 17 }
      ] },
    { name: '萨卡托斯·兽王', spine: 'boss_sarkoth', kind: 'summon', dungeon: 'moltencore', hp: 1.06, dmg: 1.03, raid: true,
      skills: [
        { id: 'sk_savage_maul', name: '撕裂爪', cd: 7 },
        { id: 'sk_terrifying_roar', name: '恐惧咆哮', cd: 15 }
      ] },
    { name: '萨弗拉斯·先驱', spine: 'boss_sulfuras', kind: 'flame', dungeon: 'moltencore', hp: 1.10, dmg: 1.06, raid: true,
      skills: [
        { id: 'sf_hellfire', name: '地狱火', cd: 12 },
        { id: 'sf_lava_bomb', name: '熔岩弹', cd: 8 },
        { id: 'sf_fire_elemental', name: '火元素召唤', cd: 21 }
      ] },
    { name: '玛尔科多莫·奥利加尔', spine: 'boss_majordomo', kind: 'plague', dungeon: 'moltencore', hp: 1.12, dmg: 1.08, raid: true,
      skills: [
        { id: 'mj_magma_spit', name: '熔岩吐息', cd: 10 },
        { id: 'mj_earth_shatter', name: '大地撕裂', cd: 15 },
        { id: 'mj_summon_elementals', name: '召唤火元素', cd: 22 }
      ] },
    { name: '炎魔之王·拉格纳罗斯', spine: 'boss_ragnaros', kind: 'flame', dungeon: 'moltencore', hp: 1.35, dmg: 1.15, raid: true,
      skills: [
        { id: 'rg_magma_pool', name: '熔岩池', cd: 11 },
        { id: 'rg_flame_wreath', name: '烈焰浪潮', cd: 9 },
        { id: 'rg_meteor_shower', name: '陨石天降', cd: 16 },
        { id: 'rg_eruption', name: '熔火喷发', cd: 14 },
        { id: 'rg_summon_elementals', name: '召唤熔火元素', cd: 24 },
        { id: 'rg_world_of_flame', name: '熔火之心', cd: 34 }
      ] }
  ];
  // 熔火之心：9 位首领的时间轴（约 24 分钟，9 个节点）
  const RAID_BOSS_TIMES = [140, 300, 470, 630, 790, 950, 1110, 1280, 1460];
  // 第 10 项：四个副本难度与产出数值拉平（只有套装效果不同）；bossTimes 构成约 15 分钟节奏
  const DUNGEON_BOSS_TIMES = [120, 330, 540, 750, 900];
  const DUNGEONS = {
    ragefire: {
      name: '烈焰峡谷', icon: '♦', img: 'assets/dungeons/ragefire.jpg', tag: '熔岩与烈焰的裂谷',
      desc: '燃刃氏族在奥格瑞玛地下的裂谷中召唤火焰之主，岩浆映红了岩壁。',
      ground: ['#241312', '#2a1712', '#381c10'], accent: '#e0784a', hue: 0,
      mobs: [
        { arch: 'melee', name: '燃刃信徒', r: 15, hp: 46, speed: 78, damage: 11, xp: 10, color: '#c96a45' },
        { arch: 'fast', name: '烈焰小鬼', r: 12, hp: 28, speed: 150, damage: 9, xp: 9, color: '#e89a52' },
        { arch: 'ranged', name: '燃刃术士', r: 15, hp: 58, speed: 58, damage: 10, xp: 15, color: '#b0526a' },
        { arch: 'tank', name: '熔岩傀儡', r: 24, hp: 180, speed: 44, damage: 19, xp: 26, color: '#8a5040' }
      ],
      bosses: [0, 1, 2, 3, 4], bossTimes: DUNGEON_BOSS_TIMES, set: 'flame', setName: '烈焰',
      setBonuses: {
        2: '攻击附加 2 秒燃烧（每秒 12% 武器伤害）',
        3: '燃烧伤害提高 60%，灼烧持续时间延长',
        5: '熔核引爆：击杀被燃烧的目标时爆炸，对周围敌人造成火焰伤害并点燃'
      }
    },
    lordaeron: {
      name: '洛丹伦废墟', icon: '☠', img: 'assets/dungeons/lordaeron.jpg', tag: '亡者低语的断壁残垣',
      desc: '曾经辉煌的王城如今只剩废墟，天灾的余孽在断壁间游荡。',
      ground: ['#151a1c', '#1a2124', '#212a2c'], accent: '#7ea87e', hue: 90,
      mobs: [
        { arch: 'melee', name: '骷髅士兵', r: 15, hp: 46, speed: 78, damage: 11, xp: 10, color: '#b8bca8' },
        { arch: 'fast', name: '食尸鬼', r: 12, hp: 28, speed: 150, damage: 9, xp: 9, color: '#8a9c7a' },
        { arch: 'ranged', name: '亡灵巫师', r: 15, hp: 58, speed: 58, damage: 10, xp: 15, color: '#7a8a9c' },
        { arch: 'tank', name: '缝合憎恶', r: 24, hp: 180, speed: 44, damage: 19, xp: 26, color: '#6a7a68' }
      ],
      bosses: [5, 6, 7, 8, 9], bossTimes: DUNGEON_BOSS_TIMES, set: 'blight', setName: '凋零',
      setBonuses: {
        2: '攻击附加 3 秒中毒（每秒 10% 武器伤害）',
        3: '中毒伤害提高 60%，中毒目标死亡时传染周围敌人',
        5: '亡者回响：中毒目标死亡时在原地升起毒雾，持续腐蚀范围内敌人'
      }
    },
    wailing: {
      name: '哀嚎洞穴', icon: '≋', img: 'assets/dungeons/wailing.jpg', tag: '毒雾弥漫的幽深洞窟',
      desc: '哀嚎之声自洞穴深处传来，尖牙德鲁伊的毒液浸透了每一寸岩石。',
      ground: ['#12201a', '#16261e', '#1a2e22'], accent: '#6ac88a', hue: 140,
      mobs: [
        { arch: 'melee', name: '洞穴潜伏者', r: 14, hp: 46, speed: 78, damage: 11, xp: 10, color: '#5a8a6a' },
        { arch: 'fast', name: '剧毒飞蛇', r: 12, hp: 28, speed: 150, damage: 9, xp: 9, color: '#7ab86a' },
        { arch: 'ranged', name: '尖牙德鲁伊', r: 15, hp: 58, speed: 58, damage: 10, xp: 15, color: '#4a9a7a' },
        { arch: 'tank', name: '沼泽软泥怪', r: 24, hp: 180, speed: 44, damage: 19, xp: 26, color: '#5a9a7a' }
      ],
      bosses: [10, 11, 12, 13, 14], bossTimes: DUNGEON_BOSS_TIMES, set: 'fang', setName: '尖牙',
      setBonuses: {
        2: '移动速度提高 12%',
        3: '暴击率提高 12%，暴击伤害提高 15%',
        5: '猎杀印记：暴击为敌人叠加印记，每层使其受到的伤害提高 4%（最多 6 层）'
      }
    },
    shadowfang: {
      name: '影牙城堡', icon: '♞', img: 'assets/dungeons/shadowfang.jpg', tag: '狼人出没的阴森古堡',
      desc: '阿鲁高的狼人诅咒笼罩着这座古堡，月影之下无人敢入。',
      ground: ['#141420', '#191926', '#1e1e2e'], accent: '#8a8ad0', hue: 240,
      mobs: [
        { arch: 'melee', name: '影牙卫兵', r: 15, hp: 46, speed: 78, damage: 11, xp: 10, color: '#7a7a9a' },
        { arch: 'fast', name: '影牙狼人', r: 12, hp: 28, speed: 150, damage: 9, xp: 9, color: '#8a8ab0' },
        { arch: 'ranged', name: '城堡怨灵', r: 15, hp: 58, speed: 58, damage: 10, xp: 15, color: '#9a9ac0' },
        { arch: 'tank', name: '石裔守卫', r: 24, hp: 180, speed: 44, damage: 19, xp: 26, color: '#6a6a8a' }
      ],
      bosses: [15, 16, 17, 18, 19], bossTimes: DUNGEON_BOSS_TIMES, set: 'shadow', setName: '影牙',
      setBonuses: {
        2: '攻击间隔缩短 8%',
        3: '闪现冷却缩短 35%，闪现后 1 秒内伤害 +25%',
        5: '暗影分身：闪现后留下一个持续 5 秒的影分身，自动攻击附近敌人'
      }
    },
    // ===== 熔火之心（团队副本 · 4 人）=====
    // 沿用 DUNGEONS 字典并以 type:'raid' 区分；9 位首领顺序对齐原版熔火之心。
    moltencore: {
      name: '熔火之心', icon: '☄', img: 'assets/dungeons/moltencore.jpg', tag: '团队副本 · 4 人 · 远古熔炉',
      desc: '炎魔之王拉格纳罗斯的熔炉，九位领主以岩浆与硫磺守护着地狱之门。',
      ground: ['#1a0e08', '#22110a', '#2c170c'], accent: '#ff6b2c', hue: 18,
      type: 'raid', minPlayers: 4, maxPlayers: 4,
      mobs: [
        { arch: 'melee', name: '熔岩傀儡', r: 26, hp: 420, speed: 40, damage: 26, xp: 42, color: '#8a4030', spine: 'mob_lavaspawn' },
        { arch: 'fast', name: '地狱猎犬', r: 14, hp: 180, speed: 150, damage: 18, xp: 30, color: '#b05a30', spine: 'mob_corehound' },
        { arch: 'ranged', name: '火焰行者', r: 16, hp: 240, speed: 55, damage: 20, xp: 36, color: '#d4763a', spine: 'mob_flamewarden' },
        { arch: 'tank', name: '灼热飞翼', r: 13, hp: 150, speed: 120, damage: 16, xp: 28, color: '#e0904a', spine: 'mob_sparkswirl' }
      ],
      bosses: [22, 23, 24, 25, 26, 27, 28, 29, 30], bossTimes: RAID_BOSS_TIMES, set: 'moltencore', setName: '熔火',
      setBonuses: {
        2: '攻击附带 2 秒燃烧（每秒 15% 武器伤害）',
        3: '燃烧伤害提高 50%，持续时间延长',
        5: '熔火之心：普攻 5% 概率发动全屏烈焰（详见装备说明）'
      }
    }
  };
  // 副本套装装备（第 10 项：每副本每职业五件套 —— 武器 / 护甲 / 饰品 / 戒指 / 项链）
  // 四副本的图纸数值完全一致（伤害 +14% / 生命 +45 / 暴击 +4% / 移速 +5% / 攻速 -3%），
  // 差异只体现在套装效果本身，达成「难度与产出相当、以套装区分」的诉求。
  const SET_SLOTS = [
    { s: 'w', name: { mage: '法杖', warrior: '战刃', hunter: '长弓' }, desc: '伤害 +14%', fx: { damageMult: 1.14 } },
    { s: 'a', name: { mage: '法袍', warrior: '铠甲', hunter: '皮甲' }, desc: '最大生命 +45', fx: { maxHp: 45 } },
    { s: 't', name: { mage: '魔典', warrior: '战徽', hunter: '兽符' }, desc: '暴击率 +4%，移速 +5%', fx: { critFlat: .04, speedMult: 1.05 } },
    { s: 'r', name: { mage: '法戒', warrior: '战戒', hunter: '猎戒' }, desc: '攻击间隔缩短 3%', fx: { rateMult: .97 } },
    { s: 'n', name: { mage: '秘法坠', warrior: '狼牙坠', hunter: '兽牙坠' }, desc: '最大生命 +20，护甲 +2', fx: { maxHp: 20, armor: 2 } }
  ];
  for (const [did, d] of Object.entries(DUNGEONS)) {
    if (d.type === 'raid') continue;   // 熔火 T1 单独生成（数值更高 + 职业后缀 set）
    for (const cls of ['mage', 'warrior', 'hunter']) {
      for (const slot of SET_SLOTS) {
        const gid = `${did}_${cls}_${slot.s}`;
        GEAR[gid] = { name: `${d.setName}${slot.name[cls]}`, icon: d.icon, cls, school: CLS_SCHOOL[cls], rarity: 3, learn: 0, dungeon: did, set: d.set,
          desc: `${d.setName}套装 · ${slot.desc}`, fx: { ...slot.fx } };
      }
      // #47 套装强化特化：每套装备按主题追加特色效果（强化每级追加）
      const setSpec = { flame: { burnOnHit: .03 }, blight: { poisonOnHit: .03 }, fang: { critFlat: .015 }, shadow: { rateMult: .985 } };
      for (const slot of SET_SLOTS) GEAR[`${did}_${cls}_${slot.s}`].spec = setSpec[d.set];
    }
  }
  // ===== 熔火之心 T1 套装（3 职业 × 5 部位 = 15 件）=====
  // 数值比地下城套装高 20~35%；set 字段带职业后缀（moltencore_mage / _warrior / _hunter），
  // 防止「法师穿了 5 件战士熔火装」也误触发五件套效果。
  const MOLTEN_SLOTS = [
    { s: 'w', name: { mage: '炎魔法杖', warrior: '炎魔战刃', hunter: '炎魔长弓' }, desc: '伤害 +19%，攻击间隔缩短 2%', fx: { damageMult: 1.19, rateMult: .98 } },
    { s: 'a', name: { mage: '熔岩法袍', warrior: '熔炉铠甲', hunter: '熔炉皮甲' }, desc: '最大生命 +62，护甲 +1', fx: { maxHp: 62, armor: 1 } },
    { s: 't', name: { mage: '硫磺魔典', warrior: '硫磺战徽', hunter: '硫磺兽符' }, desc: '暴击率 +7%，移速 +7%', fx: { critFlat: .07, speedMult: 1.07 } },
    { s: 'r', name: { mage: '炽焰法戒', warrior: '炽焰战戒', hunter: '炽焰猎戒' }, desc: '攻击间隔缩短 5%，暴击率 +4%', fx: { rateMult: .95, critFlat: .04 } },
    { s: 'n', name: { mage: '炎魔坠饰', warrior: '炎魔狼牙坠', hunter: '炎魔兽牙坠' }, desc: '最大生命 +30，护甲 +3', fx: { maxHp: 30, armor: 3 } }
  ];
  // 五件套效果（按职业分化的机制型效果，非数值堆砌）
  const MOLTEN_FIVE = {
    mage: { name: '熔火新星', desc: '普攻 5% 概率发动全屏烈焰新星，伤害 ×2.4 并灼烧，附带 1.5 秒定身' },
    warrior: { name: '熔岩践踏', desc: '普攻 5% 概率发动全屏烈焰践踏，伤害 ×2.6 并击退' },
    hunter: { name: '烈焰箭雨', desc: '普攻 5% 概率发动全屏烈焰箭雨，伤害 ×2.2 并灼烧，对灼烧目标伤害 +25%' }
  };
  for (const cls of ['mage', 'warrior', 'hunter']) {
    for (const slot of MOLTEN_SLOTS) {
      const gid = `moltencore_${cls}_${slot.s}`;
      GEAR[gid] = { name: slot.name[cls], icon: DUNGEONS.moltencore.icon, cls, school: CLS_SCHOOL[cls], rarity: 4, learn: 0, dungeon: 'moltencore', set: `moltencore_${cls}`,
        desc: `熔火 T1 套装 · ${slot.desc}`, fx: { ...slot.fx }, spec: { burnOnHit: .05 } };
    }
  }
  const setCount = (set) => game ? game.gear.filter(c => GEAR[c.id].set === set).length : 0;
  // 熔火 T1 按职业统计五件套（避免跨职业混算）
  function setHasCls(set, cls, n) {
    if (!game) return false;
    return game.gear.filter(c => GEAR[c.id].set === `${set}_${cls}` && GEAR[c.id].cls === cls).length >= n;
  }
  // ===== 第 10 项：五件套特异化效果 =====
  // 设计原则：每个套装的 5 件效果都不是数值堆砌，而是改变战斗方式的机制。
  //   烈焰 5 件「熔核引爆」：击杀燃烧目标时爆炸并点燃周围敌人
  //   凋零 5 件「亡者回响」：中毒目标死亡处升起持续毒雾
  //   尖牙 5 件「猎杀印记」：暴击叠印记，每层提升对其伤害
  //   影牙 5 件「暗影分身」：闪现后留下自动攻击的影分身
  const SET_FIVE = { flame: 5, blight: 5, fang: 5, shadow: 5 };
  function setHas(set, n) { return setCount(set) >= n; }
  // 尖牙 5 件：猎杀印记（暴击叠层，提高对该目标伤害）
  function applyMark(e, stacks) {
    e.markStacks = Math.min(6, (e.markStacks || 0) + stacks);
    e.markT = 6; // 印记持续 6 秒
  }
  function markDamageMult(e) { return 1 + (e.markStacks || 0) * .04; }
  // 影牙 5 件：暗影分身（闪现后留下的自动攻击幻象）
  function spawnShadowClone(p) {
    const clone = { x: p.x, y: p.y, life: 5, maxLife: 5, atkCd: .4, atkRate: .75, dmg: p.damage * .45,
      phase: rand(0, TAU), ranged: true, shadow: true };
    game.pets.push(clone);
    FX.ring(p.x, p.y, '#8a8ad0', 16, { speed: 190 });
    game.texts.push({ x: p.x, y: p.y - 40, text: '暗影分身', color: '#b0aef0', life: 1.1, size: 13 });
  }
  // 烈焰 5 件：熔核引爆（击杀燃烧目标 → 范围爆炸并点燃）
  function flameDetonate(e, p) {
    const r = 130;
    game.effects.push({ type: 'warning', x: e.x, y: e.y, r: 14, maxR: r, life: .35, maxLife: .35, color: '#f28a52' });
    FX.burst(e.x, e.y, '#f28a52', 22, { speed: 250, grav: 170 });
    for (const o of game.enemies) {
      if (o.dead || o === e) continue;
      if (distance(o, e) < r + o.r) {
        damageEnemy(o, p.damage * .55, Math.atan2(o.y - e.y, o.x - e.x), 'flame_set');
        applyBurn(o, p.damage * .18, 2.5);
      }
    }
  }
  // 凋零 5 件：亡者回响（中毒目标死亡处升起毒雾）
  function blightEcho(e, p) {
    const r = 120;
    game.zones.push({ x: e.x, y: e.y, r, life: 4, maxLife: 4, tick: 0, dmg: p.damage * .22, slow: .12, poison: 1, spine: 'mage_ice' });
    game.effects.push({ type: 'warning', x: e.x, y: e.y, r: 12, maxR: r, life: .4, maxLife: .4, color: '#9fd86a' });
    FX.burst(e.x, e.y, '#9fd86a', 16, { speed: 170, grav: 120 });
  }

  // ===== #45 装备图鉴扩充：每护甲专精 +50 专业研习图样（熟练度解锁）/ +30 首领图纸 =====
  const PROF_CAP = 300;
  const PROF_REQ = [0, 30, 80, 150, 220]; // 白/绿/蓝/紫/橙 对应专业熟练度门槛
  const LEARN_COST = [30, 70, 140, 260, 450];
  // 装备效果 → 中文描述（详情弹窗与程序化装备共用）
  function fxDesc(fx) {
    const pc = v => Math.round(v * 100);
    const L = {
      damageMult: v => `伤害 +${pc(v - 1)}%`, maxHp: v => `最大生命 +${v}`, armor: v => `护甲 +${v}`,
      speedMult: v => `移动速度 +${pc(v - 1)}%`, rateMult: v => `攻击间隔缩短 ${pc(1 - v)}%`,
      critFlat: v => `暴击率 +${pc(v)}%`, critDmg: v => `暴击伤害提高至 ${v} 倍`, pierce: v => `投射物穿透 +${v}`,
      regenFlat: v => `每秒恢复 ${v} 生命`, magnetMult: v => `经验拾取范围 +${pc(v - 1)}%`, dashMult: v => `闪现冷却缩短 ${pc(1 - v)}%`,
      slowBonus: v => `减速效果 +${pc(v)}%`, surgeChance: v => `攻击 ${pc(v)}% 概率额外释放 2 枚奥术飞弹`,
      castSurge: v => `施放主动技能后 3 秒内伤害 +${pc(v)}%`, castHaste: v => `施放主动技能后 3 秒内移速 +${pc(v)}%`,
      furyDmg: v => `狂怒期间伤害 +${pc(v)}%`, poisonBonus: v => `中毒伤害 +${pc(v)}%`, poisonDur: v => `中毒持续 +${v} 秒`,
      executeBonus: v => `对生命低于 35% 的敌人伤害 +${pc(v)}%`, burnOnHit: v => `攻击附加燃烧（每秒 ${pc(v)}% 武器伤害）`,
      poisonOnHit: v => `攻击附加中毒（每秒 ${pc(v)}% 武器伤害）`, petBonus: v => `狼伴伤害 +${pc(v)}%`,
      extraShotChance: v => `攻击 ${pc(v)}% 概率额外射出一箭`, barrierBonus: v => `寒冰护体吸收 +${pc(v)}%`,
      goldFind: v => `击杀 ${pc(v)}% 概率额外获得金币`, xpGain: v => `经验获取 +${pc(v)}%`,
      critDmgAdd: v => `暴击伤害 +${pc(v)}%`, contactSlow: v => `攻击你的敌人被减速 ${pc(v)}%（1.2 秒）`,
      killStacks: () => '每击败 10 个敌人伤害 +2%（上限 +30%）', stompRange: v => `雷霆一击与战争践踏范围 +${pc(v - 1)}%`,
      // 熔火之心团本橙装特效
      moltenCore: () => '熔火之心：攻击 5% 概率在最近敌人脚下召唤岩浆池（首击 260% 武器伤害 + 每秒 45% 持续伤害 + 燃烧，半径 90，持续 5 秒）',
      moltenPower: v => `熔火之心伤害 +${pc(v * .25)}%`
    };
    return Object.entries(fx).map(([k, v]) => L[k] ? L[k](v) : null).filter(Boolean);
  }
  // #56 新增戒指(r)/项链(n)/靴子(b) 三类装备
  const SLOT_BASE = { mage: { w: '法杖', a: '法袍', t: '魔典', r: '法戒', n: '秘法坠', b: '织雾鞋' }, warrior: { w: '战刃', a: '胸甲', t: '勋章', r: '战戒', n: '狼牙坠', b: '战靴' }, hunter: { w: '长弓', a: '皮甲', t: '兽符', r: '猎戒', n: '兽牙坠', b: '皮靴' } };
  const PROF_PREFIX = [
    ['学徒', '旅人', '哨兵', '荒野', '碎石', '微风'],
    ['迅捷', '坚韧', '锋利', '符文', '月光', '野性'],
    ['奥术', '霜语', '雷鸣', '晨星', '秘银', '丛林'],
    ['龙王', '圣殿', '虚空', '焰心', '风暴'],
    ['泰坦', '星辰', '永恒']
  ];
  const BOSS_PREFIX = { 2: ['嗜血', '毁灭', '暗影', '巨石', '毒牙'], 3: ['霸主', '审判', '深渊', '怒风', '噬魂'] };
  const GEAR_HOOKS = {
    mage: [{ surgeChance: .1 }, { castSurge: .12 }, { barrierBonus: .15 }, { slowBonus: .1 }],
    warrior: [{ executeBonus: .15 }, { stompRange: 1.12 }, { furyDmg: .12 }, { killStacks: true }],
    hunter: [{ extraShotChance: .08 }, { petBonus: .15 }, { poisonBonus: .12 }, { poisonDur: .8 }]
  };
  const TRINKET_EXTRA = [{ magnetMult: 1.15 }, { goldFind: .1 }, { xpGain: .1 }, { dashMult: .9 }, { rateMult: .96 }];
  function genGearFx(cls, slot, r, boss) {
    const fx = {}; const k = boss ? 1.25 : 1; // 首领图纸略强
    if (slot === 'w') fx.damageMult = +(1 + (.05 + .04 * r) * k).toFixed(2);
    if (slot === 'a') {
      fx.maxHp = Math.round((18 + 16 * r) * k);
      if (cls === 'warrior') fx.armor = 1 + Math.floor(r / 2);
      if (cls === 'hunter') fx.speedMult = +(1.02 + .02 * r).toFixed(2);
      if (cls === 'mage') fx.regenFlat = +(.25 * (r + 1)).toFixed(2);
    }
    if (slot === 't') {
      fx.critFlat = +(.02 + .012 * r).toFixed(3);
      if (r >= 2) Object.assign(fx, TRINKET_EXTRA[(r + cls.length) % TRINKET_EXTRA.length]);
    }
    // #56 新槽位特效定位：戒指·输出节奏 / 项链·回复成长 / 靴子·机动走位
    if (slot === 'r') {
      fx.critFlat = +(.015 + .012 * r).toFixed(3);
      fx.rateMult = +(1 - (.015 + .01 * r) * k).toFixed(3);
    }
    if (slot === 'n') {
      fx.regenFlat = +(.3 * (r + 1) * k).toFixed(2);
      fx.maxHp = Math.round((10 + 10 * r) * k);
      if (r >= 2) fx.xpGain = +(.04 + .02 * r).toFixed(2);
    }
    if (slot === 'b') {
      fx.speedMult = +(1.03 + .02 * r * k).toFixed(3);
      if (r >= 1) fx.magnetMult = +(1.1 + .05 * r).toFixed(2);
      if (r >= 2) fx.dashMult = +(.94 - .01 * r).toFixed(2);
    }
    if (r >= 1 && slot !== 'a' && slot !== 'b') Object.assign(fx, GEAR_HOOKS[cls][(r + slot.charCodeAt(0)) % GEAR_HOOKS[cls].length]);
    return fx;
  }
  // #46 所有非图纸类装备统一补齐熟练度门槛（按品质：白0/绿30/蓝80/紫150/橙220）
  for (const g of Object.values(GEAR)) if (!g.plan && !g.dungeon && g.profReq === undefined) g.profReq = PROF_REQ[g.rarity];
  const BOSS_PLANS = [];
  for (const cls of ['mage', 'warrior', 'hunter']) {
    const school = CLS_SCHOOL[cls];
    const clsIcon = { mage: '✦', warrior: '⚔', hunter: '➶' }[cls];
    // 专业研习图样：白12 / 绿12 / 蓝11 / 紫9 / 橙6 = 50 件
    const profCount = [12, 12, 11, 9, 6];
    for (let r = 0; r < 5; r++) {
      let made = 0;
      outer: for (const pre of PROF_PREFIX[r]) for (const slot of ['w', 'a', 't', 'r', 'n', 'b']) { // #56 六槽轮换
        if (made >= profCount[r]) break outer;
        const gid = `${cls}_prof_${r}_${made}${slot}`;
        const fx = genGearFx(cls, slot, r, false);
        GEAR[gid] = { name: pre + SLOT_BASE[cls][slot], icon: clsIcon, cls, school, rarity: r, learn: LEARN_COST[r], profReq: PROF_REQ[r], desc: fxDesc(fx).join('，'), fx };
        made++;
      }
    }
    // 首领图纸：蓝 15 / 紫 15 = 30 件（数值略强，仅限首领掉落）
    for (const r of [2, 3]) {
      let made = 0;
      outer: for (const pre of BOSS_PREFIX[r]) for (const slot of ['w', 'a', 't', 'r', 'n', 'b']) { // #56 六槽轮换
        if (made >= 15) break outer;
        const gid = `${cls}_boss_${r}_${made}${slot}`;
        const fx = genGearFx(cls, slot, r, true);
        const planId = `plan_${gid}`;
        // #47 首领装备强化特化：武器·暴击伤害 / 护甲·受击反减速 / 徽记·经验加成（#56 戒指·暴击 / 项链·回复 / 靴子·冲刺）
        const spec = { w: { critDmgAdd: .08 }, a: { contactSlow: .2 }, t: { xpGain: .06 }, r: { critFlat: .012 }, n: { regenFlat: .25 }, b: { dashMult: .97 } }[slot];
        GEAR[gid] = { name: pre + SLOT_BASE[cls][slot], icon: clsIcon, cls, school, rarity: r, learn: 0, plan: planId, spec, desc: fxDesc(fx).join('，'), fx };
        ITEMS[planId] = { name: `图样：${pre + SLOT_BASE[cls][slot]}`, icon: '❈', color: RARITY[r].color, kind: 'plan', gearId: gid, sell: 40, desc: `使用后学会装备图样（需要${PROFESSIONS[school].name}）。` };
        BOSS_PLANS.push(planId);
        made++;
      }
    }
  }

  // 功能图标：精选 PNG → 原内联 SVG → Unicode 字符。普通 img 相对路径同时支持 HTTP 与 file://。
  const GEAR_ICON = {
    mage_staff1: 'staff_frost', mage_skywall: 'staff_frost', mage_domination: 'orb_gold', mage_netherwind: 'robe_scholar',
    mage_scholar: 'robe_scholar', mage_arcanist: 'gloves_arcane', mage_frost_rune: 'necklace_eye', mage_talisman: 'orb_gold', mage_atiesh: 'staff_atiesh',
    mage_robe1: 'robe_scholar', mage_frost_sigil: 'necklace_eye', mage_orb: 'orb_gold', mage_heart: 'staff_atiesh',
    mage_ring_archmage: 'orb_gold', mage_frost_pendant: 'necklace_eye', // #56
    mage_sulfuras: 'staff_atiesh',   // 熔火之心团本橙装（法师变体）
    warrior_sword1: 'sword', warrior_quel: 'sword', warrior_arcanite: 'axe_arcanite', warrior_demonshear: 'dagger_demon',
    warrior_plate1: 'plate_steel', warrior_might: 'plate_steel', warrior_wrath: 'legs_wrath', warrior_windboots: 'boots_wind',
    warrior_slayer: 'helm_butcher', warrior_sulfuras: 'mace_sulfuras', warrior_totem: 'orb_gold', warrior_helm: 'helm_butcher', warrior_belt: 'plate_steel',
    warrior_ring_valor: 'helm_butcher', warrior_warsong_boots: 'boots_wind', // #56
    hunter_bow1: 'bow_rhok', hunter_rhok: 'bow_rhok', hunter_nerub: 'crossbow_nerub', hunter_dragonbow: 'bow_rhok',
    hunter_leather1: 'shoulders_beast', hunter_beastlord: 'shoulders_beast', hunter_beasttamer: 'gloves_arcane',
    hunter_swift: 'boots_wind', hunter_marsh: 'necklace_eye', hunter_keeper: 'necklace_eye', hunter_quiver: 'quiver', hunter_eye: 'necklace_eye',
    hunter_windrunner_ring: 'quiver', hunter_trackless_boots: 'boots_wind', // #56
    hunter_sulfuras: 'bow_rhok'      // 熔火之心团本橙装（猎人变体）
  };
  // 第 10 项：五件套槽位图标（武器 / 护甲 / 饰品 / 戒指 / 项链）逐槽位对应真实物件
  const DUNGEON_ICON = {
    mage: { w: 'staff_frost', a: 'robe_scholar', t: 'orb_gold', r: 'orb_gold', n: 'necklace_eye' },
    warrior: { w: 'sword', a: 'plate_steel', t: 'helm_butcher', r: 'helm_butcher', n: 'necklace_eye' },
    hunter: { w: 'bow_rhok', a: 'shoulders_beast', t: 'quiver', r: 'quiver', n: 'necklace_eye' }
  };
  function svgIc(key, color, size = 44) {
    const svg = ASSETS.getSvg(key);
    return svg ? `<span class="svg-ic" style="color:${color};width:${size}px;height:${size}px">${svg}</span>` : null;
  }
  function textIcon(text, color, size) {
    return `<span class="text-ic" style="color:${color || 'inherit'};font-size:${Math.round(size * .72)}px">${text || '✦'}</span>`;
  }
  function pngIconHtml(key, size, fallback, style = '') {
    return `<span class="png-ic" data-icon-key="${key}" style="width:${size}px;height:${size}px;${style}"><img src="./assets/icons/selected/${key}.png" alt="" draggable="false" onload="this.parentElement.dataset.loaded='true'" onerror="this.parentElement.dataset.failed='true';this.hidden=true;this.nextElementSibling.hidden=false"><span class="png-ic-fallback" hidden>${fallback}</span></span>`;
  }
  function gearIconHtml(gid, size = 44) {
    const g = GEAR[gid];
    const color = g.dungeon && DUNGEONS[g.dungeon] ? DUNGEONS[g.dungeon].accent : RARITY[g.rarity].color;
    const tail = gid.slice(-1), slot = ['w', 'a', 't', 'r', 'n', 'b'].includes(tail) ? tail : 't';
    let key = GEAR_ICON[gid];
    if (!key && g.dungeon) key = DUNGEON_ICON[g.cls][slot];
    if (!key) key = `${g.cls}_${slot}`;
    const fallback = svgIc(key, color, size) || textIcon(g.icon, color, size);
    const tint = g.dungeon && DUNGEONS[g.dungeon] ? `filter:hue-rotate(${DUNGEONS[g.dungeon].hue}deg);` : '';
    return pngIconHtml(key, size, fallback, tint);
  }
  function skillIconHtml(skillId, color, size = 34) {
    const def = skillDef('mage', skillId) || skillDef('warrior', skillId) || skillDef('hunter', skillId);
    return pngIconHtml('sk_' + skillId, size, svgIc('sk_' + skillId, color, size) || textIcon(def?.icon, color, size));
  }
  function itemIconHtml(id, size = 34) {
    const it = itemInfo(id);
    const key = it.kind === 'plan' ? 'item_plan' : (ITEMS[id] ? 'item_' + id : 'mat_' + id);
    return pngIconHtml(key, size, textIcon(it.icon, it.color, size));
  }
  function heroIconHtml(cls, size = 32) {
    const h = heroes[cls];
    return pngIconHtml('hero_' + cls, size, textIcon(h?.icon, h?.color, size));
  }
  function achievementIconHtml(a, size = 34) {
    return pngIconHtml('achv_' + a.id, size, textIcon(a.icon, '#e9bd67', size));
  }
  function professionIconHtml(pid, size = 36) {
    const p = PROFESSIONS[pid];
    return pngIconHtml('prof_' + pid, size, textIcon(p.icon, '#e9bd67', size));
  }
  function upgradeIconHtml(u, size = 42) {
    return pngIconHtml('up_' + u.id, size, textIcon(u.icon, '#e9bd67', size));
  }
  function dungeonIconHtml(did, size = 26) {
    const d = DUNGEONS[did];
    return pngIconHtml('dungeon_' + did, size, textIcon(d.icon, d.accent, size));
  }
  const ACHIEVEMENTS = [
    { id: 'first_run', icon: '⚑', name: '初入荒野', desc: '完成一次远征', check: s => s.stats.runs >= 1, reward: { gold: 50 } },
    { id: 'dawn', icon: '♛', name: '黎明见证者', desc: '单场远征存活满 5 分钟', check: s => s.stats.maxTime >= 300, reward: { gold: 150 } },
    { id: 'slayer', icon: '⚔', name: '百人斩', desc: '单场击败 100 个敌人', check: s => s.stats.maxKills >= 100, reward: { gold: 100 } },
    { id: 'hunter500', icon: '☠', name: '荒野猎手', desc: '累计击败 500 个敌人', check: s => s.stats.totalKills >= 500, reward: { gold: 120 } },
    { id: 'rich', icon: '●', name: '小有积蓄', desc: '累计获得 1000 金币', check: s => s.stats.totalGold >= 1000, reward: { gold: 80 } },
    { id: 'crafter', icon: '⚒', name: '图样收藏家', desc: '累计研习 5 件装备图样', check: s => s.gearLearned.length >= 5, reward: { gold: 100 } },
    // 第 18 项：专业默认已学习 → 「博学多闻」改为按熟练度判定（三个专业熟练度各达 50）
    { id: 'prof3', icon: '✦', name: '博学多闻', desc: '三个图谱专业的熟练度各达到 50', check: s => Object.keys(PROFESSIONS).every(p => (s.professions?.[p] || 0) >= 50), reward: { gold: 100 } },
    { id: 'gearup', icon: '⬟', name: '全副武装', desc: '单场远征携带 5 件装备', check: s => s.stats.maxGear >= 5, reward: { gold: 150 } },
    { id: 'boss1', icon: '♞', name: '首领杀手', desc: '击败任意一位首领', check: s => s.stats.bosses >= 1, reward: { gold: 150 } },
    { id: 'skill5', icon: '✧', name: '博览群技', desc: '累计学习 5 个技能', check: s => Object.values(s.learned).reduce((n, l) => n + l.length, 0) >= 8, reward: { gold: 120 } },
    { id: 'epic', icon: '❖', name: '传说获得者', desc: '获得 1 件传说品质装备', check: s => s.stats.orangeGear >= 1, reward: { potion: 'pot_leech' } },
    { id: 'versatile', icon: '❂', name: '三面玲珑', desc: '三个职业都完成过一次远征', check: s => ['mage', 'warrior', 'hunter'].every(c => s.stats.best[c]), reward: { gold: 200 } },
    { id: 'alchemist', icon: '⚗', name: '药水大师', desc: '收集 5 种无尽药水', check: s => s.potions.length >= 5, reward: { potion: 'pot_chaos' } },
    // 副本成就
    { id: 'clear_ragefire', icon: '♦', name: '烈焰征服者', desc: '通关副本「烈焰峡谷」', cat: 'dungeon', check: s => (s.stats.dungeonClears?.ragefire || 0) >= 1, reward: { gold: 200 } },
    { id: 'clear_lordaeron', icon: '☠', name: '废墟清道夫', desc: '通关副本「洛丹伦废墟」', cat: 'dungeon', check: s => (s.stats.dungeonClears?.lordaeron || 0) >= 1, reward: { gold: 200 } },
    { id: 'clear_wailing', icon: '≋', name: '哀嚎终结者', desc: '通关副本「哀嚎洞穴」', cat: 'dungeon', check: s => (s.stats.dungeonClears?.wailing || 0) >= 1, reward: { gold: 200 } },
    { id: 'clear_shadowfang', icon: '♞', name: '影牙破咒者', desc: '通关副本「影牙城堡」', cat: 'dungeon', check: s => (s.stats.dungeonClears?.shadowfang || 0) >= 1, reward: { gold: 200 } },
    { id: 'dungeon_all', icon: '♛', name: '副本大师', desc: '通关全部 4 个副本', cat: 'dungeon', check: s => Object.keys(DUNGEONS).filter(d => DUNGEONS[d].type !== 'raid').every(d => (s.stats.dungeonClears?.[d] || 0) >= 1), reward: { gold: 500 } },
    // ===== 熔火之心团本专属成就组 =====
    { id: 'clear_moltencore', icon: '☄', name: '熔火征服者', desc: '通关团队副本「熔火之心」', cat: 'raid', check: s => (s.stats.dungeonClears?.moltencore || 0) >= 1, reward: { gold: 500 } },
    { id: 'raid_firewalker', icon: '♨', name: '熔岩行者', desc: '在熔火之心累计击败 100 个敌人', cat: 'raid', check: s => (s.stats.raidKills || 0) >= 100, reward: { gold: 300 } },
    { id: 'molten_t1', icon: '❖', name: '熔火套成', desc: '集齐 5 件熔火 T1 套装部件', cat: 'raid', check: s => (s.stats.moltenT1 || 0) >= 5, reward: { gold: 400 } },
    { id: 'molten_roll', icon: '⚄', name: '命运骰客', desc: '团本 roll 点掷出 90 点以上', cat: 'raid', check: s => (s.stats.bestRoll || 0) >= 90, reward: { gold: 300 } },
    // ===== 第 9 项：无尽模式专属成就组 =====
    // 无尽模式不产金币与装备，奖励统一给药水（药水是无尽模式的核心产出）
    { id: 'endless_first', icon: '⚔', name: '无尽初旅', desc: '完成一次无尽模式远征', cat: 'endless', check: s => (s.stats.endlessRuns || 0) >= 1, reward: { potion: 'pot_heal' } },
    { id: 'endless_watch', icon: '☾', name: '荒野长明', desc: '单场无尽模式存活满 10 分钟', cat: 'endless', check: s => (s.stats.endlessMaxTime || 0) >= 600, reward: { potion: 'pot_rejuvenate' } },
    { id: 'endless_slayer', icon: '⚡', name: '无尽百斩', desc: '单场无尽模式击败 200 个敌人', cat: 'endless', check: s => (s.stats.endlessMaxKills || 0) >= 200, reward: { potion: 'pot_amplify' } },
    { id: 'endless_boss10', icon: '♞', name: '无尽猎手', desc: '无尽模式累计击败 10 个首领', cat: 'endless', check: s => (s.stats.endlessBossKills || 0) >= 10, reward: { potion: 'pot_leech' } },
    { id: 'endless_dex', icon: '❖', name: '无尽首领图鉴', desc: '在无尽模式中见过 12 位不同的首领', cat: 'endless', check: s => (s.stats.endlessBossSeen || []).length >= 12, reward: { potion: 'pot_fear' } },
    { id: 'endless_legion', icon: '☠', name: '无尽军团', desc: '无尽模式累计击败 2000 个敌人', cat: 'endless', check: s => (s.stats.endlessKills || 0) >= 2000, reward: { potion: 'pot_mutilate' } },
    { id: 'endless_alchemy', icon: '⚗', name: '无尽炼金', desc: '无尽模式累计收集 8 瓶药水', cat: 'endless', check: s => (s.stats.endlessPotions || 0) >= 8, reward: { potion: 'pot_chaos' } },
    { id: 'endless_marathon', icon: '⏳', name: '无尽马拉松', desc: '无尽模式累计存活满 60 分钟', cat: 'endless', check: s => (s.stats.endlessRuns || 0) >= 1 && (s.stats.endlessTotalTime || 0) >= 3600, reward: { potion: 'pot_diamond' } },
    // ===== 塔防模式专属成就组 =====
    // 塔防不产装备（局内核心不入存档）→ 持久产出统一走成就奖励金币。
    { id: 'td_first', icon: '◈', name: '初次守卫', desc: '完成一次塔防守卫', cat: 'td', check: s => (s.stats.tdRuns || 0) >= 1, reward: { gold: 120 } },
    { id: 'td_wave10', icon: '⛨', name: '稳固防线', desc: '单局守住 10 波', cat: 'td', check: s => (s.stats.tdBestWave || 0) >= 10, reward: { gold: 180 } },
    { id: 'td_wave20', icon: '❖', name: '铜墙铁壁', desc: '单局守住 20 波', cat: 'td', check: s => (s.stats.tdBestWave || 0) >= 20, reward: { gold: 280 } },
    { id: 'td_clear', icon: '♛', name: '心之守护', desc: '守住全部 30 波', cat: 'td', check: s => (s.stats.tdWavesCleared || 0) >= 30, reward: { gold: 600 } },
    { id: 'td_perfect', icon: '✧', name: '毫发无损', desc: '零漏怪守住全部 30 波', cat: 'td', check: s => (s.stats.tdLeakBest != null && s.stats.tdLeakBest <= 0) && (s.stats.tdWavesCleared || 0) >= 30, reward: { gold: 800 } },
    { id: 'td_slay300', icon: '⚔', name: '屠戮者', desc: '单局击败 300 个敌人', cat: 'td', check: s => (s.stats.tdMaxKills || 0) >= 300, reward: { gold: 220 } },
    { id: 'td_slays1000', icon: '☠', name: '绞肉机', desc: '塔防模式累计击败 1000 个敌人', cat: 'td', check: s => (s.stats.tdKills || 0) >= 1000, reward: { gold: 320 } },
    { id: 'td_core12', icon: '✸', name: '核心收藏家', desc: '单局拾取 12 个局内核心', cat: 'td', check: s => (s.stats.tdMaxCores || 0) >= 12, reward: { gold: 200 } },
    { id: 'td_coop4', icon: '⬟', name: '四人同心', desc: '四人联机完成一次塔防守卫', cat: 'td', check: s => (s.stats.tdCoopClears || 0) >= 1, reward: { gold: 450 } },
    { id: 'td_noleak10', icon: '◉', name: '滴水不漏', desc: '单局守住 10 波且零漏怪', cat: 'td', check: s => (s.stats.tdLeakBest != null && s.stats.tdLeakBest <= 0) && (s.stats.tdBestWave || 0) >= 10, reward: { gold: 260 } }
  ];
  const itemInfo = (id) => ITEMS[id] || MATERIALS[id];
  const entryName = (e) => itemInfo(e.id).name;

  // ===== 存档（金币 / 技能 / 专业 / 装备图样 / 背包 / 药水 / 成就 / 战绩）=====
  const SAVE_KEY = 'azs-clean-save';
  const SAVE_CODE_MAP = 'azs-save-codes';   // 昵称 → 存档码（本地记录，用于跨 origin 找回）
  const SAVE_TS_PREFIX = 'azs-save-ts@';    // 存档键 → 最近写入时间戳（用于本地/主机新旧比较）
  let saveKey = SAVE_KEY; // 当前存档的 localStorage 键
  let saveNamespace = ''; // #65 当前联机身份（昵称）
  let saveCode = '';      // #65 当前联机存档码
  let centerKey = '';     // #65 主机存档中心中的键
  let centerPushTimer = 0;
  // 第 5 项：首页预热时从主机存档中心取回的镜像（key → 存档数据），
  // 进入联机页时直接用它做本地合并，省掉一次网络往返的等待。
  const centerMirror = new Map();

  // #65 存档码：默认由昵称确定性派生（换设备/换隧道地址后仍能找回同一份档）；
  // 玩家也可在房间页手动填写自定义码以区分同名玩家或重置存档。
  // 注意：派生只依赖昵称本身，与调用时机/全局状态无关，保证任何设备算出同一个码。
  function deriveSaveCode(name) {
    let h = 2166136261;
    for (const ch of String(name || '')) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36).toUpperCase().padStart(6, '0').slice(0, 6);
  }
  function sanitizeProfileKey(k) { return String(k || '').replace(/[^\w\u4e00-\u9fa5#@.\-]/g, '').slice(0, 64); }
  function getCodeMap() { try { return JSON.parse(localStorage.getItem(SAVE_CODE_MAP) || '{}') || {}; } catch { return {}; } }
  function getSaveCode(name) { return getCodeMap()[name] || ''; }
  function setSaveCode(name, code) { const m = getCodeMap(); m[name] = code; try { localStorage.setItem(SAVE_CODE_MAP, JSON.stringify(m)); } catch { } }
  function defaultSave() {
    return {
      gold: 0,
      learned: { mage: ['arcane_missiles'], warrior: ['whirlwind'], hunter: ['double_shot'] },
      equipped: {
        mage: { basic: 'arcane_missiles', active: null, active2: null, active3: null, active4: null },
        warrior: { basic: 'whirlwind', active: null, active2: null, active3: null, active4: null },
        hunter: { basic: 'double_shot', active: null, active2: null, active3: null, active4: null }
      },
      // 第 18 项：专业默认已学习（熟练度 0）—— 只有图纸需要花金币研习
      professions: { tailoring: 0, leatherworking: 0, blacksmithing: 0 }, gearLearned: [], bag: [], potion: null, potions: [], potionLvl: {}, potionXp: {},
      achievements: [],
      stats: { runs: 0, totalKills: 0, totalGold: 0, maxTime: 0, maxKills: 0, crafted: 0, bosses: 0, epics: 0, orangeGear: 0, maxGear: 0, dungeonClears: {}, best: { mage: null, warrior: null, hunter: null },
        // 第 9 项：无尽模式专属统计（成就用）
        endlessRuns: 0, endlessKills: 0, endlessBossKills: 0, endlessMaxTime: 0, endlessMaxKills: 0,
        endlessBossSeen: [], endlessPotions: 0, endlessTotalTime: 0,
        // 熔火之心团本统计（成就用）
        raidKills: 0, moltenT1: 0, bestRoll: 0 }
    };
  }
  function loadSave(key = SAVE_KEY) {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(key) || 'null'); } catch { }
    return normalizeSave(raw);
  }
  // #65 从任意来源（本地 localStorage / 主机存档中心）解析存档，字段校验与清洗规则完全一致
  function normalizeSave(s) {
    const base = defaultSave();
    try {
      if (!s || typeof s !== 'object') return base;
      base.gold = Math.max(0, s.gold | 0);
      for (const cls of Object.keys(base.learned)) {
        if (Array.isArray(s.learned?.[cls])) {
          const validIds = new Set(SKILLS[cls].map(skill => skill.id));
          base.learned[cls] = [...new Set([...base.learned[cls], ...s.learned[cls]])].filter(id => validIds.has(id));
        }
        if (s.equipped?.[cls]) {
          const eq = s.equipped[cls];
          if (eq.basic && skillDef(cls, eq.basic)?.kind === 'basic' && base.learned[cls].includes(eq.basic)) base.equipped[cls].basic = eq.basic;
          // 第 20 项：主动技能 4 槽位 —— 逐槽校验，且同槽不可重复装备
          const used = new Set();
          for (const slot of ACTIVE_SLOTS) {
            const sid = eq[slot.key];
            if (!sid) continue;
            if (skillDef(cls, sid)?.kind !== 'active') continue;
            if (!base.learned[cls].includes(sid)) continue;
            if (used.has(sid)) continue;
            used.add(sid);
            base.equipped[cls][slot.key] = sid;
          }
        }
      }
      // 第 18 项：专业默认已学习 —— 旧存档里缺失的专业补 0（等价于「已解锁、熟练度 0」）；
      // 旧存档里 true → 100 的历史迁移保留。
      if (s.professions && typeof s.professions === 'object') for (const pid of Object.keys(PROFESSIONS)) {
        // #45 专业熟练度数值化（旧存档 true → 100）
        if (typeof s.professions[pid] === 'number') base.professions[pid] = Math.min(300, Math.max(0, s.professions[pid] | 0));
        else if (s.professions[pid] === true) base.professions[pid] = 100;
        else if (typeof s.professions[pid] !== 'number') base.professions[pid] = 0; // 第 18 项：缺失 → 默认已学习
      }
      // 旧版制造配方自动转换为对应图样（同 id 前缀的装备）
      const legacyMap = { cloth_robe1: 'mage_robe1', cloth_staff1: 'mage_staff1', cloth_robe2: 'mage_robe1', cloth_staff2: 'mage_staff1', arcane_robe: 'mage_heart', leather_armor1: 'hunter_leather1', short_bow: 'hunter_bow1', leather_armor2: 'hunter_leather1', long_bow: 'hunter_bow1', dragonscale: 'hunter_dragonbow', plate_armor1: 'warrior_plate1', heavy_sword: 'warrior_sword1', plate_armor2: 'warrior_plate1', great_sword: 'warrior_sword1', titan_bulwark: 'warrior_belt' };
      const gl = new Set(Array.isArray(s.gearLearned) ? s.gearLearned : []);
      if (Array.isArray(s.recipes)) for (const r of s.recipes) if (legacyMap[r]) gl.add(legacyMap[r]);
      // 旧版已装备的制造业装备转换为图样
      if (s.equipment) for (const eq of Object.values(s.equipment)) for (const v of Object.values(eq || {})) {
        const oid = typeof v === 'string' ? v : v?.id;
        if (legacyMap[oid]) gl.add(legacyMap[oid]);
      }
      base.gearLearned = [...gl].filter(g => GEAR[g]);
      if (Array.isArray(s.bag)) base.bag = s.bag.filter(e => e && itemInfo(e.id) && e.qty > 0).map(e => ({ id: e.id, qty: e.qty })).slice(0, 24);
      if (s.potion && ITEMS[s.potion]?.kind === 'potion') base.potion = s.potion;
      if (Array.isArray(s.potions)) base.potions = s.potions.filter(p => POTION_IDS.includes(p));
      // #44 药水等级与强化进度（重复获得转化）
      for (const id of base.potions) base.potionLvl[id] = 1;
      if (s.potionLvl && typeof s.potionLvl === 'object') for (const id of POTION_IDS) {
        if (typeof s.potionLvl[id] === 'number') base.potionLvl[id] = Math.min(5, Math.max(1, s.potionLvl[id] | 0));
      }
      if (s.potionXp && typeof s.potionXp === 'object') for (const id of POTION_IDS) {
        if (typeof s.potionXp[id] === 'number') base.potionXp[id] = Math.max(0, s.potionXp[id] | 0);
      }
      // 旧版消耗品转化为治疗药水解锁
      if (s.consumable && !base.potions.includes('pot_heal')) base.potions.push('pot_heal');
      if (Array.isArray(s.achievements)) base.achievements = s.achievements.filter(a => ACHIEVEMENTS.some(x => x.id === a));
      if (s.stats && typeof s.stats === 'object') {
        Object.assign(base.stats, s.stats);
        base.stats.dungeonClears = s.stats.dungeonClears && typeof s.stats.dungeonClears === 'object' ? s.stats.dungeonClears : {};
        base.stats.best = Object.assign({ mage: null, warrior: null, hunter: null }, s.stats.best);
        // 第 9 项：无尽模式统计字段清洗（旧档无这些字段 → 补默认值）
        for (const k of ['endlessRuns', 'endlessKills', 'endlessBossKills', 'endlessMaxTime', 'endlessMaxKills', 'endlessPotions', 'endlessTotalTime']) {
          if (typeof base.stats[k] !== 'number') base.stats[k] = 0;
        }
        base.stats.endlessBossSeen = Array.isArray(base.stats.endlessBossSeen) ? base.stats.endlessBossSeen.filter(x => typeof x === 'string') : [];
        // 熔火之心团本统计字段清洗（旧档无这些字段 → 补默认值）
        for (const k of ['raidKills', 'moltenT1', 'bestRoll']) {
          if (typeof base.stats[k] !== 'number') base.stats[k] = 0;
        }
      }
    } catch { }
    return base;
  }
  // #65 合并两份存档：取并集/较大值，保证「只能更好不能更差」
  // 场景：换 origin（隧道域名/端口变化）后本地档为空，或换设备后主机那份更新，
  // 直接以"较新者覆盖"会丢进度，因此这里做逐字段合并。
  function mergeSave(local, remote) {
    if (!remote) return local;
    if (!local) return remote;
    const out = local;
    out.gold = Math.max(out.gold | 0, remote.gold | 0);
    for (const cls of Object.keys(out.learned)) {
      out.learned[cls] = [...new Set([...(out.learned[cls] || []), ...(remote.learned?.[cls] || [])])];
      const le = out.equipped[cls], re = remote.equipped?.[cls] || {};
      // 装备槽：本地有值优先，否则取远端（远端可能是另一台设备上刚换的技能）
      // 第 20 项：主动技能 4 槽位（active / active2 / active3 / active4）
      for (const kind of ['basic', ...ACTIVE_SLOT_KEYS]) {
        if (!le[kind] && re[kind]) le[kind] = re[kind];
      }
      // 同一技能不能同时占用多个槽位
      const seenActive = new Set();
      for (const kind of ACTIVE_SLOT_KEYS) {
        const sid = le[kind];
        if (!sid) continue;
        if (seenActive.has(sid)) { le[kind] = null; continue; }
        seenActive.add(sid);
      }
    }
    for (const pid of Object.keys(out.professions)) {
      out.professions[pid] = Math.max(out.professions[pid] | 0, remote.professions?.[pid] | 0);
    }
    out.gearLearned = [...new Set([...(out.gearLearned || []), ...(remote.gearLearned || [])])];
    // 背包：按 id 取较大数量
    for (const e of remote.bag || []) {
      const slot = out.bag.find(x => x.id === e.id);
      if (slot) slot.qty = Math.max(slot.qty | 0, e.qty | 0);
      else if (out.bag.length < 24) out.bag.push({ id: e.id, qty: e.qty | 0 });
    }
    if (!out.potion && remote.potion) out.potion = remote.potion;
    out.potions = [...new Set([...(out.potions || []), ...(remote.potions || [])])];
    for (const id of Object.keys(out.potionLvl)) out.potionLvl[id] = Math.max(out.potionLvl[id] | 0, remote.potionLvl?.[id] | 0);
    for (const id of Object.keys(out.potionXp)) out.potionXp[id] = Math.max(out.potionXp[id] | 0, remote.potionXp?.[id] | 0);
    out.achievements = [...new Set([...(out.achievements || []), ...(remote.achievements || [])])];
    const rs = remote.stats || {};
    for (const k of ['runs', 'totalKills', 'totalGold', 'maxTime', 'maxKills', 'crafted', 'bosses', 'epics', 'orangeGear', 'maxGear',
      'endlessRuns', 'endlessKills', 'endlessBossKills', 'endlessMaxTime', 'endlessMaxKills', 'endlessPotions', 'endlessTotalTime',
      'raidKills', 'moltenT1', 'bestRoll']) {
      out.stats[k] = Math.max(out.stats[k] | 0, rs[k] | 0);
    }
    out.stats.endlessBossSeen = [...new Set([...(out.stats.endlessBossSeen || []), ...(rs.endlessBossSeen || [])])];
    for (const [did, n] of Object.entries(rs.dungeonClears || {})) {
      out.stats.dungeonClears[did] = Math.max(out.stats.dungeonClears[did] | 0, n | 0);
    }
    for (const hero of Object.keys(out.stats.best || {})) {
      const lb = out.stats.best[hero], rb = rs.best?.[hero];
      if (rb && (!lb || rb.time > lb.time || (rb.time === lb.time && rb.kills > lb.kills))) out.stats.best[hero] = rb;
    }
    return out;
  }
  // ===== #66 启动时恢复存档身份（修：刷新后金币/技能被重置）=====
  // 背景（实测复现）：带进度的档存在「azs-clean-save@昵称#存档码」这个 localStorage 键里，
  //   而页面启动时 saveKey 恒为默认键「azs-clean-save」→ save 载入的是空档。
  //   带进度的命名空间档只有在玩家点进「组队挑战」触发 setSaveNamespace 时才会被读出来，
  //   于是「刷新后先玩单机 / 先看背包」看到的全是初始值 —— 表现为进度被重置。
  // 修法：启动时用 azs-name（上次用过的昵称）+ 存档码把 saveKey 直接切到命名空间键，
  //   并把命名空间档与默认档合并（只增不减），保证单机与联机读写同一份档。
  function restoreSaveIdentity() {
    let name = '';
    try { name = (localStorage.getItem('azs-name') || '').trim(); } catch { }
    if (!name) return false;
    let code = '';
    try { code = (getSaveCode(name) || '').trim().toUpperCase(); } catch { }
    if (!code) code = deriveSaveCode(name);
    const key = `${SAVE_KEY}@${name}${code ? '#' + code : ''}`;
    let ns = null;
    try { ns = JSON.parse(localStorage.getItem(key) || 'null'); } catch { }
    const def = loadSave(SAVE_KEY);      // 默认档（单机时期的老进度）
    if (!ns) {
      // 命名空间档不存在，但默认档有内容 → 把默认档迁进命名空间键，之后统一走命名空间
      if (def && (def.gold > 0 || (def.learned && Object.values(def.learned).some(a => a && a.length > 1)))) {
        try { localStorage.setItem(key, JSON.stringify(def)); } catch { }
        try { localStorage.setItem(SAVE_TS_PREFIX + key, String(Date.now())); } catch { }
      }
      saveNamespace = name; saveCode = code; saveKey = key;
      return true;
    }
    // 命名空间档存在 → 与默认档合并（只增不减），两份进度都不丢
    const merged = mergeSave(normalizeSave(ns), def);
    save = merged;
    saveNamespace = name; saveCode = code; saveKey = key;
    try { localStorage.setItem(key, JSON.stringify(merged)); } catch { }
    try { localStorage.setItem(SAVE_TS_PREFIX + key, String(Date.now())); } catch { }
    return true;
  }

  let save = loadSave(saveKey);
  function persist() {
    try { localStorage.setItem(saveKey, JSON.stringify(save)); } catch { }
    try { localStorage.setItem(SAVE_TS_PREFIX + saveKey, String(Date.now())); } catch { }
    scheduleCenterPush(); // #65 结算收益等变更同步到主机存档中心
  }
  restoreSaveIdentity(); // #66 刷新后先恢复身份与命名空间档，避免进度显示为初始值
  persist(); // 立即写回规范化结果，清除旧档中混入的跨职业技能

  // ===== #65 联机存档：本地优先 + 主机存档中心镜像 =====
  // 背景：localStorage 按 origin 隔离，玩家经隧道访问主机时域名/端口可能变化，
  // 原「昵称命名空间」档取不到 → 表现为每次访问主机链接都是新存档。
  // 方案：本地 localStorage 仍是权威档（离线可用），同时在主机侧留一份以「昵称#存档码」
  // 为键的镜像；换 origin / 换设备后凭存档码取回，结算收益再回写本地与主机。
  function scheduleCenterPush(delay = 800) {
    if (!centerKey || typeof NET === 'undefined' || !NET.connected) return;
    clearTimeout(centerPushTimer);
    centerPushTimer = setTimeout(() => {
      centerPushTimer = 0;
      NET.savePut(centerKey, save).catch(() => { });
    }, delay);
  }
  async function pushCenterNow() {
    if (!centerKey || typeof NET === 'undefined' || !NET.connected) return;
    clearTimeout(centerPushTimer); centerPushTimer = 0;
    try { await NET.savePut(centerKey, save); } catch { }
  }
  // 切换联机身份：本地命名空间 + 主机存档中心双向合并（取并集/较大值）
  async function setSaveNamespace(name, code) {
    const ns = name || '';
    const c = (code || '').trim().toUpperCase();
    saveNamespace = ns;
    saveCode = c;
    const key = ns ? `${SAVE_KEY}@${ns}${c ? '#' + c : ''}` : SAVE_KEY;
    centerKey = ns ? sanitizeProfileKey(`${ns}#${c || 'DEFAULT'}`) : '';
    if (key !== saveKey) {
      // #52 该昵称命名空间还没有本地档 → 以本机当前存档为种子（首次联机时把单机进度带进去）
      if (ns && !localStorage.getItem(key)) {
        try { localStorage.setItem(key, JSON.stringify(save)); } catch { }
        try { localStorage.setItem(SAVE_TS_PREFIX + key, String(Date.now())); } catch { }
      }
      // #65 迁移旧版「昵称命名空间」档（无存档码）→ 新键，避免升级后旧进度看起来消失
      const legacyKey = `${SAVE_KEY}@${ns}`;
      if (ns && legacyKey !== key && localStorage.getItem(legacyKey)) {
        try {
          const legacy = JSON.parse(localStorage.getItem(legacyKey) || 'null');
          if (legacy) { // 与新档合并（只增不减）
            const merged = mergeSave(normalizeSave(legacy), loadSave(key));
            localStorage.setItem(key, JSON.stringify(merged));
          }
        } catch { }
      }
      // ★ #66 切换命名空间时不能直接 loadSave 覆盖当前档 ——
      //   当前档里可能有「还没同步到主机」的新进度（金币/技能），直接覆盖会丢。
      //   改成与目标命名空间档合并（只增不减），两份进度都保住。
      const target = loadSave(key);
      save = mergeSave(target, save);
      saveKey = key;
      try { localStorage.setItem(key, JSON.stringify(save)); } catch { }
      try { localStorage.setItem(SAVE_TS_PREFIX + key, String(Date.now())); } catch { }
      updateBest(); // 首页/菜单战绩展示刷新
    }
    if (ns) await syncFromCenter();
  }
  // 与主机存档中心同步：双向合并（本地 + 主机），保证进度只增不减
  async function syncFromCenter() {
    if (!centerKey || typeof NET === 'undefined' || !NET.connected) return;
    let res = null;
    // 第 5 项：首页预热已取回同一键的镜像 → 直接用它合并，无需等待网络往返
    const mirror = centerMirror.get(centerKey);
    if (mirror) {
      centerMirror.delete(centerKey);
      res = { found: true, data: mirror, updatedAt: 0 };
    } else {
      try { res = await NET.saveGet(centerKey); } catch { }
    }
    if (!res) return;
    const localTs = Number(localStorage.getItem(SAVE_TS_PREFIX + saveKey) || 0);
    if (res.found && res.data) {
      const merged = mergeSave(normalizeSave(res.data), save);
      const changed = JSON.stringify(merged) !== JSON.stringify(save);
      save = merged;
      try { localStorage.setItem(saveKey, JSON.stringify(save)); } catch { }
      const ts = Math.max(localTs, res.updatedAt || 0);
      try { localStorage.setItem(SAVE_TS_PREFIX + saveKey, String(ts)); } catch { }
      updateBest();
      if (changed) {
        // 合并结果与主机不一致 → 回写主机（以合并后的完整档为准）
        await pushCenterNow();
        toast('已从主机恢复你的存档进度');
      }
    } else {
      // 主机没有这份档（首次联机）→ 用本地档建立镜像，之后结算收益都能存回来
      await pushCenterNow();
    }
  }

  const ui = {};
  ['home','menu','hud','levelup','pause-screen','result','backpack','trainer','profession','heroes','start','best','home-best','portrait','hero-name','level','hp-bar','hp-text','xp-bar','time','kills','gold','pause','boss-wrap','boss-name','boss-bar','attack-name','dash-text','dash-cooldown','announcement','upgrade-cards','resume','restart-pause','quit','result-icon','result-label','result-title','result-subtitle','result-time','result-kills','result-level','result-gold','result-loot','retry','result-menu','joystick','mobile-dash','mobile-active','mobile-active2','mobile-active3','mobile-active4','nav-adventure','nav-trainer','nav-profession','bag-toggle','bag-gold','bag-grid','bag-gold-total','bag-close','trainer-tabs','trainer-gold','equip-basic','equip-active','equip-active2','equip-active3','equip-active4','skill-list','trainer-back','menu-home','active-ability','active-icon','active-name','active-text','active-cooldown','active-ability2','active-icon2','active-name2','active-text2','active-cooldown2','active-ability3','active-icon3','active-name3','active-text3','active-cooldown3','active-ability4','active-icon4','active-name4','active-text4','active-cooldown4','toast','prof-gold','prof-list','prof-back','char-tabs','char-name','char-stats','eq-potion','achv-list','item-menu','achv-toggle','achievements','achv-grid','achv-back','achv-progress','gearpick','gear-cards','pot-ability','pot-icon','pot-name','pot-text','pot-cooldown','mobile-pot','nav-dungeons','nav-td','dungeons','dungeon-list','dungeons-back','dungeon-reward','reward-cards','achv-tabs','basic-icon','pot-list','gear-detail','gd-body','gd-close','levelup-live','levelup-pause-hint','gearpick-live','gearpick-title','gearpick-desc','gear-slots','gear-slots-label','gear-slot-cards','gr-discard','gear-bar','stats-hud','party-panel','mode-choice','mc-back','mc-title','mc-solo','mc-multi','rooms','rooms-back','rooms-hint','player-name','player-code','room-create','room-refresh','room-list','lobby','lobby-back','lobby-mode','lobby-name','lobby-slots','lobby-heroes','lobby-ready','lobby-start','revive-ability','revive-icon','revive-name','revive-text','revive-cooldown','revive-progress','mobile-revive','dg-tabs','raid-loot','raid-items','raid-stat','raid-chat-log','raid-chat-input','raid-chat-send','raid-close','td-core'].forEach(id => ui[id] = $(id));

  let width = innerWidth, height = innerHeight, dpr = 1;
  let selectedHero = 'mage';
  let trainerClass = 'mage';
  let bagClass = 'mage';
  let pendingDungeon = null; // null = 冒险（无尽）模式
  let pendingMode = null;   // 'td' = 塔防模式；null = 常规（无尽/副本）
  let dungeonTab = 'dungeon'; // 副本页 Tab：dungeon（地下城副本） / raid（团队副本）
  let achvFilter = 'all';
  let mcOrigin = 'home'; // 模式选择页的返回去向
  let myLobbyHero = null; // 大厅中选择的职业
  let mode = 'loading';   // 资源加载完成前玩家可能已自行点「开始远征」，故初始不直接进首页
  let forceMoltenPick = false; // 验收用：强制在装备卡浮层刷出熔火之心专属强化卡
  let last = performance.now();
  let game = null;
  let announcementTimer = 0;
  let toastTimer = 0;
  const keys = new Set();
  const joy = { active: false, id: null, x: 0, y: 0 };
  // ===== 移动端跟随摇杆（mobile.js）=====
  // 移动端的"按到哪里哪里就是摇杆"由独立文件 mobile.js 实现（与塔防模式零耦合）。
  // 它每帧把归一化方向写进 window.__mobileHook.dir，这里在 update() 里并入移动量。
  const mobileDir = () => (window.__mobileHook && window.__mobileHook.dir) || { x: 0, y: 0 };
  // 触觉反馈（移动端）：转发给 mobile.js 的震动表，iOS 无 vibrate 时静默降级。
  // 桌面端调用它没有任何开销（mobile.js 内部按 haptic 开关判断）。
  const haptic = (kind) => { try { window.__mobileHook && window.__mobileHook.buzz(kind); } catch { } };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const formatTime = (s) => `${String(Math.floor(s / 60)).padStart(2,'0')}:${String(Math.floor(s % 60)).padStart(2,'0')}`;
  const hash = (x, y) => { const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return n - Math.floor(n); };

  function resize() {
    width = innerWidth; height = innerHeight;
    // ★ 移动端降级：dpr 上限按设备档位分级（移动端体验优化 §3.6）
    //   高 2 / 中 1.5 / 低 1.25（低端安卓）—— 不砍任何数值，只砍表现层。
    //   档位判定统一读 fx.js 的 window.__perfTier，保证 dpr / 粒子 / shake 三处同源。
    const dprCap = (window.__perfTier && window.__perfTier.dpr()) || (tdIsMobile() ? 1.5 : 2);
    dpr = Math.min(devicePixelRatio || 1, dprCap);
    canvas.width = Math.floor(width * dpr); canvas.height = Math.floor(height * dpr);
    canvas.style.width = width + 'px'; canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  /** 是否移动端（窄屏或触屏）—— 用于性能降级与布局分支 */
  function tdIsMobile() {
    return (innerWidth <= 820) || (navigator.maxTouchPoints > 0 && innerWidth <= 1024);
  }
  addEventListener('resize', resize); resize();

  function toast(text) {
    ui.toast.textContent = text; ui.toast.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 1800);
  }

  function freshPlayer(type) {
    const h = heroes[type];
    const eq = save.equipped[type];
    return { type, x: 0, y: 0, r: 17, hp: h.hp, maxHp: h.hp, damage: h.damage, speed: h.speed,
      rate: h.rate, range: h.range, armor: h.armor, attackTimer: .2, level: 1, xp: 0, nextXp: 30,
      kills: 0, gold: 0, dashCd: 0, dashMax: 4, dashTime: 0, invuln: 0, dirX: 1, dirY: 0,
      magnet: 150, multishot: 0, pierce: type === 'mage' ? 1 : 0, crit: .08, regen: 0,
      area: 1, projectileSpeed: 1, moveX: 0, moveY: 0, upgrades: {},
      skillBasic: eq.basic, skillActive: eq.active, skillActive2: eq.active2, skillActive3: eq.active3, skillActive4: eq.active4,
      mods: {}, activeCd: 0, activeMax: 0, activeCd2: 0, activeMax2: 0, activeCd3: 0, activeMax3: 0, activeCd4: 0, activeMax4: 0,
      furyT: 0, revenge: false, wallT: 0, bladeStormT: 0, stormTick: 0, rapidT: 0,
      atkAnim: 0, castAnim: 0,
      barrierHp: 0, barrierT: 0, potCd: 0,
      surge: 0, dmgReduce: 0, critDmg: 1.8, gearFx: {},
      potDmgT: 0, potLeechT: 0, potMutT: 0, potArmorT: 0, potReduceT: 0, potHotT: 0, potRevengeT: 0,
      // #50 新主动技能状态
      // veinsActive：冰冷血脉「处于激活态」的独立标志（与 veinsT 分离）。
      //   原因：原先用 veinsWas（veinsT 的滞后副本）检测「血脉结束」边沿，
      //   但 veinsWas 要等下一帧 update 才会被刷新；若 veinsT 在同一帧内归零
      //   （施放后立刻结束 / 外部改写计时），边沿会被永久丢失 → 极寒爆发不触发。
      veinsT: 0, veinsWas: 0, veinsActive: false, brT: 0, aspectT: 0, brUsed: false, dsArmorT: 0, chHasteT: 0, chShieldT: 0,
      msMomT: 0, mshStormT: 0, abRecoilT: 0, abStacks: 0, chargeT: 0, chargeDirX: 1, chargeDirY: 0,
      chargeW: 60, chargeDmg: 1, chargeStun: 1, chargeSlot: 1, chargeHits: null, kcFocusT: 0,
      // 第 11 项：战复技能（读条 / 冷却 / 目标队友 id / 等待主机确认）
      reviveT: 0, reviveCd: 0, reviveTarget: null, revivePending: 0 };
  }

  function newGame() {
    FX.clear();
    game = { player: freshPlayer(selectedHero), enemies: [], projectiles: [], enemyShots: [], gems: [],
      orbs: [], zones: [], pets: [], meteors: [], traps: [], particles: [], texts: [], effects: [], allyFx: [], spineFx: [], elapsed: 0, spawnTimer: .4, bossIndex: 0,
      pendingLevels: 0, shake: 0, flash: 0, totalDamage: 0, startedAt: Date.now(), loot: {}, bossKills: 0,
      // ★ 帧计数：用于低档设备的 Spine 骨骼降帧（每 2 帧推进一次动画）
      frame: 0,
      gear: [], gearDrops: 0, bossAliveT: 0, _gearSig: null, _statsAt: 0,
      // 装备栏已满时的两阶段选择：阶段一选中待带入的新装备（gearPending），阶段二指定替换目标
      gearPending: null,
      // ★ 塔防局内核心（TD 版的「装备」）：只在本局生效，不入存档
      tdCores: [], tdCoreDrops: 0, tdCoreOpen: false,
      // 熔火之心团本：地板延时预警（敌方技能红色区域，由淡转明后触发伤害）
      telegraphs: [],
      gameMode: pendingMode === 'td' ? 'td' : (pendingDungeon ? 'dungeon' : 'adventure'),
      dungeon: pendingDungeon ? DUNGEONS[pendingDungeon] : null, dungeonId: pendingDungeon || null };
    // #51 联机会话初始化（房间已开始 → 本局为联机局）
    const room = (typeof NET !== 'undefined' && NET.connected) ? NET.room : null;
    if (room && room.started) {
      const n = room.players.length;
      game.coop = { host: NET.isHost(), n };
      game.playerCount = n;
      game.allies = new Map();
      for (const pl of room.players) if (pl.id !== NET.myId)
        game.allies.set(pl.id, { id: pl.id, name: pl.name, hero: pl.hero, x: 70, y: 0, dirX: 1, dirY: 0, hp: 100, maxHp: 100, cast: 0, dead: false });
    }
    mode = 'playing';
    if (game.raidTimer) { clearInterval(game.raidTimer); game.raidTimer = null; }
    game.raidLoot = null;
    for (const id of ['home','menu','result','pause-screen','levelup','backpack','trainer','profession','achievements','gearpick','gear-detail','dungeons','dungeon-reward','mode-choice','rooms','lobby','raid-loot']) { ui[id].classList.add('hidden'); ui[id].classList.remove('active'); }
    ui.hud.classList.remove('hidden');
    const h = heroes[selectedHero];
    const p = game.player;
    ui.portrait.innerHTML = heroIconHtml(selectedHero, 42); ui.portrait.style.color = h.color;
    ui['hero-name'].textContent = h.name;
    ui['attack-name'].textContent = skillDef(p.type, p.skillBasic)?.name || '攻击';
    ui['basic-icon'].innerHTML = skillIconHtml(p.skillBasic, h.color, 30);
    ui['boss-wrap'].classList.add('hidden');
    announce(game.dungeon ? `进入冒险 · ${game.dungeon.name}` : '无尽模式 · 无尽围攻', '#ffe0a0', 2);
    if (game.coop) announce(`组队挑战 · ${game.coop.n} 名英雄 · 敌人强度提升`, '#9fd3ff', 3); // #51 主机侧自动广播给全员
    AUDIO.start(pendingDungeon || 'adventure'); // 程序化环境音乐（按副本主题）
    if (game.gameMode === 'td') tdInit();   // ★ 塔防模式初始化（阵位 / 路 / HUD）
    syncBeastKing(p); // 需求 12：携带「兽王」即永久召唤幽灵狼（开局按技能与卡牌重建兽群）
    updateHUD();
  }

  // ===== 需求 12：兽王 —— 携带即永久召唤幽灵狼 =====
  // 数量 = 基础 2 只 + 「兽群增殖」卡牌等级（不设上限）；
  // 主动技能「兽王」释放的威压 buff 在此重建时清空（由 castActive 重新施加）。
  function beastKingCount(p) {
    return 2 + (p?.mods?.pet_count || 0);
  }
  function syncBeastKing(p) {
    if (!game || !p) return;
    const has = ACTIVE_SLOTS.some(sl => p[sl.skill] === 'call_pet');
    // 先移除旧兽群（保留镜影与影分身）
    if (game.pets) game.pets = game.pets.filter(pt => pt.mirror || pt.shadow);
    if (!has) return;
    const n = beastKingCount(p);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      game.pets.push({
        x: p.x + Math.cos(a) * 46, y: p.y + Math.sin(a) * 46, life: Infinity, atkCd: .2,
        atkRate: .6 * (1 - .18 * (p.mods.pet_speed || 0)) * (p.mods.pack_leader ? .83 : 1),
        // 第 19 项：兽王幽灵狼伤害系数 .62 → .8
        dmg: p.damage * .8 * (1 + .35 * (p.mods.pet_power || 0)) * (1 + (p.gearFx.petBonus || 0)),
        range: 460 + 120 * (p.mods.pet_range || 0), phase: rand(0, TAU), beast: true,
        bleed: p.mods.pet_bleed || 0, auraT: 0, auraDmg: 0, auraRate: 0, auraLeap: 0
      });
    }
  }
  // 需求 12：兽群数量/面板随卡牌动态生效 —— 选中「兽群增殖」等卡牌后立即重建兽群
  function refreshBeastKing() {
    const p = game?.player;
    if (!p) return;
    const has = ACTIVE_SLOTS.some(sl => p[sl.skill] === 'call_pet');
    if (!has) return;
    const cur = game.pets.filter(pt => pt.beast).length;
    if (cur !== beastKingCount(p)) syncBeastKing(p);
    else for (const pt of game.pets) {
      if (!pt.beast) continue;
      pt.atkRate = .6 * (1 - .18 * (p.mods.pet_speed || 0)) * (p.mods.pack_leader ? .83 : 1);
      pt.dmg = p.damage * .8 * (1 + .35 * (p.mods.pet_power || 0)) * (1 + (p.gearFx.petBonus || 0));
      pt.range = 460 + 120 * (p.mods.pet_range || 0);
      pt.bleed = p.mods.pet_bleed || 0;
    }
  }

  function hideAll() {
    ui.hud.classList.add('hidden');
    if (typeof TDR !== 'undefined') tdTeardown();   // ★ 塔防 HUD 随页面一起收起
    for (const id of ['home','menu','levelup','pause-screen','result','backpack','trainer','profession','achievements','gearpick','gear-detail','dungeons','dungeon-reward','mode-choice','rooms','lobby','raid-loot','td-core']) { ui[id].classList.add('hidden'); ui[id].classList.remove('active'); } // #53 补上联机三页，否则返回时旧页残留遮挡；#60 补 gear-detail，否则装备详情弹层会永久全屏盖住 HUD；★ 补 td-core（已移出 #hud，必须单独收起）
  }
  function showScreen(id) { ui[id].classList.remove('hidden'); ui[id].classList.add('active'); }

  function showHome() {
    if (typeof NET !== 'undefined' && NET.connected && NET.room) NET.leaveRoom(); // #51 回主界面自动退房间
    mode = 'home'; game = null; keys.clear(); FX.clear();
    pendingMode = null; pendingDungeon = null;   // ★ 离开页面时清掉待开始模式
    hideAll(); showScreen('home');
    ui['bag-gold'].textContent = save.gold;
    updateBest();
    warmupHome(); // 第 5 项：进入首页即后台预热单机/联机数据
  }

  // ===== 第 5 项：首页预热 =====
  // 背景：玩家访问主机链接后，点「进入单机/联机」时才同步加载数据（存档同步、场景贴图、
  //       Spine 骨骼实例化、音频上下文、图标 PNG），期间主线程被占住表现为"卡住不动"。
  // 方案：把加载提前到首页空闲时完成，进入游戏时直接用已就绪的数据。
  const warmup = { assets: false, net: false };
  function warmupHome() {
    if (!warmup.assets) {
      warmup.assets = true;
      // 让出一帧再开始，避免拖慢首页首次绘制
      requestAnimationFrame(() => setTimeout(() => {
        try {
          // ① 单机侧：音频上下文 + Spine 骨骼实例化（重骨骼首领的离屏帧缓存首建最耗时）
          if (typeof AUDIO !== 'undefined' && AUDIO.warmup) AUDIO.warmup();
          if (typeof SPINE !== 'undefined' && SPINE.warmup) SPINE.warmup();
        } catch { }
        // ② 单机侧：副本缩略图与图标 PNG —— 浏览器解码后进副本/训练师页不再卡顿
        // DUNGEONS 是字典结构（键为副本 id），需用 Object.values 取值，否则 .map 会抛错被 catch 吞掉。
        try { ASSETS.preloadImages(Object.values(DUNGEONS).map(d => d && d.img).filter(Boolean)); } catch { }
        try { ASSETS.preloadIcons(iconKeysForWarmup()); } catch { }
        warmupNet();
      }, 0));
    } else if (!warmup.net) {
      warmupNet(); // 上次预热时主机不可达 → 回首页后再试一次
    }
  }
  // 需要预热的图标：首页/副本/训练师/职业/背包/成就等页面首屏会用到的
  function iconKeysForWarmup() {
    const keys = ['hero_mage', 'hero_warrior', 'hero_hunter', 'nav_adventure', 'nav_dungeons',
      'nav_trainer', 'nav_profession', 'nav_achievements', 'nav_bag', 'nav_multi'];
    for (const id of Object.keys(DUNGEONS)) keys.push('dungeon_' + id);
    for (const id of Object.keys(PROFESSIONS)) keys.push('prof_' + id);
    for (const id of Object.keys(ACHIEVEMENTS)) keys.push('achv_' + id);
    return keys;
  }
  async function warmupNet() {
    if (typeof NET === 'undefined' || !NET.supported || NET.connected) { warmup.net = true; return; }
    // 用上次使用过的昵称预连接（不设命名空间，避免污染当前存档键）
    let name = '';
    try { name = localStorage.getItem('azs-name') || ''; } catch { }
    if (!name) { warmup.net = true; return; } // 从未联机过 → 没有可预取的存档镜像，等玩家进联机页再连
    try {
      await NET.connect(name);
      // 预取该昵称在主机存档中心的镜像
      const code = (getSaveCode(name) || '').trim().toUpperCase() || deriveSaveCode(name);
      const key = sanitizeProfileKey(`${name}#${code || 'DEFAULT'}`);
      const res = await NET.saveGet(key);
      if (res && res.found && res.data) {
        centerMirror.set(key, res.data);
        // ★ #66 启动预取时就把主机镜像合并进本地档 ——
        //   否则「换设备/换浏览器」场景下，本地没有档时首页会显示初始值，
        //   玩家要先进联机页才能看到自己真正的进度，表现为「刷新后被重置」。
        //   合并是只增不减的，主机没有的本地进度同样保留。
        if (saveNamespace === name) {
          const merged = mergeSave(normalizeSave(res.data), save);
          const changed = JSON.stringify(merged) !== JSON.stringify(save);
          save = merged;
          try { localStorage.setItem(saveKey, JSON.stringify(merged)); } catch { }
          try { localStorage.setItem(SAVE_TS_PREFIX + saveKey, String(Date.now())); } catch { }
          if (changed) { updateBest(); pushCenterNow(); }
        }
      }
    } catch { /* 预热失败不影响正常流程 */ }
    warmup.net = true;
  }

  function showMenu() {
    mode = 'menu'; game = null; keys.clear(); FX.clear();
    hideAll(); showScreen('menu');
    updateBest();
  }

  // ===== #51 局域网联机：模式选择 → 房间列表 → 房间大厅 =====
  // ==========================================================================
  // ===== 塔防模式（gameMode = 'td'）运行时 =====
  // ==========================================================================
  // 玩法契约（详见 coop-roguelite-design/塔防模式-*.md）：
  //   ① 英雄无敌 —— 不走 hurtPlayer，任何伤害直接忽略
  //   ② 英雄不能自由移动 —— 只能在 20 个「传送阵」节点间瞬移
  //   ③ 怪物沿固定 4 条路径行进，不攻击英雄，抵达心脏即计漏怪
  //   ④ 主动技能全自动 —— 选目标的哲学由「战术指令」决定（塔防版的操作）
  //   ⑤ 选卡不暂停 —— 复用现有 live 分支（pendingLevels / gearDrops 本来就有队列）
  //   ⑥ 怪物不释放伤害技能
  //   ⑦ 1 人局只激活下方两条路（用户拍板）；漏怪容差按激活路数缩放
  const TDR = {
    on: false,
    wave: 0, waveT: 0, waveLen: TD.WAVES.waveSeconds,
    queue: [],               // 待出怪队列 [{ lane, kind, elite, boss }]
    spawnAcc: 0, spawnInterval: 1,
    leaks: 0, leakLimit: 30,
    // ★ 尾王（BOSS#3）状态：pending → killed / leaked。只有 killed 才算通关
    finalBossState: 'none', pendingFinal: false,
    lanes: [], laneOwner: {},
    node: null,              // 当前阵位节点
    tpCd: 0, tpCdMax: TD.MAP.tpCd, rootLock: 0,
    // ★ 修正项统一走「基础值 + 乘算系数」，保证 recomputePlayer 重放卡牌时幂等
    reachBase: TD.MAP.reach, reachMul: 1, crossReach: 0,
    cmd: 'focus', dualCmd: false, focusDeep: false,
    guards: [],              // 守卫（绑定阵位，玩家传送时留在原阵）
    allyGuards: [],         // ★ 联机：队友的守卫（只读渲染，不参与本地伤害结算）
    guardPending: null,     // 守卫放置模式：{ kind, count, t, name }（抽到守卫卡后进入）
    cdScale: 1, threshold: 1, doubleCast: 0,
    xpBonus: 0, goldBonus: 0,
    burnOnHit: 0, chainKill: 0, burstStack: 0, executeTh: 0, armorPierce: 0,
    extraCast: 8, castCounter: 0,
    guardArmor: 0, guardMax: 6, aidBonus: .05, beacon: false, guardPact: 0,
    rescueCd: 12, rally: false, rallyT: 0, soulLink: false,
    viewPad: null,           // 联机：正在观看的队友阵位（null = 自己）
    camOff: { x: 0, y: 0 },  // 拖动平移的镜头偏移
    camFree: 0,              // >0 表示「脱离跟随」的剩余秒数
    drag: null,              // 触屏拖动状态
    coverN: 0, coverLo: 0, coverHi: 0, coverLane: null,
    replaying: false,        // recomputePlayer 重放卡牌期间为 true（抑制一次性效果）
    pendingDouble: null, lastPick: null
  };

  // ---------- TD 专属 HUD 元素（不进 ui 批量表，独立取一次）----------
  const TDu = {
    top: $('td-top'), heartFill: $('td-heart-fill'), heartText: $('td-heart-text'),
    waveFill: $('td-wave-fill'), waveText: $('td-wave-text'),
    leak: $('td-leak'), leakText: $('td-leak-text'),
    cmds: $('td-commands'), padState: $('td-pad-state'),
    heroLabel: $('td-hero-label'), padLabel: $('td-pad-label'), coverLabel: $('td-cover-label'),
    minimap: $('td-minimap'), minimapCv: $('td-minimap-canvas'),
    core: $('td-core'), coreCards: $('td-core-cards'), coreTitle: $('td-core-title'), coreSlots: $('td-core-slots'),
    cmdBtns: {}
  };
  for (const el of document.querySelectorAll('.td-cmd')) TDu.cmdBtns[el.dataset.cmd] = el;

  // ---------- 基础工具 ----------
  const TD_ARCS = new Map();
  function tdArc(laneId) {
    let a = TD_ARCS.get(laneId);
    if (!a) { a = TD.buildArc(TD.LANE_BY_ID.get(laneId).pts); TD_ARCS.set(laneId, a); }
    return a;
  }
  function tdMyIndex() {
    const room = (typeof NET !== 'undefined' && NET.connected) ? NET.room : null;
    if (room && room.players) {
      const i = room.players.findIndex(pl => pl.id === NET.myId);
      if (i >= 0) return i;
    }
    return 0;
  }
  function tdIsTd() { return !!(game && game.gameMode === 'td'); }
  /** 当前阵位的有效覆盖半径（码） */
  function tdReach() { return TDR.reachBase * TDR.reachMul + TDR.crossReach; }

  /** 按方向把节点的邻接拆成 上/下/左/右（同向取最近的一个） */
  function tdNeighbors(node) {
    const groups = { up: [], down: [], left: [], right: [] };
    for (const id of node.links) {
      const n = TD.NODE_BY_ID.get(id);
      if (!n) continue;
      const dx = n.x - node.x, dy = n.y - node.y;
      const d = Math.hypot(dx, dy) || 1;
      const nx = dx / d, ny = dy / d;
      let key;
      if (Math.abs(nx) >= Math.abs(ny)) key = nx > 0 ? 'right' : 'left';
      else key = ny > 0 ? 'down' : 'up';
      groups[key].push({ n, d });
    }
    const out = {};
    for (const k of ['up', 'down', 'left', 'right']) {
      groups[k].sort((a, b) => a.d - b.d);
      out[k] = groups[k].length ? groups[k][0].n : null;
    }
    return out;
  }

  // ---------- 修正项：重置 / 施放卡牌 ----------
  /** 把所有「卡牌带来的修正」归零。recomputePlayer 时先调它再重放卡牌，保证幂等。 */
  function tdResetModifiers() {
    TDR.reachBase = TD.MAP.reach; TDR.reachMul = 1; TDR.crossReach = 0;
    TDR.cdScale = 1; TDR.threshold = 1; TDR.doubleCast = 0;
    TDR.xpBonus = 0; TDR.goldBonus = 0;
    TDR.burnOnHit = 0; TDR.chainKill = 0; TDR.burstStack = 0; TDR.executeTh = 0;
    TDR.armorPierce = 0; TDR.extraCast = 8;
    TDR.guardArmor = 0; TDR.guardMax = 6; TDR.aidBonus = .05; TDR.guardPact = 0;
    TDR.dualCmd = false; TDR.focusDeep = false;
    TDR.beacon = false; TDR.rally = false; TDR.soulLink = false;
    TDR.tpCdMax = TD.MAP.tpCd; TDR.rootLock = 0;
    TDR.rescueCd = 12;                       // 「战场援助」卡会 *= .6 → 必须归零，否则重放时叠加
  }

  /** 施放一张升级卡（TD 语义）。通用卡在塔防下被改写，TD 专属卡改 TDR。 */
  function tdApplyCard(u, p) {
    if (!u || !u.apply) return;
    // ★ td.js 的卡牌通过 ctx.td 调 TDR 上的能力（spawnGuard / setCommand 等），
    //   这里注入委托，保证卡牌定义与运行时状态解耦。
    u.apply(p, { td: TDR, game });
  }

  /** TD 模式的升级池 = 通用卡（塔防语义改写）+ TD 专属卡 + 技能专属卡 */
  function tdUpgradePool() {
    const p = game.player;
    const list = [];
    for (const u of upgradePool) {
      const ov = TD.TD_GENERIC_OVERRIDE[u.id];
      list.push(ov ? { ...u, name: ov.name || u.name, desc: ov.desc || u.desc, apply: ov.apply || u.apply } : u);
    }
    list.push(...TD.TD_UPGRADE_POOL);
    // 技能专属卡沿用现有逻辑（对所有模式通用）
    for (const s of SKILLS[p.type]) {
      if (s.id !== p.skillBasic && !ACTIVE_SLOTS.some(sl => p[sl.skill] === s.id)) continue;
      for (const m of (s.mods || [])) {
        const lvl = p.mods[m.id] || 0;
        if (lvl >= (m.max || 1)) continue;
        list.push({ id: `mod_${m.id}`, icon: s.icon, svg: s.id, name: `${s.name} · ${m.name}`, type: '技能强化', cls: p.type,
          desc: m.desc, skillLevel: lvl + 1, rar: m.rar ?? ((m.req || m.reqSkill) ? 3 : 2),
          available: pl => pl.type === p.type && (m.req || []).every(r => pl.mods[r]) && (!m.reqSkill || pl.skillBasic === m.reqSkill || ACTIVE_SLOTS.some(sl => pl[sl.skill] === m.reqSkill)),
          apply: pl => { if (pl.type === p.type) pl.mods[m.id] = (pl.mods[m.id] || 0) + 1; } });
      }
    }
    return list;
  }

  // ---------- 局内核心（TD 版的「装备卡」）----------
  // ★ 设计取舍（用户口径的矛盾点）：
  //   「装备卡在杀怪过程中弹出、不暂停」＋「塔防不产装备」看似互斥。
  //   本实现产出的是**局内核心**：和装备卡一样在击杀时三选一弹出、一样不暂停，
  //   但效果只在本局生效，**绝不写 save.gearLearned / save.bag**。
  //   塔防的持久产出改由成就系统给金币（见 ACHIEVEMENTS 里 cat:'td' 的那组）。

  /** 已获得的核心：[{ id, lvl }]，只存在于本局 */
  function tdCores() { return (game && game.tdCores) || []; }

  function tdCoreOwned(id) {
    const c = tdCores().find(x => x.id === id);
    return c ? c.lvl : 0;
  }

  /**
   * 打开核心三选一。
   * ★ 不暂停：mode 保持 'playing'（与强化卡 / 装备卡的 live 逻辑一致）。
   * ★ 返回值：true = 本次掉落已被处理（弹出了核心卡，或已折算成金币）；
   *   false = 本次**没有**处理（弹层正忙 / 玩家倒地 / DOM 缺失）→ 调用方不要吞掉这次掉落。
   */
  function openTdCorePick() {
    const p = game.player;
    if (!p || p.downed) return false;
    if (!TDu.core || !TDu.coreCards) return false;
    if (game.levelupOpen || game.gearPickOpen || game.tdCoreOpen) return false;   // 不与强化卡 / 装备卡重入
    // 候选：未满级的核心（已满级的排除）
    const pool = TD.TD_CORE_POOL.filter(c => tdCoreOwned(c.id) < (c.max || 1));
    if (!pool.length) { p.gold += 15; announce('核心已全部满级 · 折算 +15 金币', '#ffe094', 1.4); return true; }
    // 按稀有度加权抽取（rar 越高越少见）
    const picks = [];
    const bag = [];
    for (const c of pool) { const w = c.rar === 0 ? 10 : c.rar === 1 ? 6 : c.rar === 2 ? 3 : 1; for (let i = 0; i < w; i++) bag.push(c); }
    while (picks.length < 3 && bag.length) {
      const c = bag.splice(Math.floor(Math.random() * bag.length), 1)[0];
      if (!picks.some(x => x.id === c.id)) picks.push(c);
    }
    if (!picks.length) { p.gold += 15; announce('核心已全部满级 · 折算 +15 金币', '#ffe094', 1.4); return true; }
    // ★ 原子化：先把卡片建好再开弹层 —— 避免「弹层开了但一张卡都没有」的半开状态
    //   （半开时玩家看得见弹层却点不动任何东西，只能刷新）。
    const frag = document.createDocumentFragment();
    picks.forEach(c => {
      const owned = tdCoreOwned(c.id);
      const b = document.createElement('button');
      b.className = 'upgrade rar-' + (c.rar || 0);
      b.innerHTML = `<span class="up-icon">${c.icon || '◆'}</span><strong>${c.name}</strong>` +
        `<span class="up-type">核心 · ${owned}/${c.max || 1} 级</span><p>${c.desc}</p>` +
        `<small>${owned > 0 ? '叠加后等级 ' + (owned + 1) : '新核心'}</small>`;
      b.addEventListener('click', () => tdPickCore(c));
      frag.appendChild(b);
    });
    TDu.coreCards.innerHTML = '';
    TDu.coreCards.appendChild(frag);
    game.tdCoreOpen = true;
    TDu.core.classList.remove('hidden');
    TDu.core.classList.add('active');
    TDu.coreTitle.textContent = '拾取核心';
    return true;
  }

  /**
   * ★ 弹层仲裁器（2026-11-03 新增）
   *
   * 背景（用户实测反馈的 bug）：「连续弹出核心选择和技能选择框，选了技能后选不到核心，
   * 卡在核心选择页面只能刷新」。
   *   两个根因：
   *     ① #td-core 原先嵌在 #hud 里，而 .hud 是 pointer-events:none 的容器
   *        → pointer-events 继承 → 核心弹层**整层点不动**（脚本 .click() 仍有效，所以 e2e 全绿）。
   *     ② 强化卡弹层（#levelup，body 级 z-index:34）与核心弹层可同时打开，
   *        #levelup 在 DOM 里靠后 → 直接盖住核心弹层。
   *   修法：DOM 层级已把 #td-core 提到 body 级（见 index.html 注释），
   *        这里再加一层「排队制」保险 —— 同一时刻只允许一个选卡弹层，
   *        谁先关，下一个由 pumpPopups() 统一补开。
   *        补开顺序：塔防 = 局内核心 → 强化卡（核心稀有，怕被强化卡压住）；
   *                  其它模式 = 强化卡 → 装备卡（沿用原顺序，不影响既有 e2e）。
   */
  function pumpPopups() {
    if (!game) return;
    if (game.gearPickOpen || game.levelupOpen || game.tdCoreOpen) return;  // 已有弹层在等
    if (game.player?.downed) return;
    // ★ 塔防模式：局内核心优先于强化卡。
    //   两种弹层的产出性质完全不同：
    //     - 强化卡 = **持续产出**（每级一张，队列会自动补开，永远不会丢）；
    //     - 局内核心 = **稀有掉落**（杀够怪才掉一次，错过就没了）。
    //   若让强化卡优先，密集升级期（刷怪提速后升级更频繁）核心会被一直压住，
    //   玩家主观感受就是用户反馈的「选了技能后选不到核心」——
    //   其实是核心还排在队列里，但玩家看到的是一串强化卡。
    //   所以：核心先弹、强化卡随后补上，**两者都不会丢失**。
    if (game.gameMode === 'td' && game.tdCoreDrops > 0 && mode === 'playing') {
      const n = game.tdCoreDrops;
      game.tdCoreDrops = 0;
      if (!openTdCorePick()) { game.tdCoreDrops = n; return; }  // 没开成 → 放回去，下一帧再试
      return;
    }
    if (game.pendingLevels > 0 && mode === 'playing') { openLevelUp(); return; }
    if (game.gearDrops > 0) {
      // ★ 必须**先确认能开成再扣减**：openGearPick() 内部有「倒地 / 其它弹层开着」的提前 return，
      //   若先 `game.gearDrops--` 再调用 → 提前 return 时这张装备卡就凭空丢了
      //   （与当年「核心掉落凭空消失」是同一类 bug）。
      if (game.player?.downed || game.tdCoreOpen || game.levelupOpen) return;
      game.gearDrops--;
      openGearPick();
      return;
    }
  }


  /** 拾取一个核心：写进本局核心表 → 重算属性（recomputePlayer 会把核心一起重放）*/
  function tdPickCore(c) {
    const p = game.player;
    const owned = tdCoreOwned(c.id);
    if (owned >= (c.max || 1)) { toast('该核心已达等级上限'); return; }
    if (!game.tdCores) game.tdCores = [];
    const rec = game.tdCores.find(x => x.id === c.id);
    if (rec) rec.lvl++; else game.tdCores.push({ id: c.id, lvl: 1 });
    game.tdCoreOpen = false;
    TDu.core.classList.add('hidden');
    TDu.core.classList.remove('active');
    recomputePlayer();   // 重建数值并把「强化卡 + 核心」一起重放 → 幂等
    burst(p.x, p.y, '#9fd3ff', 22);
    FX.ring(p.x, p.y, '#9fd3ff', 22, { speed: 240 });
    game.texts.push({ x: p.x, y: p.y - 40, text: `${c.name} Lv${tdCoreOwned(c.id)}`, color: '#9fd3ff', life: 1.4, size: 15 });
    announce(`核心 · ${c.name} Lv${tdCoreOwned(c.id)}`, '#9fd3ff', 1.6);
    tdRenderCoreSlots();
    updateHUD();
    pumpPopups();   // ★ 核心弹层关掉了 → 把被推迟的强化卡 / 装备卡补上
  }

  function tdSkipCore() {
    const p = game.player;
    game.tdCoreOpen = false;
    TDu.core.classList.add('hidden');
    TDu.core.classList.remove('active');
    p.gold += 15;
    announce('放弃核心 · 折算 +15 金币', '#ffe094', 1.4);
    pumpPopups();   // ★ 同上
  }

  /** HUD：底部核心芯片条 */
  function tdRenderCoreSlots() {
    if (!TDu.coreSlots) return;
    const list = tdCores();
    TDu.coreSlots.classList.toggle('hidden', !TDR.on || !list.length);
    if (!list.length) { TDu.coreSlots.innerHTML = ''; return; }
    TDu.coreSlots.innerHTML = list.map(rec => {
      const def = TD.TD_CORE_POOL.find(x => x.id === rec.id);
      if (!def) return '';
      return `<span class="td-core-chip rar-${def.rar || 0}" title="${def.desc}">${def.icon || '◆'}<b>${def.name}</b><i>${rec.lvl}</i></span>`;
    }).join('');
  }

  // ---------- 初始化 / 收尾 ----------
  function tdInit() {
    const players = Math.max(1, game.playerCount || 1);
    TDR.on = true;
    TDR.wave = 0; TDR.waveT = 0; TDR.spawnAcc = 0;
    TDR.queue.length = 0;
    TDR.leaks = 0;
    TDR.leakLimit = TD.BALANCE.leakLimit(players);
    const own = TD.BALANCE.laneOwners[players] || TD.BALANCE.laneOwners[1];
    TDR.lanes = Object.keys(own);
    TDR.laneOwner = own;
    tdResetModifiers();
    TDR.guards.length = 0;
    TDR.allyGuards.length = 0;
    TDR.cmd = 'focus';
    TDR.tpCd = 0;
    TDR.viewPad = null;
    TDR.rescueCd = 12;
    TDR.rallyT = 0;
    TDR.pendingDouble = null;
    TDR.coverN = 0;
    // ★ 尾王状态重置（新一局）
    TDR.finalBossState = 'none';
    TDR.guardPending = null;
    TDR.pendingFinal = false;
    // 局内核心（本局专属，结算后清空）
    if (!game.tdCores) game.tdCores = [];
    game.tdCores.length = 0;
    game.tdCoreDrops = 0;
    game.tdCoreOpen = false;
    if (TDu.core) { TDu.core.classList.add('hidden'); TDu.core.classList.remove('active'); }
    tdRenderCoreSlots();
    // ★ 把运行时能力挂到 TDR 上，让 td.js 的卡牌（ctx.td.xxx）能调到 game.js 的函数
    //   ★ replaying 标志：recomputePlayer 会重放全部卡牌，而「召唤守卫」「切换指令」
    //     属于一次性效果 —— 重放时必须跳过，否则：
    //       ① 每次重算都多召几个守卫（守卫数量爆炸）；
    //       ② 玩家手动切过的战术指令被卡牌重置回默认。
    TDR.spawnGuard = (p, kind) => { if (TDR.replaying) return; tdSpawnGuard(p, kind); };
    TDR.requestGuard = (p, kind, count) => { if (TDR.replaying) return; tdRequestGuard(p, kind, count || 1); };
    TDR.setCommand = (c) => { if (TDR.replaying) return; tdSetCommand(c); };

    const p = game.player;
    p.invuln = 1e9;                 // ★ 英雄无敌
    p.nextXp = TD.WAVES.xpNeed(1);
    p.hp = p.maxHp;
    p.gear = [];                    // ★ 塔防不产装备
    // ★ 塔防默认主动技：普通模式的主动技来自装备（默认存档 active 全是 null），
    //   而塔防不产装备 → 必须给一个职业默认主动技，否则「自动施法」永远无技可放。
    if (TD.TD_DEFAULT_ACTIVE) p.skillActive = TD.TD_DEFAULT_ACTIVE[p.type] || p.skillActive;
    const myIdx = tdMyIndex();
    const quad = TDR.lanes.find(l => TDR.laneOwner[l] === myIdx) || TDR.lanes[0];
    const start = TD.MAP.nodes.find(n => n.quad === quad && n.seq === 1) || TD.MAP.nodes[0];
    TDR.node = start;
    p.x = start.x; p.y = start.y;
    p.dirX = 1; p.dirY = 0;

    document.body.classList.add('td-mode');
    for (const k of ['top', 'cmds', 'padState', 'minimap']) if (TDu[k]) TDu[k].classList.remove('hidden');
    tdSyncCommandUi();
    announce('守卫艾泽拉斯之心 · 守住 30 波', '#9fd3ff', 3);
    // ★ 联机：波次推进是**主机权威** —— 客户端绝不能自己开波。
    //   两端各跑一次 tdNextWave() → 每条路的怪数量翻倍 → 难度直接爆表。
    if (!game.coop || game.coop.host) tdNextWave();   // ★ 开局立刻进入第 1 波（不要先空等一个波次时长）
  }

  /** 退出塔防模式（回首页 / 结算时清理 body class 与 HUD） */
  function tdTeardown() {
    TDR.on = false;
    document.body.classList.remove('td-mode');
    for (const k of ['top', 'cmds', 'padState', 'minimap']) if (TDu[k]) TDu[k].classList.add('hidden');
    if (TDu.core) { TDu.core.classList.add('hidden'); TDu.core.classList.remove('active'); }
    if (TDu.coreSlots) { TDu.coreSlots.classList.add('hidden'); TDu.coreSlots.innerHTML = ''; }
    if (game) game.tdCoreOpen = false;
  }

  // ---------- 波次调度 ----------
  function tdKindFor(row) {
    if (row.tags.includes('飞行')) return 'flyer';
    if (row.tags.includes('施法')) return 'caster';
    if (row.tags.includes('治疗')) return 'healer';
    if (row.tags.includes('分裂')) return 'splitter';
    if (row.tags.includes('装甲')) return 'tank';
    if (row.tags.includes('快速')) return 'fast';
    return 'normal';
  }

  /** 当前阵位能覆盖到哪几条路（用于「出怪优先送到玩家眼前」） */
  function tdCoveredLanes() {
    const pad = TDR.node;
    if (!pad) return [];
    const reach = tdReach();
    const out = [];
    for (const l of TDR.lanes) {
      const arc = tdArc(l);
      let hit = false;
      for (let t = 0; t <= 1 && !hit; t += .01) {
        const pt = TD.samplePath(arc, t);
        if (Math.hypot(pt.x - pad.x, pt.y - pad.y) <= reach) hit = true;
      }
      if (hit) out.push(l);
    }
    return out;
  }

  function tdNextWave() {
    // ★ 尾王（BOSS#3）必须被击杀才算通关。
    //   波次推进是纯时间驱动的 —— 若不在这里拦截，第 30 波计时结束时尾王可能还活着却直接判通关。
    //   pendingFinal = true 时由 tdUpdate 每帧检查（尾王一死立刻结算，不必再等满一个波次时长）。
    if (TDR.wave >= TD.WAVES.total) {
      if (TDR.finalBossState !== 'killed') { TDR.pendingFinal = true; TDR.waveT = 0; return; }
      endGame(true, '艾泽拉斯之心安然无恙，三十波攻势尽数击退。');
      return;
    }
    TDR.wave++;
    const row = TD.WAVES.rows[TDR.wave - 1];
    // ★ 2026-11-03：波次时长**逐波递增**（行内 seconds 字段，14s → 37s）。
    //   怪量与波次时长同比例增长 → 出怪速率恒定（英雄吞吐量不变）→ 难度不变、场面变热闹。
    TDR.waveLen = row.seconds || TD.WAVES.waveSeconds;
    // 本波出怪的路：从激活路里随机取 row.lanes 条
    const lanes = TDR.lanes.slice();
    for (let i = lanes.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = lanes[i]; lanes[i] = lanes[j]; lanes[j] = t; }
    // ★ 优先把怪送到玩家当前站位覆盖得到的路上：玩家一次只能守一段，
    //   若出怪路与自己无关，玩家只能眼睁睁看怪走进心脏 —— 挫败感远大于难度。
    //   排序放在洗牌之后 → 同组内仍保持随机。
    const covered = tdCoveredLanes();
    if (covered.length) {
      lanes.sort((a, b) => (covered.includes(b) ? 1 : 0) - (covered.includes(a) ? 1 : 0));
    }
    const use = lanes.slice(0, Math.min(row.lanes, lanes.length));
    for (const lane of use) {
      for (let i = 0; i < row.count; i++) {
        // ★ 精英标记取 '精英波'（波次表的 tag 名）—— 原写作 '精英' 永远不匹配，精英怪从未出现过
        TDR.queue.push({ lane, kind: tdKindFor(row), elite: row.tags.includes('精英波') && i === 0 });
      }
    }
    // 交错入场：打乱队列，避免一条路的怪连续出现
    for (let i = TDR.queue.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = TDR.queue[i]; TDR.queue[i] = TDR.queue[j]; TDR.queue[j] = t; }
    // ★ 波次 BOSS（10/20/30 波各 1 只）：放在队首（本波第一只入场），不参与上面的洗牌。
    //   优先安排到玩家当前覆盖得到的路（与普通怪同一套逻辑）—— 否则玩家只能眼看尾王走进心脏。
    const bossSpec = TD.bossOfWave(TDR.wave);
    if (bossSpec) {
      const bossLane = (covered.find(l => use.includes(l)) || use[0] || lanes[0]);
      TDR.queue.unshift({ lane: bossLane, kind: tdKindFor(row), elite: false, boss: bossSpec });
    }
    // 出怪节奏：让本波怪恰好在波次时长内出完，但夹在 [0.08s, 3s] 之间。
    //   ★ 不夹上限的话第 1 波会摊到十几秒里 → 几秒才出一只，开局空转；
    //   不夹下限的话后期波（4 路 × 65 只）会挤在 0.08 秒内 → 瞬时爆怪。
    //   ★ 下限从 0.15 降到 0.08：怪量 ×2 之后，0.15 的下限会让本波怪出不完、
    //     堆到下一波（波次节奏错乱）。
    TDR.spawnInterval = Math.max(.08, Math.min(3, TDR.waveLen / Math.max(1, TDR.queue.length)));
    TDR.spawnAcc = 0;
    const tag = row.tags.filter(t => t.startsWith('BOSS') || t === '精英波').join(' ');
    announce(`第 ${TDR.wave} 波 · ${row.count} 只 × ${use.length} 路${tag ? ' · ' + tag : ''}`, tag ? '#f1a277' : '#ffd98a', 2);
  }

  function tdSpawnTick(dt) {
    if (!TDR.queue.length) return;
    // ★ 移动端性能降级：同屏怪物上限 160（超出排队，优先杀靠前的）。
    //   只砍表现层密度，绝不砍血量/速度 —— 那会破坏配平。
    const cap = tdIsMobile() ? 160 : 270;
    TDR.spawnAcc += dt;
    while (TDR.spawnAcc >= TDR.spawnInterval && TDR.queue.length) {
      if (game.enemies.length >= cap) { TDR.spawnAcc = TDR.spawnInterval; return; }  // 保持满速等待
      TDR.spawnAcc -= TDR.spawnInterval;
      const s = TDR.queue.shift();
      tdSpawnEnemy(s.lane, s.kind, s.elite, s.boss);
    }
  }

  function tdSpawnEnemy(laneId, kind, elite, bossSpec) {
    const row = TD.WAVES.rows[Math.max(0, TDR.wave - 1)];
    const mul = TD.BALANCE.laneHpMult(game.playerCount || 1, laneId) || 1;
    const hp = row.hp * mul * (elite ? 3 : 1);
    const arc = tdArc(laneId);
    const t0 = TD.samplePath(arc, 0);
    const def = TD.MOB_TYPES[kind] || TD.MOB_TYPES.normal;
    const e = {
      type: def.sprite, name: (elite ? '精英·' : '') + def.name,
      x: t0.x, y: t0.y, r: def.r, hp, maxHp: hp, speed: row.speed * def.speedMul,
      damage: 0,                       // ★ 怪物不攻击英雄
      xp: row.xp * (elite ? 2 : 1),
      color: def.color, hitCd: 0, shootCd: 99, specialCd: 99, flash: 0, dead: false, boss: false,
      variant: 0, spriteKey: def.sprite, tint: elite ? 300 : null, elite,
      phase: rand(0, TAU), slow: 0, slowT: 0, burnT: 0, burnDps: 0, poisT: 0, poisDps: 0,
      stunT: 0, bleedT: 0, bleedDps: 0, dotAcc: 0, dotTick: 0, killedBy: null, spawnT: .3, atkT: 0,
      nid: (game._nid = (game._nid || 0) + 1),
      // ★ TD 专属字段
      tdLane: laneId, tdDist: 0, tdT: 0, tdFly: !!def.flying, tdKind: kind
    };
    // ★ 波次 BOSS（10/20/30 波各 1 只）
    //   模型与名字复用 BOSS_ROSTER（31 位），塔防只保留血量与外观 —— kind 技能分支全部关闭
    //   （塔防里怪物本来就不攻击，技能无意义）。
    //   血量不套 laneHpMult 的 2/c 公式：用 bossHpMult(P) = 1 + 0.3×(P-1)，
    //   因为人越多同时在场的输出火力越集中，首领血量必须跟涨。
    if (bossSpec) {
      const bd = BOSS_ROSTER[bossSpec.roster] || BOSS_ROSTER[0];
      // ★ 首领不吃 laneHpMult（那是「本路怪密度」系数，首领是单个大目标），
      //   只叠塔防专用的轻度人数系数（首领只走一路，只有 1~2 人能打到它）。
      // ★ 首领用**独立的血量基数** row.bossHp（2026-11-03）：小怪血量为了「割草感」
      //   整体下调了一个数量级，首领必须保持削弱前的量级，否则会变成一枪秒。
      const bhp = (row.bossHp || row.hp) * bossSpec.hpMul * TD.BALANCE.bossHpMult(game.playerCount || 1);
      e.boss = true;
      e.name = bd.name;
      e.spine = bd.spine;                 // → bossSpineKey() 走这里，绘制用 BOSS 专属 Spine 模型
      e.variant = bossSpec.roster;
      e.spriteKey = 'boss' + (bossSpec.roster % 3 + 1);   // Spine 不可用时的回退立绘
      e.r = bossSpec.r;
      e.hp = e.maxHp = bhp;
      e.speed = row.speed * bossSpec.speedMul;
      e.xp = row.xp * bossSpec.xpMul;
      e.color = '#c46b4f';
      e.tint = null;
      e.elite = false;
      e.tdKind = 'boss';
      e.tdBoss = bossSpec;
      e.type = 'boss';
    }
    game.enemies.push(e);
    return e;
  }

  /** 怪物沿路径行进（替代默认的「追玩家」逻辑） */
  function tdMoveEnemy(e, dt) {
    const arc = tdArc(e.tdLane);
    const sp = e.speed * (e.slowT > 0 ? 1 - e.slow : 1) * (e.stunT > 0 ? 0 : 1);
    e.tdDist += sp * dt;
    if (e.tdDist >= arc.total) {
      e.dead = true;
      if (!e.probe) tdLeak(e);   // 验收探针不计入漏怪
      return;
    }
    const t = e.tdDist / arc.total;
    const pt = TD.samplePath(arc, t);
    e.x = pt.x; e.y = pt.y; e.tdT = t;
    e.dirX = pt.dirX; e.dirY = pt.dirY;
  }

  function tdLeak(e) {
    // ★ 漏 1 只 BOSS 扣 5 只漏怪额度（设计案 §4 约定）
    const cost = e.tdBoss ? (e.tdBoss.leakCost || 5) : 1;
    TDR.leaks += cost;
    game.shake = Math.max(game.shake, 8);
    // ★ 漏怪是最重要的失败反馈：长震 + 红闪（移动端靠触觉，桌面端靠红闪）
    buzz([60, 80, 60]);
    game.flash = Math.max(game.flash || 0, .22);
    const H = TD.MAP.heart;
    game.texts.push({ x: H.x, y: H.y - 70, text: cost > 1 ? `漏怪 +${cost}` : '漏怪 +1', color: '#e05a4a', life: 1, size: cost > 1 ? 20 : 15 });
    FX.ring(H.x, H.y, '#e05a4a', 32, { speed: 260 });
    // ★ 尾王漏进心脏 = 直接判负（第 30 波之后已经没有下一波可打了）
    if (e.tdBoss && TDR.wave >= TD.WAVES.total) {
      TDR.finalBossState = 'leaked';
      endGame(false, `尾王 ${e.name} 冲破防线 —— 艾泽拉斯之心沦陷。`);
      return;
    }
    if (TDR.leaks >= TDR.leakLimit) endGame(false, `艾泽拉斯之心被攻破 —— 累计漏怪 ${TDR.leaks} 只。`);
  }

  // ---------- 自动施法决策器（★ 塔防的核心：AI 替你按键）----------
  function tdCollectCovered() {
    const pad = TDR.node;
    const reach = tdReach();
    const list = [];
    const laneT = new Map();
    if (!pad) return { list, laneT };
    for (const e of game.enemies) {
      if (e.dead || !e.tdLane) continue;
      if (Math.hypot(e.x - pad.x, e.y - pad.y) <= reach + e.r) { list.push(e); laneT.set(e, e.tdT || 0); }
    }
    return { list, laneT };
  }

  function tdAutoCast(dt) {
    const p = game.player;
    const { list: inRange, laneT } = tdCollectCovered();
    TDR.coverN = inRange.length;
    // 普攻（沿用现有 playerAttack；射程由 attackRange 的 TD 分支约束）
    if (p.attackTimer <= 0 && !p.downed) playerAttack();
    // 双重施法（延迟触发）
    if (TDR.pendingDouble) {
      TDR.pendingDouble.t -= dt;
      if (TDR.pendingDouble.t <= 0) {
        const dbl = TDR.pendingDouble; TDR.pendingDouble = null;
        // ★ dbl.slot 是槽位对象（不是槽位号）：零冷却 → 施放 → 还原冷却。
        //   旧写法把槽位号当成对象用（dbl.slot.cd === undefined）→ 实际清的是 p[undefined]，
        //   真实冷却没归零 → castActive 被冷却判定拦下 → 双重施法静默失效。
        const keep = p[dbl.slot.cd] || 0;
        p[dbl.slot.cd] = 0;
        castActive(dbl.slot.n);
        p[dbl.slot.cd] = keep;
      }
    }
    if (!inRange.length) return;
    // 候选技能：塔防下有效 + 冷却完毕，按优先级从高到低
    const cands = [];
    for (const sl of ACTIVE_SLOTS) {
      const sid = p[sl.skill];
      if (!sid || !TD.autoCastEnabled(sid)) continue;
      if ((p[sl.cd] || 0) > 0) continue;
      const rule = TD.AUTO_CAST[sid];
      cands.push({ sl, sid, rule, prio: rule.prio || 0 });
    }
    cands.sort((a, b) => b.prio - a.prio);
    for (const c of cands) {
      const need = c.rule.need || 'any';
      if (need === 'any' && inRange.length < 1) continue;
      if (need === 'dense' && inRange.length < (c.rule.min || 3) * TDR.threshold) continue;
      const tgt = TD.pickTarget(inRange, TDR.cmd, laneT);
      if (!tgt) continue;
      const dx = tgt.x - p.x, dy = tgt.y - p.y, d = Math.hypot(dx, dy) || 1;
      p.dirX = dx / d; p.dirY = dy / d;
      TDR.lastPick = tgt;
      castActive(c.sl.n);
      // cdScale 生效（卡牌缩短 / 延长技能冷却）
      p[c.sl.cd] = (p[c.sl.cd] || 0) * TDR.cdScale;
      p[c.sl.max] = (p[c.sl.max] || 0) * TDR.cdScale;
      // 生命共鸣：每 N 次施法多放一次
      TDR.castCounter++;
      if (TDR.extraCast > 0 && TDR.castCounter >= TDR.extraCast) {
        TDR.castCounter = 0;
        const keep = p[c.sl.cd] || 0;
        p[c.sl.cd] = 0;
        castActive(c.sl.n);
        p[c.sl.cd] = keep;
      }
      // 双重施法：AOE 技能概率再放一次
      if (TDR.doubleCast > 0 && Math.random() < TDR.doubleCast) {
        TDR.pendingDouble = { slot: c.sl, t: .6 };
      }
      break;   // 一帧最多放一个技能
    }
  }

  // ---------- 守卫（绑定阵位，玩家传送时留在原阵）----------
  function tdSpawnGuard(p, kind) {
    const pad = TDR.node;
    if (!pad) return;
    if (TDR.guards.length >= (TDR.guardMax || 6)) { toast('守卫数量已达上限'); return; }
    const def = TD.GUARD_KINDS[kind] || TD.GUARD_KINDS.turret;
    // twin：落在相邻阵位
    let host = pad;
    if (kind === 'twin') {
      const nb = tdNeighbors(pad);
      const cand = nb.right || nb.left || nb.up || nb.down;
      if (cand) host = cand;
    }
    tdPlaceGuard(kind, host, 1);
  }

  // ---------- 守卫放置模式 ----------
  // ★ 为什么需要：守卫是「守一条路」玩法的核心补偿线，但守卫只落在「玩家当前所在阵位」。
  //   若必须在目标阵位上才能召唤，玩家就得为了抽到一张守卫卡专门跑位 ——
  //   抽卡时机不可控，等于让这张卡大概率被浪费在错误的阵位上。
  //   实测（tools/td/td-guard-cover.mjs）：1 人局 6 座守卫（射程 ≥260）可以 100% 覆盖 2 条路，
  //   但前提是落点由玩家选择。因此这里把守卫卡改成「抽到后进入放置模式，点阵位选落点」。
  const TD_GUARD_PLACE_TTL = 14;   // 秒；超时自动落在当前阵位（卡不会被浪费）

  function tdRequestGuard(p, kind, count = 1) {
    if (TDR.replaying) return;
    if (TDR.guards.length >= (TDR.guardMax || 6)) { toast('守卫数量已达上限'); return; }
    const def = TD.GUARD_KINDS[kind] || TD.GUARD_KINDS.turret;
    TDR.guardPending = { kind, count, t: TD_GUARD_PLACE_TTL, name: def.name };
    toast(`点任意传送阵放置「${def.name}」· ${TD_GUARD_PLACE_TTL}s 内有效`);
  }

  /** 在指定阵位落下一座守卫 */
  function tdPlaceGuard(kind, host, count = 1) {
    if (!host) return false;
    const def = TD.GUARD_KINDS[kind] || TD.GUARD_KINDS.turret;
    let placed = 0;
    for (let i = 0; i < count; i++) {
      if (TDR.guards.length >= (TDR.guardMax || 6)) { toast('守卫数量已达上限'); break; }
      TDR.guards.push({ kind, x: host.x, y: host.y, padId: host.id, r: def.r,
        range: def.range, dps: def.dps, color: def.color, life: 0, atkCd: 0, hp: 1, dead: false });
      placed++;
      // ★ 联机客户端：把这座守卫上报给主机 —— 队友要能在画面上看到别人塔防的位置。
      //   主机收到后记到 al.tdGuards，随 10Hz 快照下发（客户端只渲染，不参与本地结算）。
      if (game?.coop && !game.coop.host && typeof NET !== 'undefined') {
        NET.sendEv({ k: 'tdGuard', kind, x: host.x | 0, y: host.y | 0, range: def.range | 0, r: def.r | 0, padId: host.id });
      }
    }
    if (!placed) return false;
    FX.ring(host.x, host.y, def.color, 20, { speed: 180 });
    game.texts.push({ x: host.x, y: host.y - 26, text: def.name + ' 就位', color: def.color, life: 1.1, size: 12 });
    return true;
  }

  /** 放置模式：点中阵位 → 落守卫；不在放置模式则返回 false（交回给传送逻辑） */
  function tdTryPlaceGuardAt(node) {
    const g = TDR.guardPending;
    if (!g || !node) return false;
    const okPlace = tdPlaceGuard(g.kind, node, g.count);
    TDR.guardPending = null;
    if (okPlace) announce(`${g.name} 已就位 · ${node.id} 号阵`, g.count > 1 ? '#9fd3ff' : '#ffd98a', 1.4);
    return true;
  }

  /** 放置模式超时 → 落在当前阵位（保证卡不浪费） */
  function tdUpdateGuardPending(dt) {
    const g = TDR.guardPending;
    if (!g) return;
    g.t -= dt;
    if (g.t <= 0) {
      TDR.guardPending = null;
      tdPlaceGuard(g.kind, TDR.node, g.count);
      toast(`${g.name} 已就位（当前阵位）`);
    }
  }

  // 守卫攻击间隔（秒）。守卫是「塔」，按固定频率开火，而不是每帧结算。
  const TD_GUARD_ATK_CD = .8;

  function tdUpdateGuards(dt) {
    const p = game.player;
    for (const g of TDR.guards) {
      if (g.dead) continue;
      g.life += dt;
      g.atkCd = Math.max(0, (g.atkCd || 0) - dt);
      // 守卫自动攻击覆盖范围内的怪
      // ★ 必须按固定频率开火：早先版本在每帧都结算伤害 → 实际 DPS 被放大 60 倍。
      if (g.dps > 0 && g.atkCd <= 0) {
        let best = null, bd = g.range;
        for (const e of game.enemies) {
          if (e.dead || !e.tdLane) continue;
          const d = Math.hypot(e.x - g.x, e.y - g.y);
          if (d < bd) { bd = d; best = e; }
        }
        if (best) {
          g.atkCd = TD_GUARD_ATK_CD;
          const dmg = p.damage * g.dps;
          damageEnemy(best, dmg, Math.atan2(best.y - g.y, best.x - g.x), 'td_guard');
          // 荆棘守卫：反弹
          if (g.kind === 'thorn' && Math.random() < .2) {
            for (const e of game.enemies) {
              if (!e.dead && e !== best && Math.hypot(e.x - g.x, e.y - g.y) < g.range) {
                damageEnemy(e, p.damage * .3, 0, 'td_guard'); break;
              }
            }
          }
        }
      }
      // 地雷：定期补充（由卡牌在覆盖段布置）
      if (g.kind === 'mine' && g.life > 0) {
        for (const e of game.enemies) {
          if (!e.dead && e.tdLane && Math.hypot(e.x - g.x, e.y - g.y) < g.range) {
            damageEnemy(e, p.damage * 2.4, 0, 'td_guard');
            game.effects.push({ type: 'warning', x: g.x, y: g.y, r: 8, maxR: g.range, life: .3, maxLife: .3, color: '#ffb257' });
            g.dead = true;
            break;
          }
        }
      }
    }
    TDR.guards = TDR.guards.filter(g => !g.dead);
  }

  // ---------- 传送 / 指令 ----------
  function tdTeleport(dir) {
    if (!TDR.node) return;
    if (TDR.tpCd > 0) { toast(`传送冷却 ${TDR.tpCd.toFixed(1)}s`); buzz([30, 40, 30]); return; }
    const nb = tdNeighbors(TDR.node);
    const target = nb[dir];
    if (!target) { toast('该方向没有相邻传送阵'); return; }
    tdTeleportTo(target, 1);
  }

  /**
   * 传送到指定阵位。
   * @param target 目标阵位节点
   * @param hops   跨越的阵位数（移动端点远处阵位时 CD 更长：5s + 2s × 跳数）
   */
  function tdTeleportTo(target, hops = 1) {
    if (!target) return false;
    if (TDR.tpCd > 0) { toast(`传送冷却 ${TDR.tpCd.toFixed(1)}s`); buzz([30, 40, 30]); return false; }
    if (target.id === TDR.node?.id) { toast('已经在该阵位'); return false; }
    TDR.node = target;
    const p = game.player;
    p.x = target.x; p.y = target.y;
    TDR.tpCd = TDR.tpCdMax + Math.max(0, (hops - 1)) * 2;   // 远距离传送 CD 加长
    if (TDR.rootLock > 0) TDR.rootLock = Math.max(0, TDR.rootLock - 1);
    FX.ring(target.x, target.y, '#ffd98a', 22, { speed: 220 });
    burst(target.x, target.y, '#ffe098', 12);
    buzz(15);
    announce(`传送 · ${target.id} 号阵`, '#ffd98a', 1.2);
    return true;
  }

  // ---------- 触屏 / 鼠标：点阵位传送 + 拖动平移视角 ----------
  const TD_TAP_RADIUS = 70;      // 阵位点击容错（码）
  const TD_DRAG_THRESHOLD = 12;  // 超过该位移判定为拖动（px）

  /** 屏幕坐标 → 世界坐标 */
  function tdWorldPos(clientX, clientY) {
    const cam = camera();
    const r = canvas.getBoundingClientRect();
    return { x: cam.x + (clientX - r.left), y: cam.y + (clientY - r.top) };
  }

  /** 命中的传送阵（取最近的，容错 70 码） */
  function tdHitPad(wx, wy) {
    let best = null, bd = TD_TAP_RADIUS;
    for (const n of TD.MAP.nodes) {
      const d = Math.hypot(n.x - wx, n.y - wy);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  /** 两个阵位之间的跳数（沿 links 邻接表做 BFS，用于远距离传送的 CD 惩罚） */
  function tdHops(aId, bId) {
    if (!aId || !bId || aId === bId) return 1;
    const adj = new Map(TD.MAP.nodes.map(n => [n.id, n.links || []]));
    const seen = new Set([aId]); const q = [[aId, 0]];
    while (q.length) {
      const [cur, d] = q.shift();
      if (cur === bId) return d;
      for (const nb of (adj.get(cur) || [])) if (!seen.has(nb)) { seen.add(nb); q.push([nb, d + 1]); }
    }
    return 1;
  }

  function tdCanvasPointerDown(e) {
    if (game?.gameMode !== 'td') return;
    TDR.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0, ox: TDR.camOff.x, oy: TDR.camOff.y };
  }

  function tdCanvasPointerMove(e) {
    const d = TDR.drag;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    d.moved = Math.max(d.moved, Math.hypot(dx, dy));
    if (d.moved > TD_DRAG_THRESHOLD) {
      // 拖动 = 平移视角（脱离跟随）
      TDR.camOff.x = d.ox + dx; TDR.camOff.y = d.oy + dy;
      TDR.camFree = 1.5;   // 松手 1.5 秒后回到跟随
    }
  }

  function tdCanvasPointerUp(e) {
    const d = TDR.drag;
    if (!d || d.id !== e.pointerId) return;
    TDR.drag = null;
    if (d.moved > TD_DRAG_THRESHOLD) return;   // 拖过 → 不触发传送
    const w = tdWorldPos(e.clientX, e.clientY);
    const pad = tdHitPad(w.x, w.y);
    if (!pad) return;                            // 点空地 = 无操作
    // ★ 守卫放置模式优先：点阵位 = 落守卫（而不是传送）
    if (tdTryPlaceGuardAt(pad)) return;
    const hops = tdHops(TDR.node?.id, pad.id);
    tdTeleportTo(pad, hops);
  }

  /** 震动反馈（移动端）；桌面端无 navigator.vibrate 时静默 */
  function buzz(pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch { }
  }

  /** 联机：切换观看的队友视角（null = 回到自己） */
  function tdSetView(allyId) {
    TDR.viewPad = allyId || null;
    // 同步左侧队友列表的高亮（谁正在被观看）
    const pp = ui['party-panel'];
    if (pp) pp.querySelectorAll('[data-pf]').forEach(fr => {
      fr.classList.toggle('pf-viewing', fr.dataset.pf === (TDR.viewPad || 'self'));
    });
    if (TDR.viewPad) toast('正在查看队友视角 · 空格或方向键回到自己');
    else toast('已回到自己视角');
  }

  function tdSetCommand(cmd) {
    if (!TD.COMMANDS[cmd]) return;
    TDR.cmd = cmd;
    tdSyncCommandUi();
    toast('战术指令 · ' + TD.COMMANDS[cmd].name);
  }

  function tdSyncCommandUi() {
    for (const k in TDu.cmdBtns) TDu.cmdBtns[k].classList.toggle('active', k === TDR.cmd);
  }

  // ---------- 每帧更新 ----------
  function tdUpdate(dt) {
    const p = game.player;
    // ★ 注意：计时器递减、粒子/特效清理、投射物更新、装备卡检查、updateHUD
    //   全部由主 update 的通用段负责，这里只做 TD 专属的事，避免重复执行。
    p.invuln = Math.max(p.invuln, 1e8);           // ★ 始终无敌
    p.moveX = 0; p.moveY = 0;                      // ★ 不能自由移动
    // 拖动脱离跟随后自动回到跟随
    if (TDR.camFree > 0) {
      TDR.camFree -= dt;
      if (TDR.camFree <= 0) { TDR.camOff.x = 0; TDR.camOff.y = 0; }
    } else if (!TDR.drag) {
      // 平滑回位
      TDR.camOff.x *= Math.max(0, 1 - dt * 8);
      TDR.camOff.y *= Math.max(0, 1 - dt * 8);
      if (Math.abs(TDR.camOff.x) < 1) TDR.camOff.x = 0;
      if (Math.abs(TDR.camOff.y) < 1) TDR.camOff.y = 0;
    }
    // 传送冷却 / 扎根锁定
    TDR.tpCd = Math.max(0, TDR.tpCd - dt);
    if (TDR.rallyT > 0) { TDR.rallyT -= dt; if (TDR.rallyT <= 0) TDR.rally = false; }
    // ★ 波次推进 / 刷怪 = **主机权威**
    //   客户端的 wave / waveT / 漏怪数全部由快照下发（clientOnSnap 的 d.td 段）。
    //   客户端若自己也推进一次 → 两端各跑一遍 tdNextWave + tdSpawnTick → 怪物数量翻倍。
    const tdHost = !game.coop || game.coop.host;
    if (tdHost) {
      TDR.waveT += dt;
      if (TDR.waveT >= TDR.waveLen) { TDR.waveT -= TDR.waveLen; tdNextWave(); }
      tdSpawnTick(dt);
      // ★ 尾王结算：第 30 波计时结束后进入 pendingFinal，尾王被击杀 → 立刻通关
      //   （不必再等满一个波次时长；漏怪则已在 tdLeak 里判负）
      if (TDR.pendingFinal) {
        if (TDR.finalBossState === 'killed') {
          endGame(true, '艾泽拉斯之心安然无恙，三十波攻势尽数击退。');
          return;
        }
        TDR.waveT = 0;   // 停在第 30 波，等待尾王被击杀
      }
    }
    // 自动施法 + 守卫
    tdAutoCast(dt);
    tdUpdateGuards(dt);
    tdUpdateGuardPending(dt);
    // 怪物沿路径移动（在主 update 的敌人循环里被拦截调用，这里不需要重复）
    // 心柱血条 / 漏怪提示（TD 专属 HUD）
    const remain = Math.max(0, TDR.leakLimit - TDR.leaks);
    if (TDu.heartFill) TDu.heartFill.style.width = (100 * remain / TDR.leakLimit) + '%';
    if (TDu.heartText) TDu.heartText.textContent = `${remain} / ${TDR.leakLimit}`;
    if (TDu.leakText) TDu.leakText.textContent = `${TDR.leaks} / ${TDR.leakLimit}`;
    if (TDu.leak) TDu.leak.classList.toggle('danger', TDR.leaks >= TDR.leakLimit * .7);
  }

  // ---------- 渲染 ----------
  /**
   * ★ 塔防场景素材（4 张，注册于 assets.mjs 的 SCENE_MANIFEST）
   *   ⚠️ 注册键名是 'td_ground' / 'td_road' / 'td_heart' / 'td_pad'。
   *      早期版本这里误写成 ASSETS.getScene('td') —— 键名不匹配 → 永远取不到图 →
   *      背景只能走 '#1b2a1e' 兜底，玩家看到的是一片黑底（2026-11-03 用户实测反馈）。
   *   素材缺失时全部有程序化兜底，不会崩、也不会全黑。
   */
  const TD_SCENE = { ground: null, road: null, heart: null, pad: null, roadPat: null, loaded: false };
  function tdSceneAssets() {
    if (TD_SCENE.loaded) return TD_SCENE;
    TD_SCENE.loaded = true;
    if (typeof ASSETS !== 'undefined' && ASSETS) {
      TD_SCENE.ground = ASSETS.getScene('td_ground');
      TD_SCENE.road = ASSETS.getScene('td_road');
      TD_SCENE.heart = ASSETS.getScene('td_heart');
      TD_SCENE.pad = ASSETS.getScene('td_pad');
    }
    return TD_SCENE;
  }

  /**
   * 世界网格锚定的贴图平铺。
   * 与冒险模式 drawGround 同一套做法：**不做取模偏移、不做二次平移** ——
   * 贴图网格严格等于「世界坐标 = 网格索引 × tile」，越界时像素连续，不会闪烁跳变。
   */
  function tdTileImage(img, cam, tile) {
    const gx0 = Math.floor((cam.x - 60) / tile), gy0 = Math.floor((cam.y - 60) / tile);
    const cols = Math.ceil(width / tile) + 3, rows = Math.ceil(height / tile) + 3;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) ctx.drawImage(img, (gx0 + i) * tile, (gy0 + j) * tile, tile, tile);
  }

  function tdDrawGround(cam) {
    const A = tdSceneAssets();
    ctx.save();
    // ===== L0 地面：AI 生成的「无缝可平铺草地」 =====
    if (A.ground) {
      tdTileImage(A.ground, cam, 1024);   // 1024² 原图，1:1 世界像素
      // L1 斑块层：低频明暗扰动，打散平铺重复感（与冒险模式同一套思路）
      const layers = [{ size: 340, dark: .22, light: .07 }, { size: 170, dark: .14, light: .05 }];
      for (const L of layers) {
        const t2 = L.size, gx0 = Math.floor((cam.x - 50) / t2), gy0 = Math.floor((cam.y - 50) / t2);
        const gx1 = gx0 + Math.ceil(width / t2) + 2, gy1 = gy0 + Math.ceil(height / t2) + 2;
        for (let x = gx0; x < gx1; x++) for (let y = gy0; y < gy1; y++) {
          const h = hash(x + L.size, y - L.size);
          if (h < .45) continue;
          const cx0 = x * t2 + t2 / 2, cy0 = y * t2 + t2 / 2;
          const r = t2 * (.42 + h * .3);
          const g = ctx.createRadialGradient(cx0, cy0, 0, cx0, cy0, r);
          const col = h > .76 ? '4,10,6' : '226,244,196';
          g.addColorStop(0, `rgba(${col},${h > .76 ? L.dark : L.light})`);
          g.addColorStop(1, `rgba(${col},0)`);
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.ellipse(cx0, cy0, r, r * .74, hash(y, x) * 3, 0, TAU); ctx.fill();
        }
      }
    } else {
      // 素材缺失时的程序化地面兜底（草地色块 + 石块），不再是纯黑
      ctx.fillStyle = '#1b2a1e'; ctx.fillRect(cam.x - 50, cam.y - 50, width + 100, height + 100);
      const t = 80, x0 = Math.floor((cam.x - 50) / t), y0 = Math.floor((cam.y - 50) / t);
      const x1 = x0 + Math.ceil(width / t) + 2, y1 = y0 + Math.ceil(height / t) + 2;
      for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) {
        const h = hash(x, y);
        ctx.fillStyle = h > .5 ? '#20301f' : '#1a2819';
        ctx.fillRect(x * t, y * t, t + 1, t + 1);
      }
    }
    // ===== L2 道路：暗边 + 土路贴图 =====
    const half = TD.MAP.roadHalf;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    // ① 暗边（比路宽一圈，柔化路缘）
    for (const lane of TD.MAP.lanes) {
      const pts = TD.normPts(lane.pts);
      ctx.strokeStyle = 'rgba(70,54,32,.9)'; ctx.lineWidth = half * 2 + 16;
      ctx.beginPath(); pts.forEach((q, i) => i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)); ctx.stroke();
    }
    // ② 路面：用「无缝可平铺土路」贴图当描边样式。
    //   CanvasPattern 的图案坐标系跟随**绘制时的当前变换矩阵**，此处 CTM 已是世界坐标
    //   （draw() 里 translate(-cam)），所以土路纹理是世界锚定的 —— 镜头移动时不会滑动。
    if (!TD_SCENE.roadPat && A.road) { try { TD_SCENE.roadPat = ctx.createPattern(A.road, 'repeat'); } catch { TD_SCENE.roadPat = null; } }
    for (const lane of TD.MAP.lanes) {
      const pts = TD.normPts(lane.pts);
      ctx.strokeStyle = TD_SCENE.roadPat || '#a98a5c'; ctx.lineWidth = half * 2;
      ctx.beginPath(); pts.forEach((q, i) => i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)); ctx.stroke();
      // 未激活的路压暗一档（1 人局只开 2 条路，其余路要能一眼看出「不通」）
      if (!TDR.lanes.includes(lane.id)) {
        ctx.strokeStyle = 'rgba(8,12,10,.6)'; ctx.lineWidth = half * 2;
        ctx.beginPath(); pts.forEach((q, i) => i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)); ctx.stroke();
      }
    }
    // ===== L3 刷怪口（四角，红框标记） =====
    for (const lane of TD.MAP.lanes) {
      const pts = TD.normPts(lane.pts);
      const s = pts[0];
      const active = TDR.lanes.includes(lane.id);
      const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, 120);
      g.addColorStop(0, active ? 'rgba(255,90,60,.32)' : 'rgba(120,50,40,.16)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(s.x, s.y, 120, 0, TAU); ctx.fill();
      ctx.strokeStyle = active ? 'rgba(255,120,80,.85)' : 'rgba(150,80,60,.4)'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(s.x, s.y, 62, 0, TAU); ctx.stroke();
      ctx.strokeStyle = active ? 'rgba(255,150,110,.5)' : 'rgba(150,80,60,.25)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(s.x, s.y, 78, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }

  function tdDrawOverlay() {
    const pad = TDR.node;
    const H = TD.MAP.heart;
    const A = tdSceneAssets();
    ctx.save();
    // 心脏：AI 生成的「俯视蓝色能量池」精灵（td_heart.png，去过白底）
    const pulse = .85 + Math.sin(performance.now() / 420) * .12;
    if (A.heart) {
      const s = 330 * pulse;
      ctx.drawImage(A.heart, H.x - s / 2, H.y - s / 2, s, s);
    }
    ctx.fillStyle = FX.radial(ctx, 'td_heart', 150, [[0, 'rgba(120,205,255,.55)'], [.5, 'rgba(60,140,230,.25)'], [1, 'rgba(0,0,0,0)']]);
    ctx.beginPath(); ctx.arc(H.x, H.y, 150 * pulse, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#5fc8ff'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(H.x, H.y, H.r * pulse, 0, TAU); ctx.stroke();
    ctx.strokeStyle = 'rgba(95,200,255,.45)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(H.x, H.y, H.r * 1.5 * pulse, 0, TAU); ctx.stroke();
    // 传送阵：AI 生成的「俯视金色法阵」精灵（td_pad.png，20 个共用同一张）
    const placing = !!TDR.guardPending;
    for (const n of TD.MAP.nodes) {
      const isMe = pad && n.id === pad.id;
      if (A.pad) ctx.drawImage(A.pad, n.x - 48, n.y - 48, 96, 96);
      const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, 46);
      g.addColorStop(0, isMe ? 'rgba(255,225,150,.42)' : 'rgba(255,200,110,.18)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(n.x, n.y, 46, 0, TAU); ctx.fill();
      ctx.strokeStyle = isMe ? '#ffe1a1' : '#c9a35e'; ctx.lineWidth = isMe ? 4 : 2;
      ctx.beginPath(); ctx.arc(n.x, n.y, 22, 0, TAU); ctx.stroke();
      if (isMe) {
        ctx.strokeStyle = 'rgba(255,225,161,.5)'; ctx.lineWidth = 2;
        ctx.setLineDash([6, 8]);
        ctx.beginPath(); ctx.arc(n.x, n.y, 34 + Math.sin(performance.now() / 300) * 3, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
      }
      // ★ 守卫放置模式：所有阵位脉冲高亮（当前阵位除外，它已经是黄色实心）
      if (placing && !isMe) {
        const ph = (performance.now() / 260) % 1;
        ctx.strokeStyle = `rgba(120,255,190,${(0.85 * (1 - ph)).toFixed(3)})`;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(n.x, n.y, 22 + ph * 20, 0, TAU); ctx.stroke();
        // 落点准星
        ctx.strokeStyle = 'rgba(120,255,190,.85)'; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(n.x - 9, n.y); ctx.lineTo(n.x + 9, n.y);
        ctx.moveTo(n.x, n.y - 9); ctx.lineTo(n.x, n.y + 9);
        ctx.stroke();
      }
    }
    // ★ 守卫放置模式：把「守卫射程」画成落点预览圆，让玩家看得见能覆盖到哪
    if (placing && pad) {
      const gd = TD.GUARD_KINDS[TDR.guardPending.kind] || TD.GUARD_KINDS.turret;
      ctx.strokeStyle = 'rgba(120,255,190,.28)'; ctx.lineWidth = 2; ctx.setLineDash([8, 8]);
      for (const n of TD.MAP.nodes) {
        ctx.beginPath(); ctx.arc(n.x, n.y, gd.range, 0, TAU); ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    // 当前阵位的覆盖圈
    if (pad) {
      const reach = tdReach();
      ctx.strokeStyle = 'rgba(255,225,161,.30)'; ctx.lineWidth = 2; ctx.setLineDash([10, 10]);
      ctx.beginPath(); ctx.arc(pad.x, pad.y, reach, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
    }
    // 守卫
    for (const g of TDR.guards) {
      ctx.fillStyle = 'rgba(10,14,15,.8)'; ctx.beginPath(); ctx.arc(g.x, g.y, g.r, 0, TAU); ctx.fill();
      ctx.strokeStyle = g.color; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(g.x, g.y, g.r, 0, TAU); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(g.x, g.y, g.range * .5, 0, TAU); ctx.stroke();
    }
    // ★ 队友守卫（联机只读渲染：让队友的塔防位置可见，但颜色淡一档以区分归属）
    for (const g of (TDR.allyGuards || [])) {
      ctx.fillStyle = 'rgba(10,14,15,.5)'; ctx.beginPath(); ctx.arc(g.x, g.y, g.r, 0, TAU); ctx.fill();
      ctx.globalAlpha = .65;
      ctx.strokeStyle = g.color; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(g.x, g.y, g.r, 0, TAU); ctx.stroke();
      ctx.setLineDash([5, 5]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(g.x, g.y, g.range * .5, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    // 传送连线（当前阵位 → 可达邻接）
    if (pad) {
      ctx.strokeStyle = 'rgba(255,225,161,.18)'; ctx.lineWidth = 3;
      for (const id of pad.links) {
        const n = TD.NODE_BY_ID.get(id); if (!n) continue;
        ctx.beginPath(); ctx.moveTo(pad.x, pad.y); ctx.lineTo(n.x, n.y); ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ---------- HUD ----------
  function tdUpdateHud() {
    if (!TDR.on) return;
    const row = TD.WAVES.rows[Math.max(0, TDR.wave - 1)];
    const waveNow = Math.min(TDR.wave, TD.WAVES.total);
    if (TDu.waveFill) TDu.waveFill.style.width = (100 * waveNow / TD.WAVES.total) + '%';
    if (TDu.waveText) TDu.waveText.textContent = `${waveNow} / ${TD.WAVES.total}`;
    const pad = TDR.node;
    if (TDu.heroLabel) TDu.heroLabel.textContent = heroes[game.player.type].name;
    if (TDu.padLabel) {
      // ★ 守卫放置模式优先：HUD 必须明确告诉玩家「现在要点哪、超时去哪」
      if (TDR.guardPending) {
        const gp = TDR.guardPending;
        const secs = Math.max(0, Math.ceil(gp.t));
        TDu.padLabel.textContent = `放置「${gp.name}」· 点传送阵落位 · ${secs}s`;
        TDu.padLabel.classList.add('td-placing');
        if (TDu.padState) TDu.padState.classList.add('td-placing');
      } else if (pad) {
        const q = pad.quad;
        TDu.padLabel.textContent = `${'①②③④⑤'[pad.seq - 1]} 号阵 · ${q === 'LL' ? '左下' : q === 'LR' ? '右下' : q === 'UL' ? '左上' : '右上'}`;
        TDu.padLabel.classList.remove('td-placing');
        if (TDu.padState) TDu.padState.classList.remove('td-placing');
      } else {
        TDu.padLabel.classList.remove('td-placing');
        if (TDu.padState) TDu.padState.classList.remove('td-placing');
      }
    }
    if (TDu.coverLabel) {
      const blocks = Math.min(5, Math.ceil(TDR.coverN / 2));
      TDu.coverLabel.textContent = `覆盖 ${'▓'.repeat(blocks)}${'░'.repeat(5 - blocks)}（${TDR.coverN} 只）`;
    }
    // 小地图
    if (TDu.minimapCv) tdDrawMinimap();
  }

  // ★ 塔防：移动端小地图点击 —— 点阵位 → 传送到该阵位；点队友 → 切换视角
  //   （设计稿 §2.4：小地图是移动端唯一能快速定位阵位与队友的手段）
  function tdMinimapClick(ev) {
    if (game?.gameMode !== 'td') return;
    const cv = TDu.minimapCv;
    if (!cv) return;
    const r = cv.getBoundingClientRect();
    const mx = (ev.clientX - r.left) / r.width * cv.width;
    const my = (ev.clientY - r.top) / r.height * cv.height;
    const wx = mx / (cv.width / TD.MAP.W), wy = my / (cv.height / TD.MAP.H);
    // 队友点（联机）
    if (game.allies) {
      for (const [id, a] of game.allies) {
        if (Math.hypot(a.x - wx, a.y - wy) < 60) { tdSetView(id); return; }
      }
    }
    // 阵位点
    let best = null, bd = 90;
    for (const n of TD.MAP.nodes) {
      const d = Math.hypot(n.x - wx, n.y - wy);
      if (d < bd) { bd = d; best = n; }
    }
    if (best) {
      // ★ 守卫放置模式优先：小地图点阵位 = 落守卫
      if (tdTryPlaceGuardAt(best)) return;
      tdTeleportTo(best, tdHops(TDR.node?.id, best.id));
    }
  }

  function tdDrawMinimap() {
    const cv = TDu.minimapCv;
    if (!cv) return;
    const g = cv.getContext('2d');
    const W = cv.width, Hh = cv.height;
    const sx = W / TD.MAP.W, sy = Hh / TD.MAP.H;
    g.clearRect(0, 0, W, Hh);
    g.fillStyle = '#16241a'; g.fillRect(0, 0, W, Hh);
    // 路
    g.strokeStyle = 'rgba(190,160,110,.8)'; g.lineWidth = 3;
    for (const lane of TD.MAP.lanes) {
      g.beginPath();
      const pts = TD.normPts(lane.pts);
      pts.forEach((q, i) => i ? g.lineTo(q.x * sx, q.y * sy) : g.moveTo(q.x * sx, q.y * sy));
      g.stroke();
    }
    // 心脏
    const H = TD.MAP.heart;
    g.fillStyle = '#5fc8ff'; g.beginPath(); g.arc(H.x * sx, H.y * sy, 5, 0, TAU); g.fill();
    // 阵位
    for (const n of TD.MAP.nodes) {
      const me = TDR.node && n.id === TDR.node.id;
      g.fillStyle = me ? '#ffe1a1' : 'rgba(220,180,100,.65)';
      g.beginPath(); g.arc(n.x * sx, n.y * sy, me ? 4 : 2.5, 0, TAU); g.fill();
    }
    // ★ 队友阵位（联机）：用各职业颜色标记队友当前守在哪个传送阵
    if (game.allies) for (const al of game.allies.values()) {
      if (!al.tdNode) continue;
      const n = TD.NODE_BY_ID.get(al.tdNode);
      if (!n) continue;
      g.fillStyle = (heroes[al.hero] || {}).color || '#9fd3ff';
      g.beginPath(); g.arc(n.x * sx, n.y * sy, 3.5, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 1; g.stroke();
    }
    // 敌人
    g.fillStyle = '#e05a4a';
    for (const e of game.enemies) {
      if (e.dead || !e.tdLane) continue;
      g.fillRect(e.x * sx - 1.5, e.y * sy - 1.5, 3, 3);
    }
  }


  function showModeChoice(origin) {
    mcOrigin = origin; mode = 'home'; game = null; keys.clear(); FX.clear();
    // ★ 这里绝不能清空 pendingDungeon！
    //   副本入口（renderDungeons 的卡片点击）是「先 pendingDungeon = did，再调 showModeChoice」，
    //   若在此置空 → 模式页标题回退成「无尽模式」、建房 roomMode 变成 'adventure'、
    //   gameMode 变成 'adventure'（无尽）→ 玩家从 UI 点任何副本（含 4 人团队副本）进的其实是无尽模式，
    //   不产金币、不掉副本装备、通关不计副本通关数。
    //   各入口已自行显式设置：nav-adventure（null）/ nav-td（null）/ 副本卡片（did）。
    //   返回类调用（rooms-back / lobby-back / left）应保留当前副本 —— 这才是正确行为。
    hideAll(); showScreen('mode-choice');
    // 熔火之心：团队副本严格 4 人，隐藏单人入口
    const isRaid = !!pendingDungeon && DUNGEONS[pendingDungeon]?.type === 'raid';
    ui['mc-solo'].classList.toggle('hidden', isRaid);
    const mcStrong = ui['mc-multi'].querySelector('strong'), mcSmall = ui['mc-multi'].querySelector('small');
    if (mcStrong) mcStrong.textContent = isRaid ? '组队挑战（4 人）' : '组队挑战';
    if (mcSmall) mcSmall.textContent = isRaid ? '团队副本 · 需 4 名玩家' : '局域网联机 · 最多 4 人';
    ui['mc-title'].textContent = pendingMode === 'td' ? '塔防模式 · 守卫艾泽拉斯之心'
      : (pendingDungeon ? `冒险模式 · ${DUNGEONS[pendingDungeon].name}` : '无尽模式 · 无尽围攻');
  }
  async function openRooms() {
    if (!NET.supported) { toast('联机需用 start.cmd 启动后，通过浏览器访问主机地址'); return; }
    const name = (ui['player-name'].value || '').trim() || `英雄${Math.floor(Math.random() * 90 + 10)}`;
    // #65 存档码：优先用本地已登记的码（同一浏览器跨会话稳定），
    // 否则按昵称确定性派生（换设备/换隧道地址后仍能找回同一份档）。
    // 玩家可在房间页手动填写自定义码，用于同名区分或主动重置。
    let code = (ui['player-code']?.value || '').trim().toUpperCase();
    if (!code) code = (getSaveCode(name) || '').trim().toUpperCase();
    const derived = code || deriveSaveCode(name);
    saveNamespace = name; saveCode = derived;
    setSaveCode(name, derived);
    // 第 5 项：先切到房间页并立即给出反馈，连接与存档同步在后台进行，玩家不再"卡住不动"
    hideAll(); showScreen('rooms');
    ui['rooms-hint'].textContent = '正在连接主机…';
    ui['room-list'].innerHTML = '<div class="room-empty">正在连接主机，请稍候…</div>';
    try { localStorage.setItem('azs-name', name); await NET.connect(name); }
    catch (err) { toast(err.message || '无法连接到主机'); ui['rooms-hint'].textContent = '无法连接到主机'; return; }
    await setSaveNamespace(name, derived); // #52/#65 使用玩家自己的存档（技能/图纸/背包），并与主机存档中心对齐
    if (ui['player-code']) ui['player-code'].value = derived;
    // #65 明确告知玩家存档归属与找回方式
    if (ui['rooms-hint']) ui['rooms-hint'].textContent = `你的存档：${name} · 存档码 ${derived}（换设备时填相同「昵称 + 存档码」即可找回）`;
    NET.listRooms();
  }
  function renderRooms(list) {
    const el = ui['room-list']; el.innerHTML = '';
    if (!list.length) { el.innerHTML = '<div class="room-empty">暂无房间 · 点击「创建房间」开局，好友通过你的局域网地址加入</div>'; return; }
    for (const r of list) {
      const div = document.createElement('div');
      div.className = 'room-row';
      const modeName = r.mode === 'raid' ? `团队副本 · ${DUNGEONS[r.dungeon]?.name || '熔火之心'}` : r.mode === 'dungeon' ? `冒险 · ${DUNGEONS[r.dungeon]?.name || '未知'}` : r.mode === 'td' ? '塔防模式 · 守卫艾泽拉斯之心' : '无尽模式';
      div.innerHTML = `<div><strong>${r.name}</strong><em>${modeName}</em></div><span class="room-count">${r.count}/${r.max}${r.started ? ' · 游戏中' : ''}</span>`;
      const btn = document.createElement('button');
      btn.className = 'room-join'; btn.textContent = r.started ? '进行中' : r.count >= 4 ? '已满' : '加入';
      btn.disabled = r.started || r.count >= 4;
      btn.addEventListener('click', () => NET.joinRoom(r.id, myLobbyHero || selectedHero));
      div.appendChild(btn);
      el.appendChild(div);
    }
  }
  function openLobby() { hideAll(); showScreen('lobby'); renderLobby(); }
  function renderLobby() {
    const room = NET.room; if (!room) return;
    const isRaid = room.mode === 'raid';
    const need = isRaid ? (DUNGEONS[room.dungeon]?.minPlayers || 4) : 1;
    ui['lobby-name'].textContent = room.name;
    ui['lobby-mode'].textContent = isRaid ? `团队副本 · ${DUNGEONS[room.dungeon]?.name || '熔火之心'} · ${need} 人`
      : room.mode === 'dungeon' ? `冒险副本 · ${DUNGEONS[room.dungeon]?.name || ''}`
        : room.mode === 'td' ? '塔防模式 · 守卫艾泽拉斯之心 · 最多 4 人'
          : '无尽模式 · 无尽围攻';
    const wrap = ui['lobby-slots']; wrap.innerHTML = '';
    for (let i = 0; i < 4; i++) {
      const pl = room.players[i];
      const div = document.createElement('div');
      if (!pl) { div.className = 'lobby-slot empty'; div.textContent = '等待玩家加入…'; }
      else {
        const h = heroes[pl.hero];
        div.className = 'lobby-slot filled' + (pl.id === NET.myId ? ' me' : '');
        div.innerHTML = `<span class="ls-name" style="color:${h.color}">${heroIconHtml(pl.hero, 24)} ${pl.name}${pl.host ? ' <em class="ls-host">[房主]</em>' : ''}</span><div class="ls-hero" style="color:${h.color}">${h.name}</div><span class="ls-state${pl.ready || pl.host ? ' ready' : ''}">${pl.host ? '房主' : pl.ready ? '✓ 已准备' : '未准备'}</span>`;
      }
      wrap.appendChild(div);
    }
    const mePl = room.players.find(p => p.id === NET.myId);
    document.querySelectorAll('.lobby-hero').forEach(b => b.classList.toggle('selected', b.dataset.hero === (mePl?.hero || 'mage')));
    const isHost = NET.isHost();
    ui['lobby-ready'].classList.toggle('hidden', isHost);
    ui['lobby-start'].classList.toggle('hidden', !isHost);
    if (!isHost) ui['lobby-ready'].textContent = mePl?.ready ? '取消准备' : '准备';
    else {
      const allReady = room.players.every(p => p.ready || p.host);
      // ★ 团队副本：房主也必须等满 4 人才能开始
      if (isRaid && room.players.length < need) {
        ui['lobby-start'].textContent = `等待 ${need} 名玩家（当前 ${room.players.length}/${need}）`;
        ui['lobby-start'].disabled = true;
      } else {
        ui['lobby-start'].textContent = allReady ? '开始游戏' : '等待全员准备…';
        ui['lobby-start'].disabled = false;
      }
    }
  }

  function updateBest() {
    let text = '';
    try {
      const best = JSON.parse(localStorage.getItem('azs-clean-best') || 'null');
      text = best ? `最佳纪录 · ${formatTime(best.time)} · ${best.kills} 击败 · ${heroes[best.hero].name}` : '首次远征 · 祝你好运，英雄';
    } catch { }
    ui.best.textContent = text; ui['home-best'].textContent = text;
    document.querySelectorAll('.hero').forEach(el => {
      const b = save.stats.best[el.dataset.hero];
      const sp = el.querySelector('.hero-best');
      if (sp) sp.textContent = b && b.time ? `最佳 ${formatTime(b.time)} · ${b.kills} 击败` : '尚无战绩';
    });
  }

  function announce(text, color = '#ffe3a4', seconds = 2.2) {
    ui.announcement.textContent = text; ui.announcement.style.color = color;
    ui.announcement.classList.add('show'); announcementTimer = seconds;
    if (game?.coop?.host) NET.sendAnn({ text, color, s: seconds }); // #51 主机公告同步
  }

  // ===== 背包 =====
  function addToBag(id, qty = 1) {
    const slot = save.bag.find(e => e.id === id);
    if (slot) { slot.qty += qty; return true; }
    if (save.bag.length >= 24) return false;
    save.bag.push({ id, qty }); return true;
  }
  function removeFromBag(idx, qty = 1) {
    const e = save.bag[idx]; if (!e) return;
    e.qty -= qty; if (e.qty <= 0) save.bag.splice(idx, 1);
  }
  function checkAchievements() {
    for (const a of ACHIEVEMENTS) {
      if (save.achievements.includes(a.id) || !a.check(save)) continue;
      save.achievements.push(a.id);
      let rewardText = '';
      if (a.reward?.gold) { save.gold += a.reward.gold; rewardText = ` · 奖励 ${a.reward.gold} 金币`; }
      if (a.reward?.plan) {
        if (addToBag(a.reward.plan, 1)) rewardText = ` · 奖励图纸已放入背包`;
        else { save.gold += 30; rewardText = ` · 背包已满，折算 30 金币`; }
      }
      if (a.reward?.potion) {
        rewardText = ` · ${grantPotion(a.reward.potion)}`;
      }
      persist(); toast(`成就解锁 · ${a.name}${rewardText}`);
    }
  }

  function previewStats(cls) {
    const h = heroes[cls];
    return { hp: h.hp, dmg: h.damage, spd: h.speed, armor: h.armor, crit: 8 };
  }

  function slotHtml(id, emptyLabel, hint) {
    if (!id) return `<span class="empty">＋</span><div><strong>${emptyLabel}</strong><small>${hint}</small></div>`;
    const it = itemInfo(id);
    const lvTxt = it.kind === 'potion' && (save.potionLvl[id] || 1) > 1 ? ` Lv.${save.potionLvl[id]}` : '';
    return `<span style="color:${it.color}">${itemIconHtml(id, 32)}</span><div><strong style="color:${it.color}">${it.name}${lvTxt}</strong><small>${hint} · 点击卸下</small></div>`;
  }

  function openBag() { bagClass = selectedHero; renderBag(); showScreen('backpack'); }

  function renderBag() {
    ui['bag-gold-total'].textContent = save.gold;
    document.querySelectorAll('.char-tab').forEach(b => b.classList.toggle('selected', b.dataset.class === bagClass));
    ui['char-name'].textContent = heroes[bagClass].name;
    ui['eq-potion'].innerHTML = slotHtml(save.potion, '未配置药水', '点击下方药水进行配置');
    // #44 药水收藏：显示等级与强化进度，点击配置/取消
    const pl = ui['pot-list'];
    pl.innerHTML = save.potions.length ? '' : '<span class="pot-empty">暂无药水 · 冒险第二位首领必掉治疗药水</span>';
    for (const id of save.potions) {
      const it = ITEMS[id];
      const lvl = save.potionLvl[id] || 1, xp = save.potionXp[id] || 0;
      const b = document.createElement('button');
      b.className = 'pot-chip' + (save.potion === id ? ' selected' : '');
      b.style.borderColor = it.color;
      b.innerHTML = `<span style="color:${it.color}">${itemIconHtml(id, 24)}</span> Lv.${lvl}` + (lvl < 5 ? `<em>${xp}/${lvl}</em>` : '<em>MAX</em>');
      b.title = `${it.name} Lv.${lvl} · ${it.desc}${lvl < 5 ? `\n强化进度 ${xp}/${lvl}（重复获得可强化）` : '\n已满级'}`;
      b.addEventListener('click', () => configPotion(id));
      pl.appendChild(b);
    }
    const st = previewStats(bagClass);
    ui['char-stats'].innerHTML = `生命 ${st.hp} · 伤害 ${st.dmg} · 护甲 ${st.armor}<br>移速 ${st.spd} · 暴击 ${st.crit}%`;
    ui['achv-list'].innerHTML = ACHIEVEMENTS.map(a =>
      `<span class="achv ${save.achievements.includes(a.id) ? 'unlocked' : ''}" title="${a.name} · ${a.desc}">${achievementIconHtml(a, 26)}</span>`).join('');
    const g = ui['bag-grid']; g.innerHTML = '';
    for (let i = 0; i < 24; i++) {
      const s = document.createElement('div'); s.className = 'bag-slot';
      const entry = save.bag[i];
      if (entry) {
        const it = itemInfo(entry.id);
        s.classList.add('has-item');
        if (it.kind === 'potion') s.style.borderColor = it.color;
        if (save.potion === entry.id) s.style.boxShadow = 'inset 0 0 14px rgba(233,189,103,.35)';
        s.innerHTML = `<span class="bag-item-icon" style="color:${it.color}">${itemIconHtml(entry.id, 38)}</span>${entry.qty > 1 ? `<em>${entry.qty}</em>` : ''}`;
        s.title = `${it.name} · ${it.desc || '材料（' + (it.from || '荒野') + '掉落，可出售）'}`;
        s.dataset.index = i;
      }
      g.appendChild(s);
    }
  }

  function itemActions(entry, idx) {
    const it = itemInfo(entry.id);
    const acts = [];
    if (it.kind === 'potion') {
      acts.push({ label: save.potion === entry.id ? '取消配置' : '配置为出战药水', fn: () => configPotion(entry.id) });
    } else if (it.kind === 'plan') {
      acts.push({ label: '使用 · 学习图样', fn: () => usePlan(idx) });
    }
    if (it.kind !== 'potion') acts.push({ label: `出售全部 · +${(it.sell || 1) * entry.qty} 金币`, fn: () => sellStack(idx) });
    return acts;
  }

  function openItemMenu(x, y, idx) {
    const entry = save.bag[idx]; if (!entry) return;
    const it = itemInfo(entry.id);
    const menu = ui['item-menu'];
    menu.innerHTML = `<div class="im-title"><span style="color:${it.color}">${itemIconHtml(entry.id, 30)}</span> <span style="color:${it.color || '#f0e2c0'}">${it.name}</span>${entry.qty > 1 ? ` ×${entry.qty}` : ''}</div><div class="im-affix">${it.desc || '材料 · 可出售换金币'}</div>`;
    for (const a of itemActions(entry, idx)) {
      const b = document.createElement('button'); b.textContent = a.label;
      b.addEventListener('click', () => { closeItemMenu(); a.fn(); });
      menu.appendChild(b);
    }
    menu.classList.remove('hidden');
    const mw = 230, mh = 66 + itemActions(entry, idx).length * 34;
    menu.style.left = Math.min(x, innerWidth - mw - 10) + 'px';
    menu.style.top = Math.min(y, innerHeight - mh - 10) + 'px';
  }
  function closeItemMenu() { ui['item-menu'].classList.add('hidden'); }

  function closeBag() { ui.backpack.classList.add('hidden'); ui.backpack.classList.remove('active'); closeItemMenu(); }

  function configPotion(id) {
    save.potion = save.potion === id ? null : id;
    persist(); renderBag();
    toast(save.potion ? `已配置 ${ITEMS[id].name}，冒险中按 E 使用` : '已取消配置');
  }
  function usePlan(idx) {
    const entry = save.bag[idx]; if (!entry) return;
    const it = ITEMS[entry.id];
    const g = GEAR[it.gearId];
    if (save.gearLearned.includes(it.gearId)) { toast('已经学会该图样了'); return; }
    // 第 18 项：专业默认已学习，不再需要「先学习专业」的前置条件
    save.gearLearned.push(it.gearId);
    removeFromBag(idx, 1);
    persist(); renderBag(); checkAchievements();
    toast(`学会了传说图样 · ${g.name}（冒险中有几率掉落）`);
  }
  function sellStack(idx) {
    const entry = save.bag[idx]; if (!entry) return;
    const it = itemInfo(entry.id);
    const gain = (it.sell || 1) * entry.qty;
    save.gold += gain;
    save.bag.splice(idx, 1);
    persist(); renderBag();
    toast(`出售 ${it.name} ×${entry.qty}，获得 ${gain} 金币`);
  }

  // ===== 成就页 =====
  function openAchievements() { hideAll(); showScreen('achievements'); renderAchievements(); }
  function renderAchievements() {
    // 第 9 项：成就分为「通用 / 冒险（副本） / 团本 / 无尽」四组
    const shown = ACHIEVEMENTS.filter(a => {
      if (achvFilter === 'all') return true;
      if (achvFilter === 'dungeon') return a.cat === 'dungeon';
      if (achvFilter === 'raid') return a.cat === 'raid';
      if (achvFilter === 'endless') return a.cat === 'endless';
      if (achvFilter === 'td') return a.cat === 'td';
      return a.cat !== 'dungeon' && a.cat !== 'raid' && a.cat !== 'endless' && a.cat !== 'td';
    });
    ui['achv-progress'].textContent = `${save.achievements.length} / ${ACHIEVEMENTS.length}`;
    document.querySelectorAll('.achv-tab').forEach(b => b.classList.toggle('selected', b.dataset.filter === achvFilter));
    const g = ui['achv-grid']; g.innerHTML = '';
    for (const a of shown) {
      const done = save.achievements.includes(a.id);
      const reward = a.reward?.gold ? `${a.reward.gold} 金币` : a.reward?.plan ? ITEMS[a.reward.plan].name : a.reward?.potion ? ITEMS[a.reward.potion].name : '';
      const card = document.createElement('div');
      card.className = 'achv-card' + (done ? ' done' : '');
      card.innerHTML = `<span class="achv-icon">${achievementIconHtml(a, 42)}</span><strong>${a.name}</strong><p>${a.desc}</p><em>${done ? '已达成' : '未达成'}${reward ? ` · 奖励：${reward}` : ''}</em>`;
      g.appendChild(card);
    }
  }

  // ===== 专业训练师（装备图谱）=====
  function openProfession() { hideAll(); showScreen('profession'); renderProfession(); }
  function renderProfession() {
    ui['prof-gold'].textContent = save.gold;
    const list = ui['prof-list']; list.innerHTML = '';
    for (const [pid, prof] of Object.entries(PROFESSIONS)) {
      // 第 18 项：专业默认已学习 —— 不再有「学习专业」分支，直接展示熟练度与图样清单
      const profXp = save.professions[pid] || 0;
      const card = document.createElement('div');
      card.className = 'prof-card learned';
      let html = `<span class="sk-icon">${professionIconHtml(pid, 38)}</span><strong>${prof.name}</strong><p>${prof.desc}</p>`;
      html += `<p class="prof-xp">已解锁 · 熟练度 ${profXp} / ${PROF_CAP} · 战斗中选择已研习的装备卡牌可提升 · 点击图样查看详情</p>`;
      // #46 图纸清单排序：专业研习图样按熟练度/品质从低到高 → boss 图纸 → 副本图纸（最后）
      const gearCat = (g) => g.dungeon ? 2 : g.plan ? 1 : 0;
      const rows = Object.entries(GEAR).filter(([, g]) => g.school === pid)
        .sort(([ia, a], [ib, b]) => gearCat(a) - gearCat(b) || a.rarity - b.rarity || (a.profReq || 0) - (b.profReq || 0) || (a.learn - b.learn) || a.name.localeCompare(b.name, 'zh'));
      html += '<div class="prof-recipes">';
      let lastCat = -1;
      for (const [gid, g] of rows) {
        const cat = gearCat(g);
        if (cat !== lastCat) { // 分组标题
          lastCat = cat;
          html += `<div class="recipe-cat">${['专业研习图样', '首领图纸', '副本套装图纸'][cat]}</div>`;
        }
        const rc = RARITY[g.rarity];
        const nameHtml = `<span style="color:${rc.color}">${gearIconHtml(gid, 26)} ${g.name}</span>`;
        if (save.gearLearned.includes(gid)) { html += `<div class="recipe-row got" data-gear="${gid}">${nameHtml}<em>已研习 · ${g.desc}</em></div>`; continue; }
        if (g.dungeon) { html += `<div class="recipe-row rare" data-gear="${gid}">${nameHtml}<em>通关「${DUNGEONS[g.dungeon].name}」后研习</em></div>`; continue; }
        if (g.plan) { html += `<div class="recipe-row rare" data-gear="${gid}">${nameHtml}<em>首领掉落图纸研习</em></div>`; continue; }
        if ((g.profReq || 0) > profXp) { html += `<div class="recipe-row locked" data-gear="${gid}">${nameHtml}<em>需要熟练度 ${g.profReq}</em></div>`; continue; }
        html += `<div class="recipe-row" data-gear="${gid}">${nameHtml}<button class="recipe-learn" data-gear="${gid}">研习 · ${g.learn} 金币</button></div>`;
      }
      html += '</div>';
      card.innerHTML = html; list.appendChild(card);
    }
  }
  // 第 18 项：专业本身默认已学习，不再有「花金币学习专业」流程（learnProfession 已移除）
  function learnGear(gid) {
    const g = GEAR[gid];
    if (!g) return;
    if (g.dungeon) { toast(`「${g.name}」需通关「${DUNGEONS[g.dungeon].name}」获得图纸`); return; }
    if (g.plan) { toast(`「${g.name}」需使用首领掉落的图纸研习`); return; }
    if ((g.profReq || 0) > (save.professions[g.school] || 0)) { toast(`需要「${PROFESSIONS[g.school].name}」熟练度 ${g.profReq}`); return; }
    if (save.gold < g.learn) { toast(`金币不足 · 需要 ${g.learn} 金币`); return; }
    save.gold -= g.learn; save.gearLearned.push(gid);
    persist(); renderProfession(); checkAchievements();
    toast(`研习了图样 · ${g.name}（${RARITY[g.rarity].name}）`);
  }

  // #45 装备详情弹窗：效果明细 + 套装效果 + 获取途径
  function openGearDetail(gid) {
    const g = GEAR[gid]; if (!g) return;
    const rc = RARITY[g.rarity];
    const d = g.dungeon ? DUNGEONS[g.dungeon] : (g.set ? Object.values(DUNGEONS).find(x => x.set === g.set) : null);
    const src = g.dungeon ? `通关「${d.name}」三选一研习`
      : g.plan ? '首领掉落图纸研习'
      : `专业研习 · ${g.learn} 金币${g.profReq ? `（需熟练度 ${g.profReq}）` : ''}`;
    const fxLines = fxDesc(g.fx).map(t => `<li>${t}</li>`).join('');
    const setHtml = d ? `<div class="gd-set"><strong>${d.setName}套装</strong>${Object.entries(d.setBonuses).map(([n, t]) => `<span>${n} 件 · ${t}</span>`).join('')}</div>` : '';
    ui['gd-body'].innerHTML = `<div class="gd-head"><span class="gd-icon">${gearIconHtml(gid, 48)}</span><div><strong style="color:${rc.color}">${g.name}</strong><em style="color:${rc.color}">${rc.name} · ${heroes[g.cls].name} · ${PROFESSIONS[g.school].name}</em></div></div><p class="gd-src">${src}</p><ul class="gd-fx">${fxLines || `<li>${g.desc}</li>`}</ul>${g.spec ? `<p class="gd-src">强化特化（每级）：${fxDesc(g.spec).join('，')}</p>` : ''}${setHtml}`;
    ui['gear-detail'].classList.remove('hidden'); ui['gear-detail'].classList.add('active');
  }
  function closeGearDetail() { ui['gear-detail'].classList.add('hidden'); ui['gear-detail'].classList.remove('active'); }

  // ===== 职业训练师 =====
  function openTrainer() {
    hideAll(); showScreen('trainer'); renderTrainer();
  }
  function renderTrainer() {
    ui['trainer-gold'].textContent = save.gold;
    document.querySelectorAll('.trainer-tab').forEach(b => b.classList.toggle('selected', b.dataset.class === trainerClass));
    const eq = save.equipped[trainerClass];
    // 第 20 项：4 个主动技能槽位（active / active2 / active3 / active4）
    const slots = [['basic', ui['equip-basic'], '基础技能'],
      ...ACTIVE_SLOTS.map(sl => [sl.key, ui['equip-' + sl.key], sl.label])];
    for (const [kind, el, label] of slots) {
      if (!el) continue;
      const def = eq[kind] ? skillDef(trainerClass, eq[kind]) : null;
      el.innerHTML = def
        ? `<span class="svg-slot">${skillIconHtml(def.id, heroes[trainerClass].color, 28)}</span><div><strong>${def.name}</strong><small>${label} · 右键卸下</small></div>`
        : `<span class="empty">＋</span><div><strong>未装备</strong><small>${label}</small></div>`;
    }
    const list = ui['skill-list']; list.innerHTML = '';
    for (const s of SKILLS[trainerClass]) {
      const learned = save.learned[trainerClass].includes(s.id);
      const equipped = s.kind === 'basic'
        ? eq.basic === s.id
        : ACTIVE_SLOT_KEYS.some(k => eq[k] === s.id);
      const card = document.createElement('button');
      card.className = 'skill-card' + (equipped ? ' equipped' : learned ? ' learned' : '');
      const footer = equipped ? '已装备 · 右键卸下' : learned ? '已学习 · 点击装备' : `${s.cost} 金币 · 点击学习`;
      card.innerHTML = `<span class="sk-icon">${skillIconHtml(s.id, heroes[trainerClass].color, 36)}</span><strong>${s.name}</strong><span class="sk-kind">${s.kind === 'basic' ? '基础技能 · 自动攻击' : '主动技能 · Q / R / C / V 释放'}</span><p>${s.desc}</p><span class="sk-cost">${footer}</span>`;
      card.addEventListener('click', () => {
        if (!save.learned[trainerClass].includes(s.id)) {
          if (save.gold < s.cost) { toast(`金币不足 · 需要 ${s.cost} 金币`); return; }
          save.gold -= s.cost; save.learned[trainerClass].push(s.id);
          if (s.kind === 'basic') { if (!eq.basic) eq.basic = s.id; }
          else if (!ACTIVE_SLOT_KEYS.some(k => eq[k])) eq.active = s.id;
          toast(`已学会 ${s.name}`);
        } else if (s.kind === 'basic') {
          eq.basic = s.id;
          toast(`已装备 ${s.name}`);
        } else {
          // 第 20 项：主动技能 —— 装入第一个空槽；4 槽全满则替换最后一个槽
          const empty = ACTIVE_SLOT_KEYS.find(k => !eq[k]);
          if (ACTIVE_SLOT_KEYS.some(k => eq[k] === s.id)) {
            toast(`已装备 ${s.name}`);
          } else if (empty) {
            eq[empty] = s.id;
            toast(`已装备 ${s.name}`);
          } else {
            const last = ACTIVE_SLOT_KEYS[ACTIVE_SLOT_KEYS.length - 1];
            eq[last] = s.id;
            toast(`已装备 ${s.name}（替换${ACTIVE_SLOTS[ACTIVE_SLOTS.length - 1].label.split(' · ')[0]}）`);
          }
        }
        persist(); renderTrainer();
      });
      card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (!save.learned[trainerClass].includes(s.id)) return;
        if (s.kind === 'basic') eq.basic = eq.basic === s.id ? null : s.id;
        else for (const k of ACTIVE_SLOT_KEYS) if (eq[k] === s.id) eq[k] = null;
        persist(); renderTrainer();
      });
      list.appendChild(card);
    }
  }

  // ===== 战斗 =====
  // #54 联机刷怪锚点：以队伍质心为圆心，半径随队伍分散度扩大（队友散开时各方都有压力）
  function spawnAnchor() {
    const p = game.player;
    if (!game.coop) return { x: p.x, y: p.y, spread: 0 };
    const pts = [[p.x, p.y]];
    for (const al of game.allies.values()) if (!al.dead) pts.push([al.x, al.y]);
    const cx = pts.reduce((s, q) => s + q[0], 0) / pts.length;
    const cy = pts.reduce((s, q) => s + q[1], 0) / pts.length;
    const spread = Math.min(Math.max(...pts.map(q => Math.hypot(q[0] - cx, q[1] - cy)), 0), 500);
    return { x: cx, y: cy, spread };
  }
  function spawnEnemy(forceBoss = false) {
    const p = game.player;
    const angle = rand(0, TAU);
    const anc = spawnAnchor();
    const radius = Math.hypot(width, height) * .55 + 90 + anc.spread;
    const t = game.elapsed;
    const dg = game.dungeon;
    const scale = 1 + t / 125; // #43 强度随时间接轨（放缓前期曲线）
    // #51 联机难度：随玩家数量增强（生命 +60%/人，伤害 +25%/人，首领 +80%/人）
    const cn = game.playerCount || 1;
    const hpMul = 1 + .6 * (cn - 1), dmgMul = 1 + .25 * (cn - 1), bossMul = 1 + .8 * (cn - 1);
    const nid = () => (game._nid = (game._nid || 0) + 1);

    if (forceBoss) {
      // ===== 第 10/9 项：首领统一走 BOSS_ROSTER 名册 =====
      // 副本：按副本顺序取该副本 5 位首领；无尽模式：轮换全部 22 位（副本首领全部进入无尽池）
      const idx = game.bossIndex;
      const dgBoss = dg ? dg.bosses[Math.min(idx, dg.bosses.length - 1)] : null;
      const def = dgBoss != null ? BOSS_ROSTER[dgBoss] : BOSS_ROSTER[idx % BOSS_ROSTER.length];
      const isFinal = !!dgBoss && idx >= dg.bosses.length - 1; // 副本最后一位为尾王，击杀即通关
      // 首领强度曲线：副本随进度递增（首领中等 → 尾王最强）；无尽随时间线性增强
      // 熔火之心：9 位首领走独立曲线（生命成长放缓、时间系数更缓，避免 4 人时数值爆表）
      const isRaid = !!dg && dg.type === 'raid';
      const hp = (dg ? (isRaid ? (620 + idx * 240) : (760 + idx * 340)) * def.hp : (620 + idx * 300) * def.hp) * bossMul;
      const e = { type: 'boss', name: def.name, x: anc.x + Math.cos(angle) * radius, y: anc.y + Math.sin(angle) * radius,
        r: 38, hp, maxHp: hp, speed: 52 * (1 + Math.min(t / 1200, .18)), damage: (isRaid ? (18 + idx * 1.8) : (22 + idx * 2.2)) * (1 + t / (isRaid ? 1000 : 700)) * dmgMul * def.dmg,
        xp: 130 + (dg ? idx * 30 : 0), color: dg ? dg.accent : '#c46b4f', hitCd: 0, shootCd: rand(1, 2.5), specialCd: 3.5, flash: 0, dead: false, boss: true,
        isFinal, variant: dgBoss != null ? dgBoss : idx % BOSS_ROSTER.length, kind: def.kind, spine: def.spine,
        spriteKey: 'boss' + (idx % 3 + 1), tint: dg ? dg.hue : null,
        phase: rand(0, TAU), slow: 0, slowT: 0, burnT: 0, burnDps: 0, poisT: 0, poisDps: 0, stunT: 0, bleedT: 0, bleedDps: 0, dotAcc: 0, dotTick: 0, killedBy: null, spawnT: .3, atkT: 0, nid: nid() };
      // 熔火之心：多技能调度（每个技能独立冷却，轮转释放；尾王 6 个技能）
      // 注：团本首领也按约定下沉无尽轮换池，但多技能仅在团本生效（无尽有 45 秒狂暴时限）
      if (def.raid && def.skills && isRaid) {
        e.raidSkills = def.skills;
        e.skillCd = def.skills.map(s => s.cd * rand(.45, .85));
        e.skillIdx = 0;
      }
      game.enemies.push(e);
      game.bossIndex++;
      game.bossAliveT = 0;
      // 第 9 项：记录无尽模式见过的首领（用于「无尽首领图鉴」成就）
      if (!dg) { game.endlessBossSeen = game.endlessBossSeen || []; if (!game.endlessBossSeen.includes(e.name)) game.endlessBossSeen.push(e.name); }
      ui['boss-wrap'].classList.remove('hidden'); ui['boss-name'].textContent = e.name;
      announce(`首领来袭 · ${e.name}`, '#f1a277', 3); game.shake = 10;
      return e;
    }

    // 副本小怪池：按时间解锁远程/坦克
    if (dg) {
      const pool = dg.mobs.filter(m => m.arch === 'melee' || m.arch === 'fast' || (m.arch === 'ranged' && t > 40) || (m.arch === 'tank' && t > 80));
      const m = pool[Math.floor(Math.random() * pool.length)];
      const hp = m.hp * scale * hpMul;
      const e = { type: { melee: 'gnoll', fast: 'wolf', ranged: 'cultist', tank: 'golem' }[m.arch], name: m.name,
        x: anc.x + Math.cos(angle) * radius, y: anc.y + Math.sin(angle) * radius,
        r: m.r, hp, maxHp: hp, speed: m.speed * (1 + Math.min(t / 1200, .18)), damage: m.damage * (1 + t / 500) * dmgMul,
        xp: m.xp, color: m.color, hitCd: 0, shootCd: rand(1, 2.5), specialCd: 3.5, flash: 0, dead: false, boss: false,
        variant: 0, spriteKey: m.spine || { melee: 'gnoll', fast: 'wolf', ranged: 'cultist', tank: 'golem' }[m.arch], tint: dg.hue,
        spine: m.spine || null, // 熔火之心小怪使用独立 Spine 模型
        phase: rand(0, TAU), slow: 0, slowT: 0, burnT: 0, burnDps: 0, poisT: 0, poisDps: 0, stunT: 0, bleedT: 0, bleedDps: 0, dotAcc: 0, dotTick: 0, killedBy: null, spawnT: .3, atkT: 0, nid: nid() };
      game.enemies.push(e);
      return e;
    }

    // 冒险模式（无尽）：原版怪物池（#55 扩充 4 种新小怪，随时间解锁）
    let type = 'gnoll';
    const roll = Math.random();
    if (t > 200 && roll < .09) type = 'wraith';
    else if (t > 170 && roll < .2) type = 'troll';
    else if (t > 150 && roll < .3) type = 'skeleton';
    else if (t > 130 && roll < .38) type = 'golem';
    else if (t > 110 && roll < .44) type = 'felhound';
    else if (t > 100 && roll < .5) type = 'ooze';
    else if (t > 75 && roll < .58) type = 'cultist';
    else if (t > 60 && roll < .66) type = 'spider';
    else if (t > 35 && roll < .72) type = 'murloc';
    else if (t > 20 && roll < .84) type = 'wolf';
    const defs = {
      gnoll: { r: 15, hp: 42, speed: 75, damage: 10, xp: 10, color: '#a58a64', name: '豺狼人' },
      wolf: { r: 12, hp: 30, speed: 142, damage: 8, xp: 9, color: '#7e93a8', name: '幽灵狼' },
      murloc: { r: 12, hp: 28, speed: 125, damage: 8, xp: 9, color: '#68a888', name: '鱼人' },
      cultist: { r: 15, hp: 55, speed: 58, damage: 9, xp: 14, color: '#9c6aac', name: '暗影教徒' },
      ooze: { r: 18, hp: 120, speed: 34, damage: 12, xp: 18, color: '#6a9c7a', name: '软泥怪' },
      troll: { r: 14, hp: 70, speed: 64, damage: 11, xp: 16, color: '#7ea86a', name: '巨魔猎头者' },
      golem: { r: 24, hp: 170, speed: 43, damage: 18, xp: 25, color: '#87918b', name: '岩石傀儡' },
      spider: { r: 11, hp: 34, speed: 150, damage: 7, xp: 9, color: '#7a5f8c', name: '蛛魔' }, // #55
      felhound: { r: 13, hp: 52, speed: 138, damage: 11, xp: 13, color: '#b05a8a', name: '恶魔猎犬' }, // #55
      skeleton: { r: 15, hp: 95, speed: 68, damage: 13, xp: 17, color: '#c8c4b4', name: '骷髅武士' }, // #55
      wraith: { r: 14, hp: 66, speed: 60, damage: 10, xp: 18, color: '#8fb6c9', name: '哀嚎怨灵' } // #55
    };
    const d = defs[type];
    const hp = d.hp * scale * hpMul;
    // 无尽后期精英化：200 秒后 12% 概率出现精英（更大更强、掉落更丰）
    const elite = t > 200 && Math.random() < .12;
    const e = { type, name: elite ? '精英·' + d.name : d.name, x: anc.x + Math.cos(angle) * radius, y: anc.y + Math.sin(angle) * radius,
      r: d.r * (elite ? 1.35 : 1), hp: elite ? hp * 1.8 : hp, maxHp: elite ? hp * 1.8 : hp,
      speed: d.speed * (1 + Math.min(t / 1200, .18)), damage: d.damage * (1 + t / 500) * (elite ? 1.3 : 1) * dmgMul,
      xp: d.xp * (elite ? 2 : 1), color: d.color, hitCd: 0, shootCd: rand(1, 2.5), specialCd: 3.5, flash: 0, dead: false, boss: false,
      variant: 0, spriteKey: type, tint: elite ? 300 : null, elite,
      phase: rand(0, TAU), slow: 0, slowT: 0, burnT: 0, burnDps: 0, poisT: 0, poisDps: 0, stunT: 0, bleedT: 0, bleedDps: 0, dotAcc: 0, dotTick: 0, killedBy: null, spawnT: .3, atkT: 0, nid: nid() };
    game.enemies.push(e);
    return e;
  }

  function nearestEnemy(maxRange = Infinity) {
    // ★ 塔防模式：只在「阵位覆盖半径」内找目标 —— 覆盖圈外的怪不是你的猎物，
    //   否则烈焰风暴这类「落在最近目标身上」的技能会把火圈丢到覆盖圈外。
    if (game?.gameMode === 'td') maxRange = Math.min(maxRange, tdReach());
    let best = null, bestD = maxRange;
    for (const e of game.enemies) {
      if (e.dead) continue;
      const d = distance(game.player, e) - e.r;
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }
  // #51 主机端：敌人攻击目标 = 最近的存活英雄（自己或队友）
  function nearestHero(e) {
    const p = game.player;
    let best = { x: p.x, y: p.y, r: p.r, id: null }, bd = distance(e, p);
    if (p.downed) { best = null; bd = Infinity; }
    for (const al of game.allies?.values() || []) {
      if (al.dead) continue;
      const d = distance(e, al);
      if (d < bd) { bd = d; best = { x: al.x, y: al.y, r: 17, id: al.id }; }
    }
    return best || { x: p.x, y: p.y, r: p.r, id: null };
  }

  /* ★ HUNTER_HOOK · ⑤：猎人钩子上下文 —— 把内部结算函数安全地交给 hunter.js。
     独立文件 hunter.js 不持有 game.js 的内部状态，全部能力通过这个 ctx 注入，
     因此并行任务改动 game.js 的战斗逻辑时不会与猎人平衡实现互相污染。 */
  const hunterCtx = () => ({
    p: game.player, game, distance,
    damageEnemy, aoeDamage, applyPoison, applyBurn, applyBleed, applyStun, applySlow,
    boltPoints, FX
  });
  function applySlow(e, amount, dur) {
    if (e.boss) { amount *= .5; dur *= .6; }
    amount *= 1 + (game?.player.gearFx.slowBonus || 0);
    e.slow = Math.max(e.slow || 0, amount); e.slowT = Math.max(e.slowT || 0, dur);
  }
  function applyBurn(e, dps, dur) {
    if (e.boss) dur *= .6;
    if (setHas('flame', 3)) { dps *= 1.6; dur *= 1.35; } // 烈焰 3 件套：燃烧伤害提高且持续更久
    /* ★ HUNTER_HOOK · ⑥：猎人灼烧伤害强化（倍率在 hunter.js） */
    const hkB = window.HUNTER?.dotBoost?.('burn', e, dps, dur, game.player);
    if (hkB) { dps = hkB.dps; dur = hkB.dur; }
    e.burnDps = Math.max(e.burnDps || 0, dps); e.burnT = Math.max(e.burnT || 0, dur);
  }
  function applyPoison(e, dps, dur) {
    if (e.boss) dur *= .6;
    if (setHas('blight', 3)) { dps *= 1.6; dur *= 1.3; } // 凋零 3 件套：中毒伤害提高且持续更久
    /* ★ HUNTER_HOOK · ⑦：猎人中毒伤害强化（倍率在 hunter.js） */
    const hkP = window.HUNTER?.dotBoost?.('poison', e, dps, dur, game.player);
    if (hkP) { dps = hkP.dps; dur = hkP.dur; }
    e.poisDps = Math.max(e.poisDps || 0, dps); e.poisT = Math.max(e.poisT || 0, dur);
  }
  // ===== 需求 12：撕裂之爪（兽王专属流血 debuff）=====
  function applyBleed(e, dps, dur) {
    if (e.boss) dur *= .6;
    /* ★ HUNTER_HOOK · ⑧：猎人流血伤害强化（倍率在 hunter.js） */
    const hkL = window.HUNTER?.dotBoost?.('bleed', e, dps, dur, game.player);
    if (hkL) { dps = hkL.dps; dur = hkL.dur; }
    e.bleedDps = Math.max(e.bleedDps || 0, dps); e.bleedT = Math.max(e.bleedT || 0, dur);
  }
  function applyStun(e, dur) {
    if (e.boss) dur *= .4;
    e.stunT = Math.max(e.stunT || 0, dur);
  }
  function dotDamage(e, amt, color) {
    if (e.dead) return;
    e.hp -= amt; game.totalDamage += amt;
    e.dotAcc = (e.dotAcc || 0) + amt; e.dotTick = (e.dotTick || 0);
    if (e.dotAcc >= 6 && e.dotTick <= 0) {
      game.texts.push({ x: e.x + rand(-8, 8), y: e.y - e.r - 6, text: Math.round(e.dotAcc), color, life: .55, size: 10 });
      e.dotAcc = 0; e.dotTick = .5;
    }
    if (e.hp <= 0) { e.killedByPlayer = localPlayerId(); killEnemy(e); } // ★ DOT 源自本地（主机）效果，击杀归属本地
  }

  function attackRate(p) {
    let r = p.rate;
    if (p.skillBasic === 'frostbolt') r *= 1.18 * Math.pow(.82, p.mods.fingers || 0);
    if (p.skillBasic === 'aimed_shot') r *= 1.6 * Math.pow(.85, p.mods.aim_rate || 0);
    if (p.skillBasic === 'fireball') r *= 1.35;
    if (p.skillBasic === 'slam') r *= 1.3;
    if (p.skillBasic === 'serpent_sting') r *= 1.1;
    if (p.furyT > 0) r *= .75;
    if (p.rapidT > 0) r *= .6;
    if (setHas('shadow', 2)) r *= .92; // 影牙 2 件套
    // #50 主动技能 buff
    if (p.veinsT > 0) r *= 1 - (.25 + .13 * (p.mods.iv_power || 0)); // 冰冷血脉
    if (p.brT > 0) r *= 1 - (.3 + .1 * (p.mods.br_haste || 0)); // 狂暴之怒
    if (p.chHasteT > 0) r *= .85; // 冲锋·气势如虹
    if (p.mshStormT > 0) r *= .7; // 箭矢风暴
    if (p.abRecoilT > 0) r *= .85; // 奥术冲击·余波
    if (p.aspectT > 0 && p.mods.aw_haste) r *= .85; // 野性守护·猎豹迅捷
    // 需求 12：猎手专注（守护期间攻速 +10%/级）
    if (p.aspectT > 0 && p.mods.aw_regen) r *= 1 - .1 * (p.mods.aw_regen || 0);
    // 需求 12：狩猎连击（击杀后 2 秒攻速 +25%）
    if (p.kcFocusT > 0) r *= .8;
    return Math.max(.1, r);
  }

  // ===== 需求 12：猎人定位为「注重射击范围」的输出 =====
  // 瞄准射击（远程狙击卡）放大索敌与射程；急速射击期间（全域视野卡）全体攻击距离放大。
  function attackRange(p) {
    let r = p.range;
    // ★ 塔防模式：普攻射程 = 阵位覆盖半径。
    //   阵位离路径 104~132 码，若沿用职业原射程（战士 118 / 法师 560 / 猎人 580），
    //   战士根本够不到路、法师猎人又溢出覆盖圈 → 「覆盖半径」类卡牌对谁都无意义。
    //   统一成覆盖半径后：阵位 = 你的火力圈，进圈的怪就是你的目标。
    //   注意 playerAttack 里 reach = base0 * (attackRange(p)/p.range)，
    //   比值刚好抵消 p.range 的差异，因此这里改 r 即可。
    if (game?.gameMode === 'td') return tdReach();
      if (p.type === 'hunter') {
        if (p.skillBasic === 'aimed_shot') r *= 1 + .25 * (p.mods.aim_range || 0);
        if (p.rapidT > 0) r *= 1 + .2 * (p.mods.rapid_range || 0);
        // 需求 12：荒野奔袭 → 野性守护期间攻击距离 +20%/级
        if (p.aspectT > 0 && p.mods.aw_dodge) r *= 1 + .2 * (p.mods.aw_dodge || 0);
      }
    return r;
  }

  function playerAttack() {
    const p = game.player;
    const mod = (id) => p.mods[id] || 0;
    const base0 = p.skillBasic === 'bloodthirst' ? p.range * 1.4 : p.range;
    const reach = base0 * (attackRange(p) / p.range);
    const target = nearestEnemy(reach);
    if (!target) return;
    const base = Math.atan2(target.y - p.y, target.x - p.x);
    const skill = p.skillBasic;
    /* ★ HUNTER_HOOK · ②：记录本次普攻生成的投射物，供 hunter.js 追加额外箭矢 / 穿透加成 */
    const hProjBefore = game.projectiles.length;

    if (skill === 'whirlwind') {
      const r = skillAreaRadius('whirlwind', p); // 无尽怒火
      // 双弧剑锋
      game.effects.push({ type: 'slash', x: p.x, y: p.y, r: 10, maxR: r, life: .26, maxLife: .26, color: '#f3b47d', a0: rand(0, TAU) });
      game.effects.push({ type: 'slash', x: p.x, y: p.y, r: 10, maxR: r * .82, life: .22, maxLife: .22, color: '#ffe0b0', a0: rand(0, TAU) });
      // ★ 塔防模式：旋风判定为「三段斩」—— 只打范围内最靠近心脏的 3 个目标。
      //   原因：塔防里技能范围 = 阵位覆盖半径（320 码），若旋风能打满整圈，
      //   战士会变成纯 AoE 职业（实测 1 人局只漏 20 只，而法师 41、猎人 64 → 严重失衡）。
      //   限 3 目标后战士回到 40，只靠「剑刃风暴」提供 AoE，与法师/猎人同档。
      const hits = game.gameMode === 'td'
        ? game.enemies.filter(e => !e.dead && distance(p, e) < r + e.r)
          .sort((a, b) => (b.tdT ?? 0) - (a.tdT ?? 0)).slice(0, 3)
        : game.enemies.filter(e => !e.dead && distance(p, e) < r + e.r);
      for (const e of hits) {
        damageEnemy(e, p.damage, Math.atan2(e.y - p.y, e.x - p.x), 'whirlwind');
      }
    } else if (skill === 'bloodthirst') {
      game.effects.push({ type: 'slash', x: target.x, y: target.y, r: 6, maxR: 50, life: .2, maxLife: .2, color: '#e77a63' });
      const dealt = p.damage * 1.5;
      damageEnemy(target, dealt, base, 'bloodthirst');
      p.hp = Math.min(p.maxHp, p.hp + dealt * .08);
      if (mod('sweep')) for (const e of game.enemies) {
        if (!e.dead && e !== target && distance(e, target) < 80 + e.r) damageEnemy(e, p.damage * (mod('rampage') ? 1.5 : .75), Math.atan2(e.y - target.y, e.x - target.x), 'bloodthirst');
      }
      if (mod('cleave')) {
        let second = null, bestD = Infinity;
        for (const e of game.enemies) {
          if (e.dead || e === target) continue;
          const d = distance(p, e);
          if (d < reach + 50 && d < bestD) { bestD = d; second = e; }
        }
        if (second) damageEnemy(second, p.damage * 1.1, Math.atan2(second.y - p.y, second.x - p.x), 'bloodthirst');
      }
    } else if (skill === 'thunderclap') {
      const r = skillAreaRadius('thunderclap', p);
      game.effects.push({ type: 'warning', x: p.x, y: p.y, r: 14, maxR: r, life: .32, maxLife: .32, color: '#8fd8ef' });
      // 雷霆电弧：向四周放射的锯齿闪电
      for (let i = 0; i < 6; i++) {
        const ba = i / 6 * TAU + rand(-.25, .25);
        game.effects.push({ type: 'bolt', pts: boltPoints(p.x, p.y, p.x + Math.cos(ba) * r * rand(.7, 1), p.y + Math.sin(ba) * r * rand(.7, 1), 6), life: .2, maxLife: .2, color: '#9fe4ff', w: 3 });
      }
      const dmg = p.damage * .95 * (p.revenge ? 1.8 : 1);
      p.revenge = false;
      for (const e of game.enemies) {
        if (!e.dead && distance(p, e) < r + e.r) { damageEnemy(e, dmg, Math.atan2(e.y - p.y, e.x - p.x), 'thunderclap'); applySlow(e, mod('shock') ? .6 : .4, 2.5); }
      }
      // 雷神的愤怒：3 道追踪闪电
      if (mod('thorim')) {
        const nearest = game.enemies.filter(e => !e.dead).sort((a, b) => distance(p, a) - distance(p, b)).slice(0, 3);
        for (const e of nearest) {
          game.effects.push({ type: 'bolt', pts: boltPoints(p.x, p.y, e.x, e.y, 5), life: .22, maxLife: .22, color: '#bfeaff', w: 4 });
          damageEnemy(e, p.damage * .7, Math.atan2(e.y - p.y, e.x - p.x), 'thunderclap');
        }
      }
    } else if (skill === 'aimed_shot') {
      const count = 1 + p.multishot; // 修复：分裂攻击对瞄准射击生效
      // 需求 12：破甲重箭 → 伤害提高 35%/级，并使命中目标易伤 20%（3 秒）
      const aimPower = 1 + .35 * mod('aim_power');
      const aimVuln = mod('aim_power') ? .2 : 0;
      const aimLife = attackRange(p) / (760 * p.projectileSpeed) + .15;
      for (let i = 0; i < count; i++) {
        const a = base + (i - (count - 1) / 2) * .1;
        game.projectiles.push({ x: p.x + Math.cos(a) * 22, y: p.y + Math.sin(a) * 22,
          vx: Math.cos(a) * 760 * p.projectileSpeed, vy: Math.sin(a) * 760 * p.projectileSpeed,
          r: 8, damage: p.damage * 2.3 * aimPower, life: aimLife,
          color: '#ffd98a', pierce: p.pierce + 2 + mod('piercing_arrow'), hit: new Set(), skill: 'aimed_shot',
          critBonus: mod('aim_crit') ? .2 : 0, vuln: aimVuln, vulnDur: 3 });
      }
    } else if (skill === 'fireball') {
      const count = 1 + p.multishot; // 修复：分裂攻击对火球术生效
      // 需求 13：火球术异化 —— 溅射范围更大、必定点燃、燃烧更久
      const fbRange = 70 * (mod('pyroblast') ? 1.6 : 1) * (1 + .25 * (mod('fireball_range') || 0));
      for (let i = 0; i < count; i++) {
        const a = base + (i - (count - 1) / 2) * .12;
        game.projectiles.push({ x: p.x + Math.cos(a) * 22, y: p.y + Math.sin(a) * 22,
          vx: Math.cos(a) * 540 * p.projectileSpeed, vy: Math.sin(a) * 540 * p.projectileSpeed,
          r: 8, damage: p.damage * 1.3, life: p.range / (540 * p.projectileSpeed) + .12,
          color: '#f28a52', pierce: 0, hit: new Set(), skill: 'fireball',
          splash: fbRange, splashDmg: mod('pyroblast') ? 1 : .7,
          ignite: true, wildfire: mod('wildfire') > 0 });
      }
    } else if (skill === 'serpent_sting') {
      const count = 1 + p.multishot;
      for (let i = 0; i < count; i++) {
        const a = base + (i - (count - 1) / 2) * .13;
        game.projectiles.push({ x: p.x + Math.cos(a) * 22, y: p.y + Math.sin(a) * 22,
          vx: Math.cos(a) * 620 * p.projectileSpeed, vy: Math.sin(a) * 620 * p.projectileSpeed,
          r: 4, damage: p.damage * .7, life: p.range / (620 * p.projectileSpeed) + .12,
          color: '#9fd86a', pierce: p.pierce, hit: new Set(), skill: 'serpent_sting',
          poison: p.damage * .25 * (1 + .4 * mod('venom')) * (1 + (p.gearFx.poisonBonus || 0)) });
      }
    } else if (skill === 'slam') {
      game.effects.push({ type: 'slash', x: target.x, y: target.y, r: 8, maxR: 60, life: .22, maxLife: .22, color: '#e8c97d' });
      game.effects.push({ type: 'warning', x: target.x, y: target.y, r: 8, maxR: 66, life: .3, maxLife: .3, color: '#c9b18a' });
      FX.burst(target.x, target.y, '#c9b18a', 10, { speed: 150, grav: 300, size: 3, glow: false }); // 砸地尘土
      const stunDur = mod('stun_len') ? 2 : 1;
      const execMult = target.stunT > 0 ? 1 + .4 * mod('executioner') : 1; // 处决者
      damageEnemy(target, p.damage * (mod('heavy_slam') ? 2.6 : 2) * execMult, base, 'slam');
      applyStun(target, stunDur);
      if (mod('stun_burst')) for (const e of game.enemies) {
        if (!e.dead && e !== target && distance(e, target) < 90 + e.r) damageEnemy(e, p.damage, Math.atan2(e.y - target.y, e.x - target.x), 'slam');
      }
    } else if (skill === 'frostbolt') {
      const count = 1 + p.multishot; // 修复：分裂攻击对寒冰箭生效
      // 需求 13：寒冰箭异化 —— 减速 50% / 3 秒（深度冻结 70% / 4.2 秒）+ 冰封领域冻结
      for (let i = 0; i < count; i++) {
        const a = base + (i - (count - 1) / 2) * .12;
        game.projectiles.push({ x: p.x + Math.cos(a) * 22, y: p.y + Math.sin(a) * 22,
          vx: Math.cos(a) * 620 * p.projectileSpeed, vy: Math.sin(a) * 620 * p.projectileSpeed,
          r: 7, damage: p.damage * 1.45, life: p.range / (620 * p.projectileSpeed) + .12,
          color: '#9fe4ff', pierce: p.pierce, hit: new Set(), skill: 'frostbolt',
          slow: mod('deepfreeze') ? .7 : .5, slowDur: mod('deepfreeze') ? 4.2 : 3,
          chill: mod('chill') > 0, shatter: mod('shatter') > 0,
          freeze: mod('frost_chill') ? (mod('frost_chill') > 1 ? 1.4 : 1) : 0 });
      }
    } else { // 奥术飞弹 / 双重射击
      p.atkCount = (p.atkCount || 0) + 1;
      let count = 1 + p.multishot + (p.type === 'hunter' ? 1 : 0);
      if (skill === 'arcane_missiles' && mod('barrage') && p.atkCount % 4 === 0) count += 2; // 弹幕风暴
      // 需求 13：奥术飞弹异化 —— 奥术伤害天生更高（+30%），并可额外穿透 / 提升射程
      let volleyDmg = p.damage * (p.skillBasic === 'double_shot' ? 1 + .15 * mod('twin_focus') : 1.3);
      if (skill === 'arcane_missiles') volleyDmg *= 1 + .2 * mod('arcane_echo'); // 奥术回响
      if (skill === 'double_shot' && mod('bullseye')) volleyDmg *= 1 + .15 * p.multishot; // 百发百中
      const arcaneVel = skill === 'arcane_missiles' ? (1 + .15 * (mod('arcane_velocity') || 0)) : 1;
      const arcaneLife = skill === 'arcane_missiles' ? p.range * arcaneVel : p.range;
        for (let i = 0; i < count; i++) {
          const a = base + (i - (count - 1) / 2) * .13;
          game.projectiles.push({ x: p.x + Math.cos(a) * 22, y: p.y + Math.sin(a) * 22,
            vx: Math.cos(a) * 620 * p.projectileSpeed * arcaneVel, vy: Math.sin(a) * 620 * p.projectileSpeed * arcaneVel,
            r: p.type === 'mage' ? 6 : 4, damage: volleyDmg, life: arcaneLife / (620 * p.projectileSpeed * arcaneVel) + .12,
            // ★ 塔防模式：猎人普攻额外贯穿 1 个目标（弓手沿路径贯穿怪群）。
            //   与「多重射击」同一套塔防契约：猎人在塔防里的多目标能力来自贯穿，而非 AoE。
            color: p.type === 'mage' ? '#7de7ff' : '#d4e99b',
            pierce: p.pierce + (skill === 'arcane_missiles' ? mod('arcane_pierce') : 0)
              + (game?.gameMode === 'td' && p.type === 'hunter' ? 1 : 0),
            hit: new Set(), skill });
        }
    }
    /* ★ HUNTER_HOOK · ③：猎人普攻发箭（额外箭矢「箭雨齐射 / 双生弩箭」与「贯穿毒刃」的穿透加成） */
    if (window.HUNTER) window.HUNTER.onAttack({ ...hunterCtx(), skill, base, newProj: game.projectiles.slice(hProjBefore) });
    p.attackTimer = attackRate(p);
    p.atkAnim = .14; // 攻击动作脉冲
    spawnBasicSpine(skill, p, target, base);
    castFxNet({ s: skill, x: p.x | 0, y: p.y | 0, a: +base.toFixed(2) }); // #54 广播真实弹道
    // 奥术洪流（传说卡牌 / 法师紫装宝珠）：概率额外飞弹
    const surgeChance = (p.surge || 0) + (p.gearFx.surgeChance || 0);
    if (surgeChance && Math.random() < surgeChance) {
      for (const off of [-.2, .2]) {
        const a = base + off;
        game.projectiles.push({ x: p.x + Math.cos(a) * 22, y: p.y + Math.sin(a) * 22,
          vx: Math.cos(a) * 620 * p.projectileSpeed, vy: Math.sin(a) * 620 * p.projectileSpeed,
          r: 5, damage: p.damage * .7, life: p.range / (620 * p.projectileSpeed) + .12,
          color: '#7de7ff', pierce: 1, hit: new Set(), skill: 'arcane_missiles' });
      }
    }
    // ===== 熔火 T1 五件套：普攻 5% 概率发动全屏烈焰技能 =====
    if (setHasCls('moltencore', p.type, 5)) tryMoltenFive(p);
    // ===== 熔火之心团本橙装：普攻 5% 概率在最近敌人脚下召唤岩浆池 =====
    tryMoltenCore(p, target);
  }
  // 熔火 T1 五件套触发（按职业分化）
  function tryMoltenFive(p) {
    if (!p || p.downed || Math.random() >= .05) return;
    const cls = p.type;
    // 特效尺寸必须等于伤害半径（用户指定：特效范围即伤害范围）
    const cfg = cls === 'mage' ? { r: 520, mul: 2.4, name: '熔火新星', color: '#ff8a3c' }
      : cls === 'warrior' ? { r: 560, mul: 2.6, name: '熔岩践踏', color: '#ff6b2c' }
        : { r: 500, mul: 2.2, name: '烈焰箭雨', color: '#ffa64d' };
    const r = cfg.r;
    spawnSpineFx('mage_fire', p.x, p.y, { life: 1.1, size: r * 2, fit: 'diameter', alpha: .95, timeScale: 1.4 });
    game.effects.push({ type: 'warning', x: p.x, y: p.y, r: 16, maxR: r, life: .4, maxLife: .4, color: cfg.color });
    FX.burst(p.x, p.y, cfg.color, 26, { speed: 280, grav: 120 });
    for (const e of game.enemies) {
      if (e.dead || distance(p, e) > r + e.r) continue;
      let dmg = p.damage * cfg.mul;
      if (cls === 'hunter' && e.burnT > 0) dmg *= 1.25;   // 猎人：对灼烧目标额外 +25%
      damageEnemy(e, dmg, Math.atan2(e.y - p.y, e.x - p.x), 'molten_five');
      applyBurn(e, p.damage * .18, 3);
      if (cls === 'mage') applyStun(e, 1.5);              // 法师：附带定身
      if (cls === 'warrior') {                            // 战士：击退制造走位空间
        const a = Math.atan2(e.y - p.y, e.x - p.x);
        if (!e.boss) { e.x += Math.cos(a) * 60; e.y += Math.sin(a) * 60; }
      }
    }
    game.shake = Math.max(game.shake, 9);
    announce(`${cfg.name} · 五件套发动`, cfg.color, 1.4);
  }

  // ===== 熔火之心团本橙装：特效「熔火之心」=====
  // 需求 4：萨弗拉斯·炎魔之手重做 —— 较高基础数值 + 新特效「熔火之心」。
  // 触发：自动攻击有 5% 概率在最近敌人脚下召唤岩浆池（首击高伤 + 后续持续伤害 + 燃烧）。
  // 触发概率 / 岩浆池范围 / 持续时间均可通过专属强化卡提升（4 张独立可升级卡）。
  //
  // 等级存储：game.gear 中该橙装条目的 molten 字段（与通用强化 lvl 分离，互不影响）
  //   { id:'warrior_sulfuras', lvl:1, molten:{ dmg:0, chance:0, radius:0, dur:0 } }
  const MOLTEN_BASE = { chance: .05, radius: 90, duration: 5, firstHit: 2.6, tickDmg: .45, burnDur: 2 };
  const MOLTEN_CARDS = [
    { id: 'molten_dmg', icon: '☄', name: '熔火之心·炽热核心', rar: 4, max: 3,
      desc: '岩浆池首击与持续伤害提高 40%（每级）',
      detail: m => `首击 ${Math.round(MOLTEN_BASE.firstHit * m.dmgMul * 100)}% 武器伤害 · 每秒 ${Math.round(MOLTEN_BASE.tickDmg * m.dmgMul * 100)}% 武器伤害` },
    { id: 'molten_chance', icon: '◈', name: '熔火之心·引燃符文', rar: 3, max: 3,
      desc: '熔火之心触发概率提高 4%（每级）',
      detail: m => `当前触发概率 ${Math.round(m.chance * 100)}%（初始 5%）` },
    { id: 'molten_radius', icon: '⊕', name: '熔火之心·熔岩扩散', rar: 3, max: 3,
      desc: '岩浆池范围扩大 25 码（每级）',
      detail: m => `当前岩浆池半径 ${Math.round(m.radius)} 码（初始 90）` },
    { id: 'molten_dur', icon: '⧗', name: '熔火之心·不熄之炎', rar: 3, max: 3,
      desc: '岩浆池持续时间延长 1.5 秒（每级）',
      detail: m => `当前持续 ${m.duration.toFixed(1)} 秒（初始 5）· 燃烧 ${m.burnDur.toFixed(1)} 秒` }
  ];
  // 找到玩家当前携带的熔火橙装条目（若同时带多件，取强化等级最高的一件）
  function moltenGearEntry(p) {
    if (!game || !game.gear) return null;
    const lvOf = c => MOLTEN_CARDS.reduce((n, card) => n + (c.molten?.[card.id] || 0), 0);
    let best = null;
    for (const c of game.gear) {
      const g = GEAR[c.id];
      if (!g || !g.fx || !g.fx.moltenCore) continue;
      if (!best || lvOf(c) > lvOf(best)) best = c;
    }
    return best;
  }
  // 读取熔火之心当前全部参数（受 4 张强化卡影响）
  // 存储键与卡片 id 一致：molten_dmg / molten_chance / molten_radius / molten_dur
  function moltenParams(p) {
    const entry = moltenGearEntry(p);
    const m = entry?.molten || {};
    const dmgMul = (1 + .4 * (m.molten_dmg || 0)) * (1 + .25 * (p?.gearFx?.moltenPower || 0));
    return {
      chance: MOLTEN_BASE.chance + .04 * (m.molten_chance || 0),
      radius: MOLTEN_BASE.radius + 25 * (m.molten_radius || 0),
      duration: MOLTEN_BASE.duration + 1.5 * (m.molten_dur || 0),
      burnDur: MOLTEN_BASE.burnDur + .5 * (m.molten_dur || 0),
      firstHit: MOLTEN_BASE.firstHit * dmgMul,
      tickDmg: MOLTEN_BASE.tickDmg * dmgMul,
      dmgMul
    };
  }
  // 在目标脚下召唤岩浆池（首击 + 持续 + 燃烧）
  function spawnMoltenPool(x, y, p) {
    const mp = moltenParams(p);
    const r = mp.radius;
    // 特效范围 = 伤害范围（用户要求）
    spawnSpineFx('fx_magma_pool', x, y, { life: 1.4, size: r * 2, fit: 'diameter', alpha: .95, timeScale: 1.2 });
    game.effects.push({ type: 'warning', x, y, r: 14, maxR: r, life: .4, maxLife: .4, color: '#ff7a2c' });
    FX.burst(x, y, '#ff7a2c', 20, { speed: 230, grav: 110 });
    // 首击：高额范围伤害 + 点燃
    aoeDamage(x, y, r, p.damage * mp.firstHit, 'molten_core', { burn: p.damage * .2 * mp.dmgMul, burnDur: mp.burnDur });
    // 持续：区域每 0.5 秒结算一次伤害与燃烧
    game.zones.push({ x, y, r, life: mp.duration, maxLife: mp.duration, tick: 0, dmg: p.damage * mp.tickDmg * .5,
      slow: 0, burn: p.damage * .08 * mp.dmgMul, burnDur: mp.burnDur, magma: true, spine: 'fx_magma_pool' });
    game.shake = Math.max(game.shake, 4);
  }
  // 普攻触发熔火之心（5% 基础概率，在最近敌人脚下）
  function tryMoltenCore(p, target) {
    if (!p || p.downed || !p.gearFx?.moltenCore) return;
    if (!target) return;
    const mp = moltenParams(p);
    if (Math.random() >= mp.chance) return;
    spawnMoltenPool(target.x, target.y, p);
    game.texts.push({ x: target.x, y: target.y - 34, text: '熔火之心', color: '#ff9a4d', life: 1, size: 13 });
  }

  function hitWithProjectile(q, e) {
    const p = game.player;
    let dmg = q.damage;
    let critBonus = q.critBonus || 0;
    if (q.skill === 'frostbolt') {
      spawnSpineFx('mage_ice', e.x, e.y, { life: .65, size: q.chill ? 180 : 64, fit: 'diameter', alpha: .86, timeScale: 1.7 });
      if (q.shatter && e.slowT > 0) dmg *= 1.5;
      if (p.mods.frost_mastery && e.slowT > 0) critBonus += .25;
      applySlow(e, q.slow, q.slowDur);
      // 需求 13：冰封领域 → 命中冻结目标（首领减半）
      if (q.freeze) applyStun(e, e.boss ? q.freeze * .4 : q.freeze);
      if (q.chill) for (const o of game.enemies) {
        if (!o.dead && o !== e && distance(o, e) < 90 + o.r) applySlow(o, .3, 1.6);
      }
    }
    if (q.skill === 'fireball') {
      spawnSpineFx('common_explosion', e.x, e.y, { life: .9, size: q.splash * 2, fit: 'diameter', alpha: .88, timeScale: 2.05 });
      // 需求 13：火球异化 —— 燃烧更久更强（燃烬 +2 秒 / 烈焰附魔 +60%）
      const burnDur = 3 + 2 * (p.mods.embers || 0);
      const burnDmg = p.damage * .18 * (1 + .6 * (p.mods.ignite || 0));
      if (q.ignite) applyBurn(e, burnDmg, burnDur);
      if (p.mods.scorch && e.burnT > 0) critBonus += .2;
      game.effects.push({ type: 'warning', x: e.x, y: e.y, r: 8, maxR: q.splash, life: .22, maxLife: .22, color: '#f28a52' });
      for (const o of game.enemies) {
        if (o.dead || o === e || distance(o, e) >= q.splash + o.r) continue;
        damageEnemy(o, q.damage * q.splashDmg, Math.atan2(o.y - e.y, o.x - e.x), 'fireball');
        if (q.wildfire) applyBurn(o, burnDmg, burnDur);
      }
      // 流星火雨：2 颗陨石坠落
      if (p.mods.meteor) for (let i = 0; i < 2; i++) {
        game.meteors.push({ x: e.x + rand(-70, 70), y: e.y + rand(-70, 70), t: .55 + i * .15, r: 62, dmg: p.damage * .5 });
      }
    }
    if (q.skill === 'serpent_sting') {
      applyPoison(e, q.poison, 4 + (p.gearFx.poisonDur || 0));
      // 需求 12：毒雾扩散 → 钉刺命中时对目标周围 70 码/级 的敌人施加中毒
      const vr = p.mods.venom_range || 0;
      if (vr > 0) for (const o of game.enemies) {
        if (o.dead || o === e) continue;
        if (distance(o, e) < 70 * vr + o.r) applyPoison(o, q.poison * .8, 4);
      }
    }
    if (q.skill === 'aimed_shot' && p.mods.deadly_duo && p.rapidT > 0) critBonus = 1;
    // 需求 12：破甲重箭 → 命中目标易伤 20%（3 秒）
    if (q.vuln) { e.vulnT = Math.max(e.vulnT || 0, q.vulnDur || 3); e.vulnAmt = Math.max(e.vulnAmt || 0, q.vuln); }
    damageEnemy(e, dmg, Math.atan2(q.vy, q.vx), q.skill, critBonus);
    /* ★ HUNTER_HOOK · ④：猎人投射物命中钩子 —— 全部 AOE 效果的主入口
       （爆裂箭簇 / 雷链穿心 / 毒云领域 / 贯穿毒刃 / 裂血箭簇 / 贯穿爆裂 / 淬毒箭雨） */
    if (window.HUNTER) window.HUNTER.onProjHit({ ...hunterCtx(), q, e });
  }

  function damageEnemy(e, amount, angle = 0, skill = null, critBonus = 0) {
    if (e.dead) return;
    const p = game.player;
    // 装备与药水的伤害修正
    let mult = 1;
    if (skill && p.mods[skill + '_dmg']) mult += (window.HUNTER?.masteryPerLevel?.(p) ?? .12) * p.mods[skill + '_dmg']; // 精研（猎人 18%/级，其余 12%）
    if (p.gearFx.killStacks) mult += Math.min(.3, Math.floor(p.kills / 10) * .02);
    if (p.gearFx.castSurge && p.castSurgeT > 0) mult += p.gearFx.castSurge;
    if (p.gearFx.furyDmg && p.furyT > 0) mult += p.gearFx.furyDmg;
    if (p.potDmgT > 0) mult += .2;
    if (p.potMutT > 0 && e.hp / e.maxHp < .35) mult += .3;
    if (p.gearFx.executeBonus && e.hp / e.maxHp < .35) mult += p.gearFx.executeBonus;
    if (p.dashSurgeT > 0) mult += .25; // 影牙 3 件套
    if (p.mods.absolute_zero && e.slowT > 0) mult += .2; // 绝对零度
    if (setHas('fang', 5)) mult *= markDamageMult(e); // 尖牙 5 件套：猎杀印记
    if (p.dashSurgeT > 0 && setHas('fang', 3)) mult += .1; // 尖牙 3 件套：暴击伤害提高
    if (e.vulnT > 0) mult += e.vulnAmt || .15; // 易伤（冰封陵墓/致死打击等）
    if (p.msMomT > 0) mult += .15; // 乘胜追击
    if (p.veinsT > 0 && p.mods.iv_surge) mult += .12; // 极寒倾泻
    amount *= mult;
    /* ★ HUNTER_HOOK · ⑨：猎人所有技能伤害统一提升 —— 在 damageEnemy 单点收口，
       倍率表（各技能分别微调）与「疾猎 / 荒野猎杀」的期间加成全部在 hunter.js。 */
    if (p.type === 'hunter') amount *= (window.HUNTER?.damageMult?.(skill, p) ?? 1);
    const critical = Math.random() < p.crit + critBonus + (setHas('fang', 3) ? .12 : 0) + (p.rapidT > 0 && p.mods.focus ? .15 : 0)
      + (p.veinsT > 0 && p.mods.iv_crit ? .15 : 0) + (p.brT > 0 && p.mods.br_fury ? .12 : 0)
      + (p.aspectT > 0 && p.mods.aw_focus ? .1 : 0) + (p.mods.ft_brittle && e.stunT > 0 ? .2 : 0);
    const dealt = amount * (critical ? p.critDmg : 1) * rand(.92, 1.08);
    if (critical && setHas('fang', 5)) applyMark(e, 1); // 尖牙 5 件套：暴击叠印记
    e.hp -= dealt; e.flash = .1; e.killedBy = skill; game.totalDamage += dealt;
    e.killedByPlayer = curAttacker || (game.coop ? NET.myId : null);
    // 吸血药水
    if (p.potLeechT > 0) p.hp = Math.min(p.maxHp, p.hp + dealt * .15);
    // 狂暴之怒吸血
    if (p.brT > 0) p.hp = Math.min(p.maxHp, p.hp + dealt * (.08 + .06 * (p.mods.br_leech || 0)));
    // 装备攻击特效：点燃 / 淬毒；套装效果：烈焰 2 件 / 凋零 2 件
    if (skill && p.gearFx.burnOnHit) applyBurn(e, p.damage * p.gearFx.burnOnHit, 2);
    if (skill && p.gearFx.poisonOnHit) applyPoison(e, p.damage * p.gearFx.poisonOnHit, 3);
    if (skill && setHas('flame', 2)) applyBurn(e, p.damage * .12, 2);
    if (skill && setHas('blight', 2)) applyPoison(e, p.damage * .1, 3);
    if (e.type !== 'golem' && !e.boss) { e.x += Math.cos(angle) * 5; e.y += Math.sin(angle) * 5; }
    game.texts.push({ x: e.x + rand(-8,8), y: e.y - e.r, text: Math.round(dealt), color: critical ? '#ffe179' : '#f2e8d5', life: .7, size: critical ? 18 : 13 });
    burst(e.x, e.y, critical ? '#ffe179' : e.color, critical ? 7 : 3);
    // #51 客户端：上报伤害给主机，击杀以主机广播为准
    if (game.coop && !game.coop.host) {
      if (e.nid) NET.sendEv({ k: 'dmg', id: e.nid, d: Math.round(dealt), s: skill });
      if (e.hp <= 0) { e.dead = true; FX.burst(e.x, e.y, e.color || '#cfe0d8', 8, { speed: 140, grav: 180 }); }
      return;
    }
    if (e.hp <= 0) killEnemy(e);
  }

  // 联机模式下的本地玩家 id（单机 / 未连接时 NET.myId 为 null）
  function localPlayerId() { return (typeof NET !== 'undefined' && NET.myId) ? NET.myId : null; }

  function killEnemy(e) {
    if (e.dead) return;
    e.dead = true; const p = game.player;
    const isTd = game.gameMode === 'td';
    // ===== 第 51 项修复（联机结算金币变 0）：击杀归属与记账主体必须一致 =====
    // 主机是权威结算方。队友击杀的金币既不能被主机代领（重复发放），
    // 也不能因归属丢失而谁都拿不到（结算页金币为 0）。
    // 做法：主机判定击杀者 → 主机自己击杀记自己的账；队友击杀则把本次金币增量
    // 随 kill 快照下发，由被归属的那位玩家自行入账。
    const inCoop = !!game.coop;
    const cooph = !!game.coop?.host;
    const myId = localPlayerId();
    const killerId = cooph ? (e.killedByPlayer || myId) : myId;
    const killerIsMe = !inCoop || killerId === myId;
    // 联机客户端不做本地记账（金币与击杀数由主机按归属下发，避免重复或漏记）
    const awardLocally = !inCoop || (cooph && killerIsMe);
    if (awardLocally) p.kills++;
    // 移动端触觉：只有「自己击杀」才震动（队友击杀不该震自己的手）
    if (awardLocally) haptic(e.boss || e.elite ? 'bigKill' : 'kill');
    // ===== 第 9 项：无尽模式只产成就与药水，不产金币与装备 =====
    const endless = game.gameMode !== 'dungeon';
    if (e.killedBy === 'bloodthirst' && p.mods.fury) p.furyT = 5;
    const pieces = e.boss ? 14 : e.type === 'golem' ? 3 : 1;
    // ★ 塔防模式：英雄不能自由移动 → 经验宝石永远拾取不到，改为「击杀直接给经验」。
    if (isTd) {
      gainXp(e.xp);
    } else {
      for (let i = 0; i < pieces; i++) game.gems.push({ x: e.x + rand(-18,18), y: e.y + rand(-18,18), r: e.boss ? 7 : 5, value: e.xp / pieces, vx: rand(-35,35), vy: rand(-35,35), color: e.boss ? '#ffd66e' : '#67d5d7' });
    }
    // 金币只在冒险（副本）模式产出；goldGain = 本次击杀的权威金币增量（随快照下发）
    let goldGain = 0;
    if (!endless || isTd) { // 金币在冒险（副本）与塔防模式产出
      // goldGain = 基础金币增量（由主机裁定并随快照下发，保证两端账目一致）
      goldGain = e.boss ? 50 : Math.random() < .25 ? 2 : 1;
      if (isTd) goldGain = Math.round(goldGain * (1 + (TDR.goldBonus || 0)));
      if (awardLocally) {
        p.gold += goldGain;
        // goldFind 属各人装备效果（未联机同步），由击杀者本人本地结算
        if (p.gearFx.goldFind && Math.random() < p.gearFx.goldFind) p.gold += 1;
      }
    }
    burst(e.x, e.y, e.color, e.boss ? 35 : 10);
    // 死亡动效：碎裂粒子 + 上升魂灵
    FX.burst(e.x, e.y, e.color, e.boss ? 30 : 8, { speed: e.boss ? 240 : 130, grav: 200, size: 3 });
    if (!e.boss && Math.random() < .5) FX.emit({ x: e.x, y: e.y, vx: rand(-8, 8), vy: -46, life: .9, maxLife: .9, color: FX.alpha(e.color.startsWith('#') ? e.color : '#cfe0d8', .8), size: 3.5, glow: true });
    // ===== 装备卡牌掉落：与金币同一原则 —— 记账主体必须是击杀者 =====
    // 主机是权威方：本地击杀 → 主机自己加 gearDrops；队友击杀 → 主机**不加**，
    // 改为随 kill 快照下发权威数量，由击杀者本人弹卡。
    // 否则会出现两个问题：
    //   ① 主机代领队友的「掉落空池折算 +20 金币」（队友少拿、主机白拿）；
    //   ② 客户端自己也随机掷一次掉落点 → 与主机重复，掉落率翻倍且两端不同步。
    let gearDropCount = 0;
    if (!endless) { // 无尽模式不产装备卡牌
      if (e.boss) gearDropCount = 1;            // 首领必定爆出装备卡牌
      else {
        if (Math.random() < (game.gameMode === 'dungeon' ? .03 : .025)) gearDropCount++;
        if (e.elite && Math.random() < .1) gearDropCount++; // 精英额外概率
      }
    }
    if (gearDropCount && awardLocally) game.gearDrops += gearDropCount;
    // ===== 塔防「局内核心」的权威数量（★ 必须按击杀归属收口）=====
    //   主机替队友加核心 = 队友白打一场；而客户端自己掷掉落点 = 两端不一致。
    //   正确做法：主机算出权威数量 → 随 kill 快照下发 → 击杀者本人入账。
    //   ★★ 「是否掉落」的随机数判定必须留在下方 else 分支的**原位置** ——
    //     中间隔着 burst()/FX.burst()（内部也吃 Math.random），
    //     提前求值会让整个随机序列错位 → 单机 TD 的掉落/暴击率全变 → e2e 断言会飘。
    let tdCoreAward = 0;
    // 掉落：首领必掉生命精华与装备卡牌，概率掉无尽药水与装备图纸；小怪不再掉落材料（#40）
    if (e.boss) {
      if (isTd) {
        // ★ 塔防：首领只产「局内核心」（塔防版的装备卡），不产药水/材料/图纸/装备卡
        //   —— 塔防的持久产出改由成就系统给金币。
        //   ★ 实际入账在下方统一按归属结算（awardLocally），这里只管尾王判定。
        tdCoreAward = 3;
        // 尾王被击杀 → 通关结算（由 tdUpdate 每帧检查 pendingFinal）
        if (e.tdBoss && TDR.wave >= TD.WAVES.total) TDR.finalBossState = 'killed';
      } else {
      if (!endless) addLoot('essence', 2, e.x, e.y); // 无尽模式不产材料（材料可卖钱 → 变相产金币）
      const bossNo = (game.bossKills || 0) + 1;
      // ===== 第 9 项：无尽模式首领必掉药水（无尽模式的唯一产出之一）=====
      if (endless) {
        const locked = POTION_IDS.filter(id => !save.potions.includes(id));
        const dropId = locked.length ? locked[Math.floor(Math.random() * locked.length)] : 'pot_heal';
        addLoot(dropId, 1, e.x, e.y - 32);
      } else if (game.gameMode === 'adventure' && bossNo === 2 && !save.potions.includes('pot_heal')) {
        addLoot('pot_heal', 1, e.x, e.y - 32);
      } else {
        const locked = POTION_IDS.filter(id => !save.potions.includes(id));
        if (locked.length && Math.random() < .3) addLoot(locked[Math.floor(Math.random() * locked.length)], 1, e.x, e.y - 32);
      }
      // #45 首领 25% 概率掉落未研习的装备图纸 —— 仅冒险（副本）模式
      if (!endless) {
        const lockedPlans = BOSS_PLANS.filter(pid => !save.gearLearned.includes(ITEMS[pid].gearId));
        if (lockedPlans.length && Math.random() < .25) addLoot(lockedPlans[Math.floor(Math.random() * lockedPlans.length)], 1, e.x, e.y - 64);
        // ★ 装备卡牌掉落已在上方统一按「击杀归属」结算（gearDropCount），此处不再重复计
      }
      }   // ← 非塔防分支结束
    } else {
      if (!endless && e.elite && Math.random() < .5) addLoot('essence', 1, e.x, e.y); // 精英额外掉落
      if (isTd) {
        // ★ 塔防：产出「局内核心」（TD 版的装备卡）—— 击杀时掉落、三选一弹出、不暂停。
        //   注意：绝不写 save.gearLearned / save.bag —— 塔防不产可入库的装备。
        //   ★★ 这里的 Math.random() 调用位置与旧逻辑完全一致 —— 挪动会让整个随机序列错位。
        const dropChance = e.elite ? .18 : .035;
        if (Math.random() < dropChance) tdCoreAward = 1;
      }
      // ★ 装备卡牌掉落已在上方统一按「击杀归属」结算（gearDropCount）
    }
    // ★ 塔防：局内核心入账（★ 只给击杀者本人 —— 主机不替队友代领）
    if (isTd && awardLocally && tdCoreAward) game.tdCoreDrops += tdCoreAward;
    // #51 主机广播击杀（经验共享 / 击杀归属 / 死亡特效 / 权威金币与掉落增量）
    //   ★ 放在核心数量确定之后 —— 快照要带上权威的 core 数量。
    if (game.coop?.host) NET.sendSnap({ k: 'kill', id: e.nid, by: killerId || myId, x: e.x | 0, y: e.y | 0, xp: e.xp, boss: !!e.boss, color: e.color, gold: goldGain, gear: gearDropCount, core: tdCoreAward });
    // 复仇药水：击杀回血
    if (p.potRevengeT > 0) p.hp = Math.min(p.maxHp, p.hp + p.maxHp * .04);
    // 瘟疫传播：中毒目标死亡时传染周围敌人（技能卡或凋零 3 件套）
    if (e.poisT > 0 && (p.mods.spread || setHas('blight', 3))) for (const o of game.enemies) {
      if (!o.dead && o !== e && distance(o, e) < 110 + o.r) applyPoison(o, e.poisDps || p.damage * .2, 3);
    }
    // 第 10 项：五件套特异效果 —— 烈焰「熔核引爆」/ 凋零「亡者回响」
    if (e.burnT > 0 && setHas('flame', 5)) flameDetonate(e, p);
    if (e.poisT > 0 && setHas('blight', 5)) blightEcho(e, p);
    // 剧毒新星：中毒目标死亡时爆发
    if (e.poisT > 0 && p.mods.venom_nova) {
      game.effects.push({ type: 'warning', x: e.x, y: e.y, r: 10, maxR: 100, life: .3, maxLife: .3, color: '#9fd86a' });
      for (const o of game.enemies) {
        if (!o.dead && o !== e && distance(o, e) < 100 + o.r) damageEnemy(o, p.damage, Math.atan2(o.y - e.y, o.x - e.x), 'serpent_sting');
      }
      /* ★ HUNTER_HOOK · ⑯：剧毒新星附加中毒（数值在 hunter.js） */
      if (window.HUNTER) window.HUNTER.onPoisonDeath({ ...hunterCtx(), e });
    }
    // 无尽怒火：旋风斩击杀刷新狂暴
    if (e.killedBy === 'whirlwind' && p.mods.endless_rage) p.rageT = 2;
    // #50 击杀联动
    // ★ 乘胜追击：重置的是「冲锋技能自己」的冷却。
    //   旧写法只区分槽位 2 与其它（`p.chargeSlot === 2 ? activeCd2 : activeCd`），
    //   是 2 槽位时代的代码；4 槽位后冲锋若放在槽位 3/4，会误清槽位 1 的冷却
    //   → 玩家把震荡波放槽位 1、冲锋放槽位 3 时，每杀一个敌人就白嫖一次震荡波冷却
    //   → 震荡波变成无 CD 连发。这里改为按槽位号取对应冷却字段。
    if (e.killedBy === 'charge' && p.mods.ch_reset) {
      const cs = ACTIVE_SLOTS[(p.chargeSlot || 1) - 1] || ACTIVE_SLOTS[0];
      p[cs.cd] = 0;
    }
    if (p.veinsT > 0 && p.mods.iv_endless) p.veinsT = Math.min(12, p.veinsT + 1); // 永恒寒冬
    if (p.aspectT > 0 && p.mods.aw_apex) p.aspectT = Math.min((5 + 1.5 * (p.mods.aw_len || 0)) + 4, p.aspectT + .5); // 荒野之王
    if (e.killedBy === 'kill_command' && p.mods.kc_focus) p.kcFocusT = 2; // 狩猎连击：击杀后攻速提升
    if (e.killedBy === 'multi_shot' && p.mods.msh_storm) p.mshStormT = 2.5; // 箭矢风暴
    if (e.killedBy === 'mortal_strike' && p.mods.ms_momentum) p.msMomT = 5; // 乘胜追击（致死打击）
    // 尾王击杀 → 副本通关
    if (e.boss && e.isFinal && game.gameMode === 'dungeon') { endGame(true); return; }
    if (e.boss) { game.bossKills = (game.bossKills || 0) + 1; announce(`${e.name} 已被击败`, '#ffe094', 2.5); game.shake = 16; game.hitStop = .09; FX.ring(e.x, e.y, '#ffd66e', 28, { speed: 280 }); FX.burst(e.x, e.y, '#ffe094', 24, { speed: 200, grav: 160 }); }
  }

  function addLoot(id, qty, x, y) {
    game.loot[id] = (game.loot[id] || 0) + qty;
    if (game.coop?.host) NET.sendSnap({ k: 'loot', id, qty }); // #51 战利品全队共享
    const it = itemInfo(id);
    game.texts.push({ x: x + rand(-10, 10), y: y - 12, text: `+${it.name}`, color: it.color || '#ffd98a', life: 1, size: 11 });
  }

  function hurtPlayer(amount, src) {
    const p = game.player;
    if (p.invuln > 0 || mode !== 'playing' || p.downed) return;
    // 需求 12：猎人定位为纯输出 —— 野性守护不再提供闪避等保命效果（保留 25% 基础闪避作为技能本身的固有特性）
    // #47 特化：受击反减速攻击者
    if (src && p.gearFx.contactSlow) applySlow(src, p.gearFx.contactSlow, 1.2);
    let dealt = Math.max(1, amount - p.armor - (p.wallT > 0 ? 8 : 0) - (p.potArmorT > 0 ? 12 : 0) - (p.dsArmorT > 0 ? 6 : 0));
    if (p.dmgReduce) dealt *= 1 - p.dmgReduce;
    if (p.potReduceT > 0) dealt *= .7;
    if (p.chShieldT > 0) dealt *= .75; // 无畏壁垒
    if (p.mods.mi_shield && game.pets.some(pt => pt.mirror)) dealt *= .92; // 护主幻影
    // 狂暴之怒·以牙还牙：反弹近战伤害
    if (src && p.brT > 0 && p.mods.br_thorns) damageEnemy(src, amount * .35, Math.atan2(src.y - p.y, src.x - p.x), 'br_thorns');
    // 寒冰护体吸收
    if (p.barrierHp > 0) {
      const ab = Math.min(p.barrierHp, dealt);
      p.barrierHp -= ab; dealt -= ab;
      if (p.barrierHp <= 0) barrierBreak(p);
      if (dealt <= 0) { p.invuln = .45; burst(p.x, p.y, '#9fe4ff', 6); return; }
    }
    dealt = Math.max(1, dealt);
    p.hp -= dealt; p.invuln = .45; game.shake = 7; game.flash = .16; game.hitStop = Math.max(game.hitStop || 0, .035);
    haptic('hurt'); // 移动端：受伤震动反馈
    if (p.mods.revenge) p.revenge = true;
    game.texts.push({ x: p.x, y: p.y - 30, text: `-${Math.round(dealt)}`, color: '#ff8073', life: .8, size: 17 });
    burst(p.x, p.y, '#e96e60', 8);
    // 不灭之怒：狂暴期间免死一次
    if (p.hp <= 0 && p.brT > 0 && p.mods.br_undying && !p.brUsed) {
      p.hp = 1; p.invuln = 1.5; p.brUsed = true;
      announce('不灭之怒！', '#e87a5e', 1.5);
      FX.ring(p.x, p.y, '#e87a5e', 22, { speed: 260 });
      return;
    }
    if (p.hp <= 0) {
      // #51 联机：倒下观战，全队覆灭才失败
      if (game.coop) {
        p.hp = 0; p.downed = true;
        announce('你倒下了…… 队友仍在战斗', '#e96e60', 3);
        if (game.coop.host) checkAllDead();
        else NET.sendEv({ k: 'died' });
        return;
      }
      p.hp = 0; endGame(false);
    }
  }

  // ===== 熔火之心：地板延时预警系统（telegraph）=====
  // 敌方（首领）技能在地面标出红色区域，红色由淡转明，到期瞬间结算伤害。
  // 联机铁律：telegraph 必须进快照（客户端不跑 AI，否则看不见红区）；
  //             伤害只在主机结算，再经 hit 消息下发，客户端绝不本地判定（否则双倍伤害）。
  const TG_SHAPES = ['circle', 'ring', 'cone', 'cross', 'world'];
  function pushTelegraph(o) {
    const tg = {
      x: o.x, y: o.y, r: o.r || 100,
      shape: o.shape || 'circle', ang: o.ang || 0, half: o.half || .6,
      life: o.dur ?? 1.5, maxLife: o.dur ?? 1.5,
      dmg: o.dmg || 0, burn: o.burn || 0, stun: o.stun || 0, slow: o.slow || 0, knock: o.knock || 0,
      color: o.color || '#ff3b20', fx: o.fx || 'fx_ground_burst', label: o.label || '',
      spin: o.spin || 0
    };
    game.telegraphs.push(tg);
    return tg;
  }
  // 判定点是否落在预警区域内
  function inTelegraph(tg, px, py, pr = 0) {
    const dx = px - tg.x, dy = py - tg.y;
    const d = Math.hypot(dx, dy);
    if (tg.shape === 'world') return true;                       // 全屏
    if (tg.shape === 'ring') return d <= tg.r + pr && d >= tg.r * .55 - pr;  // 环形（安全圈在外）
    if (tg.shape === 'cone') {                                   // 扇形
      if (d > tg.r + pr) return false;
      if (d < 1) return true;
      const a = Math.atan2(dy, dx);
      let diff = Math.abs(((a - tg.ang + Math.PI * 3) % TAU) - Math.PI);
      return diff <= tg.half;
    }
    if (tg.shape === 'cross') {                                  // 十字裂隙
      const ax = Math.abs(dx), ay = Math.abs(dy);
      return (ax <= tg.r + pr && ay <= tg.r * .18 + pr) || (ay <= tg.r + pr && ax <= tg.r * .18 + pr);
    }
    return d <= tg.r + pr;                                      // 圆形
  }
  // 预警到期：主机结算伤害（本地英雄直接结算，队友经 hit 消息通知其客户端结算）
  function applyTelegraphDamage(tg) {
    const p = game.player;
    if (!p.downed && inTelegraph(tg, p.x, p.y, p.r)) {
      hurtPlayer(tg.dmg, null);
      if (tg.burn) hurtPlayer(tg.burn, null);
    }
    if (game.coop?.host && game.allies) {
      for (const al of game.allies.values()) {
        if (al.dead) continue;
        if (inTelegraph(tg, al.x, al.y, 17)) NET.sendSnap({ k: 'hit', to: al.id, d: Math.round(tg.dmg + (tg.burn || 0)) });
      }
    }
    // 击退（把站在红区里的本地英雄推开）
    if (tg.knock) {
      const a = Math.atan2(p.y - tg.y, p.x - tg.x) || rand(0, TAU);
      if (inTelegraph(tg, p.x, p.y, p.r)) { p.x += Math.cos(a) * tg.knock; p.y += Math.sin(a) * tg.knock; }
    }
  }
  // 预警推进：只由主机推进生命周期；客户端用快照插值显示
  function updateTelegraphs(dt) {
    if (!game.telegraphs) return;
    if (game.coop && !game.coop.host) return;   // 客户端不结算、也不推进（以快照为准）
    for (const tg of game.telegraphs) {
      tg.life -= dt;
      if (tg.spin) tg.ang += tg.spin * dt;
      if (tg.life <= 0 && !tg.fired) {
        tg.fired = true;
        applyTelegraphDamage(tg);
        if (tg.fx) spawnSpineFx(tg.fx, tg.x, tg.y, { life: .9, size: tg.r * 2, fit: 'diameter', alpha: .95, timeScale: 1.5, a: tg.ang });
        game.shake = Math.max(game.shake, tg.shape === 'world' ? 14 : 7);
        if (tg.label) announce(tg.label, '#ff8a5c', 1.4);
      }
    }
    game.telegraphs = game.telegraphs.filter(t => !t.fired);
  }
  // 预警渲染：红色由淡转明（alpha 二次缓动）+ 边框加粗 + 内圈收缩倒计时
  function drawTelegraph(tg) {
    const k = 1 - tg.life / tg.maxLife;             // 0 → 1
    const alpha = .10 + .55 * k * k;                // 先淡后迅速转明
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = tg.color;
    ctx.beginPath();
    if (tg.shape === 'world') {
      ctx.rect(-4000, -4000, 8000, 8000);
    } else if (tg.shape === 'ring') {
      ctx.arc(tg.x, tg.y, tg.r, 0, TAU);
      ctx.arc(tg.x, tg.y, tg.r * .55, 0, TAU, true);
    } else if (tg.shape === 'cone') {
      ctx.moveTo(tg.x, tg.y);
      ctx.arc(tg.x, tg.y, tg.r, tg.ang - tg.half, tg.ang + tg.half);
      ctx.closePath();
    } else if (tg.shape === 'cross') {
      const w = tg.r * .18;
      ctx.rect(tg.x - tg.r, tg.y - w, tg.r * 2, w * 2);
      ctx.rect(tg.x - w, tg.y - tg.r, w * 2, tg.r * 2);
    } else {
      ctx.arc(tg.x, tg.y, tg.r, 0, TAU);
    }
    ctx.fill('evenodd');
    // 边框
    ctx.globalAlpha = Math.min(1, alpha + .3);
    ctx.strokeStyle = tg.color;
    ctx.lineWidth = 2 + 3 * k;
    ctx.stroke();
    // 收缩倒计时环
    ctx.globalAlpha = .85;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(tg.x, tg.y, tg.r * (1 - k * .82), 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  // ===== 熔火之心：首领技能具体实现 =====
  // 每个技能要么直接产生伤害/召唤，要么先落红色预警（telegraph），到期再结算。
  // tgt 为最近英雄（联机时取队友），ang 为指向目标的角度。
  function castRaidSkill(e, sk, tgt) {
    const ang = Math.atan2(tgt.y - e.y, tgt.x - e.x);
    const dmg = e.damage;
    const P = (o) => pushTelegraph(o);
    switch (sk.id) {
      // ---- 路基弗隆·焚炉 ----
      case 'lg_blast_wave': // 爆炸波：环形冲击（安全圈在内）
        P({ x: e.x, y: e.y, r: 210, shape: 'ring', dur: 1.15, dmg: dmg * .85, knock: 150, color: '#ff4a1e', fx: 'fx_shock_ring', label: '爆炸波' });
        announce(`${e.name} 释放 · 爆炸波`, '#ff8a5c', 1.6);
        break;
      case 'lg_slag_splash': // 熔渣喷溅：3 连小范围地板爆点
        for (let i = 0; i < 3; i++) {
          const a = ang + rand(-.9, .9), d = rand(90, 220);
          P({ x: e.x + Math.cos(a) * d, y: e.y + Math.sin(a) * d, r: 78, shape: 'circle', dur: .85 + i * .18, dmg: dmg * .55, color: '#ff6b2c', fx: 'fx_ground_burst', label: i === 0 ? '熔渣喷溅' : '' });
        }
        announce(`${e.name} 释放 · 熔渣喷溅`, '#ff8a5c', 1.6);
        break;
      case 'lg_twin_roar': // 双头咆哮：自身周围红区 + 减速
        P({ x: e.x, y: e.y, r: 190, shape: 'circle', dur: 1.3, dmg: dmg * .7, slow: .45, color: '#ff4a1e', fx: 'fx_ground_fire', label: '双头咆哮' });
        break;
      // ---- 玛格达拉·熔岩 ----
      case 'mg_immolation': // 献祭火焰：点燃地面持续燃烧区
        P({ x: e.x, y: e.y, r: 165, shape: 'circle', dur: 1.4, dmg: dmg * .75, burn: dmg * .18, color: '#ff5a1e', fx: 'fx_ground_fire', label: '献祭火焰' });
        break;
      case 'mg_magma_spit': // 熔岩喷发：扇形喷吐 + 灼烧
        P({ x: e.x, y: e.y, r: 300, shape: 'cone', ang, half: .48, dur: 1.05, dmg: dmg * .95, burn: dmg * .15, color: '#ff6b2c', fx: 'fx_flame_breath', label: '熔岩喷发' });
        break;
      case 'mg_blazing_inferno': // 炽热召唤：召唤 3 只小怪
        for (let i = 0; i < 3; i++) { const m = spawnEnemy(); m.x = e.x + rand(-90, 90); m.y = e.y + rand(-90, 90); }
        for (let i = 0; i < 10; i++) shootEnemy(e, i / 10 * TAU, 200, 11);
        announce(`${e.name} 召唤了炽热仆从`, '#ff8a5c', 2);
        break;
      // ---- 沙兹拉克·渊影 ----
      case 'sz_fear_nova': // 恐惧新星：环形击退 + 恐惧
        P({ x: e.x, y: e.y, r: 235, shape: 'ring', dur: 1.0, dmg: dmg * .6, knock: 220, color: '#c283d3', fx: 'fx_shock_ring', label: '恐惧新星' });
        break;
      case 'sz_shadow_rain': // 暗影箭雨：多发追踪暗影弹
        for (let i = 0; i < 8; i++) shootEnemy(e, ang + rand(-1.2, 1.2), 320, 10);
        P({ x: tgt.x, y: tgt.y, r: 95, shape: 'circle', dur: .9, dmg: dmg * .5, color: '#c283d3', fx: 'fx_ground_burst', label: '暗影箭雨' });
        break;
      case 'sz_abyss_rift': // 深渊裂隙：十字形长条红区
        P({ x: tgt.x, y: tgt.y, r: 290, shape: 'cross', ang, dur: 1.45, dmg: dmg * 1.05, color: '#a05ad0', fx: 'fx_ground_burst', label: '深渊裂隙' });
        break;
      // ---- 古尔戈·岩拳 ----
      case 'gg_earthquake': // 大地践踏：大范围红区 + 眩晕
        P({ x: e.x, y: e.y, r: 260, shape: 'circle', dur: 1.5, dmg: dmg * .9, stun: 1.2, color: '#e8a45e', fx: 'fx_shock_ring', label: '大地践踏' });
        game.shake = Math.max(game.shake, 9);
        break;
      case 'gg_rock_lob': // 岩石飞掷：远程抛物线弹 + 落点爆点
        for (let i = 0; i < 2; i++) {
          const a = ang + rand(-.5, .5);
          P({ x: tgt.x + Math.cos(a) * rand(-90, 90), y: tgt.y + Math.sin(a) * rand(-90, 90), r: 88, shape: 'circle', dur: 1.1 + i * .2, dmg: dmg * .7, color: '#e8a45e', fx: 'fx_meteor_strike', label: i === 0 ? '岩石飞掷' : '' });
        }
        break;
      // ---- 金度·六爪 ----
      case 'jd_pounce': // 猛扑：瞬移到玩家侧
        P({ x: tgt.x, y: tgt.y, r: 120, shape: 'circle', dur: .75, dmg: dmg * 1.1, color: '#9fd86a', fx: 'fx_ground_burst', label: '猛扑' });
        break;
      case 'jd_claw_combo': // 六爪连击：6 段扇形斩
        P({ x: e.x, y: e.y, r: 235, shape: 'cone', ang, half: .62, dur: .9, dmg: dmg * .8, color: '#9fd86a', fx: 'fx_flame_breath', label: '六爪连击' });
        for (let i = 0; i < 3; i++) shootEnemy(e, ang + rand(-.6, .6), 340, 11);
        break;
      case 'jd_feline_roar': // 猫科战吼：自身周围红区 + 攻速提升
        P({ x: e.x, y: e.y, r: 200, shape: 'circle', dur: 1.25, dmg: dmg * .65, slow: .35, color: '#9fd86a', fx: 'fx_ground_fire', label: '猫科战吼' });
        e.raidHaste = 8;
        break;
      // ---- 萨卡托斯·兽王 ----
      case 'sk_savage_maul': // 撕裂爪：近战高伤
        P({ x: tgt.x, y: tgt.y, r: 105, shape: 'circle', dur: .65, dmg: dmg * 1.25, color: '#8a5a3a', fx: 'fx_ground_burst', label: '撕裂爪' });
        break;
      case 'sk_terrifying_roar': // 恐惧咆哮：群体恐惧
        P({ x: e.x, y: e.y, r: 250, shape: 'ring', dur: 1.05, dmg: dmg * .7, knock: 200, color: '#8a5a3a', fx: 'fx_shock_ring', label: '恐惧咆哮' });
        break;
      // ---- 萨弗拉斯·先驱 ----
      case 'sf_hellfire': // 地狱火：持续旋转喷火区
        P({ x: e.x, y: e.y, r: 275, shape: 'cone', ang, half: .55, dur: 1.55, dmg: dmg * .9, burn: dmg * .2, color: '#ff4a1e', fx: 'fx_flame_breath', spin: 1.1, label: '地狱火' });
        break;
      case 'sf_lava_bomb': // 熔岩弹：抛射爆炸弹
        for (let i = 0; i < 3; i++) {
          const a = ang + rand(-.7, .7);
          P({ x: tgt.x + Math.cos(a) * rand(-110, 110), y: tgt.y + Math.sin(a) * rand(-110, 110), r: 92, shape: 'circle', dur: 1.15 + i * .15, dmg: dmg * .8, burn: dmg * .12, color: '#ff4a1e', fx: 'fx_meteor_strike', label: i === 0 ? '熔岩弹' : '' });
        }
        break;
      case 'sf_fire_elemental': // 火元素召唤
        for (let i = 0; i < 3; i++) { const m = spawnEnemy(); m.x = e.x + rand(-100, 100); m.y = e.y + rand(-100, 100); }
        for (let i = 0; i < 12; i++) shootEnemy(e, i / 12 * TAU, 190, 12);
        announce(`${e.name} 召唤了火元素`, '#ff8a5c', 2);
        break;
      // ---- 玛尔科多莫·奥利加尔 ----
      case 'mj_magma_spit': // 熔岩吐息：长锥形喷吐
        P({ x: e.x, y: e.y, r: 330, shape: 'cone', ang, half: .42, dur: 1.15, dmg: dmg * 1.0, burn: dmg * .18, color: '#ff6b2c', fx: 'fx_flame_breath', label: '熔岩吐息' });
        break;
      case 'mj_earth_shatter': // 大地撕裂：十字长条
        P({ x: tgt.x, y: tgt.y, r: 320, shape: 'cross', ang: rand(0, TAU), dur: 1.5, dmg: dmg * 1.1, color: '#ff5a1e', fx: 'fx_ground_burst', label: '大地撕裂' });
        game.shake = Math.max(game.shake, 10);
        break;
      case 'mj_summon_elementals': // 召唤火元素
        for (let i = 0; i < 4; i++) { const m = spawnEnemy(); m.x = e.x + rand(-110, 110); m.y = e.y + rand(-110, 110); }
        for (let i = 0; i < 14; i++) shootEnemy(e, i / 14 * TAU, 210, 13);
        announce(`${e.name} 召唤了元素仆从`, '#ff8a5c', 2);
        break;
      // ---- 炎魔之王·拉格纳罗斯 ----
      case 'rg_magma_pool': // 熔岩池：脚下持续高伤区
        P({ x: e.x, y: e.y, r: 145, shape: 'circle', dur: 1.35, dmg: dmg * .85, burn: dmg * .22, color: '#ff3b20', fx: 'fx_magma_pool', label: '熔岩池' });
        break;
      case 'rg_flame_wreath': // 烈焰浪潮：环形推进火墙
        P({ x: e.x, y: e.y, r: 310, shape: 'ring', dur: 1.3, dmg: dmg * .95, burn: dmg * .15, color: '#ff5a1e', fx: 'fx_flame_burst', label: '烈焰浪潮' });
        break;
      case 'rg_meteor_shower': // 陨石天降：多点天降
        for (let i = 0; i < 5; i++) {
          const a = rand(0, TAU), d = rand(0, 240);
          P({ x: tgt.x + Math.cos(a) * d, y: tgt.y + Math.sin(a) * d, r: 105, shape: 'circle', dur: 1.5 + i * .22, dmg: dmg * .7, burn: dmg * .12, color: '#ff4a1e', fx: 'fx_meteor_strike', label: i === 0 ? '陨石天降' : '' });
        }
        break;
      case 'rg_eruption': // 熔火喷发：大范围爆发 + 击退
        P({ x: e.x, y: e.y, r: 290, shape: 'circle', dur: 1.4, dmg: dmg * 1.15, knock: 190, color: '#ff3b20', fx: 'fx_flame_burst', label: '熔火喷发' });
        game.shake = Math.max(game.shake, 12);
        break;
      case 'rg_summon_elementals': // 召唤熔火元素
        for (let i = 0; i < 4; i++) { const m = spawnEnemy(); m.x = e.x + rand(-120, 120); m.y = e.y + rand(-120, 120); }
        for (let i = 0; i < 16; i++) shootEnemy(e, i / 16 * TAU, 230, 14);
        announce(`${e.name} 召唤了熔火元素`, '#ff8a5c', 2.2);
        break;
      case 'rg_world_of_flame': // 熔火之心：全场大熔岩池（全屏级）
        P({ x: game.player.x, y: game.player.y, r: 430, shape: 'world', dur: 2.3, dmg: dmg * 1.35, burn: dmg * .3, color: '#ff3b20', fx: 'fx_fire_column', label: '熔火之心' });
        announce('炎魔之王施展 · 熔火之心！', '#ff6b2c', 3);
        game.shake = Math.max(game.shake, 14);
        break;
      default:
        break;
    }
  }

  function barrierBreak(p) {
    p.barrierT = 0;
    // 需求 13：极寒结界 → 护盾持续 +2 秒/级，破裂冰爆范围扩大 35%/级
    const brR = 150 * (1 + .35 * (p.mods.barrier_range || 0));
    spawnSpineFx('mage_ice', p.x, p.y, { life: .8, size: p.mods.barrier_burst ? brR * 2 : 96, fit: 'diameter', alpha: .95, timeScale: 1.6 });
    if (p.mods.barrier_burst) {
      for (const e of game.enemies) {
        if (!e.dead && distance(p, e) < brR + e.r) { damageEnemy(e, p.damage * .8, Math.atan2(e.y - p.y, e.x - p.x), 'ice_barrier'); applySlow(e, .4, 2); }
      }
      FX.ring(p.x, p.y, '#9fe4ff', 22, { speed: 260 });
      game.shake = Math.max(game.shake, 8);
    }
  }

  function burst(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, TAU), s = rand(25, 150), life = rand(.25, .65);
      game.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, maxLife: life, color, size: rand(1.5, 4) });
    }
  }

  function gainXp(value) {
    const p = game.player;
    // ===== 第 6 项：倒地观战时不再获得经验 =====
    // 根因：队友仍在战斗时，主机会持续广播击杀/掉落事件，客户端 gainXp 继续累积
    // pendingLevels → 反复调用 openLevelUp()，导致已倒下的玩家不断被弹出卡牌选择。
    // 倒地即视为退出战斗，不再升级；因此也不会再触发任何选卡浮层。
    if (p.downed) return;
    // ★ 塔防模式：专用经验曲线 xpNeed(lv) = 6.12 × lv^1.45（塔防节奏更密）
    if (game.gameMode === 'td') {
      p.xp += value * (1 + (p.gearFx.xpGain || 0)) * (1 + (TDR.xpBonus || 0));
      while (p.xp >= p.nextXp) {
        p.xp -= p.nextXp; p.level++; p.nextXp = TD.WAVES.xpNeed(p.level);
        game.pendingLevels++;
      }
      if (game.pendingLevels > 0 && mode === 'playing' && !game.gearPickOpen) openLevelUp();
      return;
    }
    p.xp += value * (1 + (p.gearFx.xpGain || 0));
    while (p.xp >= p.nextXp) {
      p.xp -= p.nextXp; p.level++; p.nextXp = Math.floor(30 + p.level * 16 + p.level * p.level * 1.3); // #43 升级曲线放缓，前期更快成型
      game.pendingLevels++;
      haptic('level'); // 移动端：升级震动
    }
    if (game.pendingLevels > 0 && mode === 'playing' && !game.gearPickOpen) openLevelUp();
  }

  const upgradePool = [
    { id:'damage', icon:'⚔', name:'锋利武器', type:'攻击强化', rar:0, desc:'所有攻击伤害提高 18%', apply:p=>p.damage*=1.18 },
    { id:'haste', icon:'⌁', name:'急速咏唱', type:'攻击强化', rar:1, desc:'攻击间隔缩短 12%', apply:p=>p.rate=Math.max(.12,p.rate*.88) },
    { id:'vitality', icon:'♥', name:'坚韧体魄', type:'生存强化', rar:0, desc:'最大生命 +25，并恢复 25 生命', apply:p=>{p.maxHp+=25;p.hp=Math.min(p.maxHp,p.hp+25)} },
    { id:'speed', icon:'➤', name:'迅捷步伐', type:'机动强化', rar:0, desc:'移动速度提高 10%', apply:p=>p.speed*=1.1 },
    { id:'magnet', icon:'◎', name:'宝石共鸣', type:'辅助强化', rar:0, desc:'经验拾取范围提高 45%', apply:p=>p.magnet*=1.45 },
    { id:'multishot', icon:'⋔', name:'分裂攻击', type:'精良强化', rar:2, desc:'远程攻击额外发射 1 枚投射物；战士获得 12% 范围', apply:p=>{p.multishot++;p.area*=1.12}, available:p=>p.type!=='warrior'||p.area<1.8 },
    { id:'pierce', icon:'↟', name:'穿透打击', type:'精良强化', rar:2, desc:'投射物额外穿透 1 个敌人；战士伤害 +12%', apply:p=>{p.pierce++;p.damage*=1.12}, available:p=>p.type!=='warrior' },
    { id:'armor', icon:'⬟', name:'符文护甲', type:'生存强化', rar:0, desc:'护甲 +2，每次受击减免伤害', apply:p=>p.armor+=2 },
    { id:'crit', icon:'✧', name:'精准弱点', type:'攻击强化', rar:1, desc:'暴击率提高 8%', apply:p=>p.crit=Math.min(.65,p.crit+.08) },
    { id:'regen', icon:'✚', name:'生命回响', type:'生存强化', rar:1, desc:'每秒恢复 0.7 生命', apply:p=>p.regen+=.7 },
    { id:'dash', icon:'➟', name:'时空漫步', type:'机动强化', rar:1, desc:'闪现冷却缩短 15%', apply:p=>p.dashMax=Math.max(1.2,p.dashMax*.85), available:p=>p.dashMax>1.25 },
    { id:'velocity', icon:'≈', name:'强弓劲弩', type:'攻击强化', rar:1, desc:'投射物速度 +18%，攻击范围 +8%', apply:p=>{p.projectileSpeed*=1.18;p.range*=1.08}, available:p=>p.type!=='warrior' },
    // 第 21 项：奥术洪流是法师专属强化（额外释放奥术飞弹）—— 非法师职业不应出现该卡
    { id:'arcane_surge', icon:'✦', name:'奥术洪流', type:'传说强化', rar:4, desc:'每次攻击有 18% 概率额外释放 2 枚奥术飞弹', apply:p=>p.surge=(p.surge||0)+.18, available:p=>p.type==='mage' },
    { id:'titan_blood', icon:'❖', name:'泰坦之血', type:'传说强化', rar:4, desc:'最大生命 +60，受到伤害降低 8%', apply:p=>{p.maxHp+=60;p.hp+=60;p.dmgReduce=Math.min(.4,(p.dmgReduce||0)+.08)} },
    { id:'windrun', icon:'≫', name:'风行者之魂', type:'传说强化', rar:4, desc:'移速 +15%，闪现冷却缩短 25%', apply:p=>{p.speed*=1.15;p.dashMax=Math.max(1,p.dashMax*.75)} }
  ];

  // 局内升级池 = 通用强化 + 已装备技能的专属强化卡
  function runUpgradePool() {
    const p = game.player;
    // ★ 塔防模式：通用卡（塔防语义改写）+ TD 专属卡 + 技能专属卡
    if (game.gameMode === 'td') return tdUpgradePool();
    const list = [...upgradePool];
    for (const s of SKILLS[p.type]) {
      if (s.id !== p.skillBasic && !ACTIVE_SLOTS.some(sl => p[sl.skill] === s.id)) continue;
      for (const m of (s.mods || [])) {
        const lvl = p.mods[m.id] || 0;
        if (lvl >= (m.max || 1)) continue;
        list.push({ id: `mod_${m.id}`, icon: s.icon, svg: s.id, name: `${s.name} · ${m.name}`, type: '技能强化', cls: p.type,
          desc: m.desc, skillLevel: lvl + 1, rar: m.rar ?? ((m.req || m.reqSkill) ? 3 : 2),
          // 第 20 项：reqSkill 联动检查覆盖全部 4 个主动技能槽位
          available: pl => pl.type === p.type && (m.req || []).every(r => pl.mods[r]) && (!m.reqSkill || pl.skillBasic === m.reqSkill || ACTIVE_SLOTS.some(sl => pl[sl.skill] === m.reqSkill)),
          apply: pl => { if (pl.type === p.type) pl.mods[m.id] = (pl.mods[m.id] || 0) + 1; } });
      }
    }
    return list;
  }

  function openLevelUp() {
    // ===== 第 6 项：已倒下的玩家不再弹出升级卡牌 =====
    // 队友还在战斗时经验会持续涌入，倒地玩家若照常弹卡牌会被反复打断且无法操作。
    if (game.player?.downed) return;
    // ★ 弹层互斥（2026-11-03）：核心 / 装备卡已开时不重入强化卡弹层。
    //   两个弹层同时打开会互相遮挡（#levelup 在 DOM 里靠后 → 盖住核心弹层），
    //   玩家表现为「选了技能后选不到核心」。这里改为排队：pendingLevels 保留，
    //   等当前弹层关闭后由 pumpPopups() 补开。
    if (game.gearPickOpen || game.tdCoreOpen) return;
    // #52 联机模式：选卡不暂停战斗（主机暂停会冻结全队），仅弹层继续游戏
    // ★ 塔防模式同样不暂停（英雄无敌 + 技能自动放，选卡不影响防守）
    const live = !!game.coop || game.gameMode === 'td';
    if (live && game.levelupOpen) return;
    // ★ 「时间已暂停」只在真暂停时显示 —— 联机 / 塔防是**不暂停**的，
    //   两句同时出现会自相矛盾（「时间已暂停」+「战斗仍在继续」），玩家会以为卡住了。
    if (live) {
      game.levelupOpen = true; ui['levelup-live'].classList.remove('hidden'); ui.levelup.classList.add('live');
      if (ui['levelup-pause-hint']) ui['levelup-pause-hint'].classList.add('hidden');
    } else {
      mode = 'levelup'; ui['levelup-live'].classList.add('hidden'); ui.levelup.classList.remove('live');
      if (ui['levelup-pause-hint']) ui['levelup-pause-hint'].classList.remove('hidden');
    }
    ui.levelup.classList.remove('hidden'); ui.levelup.classList.add('active');
    const p = game.player;
    const candidates = runUpgradePool().filter(u => !u.available || u.available(p));
    // 按品质加权抽取（白 40 / 绿 28 / 蓝 18 / 紫 10 / 橙 4）
    const picks = [];
    for (let n = 0; n < 3 && candidates.length; n++) {
      const total = candidates.reduce((s, u) => s + RARITY[u.rar ?? 0].weight, 0);
      let roll = Math.random() * total;
      let idx = 0;
      for (let i = 0; i < candidates.length; i++) { roll -= RARITY[candidates[i].rar ?? 0].weight; if (roll < 0) { idx = i; break; } }
      picks.push(candidates.splice(idx, 1)[0]);
    }
    ui['upgrade-cards'].innerHTML = '';
    picks.forEach((u, i) => {
      const level = u.skillLevel || (p.upgrades[u.id] || 0) + 1;
      const rar = u.rar ?? 0;
      const button = document.createElement('button');
      button.className = 'upgrade' + (u.type === '技能强化' ? ' skill-mod' : '') + ` rar-${rar}`;
      button.innerHTML = `<span class="up-icon">${u.svg ? skillIconHtml(u.svg, RARITY[rar].color, 42) : upgradeIconHtml(u, 42)}</span><strong>${u.name}</strong><span class="up-type">${RARITY[rar].name} · ${u.type} · ${level} 级</span><p>${u.desc}</p><small>按 ${i + 1} 快速选择</small>`;
      button.addEventListener('click', () => chooseUpgrade(u)); ui['upgrade-cards'].appendChild(button);
    });
  }

  function chooseUpgrade(u) {
    if (mode !== 'levelup' && !game?.levelupOpen) return; // #52 联机选卡时 mode 保持 playing
    const p = game.player;
    if (u.cls && u.cls !== p.type) { toast('该强化不属于当前职业，已自动拦截'); return; }
    // ★ 塔防模式：TD 卡牌的 apply(p, ctx) 需要 ctx.td（读 TDR 状态），必须传 ctx，
    //   否则选卡时抛 "Cannot read properties of undefined (reading 'td')"。
    if (game.gameMode === 'td') tdApplyCard(u, p); else u.apply(p);
    p.upgrades[u.id] = (p.upgrades[u.id] || 0) + 1; game.pendingLevels--;
    refreshBeastKing(); // 需求 12：兽群卡牌（增殖/野性呼唤/猎杀本能等）即时生效
    burst(p.x, p.y, '#ffe098', 20);
    FX.ring(p.x, p.y, u.type === '技能强化' ? '#8fd8f7' : '#ffe098', 18, { speed: 200 });
    game.levelupOpen = false;
    // ★ 统一收尾：先无条件收起强化卡弹层，再由 pumpPopups() 决定下一个弹什么。
    //   （旧写法「pendingLevels>0 就再开一次」在「核心弹层正开着」时会 openLevelUp() 被拒
    //    → 弹层留在屏幕上但点击全部失效 —— 玩家同样会卡住。）
    ui.levelup.classList.add('hidden'); ui.levelup.classList.remove('active');
    if (mode !== 'playing') mode = 'playing';
    pumpPopups();   // 有剩余升级则重开强化卡，否则补开被推迟的装备卡 / 局内核心
    updateHUD();
  }

  function dash() {
    if (!game || mode !== 'playing') return;
    const p = game.player;
    if (p.reviveT > 0) interruptRevive(); // 第 11 项：闪现（位移）打断战复读条
    if (p.dashCd > 0) return;
    let dx = p.moveX, dy = p.moveY;
    if (!dx && !dy) { dx = p.dirX; dy = p.dirY; }
    const l = Math.hypot(dx, dy) || 1; p.dirX = dx / l; p.dirY = dy / l;
    p.dashTime = .18; p.invuln = .35;
    p.dashCd = p.dashMax * (setHas('shadow', 3) ? .65 : 1); // 影牙 3 件套
    if (setHas('shadow', 3)) p.dashSurgeT = 1;
    if (setHas('shadow', 5)) spawnShadowClone(p); // 影牙 5 件套：暗影分身
    game.effects.push({ type: 'dash', x: p.x, y: p.y, life: .35, maxLife: .35, color: heroes[p.type].color });
  }

  // ===== 第 11 项：战复技能 =====
  // 规则：与倒地队友「重合站位」→ 读条 5 秒 → 队友恢复 50% 生命。
  // 读条期间施救者停止自动攻击；移动 / 主动技能 / 闪现都会打断读条。
  // 打断读条不会让技能进入冷却（可直接再次使用），但再次使用必须重新读满 5 秒。
  function reviveCandidates() {
    const out = [];
    for (const al of game.allies?.values() || []) if (al.dead) out.push(al);
    return out;
  }
  function reviveTargetFor(p) {
    let best = null, bd = REVIVE_OVERLAP;
    for (const al of reviveCandidates()) {
      const d = Math.hypot(al.x - p.x, al.y - p.y);
      if (d <= bd) { bd = d; best = al; }
    }
    return best;
  }
  function startRevive() {
    if (!game || mode !== 'playing') return;
    const p = game.player;
    if (!game.coop) { toast('战复仅在联机模式可用'); return; }
    if (p.downed) { toast('你已倒下，无法战复队友'); return; }
    if (p.reviveCd > 0) { toast(`战复冷却中 ${Math.ceil(p.reviveCd)}s`); return; }
    if (p.revivePending > 0 || p.reviveT > 0) return;
    if (Math.hypot(p.moveX, p.moveY) > .08) { toast('站定后才能开始战复'); return; }
    const tgt = reviveTargetFor(p);
    if (!tgt) { toast('附近没有倒地的队友'); return; }
    p.reviveT = REVIVE_CHANNEL; p.reviveTarget = tgt.id;
    game.texts.push({ x: p.x, y: p.y - 36, text: '战复读条中…', color: '#a8f0c4', life: 1.4, size: 13 });
    FX.ring(p.x, p.y, '#a8f0c4', 14, { speed: 150 });
  }
  function interruptRevive(silent) {
    const p = game?.player;
    if (!p || !(p.reviveT > 0)) return;
    p.reviveT = 0; p.reviveTarget = null; p.reviveCd = 0; // 打断不进入冷却
    if (!silent) game.texts.push({ x: p.x, y: p.y - 36, text: '战复被打断', color: '#e0a08f', life: 1.1, size: 12 });
  }
  function finishRevive() {
    const p = game.player;
    const to = p.reviveTarget;
    p.reviveT = 0; p.reviveTarget = null;
    if (!to) return;
    if (game.coop?.host) hostApplyRevive(to, NET.myId);          // 主机本地权威结算
    else { p.revivePending = 3; NET.sendEv({ k: 'revive-done', to }); } // 客户端 → 主机请求
  }
  // 主机权威结算：把倒地的队友（或主机自己）拉起来
  function hostApplyRevive(targetId, byId) {
    const isSelf = targetId === NET.myId;
    const t = isSelf ? game.player : game.allies?.get(targetId);
    if (!t) return false;
    if (isSelf ? !t.downed : !t.dead) return false;   // 目标已不处于倒地状态
    const hp = Math.max(1, Math.round((t.maxHp || 100) * REVIVE_HP));
    if (isSelf) { t.downed = false; t.hp = hp; t.invuln = 2; }
    else { t.dead = false; t.hp = hp; t.reviveT = 0; t.reviveTarget = ''; t.revivedAt = game.elapsed; }
    if (byId === NET.myId) game.player.reviveCd = REVIVE_CD; // 施救者进入冷却
    NET.sendSnap({ k: 'revive', to: targetId, by: byId, hp });
    const nm = isSelf ? heroes[t.type].name : (t.name || '队友');
    announce('战复成功 · ' + nm + ' 重新站了起来', '#a8f0c4', 2.8);
    return true;
  }
  // 读条可视化：施救者 → 倒地队友的光索 + 进度环
  function drawReviveFx() {
    const p = game?.player;
    if (!p || !game.coop) return;
    const ring = (x, y, r, prog) => {
      ctx.save();
      ctx.strokeStyle = 'rgba(168,240,196,.92)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.shadowColor = '#a8f0c4'; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(prog, 0, 1)); ctx.stroke();
      ctx.restore();
    };
    const beam = (ax, ay, bx, by) => {
      ctx.save();
      ctx.strokeStyle = 'rgba(168,240,196,.42)'; ctx.lineWidth = 3;
      ctx.shadowColor = '#a8f0c4'; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      ctx.restore();
    };
    // 倒地的队友头顶显示「可战复」标记
    const now = performance.now();
    for (const al of game.allies?.values() || []) {
      if (!al.dead) continue;
      ctx.save();
      ctx.globalAlpha = .45 + Math.sin(now / 260) * .25;
      ctx.strokeStyle = '#a8f0c4'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(al.x, al.y - 32, 7, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(al.x - 4, al.y - 32); ctx.lineTo(al.x + 4, al.y - 32);
      ctx.moveTo(al.x, al.y - 36); ctx.lineTo(al.x, al.y - 28); ctx.stroke();
      ctx.restore();
    }
    // 本地玩家正在读条
    if (p.reviveT > 0) {
      const tgt = game.allies?.get(p.reviveTarget);
      if (tgt) { beam(p.x, p.y, tgt.x, tgt.y); ring(tgt.x, tgt.y - 48, 13, 1 - p.reviveT / REVIVE_CHANNEL); }
    }
    // 队友正在读条（施救队友）
    for (const al of game.allies?.values() || []) {
      if (!(al.reviveT > 0)) continue;
      if (al.reviveTarget === NET.myId) continue; // 自己被救 → 单独处理
      const tgt = game.allies?.get(al.reviveTarget);
      if (!tgt) continue;
      beam(al.x, al.y, tgt.x, tgt.y);
      ring(tgt.x, tgt.y - 48, 13, 1 - al.reviveT / REVIVE_CHANNEL);
    }
    // 自己正在被救
    if (p.downed) {
      for (const al of game.allies?.values() || []) {
        if (al.reviveTarget !== NET.myId || !(al.reviveT > 0)) continue;
        ring(p.x, p.y - 54, 14, 1 - al.reviveT / REVIVE_CHANNEL);
        ctx.save(); ctx.textAlign = 'center'; ctx.font = 'bold 11px sans-serif';
        ctx.fillStyle = '#a8f0c4'; ctx.strokeStyle = '#071012'; ctx.lineWidth = 3;
        ctx.strokeText('队友正在战复你…', p.x, p.y - 70); ctx.fillText('队友正在战复你…', p.x, p.y - 70);
        ctx.restore();
      }
    }
  }

  // #50 扇形范围判定
  // ★ 必须返回命中计数：调用方要用它算「每命中 N 个敌人缩短冷却」。
  //   曾经漏了 return（返回 undefined）→ 下游 Math.floor(undefined/3) = NaN
  //   → Math.max(7, NaN) = NaN（★ Math.max 不拦 NaN）→ activeCd = NaN
  //   → 「cd > 0」判定恒为 false → 技能永久无 CD 连发（玩家可卡出震荡波无冷却）。
  function coneHit(x, y, angle, halfArc, range, fn) {
    let hits = 0;
    for (const e of game.enemies) {
      if (e.dead) continue;
      const d = Math.hypot(e.x - x, e.y - y);
      if (d > range + e.r) continue;
      let da = Math.atan2(e.y - y, e.x - x) - angle;
      while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU;
      if (Math.abs(da) <= halfArc || d < 46) { hits++; fn(e, d); }
    }
    return hits;
  }
  function aoeDamage(x, y, r, dmg, skill, opts = {}) {
    let hits = 0;
    for (const e of game.enemies) {
      if (e.dead || Math.hypot(e.x - x, e.y - y) >= r + e.r) continue;
      hits++;
      const ea = Math.atan2(e.y - y, e.x - x);
      damageEnemy(e, dmg, ea, skill, opts.critBonus || 0);
      if (opts.stun) applyStun(e, opts.stun);
      if (opts.slow) applySlow(e, opts.slow[0], opts.slow[1]);
      if (opts.burn) applyBurn(e, opts.burn, opts.burnDur || 2);
      if (opts.poison) applyPoison(e, opts.poison, opts.poisonDur || 3);
      if (opts.vuln) { e.vulnT = Math.max(e.vulnT || 0, opts.vulnDur || 4); e.vulnAmt = opts.vuln; }
      if (opts.knock && (!e.boss || opts.knockBoss) && e.type !== 'golem') { e.x += Math.cos(ea) * opts.knock; e.y += Math.sin(ea) * opts.knock; }
    }
    return hits;
  }

  // ===== Spine 技能表现：只负责视觉，不参与伤害与权威结算 =====
  // 伤害判定与视觉共用同一半径公式，强化范围后不会再出现特效仍停留在默认尺寸的问题。
  function skillAreaRadius(sid, p) {
    const mod = id => p.mods?.[id] || 0, gear = p.gearFx || {};
    // ★ 塔防模式：技能范围统一 = 阵位覆盖半径（同 attackRange）。
    //   站在传送圈里 = 你的技能能覆盖到圈内路径上的怪，这是塔防的操作契约。
    if (game?.gameMode === 'td') return tdReach();
    if (sid === 'whirlwind') return p.range * (p.area || 1) * (1 + .15 * mod('wide')) * (p.rageT > 0 ? 1.3 : 1);
    if (sid === 'thunderclap') return p.range * (p.area || 1) * (mod('shock') ? 1.25 : 1) * (gear.stompRange || 1);
    if (sid === 'blade_storm') return p.range * (p.area || 1);
    if (sid === 'war_stomp') return 170 * (mod('stomp_r') ? 1.4 : 1) * (gear.stompRange || 1);
    if (sid === 'demoralizing_shout') return 200 * (1 + .15 * mod('ds_range') + (mod('ds_terror') ? .3 : 0));
    if (sid === 'arcane_nova') return 170 * (1 + .2 * mod('nova_range') + (mod('nova_master') ? .4 : 0));
    if (sid === 'flamestrike') return 150 * (1 + .25 * mod('fs_range'));
    if (sid === 'explosive_trap') return 150 * (1 + .2 * mod('et_range'));
    if (sid === 'freezing_trap') return 130 * (1 + .15 * mod('ft_range'));
    if (sid === 'blizzard') return 150 * (1 + .25 * mod('bliz_range'));
    return 0;
  }
  function spawnSpineFx(key, x, y, opts = {}) {
    if (!game || !SPINE.has(key)) return;
    // ★ Spine 骨骼同屏上限按设备档位分级（§3.6）：低档机 14 / 其它 28。
    //   骨骼是 Canvas 上最贵的绘制项（每帧都要做骨骼变换 + 网格裁剪）。
    const spineCap = (window.__perfTier && window.__perfTier.isLow()) ? 14 : 28;
    if (game.spineFx.length >= spineCap) game.spineFx.shift(); // 高过绘资源同屏上限
    const life = opts.life ?? 1;
    game.spineFx.push({ key, x, y, a: opts.a || 0, life, maxLife: life, follow: opts.follow || null,
      size: opts.size, fit: opts.fit || '', flipY: opts.flipY, tint: opts.tint || null, shield: opts.shield || null,
      alpha: opts.alpha ?? .92, loop: !!opts.loop, timeScale: opts.timeScale || 1 });
  }
  function spawnBasicSpine(skill, p, target, a, alpha = .92) {
    const tx = target?.x ?? p.x + Math.cos(a) * 55, ty = target?.y ?? p.y + Math.sin(a) * 55;
    if (skill === 'whirlwind') spawnSpineFx('warrior_slash', p.x, p.y, { life: .62, size: skillAreaRadius(skill, p) * 2, fit: 'diameter', a, alpha: alpha * .82, timeScale: 1.9 });
    else if (skill === 'bloodthirst') spawnSpineFx('warrior_slash', tx, ty, { life: .5, size: p.mods?.sweep ? 160 : 76, fit: 'diameter', a, alpha: alpha * .9, timeScale: 2.1 });
    else if (skill === 'slam') spawnSpineFx('warrior_shockwave', tx, ty, { life: .62, size: p.mods?.stun_burst ? 180 : 80, fit: 'diameter', alpha, timeScale: 1.8 });
    else if (skill === 'thunderclap') spawnSpineFx('warrior_shockwave', p.x, p.y, { life: .75, size: skillAreaRadius(skill, p) * 2, fit: 'diameter', alpha, timeScale: 1.6 });
  }
  function spawnActiveSpine(sid, p, a, alpha = .92) {
    const follow = p === game.player ? p : p.fxFollow || null;
    if (sid === 'blade_storm') spawnSpineFx('warrior_bladestorm', p.x, p.y, { life: p.bladeStormT || 3, follow, size: skillAreaRadius(sid, p) * 2, fit: 'diameter', loop: true, alpha });
    else if (sid === 'war_stomp') spawnSpineFx('warrior_bladestorm', p.x, p.y, { life: .78, size: skillAreaRadius(sid, p) * 2, fit: 'diameter', alpha: alpha * .9, timeScale: 1.9 });
    else if (sid === 'demoralizing_shout') spawnSpineFx('warrior_shockwave', p.x, p.y, { life: .72, size: skillAreaRadius(sid, p) * 2, fit: 'diameter', alpha, timeScale: 2.5 });
    else if (sid === 'shockwave') {
      const range = 300 * (1 + .35 * (p.mods?.sw_range || 0));
      spawnSpineFx('warrior_shockwave', p.x + Math.cos(a) * range * .5, p.y + Math.sin(a) * range * .5, { life: .72, size: range, fit: 'diameter', a, alpha, timeScale: 2.15 });
    } else if (sid === 'charge') spawnSpineFx('warrior_charge', p.x, p.y, { life: (p.chargeT || .3) + .15, follow, size: (p.chargeW || 60) * 1.8, fit: 'diameter', a, alpha, timeScale: 1.2 });
    else if (sid === 'ice_barrier' || sid === 'shield_wall') spawnSpineFx('mage_shield', p.x, p.y, {
      life: sid === 'ice_barrier' ? 5 : 2.5, follow, size: 154, fit: 'diameter', loop: true, alpha: Math.min(1, alpha + .06), shield: sid,
      tint: sid === 'shield_wall' ? [1, .78, .42] : [.72, .94, 1] });
    else if (sid === 'icy_veins' || sid === 'rapid_fire') spawnSpineFx('magic_circle', p.x, p.y, { life: p.veinsT || p.rapidT || 4, follow, size: 125, loop: true, alpha: alpha * .75, timeScale: .8 });
    else if (sid === 'aspect_wild' || sid === 'berserker_rage') spawnSpineFx('common_aura', p.x, p.y, { life: p.aspectT || p.brT || 5, follow, size: 135, loop: true, alpha: alpha * .8 });
    else if (sid === 'arcane_nova') {
      const radius = skillAreaRadius(sid, p);
      // 单份素材只有一段奥术弧；三段限制在判定圈内部，形成清晰的周身爆发而非扩大范围。
      for (let i = 0; i < 3; i++) spawnSpineFx('mage_arcane', p.x, p.y, { life: 1.05, size: radius * 1.75, fit: 'diameter', a: i / 3 * TAU, alpha: alpha * .78, timeScale: 1.9 });
    }
    else if (sid === 'arcane_blast') {
      const range = 260 * (1 + .2 * (p.mods?.ab_range || 0));
      spawnSpineFx('mage_arcane', p.x + Math.cos(a) * range * .48, p.y + Math.sin(a) * range * .48, { life: 1.05, size: range, fit: 'diameter', a, alpha, timeScale: 2 });
    } else if (sid === 'mirror_image' || sid === 'call_pet') spawnSpineFx('magic_circle', p.x, p.y, { life: 1.5, size: 170, alpha, timeScale: 1.25 });
    else if (sid === 'blizzard') spawnSpineFx('mage_ice', p.x, p.y, { life: .9, size: 130, fit: 'diameter', alpha, timeScale: 1.4 });
    else if (sid === 'flamestrike') {
      // 持续区域使用浴火；另放一次短促爆炸，避免循环整段爆发动画造成闪屏。
      const zone = p === game.player ? game.zones[game.zones.length - 1] : null;
      const radius = zone?.r || skillAreaRadius(sid, p);
      spawnSpineFx('common_explosion', zone?.x ?? p.x + Math.cos(a) * 220, zone?.y ?? p.y + Math.sin(a) * 220,
        { life: 1.05, size: radius * 2, fit: 'diameter', alpha, timeScale: 1.6 });
    } else if (sid === 'mortal_strike') {
      const target = nearestEnemy((p.range || 120) * 1.6);
      if (target) spawnSpineFx('warrior_slash', target.x, target.y, { life: .68, size: p.mods?.ms_aoe ? 180 : 150, fit: 'diameter', a, alpha, timeScale: 1.8 });
    } else if (sid === 'kill_command') {
      const target = nearestEnemy(620);
      if (target) spawnSpineFx('hunter_arrow', target.x, target.y, { life: .7, size: 70, a, alpha, timeScale: 1.5 });
    }
  }
  function zoneSpineKey(z) { return z.spine || (z.arcane ? 'magic_circle' : null); }

  function castActive(which = 1) {
    if (!game || mode !== 'playing') return;
    const p = game.player;
    // ★ 联机倒地后进入观战：不得再施放主动技能（否则会绕过主机权威继续造成伤害）
    if (p.downed) { toast('你已倒下，无法施放技能'); return; }
    if (p.reviveT > 0) interruptRevive(); // 第 11 项：使用主动技能打断战复读条
    // 第 20 项：4 个主动技能槽位统一走 ACTIVE_SLOTS 描述
    const slot = ACTIVE_SLOTS[which - 1] || ACTIVE_SLOTS[0];
    const sid = p[slot.skill];
    if (!sid) return;
    // ★ 护栏：冷却值必须是有限数。NaN / Infinity 都让「cd > 0」判定失效，
    //   导致技能可连发。发现异常值就地归零（视为冷却完毕）而不是放行。
    const cdNow = p[slot.cd];
    if (!Number.isFinite(cdNow)) p[slot.cd] = 0;
    else if (cdNow > 0) return;
    haptic('cast'); // 移动端：技能释放震动
    const mod = (id) => p.mods[id] || 0;
    const a = Math.atan2(p.dirY, p.dirX);
    let cd = 10;
    if (sid === 'frost_orb') {
      // 需求 13：极地扩张 → 冻伤范围 +40%/级；漫长霜冻 → 持续 +2 秒
      const orbR = 15 * (1 + .4 * (mod('orb_range') || 0));
      game.orbs.push({ x: p.x, y: p.y, vx: Math.cos(a) * 140, vy: Math.sin(a) * 140, r: orbR, life: 4.5 + 2 * (mod('orb_len') || 0),
        tick: 0, dmg: p.damage * .5 * (1 + .45 * mod('orb_power')), slow: mod('orb_slow') ? .45 : 0, aoeR: 70 * (1 + .4 * (mod('orb_range') || 0)) });
      cd = 9 - 3 * mod('orb_cd');
    } else if (sid === 'shield_wall') {
      p.invuln = Math.max(p.invuln, 2.5); p.wallT = 4 + 1.5 * mod('wall_len');
      burst(p.x, p.y, '#cfe8ff', 18);
      cd = 16 - 4 * mod('wall_cd');
    } else if (sid === 'blade_storm') {
      p.bladeStormT = 3 + mod('storm_len'); p.stormTick = 0;
      cd = 18;
    } else if (sid === 'rapid_fire') {
      p.rapidT = 4 + 1.5 * mod('rapid_len');
      burst(p.x, p.y, '#ffe9a8', 14);
      cd = 15 - 4 * mod('rapid_cd');
    } else if (sid === 'blizzard') {
      // 需求 13：风暴之眼 → 范围 +25%/级；漫长寒冬 → 持续 +2 秒
      const blizR = skillAreaRadius('blizzard', p);
      const blizLife = 4 + 2 * (mod('bliz_len') || 0);
      game.zones.push({ x: p.x, y: p.y, r: blizR, life: blizLife, maxLife: blizLife,
        tick: 0, dmg: p.damage * .4 * (1 + .4 * mod('bliz_power')), slow: .3, spine: 'mage_ice', blizzard: true });
      cd = 11;
    } else if (sid === 'war_stomp') {
      const r = skillAreaRadius('war_stomp', p);
      game.effects.push({ type: 'warning', x: p.x, y: p.y, r: 20, maxR: r, life: .4, maxLife: .4, color: '#e8c97d' });
      game.shake = 12;
      aoeDamage(p.x, p.y, r, p.damage * .8, 'war_stomp', { stun: 1.5, knock: 70 });
      cd = 14 - 4 * mod('stomp_cd');
      if (mod('earthshatter')) game.zones.push({ x: p.x, y: p.y, r, life: 3, maxLife: 3, tick: 0, dmg: p.damage * .35, slow: 0, crack: true });
    } else if (sid === 'call_pet') {
      // ===== 兽王（需求 12）：主动释放 = 兽王威压，为全体宠物赋予强化 =====
      const auraT = 12 + 4 * mod('pet_aura_len');
      for (const pet of game.pets) {
        if (pet.mirror || pet.shadow) continue;      // 镜影 / 影分身不吃兽王强化
        pet.auraT = Math.max(pet.auraT || 0, auraT);
        pet.auraDmg = Math.max(pet.auraDmg || 0, .45 * mod('pet_aura_dmg'));
        pet.auraRate = Math.max(pet.auraRate || 0, .25 * mod('pet_aura_rate'));
        pet.auraLeap = Math.max(pet.auraLeap || 0, mod('pet_aura_leap'));
      }
      // 威压光环特效（范围 = 强化覆盖半径）
      const auraR = 220 + 40 * mod('pet_aura_leap');
      spawnSpineFx('common_aura', p.x, p.y, { life: 1.3, size: auraR * 2, fit: 'diameter', alpha: .88, timeScale: 1.3 });
      game.effects.push({ type: 'warning', x: p.x, y: p.y, r: 20, maxR: auraR, life: .45, maxLife: .45, color: '#d4e99b' });
      FX.ring(p.x, p.y, '#d4e99b', 22, { speed: 260 });
      game.texts.push({ x: p.x, y: p.y - 46, text: '兽王威压', color: '#d4e99b', life: 1.3, size: 15 });
      cd = 20 - 6 * mod('pack_leader');
    } else if (sid === 'ice_barrier') {
      p.barrierHp = (45 + p.damage * .6) * (1 + .4 * mod('barrier_power')) * (1 + .25 * mod('shatter_guard')) * (1 + (p.gearFx.barrierBonus || 0));
      // 需求 13：极寒结界 → 护盾持续 +2 秒/级
      p.barrierT = 5 + 2 * (mod('barrier_range') || 0);
      FX.ring(p.x, p.y, '#9fe4ff', 16, { speed: 160 });
      cd = 13 - 4 * mod('barrier_cd');
    }
    // ===== #50 新主动技能 =====
    else if (sid === 'arcane_nova') {
      const r = skillAreaRadius('arcane_nova', p);
      game.effects.push({ type: 'warning', x: p.x, y: p.y, r: 20, maxR: r, life: .4, maxLife: .4, color: '#bfeaff' });
      FX.ring(p.x, p.y, '#bfeaff', 20, { speed: 300 });
      game.shake = Math.max(game.shake, 8);
      const dmg = p.damage * 1.1 * (1 + .4 * mod('nova_surge'));
      const hits = aoeDamage(p.x, p.y, r, dmg, 'arcane_nova', {
        knock: mod('nova_knock') ? 130 : 65, slow: mod('nova_knock') ? [.3, 2] : null,
        vuln: mod('nova_mark') ? .12 : 0, vulnDur: 4 });
      cd = 8 + (mod('nova_surge') ? 2 : 0);
      if (mod('nova_haste') && hits >= 4) cd -= 2;
      if (mod('nova_master')) cd -= .4 * hits;
      if (mod('nova_shield')) { p.barrierHp = Math.max(p.barrierHp, p.maxHp * .15); p.barrierT = Math.max(p.barrierT, 3); }
      // 需求 13：余响不绝 → 二次爆鸣范围 +40%、伤害 +30%
      if (mod('nova_echo')) game.meteors.push({ x: p.x, y: p.y, t: 1, r: r * (mod('nova_len') ? 1.4 : 1),
        dmg: dmg * .6 * (mod('nova_len') ? 1.3 : 1), color: '#bfeaff', skill: 'arcane_nova' });
    } else if (sid === 'flamestrike') {
      const tgt = nearestEnemy(700);
      const fx0 = tgt ? tgt.x : p.x + Math.cos(a) * 220, fy = tgt ? tgt.y : p.y + Math.sin(a) * 220;
      const r = skillAreaRadius('flamestrike', p);
      // 需求 13：不灭之火 → 持续 +2 秒/级；烈焰强化 → 伤害 +25%/级
      const fsLife = 3 + 2 * (mod('fs_len') || 0);
      const mkZone = (zx, zy) => game.zones.push({ x: zx, y: zy, r, life: fsLife, maxLife: fsLife,
        tick: 0, dmg: p.damage * .45 * (1 + .25 * mod('fs_power')), slow: mod('fs_slow') ? .45 : 0,
        burn: mod('fs_burn') ? p.damage * .15 : 0, vuln: mod('fs_melt') ? .12 : 0, crack: true, spine: 'mage_fire' });
      mkZone(fx0, fy);
      if (mod('fs_double')) mkZone(p.x, p.y);
      if (mod('fs_pillar')) {
        game.effects.push({ type: 'warning', x: fx0, y: fy, r: 16, maxR: r, life: .45, maxLife: .45, color: '#f6a04d' });
        aoeDamage(fx0, fy, r, p.damage * 1.8, 'flamestrike');
        FX.burst(fx0, fy, '#f6a04d', 22, { speed: 240, grav: 180 });
      }
      cd = 9;
    } else if (sid === 'icy_veins') {
      // 需求 13：绵长寒意 → 持续 +2 秒/级
      p.veinsT = 6 + 2 * (mod('iv_len') || 0);
      p.veinsActive = true; // 标记血脉已激活（极寒爆发的结束边沿依赖它，见 update 内注释）
      if (mod('iv_shield')) { p.barrierHp = Math.max(p.barrierHp, p.maxHp * .2); p.barrierT = Math.max(p.barrierT, p.veinsT); }
      burst(p.x, p.y, '#9fe4ff', 16);
      cd = 14;
    } else if (sid === 'mirror_image') {
      const n = 2 + (mod('mi_three') ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const ang = a + (i - (n - 1) / 2) * .7;
        // 第 19 项：镜像持续时间 6 → 9 秒、伤害系数 .45 → .62
        game.pets.push({ x: p.x + Math.cos(ang) * 46, y: p.y + Math.sin(ang) * 46, life: 9 + 2 * mod('mi_len'), atkCd: 0,
          atkRate: .9 * (1 - .2 * mod('mi_rate')), dmg: p.damage * .62 * (1 + .25 * mod('mi_dmg')) * (1 + .15 * (mod('mi_range') || 0)),
          phase: rand(0, TAU), range: 520 + 150 * (mod('mi_range') || 0),
          ranged: true, multi: mod('mi_split') ? 1 : 0, expl: mod('mi_explode') ? 1.5 : 0, mirror: true });
      }
      if (mod('mi_burst')) aoeDamage(p.x, p.y, 150, p.damage * .8, 'mirror_image', { knock: 40 });
      FX.ring(p.x, p.y, '#d9b8f2', 18, { speed: 200 });
      cd = 18;
    } else if (sid === 'arcane_blast') {
      const half = (35 + 25 * (mod('ab_wide') ? 1 : 0)) * Math.PI / 180;
      // 第 19 项：奥术冲击距离范围 260 → 330 码
      const range = 330 * (1 + .2 * mod('ab_range'));
      const dmg = p.damage * 1.2 * (1 + .2 * mod('ab_power')) * (1 + .25 * (p.abStacks || 0));
      game.effects.push({ type: 'cone', x: p.x, y: p.y, maxR: range, life: .32, maxLife: .32, color: '#b7e6ff', a0: a, half });
      game.effects.push({ type: 'cone', x: p.x, y: p.y, maxR: range * .8, life: .24, maxLife: .24, color: '#e3d0ff', a0: a, half: half * .7 });
      let hits = 0;
      // 需求 13：奥能扩散 → 命中点额外炸开 120 码余波（60% 伤害）
      const spreadHits = [];
      coneHit(p.x, p.y, a, half, range, (e) => {
        hits++;
        const ea = Math.atan2(e.y - p.y, e.x - p.x);
        damageEnemy(e, dmg, ea, 'arcane_blast');
        if (mod('ab_mark')) { e.vulnT = Math.max(e.vulnT || 0, 3); e.vulnAmt = .1; }
        if (mod('ab_knock')) { applySlow(e, .25, 2); if (!e.boss && e.type !== 'golem') { e.x += Math.cos(ea) * 60; e.y += Math.sin(ea) * 60; } }
        if (mod('ab_spread')) spreadHits.push(e);
      });
      if (mod('ab_spread')) for (const se of spreadHits) {
        game.effects.push({ type: 'warning', x: se.x, y: se.y, r: 10, maxR: 120, life: .3, maxLife: .3, color: '#b7e6ff' });
        for (const o of game.enemies) {
          if (!o.dead && o !== se && distance(o, se) < 120 + o.r) damageEnemy(o, dmg * .6, Math.atan2(o.y - se.y, o.x - se.x), 'arcane_blast');
        }
      }
      p.abStacks = mod('ab_charge') ? Math.min(3, Math.floor(hits / 3)) : 0;
      if (mod('ab_recoil')) p.abRecoilT = 2;
      if (mod('ab_arcane')) game.zones.push({ x: p.x + Math.cos(a) * range * .6, y: p.y + Math.sin(a) * range * .6, r: 110, life: 2.5, maxLife: 2.5, tick: 0, dmg: p.damage * .35, slow: 0, arcane: true });
      game.shake = Math.max(game.shake, 6);
      cd = 7;
    } else if (sid === 'charge') {
      p.chargeT = (260 * (1 + .2 * mod('ch_len'))) / 900;
      p.chargeDirX = p.dirX; p.chargeDirY = p.dirY;
      p.chargeW = 60 * (mod('ch_wide') ? 1.5 : 1);
      p.chargeDmg = 1.5 * (1 + .35 * mod('ch_dmg'));
      p.chargeStun = 1 + .8 * mod('ch_stun');
      p.chargeHits = new Set(); p.chargeSlot = which;
      p.invuln = Math.max(p.invuln, p.chargeT + .1);
      if (mod('ch_haste')) p.chHasteT = 3;
      if (mod('ch_shield')) p.chShieldT = 4;
      game.effects.push({ type: 'dash', x: p.x, y: p.y, life: .35, maxLife: .35, color: '#f3b47d' });
      cd = 12;
    } else if (sid === 'shockwave') {
      const half = (40 + 30 * (mod('sw_wide') ? 1 : 0)) * Math.PI / 180;
      const range = 300 * (1 + .35 * mod('sw_range'));
      const dmg = p.damage * 1.1 * (1 + .15 * mod('sw_power'));
      game.effects.push({ type: 'cone', x: p.x, y: p.y, maxR: range, life: .34, maxLife: .34, color: '#e8c97d', a0: a, half });
      for (let i = 0; i < 4; i++) {
        const ba = a + rand(-half, half);
        game.effects.push({ type: 'bolt', pts: boltPoints(p.x, p.y, p.x + Math.cos(ba) * range * rand(.7, 1), p.y + Math.sin(ba) * range * rand(.7, 1), 5), life: .2, maxLife: .2, color: '#ffe0b0', w: 3 });
      }
      const hits = coneHit(p.x, p.y, a, half, range, (e) => {
        damageEnemy(e, dmg, Math.atan2(e.y - p.y, e.x - p.x), 'shockwave');
        applyStun(e, 1.2 + .8 * mod('sw_stun'));
        if (mod('sw_slow')) applySlow(e, .4, 2);
      });
      // 上限保护：命中极多敌人时不能把冷却压到 0（否则技能无 CD 连发），最多缩短 7 秒
      cd = Math.max(7, 14 - (mod('sw_cd_hit') ? Math.floor(hits / 3) : 0));
      if (mod('sw_double')) game.meteors.push({ x: p.x + Math.cos(a) * range * .5, y: p.y + Math.sin(a) * range * .5, t: 1.5, r: range * .55, dmg: dmg * .6, color: '#e8c97d', skill: 'shockwave', stun: 1 });
      if (mod('sw_earth')) game.zones.push({ x: p.x + Math.cos(a) * range * .5, y: p.y + Math.sin(a) * range * .5, r: range * .5, life: 3, maxLife: 3, tick: 0, dmg: p.damage * .3, slow: 0, crack: true });
      game.shake = Math.max(game.shake, 9);
    } else if (sid === 'mortal_strike') {
      const target = nearestEnemy(p.range * 1.6);
      if (target) {
        game.effects.push({ type: 'slash', x: target.x, y: target.y, r: 10, maxR: 70, life: .25, maxLife: .25, color: '#e87a5e' });
        FX.burst(target.x, target.y, '#e87a5e', 14, { speed: 190, grav: 220 });
        let dmg = p.damage * 3 * (1 + .15 * mod('ms_power'));
        if (mod('ms_execute') && target.hp / target.maxHp < .35) dmg *= 1.8;
        damageEnemy(target, dmg, Math.atan2(target.y - p.y, target.x - p.x), 'mortal_strike', mod('ms_crit') ? .25 : 0);
        target.vulnT = Math.max(target.vulnT || 0, 5 + 2 * mod('ms_len'));
        target.vulnAmt = mod('ms_vuln') ? .25 : .15;
        if (mod('ms_heal')) p.hp = Math.min(p.maxHp, p.hp + p.maxHp * .08);
        if (mod('ms_aoe')) aoeDamage(target.x, target.y, 90, dmg * .5, 'mortal_strike');
      }
      cd = 10;
    } else if (sid === 'berserker_rage') {
      p.brT = 6 + 1.5 * mod('br_len');
      burst(p.x, p.y, '#e87a5e', 18);
      FX.ring(p.x, p.y, '#e87a5e', 20, { speed: 240 });
      announce('狂暴之怒！', '#e87a5e', 1.2);
      cd = 20;
    } else if (sid === 'demoralizing_shout') {
      const r = skillAreaRadius('demoralizing_shout', p);
      game.effects.push({ type: 'warning', x: p.x, y: p.y, r: 20, maxR: r, life: .45, maxLife: .45, color: '#c9b18a' });
      game.shake = Math.max(game.shake, 10);
      const hits = aoeDamage(p.x, p.y, r, p.damage * .4, 'demoralizing_shout', {
        stun: 1.5 + .7 * mod('ds_stun'), knock: 95,
        slow: mod('ds_slow') ? [.35, 3] : null, vuln: mod('ds_weak') ? .12 : 0, vulnDur: 4,
        burn: mod('ds_doom') ? p.damage * .25 : 0, burnDur: 3 });
      if (mod('ds_armor')) p.dsArmorT = 4;
      // 上限保护：同上，最多缩短 8 秒（震慑 32 个以上敌人也不会无 CD）
      cd = Math.max(8, 16 - (mod('ds_cd') ? Math.floor(hits / 4) : 0));
    } else if (sid === 'multi_shot') {
      const count = 7 + 2 * mod('msh_count') + (mod('msh_wide') ? 1 : 0);
      // 需求 12：远射覆盖 → 扇形与射程同时扩大 25%/级
      const reachK = 1 + .25 * mod('msh_reach');
      const fan = 1.22 * (mod('msh_focus') ? .55 : 1) * (mod('msh_wide') ? 1.5 : 1) * reachK;
      // 第 19 项：多重射击伤害系数 .6 → .78（猎人主动技能基础伤害统一提升约 25~30%）
      const dmg = p.damage * .78 * (1 + .15 * mod('msh_power')) * (mod('msh_focus') ? 1.35 : 1);
      const spd = 700 * (1 + .25 * mod('msh_speed')) * p.projectileSpeed;
      for (let i = 0; i < count; i++) {
        const ang = a + (i - (count - 1) / 2) * (fan / Math.max(1, count - 1));
        game.projectiles.push({ x: p.x + Math.cos(ang) * 22, y: p.y + Math.sin(ang) * 22,
          vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
          r: 5, damage: dmg, life: p.range * 1.1 * reachK / spd + .1,
          // ★ 塔防模式：弓手站在传送圈里沿路径贯穿怪群 → 箭矢额外贯穿 1 个目标。
          //   （塔防是「守一条路」的玩法，猎人的多目标能力必须来自贯穿，否则一套卡都是单体、
          //     在密集怪潮里完全打不动 —— 数值模型实测：不开这个调整猎人 1 人局漏 271 只，开后 90 只。）
          color: '#d4e99b', pierce: p.pierce + mod('msh_pierce') + (game?.gameMode === 'td' ? 1 : 0), hit: new Set(), skill: 'multi_shot',
          critBonus: mod('msh_crit') ? .15 : 0 });
      }
      p.atkAnim = .14;
      cd = 11;
    } else if (sid === 'explosive_trap') {
      const n = mod('et_two') ? 2 : 1;
      // 需求 12：遥控引信 → 触发半径与爆炸范围同时扩大 30%/级
      const reachK = 1 + .3 * mod('et_reach');
      for (let i = 0; i < n; i++) {
        game.traps.push({ type: 'explosive', x: p.x - Math.cos(a) * (i * 40), y: p.y - Math.sin(a) * (i * 40),
          r: 70 * (mod('et_arm') ? 1.6 : 1) * reachK, boomR: skillAreaRadius('explosive_trap', p) * reachK,
          // 第 19 项：爆炸陷阱伤害系数 1.6 → 2.05
          dmg: p.damage * 2.05 * (1 + .15 * mod('et_power')) * (mod('et_sticky') ? 1.3 : 1), life: 6 });
      }
      cd = 13;
    } else if (sid === 'freezing_trap') {
      const n = mod('ft_two') ? 2 : 1;
      for (let i = 0; i < n; i++) {
        game.traps.push({ type: 'freezing', x: p.x - Math.cos(a) * (i * 40), y: p.y - Math.sin(a) * (i * 40),
          r: 70, boomR: skillAreaRadius('freezing_trap', p),
          // 第 19 项：冰冻陷阱伤害系数 1.0 → 1.3
          dmg: p.damage * 1.3, life: 8 });
      }
      cd = 15;
    } else if (sid === 'kill_command') {
      // 需求 12：猎杀视野 → 索敌距离 +25%/级，并附带 90 码溅射
      const reachK = 1 + .25 * mod('kc_reach');
      const targets = game.enemies.filter(e => !e.dead).sort((x, y) => distance(p, x) - distance(p, y)).slice(0, 1 + (mod('kc_multi') || 0));
      for (const t of targets) {
        if (distance(p, t) > 620 * reachK) continue;
        // 第 19 项：杀戮命令伤害系数 2.5 → 3.2
        let dmg = p.damage * 3.2 * (1 + .18 * mod('kc_power'));
        if (mod('kc_pack') && game.pets.length) dmg *= 1.4;
        if (mod('kc_execute') && t.hp / t.maxHp < .35) dmg *= 1.7;
        game.effects.push({ type: 'bolt', pts: boltPoints(p.x, p.y, t.x, t.y, 4), life: .18, maxLife: .18, color: '#d4e99b', w: 3 });
        damageEnemy(t, dmg, Math.atan2(t.y - p.y, t.x - p.x), 'kill_command');
        if (mod('kc_bleed')) applyPoison(t, p.damage * .2, 3);
        // 需求 12：狩猎连击 → 目标易伤 10%（3 秒）
        if (mod('kc_focus')) { t.vulnT = Math.max(t.vulnT || 0, 3); t.vulnAmt = Math.max(t.vulnAmt || 0, .1); }
        // 猎杀视野溅射：命中目标周围 90 码/级 的敌人受同等伤害
        // ★ HUNTER_HOOK · ⑭：「猎杀横扫」扩大溅射范围并提高溅射伤害（数值在 hunter.js）
        if (mod('kc_reach')) for (const o of game.enemies) {
          if (o.dead || o === t) continue;
          const kcSweep = mod('kc_sweep') || 0;
          if (distance(o, t) < 90 * mod('kc_reach') + 60 * kcSweep + o.r) damageEnemy(o, dmg * (.6 + .3 * kcSweep), Math.atan2(o.y - t.y, o.x - t.x), 'kill_command');
        }
        const pet = game.pets[0];
        if (pet) { pet.x = t.x + 24; pet.y = t.y + 12; }
      }
      if (mod('kc_haste')) for (const pet of game.pets) pet.hasteT = 4;
      if (mod('kc_swift')) p.kcSwiftT = 2;
      cd = 9;
    } else if (sid === 'aspect_wild') {
      p.aspectT = 5 + 1.5 * mod('aw_len');
      burst(p.x, p.y, '#9bd37e', 16);
      FX.ring(p.x, p.y, '#9bd37e', 18, { speed: 210 });
      cd = 18;
    }
    if (p.gearFx.castSurge) p.castSurgeT = 3; // 提瑞斯法之心
    if (p.gearFx.castHaste) p.castHasteT = 3; // 短暂能量护符
    // ★ 娴熟：冷却缩短 10%/级。
    //   ★ NaN 防护：Math.max 不拦 NaN（Math.max(1, NaN) === NaN），
    //     一旦 cd 变成 NaN，「cd > 0」恒为 false → 技能永久无 CD 连发。
    //     所以这里先拦非有限值，再取下限，最后再兜一次底。
    const cdProf = 1 - .1 * mod(sid + '_cd');
    cd = Number.isFinite(cd) ? cd * cdProf : 1;
    cd = Number.isFinite(cd) ? Math.max(1, cd) : 1;
    // 第 20 项：冷却写入对应槽位（4 槽位）
    p[slot.cd] = cd; p[slot.max] = cd;
    p.castAnim = .25; // 施法动作脉冲
    spawnActiveSpine(sid, p, a);
    castFxNet({ s: sid, x: p.x | 0, y: p.y | 0, a: +a.toFixed(2) }); // #54 广播技能视觉
    FX.ring(p.x, p.y, '#ffe1a1', 14, { speed: 170 });
    game.effects.push({ type: 'dash', x: p.x, y: p.y, life: .35, maxLife: .35, color: '#ffe1a1' });
    updateHUD();
  }

  // ===== 药水（暗黑3式无尽药水，E 使用，冷却 30 秒）=====
  function usePotion() {
    if (!game || mode !== 'playing') return;
    const p = game.player;
    // ★ 联机倒地后进入观战：不得再使用药水（否则血量会被"诈尸"式回满但仍处于倒地状态）
    if (p.downed) { toast('你已倒下，无法使用药水'); return; }
    if (!save.potion || p.potCd > 0) return;
    const id = save.potion;
    const potLvl = save.potionLvl[id] || 1; // #44 药水强化等级
    const potMult = 1 + .15 * (potLvl - 1); // 特效时长/强度随等级提升
    p.hp = Math.min(p.maxHp, p.hp + p.maxHp * Math.min(.9, .6 + .05 * (potLvl - 1)));
    p.potCd = 30;
    haptic('heal'); // 移动端：药水震动
    FX.ring(p.x, p.y, '#8fe3a0', 18, { speed: 200 });
    burst(p.x, p.y, '#8fe3a0', 12);
    const apply = (eff) => {
      if (eff === 'kulleaid') { p.dashCd = 0; }
      else if (eff === 'amplify') p.potDmgT = 5 * potMult;
      else if (eff === 'rejuvenate') p.potHotT = 5 * potMult;
      else if (eff === 'leech') p.potLeechT = 6 * potMult;
      else if (eff === 'mutilate') p.potMutT = 8 * potMult;
      else if (eff === 'tower') p.potArmorT = 8 * potMult;
      else if (eff === 'fear') {
        for (const e of game.enemies) {
          if (e.dead || distance(p, e) >= 200 + e.r) continue;
          const a = Math.atan2(e.y - p.y, e.x - p.x);
          applyStun(e, 1.5 * potMult);
          if (!e.boss && e.type !== 'golem') { e.x += Math.cos(a) * 80; e.y += Math.sin(a) * 80; }
        }
        game.effects.push({ type: 'warning', x: p.x, y: p.y, r: 20, maxR: 200, life: .4, maxLife: .4, color: '#9c6aac' });
      }
      else if (eff === 'diamond') p.potReduceT = 6 * potMult;
    };
    const effMap = { pot_kulleaid: 'kulleaid', pot_amplify: 'amplify', pot_rejuvenate: 'rejuvenate', pot_leech: 'leech', pot_mutilate: 'mutilate', pot_tower: 'tower', pot_fear: 'fear', pot_diamond: 'diamond' };
    if (id === 'pot_chaos') {
      const keys = Object.keys(effMap);
      apply(effMap[keys[Math.floor(Math.random() * keys.length)]]);
      announce('混沌药水：随机特效触发！', '#ffd66e', 1.8);
    } else apply(effMap[id]);
    announce(`使用了 ${ITEMS[id].name}${potLvl > 1 ? ` Lv.${potLvl}` : ''}`, '#8fe3a0', 1.4);
    updateHUD();
  }

  // ===== 装备掉落卡牌（击杀怪物爆出，白/绿/蓝/紫/橙）=====
  function rollRarity(bonus = 0) {
    // 进度越深，紫/橙权重越高（受控：有上限）
    const w = RARITY.map((r, i) => r.weight + (i === 3 ? Math.min(bonus, 20) : i === 4 ? Math.min(bonus * .4, 10) : 0));
    const total = w.reduce((s, x) => s + x, 0);
    let roll = Math.random() * total;
    for (let i = 0; i < w.length; i++) { roll -= w[i]; if (roll < 0) return i; }
    return 0;
  }
  function applyGearFx(p, fx, scale = 1) {
    if (fx.damageMult) p.damage = Math.round(p.damage * (1 + (fx.damageMult - 1) * scale));
    if (fx.maxHp) { const v = Math.round(fx.maxHp * scale); p.maxHp += v; p.hp += v; }
    if (fx.armor) p.armor += Math.round(fx.armor * scale);
    if (fx.speedMult) p.speed = Math.round(p.speed * (1 + (fx.speedMult - 1) * scale));
    if (fx.rateMult) p.rate = Math.max(.12, p.rate * (1 - (1 - fx.rateMult) * scale));
    if (fx.pierce) p.pierce += fx.pierce;
    if (fx.critFlat) p.crit = Math.min(.8, p.crit + fx.critFlat * scale);
    if (fx.regenFlat) p.regen += fx.regenFlat * scale;
    if (fx.magnetMult) p.magnet = Math.round(p.magnet * (1 + (fx.magnetMult - 1) * scale));
    if (fx.dashMult) p.dashMax = Math.max(1, p.dashMax * (1 - (1 - fx.dashMult) * scale));
    for (const k of ['slowBonus', 'surgeChance', 'castSurge', 'furyDmg', 'poisonBonus', 'executeBonus', 'burnOnHit', 'poisonOnHit', 'petBonus', 'extraShotChance', 'barrierBonus', 'castHaste', 'poisonDur', 'goldFind', 'xpGain', 'contactSlow']) if (fx[k]) p.gearFx[k] = (p.gearFx[k] || 0) + fx[k] * scale;
    if (fx.critDmgAdd) p.critDmg += fx.critDmgAdd * scale; // 特化：暴击伤害直接叠加
    if (fx.critDmg) p.critDmg = Math.max(p.critDmg, fx.critDmg);
    if (fx.killStacks) p.gearFx.killStacks = true;
    if (fx.stompRange) p.gearFx.stompRange = (p.gearFx.stompRange || 1) * (1 + (fx.stompRange - 1) * scale);
    // 熔火之心团本橙装：fx.moltenCore 标记「已装备该橙装」（普攻可触发岩浆池）；
    // spec.moltenPower 为通用强化等级带来的岩浆池威力加成。
    if (fx.moltenCore) p.gearFx.moltenCore = true;
    if (fx.moltenPower) p.gearFx.moltenPower = (p.gearFx.moltenPower || 0) + fx.moltenPower * scale;
  }
  // #48 重建玩家数值：重放全部升级卡与装备效果（装备替换/移除时用）
  function recomputePlayer() {
    const p = game.player;
    const hpPct = p.maxHp > 0 ? p.hp / p.maxHp : 1;
    const fresh = freshPlayer(p.type);
    // 保留列表含 veinsT / veinsActive：换装备或重算属性时不应把「冰冷血脉」这类
    //   运行时 buff 静默清零（否则极寒爆发的结束边沿会丢失）。
    // 2026-11-02：装备栏已满的替换流程改为玩家主动选择后，recomputePlayer() 的调用变频繁 ——
    //   补齐全部运行时计时与状态（怒火/剑盾/急速/各职业 buff 计时/药水计时/无敌帧/战复读条与冷却等），
    //   否则「换一件装备」会把正在生效的技能效果与战复冷却一起抹掉。
    for (const k of ['x', 'y', 'level', 'xp', 'nextXp', 'kills', 'gold', 'upgrades', 'mods', 'skillBasic', 'skillActive', 'skillActive2', 'skillActive3', 'skillActive4', 'activeCd', 'activeMax', 'activeCd2', 'activeMax2', 'activeCd3', 'activeMax3', 'activeCd4', 'activeMax4', 'potCd', 'dirX', 'dirY', 'attackTimer', 'moveX', 'moveY', 'veinsT', 'veinsActive',
      // —— 运行时 buff / 计时（换装备不得清零）——
      'furyT', 'wallT', 'rapidT', 'bladeStormT', 'stormTick', 'atkAnim', 'castAnim', 'regen',
      'invuln', 'dashCd', 'dashTime', 'barrierHp', 'barrierT', 'downed',
      'brT', 'aspectT', 'brUsed', 'dsArmorT', 'chHasteT', 'chShieldT',
      'msMomT', 'mshStormT', 'abRecoilT', 'abStacks', 'chargeT', 'chargeSlot', 'kcFocusT', 'kcSwiftT',
      'potDmgT', 'potLeechT', 'potMutT', 'potArmorT', 'potReduceT', 'potHotT', 'potRevengeT',
      'reviveT', 'reviveCd', 'reviveTarget', 'revivePending']) fresh[k] = p[k];
    if (game.gameMode === 'td') {
      // ★ 塔防模式：先把「卡牌带来的修正」归零，再按 TD 卡池重放 —— 保证幂等。
      //   否则重算一次就会把「覆盖半径 +20%」这类乘算修正重复叠加。
      tdResetModifiers();
      const pool = tdUpgradePool();
      // ★ 重放期间抑制一次性效果（召唤守卫 / 切换指令），见 tdInit 里的说明
      TDR.replaying = true;
      try {
        for (const [id, n] of Object.entries(p.upgrades)) {
          const u = pool.find(x => x.id === id);
          if (u) for (let i = 0; i < n; i++) tdApplyCard(u, fresh);
        }
        // ★ 局内核心（TD 版的装备）也一起重放 —— 与强化卡同机制，保证幂等。
        for (const rec of (game.tdCores || [])) {
          const def = TD.TD_CORE_POOL.find(x => x.id === rec.id);
          if (def) for (let i = 0; i < rec.lvl; i++) tdApplyCard(def, fresh);
        }
      } finally { TDR.replaying = false; }
    } else {
      for (const [id, n] of Object.entries(p.upgrades)) {
        const u = upgradePool.find(x => x.id === id);
        if (u) for (let i = 0; i < n; i++) u.apply(fresh);
      }
    }
    for (const c of game.gear) {
      const g = GEAR[c.id];
      applyGearFx(fresh, g.fx, 1 + .5 * (c.lvl - 1));
      if (g.spec) applyGearFx(fresh, g.spec, c.lvl - 1);
    }
    fresh.hp = Math.max(1, Math.round(fresh.maxHp * hpPct));
    Object.assign(p, fresh);
    refreshBeastKing(); // 需求 12：装备/属性重算后同步兽群面板
  }
  function openGearPick() {
    const p = game.player;
    // ===== 第 6 项：已倒下的玩家不再弹出装备卡牌（与升级卡牌同理）=====
    if (p.downed) return;
    // ★ 弹层互斥（2026-11-03）：核心弹层开着时不重入装备卡弹层（避免互相遮挡）
    if (game.tdCoreOpen || game.levelupOpen) return;
    // 候选：已研习、本职业、未携带的装备
    // 第 16 项（BUG 修复）：此前副本内「本副本套装无需提前研习即可掉落」，
    //   导致玩家没研习过图纸也能在 4 个地下城副本里刷到该副本套装卡牌，与设计不符。
    //   现在严格以 save.gearLearned（研习记录）为准 —— 副本套装图纸由通关结算页发放并研习，
    //   研习后才会在副本战斗中作为装备卡掉落。
    const avail = Object.keys(GEAR).filter(gid => {
      const g = GEAR[gid];
      if (g.cls !== p.type || game.gear.some(c => c.id === gid)) return false;
      return save.gearLearned.includes(gid);
    });
    const picks = [];
    const rarBonus = game.gameMode === 'dungeon' ? 8 : Math.min((game.bossKills || 0) * 3, 18);
    // ===== 熔火之心团本橙装：已装备该橙装时，装备卡有概率刷出专属强化卡 =====
    // 需求原文：「只在战斗中装备了该橙装时，后续战斗中出现装备卡牌时才有概率刷新出该装备的强化卡牌」
    const moltenEntry = moltenGearEntry(p);
    let moltenPick = null;
    if (moltenEntry) {
      const moltenPool = MOLTEN_CARDS.filter(c => (moltenEntry.molten?.[c.id] || 0) < c.max);
      if (moltenPool.length && (forceMoltenPick || Math.random() < .35)) {
        const c = moltenPool[Math.floor(Math.random() * moltenPool.length)];
        moltenPick = { kind: 'molten', card: c, rarity: c.rar };
      }
    }
    // 常规卡最多 2 张（留 1 个位置给熔火强化卡），保证总卡数恒为 3
    const gearCap = moltenPick ? 2 : 3;
    for (let i = 0; i < gearCap; i++) {
      if (picks.length >= gearCap) break;
      if (avail.length && (picks.length < 2 || !game.gear.length)) { // #48 满 5 件后仍可出装备卡（选择后弹替换）
        const rar = rollRarity(rarBonus);
        // 副本中优先同套装（更容易凑齐套装效果）
        // 熔火 T1 的 set 带职业后缀（moltencore_mage 等），需前缀匹配
        // ★ Bug 修复：普通装备（学徒法杖等）没有 set 字段，gs 为 undefined；
        //   原写法 `gs.startsWith(...)` 会抛 TypeError。该异常发生在 update() 内，
        //   会杀死 rAF 主循环 → 画面永久冻结、只能刷新浏览器。故此处必须做空值保护。
        const sameSet = game.dungeon ? avail.filter(gid => {
          const gs = GEAR[gid].set, ds = game.dungeon.set;
          if (!gs || !ds) return false;
          return gs === ds || gs.startsWith(ds + '_');
        }) : [];
        let pool = avail.filter(gid => GEAR[gid].rarity === rar);
        if (sameSet.length && Math.random() < .65) pool = sameSet;
        if (!pool.length) pool = avail;
        const gid = pool[Math.floor(Math.random() * pool.length)];
        avail.splice(avail.indexOf(gid), 1);
        picks.push({ kind: 'gear', id: gid, rarity: GEAR[gid].rarity });
      } else if (game.gear.length) {
        // 先筛选再抽取，避免装备全满级时反复重试导致死循环
        const upgradeable = game.gear.filter(c => c.lvl < 3 && !picks.some(k => k.kind === 'up' && k.gearId === c.id));
        if (!upgradeable.length) break;
        const c = upgradeable[Math.floor(Math.random() * upgradeable.length)];
        picks.push({ kind: 'up', gearId: c.id, rarity: Math.min(4, GEAR[c.id].rarity + c.lvl) });
      } else break;
    }
    // 熔火强化卡放在最后（视觉上突出专属强化）
    if (moltenPick) picks.push(moltenPick);
    if (!picks.length) { p.gold += 20; announce('战利品折算 · +20 金币', '#ffe094', 1.4); return; }
    // ===== 装备栏已满（5/5）时的双排选择 =====
    // 需求：五件套已满时掉落新装备，不应「强制」玩家替换掉已选择并强化好的装备。
    // 旧流程：先弹 gearpick 强制三选一 → 选中新装备才进第二个弹层选替换目标 → 感知上仍是强制替换。
    // 新流程：同一个弹层里两排 —— 上排 = 本次掉落（新装备 / 强化已有装备），
    //         下排 = 已装备的 5 件；先选上排，再点下排指定替换目标；也可直接「放弃本次掉落」。
    // 「强化已有装备」卡不占栏位，点一下立即生效，无需进入第二阶段。
    const full = game.gear.length >= 5;
    const hasNew = picks.some(k => k.kind === 'gear');
    const dualRow = full && hasNew;
    // #52 联机模式：选卡不暂停战斗
    // ★ 塔防模式同样不暂停（英雄无敌 + 技能自动放）
    const live = !!game.coop || game.gameMode === 'td';
    if (live) { game.gearPickOpen = true; ui['gearpick-live'].classList.remove('hidden'); ui.gearpick.classList.add('live'); }
    else { mode = 'gearpick'; ui['gearpick-live'].classList.add('hidden'); ui.gearpick.classList.remove('live'); }
    ui.gearpick.classList.remove('hidden'); ui.gearpick.classList.add('active');
    game.gearPending = null;
    ui['gearpick-title'].textContent = dualRow ? '战利品 · 装备栏已满' : '战利品 · 选择一件';
    ui['gearpick-desc'].textContent = dualRow
      ? '上排：选择要带入的新装备（强化卡点一下直接生效）· 下排：选择要被替换掉的那一件 · 也可以直接放弃本次掉落'
      : (live ? '最多携带 5 件装备 · 满员时选择新装备可进行替换 · 可重复选择强化已有装备'
              : '时间已暂停 · 最多携带 5 件装备 · 满员时选择新装备可进行替换 · 可重复选择强化已有装备');
    ui['gear-cards'].innerHTML = '';
    picks.forEach((pick, i) => {
      const rc = RARITY[pick.rarity];
      const button = document.createElement('button');
      if (pick.kind === 'molten') {
        // 熔火之心专属强化卡：显示当前等级与下一级数值（需求：概率/范围/持续时间都可通过卡牌提示）
        const card = pick.card;
        const cur = moltenEntry?.molten?.[card.id] || 0;
        const mp = moltenParams(p);
        const preview = { ...mp, dmgMul: (1 + .4 * ((cur + 1))) * (1 + .25 * (p.gearFx?.moltenPower || 0)),
          chance: MOLTEN_BASE.chance + .04 * (cur + 1 + (card.id === 'molten_chance' ? 1 : 0)),
          radius: MOLTEN_BASE.radius + 25 * (cur + (card.id === 'molten_radius' ? 1 : 0)),
          duration: MOLTEN_BASE.duration + 1.5 * (cur + (card.id === 'molten_dur' ? 1 : 0)) };
        button.className = 'upgrade rar-' + pick.rarity + ' skill-mod';
        button.innerHTML = `<span class="up-icon" style="color:${rc.color}">${card.icon}</span><strong>${card.name}</strong>`
          + `<span class="up-type" style="color:${rc.color}">${rc.name} · 熔火之心强化 · Lv.${cur + 1}/${card.max}</span>`
          + `<p>${card.desc}<br><em style="color:#e8a45e;font-style:normal">${card.detail(preview)}</em></p><small>按 ${i + 1} 快速选择</small>`;
      } else {
        const g = GEAR[pick.kind === 'gear' ? pick.id : pick.gearId];
        const cur = pick.kind === 'up' ? game.gear.find(c => c.id === pick.gearId) : null;
        button.className = 'upgrade rar-' + pick.rarity;
        button.innerHTML = `<span class="up-icon">${gearIconHtml(pick.kind === 'gear' ? pick.id : pick.gearId)}</span><strong>${g.name}${cur ? ` Lv.${cur.lvl + 1}` : ''}</strong><span class="up-type" style="color:${rc.color}">${rc.name} · ${pick.kind === 'gear' ? '装备' : '强化'} · ${game.gear.length}/5 栏位</span><p>${pick.kind === 'gear' ? g.desc : `强化「${g.name}」：效果提升 50%${g.spec ? `<br>特化：${fxDesc(g.spec).join('，')}` : ''}`}</p><small>${pick.kind === 'gear' ? (dualRow ? '选择后再指定替换目标' : '按 ' + (i + 1) + ' 快速选择') : '按 ' + (i + 1) + ' 快速选择'}</small>`;
      }
      button.addEventListener('click', () => chooseGear(pick, i));
      ui['gear-cards'].appendChild(button);
    });
    // 下排：已装备的 5 件（仅满栏且有「新装备」时显示）
    if (dualRow) {
      ui['gear-slots'].classList.remove('hidden');
      ui['gear-slots'].classList.remove('picking');
      ui['gear-slots-label'].innerHTML = '当前装备 <span class="gs-hint">· 先在上排挑一件新装备，再点这里指定要替换掉的那件</span>';
      ui['gr-discard'].classList.remove('hidden');
      renderGearSlots();
    } else {
      ui['gear-slots'].classList.add('hidden');
      ui['gear-slots'].classList.remove('picking');
      ui['gr-discard'].classList.add('hidden');
      ui['gear-slot-cards'].innerHTML = '';
    }
  }
  // 下排渲染：当前已装备的 5 件（作为替换目标）
  function renderGearSlots() {
    const wrap = ui['gear-slot-cards'];
    wrap.innerHTML = '';
    game.gear.forEach((c, i) => {
      const og = GEAR[c.id]; const rc = RARITY[og.rarity];
      const b = document.createElement('button');
      b.className = 'gear-slot rar-' + og.rarity;
      b.innerHTML = `<span class="up-icon">${gearIconHtml(c.id)}</span><strong>${og.name}</strong>`
        + `<span class="up-type" style="color:${rc.color}">${rc.name} · Lv.${c.lvl}</span>`
        + `<small>替换掉这件</small>`;
      b.addEventListener('click', () => replaceGearSlot(i));
      wrap.appendChild(b);
    });
  }
  // 阶段一：选中要带入的新装备 → 下排进入「指定替换目标」状态
  function selectGearForReplace(pick, idx) {
    game.gearPending = pick;
    [...ui['gear-cards'].children].forEach((el, i) => {
      el.classList.toggle('gear-cards-picked', i === idx);
      el.classList.toggle('gear-cards-dim', i !== idx);
    });
    const g = GEAR[pick.id];
    ui['gear-slots'].classList.add('picking');
    ui['gear-slots-label'].innerHTML = `点击下方任意一件，替换为「<span style="color:${RARITY[g.rarity].color}">${g.name}</span>」`
      + ` <span class="gs-hint">· 或再点一次上排改选其它新装备</span>`;
  }
  // 阶段二：指定替换目标 → 旧件下线、新件入栏
  function replaceGearSlot(i) {
    const pick = game.gearPending;
    if (!pick) { toast('请先在上排选择一件新装备'); return; }
    const g = GEAR[pick.id];
    const oldC = game.gear[i];
    const og = oldC ? GEAR[oldC.id] : null;
    // 保持栏位顺序：被选中的那一格原地变成新装备（玩家能直观看到「换掉的是哪一件」）
    game.gear[i] = { id: pick.id, lvl: 1 };
    recomputePlayer();
    if (g.rarity === 4) { save.stats.orangeGear++; }
    if (save.gearLearned.includes(pick.id)) gainProf(g.school, 4);
    persist();
    announce(`替换装备 · ${og ? og.name : '空位'} → ${g.name}`, RARITY[g.rarity].color, 2.2);
    game.gearPending = null;
    closeGearPick(true);
  }
  // #45 专业熟练度：战斗中选择已研习的装备卡牌提升（新装备 +4 / 强化 +2）
  function gainProf(school, n) {
    if (!(school in save.professions)) return;
    save.professions[school] = Math.min(PROF_CAP, (save.professions[school] || 0) + n);
  }
  function chooseGear(pick, idx) {
    if (mode !== 'gearpick' && !game?.gearPickOpen) return; // #52 联机选卡时 mode 保持 playing
    const p = game.player;
    // ===== 熔火之心团本橙装：专属强化卡分支 =====
    if (pick.kind === 'molten') {
      const entry = moltenGearEntry(p);
      if (!entry) { toast('未携带熔火橙装，无法强化', '#e8a45e'); return; }
      const card = pick.card;
      entry.molten = entry.molten || {};
      const cur = entry.molten[card.id] || 0;
      if (cur >= card.max) { toast('该强化已满级', '#e8a45e'); return; }
      entry.molten[card.id] = cur + 1;
      const mp = moltenParams(p);
      announce(`强化 · ${card.name} Lv.${cur + 1}`, RARITY[pick.rarity].color, 2.2);
      game.texts.push({ x: p.x, y: p.y - 46, text: card.name, color: '#ffb257', life: 1.4, size: 14 });
      save.stats.maxGear = Math.max(save.stats.maxGear, game.gear.length);
      persist();
      FX.ring(p.x, p.y, '#ff7a2c', 20, { speed: 240 });
      closeGearPick(true);
      return;
    }
    const g = GEAR[pick.kind === 'gear' ? pick.id : pick.gearId];
    if (pick.kind === 'gear') {
      // 装备已满 5 件 → 进入第二阶段：先选中新装备，再在下方指定替换目标（可中途改选 / 放弃）
      if (game.gear.length >= 5) { selectGearForReplace(pick, idx); return; }
      game.gear.push({ id: pick.id, lvl: 1 });
      applyGearFx(p, g.fx, 1);
      if (g.rarity === 4) { save.stats.orangeGear++; }
      if (save.gearLearned.includes(pick.id)) gainProf(g.school, 4);
      announce(`获得装备 · ${g.name}`, RARITY[g.rarity].color, 2);
      haptic('loot'); // 移动端：获得装备震动
    } else {
      const c = game.gear.find(x => x.id === pick.gearId);
      if (c) { c.lvl++; applyGearFx(p, g.fx, .5); if (g.spec) applyGearFx(p, g.spec, 1); gainProf(g.school, 2); announce(`强化 · ${g.name} Lv.${c.lvl}`, RARITY[pick.rarity].color, 2); }
    }
    save.stats.maxGear = Math.max(save.stats.maxGear, game.gear.length);
    persist();
    FX.ring(p.x, p.y, RARITY[pick.rarity].color, 18, { speed: 210 });
    closeGearPick(true);
  }

  // 关闭装备弹层。gained=false 表示「放弃本次掉落」——按既有折算规则补 20 金币，不让玩家白亏
  function closeGearPick(gained) {
    ui.gearpick.classList.add('hidden'); ui.gearpick.classList.remove('active');
    game.gearPickOpen = false; game.gearPending = null;
    ui['gear-slots'].classList.add('hidden');
    ui['gear-slots'].classList.remove('picking');
    ui['gear-slot-cards'].innerHTML = '';
    ui['gr-discard'].classList.add('hidden');
    mode = 'playing';
    if (!gained) {
      const p = game.player;
      p.gold += 20;
      announce('放弃战利品 · 折算 +20 金币', '#ffe094', 1.8);
      FX.ring(p.x, p.y, '#ffe098', 18, { speed: 210 });
    }
    checkAchievements();
    pumpPopups();   // ★ 装备弹层关掉了 → 补开被推迟的强化卡 / 局内核心
    updateHUD();
  }

  function update(dt) {
    if (!game) return;
    // ★ 帧计数（低档设备 Spine 降帧用）：每帧 +1
    game.frame = (game.frame + 1) | 0;
    const p = game.player;
    // ★ 塔防模式：先跑 TD 专属逻辑（波次调度 / 自动施法 / 守卫 / 传送冷却），
    //   随后**仍然走主 update 的通用段**（投射物 / 区域 / 陷阱 / 粒子 / 清理）——
    //   这样技能弹道、AOE、DoT 等既有系统无需重写，也不会漏更新。
    //   只有「玩家移动」与「敌人 AI」两处按 TD 规则改写。
    const isTd = game.gameMode === 'td';
    if (isTd) tdUpdate(dt);
    game.elapsed += dt;
    // 冒险（无尽）模式：首领 45 秒狂暴时限；副本模式：按节奏刷新、击杀尾王通关（联机时由主机权威判定）
    const isCoopClient = game.coop && !game.coop.host;
    const bossAlive = game.enemies.some(e => e.boss && !e.dead);
    if (bossAlive) {
      game.bossAliveT += dt;
      if (!isCoopClient && game.gameMode === 'adventure' && game.bossAliveT > 45) { endGame(false, '首领未能及时击败，荒野将你吞没。'); return; }
    } else game.bossAliveT = 0;
    if (announcementTimer > 0) { announcementTimer -= dt; if (announcementTimer <= 0) ui.announcement.classList.remove('show'); }
    p.invuln = Math.max(0, p.invuln - dt); p.dashCd = Math.max(0, p.dashCd - dt);
    for (const sl of ACTIVE_SLOTS) p[sl.cd] = Math.max(0, (p[sl.cd] || 0) - dt); p.attackTimer -= dt;
    p.furyT = Math.max(0, p.furyT - dt); p.wallT = Math.max(0, p.wallT - dt); p.rapidT = Math.max(0, p.rapidT - dt);
    p.atkAnim = Math.max(0, p.atkAnim - dt); p.castAnim = Math.max(0, p.castAnim - dt);
    p.rageT = Math.max(0, (p.rageT || 0) - dt); // 无尽怒火
    for (const k of ['veinsT', 'brT', 'aspectT', 'dsArmorT', 'chHasteT', 'chShieldT', 'msMomT', 'mshStormT', 'abRecoilT', 'kcSwiftT', 'kcFocusT']) p[k] = Math.max(0, (p[k] || 0) - dt);
    // 需求 13：极寒爆发 → 冰冷血脉结束时爆发冰环（120% 范围伤害）
    // 边沿检测改用独立的 veinsActive 标志（此前用 veinsWas = veinsT 的滞后副本，
    //   施放血脉后 veinsWas 要等下一帧才刷新，veinsT 若在同帧归零则边沿永久丢失 → 冰环不触发）。
    if (p.veinsActive && p.veinsT <= 0) {
      p.veinsActive = false;
      if (p.mods.iv_burst) {
        const vr = 170;
        game.effects.push({ type: 'warning', x: p.x, y: p.y, r: 16, maxR: vr, life: .4, maxLife: .4, color: '#9fe4ff' });
        FX.ring(p.x, p.y, '#bfeaff', 22, { speed: 300 });
        aoeDamage(p.x, p.y, vr, p.damage * 1.2, 'icy_veins', { slow: [.35, 2] });
      }
    }
    p.veinsWas = p.veinsT;
    // #50 buff 持续恢复
    if (p.brT > 0 && p.mods.br_regen) p.hp = Math.min(p.maxHp, p.hp + p.maxHp * .01 * dt);
    if (p.veinsT > 0 && p.mods.iv_regen) p.hp = Math.min(p.maxHp, p.hp + p.maxHp * .01 * dt);
    if (p.regen) p.hp = Math.min(p.maxHp, p.hp + p.regen * dt);
    // 寒冰护体到期
    if (p.barrierT > 0) { p.barrierT -= dt; if (p.barrierT <= 0 && p.barrierHp > 0) { p.barrierHp = 0; barrierBreak(p); } }
    // 药水 buff 计时
    p.castSurgeT = Math.max(0, (p.castSurgeT || 0) - dt);
    p.dashSurgeT = Math.max(0, (p.dashSurgeT || 0) - dt);
    p.castHasteT = Math.max(0, (p.castHasteT || 0) - dt);
    p.potCd = Math.max(0, p.potCd - dt);
    for (const k of ['potDmgT', 'potLeechT', 'potMutT', 'potArmorT', 'potReduceT', 'potRevengeT']) p[k] = Math.max(0, p[k] - dt);
    if (p.potHotT > 0) { p.potHotT -= dt; p.hp = Math.min(p.maxHp, p.hp + p.maxHp * .05 * dt); }

    // 移动向量 = 键盘方向 + 摇杆方向（桌面固定摇杆 / 移动端跟随摇杆）
    const md = mobileDir();
    let mx = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) + joy.x + md.x;
    let my = (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) + joy.y + md.y;
    // ★ 塔防模式：英雄不能自由移动（只能在传送阵之间瞬移），摇杆也无效
    if (isTd) { mx = 0; my = 0; }
    const ml = Math.hypot(mx, my); if (ml > 1) { mx /= ml; my /= ml; } p.moveX = mx; p.moveY = my;
    if (ml > .08) { p.dirX = mx / (ml || 1); p.dirY = my / (ml || 1); }
    if (p.downed) { mx = 0; my = 0; } // #51 联机倒下后观战
    // ===== 第 11 项：战复读条（移动打断；读条期间停止自动攻击）=====
    p.reviveCd = Math.max(0, p.reviveCd - dt);
    p.revivePending = Math.max(0, (p.revivePending || 0) - dt);
    if (p.reviveT > 0) {
      const mvNow = Math.hypot(p.moveX, p.moveY) > .08;
      const rtg = game.allies ? game.allies.get(p.reviveTarget) : null;
      if (mvNow) interruptRevive();                        // 移动打断读条
      else if (!rtg || !rtg.dead) interruptRevive(true);   // 目标已被救起 / 失效
      else if (Math.hypot(rtg.x - p.x, rtg.y - p.y) > REVIVE_OVERLAP * 2) interruptRevive(true); // 脱离站位
      else { p.reviveT -= dt; if (p.reviveT <= 0) { p.reviveT = 0; finishRevive(); } }
    }
    const speed = p.speed * (p.dashTime > 0 ? 4.4 : 1) * (setHas('fang', 2) ? 1.12 : 1) * (p.castHasteT > 0 ? 1 + (p.gearFx.castHaste || 0) : 1)
      * (p.furyT > 0 && p.mods.blood_rush ? 1.2 : 1) * (p.bladeStormT > 0 && p.mods.storm_fury ? 1.25 : 1)
      * (p.aspectT > 0 ? 1.25 + .1 * (p.mods.aw_speed || 0) : 1) * (p.brT > 0 && p.mods.br_speed ? 1.12 : 1)
      // 需求 12：荒野奔袭 → 守护期间移速额外 +12%
      * (p.aspectT > 0 && p.mods.aw_dodge ? 1.12 : 1)
      * (p.veinsT > 0 && p.mods.iv_speed ? 1.12 : 1) * (p.kcSwiftT > 0 ? 1.1 : 1) * (p.chShieldT > 0 ? 1.15 : 1);
    if (p.chargeT > 0) {
      // #50 冲锋：高速突进并撞击路径敌人
      p.chargeT -= dt;
      p.x += p.chargeDirX * 900 * dt; p.y += p.chargeDirY * 900 * dt;
      FX.emit({ x: p.x, y: p.y, vx: 0, vy: 0, life: .25, maxLife: .25, color: '#f3b47d', size: 8, glow: true });
      for (const e of game.enemies) {
        if (e.dead || p.chargeHits.has(e)) continue;
        if (distance(p, e) < p.chargeW + e.r) {
          p.chargeHits.add(e);
          const ea = Math.atan2(e.y - p.y, e.x - p.x);
          damageEnemy(e, p.damage * p.chargeDmg, ea, 'charge');
          applyStun(e, p.chargeStun);
          if (!e.boss && e.type !== 'golem') { e.x += Math.cos(ea) * 60; e.y += Math.sin(ea) * 60; }
        }
      }
      if (p.chargeT <= 0 && p.mods.ch_quake) { // 大地震颤：终点震击
        aoeDamage(p.x, p.y, 130, p.damage * .8, 'charge', {});
        FX.ring(p.x, p.y, '#e8c97d', 18, { speed: 260 });
        game.shake = Math.max(game.shake, 8);
      }
    } else {
      p.x += mx * speed * dt; p.y += my * speed * dt;
    }
    if (p.dashTime > 0) { p.dashTime -= dt; if (Math.random() < .7) game.particles.push({ x: p.x, y: p.y, vx: 0, vy: 0, life: .25, maxLife: .25, color: heroes[p.type].color, size: 9 }); }
    if (!isTd && p.attackTimer <= 0 && !p.downed && !(p.reviveT > 0)) playerAttack(); // 第 11 项：战复读条期间停止自动攻击；★ TD 由 tdAutoCast 驱动

    // 剑刃风暴
    if (p.bladeStormT > 0) {
      p.bladeStormT -= dt; p.stormTick -= dt;
      if (p.stormTick <= 0) {
        p.stormTick = .32;
        const r = skillAreaRadius('blade_storm', p);
        game.effects.push({ type: 'slash', x: p.x, y: p.y, r: 10, maxR: r, life: .26, maxLife: .26, color: '#f3b47d' });
        const dmg = p.damage * .75 * (1 + .3 * (p.mods.storm_dmg || 0));
        for (const e of game.enemies) {
          if (!e.dead && distance(p, e) < r + e.r) damageEnemy(e, dmg, Math.atan2(e.y - p.y, e.x - p.x), 'blade_storm');
        }
      }
    }

    // 首领节奏：副本按副本时间轴；冒险无尽模式每 90 秒一位（联机客户端不刷怪，由主机同步）
    // ★ 塔防模式例外：怪物只由 tdNextWave/tdSpawnEnemy 产出（沿固定路径行进），常规出怪必须关掉，
    //   否则常规游荡怪会混入 game.enemies，让 e.tdLane 判定失效、TD 怪看起来「不前进」。
    if (!isCoopClient && !isTd) {
      const nextBossAt = game.gameMode === 'dungeon'
        ? (game.dungeon.bossTimes[game.bossIndex] ?? Infinity)
        : 55 + game.bossIndex * 90;
      if (game.elapsed >= nextBossAt) spawnEnemy(true);
      game.spawnTimer -= dt;
      if (game.spawnTimer <= 0 && game.enemies.length < 270) {
        const count = game.elapsed > 180 && Math.random() < .3 ? 2 : 1; // #43 推迟双刷时间点
        for (let i = 0; i < count; i++) spawnEnemy();
        game.spawnTimer = Math.max(.16, .95 - game.elapsed / 560) * rand(.8, 1.25) / (1 + .4 * ((game.playerCount || 1) - 1)); // #43 前期放缓 #51 联机加频
      }
    }

    for (const e of game.enemies) {
      if (e.dead) continue;
      e.hitCd = Math.max(0, e.hitCd - dt); e.flash = Math.max(0, e.flash - dt); e.phase += dt;
      e.spawnT = Math.max(0, (e.spawnT || 0) - dt);
      e.atkT = Math.max(0, (e.atkT || 0) - dt);
      e.vulnT = Math.max(0, (e.vulnT || 0) - dt);
      e.slowT = Math.max(0, (e.slowT || 0) - dt); if (e.slowT <= 0) e.slow = 0;
      e.stunT = Math.max(0, (e.stunT || 0) - dt);
      e.dotTick = Math.max(0, (e.dotTick || 0) - dt);
      // 第 10 项：尖牙 5 件套「猎杀印记」计时衰减
      if (e.markStacks > 0) { e.markT = Math.max(0, (e.markT || 0) - dt); if (e.markT <= 0) e.markStacks = 0; }
      if (e.boss || e.spine) SPINE.updateActor(e, bossSpineKey(e), { moving: e.stunT <= 0, stun: e.stunT > 0,
        attack: e.atkT > 0 && e.atkT <= .25 ? e.atkT : 0, cast: e.atkT > .25 ? e.atkT : 0 }, dt);
      // #51 客户端傀儡：不跑 AI/DoT，仅插值向快照位置（权威在主机）
      if (game.coop && !game.coop.host) {
        if (e.burnT > 0) e.burnT -= dt;
        if (e.poisT > 0) e.poisT -= dt;
        if (e.tx !== undefined) { e.x += (e.tx - e.x) * Math.min(1, dt * 12); e.y += (e.ty - e.y) * Math.min(1, dt * 12); }
        continue;
      }
      // DoT 结算：燃烧 / 中毒 / 流血
      if (e.burnT > 0) { e.burnT -= dt; dotDamage(e, (e.burnDps || 0) * dt, '#f28a52'); if (e.dead) continue; }
      if (e.poisT > 0) { e.poisT -= dt; dotDamage(e, (e.poisDps || 0) * dt, '#9fd86a'); if (e.dead) continue; }
      if (e.bleedT > 0) { e.bleedT -= dt; dotDamage(e, (e.bleedDps || 0) * dt, '#d94f5c'); if (e.dead) continue; }
      if (e.stunT > 0) continue; // 眩晕：无法移动与攻击
      // ★ 塔防模式：怪物沿固定路径行进，不追玩家、不攻击英雄
      if (e.tdLane) { tdMoveEnemy(e, dt); continue; }
      e.shootCd -= dt; e.specialCd -= dt;
      const tgt = game.coop ? nearestHero(e) : p; // #51 联机：攻击最近英雄
      const sp = e.speed * (e.slowT > 0 ? 1 - e.slow : 1);
      const dx = tgt.x - e.x, dy = tgt.y - e.y, d = Math.hypot(dx, dy) || 1, nx = dx / d, ny = dy / d;
      if ((e.type === 'cultist' || e.type === 'troll' || e.type === 'wraith') && d < 430) { // #55 怨灵远程
        if (d > 260) { e.x += nx * sp * dt; e.y += ny * sp * dt; }
        else if (d < 190) { e.x -= nx * sp * .65 * dt; e.y -= ny * sp * .65 * dt; }
        if (e.shootCd <= 0) {
          e.atkT = .25; // 远程施法动作
          if (e.type === 'troll') { shootEnemy(e, Math.atan2(dy, dx), 310, 9); e.shootCd = 2.7; }
          else if (e.type === 'wraith') { shootEnemy(e, Math.atan2(dy, dx), 280, 11); e.shootCd = 2.4; } // #55
          else { shootEnemy(e, Math.atan2(dy, dx), 260, 9); e.shootCd = 2.2; }
        }
      } else {
        const wobble = e.type === 'murloc' ? Math.sin(e.phase * 6) * .35 : (e.type === 'wolf' || e.type === 'felhound') ? Math.sin(e.phase * 9) * .5 : 0; // #55 猎犬扑跃
        e.x += (nx - ny * wobble) * sp * dt; e.y += (ny + nx * wobble) * sp * dt;
      }
      // ===== 熔火之心：团本首领多技能调度（独立于 kind 单分支，旧 4 副本零回归）=====
      if (e.raidSkills) {
        for (let i = 0; i < e.skillCd.length; i++) e.skillCd[i] -= dt;
        // 找到下一个冷却好的技能（按轮转顺序），释放后重置其冷却
        let cast = -1;
        for (let i = 0; i < e.raidSkills.length; i++) {
          const k = (e.skillIdx + i) % e.raidSkills.length;
          if (e.skillCd[k] <= 0) { cast = k; break; }
        }
        if (cast >= 0) {
          const sk = e.raidSkills[cast];
          e.skillCd[cast] = sk.cd;
          e.skillIdx = (cast + 1) % e.raidSkills.length;
          e.atkT = .4;
          castRaidSkill(e, sk, tgt);
        }
      } else if (e.boss && e.specialCd <= 0) {
        e.atkT = .35; // 首领技能动作（第 10 项：按 kind 分派，副本首领行为与自身主题契合）
        const K = e.kind || 'volley';
        if (K === 'volley') { // 瞄准扇形弹幕
          for (let i = 0; i < 5; i++) shootEnemy(e, Math.atan2(dy, dx) + rand(-.35, .35), 300, 10);
          game.effects.push({ type: 'warning', x: e.x, y: e.y, r: 20, maxR: 120, life: .45, maxLife: .45, color: '#c283d3' });
          e.specialCd = 3.6;
        } else if (K === 'summon') { // 召唤援军 + 环形弹幕
          for (let i = 0; i < 3; i++) { const m = spawnEnemy(); m.x = e.x + rand(-80, 80); m.y = e.y + rand(-80, 80); }
          for (let i = 0; i < 12; i++) shootEnemy(e, i / 12 * TAU, 190, 12);
          announce(`${e.name} 召唤了援军`, '#f1a277', 2);
          e.specialCd = 6;
        } else if (K === 'flame') { // 双重火焰环（快慢交错）
          for (let i = 0; i < 12; i++) shootEnemy(e, i / 12 * TAU, 170, 12);
          for (let i = 0; i < 8; i++) shootEnemy(e, i / 8 * TAU + .2, 265, 14);
          game.effects.push({ type: 'warning', x: e.x, y: e.y, r: 20, maxR: 190, life: .6, maxLife: .6, color: '#f28a52' });
          e.specialCd = 4.2;
        } else if (K === 'frost') { // 七发扇形寒霜弹幕
          for (let i = 0; i < 7; i++) shootEnemy(e, Math.atan2(dy, dx) + (i - 3) * .16, 330, 11);
          game.effects.push({ type: 'warning', x: e.x, y: e.y, r: 20, maxR: 130, life: .45, maxLife: .45, color: '#9fe4ff' });
          e.specialCd = 3.4;
        } else if (K === 'plague') { // 召唤蛛群 + 毒雾环
          for (let i = 0; i < 3; i++) { const m = spawnEnemy(); m.x = e.x + rand(-90, 90); m.y = e.y + rand(-90, 90); }
          for (let i = 0; i < 10; i++) shootEnemy(e, i / 10 * TAU, 200, 11);
          announce(`${e.name} 散播疫云`, '#9fd86a', 2);
          e.specialCd = 6.5;
        } else if (K === 'quake') { // 地震冲击：近身重击 + 击退
          game.effects.push({ type: 'warning', x: e.x, y: e.y, r: 20, maxR: 150, life: .5, maxLife: .5, color: '#e8a45e' });
          game.shake = Math.max(game.shake, 9);
          for (let i = 0; i < 8; i++) shootEnemy(e, i / 8 * TAU + .2, 240, 13);
          e.specialCd = 4.6;
        } else if (K === 'drain') { // 暗影汲取：吸血光环 + 减速弹幕
          for (let i = 0; i < 14; i++) shootEnemy(e, i / 14 * TAU + .1, 175, 9);
          game.effects.push({ type: 'warning', x: e.x, y: e.y, r: 20, maxR: 150, life: .5, maxLife: .5, color: '#8a7ad0' });
          e.specialCd = 4.2;
        } else {
          for (let i = 0; i < 12; i++) shootEnemy(e, i / 12 * TAU, 190, 12);
          game.effects.push({ type: 'warning', x: e.x, y: e.y, r: 20, maxR: 160, life: .55, maxLife: .55, color: '#df7958' });
          e.specialCd = 4.5;
        }
      }
      if (d < e.r + tgt.r + 2 && e.hitCd <= 0) {
        if (game.coop && tgt.id) NET.sendSnap({ k: 'hit', to: tgt.id, d: Math.round(e.damage) }); // #51 命中队友 → 通知其客户端结算
        else hurtPlayer(e.damage, e);
        e.hitCd = .75; e.atkT = .22; e.x -= nx * 12; e.y -= ny * 12;
      }
    }

    for (const q of game.projectiles) {
      q.x += q.vx * dt; q.y += q.vy * dt; q.life -= dt; q.spin = (q.spin || 0) + dt * 9;
      if (['double_shot', 'serpent_sting', 'aimed_shot', 'multi_shot'].includes(q.skill)) SPINE.updateFx(q, 'hunter_arrow', dt, { loop: true, timeScale: 1.35 });
      // 弹道拖尾（节流：仅特效投射物、低概率发射，控制粒子总量）
      if ((q.skill === 'fireball' || q.skill === 'frostbolt' || q.skill === 'aimed_shot' || q.skill === 'arcane_missiles') && Math.random() < .3) {
        const tc = { fireball: '#f2a262', frostbolt: '#bfeaff', aimed_shot: '#ffe1a1', arcane_missiles: '#7de7ff' }[q.skill];
        FX.emit({ x: q.x, y: q.y, vx: -q.vx * .04, vy: -q.vy * .04, life: .22, maxLife: .22, color: tc, size: q.r * .55, shrink: true, glow: true });
      }
      for (const e of game.enemies) {
        if (e.dead || q.hit.has(e) || q.life <= 0) continue;
        if (distance(q, e) < q.r + e.r) { q.hit.add(e); hitWithProjectile(q, e); if (q.pierce > 0) q.pierce--; else q.life = 0; }
      }
    }
    for (const q of game.enemyShots) {
      q.x += q.vx * dt; q.y += q.vy * dt; q.life -= dt;
      if (q.life > 0 && distance(q, p) < q.r + p.r) { hurtPlayer(q.damage, null); q.life = 0; }
    }
    for (const o of game.orbs) {
      o.x += o.vx * dt; o.y += o.vy * dt; o.life -= dt; o.tick -= dt;
      SPINE.updateFx(o, 'magic_circle', dt, { loop: true, timeScale: 1.15 });
      if (o.tick <= 0) {
        o.tick = .3;
        // 需求 13：极地扩张 → 宝珠冻伤范围随卡牌扩大
        const orbAoe = o.aoeR || 95;
        for (const e of game.enemies) {
          if (!e.dead && distance(o, e) < orbAoe + e.r) {
            damageEnemy(e, o.dmg, Math.atan2(e.y - o.y, e.x - o.x), 'frost_orb');
            if (o.slow) applySlow(e, o.slow, 1.2);
          }
        }
      }
      if (Math.random() < .5) game.particles.push({ x: o.x + rand(-14, 14), y: o.y + rand(-14, 14), vx: 0, vy: 0, life: .4, maxLife: .4, color: '#aee9ff', size: 5 });
    }
    // 暴风雪/烈焰风暴/龟裂等区域
    for (const z of game.zones) {
      z.life -= dt; z.tick -= dt;
      if (zoneSpineKey(z)) SPINE.updateFx(z, zoneSpineKey(z), dt, { loop: true, timeScale: 1.1 });
      if (z.tick <= 0) {
        z.tick = .3;
        for (const e of game.enemies) {
          if (!e.dead && distance(z, e) < z.r + e.r) {
            /* ★ HUNTER_HOOK · ⑫：区域直伤可被 noDmg 跳过（猎人「毒云领域」走 onZoneTick 施加中毒）——
               否则 0 伤害调用会白白吃掉一次暴击随机数，并污染 e.killedBy（影响击杀联动）。 */
            if (!z.noDmg) damageEnemy(e, z.dmg, Math.atan2(e.y - z.y, e.x - z.x), 'blizzard');
            if (z.poison) applyPoison(e, z.dmg * .55, 2); // 凋零 5 件套：亡者回响毒雾
            /* ★ HUNTER_HOOK · ⑬：区域持续效果钩子（猎人「毒云领域」的持续中毒） */
            if (window.HUNTER) window.HUNTER.onZoneTick(hunterCtx(), z, e);
            if (z.slow) applySlow(e, z.slow, .8);
            if (z.burn) applyBurn(e, z.burn, z.burnDur || 1.2); // 烈焰风暴·余烬缠身 / 熔火之心·岩浆池
            if (z.vuln) { e.vulnT = Math.max(e.vulnT || 0, .6); e.vulnAmt = z.vuln; } // 熔甲烈焰
            if (!z.crack && p.mods.ice_tomb) e.vulnT = .8; // 冰封陵墓
          }
        }
        // 需求 13：永冬之息 → 暴风雪期间每 2 秒降下冰锥造成 80% 伤害
        if (z.blizzard && p.mods.bliz_storm) {
          z.stormT = (z.stormT || 0) - .3;
          if (z.stormT <= 0) {
            z.stormT = 2;
            const tx = z.x + rand(-z.r * .6, z.r * .6), ty = z.y + rand(-z.r * .6, z.r * .6);
            game.effects.push({ type: 'warning', x: tx, y: ty, r: 6, maxR: 46, life: .28, maxLife: .28, color: '#9fe4ff' });
            for (const e of game.enemies) {
              if (!e.dead && distance({ x: tx, y: ty }, e) < 46 + e.r) damageEnemy(e, p.damage * .8, Math.atan2(e.y - ty, e.x - tx), 'blizzard');
            }
          }
        }
      }
      if (Math.random() < .8) game.particles.push({ x: z.x + rand(-z.r, z.r), y: z.y + rand(-z.r, z.r), vx: 0, vy: z.crack ? -50 : 60, life: .5, maxLife: .5, color: z.crack ? '#e8a45e' : z.arcane ? '#b7a4f2' : '#cfeaff', size: 3 });
    }
    // #50 陷阱系统（爆炸/冰冻）
    for (const tr of game.traps) {
      tr.life -= dt;
      SPINE.updateFx(tr, tr.type === 'explosive' ? 'hunter_trap' : 'mage_ice', dt, { loop: true, timeScale: .85 });
      let triggered = tr.life <= 0;
      if (!triggered) for (const e of game.enemies) if (!e.dead && distance(tr, e) < tr.r + e.r) { triggered = true; break; }
      if (!triggered) continue;
      tr.dead = true;
      if (tr.type === 'explosive') {
        spawnSpineFx('common_explosion', tr.x, tr.y, { life: 1, size: tr.boomR * 2, fit: 'diameter', alpha: .94, timeScale: 1.8 });
        game.effects.push({ type: 'warning', x: tr.x, y: tr.y, r: 12, maxR: tr.boomR, life: .35, maxLife: .35, color: '#f6a04d' });
        FX.burst(tr.x, tr.y, '#f6a04d', 24, { speed: 260, grav: 160 });
        game.shake = Math.max(game.shake, 8);
        aoeDamage(tr.x, tr.y, tr.boomR, tr.dmg, 'explosive_trap', {
          burn: p.mods.et_burn ? p.damage * .15 : 0, burnDur: 2,
          knock: p.mods.et_knock ? 110 : 0, knockBoss: !!p.mods.et_sticky });
        /* ★ HUNTER_HOOK · ⑩：猎人陷阱爆炸钩子（「连环雷爆」的闪电链） */
        if (window.HUNTER) window.HUNTER.onTrapBoom({ ...hunterCtx(), tr });
        if (p.mods.et_nova) game.zones.push({ x: tr.x, y: tr.y, r: tr.boomR * .8, life: 3, maxLife: 3, tick: 0, dmg: p.damage * .3, slow: 0, crack: true });
      } else { // freezing 冰冻陷阱
        spawnSpineFx('mage_ice', tr.x, tr.y, { life: .9, size: tr.boomR * 2, fit: 'diameter', alpha: .94, timeScale: 1.4 });
        game.effects.push({ type: 'warning', x: tr.x, y: tr.y, r: 12, maxR: tr.boomR, life: .4, maxLife: .4, color: '#9fe4ff' });
        FX.ring(tr.x, tr.y, '#bfeaff', 16, { speed: 220 });
        for (const e of game.enemies) {
          if (e.dead || distance(tr, e) >= tr.boomR + e.r) continue;
          const dur = 2 + .8 * (p.mods.ft_len || 0) + (p.mods.ft_apex ? 1 : 0);
          // ★ BUG 修复：冰冻陷阱的伤害系数（130% 武器伤害）此前从未结算 ——
          //   tr.dmg 只在爆炸陷阱分支被使用，冰冻分支只冻结不造成伤害，
          //   卡片描述里承诺的「130% 武器伤害」完全落空（猎人白拿一张控制卡）。
          damageEnemy(e, tr.dmg, Math.atan2(e.y - tr.y, e.x - tr.x), 'freezing_trap');
          if (e.boss) { if (p.mods.ft_apex) applyStun(e, 2); }
          else applyStun(e, dur);
          if (p.mods.ft_shatter) { e.vulnT = Math.max(e.vulnT || 0, dur); e.vulnAmt = .15; }
          if (p.mods.ft_slow) applySlow(e, .4, 2 + dur);
          if (p.mods.ft_nova) damageEnemy(e, p.damage * .6, Math.atan2(e.y - tr.y, e.x - tr.x), 'freezing_trap');
        }
        /* ★ HUNTER_HOOK · ⑪：猎人冰冻陷阱钩子（「碎冰爆裂」的冰爆） */
        if (window.HUNTER) window.HUNTER.onTrapBoom({ ...hunterCtx(), tr });
      }
    }
    game.traps = game.traps.filter(t => !t.dead);
    // 流星火雨 / 回响爆鸣 / 双重震波（延迟打击）
    for (const m of game.meteors) {
      m.t -= dt;
      if (m.t <= 0 && !m.hit) {
        m.hit = true;
        game.effects.push({ type: 'warning', x: m.x, y: m.y, r: 8, maxR: m.r, life: .25, maxLife: .25, color: m.color || '#f28a52' });
        FX.burst(m.x, m.y, m.color || '#f6a04d', 10, { speed: 160, grav: 200 });
        for (const e of game.enemies) {
          if (!e.dead && distance(m, e) < m.r + e.r) {
            damageEnemy(e, m.dmg, Math.atan2(e.y - m.y, e.x - m.x), m.skill || 'fireball');
            if (!m.color) applyBurn(e, p.damage * .1, 2);
            if (m.stun) applyStun(e, m.stun);
          }
        }
      }
    }
    game.meteors = game.meteors.filter(m => !m.hit);
    // 熔火之心：地板延时预警推进（仅主机结算；客户端以快照为准）
    if (game.coop && !game.coop.host) {
      // 客户端：仅按快照插值推进显示，不做伤害判定
      for (const tg of game.telegraphs || []) { tg.life -= dt; if (tg.spin) tg.ang += tg.spin * dt; }
      game.telegraphs = (game.telegraphs || []).filter(t => t.life > 0);
    } else {
      updateTelegraphs(dt);
    }
    // 狼伴 / #50 镜像（远程）
    for (const pet of game.pets) {
      pet.life -= dt; pet.atkCd -= dt; pet.phase += dt;
      pet.atkAnim = Math.max(0, (pet.atkAnim || 0) - dt);
      pet.hasteT = Math.max(0, (pet.hasteT || 0) - dt);
      // 兽王威压 buff 计时（到期后强化效果消失）
      if (pet.auraT > 0) { pet.auraT -= dt; if (pet.auraT <= 0) { pet.auraDmg = 0; pet.auraRate = 0; pet.auraLeap = 0; } }
      if (pet.ranged) {
        const d0 = distance(pet, p) || 1;
        if (d0 > 90) { pet.x += (p.x - pet.x) / d0 * 260 * dt; pet.y += (p.y - pet.y) / d0 * 260 * dt; }
        let target = null, bestD = pet.range || 520;
        for (const e of game.enemies) { if (e.dead) continue; const d = distance(pet, e); if (d < bestD) { bestD = d; target = e; } }
        if (target && pet.atkCd <= 0) {
          pet.atkCd = (pet.atkRate || .9) * (pet.hasteT > 0 ? .7 : 1); pet.atkAnim = .14;
          const cnt = 1 + (pet.multi || 0);
          for (let i = 0; i < cnt; i++) {
            const ang = Math.atan2(target.y - pet.y, target.x - pet.x) + (i - (cnt - 1) / 2) * .15;
            game.projectiles.push({ x: pet.x, y: pet.y, vx: Math.cos(ang) * 560, vy: Math.sin(ang) * 560, r: 5, damage: pet.dmg, life: 1.1, color: pet.shadow ? '#b0aef0' : '#d9b8f2', pierce: 0, hit: new Set(), skill: pet.shadow ? 'shadowbolt' : 'arcane_missiles' });
          }
        }
        if (Math.random() < .25) game.particles.push({ x: pet.x + rand(-8, 8), y: pet.y + rand(-8, 8), vx: 0, vy: 0, life: .3, maxLife: .3, color: '#d9b8f2', size: 4 });
        if (!pet.shadow) SPINE.updateActor(pet, 'mage', { moving: true, attack: pet.atkAnim, cast: 0 }, dt);
        continue;
      }
      let target = null, bestD = pet.range || 460;
      // 需求 12：兽王统御 → 守护期间狼伴索敌范围额外扩大 120 码/级
      if (p.aspectT > 0 && p.mods.aw_pack_dmg) bestD += 120 * p.mods.aw_pack_dmg;
      for (const e of game.enemies) { if (e.dead) continue; const d = distance(pet, e); if (d < bestD) { bestD = d; target = e; } }
      if (target) {
        const d = distance(pet, target) || 1;
        if (d > target.r + 22) { pet.x += (target.x - pet.x) / d * 320 * dt; pet.y += (target.y - pet.y) / d * 320 * dt; }
        else if (pet.atkCd <= 0) {
          // 兽王威压：攻速与伤害加成（buff 期间生效）
          const auraRate = pet.auraRate || 0;
          pet.atkCd = (pet.atkRate || .6) * (pet.hasteT > 0 ? .7 : 1) * (1 - auraRate);
          pet.atkAnim = .14;
          let dmg = pet.dmg * (1 + (pet.auraDmg || 0));
          if (p.mods.pack_tactics && target.poisT > 0) dmg *= 1.5;
          // 需求 12：兽王统御 → 守护期间狼伴额外伤害 +20%/级
          if (p.aspectT > 0 && p.mods.aw_pack) dmg *= 1.3;
          if (p.aspectT > 0 && p.mods.aw_pack_dmg) dmg *= 1 + .2 * p.mods.aw_pack_dmg;
          game.effects.push({ type: 'slash', x: target.x, y: target.y, r: 4, maxR: 26, life: .15, maxLife: .15, color: '#b9c8d8' });
          damageEnemy(target, dmg, Math.atan2(target.y - pet.y, target.x - pet.x), 'pet');
          // 兽王威压·突进：命中击退
          if (pet.auraLeap > 0 && !target.boss) {
            const ka = Math.atan2(target.y - pet.y, target.x - pet.x);
            target.x += Math.cos(ka) * 26 * pet.auraLeap;
            target.y += Math.sin(ka) * 26 * pet.auraLeap;
          }
          // 撕裂之爪：命中后流血（持续伤害）
          if (pet.bleed > 0) applyBleed(target, p.damage * .25 * pet.bleed, 3);
          /* ★ HUNTER_HOOK · ⑮：狼伴命中钩子（「撕咬裂伤」的溅射） */
          if (window.HUNTER) window.HUNTER.onPetHit({ ...hunterCtx(), target });
        }
      } else {
        const d = distance(pet, p) || 1;
        if (d > 70) { pet.x += (p.x + 30 - pet.x) / d * 300 * dt; pet.y += (p.y + 20 - pet.y) / d * 300 * dt; }
      }
      SPINE.updateActor(pet, 'pet_wolf', { moving: true, attack: pet.atkAnim, cast: 0 }, dt);
    }
    for (const g of game.gems) {
      g.x += g.vx * dt; g.y += g.vy * dt; g.vx *= Math.pow(.05, dt); g.vy *= Math.pow(.05, dt);
      const d = distance(g, p);
      if (d < p.magnet) { const pull = clamp(420 / d, 3, 16); g.x += (p.x - g.x) * pull * dt; g.y += (p.y - g.y) * pull * dt; }
      if (d < p.r + 12) { g.dead = true; gainXp(g.value); if (mode !== 'playing') break; }
    }
    for (const a of [game.particles, game.texts, game.effects]) for (const v of a) { v.life -= dt; if (v.vx !== undefined) { v.x += v.vx * dt; v.y += v.vy * dt; v.vx *= .96; v.vy *= .96; } }
    // ★ 塔防模式：地图很大（3072×1918），不能按「离玩家 1800 码」清理远处的怪
    game.enemies = game.enemies.filter(e => !e.dead && (isTd || e.boss || distance(e, p) < 1800)); // 首领不参与远距离清理，避免风筝时被误删
    game.projectiles = game.projectiles.filter(q => q.life > 0);
    game.enemyShots = game.enemyShots.filter(q => q.life > 0);
    game.orbs = game.orbs.filter(o => {
      if (o.life > 0) return true;
      // 永恒冰霜：宝珠消散时爆发冰环
      if (p.mods.eternal_frost) {
        game.effects.push({ type: 'warning', x: o.x, y: o.y, r: 10, maxR: 130, life: .35, maxLife: .35, color: '#9fe4ff' });
        FX.ring(o.x, o.y, '#bfeaff', 18, { speed: 220 });
        for (const e of game.enemies) {
          if (!e.dead && distance(o, e) < 130 + e.r) { damageEnemy(e, p.damage * .8, Math.atan2(e.y - o.y, e.x - o.x), 'frost_orb'); applyStun(e, 1); }
        }
      }
      return false;
    });
    game.zones = game.zones.filter(z => z.life > 0);
    game.pets = game.pets.filter(pt => {
      if (pt.life > 0) return true;
      if (pt.expl) { // 镜影爆裂
        aoeDamage(pt.x, pt.y, 120, p.damage * pt.expl, 'mirror_image', {});
        FX.burst(pt.x, pt.y, '#d9b8f2', 16, { speed: 200 });
        game.effects.push({ type: 'warning', x: pt.x, y: pt.y, r: 10, maxR: 120, life: .3, maxLife: .3, color: '#d9b8f2' });
      }
      return false;
    });
    game.gems = game.gems.filter(g => !g.dead);
    game.particles = game.particles.filter(v => v.life > 0); game.texts = game.texts.filter(v => v.life > 0); game.effects = game.effects.filter(v => v.life > 0);
    // ★ 粒子上限按设备档位分级（移动端体验优化 §3.6）
    //   原先 game.particles 无上限，只靠 life 自然回收 → 低端机大招同屏时直接掉帧。
    //   档位与 fx.js 的粒子预算同源（270 / 160 / 90）。
    const pCap = (window.__perfTier && window.__perfTier.particles()) || 270;
    if (game.particles.length > pCap) game.particles.splice(0, game.particles.length - pCap);
    game.shake = Math.max(0, game.shake - 30 * dt); game.flash = Math.max(0, game.flash - dt);
    // ★ 弹层仲裁（2026-11-03）：同一时刻只允许一个「选卡类」弹层 ——
    //   强化卡(#levelup) / 装备卡(#gearpick) / 局内核心(#td-core)。
    //   旧实现三条触发各写各的，两个弹层可同时打开并互相遮挡（#levelup 在 DOM 里靠后
    //   → 盖住核心弹层），玩家表现成「连续弹出核心和技能框、选了技能后点不到核心」。
    //   现在统一走 pumpPopups()：同一时刻只开一个，谁先关下一个补上
    //   （塔防：局内核心优先于强化卡；其它模式：强化卡 → 装备卡）。
    pumpPopups();
    // 环境飘浮微粒（萤火/尘埃）
    if (Math.random() < dt * 5) FX.emit({ x: p.x + rand(-width / 2, width / 2), y: p.y + rand(-height / 2, height / 2),
      vx: rand(-8, 8), vy: rand(-14, -5), life: rand(2, 3.5), maxLife: 3.5, color: '#8fbf9a', size: rand(1, 2.2), glow: true, alpha: .3 });
    FX.update(dt);
    // #53/#54 队友技能视觉：真实事件驱动（renderAllySkillFx 注入），此处仅推进生命周期
    if (game.coop) {
      game.allyFx = game.allyFx.filter(f => {
        f.life -= dt;
        if (f.type === 'bolt' || f.type === 'orbfx') { f.x += f.vx * dt; f.y += f.vy * dt; }
        if (f.type === 'ring') f.r = f.maxR * (1 - f.life / f.maxLife);
        return f.life > 0;
      });
    }
    // #51 联机同步：主机广播快照（10Hz）/ 客户端上报自身状态（15Hz）
    if (game.coop) {
      if (game.coop.host) {
        game._snapT = (game._snapT || 0) - dt;
        if (game._snapT <= 0) { game._snapT = .1; NET.sendSnap(buildSnapshot()); }
      } else {
        game._psT = (game._psT || 0) - dt;
        if (game._psT <= 0) {
          game._psT = .07;
          NET.sendEv({ k: 'ps', x: p.x | 0, y: p.y | 0, dx: +p.dirX.toFixed(2), dy: +p.dirY.toFixed(2), hp: Math.ceil(p.hp), mhp: Math.round(p.maxHp), cast: (p.castAnim > 0 || p.atkAnim > 0) ? 1 : 0, dead: p.downed ? 1 : 0, mv: Math.hypot(p.moveX, p.moveY) > .08 ? 1 : 0, rv: +(p.reviveT || 0).toFixed(2), rt: p.reviveTarget || '',
            // ★ 塔防：当前所在传送阵 —— 队友要能看到彼此守在哪条路
            tn: (game.gameMode === 'td' && TDR.node) ? TDR.node.id : '' });
        }
      }
    }
    for (const f of game.spineFx) {
      f.life -= dt;
      if (f.follow) { f.x = f.follow.x; f.y = f.follow.y; }
      if (f.shield === 'ice_barrier' && f.follow === p && (p.barrierHp <= 0 || p.barrierT <= 0)) f.life = 0;
      if (f.key === 'warrior_bladestorm' && f.follow === p) f.size = skillAreaRadius('blade_storm', p) * 2;
      // ★ 低档设备：Spine 骨骼动画降帧（每 2 帧才推进一次）→ 骨骼变换计算量减半。
      //   同屏上限也已降到 14（spawnSpineFx）。低端安卓上这是最有效的两个降载点。
      const lowTier = !!(window.__perfTier && window.__perfTier.isLow());
      const fxDt = (lowTier && (game.frame & 1)) ? 0 : dt;
      SPINE.updateFx(f, f.key, fxDt, { loop: f.loop, timeScale: f.timeScale });
    }
    game.spineFx = game.spineFx.filter(f => f.life > 0);
    SPINE.updateActor(p, p.type, { moving: Math.hypot(p.moveX, p.moveY) > .08, attack: p.atkAnim, cast: p.castAnim, dead: p.downed }, dt);
    if (game.allies) for (const al of game.allies.values()) {
      al.atkAnim = Math.max(0, (al.atkAnim || 0) - dt); al.castAnim = Math.max(0, (al.castAnim || 0) - dt);
      SPINE.updateActor(al, al.hero, { moving: !!al.moving, attack: al.atkAnim, cast: al.castAnim, dead: al.dead }, dt);
    }
    updateHUD();
  }

  // #51 快照序列化（主机 → 客户端）
  const SK_IDX = { gnoll: 0, wolf: 1, murloc: 2, cultist: 3, ooze: 4, troll: 5, golem: 6, boss1: 7, boss2: 8, boss3: 9, spider: 10, felhound: 11, skeleton: 12, wraith: 13, mob_lavaspawn: 14, mob_corehound: 15, mob_flamewarden: 16, mob_sparkswirl: 17 }; // #55 新小怪入快照；熔火之心 4 种小怪入快照
  const SK_REV = ['gnoll', 'wolf', 'murloc', 'cultist', 'ooze', 'troll', 'golem', 'boss1', 'boss2', 'boss3', 'spider', 'felhound', 'skeleton', 'wraith', 'mob_lavaspawn', 'mob_corehound', 'mob_flamewarden', 'mob_sparkswirl'];
  // 熔火之心小怪：快照里的 spriteKey 即 Spine 模型 key（客户端据此还原骨骼模型）
  const MOB_SPINES = { mob_lavaspawn: 'mob_lavaspawn', mob_corehound: 'mob_corehound', mob_flamewarden: 'mob_flamewarden', mob_sparkswirl: 'mob_sparkswirl' };
  function buildSnapshot() {
    const p = game.player;
    const pl = [[NET.myId, p.type, p.x | 0, p.y | 0, +p.dirX.toFixed(2), +p.dirY.toFixed(2), Math.ceil(p.hp), Math.round(p.maxHp), (p.castAnim > 0 || p.atkAnim > 0) ? 1 : 0, p.downed ? 1 : 0, Math.hypot(p.moveX, p.moveY) > .08 ? 1 : 0, +(p.reviveT || 0).toFixed(2), p.reviveTarget || '']];
    for (const al of game.allies.values()) pl.push([al.id, al.hero, al.x | 0, al.y | 0, al.dirX || 1, al.dirY || 0, al.hp | 0, al.maxHp | 0, al.cast || 0, al.dead ? 1 : 0, al.moving ? 1 : 0, +(al.reviveT || 0).toFixed(2), al.reviveTarget || '']);
    const es = [];
    for (const e of game.enemies) {
      if (e.dead) continue;
      const flags = (e.slowT > 0 ? 1 : 0) | (e.burnT > 0 ? 2 : 0) | (e.poisT > 0 ? 4 : 0) | (e.stunT > 0 ? 8 : 0) | (e.boss ? 16 : 0) | (e.elite ? 32 : 0);
      const row = [e.nid, SK_IDX[e.spriteKey] ?? 0, e.x | 0, e.y | 0, Math.ceil(e.hp), Math.round(e.maxHp), Math.round(e.r), flags, e.tint | 0];
      if (e.boss) row.push(e.name, e.variant ?? 0, +(e.atkT || 0).toFixed(2));
      es.push(row);
    }
    const snap = { k: 'snap', t: +game.elapsed.toFixed(2), pl, es, bat: +game.bossAliveT.toFixed(1),
      // 熔火之心：地板预警必须进快照（客户端不跑 Boss AI，否则看不见红区）
      tg: (game.telegraphs || []).map(t => [t.x | 0, t.y | 0, t.r | 0, t.shape, +(t.ang || 0).toFixed(2),
        +(t.half || 0).toFixed(2), +t.life.toFixed(2), t.maxLife, t.dmg | 0, t.color]) };
    // ★ 塔防联机：TD 权威段（波次 / 漏怪 / 激活路 / 敌人路径 / 各玩家阵位 / 守卫）
    if (game.gameMode === 'td') snap.td = buildTdSnapshot();
    return snap;
  }

  /** 塔防联机：主机打包 TD 权威状态（客户端只读，不再自己推进波次） */
  function buildTdSnapshot() {
    // 敌人所在路径 + 路径进度：客户端要靠它做覆盖判定、守卫选敌、自动施法选最靠前的目标
    const tes = [];
    for (const e of game.enemies) {
      if (e.dead || !e.tdLane) continue;
      const li = TD.MAP.lanes.findIndex(l => l.id === e.tdLane);
      if (li < 0) continue;
      tes.push([e.nid, li, +(e.tdT || 0).toFixed(3)]);
    }
    // 各玩家当前阵位（[playerId, nodeId]）
    const nodes = [[NET.myId, TDR.node?.id || '']];
    if (game.allies) for (const al of game.allies.values()) nodes.push([al.id, al.tdNode || '']);
    // 守卫（本人 + 队友）：[ownerId, kind, x, y, range, r]
    const guards = [];
    for (const g of TDR.guards) guards.push([NET.myId, g.kind, g.x | 0, g.y | 0, g.range | 0, g.r | 0]);
    // ★ 主机的本地视图：队友的塔也要画出来。
    //   客户端是从快照的 guards 段派生的，主机这边没有快照回环 → 必须自己维护一份，
    //   否则主机看不到队友的守卫（两端语义要一致：allyGuards = 其他玩家的守卫）。
    const allyGuards = [];
    if (game.allies) for (const al of game.allies.values()) {
      for (const g of (al.tdGuards || [])) {
        guards.push([al.id, g.kind, g.x | 0, g.y | 0, g.range | 0, g.r | 0]);
        allyGuards.push({ owner: al.id, kind: g.kind, x: g.x, y: g.y, range: g.range, r: g.r,
          color: (TD.GUARD_KINDS[g.kind] || {}).color || '#9fd3ff' });
      }
    }
    TDR.allyGuards = allyGuards;
    return {
      w: TDR.wave, wt: +TDR.waveT.toFixed(2),
      lk: TDR.leaks, ll: TDR.leakLimit,
      lanes: TDR.lanes.slice(),
      fb: TDR.finalBossState,      // 尾王状态：none / killed / leaked
      tes, nodes, guards
    };
  }
  // #51 客户端应用快照 / 击杀 / 战利品 / 受击
  function clientOnSnap(d) {
    if (!game || !game.coop || game.coop.host) return;
    const p = game.player;
    // 熔火之心团本：掉落 Roll 结算状态（主机权威下发，客户端只渲染）
    if (d.k === 'raid') { clientOnRaid(d.rl); return; }
    if (d.k === 'snap') {
      game.elapsed = d.t;
      if (!game.enemies.some(e => e.boss && !e.dead)) game.bossAliveT = 0;
      for (const [id, hero, x, y, dx, dy, hp, mhp, cast, dead, moving, rv, rt] of d.pl) {
        if (id === NET.myId) continue;
        let al = game.allies.get(id);
        if (!al) { al = { id, name: '', hero }; game.allies.set(id, al); }
        Object.assign(al, { hero, x, y, dirX: dx, dirY: dy, hp, maxHp: mhp, cast, dead: !!dead, moving: !!moving, reviveT: rv || 0, reviveTarget: rt || '' });
      }
      const seen = new Set();
      for (const row of d.es) {
        const [nid, sk, x, y, hp, mhp, r, flags, tint] = row;
        seen.add(nid);
        let e = game.enemies.find(v => v.nid === nid);
        if (!e) {
          const skey = SK_REV[sk];
          e = { nid, type: skey, spriteKey: skey, name: row[9] || '', x, y, tx: x, ty: y, r, hp, maxHp: mhp,
            phase: rand(0, TAU), spawnT: .3, flash: 0, hitCd: 0, atkT: 0, dead: false, color: '#9aa89c',
            slow: 0, slowT: 0, burnT: 0, poisT: 0, stunT: 0, dotTick: 0, shootCd: 1, specialCd: 3, vulnT: 0,
            spine: MOB_SPINES[skey] || null, variant: 0, kind: null };
          game.enemies.push(e);
        }
        e.tx = x; e.ty = y; e.hp = hp; e.maxHp = mhp; e.r = r;
        e.boss = !!(flags & 16); e.elite = !!(flags & 32);
        e.slowT = (flags & 1) ? Math.max(e.slowT, .3) : 0;
        e.burnT = (flags & 2) ? Math.max(e.burnT, .3) : 0;
        e.poisT = (flags & 4) ? Math.max(e.poisT, .3) : 0;
        e.stunT = (flags & 8) ? Math.max(e.stunT, .3) : 0;
        e.tint = tint || null;
        if (e.boss) {
          if (row[9]) e.name = row[9];
          e.variant = row[10] ?? e.variant ?? 0;
          e.atkT = row[11] || 0;
          // 第 10 项：按名册索引还原首领模型与名称（客户端与主机共用同一名册）
          const bdef = BOSS_ROSTER[e.variant];
          if (bdef) { e.spine = bdef.spine; if (!e.name) e.name = bdef.name; }
        }
        if (mode !== 'playing') { e.x = x; e.y = y; } // 暂停/选卡时直接同步
      }
      game.enemies = game.enemies.filter(e => seen.has(e.nid));
      if (d.es.some(r => r[7] & 16)) game.bossAliveT = d.bat || 0;
      // 熔火之心：地板预警同步（客户端只显示，不做伤害判定——伤害由主机结算后经 hit 下发）
      if (d.tg) {
        const list = [];
        for (const row of d.tg) {
          const [x, y, r, shape, ang, half, life, maxLife, dmg, color] = row;
          list.push({ x, y, r, shape, ang, half, life, maxLife, dmg, color, fx: null, label: '', spin: 0 });
        }
        game.telegraphs = list;
      }
      // ★ 塔防联机：应用主机权威的 TD 状态段
      //   客户端的波次 / 漏怪数 / 激活路 / 敌人路径 全部来自这里 —— 客户端自己不再推进。
      if (d.td) {
        const t = d.td;
        TDR.wave = t.w || 0; TDR.waveT = t.wt || 0;
        TDR.leaks = t.lk || 0; TDR.leakLimit = t.ll || TDR.leakLimit;
        if (t.lanes && t.lanes.length) TDR.lanes = t.lanes.slice();
        TDR.finalBossState = t.fb || 'none';
        // 敌人的路径与进度：覆盖判定 / 守卫选敌 / 自动施法选最靠前的目标都依赖它
        for (const row of (t.tes || [])) {
          const e = game.enemies.find(v => v.nid === row[0]);
          const lane = TD.MAP.lanes[row[1]];
          if (e && lane) { e.tdLane = lane.id; e.tdT = row[2] || 0; }
        }
        // 队友阵位（小地图标记 / 观战跟随）
        if (game.allies) for (const [pid, nodeId] of (t.nodes || [])) {
          if (pid === NET.myId) continue;
          const al = game.allies.get(pid);
          if (al) al.tdNode = nodeId;
        }
        // 队友守卫（只读渲染，不参与本地伤害结算）
        TDR.allyGuards = (t.guards || [])
          .filter(g => g[0] !== NET.myId)
          .map(g => ({ owner: g[0], kind: g[1], x: g[2], y: g[3], range: g[4], r: g[5],
            color: (TD.GUARD_KINDS[g[1]] || {}).color || '#9fd3ff' }));
      }
      return;
    }
    if (d.k === 'kill') {
      gainXp(d.xp); // 协作经验共享
      FX.burst(d.x, d.y, d.color || '#cfe0d8', d.boss ? 24 : 8, { speed: d.boss ? 220 : 140, grav: 180 });
      if (d.boss) {
        game.bossKills = (game.bossKills || 0) + 1;
        // ★ 装备卡掉落**不再**在此无条件计 —— 改用主机下发的权威数量 d.gear，且只归击杀者本人。
        //   （旧逻辑：Boss 掉落加到每个客户端头上 + 客户端自己再随机掷一次点 → 双重掉落、
        //     且队友的掉落会被本机代领，「掉落空池折算 +20 金币」记到别人头上。）
        game.bossAliveT = 0;
      }
      if (d.by === NET.myId) {
        p.kills++;
        // 第 9 项：无尽模式不产金币（副本与塔防产；塔防金币只作局内显示，不入存档）
        if (game.gameMode === 'dungeon' || game.gameMode === 'td') {
          // ★ 主机下发权威金币增量（d.gold）：两端各自随机会让账目对不上，
          //   且归属错位时客户端 p.gold 恒为 0 → 结算金币变 0
          const g = (typeof d.gold === 'number') ? d.gold : (d.boss ? 50 : Math.random() < .25 ? 2 : 1);
          p.gold += g;
          if (p.gearFx.goldFind && Math.random() < p.gearFx.goldFind) p.gold += 1;
          // ★ 装备卡牌掉落：只认主机下发的权威数量（d.gear），不再本地随机掷点
          if (d.gear) game.gearDrops += d.gear;
        }
        // ★ 塔防「局内核心」：只认主机下发的权威数量（d.core）—— 主机不替队友代领
        if (d.core) game.tdCoreDrops += d.core;
      }
      return;
    }
    if (d.k === 'loot') { addLoot(d.id, d.qty, p.x + rand(-40, 40), p.y + rand(-40, 40)); return; }
    if (d.k === 'hit' && d.to === NET.myId) hurtPlayer(d.d, null);
    if (d.k === 'revive') { // 第 11 项：被队友拉起来 / 施救成功确认
      const hp = d.hp || Math.max(1, Math.round(p.maxHp * REVIVE_HP));
      if (d.to === NET.myId) {
        p.downed = false; p.hp = hp; p.invuln = 2; p.reviveT = 0; p.reviveTarget = null;
        game.texts.push({ x: p.x, y: p.y - 34, text: '你被队友救起', color: '#a8f0c4', life: 2.2, size: 15 });
        FX.ring(p.x, p.y, '#a8f0c4', 22, { speed: 200 });
        burst(p.x, p.y, '#a8f0c4', 14);
      } else {
        const al = game.allies.get(d.to);
        if (al) { al.dead = false; al.hp = hp; }
      }
      if (d.by === NET.myId) {
        p.reviveCd = REVIVE_CD; p.revivePending = 0;
        game.texts.push({ x: p.x, y: p.y - 36, text: '战复成功', color: '#a8f0c4', life: 2, size: 14 });
      }
      return;
    }
    if (d.k === 'revive-fail') { // 第 11 项：主机拒绝了这次战复
      if (d.to === NET.myId) { p.revivePending = 0; toast('战复未能完成'); }
      return;
    }
  }
  // #54 队友技能真实同步：释放时广播 {s:技能, x, y, a:角度}，各端本地渲染（伤害仍主机结算）
  const FX_STYLE = {
    whirlwind: { t: 'ring', c: '#f3b47d' }, bloodthirst: { t: 'slash', c: '#e77a63' }, thunderclap: { t: 'ring', c: '#8fd8ef' }, slam: { t: 'slash', c: '#e8c97d' },
    arcane_missiles: { t: 'bolt', c: '#7de7ff', n: 3 }, frostbolt: { t: 'bolt', c: '#9fe4ff' }, fireball: { t: 'bolt', c: '#f28a52' },
    double_shot: { t: 'bolt', c: '#d4e99b', n: 2 }, aimed_shot: { t: 'bolt', c: '#ffd98a' }, serpent_sting: { t: 'bolt', c: '#9fd86a' },
    frost_orb: { t: 'orb', c: '#9fe4ff' }, blizzard: { t: 'zone', c: '#8fd8ef' }, flamestrike: { t: 'zone', c: '#f28a52' },
    arcane_nova: { t: 'ring', c: '#c9a2f5' }, shockwave: { t: 'ring', c: '#e8c97d' }, war_stomp: { t: 'ring', c: '#e8c97d' },
    demoralizing_shout: { t: 'ring', c: '#b8a08a' }, blade_storm: { t: 'ring', c: '#f3b47d' }, mortal_strike: { t: 'slash', c: '#e77a63' },
    multi_shot: { t: 'bolt', c: '#d4e99b', n: 5 }, arcane_blast: { t: 'bolt', c: '#c9a2f5', big: 1 },
    explosive_trap: { t: 'zone', c: '#f28a52' }, freezing_trap: { t: 'zone', c: '#9fe4ff' }, kill_command: { t: 'beam', c: '#d4e99b' },
    charge: { t: 'dash', c: '#e8c97d' },
    shield_wall: { t: 'flash', c: '#cfe8ff' }, ice_barrier: { t: 'flash', c: '#9fe4ff' }, icy_veins: { t: 'flash', c: '#9fe4ff' },
    berserker_rage: { t: 'flash', c: '#e77a63' }, mirror_image: { t: 'flash', c: '#c9a2f5' }, rapid_fire: { t: 'flash', c: '#ffe9a8' },
    aspect_wild: { t: 'flash', c: '#9bd37e' }, call_pet: { t: 'flash', c: '#d4e99b' } };
  function castFxNet(d) { // 自己释放 → 广播（主机直发 / 客户端经主机转发）
    if (!game?.coop || typeof NET === 'undefined' || !NET.connected) return;
    if (game.coop.host) NET.sendFx(d); else NET.sendEv({ k: 'fx', ...d });
  }
  function renderAllySkillFx(pid, d) { // 收到队友释放 → 本地渲染真实弹道（55% 淡化）
    if (!game?.coop || pid === NET.myId) return;
    const al = game.allies.get(pid);
    if (al) {
      const kind = skillDef(al.hero, d.s)?.kind;
      if (kind === 'active') al.castAnim = .25; else al.atkAnim = .14;
    }
    const st = FX_STYLE[d.s] || { t: 'flash', c: heroes[al?.hero]?.color || '#cfe0d8' };
    const x = d.x, y = d.y, a = d.a || 0, c = st.c;
    const remoteKind = al?.hero && SKILLS[al.hero] ? skillDef(al.hero, d.s)?.kind : null;
    const remoteP = { x, y, range: heroes[al?.hero]?.range || 120, fxFollow: al || null };
    if (remoteKind === 'active') spawnActiveSpine(d.s, remoteP, a, .5);
    else spawnBasicSpine(d.s, remoteP, null, a, .5);
    if (st.t === 'bolt') {
      const n = st.n || 1;
      for (let i = 0; i < n; i++) {
        const aa = a + (i - (n - 1) / 2) * .13;
        game.allyFx.push({ type: 'bolt', x: x + Math.cos(aa) * 22, y: y + Math.sin(aa) * 22, vx: Math.cos(aa) * 560, vy: Math.sin(aa) * 560,
          life: .9, maxLife: .9, color: c, size: st.big ? 4.5 : 2.5 });
      }
    } else if (st.t === 'slash') {
      game.allyFx.push({ type: 'slash', x, y, a, life: .22, maxLife: .22, color: c });
    } else if (st.t === 'ring') {
      game.allyFx.push({ type: 'ring', x, y, r: 12, maxR: 130, life: .32, maxLife: .32, color: c });
    } else if (st.t === 'zone') {
      game.allyFx.push({ type: 'zone', x: x + Math.cos(a) * 280, y: y + Math.sin(a) * 280, r: 120, life: .6, maxLife: .6, color: c });
    } else if (st.t === 'orb') {
      game.allyFx.push({ type: 'orbfx', x, y, vx: Math.cos(a) * 140, vy: Math.sin(a) * 140, life: 2.2, maxLife: 2.2, color: c });
    } else if (st.t === 'dash') {
      game.allyFx.push({ type: 'dashfx', x, y, x2: x + Math.cos(a) * 240, y2: y + Math.sin(a) * 240, life: .3, maxLife: .3, color: c });
    } else if (st.t === 'beam') {
      let best = null, bd = 1e9;
      for (const e of game.enemies) { if (e.dead) continue; const dd = Math.hypot(e.x - x, e.y - y); if (dd < bd) { bd = dd; best = e; } }
      if (best) game.allyFx.push({ type: 'dashfx', x, y, x2: best.x, y2: best.y, life: .18, maxLife: .18, color: c });
    } else { // flash 增益/召唤类
      game.allyFx.push({ type: 'ring', x, y, r: 8, maxR: 60, life: .35, maxLife: .35, color: c });
    }
  }
  // #51 主机处理客户端事件
  let curAttacker = null;
  function hostOnEvent(from, d) {
    if (!game || !game.coop?.host) return;
    if (d.k === 'ps') {
      const al = game.allies.get(from);
      if (al) {
        Object.assign(al, { x: d.x, y: d.y, dirX: d.dx, dirY: d.dy, hp: d.hp, maxHp: d.mhp, cast: d.cast, moving: !!d.mv, reviveT: d.rv || 0, reviveTarget: d.rt || '' });
        // ★ 塔防：记录队友当前所在传送阵（快照会下发给全员，用于小地图 / 观战跟随）
        if (d.tn) al.tdNode = d.tn;
        // 倒地状态只用于「置真」；复活后 2 秒内忽略客户端残留的 dead=1 旧包，避免把已救回的队友重新标死
        if (d.dead && game.elapsed - (al.revivedAt ?? -999) > 2) al.dead = true;
      }
    } else if (d.k === 'dmg') {
      // ★ 已倒地（观战）的玩家不得继续造成伤害 —— 主机权威二次校验，不信任客户端
      const src = game.allies.get(from);
      if (src && src.dead) return;
      const e = game.enemies.find(x => x.nid === d.id && !x.dead);
      if (e) {
        curAttacker = from;
        e.killedByPlayer = from; // ★ 记录击杀归属：否则结算时 by 回退成主机 id，队友金币恒为 0
        e.hp -= d.d; e.flash = .1; if (d.s !== 'dot') e.killedBy = d.s || 'ally';
        if (e.hp <= 0) killEnemy(e);
        curAttacker = null;
      }
    } else if (d.k === 'died') {
      const al = game.allies.get(from);
      if (al) { al.dead = true; announce(`${al.name} 倒下了`, '#e96e60', 2.5); }
      checkAllDead();
    } else if (d.k === 'revive-done') { // 第 11 项：客户端读条完成 → 主机权威判定
      const al = game.allies.get(from);
      const t = d.to === NET.myId ? game.player : game.allies?.get(d.to);
      if (!al || al.dead || !t) { NET.sendSnap({ k: 'revive-fail', to: from }); return; }   // 施救者自己已倒下 / 目标不存在
      const down = t === game.player ? !!t.downed : !!t.dead;
      if (!down) { NET.sendSnap({ k: 'revive-fail', to: from }); return; }                // 目标已不倒地
      if (Math.hypot(al.x - t.x, al.y - t.y) > REVIVE_OVERLAP * 2.5) { NET.sendSnap({ k: 'revive-fail', to: from }); return; } // 位置校验（网络容差）
      if (al.lastRevive != null && game.elapsed - al.lastRevive < REVIVE_CD) { NET.sendSnap({ k: 'revive-fail', to: from }); return; } // 冷却校验
      if (!hostApplyRevive(d.to, from)) { NET.sendSnap({ k: 'revive-fail', to: from }); return; }
      al.lastRevive = game.elapsed;
    } else if (d.k === 'fx') { // #54 客户端技能视觉：主机本地渲染并转发给其他客户端
      const src = game.allies.get(from);
      if (src && src.dead) return; // ★ 已倒地的玩家不再广播技能特效
      renderAllySkillFx(from, d);
      NET.sendFx(d, from);
    } else if (d.k === 'raidRoll') { // 熔火之心团本：客户端上报 roll 点
      raidHostRoll(from, d.idx, d.val);
    } else if (d.k === 'raidPass') { // 熔火之心团本：客户端放弃某件
      raidHostPass(from, d.idx);
    } else if (d.k === 'raidChat') { // 熔火之心团本：聊天
      raidHostChat(from, d.text);
    } else if (d.k === 'tdGuard') { // ★ 塔防：客户端落守卫 → 主机登记（队友要看得见这座塔）
      const al = game.allies.get(from);
      if (!al) return;
      const def = TD.GUARD_KINDS[d.kind];
      if (!def) return;
      al.tdGuards = al.tdGuards || [];
      if (al.tdGuards.length >= 6) return;   // 守卫数量上限与本地一致
      al.tdGuards.push({ kind: d.kind, x: d.x, y: d.y, range: d.range, r: d.r, padId: d.padId || '' });
    }
  }
  function checkAllDead() {
    if (!game?.coop?.host) return;
    const p = game.player;
    if (p.downed && [...game.allies.values()].every(a => a.dead)) endGame(false, '全队覆灭，荒野将你们吞没。');
  }

  function shootEnemy(e, a, speed, damage) { game.enemyShots.push({ x: e.x, y: e.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, r: 6, damage: e.damage * .75 || damage, life: 4, color: e.boss ? '#f0845d' : '#c283d3' }); }

  // 锯齿闪电路径生成
  function boltPoints(x1, y1, x2, y2, segs = 6) {
    const pts = [[x1, y1]];
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    for (let i = 1; i < segs; i++) {
      const t = i / segs, off = rand(-1, 1) * len * .09;
      pts.push([x1 + dx * t + nx * off, y1 + dy * t + ny * off]);
    }
    pts.push([x2, y2]);
    return pts;
  }

  function updateHUD() {
    if (!game) return;
    const p = game.player;
    if (game.gameMode === 'td') tdUpdateHud();   // ★ 塔防专属 HUD
    ui.level.textContent = `Lv.${p.level}`;
    ui['hp-bar'].style.width = `${100 * p.hp / p.maxHp}%`; ui['hp-text'].textContent = `${Math.ceil(p.hp)} / ${Math.round(p.maxHp)}`;
    ui['xp-bar'].style.width = `${100 * p.xp / p.nextXp}%`;
    ui.time.textContent = formatTime(game.elapsed); ui.kills.textContent = p.kills; ui.gold.textContent = p.gold;
    // ★ 塔防模式：空格位改显示「传送冷却」（英雄不能自由移动，闪现无意义）
    if (game.gameMode === 'td') {
      ui['dash-text'].textContent = TDR.tpCd > 0 ? `传送 · ${TDR.tpCd.toFixed(1)}s` : '方向键 · 传送就绪';
      ui['dash-cooldown'].style.transform = `scaleY(${TDR.tpCd / Math.max(.1, TDR.tpCdMax)})`;
    } else {
      ui['dash-text'].textContent = p.dashCd > 0 ? `空格 · ${p.dashCd.toFixed(1)}s` : '空格 · 就绪';
      ui['dash-cooldown'].style.transform = `scaleY(${p.dashCd / p.dashMax})`;
    }
    // 第 20 项：4 个主动技能槽位统一渲染（Q / R / C / V）
    for (const slot of ACTIVE_SLOTS) {
      const suffix = slot.n === 1 ? '' : String(slot.n);
      const sid = p[slot.skill];
      const cdVal = p[slot.cd] || 0;
      const def = sid ? skillDef(p.type, sid) : null;
      // 移动端同名按钮：按需显隐（该槽位没装备技能就不占位）+ 冷却秒数
      const mb = ui['mobile-active' + suffix];
      if (mb) {
        if (!sid) { mb.classList.add('hidden'); mb.dataset.cd = ''; }
        else {
          mb.classList.remove('hidden');
          mb.textContent = slot.hotkey;
          mb.title = def ? def.name : slot.label;
          mb.dataset.cd = cdVal > 0 ? cdVal.toFixed(1) : '';
          // ★ 冷却弧比例（--cdp）：剩余冷却 / 总冷却（0=就绪，1=满冷却）
          //   CSS 里用 conic-gradient 把这个比例画成按钮上扫过的扇形。
          //   cdMax 取 p[slot.max] —— 施放瞬间写入的那次总冷却，可能被「娴熟」等卡压短，
          //   所以用实际记录值而不是卡面理论值。
          const cdMax = p[slot.max] || 0;
          mb.style.setProperty('--cdp', cdMax > 0 ? Math.max(0, Math.min(1, cdVal / cdMax)).toFixed(3) : '0');
        }
      }
      const ab = ui['active-ability' + suffix];
      const ico = ui['active-icon' + suffix];
      const nm = ui['active-name' + suffix];
      const tx = ui['active-text' + suffix];
      const cdo = ui['active-cooldown' + suffix];
      if (!ab || !ico || !nm || !tx || !cdo) continue;
      if (!sid) { ab.classList.add('hidden'); continue; }
      ab.classList.remove('hidden');
      if (ico.dataset.skill !== sid) {
        ico.dataset.skill = sid;
        ico.innerHTML = skillIconHtml(sid, heroes[p.type].color, 30);
      }
      nm.textContent = def ? def.name : '—';
      tx.textContent = cdVal > 0 ? `${slot.hotkey} · ${cdVal.toFixed(1)}s` : `${slot.hotkey} · 就绪`;
      cdo.style.transform = `scaleY(${p[slot.max] ? cdVal / p[slot.max] : 0})`;
    }
    const pb = ui['pot-ability'];
    if (!save.potion) pb.classList.add('hidden');
    else {
      pb.classList.remove('hidden');
      const pot = ITEMS[save.potion];
      if (ui['pot-icon'].dataset.item !== save.potion) {
        ui['pot-icon'].dataset.item = save.potion;
        ui['pot-icon'].innerHTML = itemIconHtml(save.potion, 30);
      }
      ui['pot-icon'].style.color = pot.color;
      ui['pot-name'].textContent = pot.name.replace('无尽', '');
      ui['pot-text'].textContent = p.potCd > 0 ? `E · ${p.potCd.toFixed(0)}s` : 'E · 就绪';
      ui['pot-cooldown'].style.transform = `scaleY(${p.potCd / 30})`;
    }
    // 第 11 项：战复技能槽位（联机专属）
    const rb = ui['revive-ability'];
    if (!game.coop) { rb.classList.add('hidden'); rb.classList.remove('reading'); rb.classList.remove('ready'); }
    else {
      rb.classList.remove('hidden');
      if (ui['revive-icon'].dataset.skill !== 'revive') {
        ui['revive-icon'].dataset.skill = 'revive';
        ui['revive-icon'].innerHTML = pngIconHtml('sk_revive', 30, textIcon('✚', '#a8f0c4', 30));
      }
      ui['revive-name'].textContent = '战复';
      const near = reviveTargetFor(p);
      rb.classList.toggle('ready', !!near && p.reviveCd <= 0 && p.reviveT <= 0);
      if (p.reviveT > 0) {
        rb.classList.add('reading');
        ui['revive-text'].textContent = `F · 读条 ${p.reviveT.toFixed(1)}s`;
        ui['revive-cooldown'].style.transform = 'scaleY(0)';
        ui['revive-progress'].style.width = `${(1 - p.reviveT / REVIVE_CHANNEL) * 100}%`;
      } else {
        rb.classList.remove('reading');
        ui['revive-progress'].style.width = '0%';
        ui['revive-text'].textContent = p.reviveCd > 0 ? `F · 冷却 ${Math.ceil(p.reviveCd)}s`
          : near ? 'F · 可战复队友' : 'F · 就绪';
        ui['revive-cooldown'].style.transform = `scaleY(${p.reviveCd / REVIVE_CD})`;
      }
    }
    // #60 移动端触屏按钮：药水 / 战复 / 闪现的显隐与冷却（与桌面端能力条保持一致）
    const mPot = ui['mobile-pot'];
    if (mPot) {
      mPot.classList.toggle('hidden', !save.potion);
      mPot.dataset.cd = save.potion && p.potCd > 0 ? p.potCd.toFixed(0) : '';
      // ★ 冷却弧（药水总冷却 30s，硬编码于 usePotion）
      mPot.style.setProperty('--cdp', save.potion && p.potCd > 0 ? Math.max(0, Math.min(1, p.potCd / 30)).toFixed(3) : '0');
    }
    const mRev = ui['mobile-revive'];
    if (mRev) {
      mRev.classList.toggle('hidden', !game.coop);
      mRev.dataset.cd = game.coop ? (p.reviveT > 0 ? p.reviveT.toFixed(0) : (p.reviveCd > 0 ? Math.ceil(p.reviveCd) + '' : '')) : '';
      mRev.style.setProperty('--cdp', game.coop && p.reviveCd > 0 ? Math.max(0, Math.min(1, p.reviveCd / REVIVE_CD)).toFixed(3) : '0');
    }
    const mDash = ui['mobile-dash'];
    if (mDash) {
      mDash.dataset.cd = p.dashCd > 0 ? p.dashCd.toFixed(1) : '';
      // ★ 冷却弧（闪现总冷却 = p.dashMax，会被「时空漫步」等卡压缩 → 必须读实际值）
      mDash.style.setProperty('--cdp', p.dashMax > 0 ? Math.max(0, Math.min(1, p.dashCd / p.dashMax)).toFixed(3) : '0');
    }
    const boss = game.enemies.find(e => e.boss && !e.dead);
    if (boss) {
      ui['boss-wrap'].classList.remove('hidden');
      ui['boss-name'].textContent = game.gameMode === 'adventure'
        ? `${boss.name} · 狂暴 ${Math.max(0, Math.ceil(45 - game.bossAliveT))}s`
        : boss.name;
      ui['boss-bar'].style.width = `${Math.max(0, 100 * boss.hp / boss.maxHp)}%`;
    }
    else ui['boss-wrap'].classList.add('hidden');
    // #48 装备栏（变化时才重建 DOM）
    const gearSig = game.gear.map(c => c.id + ':' + c.lvl).join(',');
    if (gearSig !== game._gearSig) {
      game._gearSig = gearSig;
      ui['gear-bar'].innerHTML = game.gear.length
        ? game.gear.map(c => { const g = GEAR[c.id]; return `<span class="gb-slot rar-b-${g.rarity}" title="${g.name} Lv.${c.lvl}">${gearIconHtml(c.id, 28)}</span>`; }).join('')
        : '<span class="gb-empty">装备 0/5</span>';
    }
    // #48 左下角基础数值状态（白色文字，节流刷新）
    const now = performance.now();
    if (!game._statsAt || now - game._statsAt > 400) {
      game._statsAt = now;
      ui['stats-hud'].textContent = `伤害 ${Math.round(p.damage)} · 攻速 ${(1 / attackRate(p)).toFixed(1)}/秒 · 暴击 ${Math.round(p.crit * 100)}% · 护甲 ${p.armor} · 移速 ${Math.round(p.speed)} · 拾取 ${Math.round(p.magnet)} · 装备 ${game.gear.length}/5`;
    }
    // #52 联机队伍面板（魔兽小队风格，左侧竖排）
    const pp = ui['party-panel'];
    if (!game.coop) { pp.classList.add('hidden'); game._partySig = null; }
    else {
      pp.classList.remove('hidden');
      const mePl = NET.room?.players.find(pl => pl.id === NET.myId);
      const members = [{ key: 'self', name: mePl?.name || heroes[p.type].name, hero: p.type, hp: p.hp, maxHp: p.maxHp, dead: !!p.downed, self: true },
        ...[...game.allies.values()].map(a => ({ key: a.id, name: a.name, hero: a.hero, hp: a.hp, maxHp: a.maxHp, dead: a.dead }))];
      const sig = members.map(m => `${m.key}:${m.hero}:${m.dead ? 1 : 0}`).join('|');
      if (sig !== game._partySig) { // 成员/职业/倒下状态变化才重建 DOM
        game._partySig = sig;
        pp.innerHTML = members.map(m => {
          const h = heroes[m.hero] || heroes.mage;
          return `<div class="party-frame${m.dead ? ' pf-dead' : ''}${m.self ? ' pf-self' : ''}" data-pf="${m.key}">
            <span class="pf-portrait" style="color:${h.color}">${heroIconHtml(m.hero, 26)}</span>
            <div class="pf-body"><span class="pf-name" style="color:${h.color}">${m.name}</span>
            <div class="pf-hp"><i class="pf-hp-bar"></i></div><span class="pf-hp-text"></span></div></div>`;
        }).join('');
      }
      if (!game._partyAt || now - game._partyAt > 300) { // 血条节流刷新
        game._partyAt = now;
        for (const m of members) {
          const fr = pp.querySelector(`[data-pf="${m.key}"]`); if (!fr) continue;
          fr.querySelector('.pf-hp-bar').style.width = `${Math.max(0, 100 * m.hp / (m.maxHp || 1))}%`;
          fr.querySelector('.pf-hp-text').textContent = m.dead ? '倒下' : `${Math.ceil(m.hp)}`;
        }
      }
      // ★ 塔防模式：点击左侧玩家列表 → 切换到该队友的视角；点自己 → 回到自己视角。
      //   （需求：点击左侧玩家有效查看其他玩家角色视角，按空格或方向键回到自己视角）
      const sig2 = members.map(m => m.key).join('|');
      if (sig2 !== game._partyViewSig) {
        game._partyViewSig = sig2;
        pp.querySelectorAll('[data-pf]').forEach(fr => {
          fr.classList.toggle('pf-viewing', game.gameMode === 'td' && fr.dataset.pf === (TDR.viewPad || 'self'));
          fr.classList.toggle('pf-clickable', game.gameMode === 'td');
          fr.onclick = () => {
            if (game.gameMode !== 'td') return;
            const key = fr.dataset.pf;
            tdSetView(key === 'self' ? null : key);
            // 高亮当前观看的对象
            pp.querySelectorAll('[data-pf]').forEach(x => x.classList.toggle('pf-viewing', x === fr));
          };
        });
      }
    }
  }

  function togglePause() {
    if (game?.coop) { // #52 联机不暂停世界（主机暂停会冻结全队），仅开/关菜单浮层，保留退出入口
      const willOpen = !ui['pause-screen'].classList.contains('active');
      ui['pause-screen'].classList.toggle('hidden', !willOpen);
      ui['pause-screen'].classList.toggle('active', willOpen);
      return;
    }
    if (mode === 'playing') { mode = 'paused'; ui['pause-screen'].classList.remove('hidden'); ui['pause-screen'].classList.add('active'); }
    else if (mode === 'paused') { mode = 'playing'; ui['pause-screen'].classList.add('hidden'); ui['pause-screen'].classList.remove('active'); }
  }

  // #44 获得药水：未拥有→解锁；已拥有→转化为强化进度（Lv.n → Lv.n+1 需 n 瓶，上限 Lv.5）
  function grantPotion(id) {
    const it = ITEMS[id];
    if (!save.potions.includes(id)) { save.potions.push(id); save.potionLvl[id] = 1; return `解锁药水「${it.name}」`; }
    const lvl = save.potionLvl[id] || 1;
    if (lvl >= 5) { save.gold += 30; return `${it.name}（已满级，折算 30 金币）`; }
    save.potionXp[id] = (save.potionXp[id] || 0) + 1;
    if (save.potionXp[id] >= lvl) { save.potionXp[id] -= lvl; save.potionLvl[id] = lvl + 1; return `${it.name} 强化至 Lv.${lvl + 1}！`; }
    return `${it.name}（重复 · 强化进度 ${save.potionXp[id]}/${lvl}）`;
  }

  // #65 结算收益归属说明：联机局存进「昵称 + 存档码」的专属档，单机局存进本机默认档
  function renderResultScreen(victory, reason, lootLines) {
    const p = game.player;
    const isDungeon = game.gameMode === 'dungeon';
    ui.result.classList.remove('hidden'); ui.result.classList.add('active');
    ui['result-icon'].innerHTML = pngIconHtml(victory ? 'result_victory' : 'result_defeat', 52, textIcon(victory ? '♛' : '☠', '#e9bd67', 52));
    ui['result-label'].textContent = isDungeon ? (victory ? '副本通关' : '副本失败') : '远征结束';
    // #65 无尽模式 game.dungeon 为 null，胜利结算时不可直接取 .name
    ui['result-title'].textContent = victory ? (isDungeon && game.dungeon ? `${game.dungeon.name} 已通关` : '远征胜利') : (reason ? '围攻失败' : '英雄倒下了');
    ui['result-subtitle'].textContent = victory
      ? (isDungeon ? '尾王已被击败，副本的宝藏属于你。' : '你击退了荒野的围攻，战利品已收入囊中。')
      : (reason || '每一次失败，都是下一场胜利的序章。');
    ui['result-time'].textContent = formatTime(game.elapsed); ui['result-kills'].textContent = p.kills;
    ui['result-level'].textContent = p.level; ui['result-gold'].textContent = p.gold;
    ui.retry.textContent = isDungeon ? '再次挑战' : '再次远征';
    ui['result-loot'].textContent = lootLines.length ? `获得战利品 · ${lootLines.join('　')}` : '';
    if (ui['result-subtitle'] && saveNamespace) {
      ui['result-subtitle'].textContent += `　（收益已存入你的存档：${saveNamespace} · ${saveCode}）`;
    }
  }

  // 第 16 项补充说明：图纸三选一是独立于结算页的设计 —— 弹出时先收起结算页，
  //   选完图纸后再把结算页放回来（否则两个 .screen 同为 z-index:20 会互相遮挡）。
  function showResultAgain() {
    if (!game) return;
    ui.result.classList.remove('hidden'); ui.result.classList.add('active');
  }

  function endGame(victory, reason, raidSeed) {
    if (!game || mode === 'result') return;
    mode = 'result'; const p = game.player;
    // #52 联机选卡浮层在结算时强制关闭
    game.levelupOpen = game.gearPickOpen = false;
    game.gearPending = null;
    for (const id of ['levelup', 'gearpick', 'pause-screen']) { ui[id].classList.add('hidden'); ui[id].classList.remove('active'); }
    const isDungeon = game.gameMode === 'dungeon';
    const isTd = game.gameMode === 'td';
    // ===== 熔火之心团本：胜利后进入掉落 Roll 结算页（而非普通副本三选一）=====
    const isRaid = isDungeon && game.dungeon?.type === 'raid';
    // 主机生成掉落池并随 end 消息下发给全体客户端（各端使用同一批掉落，避免各算各的）
    const raidItems = (isRaid && victory) ? (raidSeed?.items || raidLootPool()) : null;
    if (game.coop?.host) NET.sendEnd({ victory, reason: reason || null, raid: raidItems ? { items: raidItems } : null }); // #51 主机宣告结算
    // 战利品入包并展示
    const lootLines = [];
    for (const [id, q] of Object.entries(game.loot)) {
      const it = itemInfo(id);
      if (it.kind === 'potion') {
        lootLines.push(grantPotion(id));
      } else {
        addToBag(id, q);
        lootLines.push(`${it.name} ×${q}`);
      }
    }
    save.gold += isDungeon ? p.gold : 0; // 第 9 项：无尽模式不产出金币；塔防局金币走成就发放
    save.stats.runs++; save.stats.totalKills += p.kills; save.stats.totalGold += isDungeon ? p.gold : 0;
    // ===== 第 9 项：无尽模式统计（用于无尽专属成就）=====
    // ★ 塔防局必须排除：TD 的 gameMode 是 'td'（不是 'dungeon'），
    //   若不排除，塔防局会同时被记进「无尽局数 / 无尽首领击杀 / 无尽时长」→
    //   无尽专属成就（无尽首领图鉴等）会被塔防的首领白嫖解锁。
    const st = save.stats;
    const isEndless = !isDungeon && !isTd;
    st.endlessRuns = (st.endlessRuns || 0) + (isEndless ? 1 : 0);
    if (isEndless) {
      st.endlessMaxTime = Math.max(st.endlessMaxTime || 0, game.elapsed);
      st.endlessMaxKills = Math.max(st.endlessMaxKills || 0, p.kills);
      st.endlessBossKills = (st.endlessBossKills || 0) + (game.bossKills || 0);
      st.endlessKills = (st.endlessKills || 0) + p.kills;
      st.endlessTotalTime = (st.endlessTotalTime || 0) + game.elapsed;
      // 已遭遇的无尽 Boss 名单（成就：无尽首领图鉴）
      for (const b of game.endlessBossSeen || []) st.endlessBossSeen = [...new Set([...(st.endlessBossSeen || []), b])];
      // 无尽模式收集的药水数量
      const potCount = Object.entries(game.loot).filter(([id]) => itemInfo(id).kind === 'potion').reduce((n, [, q]) => n + q, 0);
      st.endlessPotions = (st.endlessPotions || 0) + potCount;
    }
    save.stats.maxTime = Math.max(save.stats.maxTime, game.elapsed);
    save.stats.maxKills = Math.max(save.stats.maxKills, p.kills);
    save.stats.bosses += game.bossKills || 0;
    if (isDungeon && victory) {
      const did = pendingDungeon;
      save.stats.dungeonClears[did] = (save.stats.dungeonClears[did] || 0) + 1;
      // 熔火之心：普通副本仍是三选一奖励；团本走掉落 Roll 结算页
      if (!isRaid) setTimeout(openDungeonReward, 900);
    }
    // 熔火之心：累计击败敌人数（成就用，失败也计入）
    if (isRaid) save.stats.raidKills = (save.stats.raidKills || 0) + p.kills;
    // ===== 塔防模式统计（用于 cat:'td' 成就组）=====
    if (isTd) {
      const st = save.stats;
      st.tdRuns = (st.tdRuns || 0) + 1;
      st.tdBestWave = Math.max(st.tdBestWave || 0, Math.min(TDR.wave, TD.WAVES.total));
      st.tdWavesCleared = (st.tdWavesCleared || 0) + (victory ? TD.WAVES.total : Math.max(0, TDR.wave - 1));
      st.tdLeakBest = Math.min(st.tdLeakBest == null ? 999 : st.tdLeakBest, TDR.leaks);
      st.tdKills = (st.tdKills || 0) + p.kills;
      st.tdMaxKills = Math.max(st.tdMaxKills || 0, p.kills);
      // 局内核心数量（累计等级）
      const coreN = (game.tdCores || []).reduce((n, c) => n + c.lvl, 0);
      st.tdMaxCores = Math.max(st.tdMaxCores || 0, coreN);
      // 四人联机通关
      if (victory && (game.playerCount || 1) >= 4) st.tdCoopClears = (st.tdCoopClears || 0) + 1;
      tdTeardown();
    }
    const hb = save.stats.best[p.type];
    if (!hb || game.elapsed > hb.time || (game.elapsed === hb.time && p.kills > hb.kills)) save.stats.best[p.type] = { time: game.elapsed, kills: p.kills };
    persist(); checkAchievements();
    // #65 结算收益立刻回存：本地 localStorage（权威档）+ 主机存档中心镜像
    pushCenterNow();
    try {
      const old = JSON.parse(localStorage.getItem('azs-clean-best') || 'null');
      if (!old || game.elapsed > old.time || (game.elapsed === old.time && p.kills > old.kills)) localStorage.setItem('azs-clean-best', JSON.stringify({ time: game.elapsed, kills: p.kills, hero: p.type }));
    } catch { }
    // ===== 结算页分流 =====
    if (raidItems) {
      // 熔火之心团本：进入掉落 Roll 结算页（主机与客户端共用同一批掉落）
      openRaidLoot(raidItems);
    } else {
      renderResultScreen(victory, reason, lootLines);
    }
  }

  // ===== 副本选择与通关奖励 =====
  function openDungeons() { hideAll(); showScreen('dungeons'); renderDungeons(); }
  function renderDungeons() {
    const list = ui['dungeon-list']; list.innerHTML = '';
    // 双 Tab：地下城副本 / 团队副本（熔火之心）
    document.querySelectorAll('#dg-tabs .dg-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === dungeonTab));
    const entries = Object.entries(DUNGEONS).filter(([, d]) => (d.type || 'dungeon') === dungeonTab);
    for (const [did, d] of entries) {
      const clears = save.stats.dungeonClears[did] || 0;
      const learnedCount = Object.values(GEAR).filter(g => g.dungeon === did && save.gearLearned.includes(Object.keys(GEAR).find(k => GEAR[k] === g))).length;
      const isRaid = d.type === 'raid';
      const card = document.createElement('button');
      card.className = 'dungeon-card' + (isRaid ? ' raid-card' : '');
      const extra = isRaid
        ? `<small>团队副本 · 需 ${d.minPlayers} 名玩家 · 固定掉落 4 件熔火 T1 套装部件</small>`
        : `<small>套装 · ${d.setName}（已研习 ${learnedCount}/15） · 通关 ${clears} 次</small>`;
      // 第 17 项：副本缩略图不再用 loading="lazy"。
      // 背景：其他玩家从主机地址（局域网 IP / natapp 隧道）访问时，浏览器对 200+ 启动素材
      //       只能并发 2~4 条连接，lazy 图片的请求会被推迟到「滚动进视口」才发出，
      //       玩家看到的就是空白框（素材并未缺失，实测直连 LAN IP 返回 200 / naturalWidth=768）。
      // 现在：副本图已在启动阶段由 ASSETS.preloadImages 预热进浏览器缓存，
      //       <img> 直接走缓存同步命中，无需再走懒加载调度。
      const imgSrc = d.img || '';
      card.innerHTML = `<span class="dg-img" style="--dg-accent:${d.accent || '#e0784a'};--dg-ground:${(d.ground && d.ground[0]) || '#241312'}"><img src="${imgSrc}" alt="" decoding="async"></span><span class="dg-body"><strong>${dungeonIconHtml(did, 26)} ${d.name}${isRaid ? ' <em class="dg-badge">4 人</em>' : ''}</strong><em>${d.tag}</em><p>${d.desc}</p>${extra}</span>`;
      // 加载失败降级：任何网络异常都不会再出现空白框，改为显示副本配色的占位纹理 + 名称
      const im = card.querySelector('.dg-img img');
      if (im) im.addEventListener('error', () => {
        const box = card.querySelector('.dg-img');
        if (box) box.classList.add('img-fallback');
      });
      // ★ 副本入口：必须同时清掉 pendingMode —— 否则玩家先进过塔防、再点副本卡片时
      //   pendingMode 仍是 'td'，gameMode 会被判成 'td'、模式页标题也会显示「塔防模式」。
      card.addEventListener('click', () => { pendingDungeon = did; pendingMode = null; showModeChoice('dungeons'); }); // #51 副本也先选单人/组队
      list.appendChild(card);
    }
  }
  function openDungeonReward() {
    const d = game.dungeon;
    const pool = Object.keys(GEAR).filter(gid => GEAR[gid].dungeon && GEAR[gid].dungeon === Object.keys(DUNGEONS).find(k => DUNGEONS[k] === d));
    // 第 16 项补充说明：奖池 = 该副本套装图纸，不区分当前职业，完全随机三选一。
    //   （此处保持「全部候选等概率随机」，不按职业排序，避免产生职业偏向。）
    const cands = pool.filter(gid => !save.gearLearned.includes(gid));
    const picks = [];
    while (picks.length < 3 && cands.length) picks.push(cands.splice(Math.floor(Math.random() * cands.length), 1)[0]);
    // 第 16 项补充说明：这是与「战斗中装备三选一」相互独立的设计，必须在结算页之上弹出，
    //   否则两个 .screen 同为 z-index:20、结算页在 DOM 中更靠后 → 奖励框被完全遮住，玩家看不到也点不到。
    ui.result.classList.add('hidden'); ui.result.classList.remove('active');
    ui['dungeon-reward'].classList.remove('hidden'); ui['dungeon-reward'].classList.add('active');
    ui['reward-cards'].innerHTML = '';
    if (!picks.length) {
      save.gold += 200; persist();
      ui['reward-cards'].innerHTML = '<p class="craft-empty">该副本套装已全部研习 · 折算 200 金币</p>';
      // 该副本图纸已全部研习 → 无需三选一，直接回到结算页
      setTimeout(() => { ui['dungeon-reward'].classList.add('hidden'); ui['dungeon-reward'].classList.remove('active'); showResultAgain(); }, 1200);
      return;
    }
    picks.forEach((gid, i) => {
      const g = GEAR[gid];
      const rc = RARITY[g.rarity];
      const b = document.createElement('button');
      b.className = 'upgrade rar-3';
      b.innerHTML = `<span class="up-icon">${gearIconHtml(gid)}</span><strong>${g.name}</strong><span class="up-type" style="color:${rc.color}">${rc.name} · ${d.setName}套装图纸 · ${heroes[g.cls].name}</span><p>${g.desc}<br>套装：${Object.entries(d.setBonuses).map(([n, t]) => `${n} 件·${t}`).join('；')}</p><small>按 ${i + 1} 快速选择</small>`;
      b.addEventListener('click', () => {
        save.gearLearned.push(gid); persist();
        toast(`研习了套装图纸 · ${g.name}`);
        checkAchievements();
        ui['dungeon-reward'].classList.add('hidden'); ui['dungeon-reward'].classList.remove('active');
        showResultAgain(); // 选完图纸后回到结算页（再次挑战 / 更换英雄）
      });
      ui['reward-cards'].appendChild(b);
    });
  }

  // ===== 熔火之心团队副本：掉落 Roll 结算页 =====
  // 主机权威：主机维护 game.raidLoot（掉落池 / 每人每件的选择与 roll 点 / 剩余秒数 / 聊天），
  // 通过 NET.sendSnap({k:'raid'}) 下发；客户端只渲染 + 上报点击，绝不本地判定归属。
  const RAID_ROLL_SECONDS = 60;      // 每件物品的需求窗口
  const RAID_ITEM_GOLD = 120;         // 已获得过的套装部件 → 折算金币
  const RAID_PLAN_GOLD = 300;         // 已学会的橙装图纸 / 背包已满 → 折算金币
  const RAID_ROSTER = ['mage', 'warrior', 'hunter'];
  const RAID_SLOTS = ['w', 'a', 't', 'r', 'n'];
  // 掉落池：固定 4 件套装部件（职业随机 / 部位随机 / 可重复）+ 极低概率橙装图纸
  function raidLootPool() {
    const pool = [];
    for (let i = 0; i < 4; i++) {
      const cls = RAID_ROSTER[Math.floor(Math.random() * RAID_ROSTER.length)];
      const slot = RAID_SLOTS[Math.floor(Math.random() * RAID_SLOTS.length)];
      pool.push({ kind: 'gear', gid: `moltencore_${cls}_${slot}`, cls, slot });
    }
    // 橙装图纸（0.05%）：三职业随机，玩家可自由切换职业，不存在用不了的情况
    if (Math.random() < .0005) {
      const cls = RAID_ROSTER[Math.floor(Math.random() * RAID_ROSTER.length)];
      pool.push({ kind: 'plan', gid: cls === 'mage' ? 'plan_sulfuras_mage' : cls === 'hunter' ? 'plan_sulfuras_hunter' : 'plan_sulfuras', cls, slot: 'w' });
    }
    return pool;
  }
  const raidSelfId = () => (typeof NET !== 'undefined' && NET.myId) ? NET.myId : 'local';
  const raidIsHost = () => !game?.coop || game.coop.host;
  function raidItemName(it) {
    if (!it) return '未知物品';
    return it.kind === 'plan' ? (ITEMS[it.gid]?.name || it.gid) : (GEAR[it.gid]?.name || it.gid);
  }
  function raidItemLabel(it) {
    if (!it) return '';
    if (it.kind === 'plan') return '橙装图纸';
    return `${heroes[it.cls]?.name || it.cls} · ${SLOT_BASE[it.cls]?.[it.slot] || ''}`;
  }
  function raidItemIcon(it) {
    if (!it) return '';
    return it.kind === 'plan' ? itemIconHtml(it.gid, 26) : gearIconHtml(it.gid, 26);
  }
  function raidPlayerName(pid) {
    const pl = NET.room?.players?.find(p => p.id === pid);
    if (pl?.name) return pl.name;
    if (pid === raidSelfId()) return '你';
    return '队员';
  }
  function raidRoster() {
    const ids = NET.room?.players?.map(p => p.id) || [];
    if (!ids.length) ids.push(raidSelfId());
    return ids;
  }
  // 打开团本结算页（主机建权威状态并广播；客户端只建视图，等快照）
  function openRaidLoot(items) {
    const host = raidIsHost();
    game.raidLoot = {
      items, rolls: {}, states: {}, resolved: [], winners: {}, chat: [], localChat: [],
      roster: host ? raidRoster() : (NET.room?.players?.map(p => p.id) || [raidSelfId()]),
      deadline: Date.now() + RAID_ROLL_SECONDS * 1000, remain: RAID_ROLL_SECONDS * 1000,
      remainAt: Date.now(), closeAt: 0, closeIn: 0, granted: {}, myState: {}, myRoll: {},
      rollTs: {}, names: Object.fromEntries((NET.room?.players || []).map(p => [p.id, p.name]))
    };
    if (host) {
      raidChatPush('系统', `熔火之心已通关 · ${items.length} 件战利品待分配，请在 ${RAID_ROLL_SECONDS} 秒内完成需求或放弃`, 'sys');
      if (game.raidTimer) clearInterval(game.raidTimer);
      game.raidTimer = setInterval(raidTick, 200);
      raidTick();
    }
    ui['raid-loot'].classList.remove('hidden'); ui['raid-loot'].classList.add('active');
    renderRaidLoot();
  }
  // 主机：每 200ms 检查「全员已选 / 超时」并广播剩余秒数（主机单方面计时，客户端只显示）
  function raidTick() {
    const L = game.raidLoot; if (!L) return;
    const now = Date.now();
    const remain = Math.max(0, L.deadline - now);
    for (let i = 0; i < L.items.length; i++) {
      if (L.resolved[i]) continue;
      const st = L.states[i] || {};
      if (L.roster.every(pid => st[pid])) raidResolveItem(i);
    }
    if (remain <= 0) {
      // 超时：未点击者一律视为放弃
      for (let i = 0; i < L.items.length; i++) {
        if (L.resolved[i]) continue;
        L.states[i] = L.states[i] || {};
        for (const pid of L.roster) if (!L.states[i][pid]) L.states[i][pid] = 'pass';
        raidResolveItem(i);
      }
      if (!L.closeAt) { L.closeAt = now + 3000; raidChatPush('系统', '战利品分配完毕，即将返回', 'sys'); }
    }
    L.remain = remain; L.remainAt = now;
    raidBroadcast();
    renderRaidLoot();
    if (L.closeAt && now >= L.closeAt) closeRaidLoot();
  }
  function raidBroadcast() {
    const L = game.raidLoot; if (!L || !raidIsHost()) return;
    if (typeof NET === 'undefined' || !NET.connected) return;
    NET.sendSnap({ k: 'raid', rl: {
      items: L.items, rolls: L.rolls, states: L.states, resolved: L.resolved, winners: L.winners,
      chat: L.chat, roster: L.roster, names: L.names,
      remain: L.remain, remainAt: L.remainAt, closeAt: L.closeAt, closeIn: L.closeAt ? Math.max(0, L.closeAt - Date.now()) : 0
    } });
  }
  function raidChatPush(name, text, cls) {
    const L = game.raidLoot; if (!L) return;
    L.chat.push({ name, text, cls: cls || 'me', ts: Date.now() });
    if (L.chat.length > 80) L.chat.shift();
  }
  // 结算单件物品：需求者中 roll 点最高者获得（平局取先 roll 者）
  function raidResolveItem(i) {
    const L = game.raidLoot; if (!L || L.resolved[i]) return;
    const st = L.states[i] || {}, rolls = L.rolls[i] || {}, ts = L.rollTs?.[i] || {};
    const needers = L.roster.filter(pid => st[pid] === 'need');
    let winner = null;
    if (needers.length) {
      let best = null;
      for (const pid of needers) {
        const v = rolls[pid] ?? 0, t = ts[pid] ?? 0;
        if (!best || v > best.v || (v === best.v && t < best.t)) best = { pid, v, t };
      }
      winner = best.pid;
    }
    L.resolved[i] = true;
    L.winners[i] = winner;
    const name = raidItemName(L.items[i]);
    if (winner) {
      raidChatPush('系统', `${L.names?.[winner] || raidPlayerName(winner)} 以 ${rolls[winner]} 点获得【${name}】`, 'win');
      if (winner === raidSelfId()) raidGrantItem(i);
    } else {
      raidChatPush('系统', `【${name}】无人需求，已放弃`, 'sys');
    }
    if (L.resolved.filter(Boolean).length >= L.items.length && !L.closeAt) {
      L.closeAt = Date.now() + 3000;
      raidChatPush('系统', '战利品分配完毕，即将返回', 'sys');
    }
    renderRaidLoot();
  }
  // 发放奖励到「本机存档」（各机独立存档，主机只判定归属，物品由归属者本机入库）
  function raidGrantItem(i) {
    const L = game.raidLoot; if (!L || L.granted[i]) return;
    L.granted[i] = true;
    const it = L.items[i]; if (!it) return;
    let msg = '';
    if (it.kind === 'gear') {
      const g = GEAR[it.gid];
      if (save.gearLearned.includes(it.gid)) { save.gold += RAID_ITEM_GOLD; msg = `【${g?.name || it.gid}】已获得过 · 折算 ${RAID_ITEM_GOLD} 金币`; }
      else { save.gearLearned.push(it.gid); msg = `获得熔火 T1 部件 · ${g?.name || it.gid}`; }
      save.stats.moltenT1 = save.gearLearned.filter(x => String(x).startsWith('moltencore_')).length;
    } else {
      const it2 = ITEMS[it.gid];
      if (it2?.gearId && save.gearLearned.includes(it2.gearId)) { save.gold += RAID_PLAN_GOLD; msg = `已学会对应图样 · 折算 ${RAID_PLAN_GOLD} 金币`; }
      else if (addToBag(it.gid, 1)) msg = `获得图纸 · ${it2?.name || it.gid}`;
      else { save.gold += RAID_PLAN_GOLD; msg = `背包已满 · 折算 ${RAID_PLAN_GOLD} 金币`; }
    }
    persist(); checkAchievements();
    toast(msg);
    renderRaidLoot();
  }
  // 客户端点击骰子：本地生成 1-100 并上报主机（主机权威记录并判定归属）
  function raidOnDice(i) {
    const L = game.raidLoot; if (!L) return;
    if (L.resolved[i] || L.myState[i]) return;
    if ((L.states[i] || {})[raidSelfId()]) return;
    const val = 1 + Math.floor(Math.random() * 100);
    L.myState[i] = 'need'; L.myRoll[i] = val;
    L.localChat.push({ name: '我', text: `你 roll 了 ${val} 点 · 【${raidItemName(L.items[i])}】`, cls: 'me', ts: Date.now() });
    save.stats.bestRoll = Math.max(save.stats.bestRoll || 0, val);
    persist();
    if (raidIsHost()) raidHostRoll(raidSelfId(), i, val);
    else NET.sendEv({ k: 'raidRoll', idx: i, val });
    renderRaidLoot();
  }
  function raidOnPass(i) {
    const L = game.raidLoot; if (!L) return;
    if (L.resolved[i] || L.myState[i]) return;
    if ((L.states[i] || {})[raidSelfId()]) return;
    L.myState[i] = 'pass';
    if (raidIsHost()) raidHostPass(raidSelfId(), i);
    else NET.sendEv({ k: 'raidPass', idx: i });
    renderRaidLoot();
  }
  // 主机：记录客户端上报的 roll / 放弃
  function raidHostRoll(pid, idx, val) {
    const L = game.raidLoot; if (!L) return;
    if (!L.roster.includes(pid)) return;
    if (idx < 0 || idx >= L.items.length) return;
    if (L.resolved[idx]) return;
    L.states[idx] = L.states[idx] || {}; L.rolls[idx] = L.rolls[idx] || {}; L.rollTs = L.rollTs || {}; L.rollTs[idx] = L.rollTs[idx] || {};
    if (L.states[idx][pid]) return;
    const v = Math.max(1, Math.min(100, Math.round(Number(val) || 0)));
    L.states[idx][pid] = 'need'; L.rolls[idx][pid] = v; L.rollTs[idx][pid] = Date.now();
    const st = L.states[idx];
    if (L.roster.every(x => st[x])) raidResolveItem(idx);
    raidBroadcast();
  }
  function raidHostPass(pid, idx) {
    const L = game.raidLoot; if (!L) return;
    if (!L.roster.includes(pid)) return;
    if (idx < 0 || idx >= L.items.length) return;
    if (L.resolved[idx]) return;
    L.states[idx] = L.states[idx] || {};
    if (L.states[idx][pid]) return;
    L.states[idx][pid] = 'pass';
    const st = L.states[idx];
    if (L.roster.every(x => st[x])) raidResolveItem(idx);
    raidBroadcast();
  }
  function raidHostChat(pid, text) {
    const L = game.raidLoot; if (!L) return;
    const t = String(text || '').slice(0, 60);
    if (!t) return;
    raidChatPush(L.names?.[pid] || raidPlayerName(pid), t, 'me');
    raidBroadcast(); renderRaidLoot();
  }
  // 渲染团本结算页（左侧掉落列表 + 右侧聊天框）
  function renderRaidLoot() {
    const L = game.raidLoot; if (!L) return;
    const list = ui['raid-items'];
    const remainMs = Math.max(0, (L.remain || 0) - (Date.now() - (L.remainAt || Date.now())));
    const remainSec = Math.ceil(remainMs / 1000);
    list.innerHTML = '';
    for (let i = 0; i < L.items.length; i++) {
      const it = L.items[i];
      const st = (L.states || {})[i] || {};
      const roll = (L.rolls || {})[i] || {};
      const resolved = !!L.resolved[i];
      const winner = L.winners[i];
      const myState = L.myState[i] || st[raidSelfId()];
      const myRoll = L.myRoll[i] ?? roll[raidSelfId()];
      const decidedCount = L.roster.filter(pid => st[pid]).length;
      const row = document.createElement('div');
      row.className = 'raid-item' + (resolved ? (winner ? ' ri-won' : ' ri-passed') : '');
      const stxt = resolved
        ? (winner ? `<em style="color:#7fb98f">${L.names?.[winner] || raidPlayerName(winner)} 获得（${roll[winner]} 点）</em>` : '<em style="color:#8a7a68">无人需求</em>')
        : (myState === 'need' ? `<em style="color:#a8f0c4">你已 roll ${myRoll} 点 · 等待其他队员</em>`
          : myState === 'pass' ? '<em style="color:#8a7a68">你已放弃</em>'
            : `<em style="color:#8a7a68">等待选择（${decidedCount}/${L.roster.length}）</em>`);
      row.innerHTML = `<span class="ri-icon">${raidItemIcon(it)}</span>`
        + `<span class="ri-name">${raidItemName(it)}<small>${raidItemLabel(it)}${stxt ? ' · ' + stxt : ''}</small></span>`
        + `<span class="ri-rollval">${myRoll != null ? myRoll : ''}</span>`
        + `<button class="ri-dice${myState ? ' ri-done' : ''}" title="需求（roll 点 1-100）">🎲</button>`
        + `<button class="ri-x${myState === 'pass' ? ' ri-done' : ''}" title="放弃">✕</button>`
        + `<span class="ri-timer${remainSec <= 10 && !resolved ? ' ri-urgent' : ''}">${resolved ? '—' : remainSec}</span>`;
      if (!resolved && !myState) {
        row.querySelector('.ri-dice').addEventListener('click', () => raidOnDice(i));
        row.querySelector('.ri-x').addEventListener('click', () => raidOnPass(i));
      } else {
        row.querySelector('.ri-dice').disabled = true; row.querySelector('.ri-x').disabled = true;
      }
      list.appendChild(row);
    }
    // 聊天框（主机记录 + 本地私有 roll 提示）
    const log = ui['raid-chat-log'];
    const lines = [...(L.chat || []), ...(L.localChat || [])].sort((a, b) => (a.ts || 0) - (b.ts || 0));
    log.innerHTML = lines.map(c => `<div class="rc-${c.cls || 'me'}">${c.cls === 'sys' || c.cls === 'win' ? `[${c.name}] ${c.text}` : `${c.name}：${c.text}`}</div>`).join('');
    log.scrollTop = log.scrollHeight;
    if (ui['raid-stat']) {
      const p = game.player;
      ui['raid-stat'].textContent = `存活 ${formatTime(game.elapsed)} · 击败 ${p.kills} · 等级 ${p.level} · 金币 ${p.gold}`;
    }
  }
  function closeRaidLoot() {
    const L = game.raidLoot;
    if (L) L.closed = true;
    if (game.raidTimer) { clearInterval(game.raidTimer); game.raidTimer = null; }
    ui['raid-loot'].classList.add('hidden'); ui['raid-loot'].classList.remove('active');
    game.raidLoot = null;
    // 联机：回到大厅等待房主重开；单机：回主界面
    if (typeof NET !== 'undefined' && NET.connected && NET.room) { toast('战利品已分配'); openLobby(); }
    else showMenu();
  }
  // 客户端：应用主机下发的团本结算状态
  function clientOnRaid(rl) {
    const L = game.raidLoot; if (!L || !rl) return;
    L.items = rl.items || L.items;
    L.rolls = rl.rolls || {}; L.states = rl.states || {};
    L.resolved = rl.resolved || []; L.winners = rl.winners || {};
    L.chat = rl.chat || []; L.roster = rl.roster || L.roster; L.names = rl.names || L.names;
    // 剩余时间用「主机剩余毫秒 + 客户端本地经过时间」插值，避免两端时钟偏差导致跳秒
    L.remain = rl.remain || 0; L.remainAt = Date.now();
    L.closeIn = rl.closeIn || 0; L.closeAt = L.closeIn ? Date.now() + L.closeIn : 0;
    // 归属判定由主机完成；本机若为归属者则写入本机存档
    for (let i = 0; i < L.items.length; i++) {
      if (L.winners[i] === raidSelfId()) raidGrantItem(i);
    }
    renderRaidLoot();
    if (L.closeAt && Date.now() >= L.closeAt) closeRaidLoot();
  }

  // ===== 第 10 项：首领模型由名册 BOSS_ROSTER 决定（20 位副本首领 + 2 位无尽专属，模型全局唯一）=====
  function bossSpineKey(e) {
    if (e.spine) return e.spine;
    const def = BOSS_ROSTER[e.variant ?? 0];
    return def ? def.spine : 'boss_hogger';
  }
  function drawProtectiveFx(f) {
    const wall = f.shield === 'shield_wall', color = wall ? '#ffd58a' : '#9fe4ff';
    const t = performance.now() / 180, pulse = 1 + Math.sin(t) * .025;
    ctx.save(); ctx.translate(f.x, f.y); ctx.scale(pulse, pulse);
    ctx.globalAlpha = clamp(f.life / .25, 0, 1) * (f.alpha ?? 1);
    ctx.fillStyle = FX.alpha(color, wall ? .1 : .13); ctx.beginPath(); ctx.arc(0, 0, 52, 0, TAU); ctx.fill();
    ctx.strokeStyle = color; ctx.shadowColor = color; ctx.shadowBlur = wall ? 12 : 16;
    ctx.lineWidth = wall ? 4 : 3; ctx.setLineDash(wall ? [18, 7] : [7, 6]); ctx.lineDashOffset = wall ? 0 : -t * 5;
    ctx.beginPath(); ctx.arc(0, 0, 55, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    ctx.globalAlpha *= .62; ctx.lineWidth = 1.5; ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.arc(0, 0, 47, 0, TAU); ctx.stroke();
    if (wall) {
      for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(0, 0, 60, i * Math.PI / 2 - .28, i * Math.PI / 2 + .28); ctx.stroke(); }
    } else {
      for (let i = 0; i < 6; i++) { const a = i / 6 * TAU + t * .08; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 44, Math.sin(a) * 44); ctx.lineTo(Math.cos(a) * 53, Math.sin(a) * 53); ctx.stroke(); }
    }
    ctx.restore();
  }
  function camera() {
    const p = game?.player || { x: 0, y: 0 };
    // ★ 塔防模式：地图有限（3072×1918），摄像机钳制在地图内，避免看到地图外的空白
    if (game?.gameMode === 'td') {
      // 联机观战：摄像机跟随被观看的队友
      let fx = p.x, fy = p.y;
      if (TDR.viewPad) {
        const al = game.allies?.get(TDR.viewPad);
        if (al) { fx = al.x; fy = al.y; }
      }
      // 拖动平移偏移（脱离跟随），松手 1.5 秒后自动回到跟随
      const ox = TDR.camOff.x, oy = TDR.camOff.y;
      return { x: Math.max(0, Math.min(Math.max(0, TD.MAP.W - width), fx - width / 2 + ox)),
               y: Math.max(0, Math.min(Math.max(0, TD.MAP.H - height), fy - height / 2 + oy)) };
    }
    return { x: p.x - width / 2, y: p.y - height / 2 };
  }
  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
    if (!game) { drawMenuGround(); return; }
    // ★ 低档设备：屏幕震动幅度减半（§3.6）—— 震动本身不省算力，但大幅位移会触发
    //   整屏重绘与像素填充，幅度减半等于减少了需要重绘的区域。
    const shk = game.shake * ((window.__perfTier && window.__perfTier.isLow()) ? .5 : 1);
    const cam = camera(); const sx = shk ? rand(-shk, shk) : 0, sy = shk ? rand(-shk, shk) : 0;
    ctx.save(); ctx.translate(-cam.x + sx, -cam.y + sy);
    if (game.gameMode === 'td') tdDrawGround(cam); else drawGround(cam);
    if (game.gameMode === 'td') tdDrawOverlay();   // ★ 心脏 / 传送阵 / 覆盖圈 / 守卫
    // 熔火之心：敌方地板预警（红色由淡转明）——画在地面层之上、角色之下
    for (const tg of game.telegraphs || []) drawTelegraph(tg);
    for (const z of game.zones) drawZone(z);
    for (const tr of game.traps) drawTrap(tr);
    for (const m of game.meteors) {
      // 陨石坠落预警圈
      ctx.save(); ctx.globalAlpha = .5 + Math.sin(performance.now() / 60) * .3;
      ctx.strokeStyle = '#f28a52'; ctx.lineWidth = 2; ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      ctx.restore();
    }
    for (const g of game.gems) drawGem(g);
    for (const o of game.orbs) drawOrb(o);
    for (const e of game.enemies) if (!e.dead) drawEnemy(e);
    for (const pt of game.pets) drawPet(pt);
    for (const q of game.projectiles) drawProjectile(q);
    for (const q of game.enemyShots) drawProjectile(q);
    drawPlayer(game.player);
    if (game.allies) for (const al of game.allies.values()) drawAlly(al); // #51 队友
    drawReviveFx(); // 第 11 项：战复读条特效
    for (const f of game.spineFx) {
      if (f.shield) drawProtectiveFx(f);
      SPINE.drawFx(f, { ctx, x: f.x, y: f.y, angle: f.a, size: f.size, fit: f.fit, flipY: f.flipY, tint: f.tint, alpha: f.alpha * clamp(f.life / .22, 0, 1) });
    }
    if (game.allyFx) for (const f of game.allyFx) drawAllyFx(f); // #53 队友技能弹道（淡化）
    // 光照层（加色混合：主角辉光 + 宝珠光晕）
    // 第 8 项：主角辉光半径 260→420、强度 .09→.11，让角色周围的光亮区域明显变大
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = FX.radial(ctx, 'light', 420, [[0, 'rgba(255,228,175,.11)'], [.55, 'rgba(255,222,160,.045)'], [1, 'rgba(0,0,0,0)']]);
    ctx.beginPath(); ctx.arc(game.player.x, game.player.y, 420, 0, TAU); ctx.fill();
    for (const o of game.orbs) { ctx.fillStyle = FX.radial(ctx, 'orb_glow', 90, [[0, 'rgba(159,228,255,.16)'], [1, 'rgba(0,0,0,0)']]); ctx.beginPath(); ctx.arc(o.x, o.y, 90, 0, TAU); ctx.fill(); }
    ctx.restore();
    for (const e of game.effects) drawEffect(e);
    FX.draw(ctx);
    for (const pt of game.particles) { ctx.globalAlpha = clamp(pt.life / pt.maxLife, 0, 1); ctx.fillStyle = pt.color; ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.size, 0, TAU); ctx.fill(); } ctx.globalAlpha = 1;
    for (const t of game.texts) { ctx.globalAlpha = clamp(t.life / .3, 0, 1); ctx.font = `bold ${t.size}px Arial`; ctx.textAlign = 'center'; ctx.fillStyle = t.color; ctx.strokeStyle = '#071012'; ctx.lineWidth = 3; ctx.strokeText(t.text, t.x, t.y - (.7 - t.life) * 35); ctx.fillText(t.text, t.x, t.y - (.7 - t.life) * 35); } ctx.globalAlpha = 1;
    ctx.restore();
    // ===== 第 8 项：淡化暗角遮罩、扩大光亮区域 =====
    // 原来：内径 0.25*短边、外径 0.7*长边、边缘不透明度 .58 → 画面四角很暗，
    // 只有角色中心一圈是亮的。现在把亮区显著扩大、遮罩大幅减淡，整体亮度提升。
    const vigR = Math.max(width, height) * .82;
    const vignette = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * .52, width / 2, height / 2, vigR);
    vignette.addColorStop(0, 'rgba(0,6,8,0)');
    vignette.addColorStop(.62, 'rgba(0,6,8,.10)');   // 中段就开始极淡地压暗，过渡更平缓
    vignette.addColorStop(1, 'rgba(0,6,8,.30)');     // 边缘遮罩从 .58 降到 .30
    ctx.fillStyle = vignette; ctx.fillRect(0, 0, width, height);
    if (game.flash > 0) { ctx.fillStyle = `rgba(190,30,25,${game.flash * .8})`; ctx.fillRect(0, 0, width, height); }
  }

  // #51 队友绘制：职业立绘 + 名字 + 血条
  function drawAlly(al) {
    const h = heroes[al.hero]; if (!h) return;
    const t = performance.now();
    ctx.save(); ctx.translate(al.x, al.y);
    ctx.globalAlpha = al.dead ? .3 : .92;
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(0, 15, 18, 7, 0, 0, TAU); ctx.fill();
    if (SPINE.drawActor(al, { ctx, flip: al.dirX < 0, alpha: al.dead ? .3 : .92 })) {
      ctx.restore();
    } else {
    const sp = (al.cast && ASSETS.get(al.hero + '_attack')) || ASSETS.get(al.hero);
    if (sp) {
      if (al.dirX < 0) ctx.scale(-1, 1);
      ctx.drawImage(sp, -32, -38 + Math.sin(t / 450 + al.x * .01) * 2, 64, 64);
    } else {
      ctx.fillStyle = h.color; ctx.beginPath(); ctx.arc(0, 0, 14, 0, TAU); ctx.fill();
    }
    ctx.restore();
    }
    ctx.save(); ctx.textAlign = 'center'; ctx.font = '10px sans-serif';
    ctx.fillStyle = h.color; ctx.fillText(al.name || h.name, al.x, al.y - 40);
    ctx.fillStyle = '#14191a'; ctx.fillRect(al.x - 18, al.y - 36, 36, 4);
    ctx.fillStyle = al.dead ? '#5a4a4a' : '#7fb98f';
    ctx.fillRect(al.x - 18, al.y - 36, 36 * clamp(al.hp / (al.maxHp || 1), 0, 1), 4);
    ctx.restore();
  }

  // #53/#54 队友技能视觉（真实事件驱动，55% 淡化透明度与本地弹道区分）
  function drawAllyFx(f) {
    ctx.save();
    ctx.globalAlpha = .55 * clamp(f.life / f.maxLife, 0, 1);
    if (f.type === 'bolt') {
      ctx.strokeStyle = f.color; ctx.lineWidth = f.size || 3; ctx.lineCap = 'round';
      ctx.shadowColor = f.color; ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(f.x - f.vx * .045, f.y - f.vy * .045);
      ctx.lineTo(f.x, f.y);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(f.x, f.y, (f.size || 2.5), 0, TAU); ctx.fill();
    } else if (f.type === 'slash') { // 挥砍弧光
      ctx.strokeStyle = f.color; ctx.lineWidth = 4; ctx.lineCap = 'round';
      const t = 1 - f.life / f.maxLife;
      ctx.beginPath();
      ctx.arc(f.x, f.y, 42, f.a - 1 + t * 2 - .5, f.a - 1 + t * 2 + .5);
      ctx.stroke();
    } else if (f.type === 'ring') { // 自身扩散环（旋风斩/雷霆/怒吼等）
      ctx.strokeStyle = f.color; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(f.x, f.y, Math.max(4, f.r), 0, TAU); ctx.stroke();
    } else if (f.type === 'zone') { // 目标区域（暴风雪/烈焰风暴/陷阱）
      ctx.strokeStyle = f.color; ctx.lineWidth = 3; ctx.setLineDash([8, 6]);
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = f.color; ctx.globalAlpha *= .18;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, TAU); ctx.fill();
    } else if (f.type === 'orbfx') { // 寒冰宝珠
      ctx.fillStyle = f.color; ctx.shadowColor = f.color; ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.arc(f.x, f.y, 12, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(f.x, f.y, 5, 0, TAU); ctx.fill();
    } else if (f.type === 'dashfx') { // 冲锋路径/杀戮命令光束
      ctx.strokeStyle = f.color; ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.shadowColor = f.color; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(f.x2, f.y2); ctx.stroke();
    }
    ctx.restore();
  }

  function drawMenuGround() {
    ctx.fillStyle = '#0b1416'; ctx.fillRect(0, 0, width, height);
    for (let i = 0; i < 70; i++) { const x = hash(i, 2) * width, y = hash(i, 4) * height, r = hash(i, 7) * 2 + .4; ctx.fillStyle = `rgba(139,187,167,${.05 + hash(i, 8) * .14})`; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); }
  }

  function drawGround(cam) {
    const pal = game?.dungeon ? game.dungeon.ground : ['#12201e', '#152522', '#14231f'];
    const accent = game?.dungeon ? game.dungeon.accent : '#20332b';
    // ===== 第 7 项：AI 场景贴图（4 副本 + 无尽模式）=====
    // 写实俯视贴图铺底（已做无缝化处理，可循环平铺）。
    const sceneKey = game?.dungeonId || 'adventure';
    const scene = typeof ASSETS !== 'undefined' ? ASSETS.getScene(sceneKey) : null;
    if (scene) {
      const tile = (typeof ASSETS !== 'undefined' && ASSETS.sceneTile) ? ASSETS.sceneTile : 768; // 每张贴图覆盖多少世界像素
      // ===== 第 15 项：地面平铺改为「世界网格锚定」，彻底消除移动时的闪烁/跳变 =====
      // 旧实现的两个错误：
      //   ① 取模基准不一致：偏移用 cam.x % tile，而起始块用 floor((cam.x - 50) / tile)，
      //      两者基准差 50px，导致贴图网格在世界空间里持续漂移；
      //   ② 内外两次平移叠加：draw() 已把画布平移了 -cam.x，drawGround 内又平移了 -(cam.x % tile)，
      //      地面因此以 2 倍速相对镜头滚动，且每跨过一个 tile 边界整块瞬移一格 —— 这正是
      //      玩家看到的「背景图片随着角色移动闪烁切换」。
      // 现在：不再做任何取模平移，直接以「世界坐标 = 网格索引 × tile」绘制，
      // 地面与镜头严格 1:1 绑定，越过 tile 边界时像素连续，不会跳变。
      const gx0 = Math.floor((cam.x - 60) / tile), gy0 = Math.floor((cam.y - 60) / tile);
      const cols = Math.ceil(width / tile) + 3, rows = Math.ceil(height / tile) + 3;
      ctx.save();
      ctx.globalAlpha = 1;
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        ctx.drawImage(scene, (gx0 + i) * tile, (gy0 + j) * tile, tile, tile);
      }
      ctx.restore();
      // 贴图上仅做极轻的明暗扰动（无硬边），保留写实质感的同时让敌人/掉落物更易辨识
      // 两层低频斑块：大尺度打散贴图重复感，小尺度补充局部明暗
      const layers = [{ size: 320, count: 1, dark: .2, light: .06 }, { size: 160, count: 1, dark: .13, light: .04 }];
      for (const L of layers) {
        const t2 = L.size, gx0 = Math.floor((cam.x - 50) / t2), gy0 = Math.floor((cam.y - 50) / t2);
        const gx1 = gx0 + Math.ceil(width / t2) + 2, gy1 = gy0 + Math.ceil(height / t2) + 2;
        ctx.save();
        for (let x = gx0; x < gx1; x++) for (let y = gy0; y < gy1; y++) {
          const h = hash(x + L.size, y - L.size);
          if (h < .42) continue;
          // 用径向渐变柔化边缘，避免程序化方块的网格感
          const cx0 = x * t2 + t2 / 2, cy0 = y * t2 + t2 / 2;
          const r = t2 * (.42 + h * .3);
          const g = ctx.createRadialGradient(cx0, cy0, 0, cx0, cy0, r);
          const dark = h > .74;
          const col = dark ? '0,6,8' : '255,240,210';
          g.addColorStop(0, `rgba(${col},${dark ? L.dark : L.light})`);
          g.addColorStop(1, `rgba(${col},0)`);
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.ellipse(cx0, cy0, r, r * .74, hash(y, x) * 3, 0, TAU); ctx.fill();
        }
        ctx.restore();
      }
      return; // 有写实贴图时不再叠加程序化方块与椭圆石块（避免网格感与重复感）
    }
    // 无贴图（素材缺失）时的程序化地面兜底
    ctx.fillStyle = pal[0]; ctx.fillRect(cam.x - 50, cam.y - 50, width + 100, height + 100);
    const tile = 80, x0 = Math.floor((cam.x - 50) / tile), y0 = Math.floor((cam.y - 50) / tile), x1 = x0 + Math.ceil(width / tile) + 2, y1 = y0 + Math.ceil(height / tile) + 2;
    for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) {
      const h = hash(x, y), px = x * tile, py = y * tile;
      // 兜底路径：程序化色块 + 草丛，保证无贴图时地面仍有层次
      ctx.fillStyle = h > .5 ? pal[1] : pal[2]; ctx.globalAlpha = 1; ctx.fillRect(px, py, tile + 1, tile + 1);
      if (h > .76) { ctx.fillStyle = FX.alpha(accent.startsWith('#') ? accent : '#20332b', .35); ctx.beginPath(); ctx.ellipse(px + tile * hash(y, x), py + tile * hash(x + 4, y), 18 + h * 18, 8 + h * 8, h * 4, 0, TAU); ctx.fill(); }
      ctx.strokeStyle = 'rgba(117,151,117,.1)'; ctx.lineWidth = 1;
      for (let j = 0; j < 2; j++) { const gx = px + hash(x + j * 9, y) * tile, gy = py + hash(x, y + j * 7) * tile; ctx.beginPath(); ctx.moveTo(gx, gy + 5); ctx.lineTo(gx - 3, gy - 4); ctx.moveTo(gx, gy + 5); ctx.lineTo(gx + 4, gy - 6); ctx.stroke(); }
    }
  }

  function drawPlayer(p) {
    const color = heroes[p.type].color;
    const t = performance.now();
    ctx.save(); ctx.translate(p.x, p.y);
    if (p.invuln > 0 && Math.floor(p.invuln * 20) % 2) ctx.globalAlpha = .45;
    // 地面阴影
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(0, 16, 20, 8, 0, 0, TAU); ctx.fill();
    // 职业光环
    ctx.strokeStyle = color; ctx.globalAlpha *= .2; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 23 + Math.sin(t / 180) * 2, 0, TAU); ctx.stroke();
    ctx.globalAlpha = p.invuln > 0 && Math.floor(p.invuln * 20) % 2 ? .45 : 1;
    if (p.downed) ctx.globalAlpha = .3; // #51 联机倒下观战
    if (p.wallT > 0) { ctx.strokeStyle = 'rgba(207,232,255,.6)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 28, 0, TAU); ctx.stroke(); }
    // 寒冰护体护盾
    if (p.barrierHp > 0) {
      ctx.strokeStyle = `rgba(159,228,255,${.5 + Math.sin(t / 120) * .2})`; ctx.lineWidth = 3;
      ctx.setLineDash([10, 6]); ctx.lineDashOffset = -t / 30;
      ctx.beginPath(); ctx.arc(0, 0, 31, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    }
    // 动效：移动侧倾 + 攻击前扑 + 施法脉冲
    const lunge = p.atkAnim > 0 ? FX.ease.outCubic(p.atkAnim / .14) * 7 : 0;
    const castP = p.castAnim > 0 ? FX.ease.outCubic(p.castAnim / .25) : 0;
    const facing = Math.atan2(p.dirY, p.dirX);
    ctx.rotate(p.moveX * .07);
    ctx.translate(Math.cos(facing) * lunge, Math.sin(facing) * lunge);
    if (castP > 0) ctx.scale(1 + castP * .07, 1 + castP * .07);
    // Spine 实时骨骼 → 高清精灵 → 矢量回退
    if (SPINE.drawActor(p, { ctx, flip: p.dirX < 0, alpha: p.downed ? .3 : (p.invuln > 0 && Math.floor(p.invuln * 20) % 2 ? .45 : 1) })) {
      ctx.restore();
      return;
    }
    // 高清精灵（攻击帧连环切换；素材缺失回退矢量绘制）
    const sp = (p.atkAnim > 0 && ASSETS.get(p.type + '_attack')) || ASSETS.get(p.type);
    if (sp) {
      const bob = Math.sin(t / 450) * 2 + (Math.abs(p.moveX) + Math.abs(p.moveY) > .1 ? Math.sin(t / 90) * 1.5 : 0);
      ctx.save();
      if (p.dirX < 0) ctx.scale(-1, 1);
      ctx.drawImage(sp, -36, -42 + bob, 72, 72);
      ctx.restore();
      ctx.restore();
      return;
    }
    const a = Math.atan2(p.dirY, p.dirX); ctx.rotate(a + Math.PI / 2);
    const breathe = 1 + Math.sin(t / 450) * .025; ctx.scale(1, breathe);
    // 斗篷（渐变体积感）
    ctx.fillStyle = FX.radial(ctx, 'cloak_' + p.type, 30, [[0, FX.shade(color, .12)], [.55, '#1c2c33'], [1, '#0c161a']]);
    ctx.beginPath(); ctx.moveTo(0, -19); ctx.quadraticCurveTo(18, 2, 16, 18); ctx.lineTo(0, 12); ctx.lineTo(-16, 18); ctx.quadraticCurveTo(-18, 2, 0, -19); ctx.closePath(); ctx.fill();
    // 斗篷内衬
    ctx.fillStyle = FX.radial(ctx, 'inner_' + p.type, 18, [[0, FX.shade(color, .35)], [1, color]]);
    ctx.beginPath(); ctx.moveTo(0, -15); ctx.lineTo(8, 11); ctx.lineTo(0, 7); ctx.lineTo(-8, 11); ctx.closePath(); ctx.fill();
    // 兜帽与面容
    ctx.fillStyle = '#ead5b4'; ctx.beginPath(); ctx.arc(0, -12, 7, 0, TAU); ctx.fill();
    ctx.fillStyle = FX.radial(ctx, 'hood', 12, [[0, '#3a444c'], [1, '#20282e']]);
    ctx.beginPath(); ctx.arc(0, -14.5, 7.5, Math.PI, TAU); ctx.fill();
    // 武器（发光）
    ctx.shadowBlur = 8; ctx.shadowColor = color;
    if (p.type === 'warrior') { ctx.strokeStyle = '#e5ded0'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(10, 4); ctx.lineTo(16, -17); ctx.stroke(); ctx.shadowBlur = 0; ctx.strokeStyle = '#9c7649'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(14, 3); ctx.stroke(); }
    if (p.type === 'mage') { ctx.strokeStyle = '#9b794c'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(10, 13); ctx.lineTo(13, -17); ctx.stroke(); ctx.fillStyle = '#a2f1ff'; ctx.beginPath(); ctx.arc(13, -19, 5, 0, TAU); ctx.fill(); }
    if (p.type === 'hunter') { ctx.strokeStyle = '#c2a36b'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(10, -2, 11, -Math.PI / 2, Math.PI / 2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(10, -13); ctx.lineTo(10, 9); ctx.stroke(); }
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  function drawEnemy(e) {
    ctx.save(); ctx.translate(e.x, e.y);
    // 出生缩放入场
    if (e.spawnT > 0) { const s = 1 - .45 * FX.ease.outCubic(e.spawnT / .3); ctx.scale(s, s); }
    // 攻击动作：向玩家方向扑出
    if (e.atkT > 0) {
      const la = Math.atan2(game.player.y - e.y, game.player.x - e.x);
      const lm = FX.ease.outCubic(clamp(e.atkT / (e.boss ? .35 : .22), 0, 1)) * (e.boss ? 13 : 9);
      ctx.translate(Math.cos(la) * lm, Math.sin(la) * lm);
      ctx.scale(1 + lm * .012, 1 - lm * .006);
    }
    // 按种族的步态：狼/鱼人跳跃，其余起伏
    const hop = (e.type === 'wolf' || e.type === 'murloc') ? Math.abs(Math.sin(e.phase * (e.type === 'wolf' ? 8 : 6))) * (e.type === 'wolf' ? 4 : 2.5) : 0;
    const bob = Math.sin(e.phase * 4) * 2;
    ctx.translate(0, bob - hop);
    // 朝玩家方向轻微倾斜
    ctx.rotate(clamp((game.player.x - e.x) / 400, -1, 1) * .06);
    const squish = 1 + Math.sin(e.phase * 6) * (e.type === 'ooze' ? .08 : .03); ctx.scale(1 / squish, squish); // 呼吸形变
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(0, e.r * .8, e.r * 1.05, e.r * .45, 0, 0, TAU); ctx.fill();
    if (e.boss) { ctx.strokeStyle = 'rgba(230,109,74,.35)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, e.r + 9 + Math.sin(e.phase * 3) * 3, 0, TAU); ctx.stroke(); }
    // debuff 光环
    if (e.slowT > 0) { ctx.strokeStyle = 'rgba(140,215,245,.55)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, e.r + 4, 0, TAU); ctx.stroke(); }
    if (e.burnT > 0) { ctx.strokeStyle = 'rgba(242,138,82,.6)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, e.r + 7, e.phase * 3, e.phase * 3 + Math.PI * 1.3); ctx.stroke(); }
    if (e.poisT > 0) { ctx.strokeStyle = 'rgba(159,216,106,.55)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, e.r + 7, -e.phase * 3, -e.phase * 3 + Math.PI * 1.3); ctx.stroke(); }
    if (e.bleedT > 0) { ctx.strokeStyle = 'rgba(217,79,92,.7)'; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.arc(0, 0, e.r + 10, e.phase * 2.2, e.phase * 2.2 + Math.PI * 1.6); ctx.stroke(); }
    if (e.stunT > 0) { ctx.fillStyle = '#ffe179'; for (let i = 0; i < 3; i++) { const sa = e.phase * 4 + i / 3 * TAU; ctx.beginPath(); ctx.arc(Math.cos(sa) * (e.r + 8), -e.r - 8 + Math.sin(sa) * 4, 2.5, 0, TAU); ctx.fill(); } }
    // 首领 / 团本小怪的独立 Spine 模型（不再对独立骨骼素材做旧版色相染色）
    if (e.boss || e.spine) {
      if (e.flash > 0) ctx.filter = 'brightness(2.2)';
      if (SPINE.drawActor(e, { ctx, flip: game.player.x < e.x, alpha: 1 })) { ctx.restore(); return; }
      ctx.filter = 'none';
    }
    // 高清精灵（素材存在时优先，回退矢量绘制；副本怪物按主题染色）
    const sp = ASSETS.get(e.spriteKey || (e.boss ? 'boss' + (e.variant % 3 + 1) : e.type));
    if (sp) {
      const size = e.r * (e.boss ? 3.1 : 2.7);
      ctx.save();
      if (game.player.x < e.x) ctx.scale(-1, 1);
      if (e.tint) ctx.filter = `hue-rotate(${e.tint}deg) saturate(1.15)`;
      if (e.flash > 0) ctx.filter = (e.tint ? `hue-rotate(${e.tint}deg) ` : '') + 'brightness(2.4)';
      ctx.drawImage(sp, -size / 2, -size / 2 - e.r * .35, size, size);
      ctx.restore();
      ctx.restore();
      if (e.hp < e.maxHp && !e.boss) { ctx.fillStyle = '#14191a'; ctx.fillRect(e.x - e.r, e.y - e.r - 12, e.r * 2, 4); ctx.fillStyle = '#ce6457'; ctx.fillRect(e.x - e.r, e.y - e.r - 12, e.r * 2 * Math.max(0, e.hp / e.maxHp), 4); }
      return;
    }
    // 身体：受击闪白时用纯色，否则用缓存渐变
    const flashing = e.flash > 0;
    const body = flashing ? '#fff4dc' : FX.radial(ctx, 'body_' + e.type, e.r * 1.4, [[0, FX.shade(e.color, .22)], [1, FX.shade(e.color, -.18)]]);
    ctx.fillStyle = body;
    if (e.type === 'golem') {
      ctx.fillRect(-e.r * .8, -e.r * .75, e.r * 1.6, e.r * 1.55);
      ctx.fillStyle = flashing ? '#fff4dc' : '#535f59';
      ctx.fillRect(-e.r, -e.r * .3, e.r * .45, e.r * .7); ctx.fillRect(e.r * .55, -e.r * .3, e.r * .45, e.r * .7);
      // 核心辉光
      ctx.fillStyle = FX.radial(ctx, 'golem_core', e.r * .5, [[0, '#ffd98a'], [1, 'rgba(255,217,138,0)']]);
      ctx.beginPath(); ctx.arc(0, e.r * .1, e.r * .5, 0, TAU); ctx.fill();
    } else if (e.type === 'ooze') {
      ctx.globalAlpha = .85;
      ctx.beginPath(); ctx.arc(0, 0, e.r, 0, TAU); ctx.fill();
      ctx.fillStyle = flashing ? '#fff4dc' : FX.shade(e.color, .28);
      ctx.beginPath(); ctx.arc(-e.r * .3, -e.r * .25, e.r * .28, 0, TAU); ctx.arc(e.r * .35, e.r * .2, e.r * .2, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    } else if (e.type === 'spider') { // #55 蛛魔：圆腹 + 八足 + 复眼
      ctx.beginPath(); ctx.arc(0, 0, e.r, 0, TAU); ctx.fill();
      ctx.strokeStyle = flashing ? '#fff4dc' : FX.shade(e.color, -.3); ctx.lineWidth = 2;
      for (let i = 0; i < 4; i++) {
        const la = (i / 4) * Math.PI - .4 + Math.sin(e.phase * 10 + i) * .12;
        for (const s of [-1, 1]) {
          ctx.beginPath(); ctx.moveTo(s * e.r * .5, 0);
          ctx.lineTo(s * e.r * 1.35, Math.sin(la) * e.r * s > 0 ? 0 : 0);
          ctx.lineTo(s * e.r * 1.5, (i - 1.5) * e.r * .5); ctx.stroke();
        }
      }
      ctx.fillStyle = '#e85a5a';
      ctx.beginPath(); ctx.arc(-e.r * .25, -e.r * .3, 2.2, 0, TAU); ctx.arc(e.r * .25, -e.r * .3, 2.2, 0, TAU); ctx.fill();
    } else if (e.type === 'felhound') { // #55 恶魔猎犬：双角 + 熔光眼 + 尾刺
      ctx.beginPath(); ctx.arc(0, 0, e.r, 0, TAU); ctx.fill();
      ctx.strokeStyle = flashing ? '#fff4dc' : FX.shade(e.color, -.35); ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(-e.r * .4, -e.r * .7); ctx.lineTo(-e.r * .7, -e.r * 1.25); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(e.r * .4, -e.r * .7); ctx.lineTo(e.r * .7, -e.r * 1.25); ctx.stroke();
      ctx.fillStyle = '#ffb35c'; ctx.shadowColor = '#ffb35c'; ctx.shadowBlur = 6;
      ctx.beginPath(); ctx.arc(-e.r * .28, -e.r * .18, 2.6, 0, TAU); ctx.arc(e.r * .28, -e.r * .18, 2.6, 0, TAU); ctx.fill();
      ctx.shadowBlur = 0;
    } else if (e.type === 'skeleton') { // #55 骷髅武士：眼眶 + 肋骨架
      ctx.beginPath(); ctx.arc(0, 0, e.r, 0, TAU); ctx.fill();
      ctx.fillStyle = '#1a1e1c';
      ctx.beginPath(); ctx.arc(-e.r * .28, -e.r * .32, e.r * .18, 0, TAU); ctx.arc(e.r * .28, -e.r * .32, e.r * .18, 0, TAU); ctx.fill();
      ctx.strokeStyle = flashing ? '#fff4dc' : FX.shade(e.color, -.28); ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(-e.r * .55, e.r * (.05 + i * .25)); ctx.lineTo(e.r * .55, e.r * (.05 + i * .25)); ctx.stroke(); }
    } else if (e.type === 'wraith') { // #55 哀嚎怨灵：半透幽灵体 + 破碎下摆
      ctx.globalAlpha = .78;
      ctx.beginPath(); ctx.arc(0, -e.r * .15, e.r, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-e.r, 0);
      for (let i = 0; i <= 4; i++) ctx.lineTo(-e.r + (i / 4) * e.r * 2, e.r * (i % 2 ? 1.05 : .6) + Math.sin(e.phase * 7 + i) * 3);
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#dff4ff'; ctx.shadowColor = '#9fe4ff'; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(-e.r * .3, -e.r * .35, 2.8, 0, TAU); ctx.arc(e.r * .3, -e.r * .35, 2.8, 0, TAU); ctx.fill();
      ctx.shadowBlur = 0;
    } else {
      ctx.beginPath(); ctx.arc(0, 0, e.r, 0, TAU); ctx.fill();
      // 耳朵/犄角剪影
      ctx.beginPath();
      if (e.type === 'wolf') { // 尖耳
        ctx.moveTo(-e.r * .6, -e.r * .6); ctx.lineTo(-e.r * .45, -e.r * 1.35); ctx.lineTo(-e.r * .15, -e.r * .8);
        ctx.moveTo(e.r * .6, -e.r * .6); ctx.lineTo(e.r * .45, -e.r * 1.35); ctx.lineTo(e.r * .15, -e.r * .8);
      } else if (e.type === 'murloc') { // 背鳍
        ctx.moveTo(-e.r * .5, -e.r * .55); ctx.quadraticCurveTo(0, -e.r * 1.6, e.r * .5, -e.r * .55);
      } else if (e.type === 'cultist') { // 兜帽尖顶
        ctx.moveTo(-e.r * .7, -e.r * .3); ctx.lineTo(0, -e.r * 1.5); ctx.lineTo(e.r * .7, -e.r * .3);
      } else if (e.boss) { // 首领犄角
        ctx.moveTo(-e.r * .6, -e.r * .6); ctx.quadraticCurveTo(-e.r * .95, -e.r * 1.3, -e.r * .35, -e.r * 1.15);
        ctx.moveTo(e.r * .6, -e.r * .6); ctx.quadraticCurveTo(e.r * .95, -e.r * 1.3, e.r * .35, -e.r * 1.15);
      } else { // 豺狼人/巨魔尖耳
        ctx.moveTo(-e.r * .7, -e.r * .55); ctx.lineTo(-e.r * .5, -e.r * 1.3); ctx.lineTo(-e.r * .1, -e.r * .75);
        ctx.moveTo(e.r * .7, -e.r * .55); ctx.lineTo(e.r * .5, -e.r * 1.3); ctx.lineTo(e.r * .1, -e.r * .75);
      }
      ctx.fill();
      if (e.type === 'troll') { // 獠牙
        ctx.fillStyle = flashing ? '#fff4dc' : '#e8e0c8';
        ctx.beginPath(); ctx.moveTo(-e.r * .4, e.r * .35); ctx.lineTo(-e.r * .3, e.r * .75); ctx.lineTo(-e.r * .15, e.r * .4);
        ctx.moveTo(e.r * .4, e.r * .35); ctx.lineTo(e.r * .3, e.r * .75); ctx.lineTo(e.r * .15, e.r * .4); ctx.fill();
      }
    }
    // 眼睛
    ctx.fillStyle = e.boss ? '#ffdf74' : flashing ? '#5a5344' : '#1b2020';
    ctx.beginPath(); ctx.arc(-e.r * .35, -e.r * .2, e.boss ? 4 : 2.5, 0, TAU); ctx.arc(e.r * .35, -e.r * .2, e.boss ? 4 : 2.5, 0, TAU); ctx.fill();
    if (e.type === 'cultist') { ctx.strokeStyle = '#d799e2'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, e.r + 4, e.phase, e.phase + Math.PI * 1.4); ctx.stroke(); }
    ctx.restore();
    if (e.hp < e.maxHp && !e.boss) { ctx.fillStyle = '#14191a'; ctx.fillRect(e.x - e.r, e.y - e.r - 12, e.r * 2, 4); ctx.fillStyle = '#ce6457'; ctx.fillRect(e.x - e.r, e.y - e.r - 12, e.r * 2 * Math.max(0, e.hp / e.maxHp), 4); }
  }

  function drawGem(g) { ctx.save(); ctx.translate(g.x, g.y); ctx.rotate(performance.now() / 700); ctx.shadowBlur = 12; ctx.shadowColor = g.color; ctx.fillStyle = g.color; ctx.beginPath(); ctx.moveTo(0, -g.r * 1.5); ctx.lineTo(g.r, 0); ctx.lineTo(0, g.r * 1.5); ctx.lineTo(-g.r, 0); ctx.closePath(); ctx.fill(); ctx.restore(); }
  function drawZone(z) {
    const a = clamp(z.life / z.maxLife, 0, 1);
    const c1 = z.magma ? '#d84a18' : z.crack ? '#e8a45e' : z.arcane ? '#b7a4f2' : '#9fd4f2';
    const c2 = z.magma ? '#ffb257' : z.crack ? '#f2c98a' : z.arcane ? '#d0c2fa' : '#bfe4f7';
    ctx.save();
    ctx.globalAlpha = (z.magma ? .3 : .13) * a; ctx.fillStyle = c1; ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.fill();
    ctx.globalAlpha = .5 * a; ctx.strokeStyle = c2; ctx.lineWidth = z.magma ? 3 : 2; ctx.setLineDash(z.magma ? [4, 6] : [8, 10]); ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    if (zoneSpineKey(z)) SPINE.drawFx(z, { ctx, x: z.x, y: z.y, size: z.r * 2, fit: 'diameter', alpha: Math.min(.92, a * 1.4) });
    ctx.restore();
  }
  // #50 陷阱绘制：脉冲符文圈
  function drawTrap(tr) {
    const cc = tr.type === 'explosive' ? '#f6a04d' : '#9fe4ff';
    ctx.save();
    ctx.globalAlpha = .55 + Math.sin(performance.now() / 130) * .3;
    ctx.strokeStyle = cc; ctx.lineWidth = 2; ctx.setLineDash([5, 5]);
    ctx.beginPath(); ctx.arc(tr.x, tr.y, tr.r, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = cc; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(tr.type === 'explosive' ? '✸' : '❆', tr.x, tr.y + 5);
    SPINE.drawFx(tr, { ctx, x: tr.x, y: tr.y, size: tr.r * 2, fit: 'diameter', alpha: .82 });
    ctx.restore();
  }
  function drawPet(pt) {
    ctx.save(); ctx.translate(pt.x, pt.y); ctx.globalAlpha = clamp(pt.life, 0, 1) * .92;
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(0, 9, 12, 5, 0, 0, TAU); ctx.fill();
    // 第 10 项：影牙 5 件套「暗影分身」—— 半透明暗影人形
    if (pt.shadow) {
      const a = .55 + Math.sin(pt.phase * 4) * .12;
      ctx.globalAlpha = clamp(pt.life, 0, 1) * a;
      ctx.fillStyle = 'rgba(120,118,190,.85)';
      ctx.beginPath(); ctx.ellipse(0, -6, 11, 17, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(178,176,240,.95)';
      ctx.beginPath(); ctx.arc(0, -24, 8.5, 0, TAU); ctx.fill();
      ctx.fillStyle = '#2a2540';
      ctx.beginPath(); ctx.arc(-3, -25, 1.7, 0, TAU); ctx.arc(3, -25, 1.7, 0, TAU); ctx.fill();
      if (pt.atkAnim > 0) {
        ctx.strokeStyle = 'rgba(200,198,255,.9)'; ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.arc(0, -8, 20, -1.1, 1.1); ctx.stroke();
      }
      ctx.restore();
      return;
    }
    if (SPINE.drawActor(pt, { ctx, flip: game.player.x < pt.x, alpha: clamp(pt.life, 0, 1) * (pt.mirror ? .55 : .92), size: pt.mirror ? 76 : 54 })) { ctx.restore(); return; }
    const sp = ASSETS.get(pt.mirror ? 'mage' : 'wolf');
    if (sp) {
      const s = 34;
      if (game.player.x < pt.x) ctx.scale(-1, 1);
      ctx.drawImage(sp, -s / 2, -s / 2 + Math.sin(pt.phase * 5) * 2, s, s);
      ctx.restore();
      return;
    }
    ctx.fillStyle = '#b9c8d8'; ctx.beginPath(); ctx.arc(0, 0, 10, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-6, -6); ctx.lineTo(-4, -14); ctx.lineTo(-1, -7); ctx.moveTo(6, -6); ctx.lineTo(4, -14); ctx.lineTo(1, -7); ctx.fill();
    ctx.fillStyle = '#7fd4f7'; ctx.beginPath(); ctx.arc(-3.5, -2, 1.8, 0, TAU); ctx.arc(3.5, -2, 1.8, 0, TAU); ctx.fill();
    ctx.restore();
  }
  function drawProjectile(q) {
    ctx.save(); ctx.translate(q.x, q.y);
    const a = q.vx ? Math.atan2(q.vy, q.vx) : 0;
    ctx.rotate(a);
    const sk = q.skill;
    if (['double_shot', 'serpent_sting', 'aimed_shot', 'multi_shot'].includes(sk)
      && SPINE.drawFx(q, { ctx, size: sk === 'aimed_shot' ? 42 : 30, alpha: .95 })) { ctx.restore(); return; }
    if (sk === 'frostbolt') {
      // 寒冰箭：冰晶长箭（亮核 + 冰蓝晕）
      ctx.shadowBlur = 12; ctx.shadowColor = '#9fe4ff';
      ctx.fillStyle = FX.radial(ctx, 'ice_shard', 16, [[0, '#c8f0ff'], [.6, '#9fe4ff'], [1, 'rgba(159,228,255,0)']]);
      ctx.beginPath(); ctx.moveTo(q.r * 2.6, 0); ctx.lineTo(-q.r * .8, q.r * .9); ctx.lineTo(-q.r * 1.9, 0); ctx.lineTo(-q.r * .8, -q.r * .9); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#f2fbff';
      ctx.beginPath(); ctx.moveTo(q.r * 2.3, 0); ctx.lineTo(-q.r, q.r * .32); ctx.lineTo(-q.r, -q.r * .32); ctx.closePath(); ctx.fill();
    } else if (sk === 'fireball') {
      // 火球术：炽热核心 + 脉动光晕
      const fl = 1 + Math.sin(performance.now() / 40 + (q.spin || 0)) * .12;
      ctx.shadowBlur = 18; ctx.shadowColor = '#f2842e';
      ctx.fillStyle = FX.radial(ctx, 'fireball', q.r * 2.4, [[0, '#fff3c4'], [.45, '#f6a04d'], [1, 'rgba(230,90,40,0)']]);
      ctx.beginPath(); ctx.arc(0, 0, q.r * 2.4 * fl, 0, TAU); ctx.fill();
    } else if (sk === 'double_shot' || sk === 'serpent_sting' || sk === 'aimed_shot' || sk === 'multi_shot') {
      // 猎人箭矢：箭杆 + 箭头 + 尾羽
      const len = sk === 'aimed_shot' ? 20 : 14;
      const cc = sk === 'serpent_sting' ? '#9fd86a' : sk === 'aimed_shot' ? '#ffd98a' : '#d4e99b';
      ctx.shadowBlur = 8; ctx.shadowColor = cc;
      ctx.strokeStyle = '#caa36a'; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.moveTo(-len, 0); ctx.lineTo(len * .5, 0); ctx.stroke();
      ctx.fillStyle = cc;
      ctx.beginPath(); ctx.moveTo(len * .5, -3.5); ctx.lineTo(len * 1.1, 0); ctx.lineTo(len * .5, 3.5); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = cc; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(-len, 0); ctx.lineTo(-len - 4, -3); ctx.moveTo(-len, 0); ctx.lineTo(-len - 4, 3); ctx.stroke();
    } else {
      // 默认（奥术飞弹 / 敌方弹幕）：彗星状发光体
      ctx.fillStyle = q.color; ctx.shadowBlur = 12; ctx.shadowColor = q.color;
      ctx.beginPath(); ctx.arc(0, 0, q.r, 0, TAU); ctx.fill();
      if (q.vx) { ctx.strokeStyle = q.color; ctx.globalAlpha = .4; ctx.lineWidth = q.r; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-15, 0); ctx.stroke(); }
    }
    ctx.restore();
  }
  function drawOrb(o) {
    ctx.save(); ctx.translate(o.x, o.y);
    ctx.shadowBlur = 22; ctx.shadowColor = '#9fe4ff';
    ctx.fillStyle = '#bfeaff'; ctx.beginPath(); ctx.arc(0, 0, o.r, 0, TAU); ctx.fill();
    ctx.shadowBlur = 0; ctx.strokeStyle = 'rgba(159,228,255,.6)'; ctx.lineWidth = 2;
    const rot = performance.now() / 260;
    ctx.beginPath(); ctx.arc(0, 0, o.r + 8, rot, rot + Math.PI * 1.2); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, o.r + 14, -rot, -rot + Math.PI * .9); ctx.stroke();
    SPINE.drawFx(o, { ctx, size: 190, fit: 'diameter', alpha: .62 });
    ctx.restore();
  }
  function drawEffect(e) {
    const t = 1 - e.life / e.maxLife; ctx.save(); ctx.globalAlpha = 1 - t;
    if (e.type === 'slash') {
      const a0 = e.a0 ?? -.3;
      ctx.strokeStyle = e.color; ctx.lineWidth = 12 * (1 - t) + 2; ctx.shadowBlur = 10; ctx.shadowColor = e.color;
      ctx.beginPath(); ctx.arc(e.x, e.y, e.maxR * t, a0, a0 + Math.PI * 1.5); ctx.stroke(); ctx.shadowBlur = 0;
    }
    else if (e.type === 'cone') {
      const r = e.maxR * FX.ease.outCubic(t), a0 = e.a0 || 0, half = e.half || .5;
      ctx.fillStyle = e.color; ctx.globalAlpha = (1 - t) * .14;
      ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.arc(e.x, e.y, r, a0 - half, a0 + half); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = (1 - t) * .85; ctx.strokeStyle = e.color; ctx.lineWidth = 3; ctx.shadowBlur = 8; ctx.shadowColor = e.color;
      ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.arc(e.x, e.y, r, a0 - half, a0 + half); ctx.closePath(); ctx.stroke(); ctx.shadowBlur = 0;
    }
    else if (e.type === 'bolt') {
      ctx.strokeStyle = e.color; ctx.lineWidth = (e.w || 3) * (1 - t) + 1; ctx.shadowBlur = 12; ctx.shadowColor = e.color;
      ctx.beginPath(); e.pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke(); ctx.shadowBlur = 0;
    }
    else if (e.type === 'warning') { ctx.strokeStyle = e.color; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(e.x, e.y, e.maxR * t, 0, TAU); ctx.stroke(); }
    else { ctx.fillStyle = e.color; ctx.beginPath(); ctx.arc(e.x, e.y, 28 * (1 - t), 0, TAU); ctx.fill(); }
    ctx.restore();
  }

  let loopErrCount = 0;
  function loop(now) {
    let dt = Math.min((now - last) / 1000, .04); last = now;
    if (game && game.hitStop > 0) { game.hitStop -= dt; dt *= .18; } // 击杀慢镜
    // ★ 结构性防护：单帧异常绝不能杀死 rAF 主循环。
    //   此前 update() 内任何一处抛错都会冒泡出 loop()，导致 requestAnimationFrame(loop)
    //   不再被调度 —— 整个游戏永久冻结（画面定格、DOM 按钮仍可点、但战斗不再推进，
    //   只能刷新浏览器）。这里兜底捕获，保证下一帧继续调度。
    try {
      if (mode === 'playing') update(dt);
      else if (announcementTimer > 0) { announcementTimer -= dt; if (announcementTimer <= 0) ui.announcement.classList.remove('show'); }
      draw();
    } catch (err) {
      // 同一异常每帧都会重复触发（例如 draw() 持续抛错），故做日志节流，避免刷屏
      loopErrCount = (loopErrCount || 0) + 1;
      if (loopErrCount <= 3 || loopErrCount % 60 === 0) console.error('[主循环] 单帧异常已捕获:', err);
      // 选卡/升级弹层若仍有可选项 → 保留原状（玩家仍能正常选择，不吞掉机会）；
      // 若弹层已损坏（渲染中断导致没有任何可点选项）→ 收起并回到 playing，
      // 否则玩家会永远停在暂停态，表现为「战斗卡住且无法重新开始」。
      const brokenModal =
        (mode === 'gearpick' && !ui['gear-cards'].children.length) ||
        (mode === 'levelup' && !ui['upgrade-cards'].children.length) ||
        (game && game.tdCoreOpen && TDu.coreCards && !TDu.coreCards.children.length);
      if (brokenModal) {
        mode = 'playing';
        for (const id of ['gearpick', 'levelup', 'td-core']) { ui[id].classList.add('hidden'); ui[id].classList.remove('active'); }
        if (game) { game.gearPickOpen = false; game.gearPending = null; game.levelupOpen = false; game.tdCoreOpen = false; }
        toast('战斗出现异常，已自动恢复', '#ffb257');
      }
    }
    requestAnimationFrame(loop);
  }


  // ===== 事件绑定 =====
  ui.heroes.addEventListener('click', e => {
    const card = e.target.closest('.hero'); if (!card) return;
    selectedHero = card.dataset.hero;
    document.querySelectorAll('.hero').forEach(el => el.classList.toggle('selected', el === card));
  });
  // #51 联机结算后返回房间大厅（由房主重新开局），单机照旧
  const afterResult = () => { if (NET.connected && NET.room) openLobby(); else showMenu(); };
  ui.start.addEventListener('click', newGame);
  ui.retry.addEventListener('click', () => { if (NET.connected && NET.room) { toast('等待房主重新开局'); openLobby(); } else newGame(); });
  ui['result-menu'].addEventListener('click', afterResult);
  ui['menu-home'].addEventListener('click', showHome);
  ui['nav-adventure'].addEventListener('click', () => { pendingDungeon = null; pendingMode = null; showModeChoice('home'); }); // #51 先选单人/组队
  ui['nav-dungeons'].addEventListener('click', () => { pendingMode = null; openDungeons(); });
  // ★ 塔防模式入口
  ui['nav-td'].addEventListener('click', () => { pendingDungeon = null; pendingMode = 'td'; showModeChoice('home'); });
  ui['dungeons-back'].addEventListener('click', showHome);
  // 熔火之心团本：掉落结算页聊天框 + 关闭按钮
  ui['raid-chat-send'].addEventListener('click', () => {
    const txt = (ui['raid-chat-input'].value || '').trim();
    if (!txt || !game.raidLoot) return;
    ui['raid-chat-input'].value = '';
    if (raidIsHost()) raidHostChat(raidSelfId(), txt);
    else NET.sendEv({ k: 'raidChat', text: txt });
  });
  ui['raid-chat-input'].addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); ui['raid-chat-send'].click(); }
  });
  ui['raid-close'].addEventListener('click', () => {
    // 全部放弃并离开：主机需结算剩余物品，客户端直接离开
    const L = game.raidLoot;
    if (L && raidIsHost()) {
      const now = Date.now();
      for (let i = 0; i < L.items.length; i++) {
        if (L.resolved[i]) continue;
        L.states[i] = L.states[i] || {};
        for (const pid of L.roster) if (!L.states[i][pid]) L.states[i][pid] = 'pass';
        raidResolveItem(i);
      }
      L.closeAt = Math.min(L.closeAt || now + 3000, now + 800);
      raidBroadcast();
    }
    closeRaidLoot();
  });
  // 副本页双 Tab：地下城副本 / 团队副本
  ui['dg-tabs'].addEventListener('click', e => {
    const tab = e.target.closest('.dg-tab'); if (!tab) return;
    dungeonTab = tab.dataset.tab === 'raid' ? 'raid' : 'dungeon';
    renderDungeons();
  });
  ui['nav-trainer'].addEventListener('click', openTrainer);
  ui['nav-profession'].addEventListener('click', openProfession);
  ui['bag-toggle'].addEventListener('click', openBag);
  ui['bag-close'].addEventListener('click', closeBag);
  ui['prof-back'].addEventListener('click', showHome);
  ui['achv-toggle'].addEventListener('click', openAchievements);
  ui['achv-back'].addEventListener('click', showHome);
  ui['achv-tabs'].addEventListener('click', e => {
    const tab = e.target.closest('.achv-tab'); if (!tab) return;
    achvFilter = tab.dataset.filter; renderAchievements();
  });
  ui['prof-list'].addEventListener('click', e => {
    // 第 18 项：移除「学习专业」按钮的处理（专业默认已学习，只有图纸研习要花金币）
    const gl = e.target.closest('.recipe-learn');
    if (gl) { if (!gl.disabled) learnGear(gl.dataset.gear); return; }
    const row = e.target.closest('.recipe-row'); // #45 点击图样行查看装备/套装详情
    if (row?.dataset.gear) openGearDetail(row.dataset.gear);
  });
  ui['gd-close'].addEventListener('click', closeGearDetail);
  ui['gear-detail'].addEventListener('click', e => { if (e.target === ui['gear-detail']) closeGearDetail(); });
  ui['gr-discard'].addEventListener('click', () => { if (mode === 'gearpick' || game?.gearPickOpen) closeGearPick(false); });
  ui['char-tabs'].addEventListener('click', e => {
    const tab = e.target.closest('.char-tab'); if (!tab) return;
    bagClass = tab.dataset.class; renderBag();
  });
  ui['eq-potion'].addEventListener('click', () => { if (save.potion) { save.potion = null; persist(); renderBag(); toast('已取消药水配置'); } });
  ui['bag-grid'].addEventListener('click', e => {
    const slot = e.target.closest('.bag-slot');
    if (!slot || slot.dataset.index === undefined) { if (!e.target.closest('#item-menu')) closeItemMenu(); return; }
    const r = slot.getBoundingClientRect();
    openItemMenu(r.left + r.width / 2, r.bottom + 6, Number(slot.dataset.index));
  });
  ui['bag-grid'].addEventListener('contextmenu', e => {
    // 右键同样打开操作菜单（含出售选项）
    const slot = e.target.closest('.bag-slot');
    if (!slot || slot.dataset.index === undefined) return;
    e.preventDefault();
    const r = slot.getBoundingClientRect();
    openItemMenu(r.left + r.width / 2, r.bottom + 6, Number(slot.dataset.index));
  });
  document.addEventListener('click', e => { if (!e.target.closest('#item-menu')) closeItemMenu(); });
  ui['trainer-tabs'].addEventListener('click', e => {
    const tab = e.target.closest('.trainer-tab'); if (!tab) return;
    trainerClass = tab.dataset.class; renderTrainer();
  });
  for (const [el, kind] of [[ui['equip-basic'], 'basic'], ...ACTIVE_SLOTS.map(sl => [ui['equip-' + sl.key], sl.key])]) {
    if (!el) continue;
    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      if (!save.equipped[trainerClass][kind]) return;
      save.equipped[trainerClass][kind] = null; persist(); renderTrainer();
    });
  }
  ui['trainer-back'].addEventListener('click', showHome);
  ui.pause.addEventListener('click', togglePause);
  ui.resume.addEventListener('click', togglePause);
  ui['restart-pause'].addEventListener('click', () => {
    if (game?.coop) { toast('联机对局无法单人重开'); togglePause(); return; } // #51
    newGame();
  });
  ui.quit.addEventListener('click', () => {
    // #51 联机中途退出：主机退则宣告失败，客户端标记倒下
    if (game?.coop) {
      if (game.coop.host) { endGame(false, '房主离开了战斗'); }
      else if (!game.player.downed) NET.sendEv({ k: 'died' });
      game = null; openLobby(); return;
    }
    showMenu();
  });

  // ===== #51 联机 UI 绑定与网络事件 =====
  ui['mc-back'].addEventListener('click', () => { mcOrigin === 'dungeons' ? openDungeons() : showHome(); });
  ui['mc-solo'].addEventListener('click', showMenu);
  ui['mc-multi'].addEventListener('click', openRooms);
  ui['rooms-back'].addEventListener('click', () => showModeChoice(mcOrigin));
  ui['room-refresh'].addEventListener('click', () => NET.listRooms());
  ui['room-create'].addEventListener('click', () => {
    const name = (ui['player-name'].value || '').trim();
    // 熔火之心为团队副本：房间 mode 传 'raid'，服务端会强制 4 人才能开局
    // ★ 塔防模式也要能联机（最多 4 人，各守一条路）→ mode 传 'td'
    const roomMode = pendingMode === 'td' ? 'td'
      : (pendingDungeon && DUNGEONS[pendingDungeon]?.type === 'raid' ? 'raid' : pendingDungeon ? 'dungeon' : 'adventure');
    NET.createRoom(name ? `${name}的房间` : '', roomMode, pendingDungeon, myLobbyHero || selectedHero);
  });
  ui['lobby-back'].addEventListener('click', () => { NET.leaveRoom(); showModeChoice(mcOrigin); });
  ui['lobby-heroes'].addEventListener('click', e => {
    const b = e.target.closest('.lobby-hero'); if (!b) return;
    // #53 已准备也可换职业（服务器自动取消准备）
    myLobbyHero = b.dataset.hero; NET.setHero(myLobbyHero);
  });
  ui['lobby-ready'].addEventListener('click', () => {
    const mePl = NET.room?.players.find(p => p.id === NET.myId);
    if (mePl) NET.setReady(!mePl.ready);
  });
  ui['lobby-start'].addEventListener('click', () => NET.startGame());

  NET.on('rooms', m => { if (ui.rooms.classList.contains('active')) renderRooms(m.rooms); });
  NET.on('joined', openLobby);
  NET.on('update', () => { if (ui.lobby.classList.contains('active')) renderLobby(); });
  NET.on('left', () => { if (ui.lobby.classList.contains('active')) showModeChoice(mcOrigin); });
  NET.on('error', m => toast(m.msg || '网络错误'));
  NET.on('closed', m => {
    toast(m.reason || '房间已解散');
    if (game && mode !== 'result') endGame(false, m.reason || '房主离开了房间');
    showHome();
  });
  NET.on('disconnect', () => {
    if (game?.coop && mode !== 'result') { toast('与主机断开连接'); endGame(false, '与主机断开连接'); }
    // #65 断线前把最后进度推给主机存档中心，避免丢失
    if (centerKey) pushCenterNow();
    setSaveNamespace(null); // #52 断线回到本机默认存档
  });
  NET.on('started', () => {
    const mePl = NET.room?.players.find(p => p.id === NET.myId);
    if (mePl) selectedHero = mePl.hero;
    // 'dungeon' 与 'raid' 都带副本 id；'adventure' 为无尽；'td' 为塔防
    const roomMode = NET.room?.mode;
    pendingDungeon = (roomMode === 'dungeon' || roomMode === 'raid') ? NET.room.dungeon : null;
    // ★ 塔防：必须按房间 mode 兜底设置 pendingMode。
    //   否则「从房间列表直接加入」（没走 nav-td 入口）的客户端 pendingMode 仍是 null
    //   → newGame() 里 gameMode 判成 'adventure' → 塔防不初始化，两人玩的是两种游戏。
    pendingMode = roomMode === 'td' ? 'td' : null;
    newGame();
  });
  NET.on('ev', m => hostOnEvent(m.from, m.data));
  NET.on('snap', m => clientOnSnap(m.data));
  NET.on('fx', m => renderAllySkillFx(m.from, m.data)); // #54 队友技能真实弹道
  NET.on('ann', m => { if (game) announce(m.data.text, m.data.color, m.data.s); });
  NET.on('end', m => { if (game && mode !== 'result' && !game.coop?.host) endGame(m.data.victory, m.data.reason, m.data.raid); });
  try { ui['player-name'].value = localStorage.getItem('azs-name') || ''; } catch { }

  addEventListener('keydown', e => {
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();
    // ★ 塔防模式：方向键 = 传送阵之间瞬移（不能自由移动）；空格 = 回到自己视角
    //   用户口径：「按空格或方向键回到自己视角」→ 正在看队友时，方向键优先用于「回自己」，
    //   否则方向键才是传送。两种操作不会打架。
    if (game?.gameMode === 'td') {
      const dir = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[e.code];
      if (dir) { if (TDR.viewPad) tdSetView(null); else tdTeleport(dir); return; }
      if (e.code === 'Space') { if (TDR.viewPad) tdSetView(null); else dash(); return; }
    }
    keys.add(e.code);
    if (e.code === 'Space') dash();
    // 第 20 项：主动技能 4 槽位 → Q / R / C / V
    if (ACTIVE_HOTKEYS[e.code]) castActive(ACTIVE_HOTKEYS[e.code]);
    if (e.code === 'KeyE') usePotion();
    if (e.code === 'KeyF') startRevive(); // 第 11 项：战复
    if (e.code === 'Escape' || e.code === 'KeyP') togglePause();
    // #52 联机选卡中（战斗未暂停）同样支持数字键快速选择
    // 装备栏已满的双排模式下分两段：阶段一 Digit1~3 选上排新装备，阶段二 Digit1~5 选下排替换目标
    const gearPicking = (mode === 'gearpick' || game?.gearPickOpen) && ui['gear-slots'].classList.contains('picking');
    if (gearPicking && ['Digit1','Digit2','Digit3','Digit4','Digit5'].includes(e.code)) {
      ui['gear-slot-cards'].children[Number(e.code.slice(-1)) - 1]?.click();
    } else if ((mode === 'levelup' || mode === 'gearpick' || game?.levelupOpen || game?.gearPickOpen) && ['Digit1','Digit2','Digit3'].includes(e.code)) {
      const i = Number(e.code.slice(-1)) - 1;
      (game?.gearPickOpen || mode === 'gearpick' ? ui['gear-cards'] : ui['upgrade-cards']).children[i]?.click();
    }
  });
  addEventListener('keyup', e => keys.delete(e.code));
  addEventListener('blur', () => { keys.clear(); if (mode === 'playing' && !game?.coop) togglePause(); }); // #52 联机不因失焦暂停

  // ===== 移动端摇杆（跟随模式）已移交 mobile.js =====
  // 移动端改为「按到哪里哪里就是摇杆」（左半屏任意处按下即就地生成），
  // 由独立文件 mobile.js 实现 —— 与塔防模式零耦合，塔防任务可继续改本文件。
  // 桌面端仍用键盘方向键，故此处的固定摇杆绑定不再需要。
  // ★ 旧的固定摇杆事件绑定（joyMove / pointerdown / pointerup）已删除：
  //   若保留会与 mobile.js 的跟随摇杆双写 joy.x/joy.y → 方向互相覆盖、角色乱抖。
  ui['mobile-dash'].addEventListener('pointerdown', e => { e.preventDefault(); dash(); });
  ui['mobile-active'].addEventListener('pointerdown', e => { e.preventDefault(); castActive(1); });
  ui['mobile-active2'].addEventListener('pointerdown', e => { e.preventDefault(); castActive(2); });
  ui['mobile-active3'].addEventListener('pointerdown', e => { e.preventDefault(); castActive(3); });
  ui['mobile-active4'].addEventListener('pointerdown', e => { e.preventDefault(); castActive(4); });
  ui['mobile-pot'].addEventListener('pointerdown', e => { e.preventDefault(); usePotion(); });
  ui['mobile-revive'].addEventListener('pointerdown', e => { e.preventDefault(); startRevive(); }); // 第 11 项
  // ★ 塔防：画布点阵位传送 + 拖动平移视角（桌面鼠标与移动端触屏通用）
  canvas.addEventListener('pointerdown', tdCanvasPointerDown);
  canvas.addEventListener('pointermove', tdCanvasPointerMove);
  canvas.addEventListener('pointerup', tdCanvasPointerUp);
  canvas.addEventListener('pointercancel', () => { TDR.drag = null; });

  // ★ 塔防：战术指令按钮（集火 / 清场 / 斩首 / 守序）+ 突进 / 闪现
  for (const el of document.querySelectorAll('.td-cmd')) {
    el.addEventListener('click', () => {
      const cmd = el.dataset.cmd;
      if (cmd === 'advance') { tdTeleport('up'); return; }     // 突进 = 向上一阵位
      if (cmd === 'blink') {                                     // 闪现 = 跳到最近的可传送邻接
        if (!TDR.node) return;
        const nb = tdNeighbors(TDR.node);
        const cand = nb.right || nb.left || nb.down || nb.up;
        if (cand) { TDR.tpCd = 0; tdTeleport(cand === nb.right ? 'right' : cand === nb.left ? 'left' : cand === nb.down ? 'down' : 'up'); }
        return;
      }
      tdSetCommand(cmd);
    });
  }
  // ★ 塔防：局内核心弹层的「放弃」按钮
  const tdCoreSkip = $('td-core-skip');
  if (tdCoreSkip) tdCoreSkip.addEventListener('click', () => { if (game?.tdCoreOpen) tdSkipCore(); });
  // ★ 塔防：小地图点击（移动端主要交互）
  if (TDu.minimapCv) TDu.minimapCv.addEventListener('pointerdown', e => { e.preventDefault(); tdMinimapClick(e); });
  // 调试入口：window.game 可查看战局
  Object.defineProperty(window, 'game', { get: () => game });
  // ★ 塔防调试入口（供 e2e 验收读取状态 / 触发动作）
  Object.defineProperty(window, '__td', { get: () => ({
    on: TDR.on, wave: TDR.wave, leaks: TDR.leaks, leakLimit: TDR.leakLimit,
    lanes: TDR.lanes, node: TDR.node?.id, seq: TDR.node?.seq, quad: TDR.node?.quad,
    cmd: TDR.cmd, reach: tdReach(), tpCd: TDR.tpCd, cover: TDR.coverN,
    camOff: { x: TDR.camOff.x, y: TDR.camOff.y }, camFree: TDR.camFree,
    cores: (game?.tdCores || []).map(c => c.id + ':' + c.lvl),
    guards: TDR.guards.length, enemies: game?.enemies?.filter(e => !e.dead).length || 0,
    guardPending: TDR.guardPending ? { kind: TDR.guardPending.kind, count: TDR.guardPending.count, name: TDR.guardPending.name, t: Math.ceil(TDR.guardPending.t) } : null,
    guardList: TDR.guards.map(g => ({ kind: g.kind, padId: g.padId, x: g.x, y: g.y, range: g.range })),
    level: game?.player?.level || 0, xp: game?.player?.xp || 0, nextXp: game?.player?.nextXp || 0,
    pendingLevels: game?.pendingLevels || 0, gearDrops: game?.gearDrops || 0,
    mode: mode, gameMode: game?.gameMode,
    // ★ 联机：队友阵位 / 队友守卫 / 带路径信息的敌人数（联机 TD 同步验收用）
    allyNodes: game?.allies ? [...game.allies.values()].map(a => ({ id: a.id, hero: a.hero, node: a.tdNode || '', x: a.x | 0, y: a.y | 0 })) : [],
    allyGuards: TDR.allyGuards.length,
    tdEnemies: game?.enemies?.filter(e => !e.dead && e.tdLane).length || 0,
    // ★ 联机 TD：客户端的出怪队列必须恒空（客户端不推进波次；非空 = 两端各刷一份 → 怪物翻倍）
    queue: TDR.queue.length,
    coopHost: !!(game?.coop?.host),
    playerCount: game?.playerCount || 1
  }) });
  Object.defineProperty(window, '__tdTeleport', { value: (dir) => tdTeleport(dir) });
  Object.defineProperty(window, '__tdCommand', { value: (c) => tdSetCommand(c) });
  // ★ 验收探针：造一只「打不死」的 TD 怪，用来稳定观测「沿路径行进」与「伤害为 0」。
  //   （普通怪会被英雄秒掉，脚本两次采样之间就找不到活怪了。）
  Object.defineProperty(window, '__tdSpawnProbe', { value: (lane) => {
    if (!TDR.on) return null;
    const e = tdSpawnEnemy(lane || TDR.lanes[0], 'normal', false);
    e.hp = e.maxHp = 1e9; e.probe = true; e.speed = 60; e.name = '探针怪';
    return e.nid;
  } });
  Object.defineProperty(window, '__tdEnemy', { value: (nid) => {
    const e = game?.enemies?.find(x => x.nid === nid);
    return e ? { nid: e.nid, lane: e.tdLane, t: e.tdT, dist: e.tdDist, hp: e.hp, damage: e.damage, x: e.x, y: e.y, dead: !!e.dead } : null;
  } });
  // ★ 验收：强制掉一个局内核心（模拟击杀掉落）
  Object.defineProperty(window, '__tdDropCore', { value: () => {
    if (!game) return 0;
    game.tdCoreDrops = (game.tdCoreDrops || 0) + 1;
    return game.tdCoreDrops;
  } });
  Object.defineProperty(window, '__tdCores', { get: () => (game?.tdCores || []).map(c => ({ id: c.id, lvl: c.lvl })) });
  Object.defineProperty(window, '__tdStart', { value: () => { pendingMode = 'td'; pendingDungeon = null; newGame(); } });
  // ★ 验收：读取当前场上的 BOSS（波次 BOSS）
  Object.defineProperty(window, '__tdBoss', { get: () => {
    const e = game?.enemies?.find(x => x.tdBoss && !x.dead);
    return e ? { nid: e.nid, name: e.name, label: e.tdBoss.label, hp: e.hp, maxHp: e.maxHp,
      r: e.r, lane: e.tdLane, t: e.tdT, boss: !!e.boss, spine: e.spine || null } : null;
  } });
  // ★ 验收：跳到指定波次（用于验证 BOSS 波 / 尾王结算）
  Object.defineProperty(window, '__tdSetWave', { value: (n) => {
    if (!TDR.on) return 0;
    const target = Math.max(1, Math.min(TD.WAVES.total, n | 0));
    TDR.queue.length = 0;
    for (const e of game.enemies) if (e.tdLane) e.dead = true;   // 清场，避免旧波次残留
    TDR.wave = target - 1;
    TDR.waveT = TDR.waveLen - .05;
    return target;
  } });
  // ★ 验收：强制击杀当前 BOSS（验证尾王 → 通关判定）
  Object.defineProperty(window, '__tdKillBoss', { value: () => {
    const e = game?.enemies?.find(x => x.tdBoss && !x.dead);
    if (!e) return null;
    damageEnemy(e, e.hp + 1, 0, 'td_probe');
    return e.name;
  } });
  // ★ 验收：立刻结束当前波次（推进到下一波 / 触发尾王等待判定）
  Object.defineProperty(window, '__tdFinishWave', { value: () => {
    if (!TDR.on) return 0;
    TDR.waveT = TDR.waveLen;
    return TDR.wave;
  } });
  // ★ 验收：进入守卫放置模式（等价于抽到一张守卫卡）
  Object.defineProperty(window, '__tdRequestGuard', { value: (kind, count) => {
    if (!TDR.on) return null;
    tdRequestGuard(game.player, kind || 'turret', count || 1);
    return TDR.guardPending ? { ...TDR.guardPending } : null;
  } });
  // ★ 验收：把守卫直接落到指定阵位（绕过放置模式）
  Object.defineProperty(window, '__tdPlaceGuard', { value: (padId, kind, count) => {
    if (!TDR.on) return false;
    const n = TD.NODE_BY_ID.get(padId);
    if (!n) return false;
    return tdPlaceGuard(kind || 'turret', n, count || 1);
  } });
  // ★ 验收：在指定阵位点击（模拟真实点击路径：画布命中判定 → 放置守卫 → 否则传送）
  Object.defineProperty(window, '__tdClickPad', { value: (padId) => {
    if (!TDR.on) return { placed: false, reason: 'not-on' };
    const n = TD.NODE_BY_ID.get(padId);
    if (!n) return { placed: false, reason: 'no-node' };
    if (tdTryPlaceGuardAt(n)) return { placed: true, padId };
    return { placed: false, reason: 'no-pending' };
  } });
  // ★ 验收：守卫放置模式超时（推进剩余秒数）
  Object.defineProperty(window, '__tdTickGuardPending', { value: (dt) => {
    if (!TDR.on || !TDR.guardPending) return null;
    tdUpdateGuardPending(dt);
    return TDR.guardPending ? { ...TDR.guardPending } : null;
  } });
  // ★ 验收（联机 TD）：强制漏怪 —— 把一只 TD 怪推到路径终点，触发主机权威的漏怪计数。
  //   只在主机调用；客户端的漏怪数应通过快照同步（两端必须一致）。
  Object.defineProperty(window, '__tdForceLeak', { value: () => {
    if (!TDR.on) return 0;
    const e = game.enemies.find(x => !x.dead && x.tdLane);
    if (!e) return 0;
    e.tdDist = 1e9;
    return e.nid;
  } });
  // 调试入口：window.__mode 暴露当前 UI 模式（验收脚本判断是否处于 playing）
  Object.defineProperty(window, '__mode', { get: () => mode });
  // #65 调试入口：window.__endRun 触发结算（供自动化验收走完整 endGame 路径）
  Object.defineProperty(window, '__endRun', { value: (victory, reason) => endGame(victory !== false, reason || '验收测试结算') });
  // 第 6 项调试入口：window.__gainXp 模拟队友战斗带来的击杀经验广播（验证倒地后不再弹卡牌）
  Object.defineProperty(window, '__gainXp', { value: (v) => gainXp(v | 0) });
  // 验收钩子：精确挂起一级升级并立即弹出升级弹层（__gainXp(大数) 会连升几十级，
  //   弹层永远关不完 → 收尾时回不到 playing 态）
  Object.defineProperty(window, '__openLevelUp', { value: () => { game.pendingLevels = 1; openLevelUp(); return true; } });
  // 第 9/10/11 项调试入口（供自动化验收读取设计数据与触发真实战斗路径）
  Object.defineProperty(window, '__design', { value: () => ({ dungeons: DUNGEONS, roster: BOSS_ROSTER, bossTimes: DUNGEON_BOSS_TIMES, achv: ACHIEVEMENTS, setSlots: SET_SLOTS }) });
  // ===== 熔火之心团本橙装验收入口 =====
  // 装备指定熔火橙装（走真实装备路径 applyGearFx），并可指定已强化的卡牌等级
  Object.defineProperty(window, '__equipMolten', { value: (gid, molten) => {
    const g = game; if (!g) return false;
    const key = gid || (g.player.type === 'mage' ? 'mage_sulfuras' : g.player.type === 'hunter' ? 'hunter_sulfuras' : 'warrior_sulfuras');
    const ge = GEAR[key]; if (!ge || !ge.fx?.moltenCore) return false;
    const old = g.gear.find(c => c.id === key);
    if (old) g.gear.splice(g.gear.indexOf(old), 1);
    g.gear.push({ id: key, lvl: 1, molten: { ...(molten || {}) } });
    recomputePlayer(); // 重建玩家数值，避免重复叠加装备效果
    return { id: key, gearFx: { ...g.player.gearFx } };
  } });
  // 读取熔火之心当前参数 + 强化卡等级
  Object.defineProperty(window, '__molten', { value: () => {
    const g = game; if (!g) return null;
    const e = moltenGearEntry(g.player);
    const mp = moltenParams(g.player);
    return { has: !!e, gearId: e?.id || null, molten: e?.molten || null, params: mp,
      cards: MOLTEN_CARDS.map(c => ({ id: c.id, name: c.name, max: c.max, lvl: e?.molten?.[c.id] || 0, desc: c.desc })) };
  } });
  // 强制在指定位置触发一次熔火之心岩浆池（验证首击/持续/燃烧与区域生成）
  Object.defineProperty(window, '__moltenPool', { value: (x, y) => {
    const g = game; if (!g) return false;
    const p = g.player;
    const tx = x ?? p.x + 60, ty = y ?? p.y;
    spawnMoltenPool(tx, ty, p);
    const z = g.zones[g.zones.length - 1];
    return { zones: g.zones.length, zone: z ? { r: z.r, life: z.life, dmg: z.dmg, burn: z.burn, magma: !!z.magma, spine: z.spine } : null };
  } });
  // 强制刷出一次熔火强化卡（走真实 openGearPick 路径）
  // 用法：__moltenPick(true) → 装备卡浮层出现且必含 1 张熔火强化卡
  Object.defineProperty(window, '__moltenPick', { value: (force) => {
    const g = game; if (!g) return false;
    if (!moltenGearEntry(g.player)) return false;
    forceMoltenPick = !!force;
    openGearPick();
    forceMoltenPick = false;
    return true;
  } });
  // 读取当前装备卡浮层里的候选（用于验收断言卡牌构成）
  Object.defineProperty(window, '__gearPicks', { value: () => {
    const cards = [...document.querySelectorAll('#gear-cards .upgrade')];
    return cards.map(c => ({ name: c.querySelector('strong')?.textContent.trim(), type: c.querySelector('.up-type')?.textContent.trim(), desc: c.querySelector('p')?.textContent.trim() }));
  } });
  // 读取装备库条目（验收用：核对橙装数值与图纸条目）
  Object.defineProperty(window, '__gearInfo', { value: (gid) => {
    const g = GEAR[gid]; if (!g) return null;
    return { id: gid, name: g.name, cls: g.cls, rarity: g.rarity, plan: g.plan || null, dungeon: g.dungeon || null,
      desc: g.desc, fx: { ...g.fx }, spec: g.spec ? { ...g.spec } : null, fxText: fxDesc(g.fx) };
  } });
  // 读取道具库条目（图纸）
  Object.defineProperty(window, '__itemInfo', { value: (id) => {
    const it = ITEMS[id]; if (!it) return null;
    return { id, name: it.name, kind: it.kind, gearId: it.gearId || null, sell: it.sell || 0, desc: it.desc };
  } });
  // 研习装备图样（验收用：直接写入已研习列表）
  Object.defineProperty(window, '__learnGear', { value: (gid) => {
    if (!GEAR[gid]) return false;
    if (!save.gearLearned.includes(gid)) save.gearLearned.push(gid);
    persist(); return true;
  } });
  // 只在内存里研习、不落盘（线上只读验收用 —— 避免改动真实存档）
  Object.defineProperty(window, '__learnGearMem', { value: (gid) => {
    if (!GEAR[gid]) return false;
    if (!save.gearLearned.includes(gid)) save.gearLearned.push(gid);
    return true;
  } });
  // 直接设置当前装备栏（验收用：验证「装备栏已满」时的双排替换流程）
  Object.defineProperty(window, '__setGear', { value: (ids) => {
    const g = game; if (!g) return null;
    g.gear = (ids || []).filter(id => GEAR[id]).map(id => ({ id, lvl: 1 }));
    recomputePlayer();
    return g.gear.map(c => ({ id: c.id, lvl: c.lvl }));
  } });
  Object.defineProperty(window, '__killEnemy', { value: (n = 1) => {
    // 在玩家身边生成 n 个小怪并走真实 killEnemy 路径（验证无尽模式不产装备/金币）
    const g = game; if (!g) return 0;
    const p = g.player; let made = 0;
    for (let i = 0; i < n; i++) {
      const e = spawnEnemy();
      if (!e) continue;
      e.x = p.x + rand(-40, 40); e.y = p.y + rand(-40, 40); e.hp = 1; e.maxHp = 1;
      damageEnemy(e, 99999, 0, 'basic'); made++;
    }
    return made;
  } });
  Object.defineProperty(window, '__startRevive', { value: () => startRevive() });
  // 用指定来源击杀敌人（走真实 killEnemy 路径，验收击杀联动如 ch_reset）
  Object.defineProperty(window, '__killAs', { value: (by = 'basic', n = 1) => {
    const g = game; if (!g) return 0;
    const p = g.player; let made = 0;
    for (let i = 0; i < n; i++) {
      const e = spawnEnemy();
      if (!e) continue;
      e.x = p.x + rand(-40, 40); e.y = p.y + rand(-40, 40); e.hp = 1; e.maxHp = 1;
      damageEnemy(e, 99999, 0, by); made++;
    }
    return made;
  } });
  // 熔火之心团本调试入口：模拟通关 → 掉落 Roll 结算页（单机 / 联机均可验收）
  // 注意：真实链路是 endGame() → mode='result' → openRaidLoot()，
  // 这里在无对局时补一份最小上下文并把 mode 冻结在 'result'，保证结算页期间战斗不再推进。
  Object.defineProperty(window, '__raidLoot', { value: (items) => {
    if (!game) { pendingDungeon = 'moltencore'; newGame(); mode = 'result'; }
    if (!items) items = raidLootPool();
    game.gameMode = 'dungeon'; game.dungeon = DUNGEONS.moltencore; game.dungeonId = 'moltencore';
    openRaidLoot(items);
    return items;
  } });
  Object.defineProperty(window, '__raidState', { value: () => {
    const L = game?.raidLoot; if (!L) return null;
    return { items: L.items, states: L.states, rolls: L.rolls, winners: L.winners, resolved: L.resolved,
      chat: L.chat, roster: L.roster, remain: L.remain, myState: L.myState };
  } });
  // 第 10 项调试入口：直接走 killEnemy 击杀当前首领（验证副本通关链路）
  Object.defineProperty(window, '__killBoss', { value: () => {
    const g = game; if (!g) return false;
    const e = g.enemies.find(x => x.boss && !x.dead);
    if (!e) return false;
    e.killedBy = 'test'; killEnemy(e); return true;
  } });

  // ===== 需求 12/13 验收钩子 =====
  // 第 16/18/20/21 项验收钩子：
  //   __gearAvail   —— 当前玩家可掉落的装备候选（严格以 save.gearLearned 为准）
  //   __profState   —— 专业熟练度与图纸研习状态
  //   __equipSlots  —— 存档中该职业的 1 基础 + 4 主动槽位
  //   __upgradePool —— 全部升级卡的 id/name/职业限制（用于校验专属卡）
  Object.defineProperty(window, '__gearAvail', { value: () => {
    const g = game; if (!g) return null;
    const p = g.player;
    return Object.keys(GEAR).filter(gid => {
      const ge = GEAR[gid];
      if (ge.cls !== p.type || g.gear.some(c => c.id === gid)) return false;
      return save.gearLearned.includes(gid);
    });
  } });
  Object.defineProperty(window, '__profState', { value: () => ({
    professions: { ...save.professions }, gold: save.gold,
    learned: save.gearLearned.slice() }) });
  Object.defineProperty(window, '__equipSlots', { value: (cls) => {
    const c = cls || game?.player?.type; if (!c) return null;
    return { ...save.equipped[c] };
  } });
  // __upgradePool —— 全部升级卡的 id/name/职业限制（用于校验专属卡）
  //   传入 cls 时返回该职业「实际可见」的卡池（与 openLevelUp 的 available 过滤等价）。
  Object.defineProperty(window, '__upgradePool', { value: (cls) => {
    const list = upgradePool.map(u => ({
      id: u.id, name: u.name, type: u.type, cls: u.cls || null,
      mageOnly: !!u.available && u.available({ type: 'mage' }) && !u.available({ type: 'hunter' }),
      _available: u.available || null
    }));
    if (!cls) return list.map(({ _available, ...rest }) => rest);
    const p = (game?.player && game.player.type === cls) ? game.player : { type: cls, mods: {}, skillBasic: null, skillActive: null };
    return list.filter(u => !u._available || u._available(p)).map(({ _available, ...rest }) => rest);
  } });
  Object.defineProperty(window, '__openDungeonReward', { value: () => {
    openDungeonReward();
    return { cards: [...document.querySelectorAll('#reward-cards > *')].length };
  } });
  // 读取当前职业的技能与卡牌定义（验收卡牌数值/描述/联动条件）
  Object.defineProperty(window, '__skillDefs', { value: (cls) => {    const list = SKILLS[cls || game?.player?.type]; if (!list) return null;
    return list.map(s => ({ id: s.id, kind: s.kind, name: s.name, cd: s.cd ?? null,
      desc: s.desc, mods: (s.mods || []).map(m => ({ id: m.id, name: m.name, rar: m.rar, max: m.max || 1,
        desc: m.desc, req: m.req || null, reqSkill: m.reqSkill || null })) }));
  } });
  // 读取玩家当前数值与卡牌等级（验收卡牌效果）
  Object.defineProperty(window, '__playerState', { value: () => {
    const g = game; if (!g) return null;
    const p = g.player;
    return { type: p.type, skillBasic: p.skillBasic, skillActive: p.skillActive, skillActive2: p.skillActive2,
      skillActive3: p.skillActive3, skillActive4: p.skillActive4,
      damage: p.damage, range: p.range, attackRange: attackRange(p), rate: p.rate, attackRate: attackRate(p),
      crit: p.crit, hp: p.hp, maxHp: p.maxHp, rapidT: p.rapidT, mods: { ...p.mods },
      pets: g.pets.filter(pt => pt.beast).map(pt => ({ dmg: pt.dmg, atkRate: pt.atkRate, range: pt.range, bleed: pt.bleed,
        auraT: pt.auraT, auraDmg: pt.auraDmg, auraRate: pt.auraRate, auraLeap: pt.auraLeap })),
      petCount: g.pets.filter(pt => pt.beast).length };
  } });
  // 配置出战药水（验收用：验证移动端药水按钮的显隐与布局）
  Object.defineProperty(window, '__setPotion', { value: (id) => { save.potion = id || null; updateHUD(); return save.potion; } });
  // 直接设置卡牌等级（验收用），并立即刷新兽群
  Object.defineProperty(window, '__setMods', { value: (obj) => {
    const g = game; if (!g) return false;
    Object.assign(g.player.mods, obj || {});
    refreshBeastKing();
    return { ...g.player.mods };
  } });
  // 施放主动技能（验收用，走真实 castActive 路径；先切到指定技能再释放）
  Object.defineProperty(window, '__cast', { value: (sid, which) => {
    const g = game; if (!g) return false;
    const w = which || 1;
    const p = g.player;
    const slot = ACTIVE_SLOTS[w - 1] || ACTIVE_SLOTS[0];
    if (sid) p[slot.skill] = sid;
    for (const sl of ACTIVE_SLOTS) p[sl.cd] = 0;
    castActive(w);
    return true;
  } });
  // 施放主动技能并原子读取本次施放产生的投射物 / 陷阱 / 区域
  // （验收用：投射物 life 会被游戏循环每帧递减、陷阱会被敌人靠近引爆，
  //   必须与施放在同一 tick 内读取，否则测到的是衰减后的值）
  Object.defineProperty(window, '__castProbe', { value: (sid, which) => {
    const g = game; if (!g) return null;
    const w = which || 1;
    const p = g.player;
    const slot = ACTIVE_SLOTS[w - 1] || ACTIVE_SLOTS[0];
    const projBefore = g.projectiles.length, trapBefore = g.traps.length, zoneBefore = g.zones.length;
    const pBefore = p.hp;
    if (sid) p[slot.skill] = sid;
    for (const sl of ACTIVE_SLOTS) p[sl.cd] = 0;
    castActive(w);
    return {
      projectiles: g.projectiles.slice(projBefore).map(q => ({ skill: q.skill, damage: q.damage, life: q.life, vuln: q.vuln || 0, poison: q.poison || 0 })),
      traps: g.traps.slice(trapBefore).map(t => ({ type: t.type, r: t.r, boomR: t.boomR, dmg: t.dmg })),
      zones: g.zones.slice(zoneBefore).map(z => ({ r: z.r, life: z.life, dmg: z.dmg })),
      hpDelta: p.hp - pBefore, activeCd: p[slot.cd]
    };
  } });
  // 强制在玩家旁生成敌人（验收命中/伤害/易伤/中毒效果）
  Object.defineProperty(window, '__spawnNear', { value: (n = 1, dist = 60) => {
    const g = game; if (!g) return 0;
    const p = g.player; let made = 0;
    for (let i = 0; i < n; i++) {
      const e = spawnEnemy();
      if (!e) continue;
      const a = (i / n) * TAU;
      e.x = p.x + Math.cos(a) * dist; e.y = p.y + Math.sin(a) * dist;
      e.hp = e.maxHp = 999999; e.speed = 0; e.atkT = 9999;
      made++;
    }
    return made;
  } });
  // 触发一次玩家普攻（返回本次攻击命中的目标数，便于验收伤害/易伤/中毒）
  Object.defineProperty(window, '__attack', { value: () => {
    const g = game; if (!g) return 0;
    const before = g.enemies.filter(e => !e.dead).length;
    playerAttack();
    return before;
  } });
  // 读取敌人身上的 debuff 状态（验收易伤/中毒/流血）
  Object.defineProperty(window, '__enemyDebuff', { value: () => {
    const g = game; if (!g) return null;
    return g.enemies.filter(e => !e.dead).slice(0, 6).map(e => ({ hp: Math.round(e.hp), vulnT: e.vulnT || 0,
      vulnAmt: e.vulnAmt || 0, poisT: e.poisT || 0, poisDps: e.poisDps || 0, bleedT: e.bleedT || 0,
      bleedDps: e.bleedDps || 0, slowT: e.slowT || 0 }));
  } });
  // 读取最近一次投射物（验收射程/伤害系数）
  Object.defineProperty(window, '__lastProj', { value: () => {
    const g = game; if (!g) return null;
    const q = g.projectiles[g.projectiles.length - 1];
    return q ? { skill: q.skill, damage: q.damage, life: q.life, vuln: q.vuln || 0, poison: q.poison || 0 } : null;
  } });
  // 读取施放主动技能时的落点/范围（验收范围卡）
  Object.defineProperty(window, '__lastZones', { value: () => {
    const g = game; if (!g) return null;
    return g.zones.slice(-3).map(z => ({ r: z.r, life: z.life, dmg: z.dmg }));
  } });
  // 读取陷阱（验收爆炸/冰冻范围卡）
  Object.defineProperty(window, '__traps', { value: () => {
    const g = game; if (!g) return null;
    return g.traps.map(t => ({ type: t.type, r: t.r, boomR: t.boomR, dmg: t.dmg }));
  } });
  // 切换职业并重开（验收用）
  // 第 20 项：装备槽扩展为 4 个主动槽后，这里必须写全 4 个键，
  //   否则会把存档里的 equipped 覆盖成只有 3 个槽（旧写法）。
  // 另：若当前对局职业与目标不同，必须真正重开一局（原先只在 game 为空时 newGame，
  //   导致「已有对局时切职业」不生效，验收脚本会一直等不到目标职业）。
  Object.defineProperty(window, '__startHunter', { value: () => {
    selectedHero = 'hunter';
    save.equipped.hunter = { basic: 'double_shot', active: 'call_pet', active2: null, active3: null, active4: null };
    persist();
    if (!game || game.player.type !== 'hunter') { newGame(); }
    else { game.player.skillActive = 'call_pet'; game.player.mods = {}; syncBeastKing(game.player); }
    return { type: game.player.type, skillActive: game.player.skillActive };
  } });
  Object.defineProperty(window, '__startMage', { value: () => {
    selectedHero = 'mage';
    save.equipped.mage = { basic: 'arcane_missiles', active: 'flamestrike', active2: null, active3: null, active4: null };
    persist();
    if (!game || game.player.type !== 'mage') { newGame(); }
    else { game.player.skillBasic = 'arcane_missiles'; game.player.skillActive = 'flamestrike'; game.player.mods = {}; }
    return { type: game.player.type, skillBasic: game.player.skillBasic, skillActive: game.player.skillActive };
  } });
  // 战士开局（验收用）：默认装备震荡波为主动技能，便于验证冷却结算
  Object.defineProperty(window, '__startWarrior', { value: () => {
    selectedHero = 'warrior';
    save.equipped.warrior = { basic: 'whirlwind', active: 'shockwave', active2: null, active3: null, active4: null };
    persist();
    if (!game || game.player.type !== 'warrior') { newGame(); }
    else { game.player.skillBasic = 'whirlwind'; game.player.skillActive = 'shockwave'; game.player.mods = {}; }
    return { type: game.player.type, skillBasic: game.player.skillBasic, skillActive: game.player.skillActive };
  } });

  // ===== 启动：预加载素材（带进度画面），完成后进入首页 =====
  // 第 14 项：加载等待页由 index.html 的 #boot 承担（canvas 进度条被首页遮住，改用 DOM 进度条）。
  // 素材（精灵图 / 场景贴图 / Spine 骨骼 / 全部 138 个图标 PNG）全部就绪后，
  // 才给 body 加 .assets-ready 淡出等待页并显示首页 —— 玩家不再看到无图标的空首页。
  const bootFill = $('boot-fill'), bootPct = $('boot-pct'), bootStage = $('boot-stage');
  function drawLoading(prog, stage) {
    const pct = Math.max(0, Math.min(1, prog || 0));
    if (bootFill) bootFill.style.width = (pct * 100).toFixed(1) + '%';
    if (bootPct) bootPct.textContent = Math.round(pct * 100) + '%';
    if (bootStage && stage) bootStage.textContent = stage;
  }
  drawLoading(0, '正在准备素材…');
  // 副本缩略图也纳入启动加载，进副本页时不再出现空白卡片
  // 注意：DUNGEONS 是「以副本 id 为键的字典」（不是数组），必须用 Object.values 取值；
  //       这里同时兼容数组/字典两种形态，避免后续结构再变时把整个启动链打断。
  const bootExtras = (typeof DUNGEONS !== 'undefined')
    ? (Array.isArray(DUNGEONS) ? DUNGEONS : Object.values(DUNGEONS)).map(d => d && d.img).filter(Boolean)
    : [];
  ASSETS.load(drawLoading, bootExtras).then(() => {
    drawLoading(1, '素材加载完成');
    // 职业卡片保留高清立绘；其他静态入口统一使用精选功能图标。
    const map = { mage: 'mage', warrior: 'warrior', hunter: 'hunter' };
    document.querySelectorAll('.hero-icon').forEach(el => {
      const key = Object.keys(map).find(k => el.classList.contains(k));
      const im = key && ASSETS.get(map[key]);
      if (im) { el.style.backgroundImage = `url(${im.src})`; el.textContent = ''; }
    });
    const navIcons = {
      'nav-adventure': 'nav_adventure', 'nav-dungeons': 'nav_dungeons', 'nav-trainer': 'nav_trainer',
      'nav-profession': 'nav_profession', 'mc-solo': 'nav_adventure', 'mc-multi': 'nav_multi'
    };
    for (const [id, key] of Object.entries(navIcons)) {
      const el = $(id)?.querySelector('i');
      if (el) el.innerHTML = pngIconHtml(key, 36, textIcon(el.textContent, '#e9bd67', 36));
    }
    for (const [id, key] of [['achv-toggle', 'nav_achievements'], ['bag-toggle', 'nav_bag']]) {
      const el = $(id)?.querySelector('.bag-icon');
      if (el) el.innerHTML = pngIconHtml(key, 30, textIcon(el.textContent, '#e9bd67', 30));
    }
    document.querySelectorAll('.lobby-hero, .char-tab').forEach(el => {
      const cls = el.dataset.hero || el.dataset.class;
      el.innerHTML = heroIconHtml(cls, 28);
    });
    document.querySelectorAll('.trainer-tab').forEach(el => {
      const cls = el.dataset.class;
      el.innerHTML = `${heroIconHtml(cls, 24)} ${heroes[cls].name}`;
    });
    // 竞态修复：资源加载完成时玩家可能已经点了「开始远征」进入对局，
    // 此时若再强制 showHome() 会把刚创建的 game 置空、对局被踢回首页。
    // 只有当玩家仍停留在加载阶段（mode === 'loading'）时才进首页。
    if (mode === 'loading') showHome();
    // 第 14 项：素材全部就绪 → 淡出加载等待页。
    // 放在 showHome() 之后，保证首页已经可交互时等待页才开始退场。
    requestAnimationFrame(() => document.body.classList.add('assets-ready'));
    requestAnimationFrame(loop);
  });
})();
