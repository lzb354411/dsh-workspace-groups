# 参考依据（REFERENCES）

> 查证时间：2026-10-20 ｜ 检索词：`DeepSeek Harness 插件开发 cordis slot`、`cordis 槽位 slot shadow priority single`、`@deepseek-ai/dsh-client-ui-workspace sidebar.workspaces 插件`
> 用途：PLAN 里每个关键决定都能在下表找到来源；找不到的标「我们的判断（无外部依据）」。
> 证据分层：**实测**（我亲手跑过/亲眼看到）> **代码事实**（文件、日志、配置白纸黑字）> **推断**（标注）。

## 〇、查证范围（四层都走过）

| 层 | 是否查过 | 结果 |
|---|---|---|
| ① 本机（安装包 / 官方源码 / 已装依赖） | ✅ | 命中大量，主力依据。asar 用自研无依赖解包脚本读取：`%TEMP%\dsh-asar-study\asar-tool.mjs` |
| ② 官方（官方文档站 / 官方仓库 docs） | ✅ | 命中官方 `docs/subsystems/slots.zh.md`、`web-client.zh.md`（GitHub 官方仓库）；npm 上有官方包页面 |
| ③ 成熟开源（GitHub 同类实现） | ✅ | 命中 3 条：`oil-oil/build-deepseek-harness-plugin`（槽位速查）、`lansi-ai/dsh-forge`（**「接管官方插件槽位」踩坑记录**）、`@prettier-ai/dsh-client-ui-workspace`（第三方重新发布的同名包） |
| ④ 社区（issue / 讨论） | ⬜ 未单独查 | 原因：③ 已给出直接同类经验，且 ① 的源码证据更强；未发现需要社区补充的问题 |

## 一、结论先给

- **推荐做法**：把官方 `@deepseek-ai/dsh-client-ui-workspace` 的**客户端半边**取来（MIT 可复制），加上「自定义分组」层，作为**同一个条目**替换它；用「在 profile 组合补丁里停用内置那一行 + 装一份同名本地副本」的方式接管。
- **关键理由**：① 槽位 `single` 的「最小 priority 渲染」是官方明文的遮蔽机制（S1/S2/S4）；② 官方那一条被 9 个包 `inject` 依赖（实测），**不能停用它的服务名**，所以只能换它的代码、不能换它的名字；③ 官方代码只依赖 5 个模块，且全在平台模块表里（实测）。
- **已知风险**：接管即接管整份列表代码，DSH 升级后要重新 diff 同步（S5 同类经验同样提到）；「停用内置行」这条补丁能力**尚未实测**（见第四节）。

## 二、来源表

