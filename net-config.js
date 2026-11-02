// ===== 联机连接配置（部署到静态托管时改这个文件）=====
//
// 用途：把游戏页面托管到 GitHub Pages / 任意静态托管后，页面 origin 与房间服务
//       （WebSocket + 存档中心）不再同源，需要显式告诉前端房间服务在哪。
//
//   wsUrl 留空 / 不填  → 回退到同源 `location.host`（本地 server.mjs、natapp 隧道
//                        直接访问时的默认行为，完全兼容改动前）
//   wsUrl 有值          → 连这个地址
//
// 格式：必须是 ws:// 或 wss:// 开头，带 /ws 路径。
//   · 页面是 https（GitHub Pages / HTTPS 隧道）→ 必须用 wss://，
//     否则浏览器按「混合内容」拦截，控制台报错且连接直接失败。
//   · natapp 的 Web 隧道同时提供 http 与 https 二级域名，wss 走同一个隧道。
//     例：wss://abc123.natappfree.cc/ws
//
// 例外：若你用的是「页面在 GitHub Pages + 房间服务在你自己电脑」这种跨源组合，
//       还需保证你的 natapp 隧道已开启 HTTPS（二级域名默认已全面支持）。
window.NET_CONFIG = {
  wsUrl: ''
};
