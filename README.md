# 磁力元数据查询平台

轻量单体应用：Hono 提供 API 与静态文件托管，React/Vite 提供前端页面，SQLite 保存用户、会话、查询缓存、历史、收藏和后台配置。

## 本地开发

```bash
npm install
npm run dev
```

另开终端启动前端开发服务器：

```bash
npm run dev:web
```

API 默认运行在 `http://localhost:3000`，Vite 默认运行在 `http://localhost:5173` 并代理 `/api`。

## 生产构建

```bash
npm run build
npm start
```

## Docker 部署

```bash
docker compose up --build
```

首次启动时如设置了 `ADMIN_EMAIL` 和 `ADMIN_PASSWORD`，系统会自动创建管理员账号。默认数据卷为 `/data/app.db`。

## 关键环境变量

- `DATABASE_URL`：SQLite 路径，例如 `file:/data/app.db`
- `SESSION_SECRET`：会话 token HMAC 密钥
- `ADMIN_EMAIL` / `ADMIN_PASSWORD`：首个管理员账号
- `WHATSLINK_BASE_URL`：默认 `https://whatslink.info`
- `APP_ORIGIN`：前端访问源，例如 `http://localhost:3000`
- `PORT`：后端端口，默认 `3000`

## 验证

```bash
npm test
npm run typecheck
npm run build
```
