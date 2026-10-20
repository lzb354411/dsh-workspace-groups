> 本目录规则：`~/.dsh/AGENTS.md`（全局）+ `../AGENTS.md`（分类）；看不到分类规则时以本 README 与全局规则为准。

# dsh-workspace-groups（DSH 侧栏工作区分组）

## 一、项目说明

给 DeepSeek Harness（DSH）侧栏的工作区列表加**自定义分组**：可以新建/重命名/删除「组」，把真实工作区拖进组里，组内与跨组都能拖动排序，组可以收起/展开并记住状态；官方原本的三视图、会话行菜单、搜索、置顶/归档/派生、快捷键等**一字不改地保留**。

给谁用：本机用户自己（不是多人协作工具）。为什么这么做：官方只提供「按工作区分区 / 按目录树嵌套 / 单列表」三种固定分组，无法自定义类别，也无法把不相关目录放进同一个类别。

**它是怎么实现的（一句话）**：官方 `@deepseek-ai/dsh-client-ui-workspace` 的**客户端半边**被取出来（MIT，逐字副本在 `src/upstream/`），在它上面用**锚点式改动**加了一层分组，产物装成**同名副本包**（`fork/`，版本 `0.2.1-rc.2+wsg.1`）；再由本插件的组合补丁把**内置那一行停用**、让同名副本顶上。为什么必须这么绕：① 官方该条目被**9 个包 `inject`**，名字绝不能改；② `sidebar.workspaces` 的 5 个子槽位（会话行菜单等）**由官方 entry 独占声明**，别人不能重声明——只「遮蔽渲染」会丢功能。

## 二、怎么跑

**装进 DSH（系统级操作；本机已装）**：

```powershell
& "<DSH 安装目录>\resources\runtime\cli\bin\dsh.cmd" `
  plugin --profile desktop add "file:<你的项目目录>/plugin"
