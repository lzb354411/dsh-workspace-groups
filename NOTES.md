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
- 临时产物目录（待清理确认）：`%TEMP%\dsh-asar-study`、`%TEMP%\dsh-asar-recon1`、`%TEMP%\dsh-asar-recon2`。

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
- 安装前 profile 备份：`<备份根>\_backup\20261020-104056\<用户主目录>\.dsh\profiles\desktop`（bundles 基线 **22**）
- 拖动真机测试前的工作区登记备份：`<备份根>\_backup\20261020-115438\<用户主目录>\.dsh\storages`
- 分组数据：`<DSH_HOME>\storages\workspace-groups.json`（含最多 5 份 `.bak-`）

### 交付完成（2026-10-20，用户验收通过）

- **用户原话**：「验收通过，删除临时产物，新建github仓库并推送远端，作废口令。」
- **远端仓库**：`https://github.com/lzb354411/dsh-workspace-groups`（**私有**；默认分支 `main`；SSH 推送）。为什么默认私有：仓库文档里有本机绝对路径与我的工作记录，公开与否应由用户明确决定 —— 想公开：`gh repo edit --visibility public --accept-visibility-change-consequences`。
- **临时产物**：共 19 项已删（`%TEMP%` 下 7 个目录 + 12 个文件，约 38 MB），删除前逐个校验路径在 `%TEMP%` 之下。
- **口令作废**：`.credentials.yaml` 删掉 `client-connection/browser-session` 一条（5 行）；其余 2 条记录 + 3 把 API Key 原样（解析校验通过）；备份 `.credentials.yaml.bak-20261020042657-before-token-rotation`（651 字节）。DSH 下次启动重新生成新口令，旧 token 立即失效（我此前签发的验证用 cookie 也随之作废）。
- **本轮踩的两个坑（都实测）**：
  1. 作废脚本第一版用 ESM `import('C:\\...')` 直接导绝对路径 → `ERR_UNSUPPORTED_ESM_URL_SCHEME`（Windows 绝对路径必须写成 `file://` URL）；改用 `createRequire(import.meta.url)(绝对路径)` 通过。**失败时脚本在写文件之前就退了，凭据文件未被改动**（已核对字节数）。
  2. PowerShell 里 `cd` 之后用 .NET 静态方法，相对路径仍按**进程 cwd** 解析（`[System.IO.File]::ReadAllBytes('.credentials.yaml')` 读到了项目目录）→ 必须传绝对路径。这是本项目的第二次踩（第一次见 `fork-builder` 自曝），值得记住。

## 排障 2026-10-21 · 生产事故：远程端连上后 8 条分组归属被清空落盘

**用户原话**：「分组插件和当前我安装的远程插件疑似存在冲突。在远程以后，分组全部失效，全都变成了未分组的状态。同时远程插件无法正常使用，远程控制端存在无法再输入框正常输入，输入光标会一直跳到输入框中最前方」。

### 现象与第一步取证（都实测）
- 状态文件 `~/.dsh/storages/workspace-groups.json`：**4 个组都在，`membership` 变成 `{}`**（400 字节），写入时刻 **00:07:10**。
- 写入前备份 `.bak-20261021-000710`（866 字节）**含完整 8 条归属** → 丢的是归属，不是组；组名在文件里是好的（PowerShell 显示乱码是它按 GBK 解码所致，非文件损坏）。
- 远程插件 `@linxin666/dsh-remote-web-ui@0.4.6` 的设备文件更新于 **00:07:18**（差 8 秒）→ 相关性极强。
- 该插件客户端**没有碰** `sidebar.workspaces`（grep 零命中）→ 远程端跑的确实是我们的分组层，所以它撞上了那个窗口。

