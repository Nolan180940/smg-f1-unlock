# 用户部署指南

以下步骤在你 push 完代码后，需要手动完成。

---

## 1. Supabase — 创建数据库表

打开你的 Supabase 项目 → **SQL Editor**，执行：

```sql
CREATE TABLE visits (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  ip text NOT NULL,
  country text,
  city text,
  visited_at timestamptz DEFAULT now()
);
```

记下你的 Supabase URL 和 `service_role` key（Project Settings → API）。

---

## 2. Vercel — 创建项目

1. 打开 [vercel.com](https://vercel.com) → **Add New Project**
2. 导入 `smg-f1-unlock` 仓库
3. 框架预设选 **Other**，**不需要** Build Command
4. 添加以下环境变量（Environment Variables）：

| Variable | 值 |
|---|---|
| `SUPABASE_URL` | `https://xxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...`（service_role key） |
| `STATS_KEY` | 你自己设置的密码（查看统计用） |
| `STREAM_URL_RAW` | `https://raw.githubusercontent.com/Nolan180940/smg-f1-unlock/main/stream-url.json` |

5. 点 **Deploy**

---

## 3. 验证 GitHub Actions

1. 去 GitHub 仓库 → **Actions** 标签页
2. 找到 **Refresh Stream URL** 工作流
3. 点 **Run workflow** → 手动触发一次
4. 等待执行完成（约 30-60 秒）
5. 检查仓库根目录的 `stream-url.json` 是否已更新为有效的 m3u8 地址

---

## 4. 访问

| 页面 | URL |
|---|---|
| 播放器 | `https://<你的域名>/` |
| 统计 | `https://<你的域名>/stats?key=<STATS_KEY>` |

---

## 5. 故障排查

**播放器黑屏 / 无法播放**
- 检查 GitHub Actions 是否成功运行，`stream-url.json` 里是否有 m3u8 地址
- 打开浏览器 DevTools → Network，确认 `/api/proxy?type=playlist` 返回了正确的 m3u8 内容
- 确认 `/api/proxy?type=ts&url=...` 能正常返回 TS 分段

**统计页 403**
- 确认访问时使用了正确的 `?key=...`，与 `STATS_KEY` 环境变量一致

**GitHub Actions 失败**
- 检查 Action 日志，常见原因：kankanews 页面改版导致 bypass 失效
- 2026-08-21 改版要点：Vue 组件新增 `isCopyright` 开关（为真时 `initPlayer()` 直接销毁播放器）；`/program/detail` 接口不再返回 `live_address`（需从 `currChannelDetail.live_address` 复制到 `programDetail.channel_info.live_address`）。再失效时优先检查这两处
- 可以尝试在本地运行 `node scripts/get-stream-url.mjs` 调试

---

## 文件说明

| 文件 | 用途 |
|---|---|
| `api/proxy.js` | m3u8 + TS 代理，隐藏真实 CDN 地址 |
| `api/now-playing.js` | 返回当前直播状态 |
| `api/visit.js` | 记录访客 IP/国家/城市 |
| `api/stats.js` | 访客统计页面（受 `STATS_KEY` 保护） |
| `api/_db.js` | Supabase 客户端 |
| `index.html` | 播放器前端（hls.js，深色/浅色模式） |
| `scripts/get-stream-url.mjs` | Puppeteer 脚本，每 30 分钟抓取最新 m3u8 |
| `.github/workflows/refresh-stream.yml` | GitHub Actions 定时任务 |
