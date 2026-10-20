# NOTES（决策与证据留痕）

## 2026-10-20 需求阶段（vibe-spec）

**用户原话**：
> 我希望开发一个DSH工作区分组插件，可以自定义进行"组/类别"的新建，在每个"组/类别"中可以添加不同的真实工作区。每个工作区可以自由拖动排序/重命名/新增/删除等等（保持官方所有功能）。"组/类别"可以自由收起/展开，可以重命名，可以自由拖动排序，可以新增/删除/重命名等。

**用户在选择题里的原话（三项裁决）**：
1. 分组放在哪 → 「**B. 一打开就是分组视图**」
2. 分组怎么存 → 「**B. 分组存到 DSH 自己的数据文件里**」
3. 怎么验证 → 「**A. 先装一个最小验证插件探路，再写完整功能（推荐）**」

**被砍掉的候选（及其代价，写进 SPEC 的「不做什么」）**：
- 一个工作区属于多个组（用户未选 C；理由：同一工作区重复出现会让改名/删除歧义）。
- 完全替换官方列表三种视图（用户未选 C；保留为「不做什么」的一条硬界限）。

**我替用户拍板的默认值（待确认项）**：
- 组名允许重复、可以空名吗 → **不允许空名**（F2 验收）；重复**允许**（F12）。
- 「未分组」区不可改名/不可删（F9）。
- 只支持一层分组，不做组内套组。

## 关键证据（分层：实测 > 代码事实 > 推断）

| 结论 | 等级 | 证据位置 |
|---|---|---|
| 可合法接管官方侧栏工作区列表 | 代码事实 | 槽位注册表源码：同 `single` 槽位同优先级再注册会报错，提示 `register at a different priority to shadow it (lowest renders)`；排序按 `priority ?? 0` 升序，最小者渲染。位置：`app.asar/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-CN7NIWNw.js` 偏移 ~487529 / ~489409 |
| 官方该槽位注册未写 priority（=0），故我们用 -1 即可接管 | 代码事实 | `@deepseek-ai/dsh-client-ui-workspace/lib/client.js:5220-5251`（无 `priority` 字段）；槽位声明 `kind:"single"` 见 `@deepseek-ai/dsh-client-ui-sidebar/lib/client.js:507-510` |
| 平台模块表种子 11 个（含官方需要的那 5 个） | 代码事实 | 同 index bundle 内 `function SZ(){...}`：react / react/jsx-runtime / react-dom / react-dom/client / @deepseek-ai/cordis / zod / @tanstack/react-virtual / @deepseek-ai/dsh-client-store / @deepseek-ai/dsh-client-ui-slots / @deepseek-ai/dsh-client-ui-primitives / @deepseek-ai/dsh-client-ui-dockkit |
| 官方 ui-workspace 只依赖 5 个说明符，全在种子里 | 代码事实 | `.../dsh-client-ui-workspace/lib/client.js:7-11` |
| 官方包许可 = MIT，可复制修改（保留版权声明） | 代码事实 | `.../dsh-client-ui-workspace/LICENSE:1-3` |
| 官方列表的插点集中在 `deriveGroups`（1091-1113）；工作区排序提交全文件唯一一处 `insertWorkspaceBefore`（3133） | 代码事实 | `RECON-ui-workspace.md` §3、§5 |
| DOM 层「外部注入分组头」的做法不可行 | 代码事实 | 官方动画组件只认 `[data-row-key]` 行；不在 rowKeys 里的带 key 行会被当作已删除行克隆淡出（`client.js:2412-2482`） |
| 无法 import 官方包内部组件（只能拿 `/client` 半边导出） | 代码事实 | `dsh-client-modules/lib/client.js:840`；官方 README「`/client` 只导出插件体与契约类型」 |
| `persist:"dsh.workspace.view.v5"` 是否等于 localStorage 键 | **推断（未实测）** | 实现位于 `@deepseek-ai/dsh-client-store`，其源码不在本机 asar 内 |

## 过程记录