### 根因（代码事实，逐行）
| 环节 | 位置 | 事实 |
|---|---|---|
| 归一化抹掉语义 | `project.pure.js:199` | `Array.isArray(options.workspaceIds) ? … : []` → 调用方传的 `undefined`（含义「别清洗」）被变成 `[]`（含义「全清」） |
| 全丢 | `project.pure.js:104/110` | `known = new Set([])` → 每条 membership 都过不了 `known.has()` → 全部丢弃 |
| 二传手落盘 | `grouping.js:561-565` | `changed=true` → `WSG_commit(projected.state)` → 防抖 POST → 磁盘 membership 变 `{}` |
| 为何只有远程暴露 | `grouping.js:554` | 未 ready（远程/移动端那一路）→ 传 `undefined`；本地 `ready=true` 时走完整可信集，永远到不了这条路径 |

**审查里那条第 I3（未就绪列表会把有效归属当残骸清掉）的修复被这个默认值完全抵消** —— 修复方向对，但二传手在下一层。**当时那条"不传就不洗"的测试打在了错误的入口上**（直接调 `WSG_sanitizeState(state)`，两参省略 → `undefined` ✓ 通过；从没打过 `WSG_project` 这条真入口）。

### 改法（三层，先红后绿）
1. `WSG_project` 归一语义改为「不传 / **空数组** = 不清洗」；**同一不变量补进 `WSG_sanitizeState`**（第二个入口）。
2. 新增显式契约 `cleanupApplied`（这次真的用可信全集清洗过吗），作为可被测试锁定的闸。
3. **整体删掉"后台自动写回清洗结果"**（那段 effect + `salt`）：Host 允许悬空记录、渲染本来就忽略它 → 自动写回**收益为零、风险全在**（就是这次事故）。F13 的可见要求（组内不留空壳）靠"渲染时忽略"即满足。
- 回归证据（原文）：改前 `49 项通过，5 项失败`，其中 `H1 … 实际 0 / 期望 8` —— **线上 8→0 的精确复现**；改后 `54 项通过，0 项失败`。产物 290939 字节 SHA256 `46a3876b08b34ca77fba12c0ab2c3db528f99c947967539564dd7fc3a227325e`。

### 数据恢复（先修代码、再恢复）
- 8 个工作区 id 现均存在（核过 `workspace.json`）→ 恢复安全。
- 从 `.bak-20261021-000710` 恢复：**4 组 + 8 条归属**；被清空的那份另存 `.bak-20261021-161604-before-restore`。

### 第二个症状（平板打英文光标跳最前）：**根因=官方输入框（Lexical contenteditable）在安卓上的行为，与两个插件都无关**

> ⚠️ **本节下方原标题写的是"定位到远程插件"，那是我的错误归属，已被用户实测否定**（见末尾「第二轮取证与更正」）。保留原文以便追溯推理过程，**以更正后的结论为准**。

**新线索（用户实测）**：**中文正常，英文逐键输入就跳到最前**。→ 说明有个东西在拦"逐键事件"（输入法把按键吃掉了，所以中文不受影响）。

**已排除（代码事实）**：本项目 `src/grouping/` 对 `addEventListener` 只有 `pagehide`/`focus`/`visibilitychange`（状态同步用）；`\.focus\(|contenteditable|data-composer|prototype\.|execCommand|clipboard` **零命中** → 我们**没有**任何全局按键/焦点/选区处理，也没碰输入框。
远程插件那个捕获阶段的 `onKeydownCapture`（`mobile-adapt.ts:998-1011`）**只管 Enter**，且正确跳过 IME（`e.isComposing || e.keyCode === 229`）→ 不是它。

**真正的根因（代码事实）**：`@linxin666/dsh-remote-web-ui@0.4.6` 的移动适配层在 **`HTMLElement.prototype.focus` 上打了全局猴补丁**（`src/client/mobile-adapt.ts:1249-1257`）：
```js
const patchedFocus = function (this: HTMLElement, options) {
  if (active && isComposerField(this) && Date.now() - lastComposerTap >= 800) return   // ← 静默吞掉
  lanOrigFocus.call(this, options)
}
```
其注释自述输入框是官方 **contenteditable**（`data-composer-input`）；`lastComposerTap` 只在真实 `pointerdown` 时更新，**800ms 窗口之后重新开始吞**。

