/* ============================================================
   mobile.js —— 移动端输入基础设施（独立文件 · 与塔防模式零耦合）
   ============================================================
   为什么独立成文件：
     塔防模式正在并行开发 game.js / td.js。为避免文件占用与冲突，
     本文件承载**全部**移动端输入逻辑，game.js 只需一处桥接。

   职责：
     ① 跟随式浮动摇杆（按到哪里哪里就是摇杆）
     ② 多指指针仲裁（左手移动 + 右手操作 互不干扰）
     ③ 触觉反馈（navigator.vibrate，iOS 不支持时静默降级）
     ④ 屏幕分区判定（左侧移动区 / 右侧操作区）

   不负责：
     · 塔防模式的任何交互（TD 用「点阵位传送」，摇杆在 TD 里无意义）
     · 技能释放逻辑（在 game.js 里）

   与 game.js 的接口（唯一）：
     window.__mobileHook = {
       dir: { x, y },   // 归一化方向向量（-1..1），实时 getter，无 1 帧延迟
       buzz(kind),      // 触觉反馈
       isMobile,        // 是否移动端
     }
   ============================================================ */
(() => {
  'use strict';

  // ===== 触觉反馈表（kind → 震动模式）=====
  const HAPTICS = {
    joy: 12,                       // 摇杆生成（极轻，确认"抓到了"）
    hurt: [40, 60, 40],            // 玩家受伤（双段）
    kill: 10,                      // 击杀普通敌人（高频轻点）
    bigKill: [30, 50, 30, 50, 60], // 击杀精英 / Boss
    level: [20, 40, 20, 40, 30],   // 升级（上升感）
    loot: [15, 30, 15, 30, 25],    // 获得装备（惊喜感）
    cast: 18,                      // 施放主动技能
    heal: [25, 40, 25],            // 药水 / 战复
  };

  // ===== 触觉开关（localStorage，用户可关闭）=====
  const HAPTIC_KEY = 'azs_haptic';
  let hapticOn = (() => {
    try { return localStorage.getItem(HAPTIC_KEY) !== 'off'; } catch { return true; }
  })();

  function buzz(kind) {
    if (!hapticOn) return;
    const p = HAPTICS[kind];
    if (p == null) return;
    try { if (navigator.vibrate) navigator.vibrate(p); } catch { /* iOS Safari 无此 API */ }
  }

  // ===== 移动端判定 =====
  // 与 game.js 的 tdIsMobile() 保持同一口径（窄屏或触屏设备）。
  function isMobile() {
    return (innerWidth <= 820) || (navigator.maxTouchPoints > 0 && innerWidth <= 1024);
  }

  // ===== 跟随摇杆状态 =====
  const joy = {
    active: false,     // 是否正在拖动摇杆
    pointerId: null,   // 当前跟踪的指针（只跟踪第一个按下的手指）
    originX: 0,        // 摇杆生成点（手指按下的位置）
    originY: 0,
    x: 0, y: 0,        // 归一化方向（-1..1）
    radius: 52,        // 摇杆最大偏移半径（像素）
  };

  // ===== DOM 引用 =====
  let el = null;       // 浮动摇杆元素（跟随手指移动的那个）

  // ===== 状态判定 =====
  // 弹层打开时（任何 .screen.active）禁止移动 —— 选卡时误触摇杆会让角色乱跑。
  // 联机模式弹层不暂停战斗，这条尤其重要。
  function modalOpen() {
    return !!document.querySelector('.screen.active');
  }
  // 塔防模式：摇杆无意义（TD 用点阵位传送），完全禁用。
  function isTdMode() {
    return document.body.classList.contains('td-mode');
  }
  // HUD 隐藏 = 不在战斗态（首页/菜单/结算等）
  function inBattlefield() {
    const hud = document.getElementById('hud');
    return !!hud && !hud.classList.contains('hidden');
  }

  /** 当前是否允许生成摇杆 */
  function canSpawn() {
    if (!isMobile()) return false;
    if (isTdMode()) return false;      // 塔防不摇杆
    if (modalOpen()) return false;      // 弹层期间不摇杆
    if (!inBattlefield()) return false; // 非战斗态不摇杆
    return true;
  }

  // ===== 屏幕分区 =====
  // 左半屏 = 移动区（按住任意空白处 → 就地生成摇杆）
  // 右半屏 = 操作区（技能键等，已由 CSS 布局在右下）
  const MOVE_ZONE_RATIO = 0.5;
  function isMoveZone(clientX) {
    return clientX < innerWidth * MOVE_ZONE_RATIO;
  }

  // ===== 摇杆渲染 =====
  function renderJoy() {
    if (!el) return;
    if (!joy.active) {
      el.classList.remove('on');
      el.style.opacity = '0';
      // 提示圈重新浮现（它固定在左下，只作视觉引导）
      document.body.classList.remove('joy-active');
      return;
    }
    // 摇杆底盘固定在按下点，手柄按方向偏移
    const dx = joy.x * joy.radius, dy = joy.y * joy.radius;
    el.style.left = joy.originX + 'px';
    el.style.top = joy.originY + 'px';
    el.classList.add('on');
    el.style.opacity = '1';
    // 浮动摇杆激活时隐藏左下提示圈（两者同屏显冗余，且固定位置会误导「只能在这拖」）
    document.body.classList.add('joy-active');
    const knob = el.firstElementChild;
    if (knob) knob.style.transform = `translate(${dx}px,${dy}px)`;
  }

  /** 释放摇杆（松手 / 被打断） */
  function releaseJoy() {
    if (!joy.active) return;
    joy.active = false;
    joy.pointerId = null;
    joy.x = 0; joy.y = 0;
    renderJoy();
  }

  /** 计算方向：位移 → 归一化向量 */
  function updateDirection(clientX, clientY) {
    const dx = clientX - joy.originX, dy = clientY - joy.originY;
    const l = Math.hypot(dx, dy);
    if (l < 1e-3) { joy.x = 0; joy.y = 0; renderJoy(); return; }
    // 超过半径则吸附边缘（保持方向不变，只是速度到顶）
    if (l > joy.radius) { joy.x = dx / l; joy.y = dy / l; }
    else { joy.x = dx / joy.radius; joy.y = dy / joy.radius; }
    renderJoy();
  }

  // ===== 指针事件 =====
  function onPointerDown(e) {
    if (!canSpawn()) return;
    // 技能键等自身有 pointer-events:auto 的元素不劫持
    if (e.target && e.target.closest && e.target.closest('.touch-btn, .touch-pad, .icon-button')) return;
    // 只接管移动区（屏幕左半）
    if (!isMoveZone(e.clientX)) return;
    // 已有手指在拖摇杆 → 忽略后续手指（多指仲裁：摇杆只认第一根）
    if (joy.active) return;

    joy.active = true;
    joy.pointerId = e.pointerId;
    joy.originX = e.clientX;
    joy.originY = e.clientY;
    joy.x = 0; joy.y = 0;
    renderJoy();
    buzz('joy');
    // 阻止后续的兼容性 mouse 事件与页面滚动
    try { e.preventDefault(); } catch { }
  }

  function onPointerMove(e) {
    if (!joy.active || e.pointerId !== joy.pointerId) return;
    updateDirection(e.clientX, e.clientY);
  }

  function onPointerUp(e) {
    if (joy.active && e.pointerId === joy.pointerId) releaseJoy();
  }

  // ★ pointercancel ≠ 手指抬起
  // 移动端浏览器在手势被接管（系统返回手势、浏览器下拉刷新等）时会发 pointercancel。
  // 若当成松手处理，玩家拖动途中摇杆会凭空消失；更糟的是若只清方向却保留 active，
  // 这根手指再也不会有 pointerup → 摇杆永久粘住（角色一直朝一个方向跑）。
  // 正确处理：**彻底释放**（等价于松手）—— 角色停下，等玩家重新按下。
  // 真机上的根因已通过 canvas / body 的 touch-action:none 修掉，这里是兜底。
  function onPointerCancel(e) {
    if (!joy.active || e.pointerId !== joy.pointerId) return;
    releaseJoy();
  }

  // ===== 安装 =====
  function install() {
    // 浮动摇杆本体：跟随手指移动（放在 .touch-ui 里，随 HUD 一起隐藏）
    if (!el) {
      el = document.createElement('div');
      el.className = 'joystick-float';
      el.setAttribute('aria-hidden', 'true');
      el.innerHTML = '<i></i>';
    }
    const ui = document.querySelector('.touch-ui');
    if (ui && !ui.contains(el)) ui.appendChild(el);

    // 事件挂在 document 上 —— 摇杆可能生成在 .touch-ui 之外的任意位置
    document.addEventListener('pointerdown', onPointerDown, { passive: false });
    document.addEventListener('pointermove', onPointerMove, { passive: false });
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerCancel);
    // 失焦 / 切后台 → 释放，避免"粘住"持续移动
    addEventListener('blur', releaseJoy);
    document.addEventListener('visibilitychange', () => { if (document.hidden) releaseJoy(); });
  }

  // ===== 弹层打开时释放已生成的摇杆 =====
  // 联机模式弹层不暂停战斗，若不释放，玩家选卡时角色仍在跑。
  const obs = new MutationObserver(() => {
    if (modalOpen() && joy.active) releaseJoy();
  });
  function startObserver() {
    obs.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['class'] });
  }

  // ===== 对外接口 =====
  // dir 用实时 getter —— game.js 每帧读到的都是当前值，无 1 帧延迟，也不需要常驻 rAF。
  const dir = {};
  Object.defineProperty(dir, 'x', { get: () => joy.x });
  Object.defineProperty(dir, 'y', { get: () => joy.y });

  window.__mobileHook = {
    dir,
    buzz,
    isMobile,
    get joystick() { return joy; },
    setHaptic(on) {
      hapticOn = !!on;
      try { localStorage.setItem(HAPTIC_KEY, hapticOn ? 'on' : 'off'); } catch { }
    },
    get hapticEnabled() { return hapticOn; },
  };

  // ===== 启动 =====
  function boot() {
    install();
    startObserver();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

})();
