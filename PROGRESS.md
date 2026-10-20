# PROGRESS — dsh-workspace-groups

> 计划：PLAN.md ｜ 隔离：本项目 `git init`（新项目）；系统级改动前已备份 profile → `<备份根>\_backup\20261020-104056\<用户主目录>\.dsh\profiles\desktop\` ｜ 开始：2026-10-20 10:05

## 基线（不动一行代码时的事实）

- 桌面端 DSH `0.2.1-rc.2` 侧栏工作区浏览器**工作正常**（我的浏览器页面实测：`[data-slot="sidebar.workspaces"]` 内有官方 `_9lTDKa_root`，列出 01-local-software / 02-agent-skills / 03-DSH-plugins）。
- profile 安装前基线：`dsh.profile.bundles` = 22 项，`node_modules/.modules.yaml` 已备份。
- 我通过本机跳板（把浏览器会话 cookie 签发到自己浏览器）能看到并操作这台机器上真实运行的 DSH 界面 —— 仅用于**只读观察与我自己页面内的实验**。

## 任务进度

- 任务 1 ✅ ｜ 探路插件装上并跑通（探针面板 + 接管实测）｜ 自测：我的浏览器内实测 —— `__DSH_BOOT__.entries` 出现 `dsh-workspace-groups`；9 个官方模块 require 全部成功（primitives 288 导出）；`priority:-1` 接管 `sidebar.brand.name` 与 `sidebar.workspaces` 均成立，撤销后官方列表原样恢复；改文件同步 + 刷新即生效，**不需要重装/重启** ｜ 10:37
- 任务 2 ✅ ｜ 改：`plugin/cordis.patch.yml`（停用内置行 `ui-workspace` + 插我们的行 + 插同名副本行）、`plugin/package.json`（加 fork 依赖）｜ 自测：`cordis.patch.yml` 三件事齐备；内置行 id `ui-workspace` 来自官方 `dsh-web-app/cordis.patch.yml` 原文（代码事实）｜ 11:12
- 任务 3 ✅ ｜ 改：`src/upstream/*`（官方逐字副本 232747B，SHA256 `4dd7f3c5…60dc17`，并用 asar 自带 integrity 9/9 校验）、`fork/*`（同名副本 `0.2.1-rc.2+wsg.1`）｜ 自测：`fork/lib/index.js` 与官方逐字一致；`fork/lib/client.js` 232849B `30adf5f8…36667d`；由 `fork-builder` 执行并本地提交 ｜ 11:30
- 任务 4 ✅ ｜ 改：`tools/build-fork.mjs`（锚点式合成器）、`tools/sync.mjs`、`tools/extract-upstream.mjs`、`src/patches/patches.mjs` ｜ 自测：**空改动时产物与官方原文逐字节一致**（同一 SHA256 `4dd7f3c5…60dc17`，并在全新 git clone 里复跑通过）；把锚点故意写错 → 退出码 1、打印 patch 名/期望 1/实际 0/锚点原文、且不写文件 ｜ 11:30
- 任务 5 ⏳ 进行中（等用户重启）｜ 装 fork + 停用内置行 → 重启一次 → 验证接管 ｜ 已完成的**重启前校验**（都实测）：
  - 组合补丁语法：`dsh --profile web --dump-config --patch <我们的补丁>` → exit 0；导出树里 `- id: ui-workspace` 已带 `disabled: true`（并标注 patched by 我们的文件）；我们的两行 `dsh-workspace-groups` 与 `ui-workspace-groups`（name 同名）都在 ｜ 11:44
  - 解析归属：从 `profiles\desktop\node_modules\dsh-workspace-groups\` 出发 `require.resolve('@deepseek-ai/dsh-client-ui-workspace/package.json')` → `...\profiles\desktop\node_modules\@deepseek-ai\dsh-client-ui-workspace\package.json`，**version=`0.2.1-rc.2+wsg.1`（我们的 fork，不是 app.asar 里的官方原件）** ｜ 11:46
  - 已装副本 7 个文件哈希全部一致（`tools/sync.mjs`：复制 0、一致 7、失败 0）｜ 11:40
  - profile 的 `dependencies` 里**没有**多出同名依赖（它是我们插件的传递依赖），`dsh.profile.bundles` 仍是 23 项、未出现重复行 ｜ 11:40
- 重启后要查的两个标记：页面里 `globalThis.__wsgForkLoaded === "0.2.1-rc.2+wsg.1"`；侧栏标题出现「工作区 · WSG」。
- 任务 5 ✅ **关键实验通过（重启后实测）** ｜ 用户重启 DSH（新端口 36127）后我在浏览器里实测：
  - `globalThis.__wsgForkLoaded === "0.2.1-rc.2+wsg.1"` → **官方那个条目跑的是我们的 fork**，不是 app.asar 里的原件
  - 侧栏标题 = 「**工作区 · WSG**」→ 我们的构建产物确实在渲染
  - 侧栏功能正常：`工作区 · WSG / 01-local-software / 02-agent-skills / 03-DSH-plugins / 新会话 / 进行中 / DSH工作区分组插件开发…` → **没有功能退化**
  - `__DSH_BOOT__.entries` 里 `@deepseek-ai/dsh-client-ui-workspace` 仍在（条目名未变），**9 个 inject 它的包照旧满足**
  - 我们的探针包同时在线（`window.__wsgProbe` 存在）
  → 结论：**「停用内置行 + 同名副本」这条路成立**，可以放心在上面长分组功能。
- 任务 6 ✅ 代码完成 / ⏳ 真机未生效 ｜ Host 半边：`plugin/lib/index.js`（路由接线）+ `plugin/lib/state-store.js`（纯函数 + 文件 IO）+ `test/host-state.test.mjs` ｜ 自测：`node test\host-state.test.mjs` → **通过 19 ｜ 失败 0**（假 ctx + 临时目录）｜ 选路：用 `node:fs` 自写 `<DSH_HOME>\storages\workspace-groups.json`，**不用**官方存储服务（依据：存储族公共入口是域形态且需 zod schema；profile 的 node_modules 里实测没有 storage 家族包 → 运行期 import 不到，插件会在注册期就崩）｜ 11:5x
- **实测发现：改 Host 半边文件后不热加载** ｜ 把新 `index.js` + `state-store.js` 同步进已装副本后，从浏览器打 `GET /dsh-workspace-groups/state` → **404**（`POST` → 405，且都不是 SPA 的 HTML，说明路由根本没注册）；宿主没有插件日志（`dsh-desktop\logs\` 只有崩溃日志）→ 判定为「Host 侧需要重启才生效」，与 Client 半边「刷新即生效」不同。**处置：不单独为它重启，等下一次重启时一并生效**；期间客户端按契约的失败兜底（拿不到状态 → 空状态 → 所有工作区落「未分组」）仍可验证界面。
- 任务 6 ✅ **真机生效**（第二次重启后）｜ 契约实测：`GET /dsh-workspace-groups/state` → 200 + 合法空状态；无头 `POST` → 403 `{"ok":false,"error":"missing-request-header"}`；合法 `POST` → 200 且回带 `{ok,bytes,backup}`（备份文件真的生成 `.bak-20261020-115718`）｜ 落盘 `~/.dsh/storages/workspace-groups.json`：UTF-8 无 BOM、两空格缩进、结尾换行、人可读
- 任务 7-11 ✅ **真机全部通过** ｜ F7 拖工作区进组（`membership` 立刻写入 + 界面换位 + 刷新后保持）｜ F10 组内/跨组拖动排序（`before`/`after` **两种语义都生效**）｜ F13 残骸清理（塞一条指向"不存在的工作区"的归属 → 客户端加载后**自动清掉并写回干净状态**，Host 上该条消失、组里无空壳行）｜ 测试数据已全部清除、工作区顺序精确恢复（与快照逐项一致）、0 个 `[data-slot-error]`
- 【澄清·重要】我一度误判「下半区被忽略」是 bug：官方 `workspaceGroupHalf`（`src/upstream/ui-workspace.client.js:3001-3004`）用的是 **`e.currentTarget`（整个分组块）的中线**，不是行中线；用官方**未改动**的树模式路径做同样对照得到**完全一致**结果 → 我方拖动接管保留了官方语义，**无偏差**
- 测试期间的安全动作：拖前备份 `workspace.json` + `workspace-groups.json` → `<备份根>\_backup\20261020-115438\<用户主目录>\.dsh\storages\`
- 任务 12 ✅ ｜ 自动测试收口 ｜ `node test\run-tests.mjs` = **49 项通过 0 失败**（含把审查员的 1132 例拖动等价性穷举**固化进仓库**）；`node test\host-state.test.mjs` = **19 项通过**
- 任务 13 ✅ ｜ 独立审查（`reviewer-2`，报告 `REVIEW-1.md`）：1 Critical + 4 Important + 6 Minor；**全部处置**（Critical 按比例处理并写进 README 已知边界；I1–I4 已修；Minor 修 3 留 3 并记录）
- 任务 14 ✅ ｜ 验收：`ACCEPTANCE.md` 对照 F1–F13 逐条，**13/13 通过**（F2 曾不通过 → 修复 → 只重验该条）
- 任务 15（交付）✅ ｜ `README.md` 七节 + `install.bat`/`rollback.bat`（ASCII 启动器 + 带 BOM 的 `.ps1`）真跑通过 + 本地 commit `e92386a` ｜ 交付前发现并修掉 `rollback.bat` 被 cmd 按 GBK 拆坏的缺陷（详见 `NOTES.md`）
- **待用户**：重启 DSH 后自己用一遍并给验收结论；临时产物是否清理（清单见 `ACCEPTANCE.md` 附三）；是否作废浏览器会话口令

## 关键事实（供续跑，别重查）

- 接管机制（代码事实 + 实测）：`single` 槽位按 `priority` 升序取第一个渲染；官方未写 priority（=0），我们写 `-1` 即为胜者。
- 子槽位不可重声明（实测报错）：`slot "sidebar.workspaces.directoryFlow" is already declared` → 所以必须**换掉官方那份代码本身**，不能只遮蔽渲染。
- 该客户端条目被 **9 个包 inject**（实测 `__DSH_BOOT__`）→ 条目名必须保持 `@deepseek-ai/dsh-client-ui-workspace`。
- 平台模块表种子 11 个，官方那份代码只 require 5 个，全在种子里（实测全部可 require）。
- 每解决一个「浏览器页面各自持有独立插件实例」的事实：**我的实验不会影响用户窗口**；用户只在刷新/重启后才看到变化。