**机制（推断，标注）**：英文逐键 → 官方 composer 每次都更新草稿并重渲染 contenteditable → contenteditable 被重写时光标会回到最前；官方随后若靠 `.focus()`（或依赖它）恢复，就被这个补丁吞掉 → 光标停在最前。中文走输入法 composition，逐键不触发重渲染 → 正常。800ms 窗口还解释了"刚点进去能打、打一会儿就开始跳"。

**待证实的一点**：DSH 官方恢复光标的确切方式（本机看不到官方 composer 内部实现）——但不影响归属：**两个插件里只有远程插件在全局劫持 focus**。

**决定性对照（都无需重启，待用户实测）**：① 手机**横屏**（横屏时适配层 `revert()`）再打英文；② 远程端控制台 `window.__dshRemoteAdapt.setEnabled(false)` 后打英文；③ 反向 `setEnabled(true)` 应又复现。
处置建议：上报作者（Apache-2.0，GitHub `zhu1090093659/dsh-web`）；临时绕过=横屏或停用适配层。
- 已排除/已确认：远程插件不碰我们的槽位；`WSG_commit` 只通知我们自己那份快照（`WSG_setSnapshot` → `WSG_subscribe`），不是全局 store。
- 候选（均**推断**，无证据）：① 事故期间"未 ready → 每次渲染都 changed → commit"造成的连续重渲染；② 远程通道（`remote-channel*`）同步 UI 状态时的重渲染与输入框争用；③ 该插件移动适配层自身的输入处理问题。
- 隔离测法（未做）：本地刷新后远程端刷新复测 → 仍不行则 `rollback.bat` 停用本插件 + 重启，再复测远程端输入。**根因未定位前不宣称已修。**
- **用户裁决（2026-10-21）**：① 症状二先由用户刷新远程端复测；② 本次修复**推送到公开仓库**（已推，远端 86c5c97）。

### 第二轮取证与更正（2026-10-21 · 最终结论）
**上面那个"远程插件 focus 补丁"的归属是错的**，用户实测否定了它：① **平板横竖屏都坏**，而那个补丁只在 `orientation: portrait + pointer: coarse + innerWidth < 1100` 时生效（`mobile-adapt.ts:104-109`）；② 平板上的**普通小输入框打英文完全正常**（起名框/重命名框/设置搜索框），只有官方大输入框坏 → 排除"全局按键/焦点被劫持"，锁定**输入框自身**。

**代码事实（从官方 `app.asar` 直接取出，只读；两个探针脚本在 `%TEMP%`，用完即删）**：
- 官方输入框是 **Lexical 驱动的 contenteditable**：`@deepseek-ai/dsh-client-ui-conversation/lib/client.js` L18102（`data-composer-input` + `role=textbox` + `suppressContentEditableWarning`）、L5345（`data-lexical-slot`）、L5283 起是 **`lexical@0.49.0` 的打包产物**（`…/node_modules/lexical/dist/Lexical.prod.mjs`）、L5303 是 Lexical 的平台判定（`/Android/.test(navigator.userAgent)`、iPad/iPhone、Safari、Firefox）。
- 输入路径 = **自己接管输入**：L6592 注册 `beforeinput`；L6708/L6753 对 `inputType === 'insertText'` 先 `preventDefault()` 再手动插入；L5635/L6624 做选区保存与恢复（`anchorOffset/focusOffset`）；L8936 监听 `selectionchange/beforeinput/compositionstart/compositionend`。
- **中文为什么没事（代码里直接看得到豁免）**：L6524 `if (e.isComposing()) return`；L6610 多处 `!a.isComposing() && …` → **composing 期间跳过选区协调**；只有"无 composing 的逐键输入"（英文）才会走那条"preventDefault + 手动插入 + 选区协调"的脆弱路径。
- 归属排查：本项目 `src/grouping/` 对输入/焦点/选区/原型补丁**零命中**；profile 下 33 个已装包产物里只有第三方插件匹配 `data-composer-input|prototype.focus=`（4 处，全在竖屏适配层，竖屏才生效）。

