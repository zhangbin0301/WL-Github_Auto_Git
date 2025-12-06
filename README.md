# GitHub 自动提交 Worker 部署指南

## 📋 目录

- [功能介绍](#功能介绍)
- [部署方式选择](#部署方式选择)
- [方法一：Cloudflare Dashboard 部署（推荐新手）](#方法一cloudflare-dashboard-部署推荐新手)
- [方法二：Wrangler CLI 部署（推荐开发者）](#方法二wrangler-cli-部署推荐开发者)
- [配置 GitHub Token](#配置-github-token)
- [常见问题](#常见问题)

---

## 功能介绍

这个 Cloudflare Worker 可以：

✅ 定时向多个 GitHub 私密仓库提交文件  
✅ 在仓库根目录创建/更新 `time.txt` 文件  
✅ 支持无限数量的仓库（GITHUB1, GITHUB2, GITHUB3...）  
✅ 提供实时监控页面，查看每个仓库的提交状态  
✅ 仓库地址自动遮掩保护隐私  
✅ 支持手动触发和定时执行  
✅ 可选密码保护，保障监控页面安全  

---

## 部署方式选择

| 方式 | 适合人群 | 优点 | 缺点 |
|------|---------|------|------|
| **Dashboard** | 新手、非开发者 | 图形界面，简单直观 | 每次更新需要手动操作 |
| **Wrangler CLI** | 开发者 | 版本控制，快速部署 | 需要命令行基础 |

---

## 方法一：Cloudflare Dashboard 部署（推荐新手）

### 步骤 1：登录 Cloudflare

1. 访问 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 登录或注册账号（免费账号即可）

### 步骤 2：创建 Worker

1. 点击左侧菜单 **Workers & Pages**
2. 点击 **Create application** 按钮
3. 选择 **Create Worker**
4. 输入 Worker 名称，例如：`github-monitor`
5. 点击 **Deploy** 按钮

![创建 Worker](https://i.imgur.com/example1.png)

### 步骤 3：编辑代码

1. 部署完成后，点击 **Edit code** 按钮
2. 删除编辑器中的所有默认代码
3. 复制完整的 Worker 代码并粘贴
4. 点击右上角 **Save and Deploy** 保存

### 步骤 4：创建 KV 命名空间

1. 返回 Workers 主页
2. 点击左侧菜单 **KV**
3. 点击 **Create a namespace** 按钮
4. 命名空间名称输入：`STATUS_KV`
5. 点击 **Add** 创建

### 步骤 5：绑定 KV 到 Worker

1. 返回你的 Worker 页面（Workers & Pages → 选择你的 Worker）
2. 点击 **Settings** 标签
3. 找到 **Variables** 部分
4. 滚动到 **KV Namespace Bindings**
5. 点击 **Add binding** 按钮
   - **Variable name**: 输入 `STATUS_KV`
   - **KV namespace**: 从下拉菜单选择 `STATUS_KV`
6. 点击 **Save** 保存

### 步骤 6：配置仓库信息

在同一个 **Settings** → **Variables** 页面：

1. 找到 **Environment Variables** 部分
2. 点击 **Add variable** 添加变量

**（可选）添加访问密码：**
```
变量名: PSWD
值: your_secure_password_here
类型: Text
```

> 🔒 **密码保护说明**：
> - 如果设置了 PSWD 变量，访问监控页面需要输入密码
> - 使用 HTTP Basic Auth 认证
> - 用户名可以是任意值，只验证密码
> - 不设置 PSWD 则无需密码，任何人都可访问

**添加第一个仓库：**
```
变量名: GITHUB1
值: {"token":"ghp_your_token_here","repo":"username/repo-name"}
类型: Text
```

**添加第二个仓库：**
```
变量名: GITHUB2
值: {"token":"ghp_another_token","repo":"org/another-repo"}
类型: Text
```

**继续添加更多仓库：**
```
GITHUB3, GITHUB4, GITHUB5 ... 无限制
```

> ⚠️ **注意**：
> - `token` 是你的 GitHub Personal Access Token
> - `repo` 格式必须是：`用户名/仓库名` 或 `组织名/仓库名`
> - 不要选择 "Encrypt" 类型，保持 "Text" 即可
> - 如何获取 Token 见下方说明

### 步骤 7：配置定时任务

1. 点击 **Triggers** 标签
2. 滚动到 **Cron Triggers** 部分
3. 点击 **Add Cron Trigger** 按钮
4. 输入 Cron 表达式

**推荐配置：**

| 频率 | Cron 表达式 | 说明 |
|------|------------|------|
| 每 10 分钟 | `*/10 * * * *` | 高频更新 |
| 每 30 分钟 | `*/30 * * * *` | 适中频率 |
| 每小时 | `0 * * * *` | 推荐使用 |
| 每 6 小时 | `0 */6 * * *` | 低频更新 |
| 每天一次 | `0 0 * * *` | 最低频率 |

5. 点击 **Add Trigger** 保存

### 步骤 8：访问监控页面

1. 返回 Worker 的 **Overview** 页面
2. 找到并复制 **Worker URL**
   - 格式：`https://github-monitor.你的子域名.workers.dev`
3. 在浏览器中打开这个 URL
4. 看到监控页面即部署成功！🎉

### 步骤 9：测试运行

在监控页面点击 **"▶️ 立即执行"** 按钮，测试是否正常工作。

---

## 方法二：Wrangler CLI 部署（推荐开发者）

### 前置要求

- Node.js 16+ 已安装
- npm 或 yarn 已安装
- Git 已安装（可选）

### 步骤 1：安装 Wrangler

```bash
npm install -g wrangler
```

验证安装：
```bash
wrangler --version
```

### 步骤 2：登录 Cloudflare

```bash
wrangler login
```

会自动打开浏览器完成授权。

### 步骤 3：创建项目

```bash
# 创建项目目录
mkdir github-monitor
cd github-monitor

# 初始化 Worker
wrangler init

# 选择以下选项：
# ✓ Would you like to use git? Yes
# ✓ Would you like to use TypeScript? No
# ✓ Would you like to create a Package.json? Yes
```

### 步骤 4：添加代码

创建 `src/index.js` 文件，粘贴完整的 Worker 代码。

项目结构：
```
github-monitor/
├── src/
│   └── index.js          # Worker 代码
├── wrangler.toml         # 配置文件
└── package.json
```

### 步骤 5：创建 KV 命名空间

```bash
wrangler kv:namespace create "STATUS_KV"
```

**输出示例：**
```
🌀 Creating namespace with title "github-monitor-STATUS_KV"
✨ Success!
Add the following to your configuration file:
{ binding = "STATUS_KV", id = "abc123def456789" }
```

复制返回的 ID（例如：`abc123def456789`）

### 步骤 6：配置 wrangler.toml

创建或编辑 `wrangler.toml` 文件：

```toml
name = "github-monitor"
main = "src/index.js"
compatibility_date = "2024-01-01"

# KV 绑定
[[kv_namespaces]]
binding = "STATUS_KV"
id = "abc123def456789"  # 替换为你的实际 KV ID

# 定时任务（可选，也可以在 Dashboard 配置）
[triggers]
crons = ["0 * * * *"]  # 每小时执行一次

# 环境变量（仓库配置）
[vars]
# 访问密码（可选）
PSWD = "your_secure_password"

# 仓库配置
GITHUB1 = '{"token":"ghp_your_token","repo":"user/repo1"}'
GITHUB2 = '{"token":"ghp_another_token","repo":"user/repo2"}'
GITHUB3 = '{"token":"ghp_third_token","repo":"org/repo3"}'
```

> 💡 **提示**：
> - 可以继续添加 GITHUB4, GITHUB5 等，没有数量限制
> - Token 和仓库信息也可以在 Dashboard 的环境变量中配置

### 步骤 7：部署

```bash
wrangler deploy
```

**成功输出：**
```
⛅️ wrangler 3.x.x
------------------
✨ Built successfully
🌍 Uploading...
✨ Success! Deployed to https://github-monitor.your-subdomain.workers.dev
```

### 步骤 8：测试和查看

**查看实时日志：**
```bash
wrangler tail
```

**访问监控页面：**
```
https://github-monitor.your-subdomain.workers.dev
```

### 常用 Wrangler 命令

```bash
# 部署到生产环境
wrangler deploy

# 本地开发测试
wrangler dev

# 查看实时日志
wrangler tail

# 查看 KV 内容
wrangler kv:key list --binding=STATUS_KV

# 删除 Worker
wrangler delete
```

---

## 配置 GitHub Token

### 创建 Personal Access Token

1. **访问 GitHub Token 设置页面**
   - 链接：https://github.com/settings/tokens

2. **创建新 Token**
   - 点击 **Generate new token** → **Generate new token (classic)**
   - 或选择 **Fine-grained tokens**（推荐，更安全）

3. **配置 Token**

   **Classic Token 权限：**
   - ✅ 勾选 `repo`（完整仓库访问权限）

   **Fine-grained Token 权限：**（推荐）
   - Repository access: 选择 **Only select repositories**
   - 选择需要自动提交的仓库
   - Permissions → Repository permissions:
     - ✅ Contents: **Read and write**

4. **设置过期时间**
   - 推荐：90 天或自定义
   - 到期前会收到邮件提醒

5. **生成并保存**
   - 点击 **Generate token**
   - **立即复制 Token**（只显示一次！）
   - 保存到安全的地方

### Token 格式

```
ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

- Classic Token 以 `ghp_` 开头
- Fine-grained Token 以 `github_pat_` 开头

### 安全建议

⚠️ **重要安全提示：**

- ✅ 使用 Fine-grained tokens 而非 Classic tokens
- ✅ 只授予必要的最小权限
- ✅ 限制 Token 只能访问特定仓库
- ✅ 设置合理的过期时间
- ✅ 定期轮换 Token
- ❌ 不要将 Token 提交到 Git 仓库
- ❌ 不要在公开场合分享 Token

---

## 常见问题

### Q1: 部署后访问页面显示 "暂无数据"？

**A:** 这是正常的，因为还没有执行过任务。

**解决方法：**
1. 点击页面上的 **"立即执行"** 按钮
2. 或等待定时任务自动执行
3. 或访问 `/api/trigger` 端点手动触发

---

### Q2: 提交失败，显示 "GitHub API error (401)"？

**A:** Token 无效或权限不足。

**解决方法：**
1. 检查 Token 是否正确复制（没有多余空格）
2. 确认 Token 没有过期
3. 验证 Token 有 `repo` 或 `Contents: Read and write` 权限
4. 在 GitHub 检查 Token 状态：https://github.com/settings/tokens

---

### Q3: 仓库地址格式错误？

**A:** 必须是 `owner/repo` 格式。

**正确格式：**
```json
{"token":"ghp_xxx","repo":"username/my-repo"}
{"token":"ghp_xxx","repo":"my-org/team-project"}
```

**错误格式：**
```json
{"token":"ghp_xxx","repo":"https://github.com/user/repo"}  ❌
{"token":"ghp_xxx","repo":"my-repo"}  ❌
```

---

### Q4: 可以免费使用吗？需要绑定信用卡吗？

**A:** 完全免费，无需信用卡。

**Cloudflare Workers 免费额度：**
- ✅ 每天 100,000 次请求
- ✅ 每月 400,000 GB-s CPU 时间
- ✅ 无限 KV 读取
- ✅ 1,000 次 KV 写入/天
- ✅ 1 GB KV 存储

个人使用绰绰有余！

---

### Q5: 定时任务没有执行？

**检查清单：**
1. ✅ 在 **Triggers** 标签确认 Cron Trigger 已添加
2. ✅ Cron 表达式格式正确
3. ✅ Worker 状态为 "Active"
4. ✅ 查看 Worker 日志确认执行情况

**查看日志：**
- Dashboard: Worker → Logs 标签
- CLI: `wrangler tail`

---

### Q6: 如何修改提交频率？

**Dashboard 方式：**
1. Worker → Settings → Triggers
2. 找到现有的 Cron Trigger
3. 点击删除，重新添加新的表达式

**Wrangler 方式：**
1. 编辑 `wrangler.toml`
2. 修改 `crons` 值
3. 运行 `wrangler deploy`

---

### Q7: KV 是必需的吗？

**A:** 不是必需，但强烈推荐。

**没有 KV：**
- ❌ 刷新页面后状态丢失
- ❌ 无法查看历史记录

**使用 KV：**
- ✅ 状态持久化保存
- ✅ 随时查看最后执行结果
- ✅ 免费额度完全够用

---

### Q8: 如何添加更多仓库？

**Dashboard 方式：**
1. Worker → Settings → Variables
2. 添加新的环境变量 `GITHUB4`, `GITHUB5` 等
3. 格式保持一致

**Wrangler 方式：**
1. 编辑 `wrangler.toml`
2. 在 `[vars]` 部分添加新行
3. 重新部署

**无需修改代码**，Worker 会自动检测所有 `GITHUB*` 变量。

---

### Q9: 如何查看提交是否成功？

**方法 1：** 访问监控页面
```
https://your-worker.workers.dev
```

**方法 2：** 直接访问 GitHub 仓库
- 查看 `time.txt` 文件
- 查看 Commit 历史

**方法 3：** API 方式
```bash
curl https://your-worker.workers.dev/api/status
```

---

### Q10: 如何设置访问密码保护？

**A:** 添加 PSWD 环境变量即可。

**Dashboard 方式：**
1. Worker → Settings → Variables
2. 添加环境变量：
   - 变量名：`PSWD`
   - 值：你的密码（例如：`MySecret123`）
   - 类型：Text
3. 保存后立即生效

**Wrangler 方式：**
```toml
[vars]
PSWD = "your_secure_password"
```

**访问效果：**
- 浏览器会弹出登录框
- 用户名：任意输入
- 密码：PSWD 设置的值
- 浏览器会记住登录状态

**取消密码保护：**
- 删除 PSWD 变量即可

---

### Q11: 遇到 "Rate limit exceeded" 错误？

**原因：** GitHub API 有速率限制。

**解决方法：**
1. 降低执行频率（改为每小时或更长）
2. 确保使用的是认证 Token（有更高限额）
3. 检查是否有其他服务在使用同一个 Token

**GitHub API 限制：**
- 未认证：60 次/小时
- 已认证：5,000 次/小时

---

## 📚 相关资源

- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
- [Wrangler CLI 文档](https://developers.cloudflare.com/workers/wrangler/)
- [GitHub API 文档](https://docs.github.com/en/rest)
- [Cron 表达式生成器](https://crontab.guru/)

---

## 🎉 部署成功！

恭喜你成功部署了 GitHub 自动提交 Worker！

**接下来你可以：**
- ✅ 访问监控页面查看状态
- ✅ 添加更多仓库
- ✅ 调整执行频率
- ✅ 自定义提交内容

**需要帮助？**
- 查看 Worker 日志排查问题
- 检查环境变量配置
- 验证 GitHub Token 权限

祝使用愉快！🚀