```

或双击 `install.bat`。**装完要重启一次 DSH**（组合补丁与 Host 半边都在宿主侧）。

**开发循环（免重装）**：

```powershell
node tools\build-fork.mjs     # 锚点式合成 → fork\lib\client.js（锚点不命中即失败）
node tools\sync.mjs           # 把改好的文件同步进已装副本（只复制、不删文件）
# 然后刷新 DSH 页面即可生效 —— 客户端半边改完【不需要】重装、不需要重启
# Host 半边（plugin\lib\*）改完【需要重启 DSH】才生效（实测）
```

**自测**：

```powershell
node tools\build-fork.mjs --selftest   # 不做任何改动时，产物必须与官方原文逐字节一致
node tools\build-fork.mjs --check      # 产物是否是最新的
node test\run-tests.mjs                # 分组层纯函数单测 + 产物静态断言
node test\host-state.test.mjs          # Host 半边存取逻辑（假 ctx + 临时目录）
```

**卸载 / 回滚（一键）**：双击 `rollback.bat`，它卸掉本插件 → 组合补丁随包消失 → **官方那一行自动恢复**，然后重启 DSH。整份恢复用安装前备份：`<备份根>\_backup\20261020-104056\<用户主目录>\.dsh\profiles\desktop\`。

**分组数据在哪**：`<DSH_HOME>\storages\workspace-groups.json`（人可读 JSON，UTF-8 无 BOM、两空格缩进；覆盖前自动留 `.bak-<时间戳>`，最多 5 份）。最坏情况只丢分组，工作区与会话不受影响。

## 三、开发计划与阶段

| 阶段 | 内容 | 状态 |
|---|---|---|
| 0 找依据 | 本机官方源码 + 官方/社区文档 → `REFERENCES.md` | 已完成 |
| 0 调研 | 两份只读测绘报告 `RECON-ui-workspace.md`、`RECON-client-loader.md` | 已完成 |
| 1 需求 | `SPEC.md`（F1–F13 + 不做什么） | 已完成（用户确认「行，就按这份做」） |
| 2 方案 | `PLAN.md`（选型代价、文件结构、T1–T14、风险登记） | 已完成 |
| 3 实现 | 探路（接管实测）→ 分组层（派生/渲染/收起/增删改/拖动）｜ `PROGRESS.md` 逐任务留痕 | 已完成 |
| 3.5 验证 | 分组层单测 + Host 单测 + **真机逐条验证 F1–F12** | 已完成 |
| 4 独立审查 | `REVIEW-1.md`（1 Critical + 4 Important + 6 Minor；拖动等价性穷举 1132 例 0 差异） | 已完成，修复中 |
| 5 验收 | `ACCEPTANCE.md` 对照 F1–F13 逐条 | 待做 |
| 6 交付 | 本 README + 双击入口 + 回滚 + commit | 待做 |

## 四、Agent 须知

**1) 改动只写在 `src/`，产物不手改**
`fork/lib/client.js` 由 `tools/build-fork.mjs` 生成（官方逐字副本 + `src/patches/patches.mjs` 的锚点改动 + `src/grouping/*.pure.js`/`grouping.js` 的注入段）。**手改产物会在下次构建被覆盖**。

**2) 锚点式改动的纪律**
每条改动写 `{name, find, replace, count}`；锚点用官方原文（Tab 缩进、LF）；**不命中就构建失败**，绝不静默改错。官方升级后按报错提示逐条重新核对锚点与语义；构建里另有上游 SHA256 基线与被依赖标识符存在性断言（见 `tools/README.md`）。

**3) 六条容易踩的坑（都是实测/代码事实）**
- `core.autocrlf=true`：`src/`、`fork/`、`tools/` 下都有 `.gitattributes`（`* -text`）挡住 CRLF 改写，否则逐字副本与 SHA256 断言会崩。
- 本机 asar 解包要用 `tools/extract-upstream.mjs`（`%TEMP%\dsh-asar-study\asar-tool.mjs` 有 8 字节偏移 bug，只能用来 grep 片段）。
- **客户端半边改完刷新即可；Host 半边改完必须重启 DSH**（实测：同步后打路由仍 404）。
- 同名副本的解析归属已实测：从 `profiles\desktop\node_modules\dsh-workspace-groups\` 出发，`@deepseek-ai/dsh-client-ui-workspace` 解析到 profile 里那份（版本带 `+wsg.`），不是 app.asar 原件。
- `sync.mjs` 对 fork 目标有安全闸：目标版本没有 `+wsg.` 后缀（说明还是官方原件）时默认跳过，`--force` 才覆盖。
- 拖动「上半/下半」的语义：官方 `workspaceGroupHalf` 用的是**整个分组块容器**的中线；分组层给**组头行**用的是行自身的中线（落上半=组首、落下半=组尾）。**两者刻意不同，别照抄对方**。

**4) 系统级改动与备份**
改 `~/.dsh/profiles/**` 属系统级操作。本项目的备份：`<备份根>\_backup\20261020-104056\`（安装前 profile）、`<备份根>\_backup\20261020-115438\`（拖动真机测试前的工作区登记）。**回滚方式**：双击 `rollback.bat`。

**5) 浏览器真机验证用的「跳板」（临时产物，不在仓库里）**
`%TEMP%\dsh-asar-study\jump.mjs`：读本机凭据里的「浏览器会话口令」，为浏览器签发会话 cookie 并跳到本机 DSH 界面，便于自动化只读/受控验证。**口令与 cookie 值只在内存中计算、不打印、不落盘**。用完请删掉该临时目录；如需作废旧口令，删除 `~/.dsh/.credentials.yaml` 里的 `client-connection/browser-session` 记录（DSH 下次启动会重新生成）。

## 五、下一步工作

- 等审查报告里的 Critical/Important 修完并**回归复跑**（含真机：改完立刻刷新不丢、多窗口不静默丢分组）。
- 写 `ACCEPTANCE.md`：对照 `SPEC.md` 的 F1–F13 逐条勾，每条贴「怎么验的 + 结果」。
- 交付收尾：临时产物清理清单交给用户确认；本地 commit；按需问是否 push（本机暂无远程）。
- 已知待办（审查 Minor，未修）：列表顶投放指示线在分组层丢失；`.bak` 同秒撞名；拖分组头时不再抑制原生拖入（推断）。

## 六、Git 仓库约定

本机 `git init`，远程仓库 `https://github.com/lzb354411/dsh-workspace-groups`（**公开**，默认分支 `main`，SSH 推送），**不走 PR**。提交信息中文一句话（`类型: 短述`）。本地 commit 免确认；**push 之外的对外动作（改可见性、建 PR、发版）一律先问用户**。提交前自查：无密钥、无 `%TEMP%` 临时产物、无备份文件。

## 七、相关信息

- 需求与验收判据：`SPEC.md`｜方案与风险：`PLAN.md`｜依据清单（12 条来源 + 实测记录）：`REFERENCES.md`
- 逐任务留痕：`PROGRESS.md`｜坑与事故：`NOTES.md`｜独立审查：`REVIEW-1.md`
- 官方测绘：`RECON-ui-workspace.md`（官方代码结构与插点，带行号）、`RECON-client-loader.md`（客户端插件加载机制与外部位、槽位遮蔽规则）
- 关键官方依据：`docs/subsystems/slots.zh.md`（`single` 槽位渲染 priority 胜者；重复声明别人的 child 会激活失败）、`docs/subsystems/web-client.zh.md`
- 本机同类项目参照：`../dsh-desktop-restart-button`（最小插件形态：Host 半边 + Client 半边 + 组合补丁）、`../dsh-balance-widget-patch`
- DSH 版本：`0.2.1-rc.2`（desktop profile）
- **许可**：本项目以 **MIT** 发布（见 `LICENSE`）。其中 `src/upstream/`、`fork/` 基于 DeepSeek Harness 官方包 `@deepseek-ai/dsh-client-ui-workspace`（同为 MIT 许可），其许可证原文保留在 `fork/LICENSE`，来源、字节数与 SHA256 见 `src/upstream/README.md`。
