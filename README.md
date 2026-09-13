# dsh-balance-status

在 DSH Web 界面**底部状态行**（`x 轮 xx 步 · xx tok/s   xx M tok · 缓存命中 xx%`）之后追加一枚 **DeepSeek 账户余额**，左键单击弹出用量详情面板。

```
⟳ 1 轮 89 步 · 262 tok/s   ⛁ 9.1M tok · 缓存命中 96%  余额 ¥32.49
```

**左键单击余额** → 立即刷新一次并弹出面板（再点一次关闭，点空白处或 Esc 也可关闭）：

```
DeepSeek 余额
─────────────────────────
余额            ¥32.49
充值            ¥32.49
赠送            ¥0.00
当前对话已用     ¥0.20
当前进程已用     ¥0.35
点击余额刷新 · 点击空白处或 Esc 关闭
```

不写任何会话历史、不画图、不做动画，就是一行状态文字加一个小面板。

## 前置条件

**必须**在 DSH 凭据里配置 `DEEPSEEK_API_KEY`（余额接口需要它）。没配也能装，状态行会显示 `余额 未配置`。使用方式见 DSH 设置里的凭据页，或直接编辑 `$DSH_HOME/.credentials.yaml`：

```yaml
DEEPSEEK_API_KEY: sk-xxxxxxxx
```

可选：

- 走内部网关时设置 `DEEPSEEK_BASE_URL`（或用 DSH 设置里 `llm-deepseek` 的 `baseURL`），插件会自动跟随；否则用 `https://api.deepseek.com`。

## 安装

### 本机（打包成 tarball 安装：真实复制，推荐）

**不要用 `link:`**。`link:` 是符号链接，源码目录一旦移动或删除，插件就失效。正确做法是先打包再安装，
pnpm 会把文件真实复制进 profile 的 `.pnpm` 目录，装完之后源码目录放哪、删不删都不影响运行：

```powershell
# 1) 在插件目录里打包（只包含 files 字段列出的文件）
cd <插件目录>
pnpm pack            # 产出 dsh-balance-status-1.0.0.tgz

# 2) 安装该 tarball
dsh plugin --profile web add file:<插件目录>\dsh-balance-status-1.0.0.tgz
```

装完**重启 `dsh web`**，再 F5 刷新浏览器。

> 直接复制整个 `dsh-balance-status` 目录到别的机器，把上面的路径换掉即可；本地 tarball 安装不需要联网。

### 升级（改了源码之后）

`file:` 依赖指向的是那一次打出来的 tarball 快照，改了源码必须重新打包并覆盖安装：

```powershell
cd <插件目录>
pnpm pack
dsh plugin --profile web add file:<插件目录>\dsh-balance-status-1.0.0.tgz   # 覆盖安装
```

然后重启 `dsh web`。

> **移动或删除本目录之后要注意什么**：已装好的副本是独立复制，移动/删除本目录**不影响它继续运行**。
> 但 profile 里记录的依赖 spec 是 `file:<本目录>\...tgz`，所以之后再执行任何 `dsh plugin add/remove/update`
> 时 pnpm 会重新解析这个路径 —— 路径失效会让那次安装失败。因此移动目录后，请从新路径重新执行一次上面的
> `add` 命令覆盖安装即可。

### 开发模式（可选，仅限本机调试）

想边改边看效果可以用链接安装，但**必须记住它是符号链接**：

```powershell
dsh plugin --profile web add link:<插件目录绝对路径>
```

### 其他设备（从 Git 仓库安装）

把本目录推到一个 Git 仓库（仓库根目录就是本目录，即 `package.json` 所在层），然后：

```powershell
dsh plugin --profile web add github:<用户名>/<仓库名>
```

如果 pnpm 提示拦截构建脚本，按提示在 `%USERPROFILE%\.dsh\profiles\web\pnpm-workspace.yaml` 的 `allowBuilds` 下加上本包名再重跑。

### 验证

```powershell
dsh --profile web --dump-config | Select-String dsh-balance-status
```

浏览器 F5 后，状态行末尾应出现 `余额 ¥xx.xx`。

## 卸载

```powershell
dsh plugin --profile web remove dsh-balance-status
```

重启 `dsh web` 后状态行恢复原样。

## 刷新策略

DeepSeek 的余额接口本身**最多可能有 5 分钟延迟**，所以刷得比这更勤只是白打接口。默认策略：