- 2026-10-20 本项目从零建立（`项目：dsh-workspace-groups ｜ 模式：新建`）。两名只读调研员并行产出 `RECON-client-loader.md`、`RECON-ui-workspace.md`；asar 解包脚本 `%TEMP%\dsh-asar-study\asar-tool.mjs`（无依赖自研）。
- 临时产物目录（待清理确认）：`%TEMP%\dsh-asar-study\`、`%TEMP%\dsh-asar-recon1\`、`%TEMP%\dsh-asar-recon2\`。

## 2026-10-20 探路实验（阶段 3 实现 · T1/T2）

### 用户的三次拍板（原话）
1. 「**B. 一打开就是分组视图**」「**B. 分组存到 DSH 自己的数据文件里**」「**A. 先装一个最小验证插件探路，再写完整功能**」
2. 「**行，就按这份做**」（SPEC v1 确认）
3. 「**允许（推荐）**」——允许我读本机凭据里的「浏览器会话口令」，以便我自己的浏览器能打开并验证真实界面
4. 「**A. 先验证接管，再写功能（推荐）**」——同意「停用内置行 + 同名副本」这条需要改系统级配置并重启一次的路

### 实测新增（本机探针插件，2026-10-20）

| 结论 | 等级 | 证据 |
|---|---|---|
| 探针插件被装载、`apply` 执行 | 实测 | `__DSH_BOOT__.entries` 出现 `dsh-workspace-groups`；页面内 `window.__wsgProbe` 存在 |
| 9 个官方模块全部可 require | 实测 | 全部 `ok:true`，含 `dsh-client-ui-primitives`(288 导出)、`dsh-client-store`、`dsh-client-ui-renderer`(含 `SlotRegistry`) |
| `priority:-1` 接管 occupied `single` 槽位 | 实测 | `sidebar.brand.name` 条目表 = [{我们自己, -1}, {官方, 0}]，渲染的是我们 |
| 接管 `sidebar.workspaces` 并撤销 | 实测 | 注册后 `[data-slot=sidebar.workspaces]` 只剩我们的节点；撤销后官方 `_9lTDKa_root` 原样回来 |
| 重声明官方已拥有的子槽位会失败 | 实测 | `slot "sidebar.workspaces.directoryFlow" is already declared (by an entry in "sidebar.workspaces")` |
| 该客户端条目被 9 个包 inject | 实测 | `__DSH_BOOT__.entries` 过滤 `inject.includes('@deepseek-ai/dsh-client-ui-workspace')` → 9 条 |
| 改文件后免重装/免重启 | 实测 | 同步文件 + 刷新页面，boot wire 的 `rev` 由 `f2c985fac7ed` 变为 `a21b5207ecd6` |
| 中文（UTF-8 直写）在客户端半边正常 | 实测 | 探针面板中文与原样显示 |
| 内置行 id = `ui-workspace` | 代码事实 | 官方 `@deepseek-ai/dsh-web-app/cordis.patch.yml` 原文 |
| `single` 槽位渲染取 `entriesOfSlot(key)[0]` | 代码事实 | `dsh-client-ui-renderer/lib/client.js` `renderOutletContent` |
| 官方渲染器/槽位文档规定：重复声明其他 entry 已拥有的 child 会激活失败 | 官方文档 | `docs/subsystems/slots.zh.md`（见 REFERENCES S1） |

### 本项目的两个「必须记住」的坑
1. **只遮蔽不换代码 = 会丢功能**：官方那 5 个子槽位（会话行菜单、悬停按钮、目录选择器等）由官方 entry 独占声明，别人不能重声明；因此必须换掉官方那份代码本身。
2. **那个条目的名字不能改**：9 个包按名字等它。

### 安全记录（必须交代）
- 为让我的浏览器能打开本机 DSH 界面，我在本机凭据文件里读出了 `client-connection/browser-session` 的口令，并用它签发了一个会话 cookie（**只在本机 127.0.0.1 使用**）。页面上出现的带 `token=` 的地址因此**落进了本会话日志**（`~/.dsh/sessions/`）。口令本身未被我打印，但该 token 曾出现在工具返回里。
  - 处置建议：本项目浏览器验证全部做完后，删除该凭据记录（`~/.dsh/.credentials.yaml` 里 `client-connection/browser-session`），DSH 下次启动会重新生成一把新的；这样旧 token 立即失效。
- 我读凭据用的跳板脚本在 `%TEMP%\dsh-asar-study\jump.mjs`（临时产物，不在项目里、不进仓库）。

## 2026-10-20 交付阶段（vibe-ship）

### 坑：`.bat` 里写 UTF-8 中文会被 cmd.exe 按 GBK 解析，把命令拆坏（实测）
- 现象：`rollback.bat` 执行时报一串 `The system cannot find the path specified.` / `'sh-workspace-groups' is not recognized` / `'�' is not recognized` —— 中文行被拆成了命令。**幸好它是"什么也没做"，profile 未被误改**（实测：bundles 仍 23、目录仍在）。
- 根因：文件是 UTF-8 **带 BOM**；`chcp 65001` 只改输出码页，cmd 解析脚本正文仍按当前 ANSI（本机 GBK），中文 UTF-8 字节里含被当作分隔符的字节 → 拆行。
- 改法（已落地并**真跑验证**）：`.bat` 只留 **ASCII 启动器**（`powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0<name>.ps1"` + `if errorlevel 1 pause`），**中文全部搬进 `.ps1`**（UTF-8 带 BOM）。
- 验证（实测）：`rollback.bat` → bundles 23→**22**、插件目录与同名副本**都消失**；`install.bat` → 回到 **23**、同名副本版本含 `+wsg.`、`sync.mjs --dry-run` 报 8 项全部一致。
- 教训：**「没试过的回滚 = 没有回滚」**。这条若没在交付前真跑，用户唯一的退路会是坏的。