| # | 来源 | 类型 | 链接 / 位置 | 它说什么 | 我们怎么用 | 许可证 |
|---|---|---|---|---|---|---|
| S1 | DSH 官方文档 · Web Client Slots | 官方文档 | [slots.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/slots.zh.md) | `single` = 「单个 cell，**渲染当前 priority 胜者**」；「复用已有 cell 表示**有意替换**其展示」；「向未声明 slot 注册，或**重复声明其他 entry 已拥有的 child，都会在插件激活时失败**」 | 定案：接管方式 = 复用同一 cell，且**必须**由我们自己声明那些 child | 官方文档 |
| S2 | 槽位注册表实现（前端 shell bundle 内） | 代码事实 | `app.asar/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-*.js`（偏移 ~487529 / ~489409） | 同 `single` 槽位在**同一 priority** 再注册会抛错，并提示 `register at a different priority to shadow it (lowest renders)`；条目按 `priority ?? 0` 升序排列 | 官方注册未写 priority（=0），我们写 `-1` 即可合法成为胜者 | 官方代码 |
| S3 | 槽位渲染器 | 代码事实 | `@deepseek-ai/dsh-client-ui-renderer/lib/client.js`（`renderOutletContent`） | `if (spec.kind === "single") { const entry = host.entriesOfSlot(slotKey)[0]; ... }` —— 取排序后第一个渲染 | 与 S2 互证：priority 最小者渲染 | MIT |
| S4 | 平台模块表（浏览器侧种子模块） | 代码事实 | `dsh-web-frontend/dist/assets/index-*.js` 内 `function SZ(){...}` | 种子共 11 个：`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、`zod`、`@tanstack/react-virtual`、`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-ui-dockkit` | 官方 `ui-workspace` 的 5 个 require 全在种子里 → 复制其代码可行 | 官方代码 |
| S5 | `lansi-ai/dsh-forge` 踩坑记录 | 开源项目 | [pitfalls.md](https://github.com/lansi-ai/dsh-forge/blob/v0.1.1-rc.3/docs/pitfalls.md) | 「接管官方插件的槽位」不止要对齐服务与 root hooks，还**必须对齐槽位名 + kind + scope**；上游插件用 `slots.inject(<槽位名>)` 等待父槽位 | 我们的接管必须逐字对齐：槽位名 `sidebar.workspaces`、`kind: single`、`scope: root` | 见仓库 |
| S6 | `oil-oil/build-deepseek-harness-plugin` 槽位速查 | 开源项目 | [client-slots-and-theme.md](https://github.com/oil-oil/build-deepseek-harness-plugin/blob/main/references/client-slots-and-theme.md) | 逐槽位说明；明确提示 **「single 替换会丢掉子槽位，除非你重声明 children」** | 与 S1 一致：替换者必须自己声明 children → 因此不能与官方那份并存 | 见仓库 |
| S7 | 官方 `ui-workspace` 包（客户端半边） | 代码事实 | `app.asar/dsh/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js`（5355 行 / 232 KB） | 全文只 `require` 5 个说明符（L7–11）；`exports.apply/inject`（L5349-5350）；注册进 `sidebar.workspaces`（L5220-5251，**无 id、无 priority**），并在 `children` 里声明 5 个子槽位；`LICENSE` 为 MIT | **复制它**作为我们的实现基底，加分组层 | MIT |
| S8 | 官方 `ui-sidebar` 包 | 代码事实 | `.../dsh-client-ui-sidebar/lib/client.js:507-510` | `"sidebar.workspaces": { kind: "single", scope: "root" }` | 接管的目标槽位规格 | MIT |
| S9 | 客户端启动图（运行时实测） | **实测** | 我的浏览器页面内 `window.__DSH_BOOT__` | `@deepseek-ai/dsh-client-ui-workspace` 这一条目被 **9 个包 `inject`**（ui-sidebar / ui-conversation / ui-chat / ui-workflow-run / ui-subagent / ui-schedule / ui-agent-preset / agent-team / directory-picker-native） | **该条目的「名字/服务」不能停用**，只能换它加载的代码 | 实测 |
| S10 | profile 组合与补丁语法 | 代码事实 | `@deepseek-ai/dsh-plugin-manager/lib/index.js`（`writePluginEnabled` / `composeEntries`）+ `~/.dsh/cordis.patch.yml` | 补丁是一个 YAML 序列：`- insert: [...]` 追加条目；`- id: <条目id>` + `disabled: true` 是官方的**启用/停用**写法；`name` 也参与条目匹配 | 用 `- id: <内置行 id> disabled: true` 停用内置那一行（**待实测**） | MIT |
| S11 | 官方 `desktop-runtime.json` 清单 | 代码事实 | `app.asar/dsh/desktop-runtime.json`（105k 行） | 内置包以**显式相对路径**（`node_modules/@deepseek-ai/...`）登记 | ⇒ 想「在 profile 里放同名包去遮蔽内置包」**不成立**（内置解析不走 profile）→ 必须显式停用内置行 | 官方代码 |
| S12 | `@prettier-ai/dsh-client-ui-workspace` | 开源/第三方发布 | [npm](https://www.npmjs.com/package/@prettier-ai/dsh-client-ui-workspace) | 存在第三方**重新发布**的同名功能包（说明「换一份工作区浏览器」是社区做过的路） | 佐证方向可行；不直接复用（来源不明、版本对不上） | 未核查 |

## 三、实测记录（本机探针，2026-10-20）

探针插件 `dsh-workspace-groups@0.0.1`（装进 desktop profile，备份见 NOTES）。在我的浏览器页面内实测：

| 项 | 结果 |
|---|---|
| 插件是否被装载 | ✅ `__DSH_BOOT__.entries` 出现 `dsh-workspace-groups`，`apply` 执行成功 |
| 9 个官方模块能否 require | ✅ 全部成功：`react`(37)、`react/jsx-runtime`(4)、`react-dom`(13)、`@deepseek-ai/cordis`(26)、`dsh-client-store`(4)、`dsh-client-ui-slots`(5)、`dsh-client-ui-primitives`(**288**)、`dsh-client-ui-workspace`(2: `apply`/`inject`)、`dsh-client-ui-renderer`(3: 含 `SlotRegistry`) |
| `priority: -1` 接管 occupied `single` 槽位 | ✅ `sidebar.brand.name` 抢占成立（官方那条 priority 0 仍在，但渲染的是我们的） |
| 接管 `sidebar.workspaces` | ✅ 官方列表被换掉；撤销后**原样恢复** |
| 改文件后是否要重装/重启 | ✅ **不用**：把文件同步进已装副本 + 刷新页面即生效（boot wire 的 `rev` 随之变化） |
| 重声明官方已拥有的子槽位 | ❌ 抛错：`slot "sidebar.workspaces.directoryFlow" is already declared (by an entry in "sidebar.workspaces")` |
| 中文直写（UTF-8） | ✅ 正常 |

## 四、还没证实 / 推断（写进 PLAN 的风险栏）

- **停用内置行**（`- id: <内置行 id> disabled: true`，S10）**是推断**：语法本身来自官方代码，但「用我们自己 bundle 的补丁去停用别的内置 bundle 的行」没有实测。需要一次带重启的实验。
- **同名本地副本的解析**：把我们的 fork 以 `@deepseek-ai/dsh-client-ui-workspace` 之名装进 profile，再由我们自己的补丁插一行 `name` 同名 —— 解析基座在 profile 之内时应当命中我们的副本（Node 解析顺序），**但未实测**。
- 内置行 id 的确切拼写未取到：`dsh-web-app/cordis.patch.yml` 里应有该行（**待读，30 秒的事**）。
- `persist: "dsh.workspace.view.v5"` 是否为 localStorage 键：实现不在本机 asar 内，**未证**（真机上可查）。
- 「一个 session 的浏览器页面各自持有独立的插件实例」：**实测**（我刷新我的页面只影响我这一个页面；用户窗口未受影响）。

## 五、我们的判断（无外部依据，风险自负）

- 判定「DOM 层注e入分组头」不可行：依据是官方动画组件只认带 `data-row-key` 的行、且跨组排序写不回 Host（代码事实，来自 `RECON-ui-workspace.md`），属**代码事实**级推断。
- 若「停用内置行」实测失败，则退回「删掉你窗口里的官方列表、由我们的副本顶一个不同名字的条目」——但那一版会失去 9 个包对该条目的等待，**判定为不可接受**（会连锁影响侧栏/会话区），因此 PLAN 里把它列为止损线。
