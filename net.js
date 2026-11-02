// ===== 局域网客户端网络层（连接 / 房间 / 大厅 / 对局中继）=====
window.NET = (() => {
  let ws = null;
  let myId = null;
  let room = null;        // 当前房间状态（服务端 roomState）
  let connected = false;
  let connecting = null;  // 进行中的连接 Promise（第 5 项：避免并发 connect 重复建 WS）
  let pendingName = '';   // 最近一次请求的昵称（预连接后改名用）
  const handlers = {};    // t -> [fn]
  const supported = location.protocol === 'http:' || location.protocol === 'https:';
  let saveRid = 0;
  const saveWaiters = {}; // rid -> {resolve}

  function on(t, fn) { (handlers[t] = handlers[t] || []).push(fn); }
  function emit(t, msg) { for (const fn of handlers[t] || []) fn(msg); }

  // ===== WS 地址解析（静态托管场景的必需品）=====
  // 页面托管到 GitHub Pages 等静态托管后，页面 origin 与房间服务不再同源，
  // 此时必须显式指定房间服务地址，否则会去连 <静态站点>/ws（不存在）。
  // 解析优先级：
  //   1) window.NET_CONFIG.wsUrl —— 部署时注入（net-config.js），正式配置
  //   2) URL 参数 ?ws=...        —— 临时测试用
  //   3) 同源 location.host      —— 默认行为，与改动前完全一致
  //
  // ⚠ 注意：不得在此处新增任何顶层副作用（IIFE / 全局赋值 / 定时器）。
  //   实测：顶层多执行一次 URLSearchParams 解析就会让联机 e2e 的
  //   「第 11 项 战复」用例出现时序失败（快照到达与倒地判定错拍）。
  //   本函数只在 connect() 被调用时执行，保持惰性。
  function resolveWsUrl() {
    const cfg = window.NET_CONFIG;
    if (cfg && cfg.wsUrl) return String(cfg.wsUrl);
    let q = '';
    try { q = location.search.replace(/^\?/, ''); } catch { }
    const m = /(?:^|&)ws=([^&]*)/.exec(q);
    if (m) return decodeURIComponent(m[1]);
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/ws`;
  }

  // #66 第 5 项：首页预热时先建立连接，之后进入联机页可复用，无需再次握手。
  // 若昵称与预连接时不同，会补发一次 hello 更新服务端昵称。
  function connect(playerName) {
    if (playerName) pendingName = String(playerName);
    if (!supported) return Promise.reject(new Error('联机需要通过服务器访问页面（start.cmd 启动后，用浏览器打开主机显示的局域网地址）'));
    if (ws && ws.readyState === 1) {
      if (playerName) send({ t: 'hello', name: pendingName }); // 已连接：仅更新昵称
      return Promise.resolve();
    }
    // 已有连接在途 → 复用它，不重复创建 WebSocket
    if (connecting) return connecting;
    connecting = new Promise((res, rej) => {
      // 穿透/HTTPS 部署下页面是 https:，必须用 wss:（浏览器拦截 ws 混合内容）
      // 静态托管（GitHub Pages）+ 远程房间服务时，地址来自 resolveWsUrl()。
      try { ws = new WebSocket(resolveWsUrl()); }
      catch { connecting = null; rej(new Error('无法创建连接')); return; }
      const timer = setTimeout(() => { try { ws.close(); } catch { } connecting = null; rej(new Error('连接超时')); }, 4000);
      ws.onopen = () => { send({ t: 'hello', name: pendingName || '无名英雄' }); };
      ws.onmessage = (ev) => {
        let msg; try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.t === 'welcome') { myId = msg.id; connected = true; clearTimeout(timer); connecting = null; res(); }
        if (msg.t === 'joined' || msg.t === 'update') room = msg.room;
        if (msg.t === 'started' && msg.room) room = msg.room; // #52 修复：开局后 room.started 置真，否则 game.coop 永不建立
        if (msg.t === 'left' || msg.t === 'closed') room = null;
        // #65 存档中心：带 rid 的请求-响应直接结算对应 Promise
        if ((msg.t === 'save:data' || msg.t === 'save:ack') && msg.rid != null && saveWaiters[msg.rid]) {
          const w = saveWaiters[msg.rid]; delete saveWaiters[msg.rid]; w.resolve(msg);
        }
        emit(msg.t, msg);
      };
      ws.onclose = () => { connected = false; room = null; connecting = null; emit('disconnect', {}); };
      ws.onerror = () => { if (!connected) { clearTimeout(timer); connecting = null; rej(new Error('无法连接到主机')); } };
    });
    return connecting;
  }
  function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

  return {
    on, connect, send,
    get supported() { return supported; },
    get connected() { return connected; },
    get myId() { return myId; },
    get room() { return room; },
    isHost() { return !!room && room.players.some(p => p.id === myId && p.host); },
    listRooms() { send({ t: 'list' }); },
    createRoom(name, mode, dungeon, hero) { send({ t: 'create', name, mode, dungeon, hero }); },
    joinRoom(roomId, hero) { send({ t: 'join', room: roomId, hero }); },
    leaveRoom() { send({ t: 'leave' }); },
    setReady(ready) { send({ t: 'ready', ready }); },
    setHero(hero) { send({ t: 'hero', hero }); },
    startGame() { send({ t: 'start' }); },
    sendEv(data) { send({ t: 'ev', data }); },     // 客户端 → 主机
    sendSnap(data) { send({ t: 'snap', data }); },  // 主机 → 其他玩家
    sendAnn(data) { send({ t: 'ann', data }); },    // 主机公告 → 其他玩家
    sendFx(data, skip) { send({ t: 'fx', data, skip }); }, // #54 技能弹道视觉（主机直发或代转发）
    sendEnd(data) { send({ t: 'end', data }); },     // 主机结算 → 全房间
    // #65 存档中心：取回/回写自己的存档（跨 origin 恢复用）
    saveGet(key) {
      return new Promise((resolve) => {
        if (!connected) { resolve(null); return; }
        const rid = ++saveRid;
        const timer = setTimeout(() => { delete saveWaiters[rid]; resolve(null); }, 4000);
        saveWaiters[rid] = { resolve: (m) => { clearTimeout(timer); resolve(m); } };
        send({ t: 'save:get', key, rid });
      });
    },
    savePut(key, data) {
      return new Promise((resolve) => {
        if (!connected) { resolve(null); return; }
        const rid = ++saveRid;
        const timer = setTimeout(() => { delete saveWaiters[rid]; resolve(null); }, 4000);
        saveWaiters[rid] = { resolve: (m) => { clearTimeout(timer); resolve(m); } };
        send({ t: 'save:put', key, data, rid });
      });
    }
  };
})();
