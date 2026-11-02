/* fx.js — 矢量程序化特效层：粒子发射器 / 缓动 / 渐变缓存 / 发光工具（阶段 1 美术升级）
 * 全局挂载 window.FX，零依赖，game.js 之前加载。 */
window.FX = (() => {
  'use strict';
  const TAU = Math.PI * 2;
  const particles = [];

  // ===== 缓动 =====
  const ease = {
    linear: t => t,
    outCubic: t => 1 - Math.pow(1 - t, 3),
    outQuad: t => 1 - (1 - t) * (1 - t),
    inQuad: t => t * t,
    outBack: t => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2)
  };

  // ===== 颜色工具 =====
  function shade(hex, amt) {
    // amt > 0 变亮，< 0 变暗；hex 形如 #rrggbb
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => Math.max(0, Math.min(255, Math.round(v + 255 * amt)));
    return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
  }
  function alpha(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  }

  // ===== 渐变缓存（以 0,0 为中心，配合 ctx.translate 使用）=====
  const gcache = new Map();
  function radial(ctx, key, r, stops) {
    let g = gcache.get(key);
    if (!g) {
      g = ctx.createRadialGradient(0, 0, r * .08, 0, 0, r);
      for (const [o, c] of stops) g.addColorStop(o, c);
      gcache.set(key, g);
    }
    return g;
  }

  // ===== 粒子 =====
  // 字段：x,y,vx,vy,grav(重力),drag,life,maxLife,color,size,shrink(随寿命缩小),glow(发光),alpha
  function emit(o) {
    if (particles.length > 380) particles.shift(); // 性能预算：粒子上限
    particles.push({ vx: 0, vy: 0, grav: 0, drag: 1, size: 3, shrink: false, glow: false, alpha: 1, ...o });
  }

  function burst(x, y, color, count = 12, opts = {}) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const s = (opts.speed || 120) * (0.35 + Math.random() * 0.8);
      const life = (opts.life || .6) * (0.6 + Math.random() * 0.8);
      emit({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - (opts.up || 0),
        grav: opts.grav || 0, drag: opts.drag ?? .94, life, maxLife: life,
        color, size: (opts.size || 3.5) * (0.6 + Math.random() * 0.8),
        shrink: opts.shrink ?? true, glow: opts.glow ?? true });
    }
  }

  // 环形冲击波粒子带
  function ring(x, y, color, count = 24, opts = {}) {
    for (let i = 0; i < count; i++) {
      const a = i / count * TAU;
      const s = (opts.speed || 220) * (0.9 + Math.random() * 0.2);
      emit({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, drag: .9,
        life: .45, maxLife: .45, color, size: opts.size || 3, shrink: true, glow: true });
    }
  }

  function update(dt) {
    for (const p of particles) {
      p.life -= dt;
      p.vy += p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= p.drag; p.vy *= p.drag;
    }
    for (let i = particles.length - 1; i >= 0; i--) if (particles[i].life <= 0) particles.splice(i, 1);
  }

  function draw(ctx) {
    for (const p of particles) {
      const t = Math.max(0, p.life / p.maxLife);
      ctx.globalAlpha = t * p.alpha;
      if (p.glow) { ctx.shadowBlur = 10; ctx.shadowColor = p.color; }
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.shrink ? p.size * t : p.size, 0, TAU);
      ctx.fill();
      if (p.glow) ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
  }

  function clear() { particles.length = 0; }

  return { emit, burst, ring, update, draw, clear, ease, shade, alpha, radial, count: () => particles.length };
})();
