/* audio.js — 程序化环境音乐（WebAudio 合成，零素材零版权风险）
 * 每个副本/冒险模式有不同的音阶基调。首次用户交互后启动。 */
window.AUDIO = (() => {
  'use strict';
  let ctx = null, master = null, playing = false, droneOsc = null;
  let theme = 'adventure';
  // 各场景基调（小调音阶，营造不同氛围）
  const SCALES = {
    adventure: [110, 130.8, 146.8, 164.8, 196],      // A 小调
    ragefire: [98, 116.5, 138.6, 155.6],             // G 弗里几亚（炽热）
    lordaeron: [87.3, 103.8, 123.5, 138.6],          // F 小调（阴郁）
    wailing: [123.5, 146.8, 174.6, 196],             // B 小调（湿润幽深）
    shadowfang: [92.5, 110, 130.8, 155.6],           // F# 小调（阴森）
    moltencore: [82.4, 98, 116.5, 138.6, 164.8]     // E 弗里几亚（熔火之心 · 沉重炽烈）
  };
  function init() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = .1;
    master.connect(ctx.destination);
  }
  function startDrone() {
    if (droneOsc) { droneOsc.stop(); droneOsc = null; }
    const base = SCALES[theme][0] / 2;
    droneOsc = ctx.createOscillator();
    const g = ctx.createGain();
    droneOsc.type = 'sine'; droneOsc.frequency.value = base;
    g.gain.value = .35;
    droneOsc.connect(g); g.connect(master);
    droneOsc.start();
  }
  function arp() {
    if (!playing) return;
    const sc = SCALES[theme];
    const n = sc[Math.floor(Math.random() * sc.length)] * 2;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle'; o.frequency.value = n;
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(.12, ctx.currentTime + .5);
    g.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + 2.4);
    o.connect(g); g.connect(master);
    o.start(); o.stop(ctx.currentTime + 2.6);
    setTimeout(arp, 1600 + Math.random() * 2400);
  }
  function start(t) {
    theme = t && SCALES[t] ? t : 'adventure';
    try {
      init();
      if (ctx.state === 'suspended') ctx.resume();
      startDrone();
      if (!playing) { playing = true; arp(); }
    } catch { /* 浏览器限制时静默 */ }
  }
  // 第 5 项：预热 —— 提前创建 AudioContext 并让振荡器跑起来，
  // 进入战场时只需切换主题（startDrone），省掉首次 new AudioContext 的卡顿。
  function warmup() {
    try {
      init();
      if (ctx.state === 'suspended') ctx.resume();
      startDrone();
    } catch { /* 需要用户手势，失败时静默（正式进入战场会再试一次） */ }
  }
  return { start, warmup, setTheme(t) { if (SCALES[t]) { theme = t; if (ctx && droneOsc) startDrone(); } } };
})();