**结论（证据分层）**：**代码事实** —— 官方输入框是 Lexical contenteditable、Lexical 自带安卓分支、composing 期豁免选区协调；**实测（用户）** —— 普通输入框正常 / 横竖屏都坏 / 中文正常英文坏；**推断** —— 安卓软键盘的逐键英文（无 composing）触发 Lexical 选区协调失败 → 光标回最前。**两个插件都不是原因。**
**还能再证伪的一条**：接蓝牙/USB 外接键盘打英文（走传统 keydown，不经过安卓软键盘的输入管道）应正常；或打开安卓输入法的英文联想/自动更正（让英文也走 composing）应也正常。
**给用户的处置**：① 外接键盘（**这条后来被我收回：机制与语言无关，外接键盘大概率没用**）；② 开英文联想/自动更正；③ 先用中文输入法输英文；④ 见下方「第三轮：两块拼图合上」。

### 第三轮：两块拼图合上（2026-10-21 · 独立调研员报告 `RECON-composer-input.md` 佐证）
独立只读调研员从 `app.asar` 逐行取出官方输入框实现（asar 自带 SHA256 校验通过，`CONV:` = 官方 conversation 客户端 client.js），给出两条关键代码事实，与用户两条实测**同时吻合**：

1. **中英分岔是官方自己做的**：`CONV:6593-6595` —— `inputType === 'insertCompositionText'`（输入法）**直接 return，不接管 DOM**；而 `insertText`（逐键英文）走 `CONV:6752-6761`：`preventDefault()` 后**由编辑器自己重写 DOM**。
2. **官方依赖 `.focus()` 复位光标，且自己写明了后果**：`CONV:9051-9062` 每次应用选区都调 `s.focus({preventScroll:true})`（除带 `skip-selection-focus` 的更新）；`CONV:15362-15370` 注释原文：**"a bare DOM focus on the contenteditable would land the caret at the start instead."** 另有 `CONV:18386-18389` 只做裸 DOM focus、不接 `editor.focus()`。

**合并结论**：逐键英文 → 官方重写 DOM → 靠 `.focus()` 复位光标 → **远程插件 `patchedFocus` 恰好吞掉 composer 的这次 focus** → 光标落在**开头**；中文（`insertCompositionText`）不重写 DOM，所以不需要复位 → **正常** ✓；普通小输入框不是 composer 字段（`isComposerField` 要求 `data-composer-input`）→ **不受影响** ✓。用户那两条实测因此**同时被解释**。
**我先前撤回的原因（横屏也坏）也得到解释**：吞不吞取决于模块内的 `active` 标志，而它只在 `evaluate()`（`resize`/`orientationchange`）跑到时才被改；若平板那条路径没触发重算，**层在两种朝向都仍处于 active** → 两向都坏（推断，未在平板实测）。
**因此归属是「远程插件的 focus 补丁 × 官方输入框依赖 focus 复位」的交互问题，与分组插件无关。**
**最省事的确认**：在平板上**点一下输入框后立刻连续打英文** —— 若最初约 0.8 秒正常、之后就跳（`lastComposerTap` 的 800ms 窗口），即确认；或在远程端控制台执行 `window.__dshRemoteAdapt.setEnabled(false)` 后再打英文，应立刻正常。