- **自动刷新：5 分钟一次**（与数据延迟对齐，每小时约 12 次请求）。
- **点击余额：强制立即刷新一次**，绕过一切缓存，同时开关详情面板。
- 宿主端另有 **30 秒结果缓存**，只为兜住同一瞬间的重复请求（多标签页等）；点击的强制刷新不受它影响。

想调整只改 `lib/client.js` 顶部一个常量，然后重新打包安装：

```js
var REFRESH_MS = 300000   // 自动刷新间隔；设为 0 = 完全关闭自动刷新，只在点击时查询
```

改完记得 `pnpm pack` + 重新 `add` 那个 tarball，再重启 `dsh web`。

## 两个用量数字怎么算的

采用**余额差值记账**，不依赖任何价格表，因此 DeepSeek 调价也不会算错：

- `当前进程已用` ＝ 自 `dsh web` 进程启动后**第一次观测到余额**起，余额**下降部分**的累计；重启进程即归零。
- `当前对话已用` ＝ 自该会话**第一次观测到余额**起，余额下降部分的累计；开新对话（新 sessionId）即归零，F5 刷新页面不会丢。
- 充值造成的余额上升不会记成负数，只是把基准点抬高。
- **全部只存在于宿主进程内存中，绝不写入会话记录**，以保证会话日志格式的向后兼容。代价是重启后这些用量数字永久消失（这是刻意接受的取舍）。

已知限制：余额接口是 0.01 元粒度且可能有延迟，小额消耗要攒到 1 分钱才体现。另外多个对话同时开着时，两个会话各自按自己的基准计算，会互相包含对方的消耗（余额记账法的固有限制）。

## 实现说明

| 半边 | 文件 | 职责 |
| --- | --- | --- |
| 宿主 | `lib/index.js` | 解析凭据与端点、调用 `GET {baseURL}/user/balance`（30 秒缓存）、维护两个内存账本、注册 `/dsh-balance-status/balance` 只读 JSON 路由 |
| 浏览器 | `lib/client.js` | 预构建 bundle，向 `conversation.composer.dock` 注册余额按钮、向 `shell.overlay` 注册详情面板，5 分钟轮询 + 点击强制刷新 |

几个刻意的实现选择：

- **浏览器半边是预构建产物**：DSH 的 `client-modules` 直接按字节提供 `exports["./client"]`，不做转换，所以该文件必须保持 `window.__ModuleLoader__.load({ id, factory })` 工厂格式，并且只 `require` 平台种子模块（`react`）。改它之后要重启 `dsh web` 生效，不需要任何构建步骤。
- **状态行对齐**：自带状态行根节点有 `padding-top: 4px`，所以行内改为 `align-items: flex-start` 并给余额按钮同样的 `4px` 上边距，两者按钮顶边严格落在同一像素行。
- **面板样式逐条照搬**自带状态浮窗（`ui-chat` 的 `stat-dialog.module.css`）：`var(--dsw-specific-menu)` 背景、`var(--dsw-elevation-prominent)` 阴影、12px 圆角、12/18 字号行高、`dl/dt/dd` 网格，保证与「缓存命中」浮窗观感一致。
- **关闭面板不用全屏遮罩**：遮罩会吃掉滚轮事件导致无法浏览对话，改为 `document` 上的 `mousedown` / `keydown` 监听。
- **余额查询走宿主进程的 `fetch`**，浏览器半边只访问本地只读路由，密钥永远不进浏览器。

### 安全提示

`/dsh-balance-status/balance` 会返回账户余额（不含密钥）。它由 DSH 的 Web 服务器提供，沿用 DSH 自身的鉴权与监听地址；请保持 DSH 监听在 `127.0.0.1`，不要把它直接暴露到公网。

## 兼容性

按 DSH `0.1.5-rc.2` 编写，依赖以下稳定契约：

- 插槽 `conversation.composer.dock`（自带状态行的位置）与 `shell.overlay`（框架级浮层）；
- 宿主服务 `webServer`、`credentials`、`settings`；
- 主题变量 `--dsw-specific-menu`、`--dsw-elevation-prominent`、`--dsw-alias-*`、`--dsh-content-font-size-secondary`。

若将来自带状态行的内边距或插槽键变化，只需相应调整 `lib/client.js` 顶部 `PILL_CSS` 里的对齐规则。

## 来源与许可

MIT。余额接口（`GET /user/balance`）与「余额差值记账」思路参考了开源项目
[DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)（MIT）。
本插件只保留其核心取数与记账逻辑，去掉了挂件、音效、拖拽与动画，改为挂在状态行上的一行文字。