### 交付时的系统级状态快照
- 安装前 profile 备份：`<备份根>\_backup\20261020-104056\<用户主目录>\.dsh\profiles\desktop\`（bundles 基线 **22**）
- 拖动真机测试前的工作区登记备份：`<备份根>\_backup\20261020-115438\<用户主目录>\.dsh\storages\`
- 分组数据：`<DSH_HOME>\storages\workspace-groups.json`（含最多 5 份 `.bak-`）

### 交付完成（2026-10-20，用户验收通过）

- **用户原话**：「验收通过，删除临时产物，新建github仓库并推送远端，作废口令。」
- **远端仓库**：`https://github.com/lzb354411/dsh-workspace-groups`（**私有**；默认分支 `main`；SSH 推送）。为什么默认私有：仓库文档里有本机绝对路径与我的工作记录，公开与否应由用户明确决定 —— 想公开：`gh repo edit --visibility public --accept-visibility-change-consequences`。
- **临时产物**：共 19 项已删（`%TEMP%` 下 7 个目录 + 12 个文件，约 38 MB），删除前逐个校验路径在 `%TEMP%` 之下。
- **口令作废**：`.credentials.yaml` 删掉 `client-connection/browser-session` 一条（5 行）；其余 2 条记录 + 3 把 API Key 原样（解析校验通过）；备份 `.credentials.yaml.bak-20261020042657-before-token-rotation`（651 字节）。DSH 下次启动重新生成新口令，旧 token 立即失效（我此前签发的验证用 cookie 也随之作废）。
- **本轮踩的两个坑（都实测）**：
  1. 作废脚本第一版用 ESM `import('C:\\...')` 直接导绝对路径 → `ERR_UNSUPPORTED_ESM_URL_SCHEME`（Windows 绝对路径必须写成 `file://` URL）；改用 `createRequire(import.meta.url)(绝对路径)` 通过。**失败时脚本在写文件之前就退了，凭据文件未被改动**（已核对字节数）。
  2. PowerShell 里 `cd` 之后用 .NET 静态方法，相对路径仍按**进程 cwd** 解析（`[System.IO.File]::ReadAllBytes('.credentials.yaml')` 读到了项目目录）→ 必须传绝对路径。这是本项目的第二次踩（第一次见 `fork-builder` 自曝），值得记住。
