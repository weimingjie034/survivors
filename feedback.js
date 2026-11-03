// ===== feedback.js · 玩家反馈入口 + 访问/对局数据采集 =====
//
// 设计原则（遵守项目的「并行开发隔离约定」）：
//   ★ 本文件承载全部功能，game.js 一行都不用改 —— 通过 window.game 只读探针取战局数据。
//   ★ 零内部依赖（不引用 game.js / td.js 的任何符号），数值不与调用方共享。
//   ★ 任何异常都自我吞掉：采集失败绝不能影响游戏主循环（rAF 一旦被打断画面会永久冻结）。
//   ★ 暴露 window.__FEEDBACK.CALLS 计数，验收脚本可断言「钩子确实被调用过」。
//
// 上报内容（服务端再补 IP / UA 等）：
//   visit    —— 进入页面：访客画像（语言、分辨率、来源页）
//   tick     —— 对局心跳：游玩秒数、模式、英雄、等级、击杀
//   end      —— 对局结束
//   feedback —— 玩家手填的建议反馈
//
// 后台地址：默认同源 /api/collect（由 server.mjs 转发到 admin/server.mjs）。
// 需要改地址时，在本文件之前设置 window.FEEDBACK_CONFIG = { endpoint: 'http://…/api/collect' }。
(function () {
  'use strict';

  var CFG = {
    endpoint: (window.FEEDBACK_CONFIG && window.FEEDBACK_CONFIG.endpoint) || '/api/collect',
    heartbeatMs: (window.FEEDBACK_CONFIG && window.FEEDBACK_CONFIG.heartbeatMs) || 15000,
    pollMs: (window.FEEDBACK_CONFIG && window.FEEDBACK_CONFIG.pollMs) || 1000,
    maxText: (window.FEEDBACK_CONFIG && window.FEEDBACK_CONFIG.maxText) || 2000,
    enabled: true
  };

  // 计数（验收用：任何一项为 0 都说明钩子被冲掉了）
  var CALLS = { boot: 0, visit: 0, session: 0, tick: 0, end: 0, open: 0, submit: 0, ok: 0, fail: 0 };

  // 当前对局状态
  var st = { game: null, sid: '', mode: '', hero: '', sec: 0, level: 0, kills: 0, ended: false, playing: false };

  function $(id) { return document.getElementById(id); }
  function uid() {
    try {
      if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
      if (window.crypto && crypto.getRandomValues) {
        var a = new Uint8Array(16); crypto.getRandomValues(a);
        return Array.prototype.map.call(a, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
      }
    } catch (e) { }
    return 'sid' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  }

  // ---------- 上报（任何失败都静默降级）----------
  function send(payload) {
    if (!CFG.enabled) return Promise.resolve(false);
    try {
      return fetch(CFG.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true
      }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        CALLS.ok++;
        return true;
      }).catch(function () { CALLS.fail++; return false; });
    } catch (e) { CALLS.fail++; return Promise.resolve(false); }
  }

  function deviceInfo() {
    var d = '';
    try { d = navigator.userAgent || ''; } catch (e) { }
    var os = /Windows/i.test(d) ? 'Windows' : /Android/i.test(d) ? 'Android'
      : /iPhone|iPad|iOS/i.test(d) ? 'iOS' : /Mac OS/i.test(d) ? 'macOS' : /Linux/i.test(d) ? 'Linux' : '未知';
    var br = /Edg\//i.test(d) ? 'Edge' : /Chrome\//i.test(d) ? 'Chrome'
      : /Firefox\//i.test(d) ? 'Firefox' : /Safari\//i.test(d) ? 'Safari' : '未知';
    return br + '/' + os;
  }

  // ---------- 样式 ----------
  var CSS = [
    '#fb-open{position:absolute;right:26px;bottom:124px;z-index:31;display:flex;align-items:center;gap:7px;',
    'padding:8px 14px;border:1px solid #6d6046;border-radius:999px;cursor:pointer;',
    'background:linear-gradient(160deg,rgba(42,36,24,.92),rgba(21,16,9,.92));color:#e9d3a0;',
    'font-size:13px;letter-spacing:.06em;box-shadow:0 6px 22px rgba(0,0,0,.45);transition:.2s}',
    '#fb-open:hover{border-color:var(--gold-bright,#f0cf88);color:#f6e3b8;transform:translateY(-2px)}',
    '#fb-open i{font-style:normal;font-size:15px;color:#d9b96e}',
    '@media(max-width:720px){#fb-open{right:12px;bottom:114px;padding:7px 11px;font-size:12px}}',
    '@media(max-width:360px){#fb-open{bottom:110px;padding:6px 9px}}',
    '.fb-modal{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;',
    'background:rgba(4,7,11,.74);pointer-events:auto}',
    '.fb-modal.hidden{display:none!important}',
    '.fb-panel{width:min(560px,92vw);background:#111823;border:1px solid #6d6046;border-radius:12px;',
    'box-shadow:0 24px 60px rgba(0,0,0,.6);padding:18px 20px 16px;pointer-events:auto}',
    '.fb-head{display:flex;align-items:center;gap:10px;margin-bottom:10px}',
    '.fb-head b{flex:1;font-size:16px;color:#f0cf88;letter-spacing:.08em}',
    '.fb-x{background:transparent;border:1px solid #2b3648;color:#8fa0b6;border-radius:6px;padding:2px 9px;cursor:pointer}',
    '.fb-x:hover{border-color:#d9b96e;color:#e9d3a0}',
    '#fb-text{width:100%;height:130px;resize:vertical;background:#0c1219;border:1px solid #2b3648;',
    'color:#e8eef7;border-radius:8px;padding:10px 12px;font:inherit;font-size:13px;line-height:1.6;',
    '-webkit-user-select:text;user-select:text}',
    '#fb-text:focus{outline:none;border-color:#d9b96e}',
    '.fb-foot{display:flex;align-items:center;gap:10px;margin-top:12px}',
    '.fb-foot .fb-tip{flex:1;font-size:11px;color:#8fa0b6}',
    '.fb-sub{border:1px solid #f0cf88;background:linear-gradient(#d8ad5c,#9c6b29);color:#16130d;',
    'padding:8px 22px;border-radius:8px;cursor:pointer;font-weight:700;letter-spacing:.08em}',
    '.fb-msg{min-height:18px;margin-top:8px;font-size:12px;color:#8fa0b6}',
    '.fb-msg.ok{color:#5fd08a}.fb-msg.err{color:#e8735f}',
    '@media(max-width:720px){.fb-panel{width:94vw}}'
  ].join('');

  // ---------- 注入 DOM ----------
  function buildUI() {
    try {
      var style = document.createElement('style');
      style.id = 'fb-style';
      style.textContent = CSS;
      document.head.appendChild(style);

      // 按钮：挂在 #home 里（#home 不激活时整块 display:none，天然只在首页出现）
      var home = $('home');
      if (!home) return false;
      var btn = document.createElement('button');
      btn.id = 'fb-open';
      btn.type = 'button';
      btn.setAttribute('aria-label', '建议反馈');
      btn.innerHTML = '<i>&#9998;</i><span>建议反馈</span>';
      home.appendChild(btn);

      // 弹层：挂到 body 级（避开 .hud 的 pointer-events:none 继承坑）
      var modal = document.createElement('div');
      modal.id = 'fb-modal';
      modal.className = 'fb-modal hidden';
      modal.innerHTML = [
        '<div class="fb-panel" role="dialog" aria-label="建议反馈">',
        '<div class="fb-head"><b>建议反馈</b><button class="fb-x" type="button" aria-label="关闭">✕</button></div>',
        '<textarea id="fb-text" maxlength="2000" placeholder="哪里不好玩？想加什么功能？或者哪一步卡住了……"></textarea>',
        '<div class="fb-foot"><span class="fb-tip">提交会附带本次游玩情况，便于我们定位问题</span>',
        '<button class="fb-sub" type="button">提交</button></div>',
        '<div class="fb-msg" id="fb-msg"></div>',
        '</div>'
      ].join('');
      document.body.appendChild(modal);

      btn.addEventListener('click', function () { openModal(); });
      modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });
      modal.querySelector('.fb-x').addEventListener('click', function () { closeModal(); });
      modal.querySelector('.fb-sub').addEventListener('click', function () { submit(); });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeModal();
      });
      return true;
    } catch (e) {
      console.warn('[feedback] UI 构建失败：', e && e.message);
      return false;
    }
  }

  function openModal() {
    try {
      var m = $('fb-modal');
      if (!m) return;
      m.classList.remove('hidden');
      CALLS.open++;
      var t = $('fb-text');
      if (t) setTimeout(function () { try { t.focus(); } catch (e) { } }, 30);
    } catch (e) { }
  }
  function closeModal() {
    try { var m = $('fb-modal'); if (m) m.classList.add('hidden'); } catch (e) { }
  }

  function msg(text, kind) {
    try {
      var el = $('fb-msg');
      if (!el) return;
      el.textContent = text || '';
      el.className = 'fb-msg' + (kind ? ' ' + kind : '');
    } catch (e) { }
  }

  function submit() {
    try {
      var t = $('fb-text');
      var text = t ? String(t.value || '').trim() : '';
      if (!text) { msg('写点什么再提交吧～', 'err'); return; }
      if (text.length > CFG.maxText) text = text.slice(0, CFG.maxText);
      var btn = document.querySelector('.fb-sub');
      if (btn) btn.disabled = true;
      msg('提交中…');
      send({
        t: 'feedback', sid: st.sid, text: text,
        mode: st.mode, hero: st.hero, sec: num2(st.sec),
        level: st.level, device: deviceInfo(),
        path: (location.pathname || '') + (location.search || '')
      }).then(function (ok) {
        CALLS.submit++;
        if (btn) btn.disabled = false;
        if (ok) {
          msg('收到！感谢你的建议 ★', 'ok');
          if (t) t.value = '';
          setTimeout(closeModal, 1200);
        } else {
          msg('提交失败，请稍后再试（或检查后台服务是否启动）', 'err');
        }
      });
    } catch (e) {
      msg('提交出错，请稍后再试', 'err');
    }
  }

  // ---------- 战局探针（只读 window.game，不改任何游戏状态）----------
  function readGame() {
    try { return window.game || null; } catch (e) { return null; }
  }
  function resultShown() {
    try {
      var r = $('result');
      return !!(r && r.classList.contains('active'));
    } catch (e) { return false; }
  }

  function num2(v) { // 秒数保留 2 位小数 —— 取整会把「不到半秒的对局」记成 0 秒
    var n = Number(v);
    if (!isFinite(n) || n < 0) return 0;
    return Math.round(n * 100) / 100;
  }

  function tick() {
    try {
      var g = readGame();
      if (g && g.elapsed > 0) {
        if (g !== st.game) {
          // 新一局 → 换 session
          st.game = g; st.sid = uid(); st.ended = false; st.playing = true;
          st.mode = g.gameMode || 'adventure';
          st.hero = (g.player && g.player.type) || '';
          CALLS.session++;
        }
        st.sec = Math.max(st.sec, Number(g.elapsed) || 0);
        if (g.player) {
          st.level = g.player.level || 0;
          st.kills = g.player.kills || 0;
        }
        if (g.gameMode) st.mode = g.gameMode;
        if (!st.ended && resultShown()) {
          st.ended = true;
          CALLS.end++;
          send({ t: 'end', sid: st.sid, mode: st.mode, hero: st.hero, sec: num2(st.sec), level: st.level, kills: st.kills });
        }
      }
    } catch (e) { }
  }

  function heartbeat() {
    try {
      if (!st.playing || st.ended) return;
      CALLS.tick++;
      send({
        t: 'tick', sid: st.sid, mode: st.mode, hero: st.hero,
        sec: num2(st.sec), level: st.level, kills: st.kills
      });
    } catch (e) { }
  }

  function reportVisit() {
    try {
      CALLS.visit++;
      var scr = '';
      try { scr = (window.screen ? screen.width + 'x' + screen.height : ''); } catch (e) { }
      send({
        t: 'visit',
        lang: (navigator.language || ''),
        screen: scr,
        device: deviceInfo(),
        ref: document.referrer || '',
        path: (location.pathname || '') + (location.search || '')
      });
    } catch (e) { }
  }

  // ---------- 启动 ----------
  function boot() {
    try {
      CALLS.boot++;
      buildUI();
      reportVisit();
      setInterval(tick, CFG.pollMs);
      setInterval(heartbeat, CFG.heartbeatMs);
      // 离开页面前把最后一局补报（后台服务不可用时静默失败）
      window.addEventListener('pagehide', function () {
        try {
          if (st.playing && !st.ended) {
            st.ended = true;
            send({ t: 'end', sid: st.sid, mode: st.mode, hero: st.hero, sec: num2(st.sec), level: st.level, kills: st.kills });
          }
        } catch (e) { }
      });
    } catch (e) {
      console.warn('[feedback] 启动失败：', e && e.message);
    }
  }

  // 对外接口（验收脚本 / 其它模块可用）
  window.__FEEDBACK = {
    CALLS: CALLS, cfg: CFG, state: st,
    open: openModal, close: closeModal, send: send,
    report: function (text) {
      var t = $('fb-text');
      if (t) t.value = String(text || '');
      openModal();
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