### 第四轮：可逆补丁落地（2026-10-21，用户选 A）
- **交付位置**：`E:\DSH\03-DSH-plugins\2026-10-21-remote-web-ui-focus-patch`（任务目录），含 `patch.mjs`（锚点式、`--apply/--restore/--verify`）+ `apply/restore/verify` 三组双击产物（`.bat`=纯 ASCII 启动器、中文在带 BOM 的 `.ps1`）+ `README.md`。
- **改了什么**：只改已装副本 `…\@linxin666\dsh-remote-web-ui\lib\client.js` 的那一处吞掉判断，新增两条**放行**——① 选区/光标已在该字段内；② 该字段 1500ms 内发生过 `beforeinput`/`input`（新增两个捕获监听只用于记时间戳）。带 `BEGIN/END` 哨兵与中文注释，其余零改动；Host 半边 `lib/index.js` 未动。
- **备份两处**（都已独立核对 = 原件 `7256DE3F…FCBB`、245870 字节）：同目录 `client.js.bak-20261021-005906`；`E:\DSH\_backup\20261021-005906\Users\14544\.dsh\profiles\desktop\node_modules\@linxin666\dsh-remote-web-ui\lib\client.js`。
- **补丁前后哈希**：原件 `7256DE3F81D886041291D6CC9C84103A60734D17F4D046EBC4E11A932F18FCBB` → 补丁后 `E4C358DBE2C90D588D8A775C98F1FC390CE44680672BDD31DD5B2E269791F95D`（245870 → 248296 字节，净增 34 行）。
- **我独立跑通的往返（走双击产物）**：`restore.bat` → 哈希**逐字节回到原件**；`apply.bat` → 回到补丁后哈希；`verify.bat` 退出码 0 且正确报状态；`node --check` 退出码 0。**最终状态=已打补丁**。
- **过程中抓到的真缺陷（实现者产出）**：`patch.mjs` 第 1 行 shebang 被写坏成 `!/usr/bin/env node`（丢了 `#`）→ Node 当正则解析 → **三个动作全部抛异常退出**，`apply` 因此一次都没真正生效（而 `restore` 之所以"看似成功"是实现者测往返时已还原、之后没再打上）。修法：补回 `#` 后三者全部正常。**教训与"没试过的回滚=没有回滚"同类：别人说"验证过"不算，必须自己按用户真实路径跑一遍。**
- **待用户实测**：平板刷新页面后打英文。若无效或出现异常 → 双击 `restore.bat` 一键还原（已验证字节级）。
- **已知限制**：插件升级或 DSH 升级覆盖该文件后补丁失效，需重跑 `apply.bat`；本补丁只治"光标跳最前"，不改插件其他行为（保留了它"挂载/切会话不抢焦点"的原意图）。
- **关于"并发写入者"的澄清**（实现者曾报告 01:01:35–01:01:45 有非本会话写入，问是不是冲突）：**那是我（lead）在独立核验**——① 那轮 `apply→restore→apply` 就是我按双击产物跑的往返；② `NOTES.md` 与 `RECON-composer-input.md` 被改是我在写留痕并提交（RECON 由另一个只读调研子代理产出、我提交）；③ `~/.dsh\remote-web-ui-devices.json` 的写入是**远程插件自身的运行期文件**（用户平板在连/刷新），与本次改动无关。**无冲突，无第三方写入者。**
- **用户追加线索（2026-10-21）**：症状二**中文正常、英文逐键跳**，且要求定位是远程插件还是分组插件 → 已定位到**远程插件的移动适配层全局 focus 猴补丁**（证据见下），本项目零涉及。

### 第五轮：补丁被实测证伪 + 已还原 + 交接（2026-10-21）
- **用户复测：打上补丁后"还是跳"** → 我的第一个假设（远程插件吞掉官方 focus 复位）**被实测证伪**（至少不是全部）。按排障规矩：**不在旧假设上再打补丁**。
- **已把插件逐字节还原成原版**（走 \estore.bat\ 同一条路径）：\7256DE3F81D886041291D6CC9C84103A60734D17F4D046EBC4E11A932F18FCBB\、245870 字节、\
ode --check\ exit 0。**不留未验证成功的改动在别人的包里。**
- 被停掉的诊断子代理**未污染目标文件**（已核：FIX 块在、DIAG 块不在、语法有效），只改过任务目录的 \README.md\。
- **真凶仍未确认**，剩余三个待答问题：① 平板到底有没有加载到改动后的脚本（缓存/传输）；② 那个 focus 补丁在平板上 \ctive\ 是真还是假；③ 光标回跳前最后发生了什么事件。**方法（无痕标签页排除缓存 → 屏幕可见诊断层 → 本机模拟手机视口 → 上报上游）已写入交接文档。**
- **交接文档**：\E:\DSH\03-DSH-plugins\2026-10-21-remote-web-ui-focus-patch\HANDOFF.md\（含已确凿结论表、证伪记录、下一步方案 A–D、两条实测坑）。
