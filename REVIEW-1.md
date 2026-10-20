# REVIEW-1 —— dsh-workspace-groups 独立只读审查（HEAD a72df53）

> 审查员：reviewer-2（独立、只读）｜时间：2026-10-20｜本轮未做任何写操作（只写本文件）
> 结论分层：实测 > 代码事实 > 推断。每条都给了 `文件:行号` 或命令原文。
> **审查对象 = commit `a72df53`**（审查开始时 `git status --porcelain` 为空）。**审查期间工作树被改动了**（`PROGRESS.md` / `src/patches/patches.mjs` / `fork/lib/client.js`）：实现者删掉了两条「侧栏标题加 · WSG」的临时标记 patch。因此下文 **Minor 5 已自动修复**，`patches.mjs` 现在是 **6 条 patch + 1 段注入**；`src/grouping/*.js`（含 `grouping.js`、`anchor.pure.js`）与上游副本**未被改动**，所以拖动等价性、渲染插点、契约三块的结论仍然适用于当前工作树。
> 已跑的两条只读命令（**改动后重跑过**）：`node tools\build-fork.mjs --check` → 6 条锚点各命中 1 次、产物与现有 `fork/lib/client.js` SHA256 一致、`node:vm` 语法通过；`node test\run-tests.mjs` → **39 通过 / 0 失败**。行号已按改动后的文件核对：`patches.mjs` 的 A 条注入判断 `if (!nestWorkspaces)` 在 `:39`、B 条 ctx 在 `:54-64`；数组条目＝探针 `:80-85`、A `:86-91`、B `:92-97`、C `:98-103`、D `:104-109`；常量＝A `:30`、B `:47`、C `:68`、D `:72`。

## 一句话结论

**最高风险项（拖动接管等价性）经穷举对照后是等价的，可以放心；但有 1 条 Critical：客户端没有并发写保护，多窗口/多标签下"整份状态覆盖"会静默丢掉刚建的分组（只能靠 `.bak` 手工找回）。** 另有 4 条 Important（写回交付保证、加载失败即允许写回、按未就绪的工作区列表自动清洗回写、升级后"沉默失败"的锚点脆弱度）。

## Critical

### C1 多窗口（多标签/客户端+浏览器）下的整份状态覆盖 → 静默丢分组
- **现象**：窗口 A 打开时加载了状态 S；窗口 B 里新建了分组 G（Host 文件变成 S+G）；此后在窗口 A 里做**任意一次**改动（改名/拖动/收起之外的分组变更）→ A 把它的整份快照 POST 上去 → G 从磁盘消失。B 的界面仍显示 G，刷新即没了。
- **证据**：
  - 客户端每次写回都是**整份状态**：`src/grouping/grouping.js:283-286`（`WSG_commit` → `WSG_writer().queue(next)`）、`src/grouping/grouping.js:246-260`（POST body = `JSON.stringify(body)`）。
  - 载入只在开机做一次，之后不再 GET：`src/grouping/grouping.js:288-296`（`WSG_booted` 一次性；`WSG_boot` 无重试/无轮询）。
  - Host 端**没有任何时序/冲突字段**：`plugin/lib/state-store.js:75-112`（`validateState` 只查形状：version/groups/membership）、`:232-293`（`writeState` 直接覆盖，唯一"版本"是 `SUPPORTED_VERSION=1` 这个形状版本）。
  - 本环境"每个页面各自持有插件实例"是项目自己记录的实测事实：`PROGRESS.md:41`。
- **影响**：用户真实数据静默丢失（界面不报错、不回滚）。缓解事实：每次写入前留 `.bak-<时间戳>`、最多 5 份（`state-store.js:144-181`、`:246`），所以还有救——但要用户"事后发现 + 手工恢复"，而 5 次写入之后旧备份就被裁掉了。
- **未实测声明**：只读审查，没有开两个窗口做这个实验（那会写用户真实的 `~/.dsh/storages/workspace-groups.json`）。上面的因果链全部由代码事实推出，"两个窗口同时存在"这一前提来自 `PROGRESS.md:41`。
- **建议改法（按代价从低到高）**：①最低成本：`window` 的 `focus`/`visibilitychange` 时重新 `GET` 一次并替换快照（把覆盖窗口从"整个会话"缩到"焦点切换之间"）；②契约加 `rev`/`updatedAt`（Host 写入时自增），POST 带 `rev`，不匹配 → `409`，客户端收到 `409` 先 GET 再合并；③写回前先 GET 比对。任选一条即可，②最稳。

## Important

### I1 写回没有交付保证（卸载丢改动 / 乱序落盘 / 失败无感）
- **现象**：①改动后 500ms 内刷新或关窗口 → 这一次改动丢；②两次写回间隔 ≥500ms 时，两个 POST 并发不排序，后发的可能先落盘；③POST 非 2xx 只打一条 console.warn，界面不回滚、不重试、不提示。
- **证据**：`src/grouping/grouping.js:246-260`（`WSG_postState` 失败只 `console.warn`；调用处 `grouping.js:274-276` 不 await 上一个请求，无 Promise 链）；**`grouping.js` 全文没有 `flush`/`beforeunload`/`pagehide`/`visibilitychange`**（grep 该文件只命中 `WSG_writerInstance` 三行，即 `writer.pure.js:24-35` 的 `flush()` **只有单测在用**）；`plugin/lib/index.js:160-173`（Host 只保证单次写原子，无序号）。
- **影响**：用户"以为存住了"的改动会丢；乱序落盘时磁盘上可能是被覆盖前的旧状态。
- **建议**：`WSG_postState` 串成一条 `finally` 链（`WSG_pending = WSG_pending.then(...)`）保证顺序；`pagehide`/`visibilitychange→hidden` 时调 `WSG_writer().flush()`（`flush` 已存在，直接接线）；写失败在组头区域显示一行"⚠ 未保存"并提供重试按钮。

### I2 读失败 → 以空状态继续渲染，并且在拿到真实状态之前就允许写回
- **现象**：GET 失败（路由还没注册/抖动）时快照被设成空状态，且没有任何"未加载"标志；此期间用户第一次操作（新建分组等）会 POST 一份"几乎空"的状态 → 若此时 Host 已能收，就把磁盘上的真状态覆盖掉。
- **证据**：`grouping.js:240-243`（GET 失败 → `WSG_emptyState()`）、`:288-296`（只加载一次、不重试）、`:283-286`（任何 `WSG_commit` 都无条件写回）。这正是 `PROGRESS.md:31` 记录的窗口（Host 路由未生效期 GET → 404）。
- **影响**：丢全部分组（有 `.bak` 兜底），且用户完全无感。
- **建议**：快照加 `loaded:false`；未 loaded 前 `WSG_commit` 只改内存不 POST；`WSG_loadState` 失败按退避重试（例如 2s/5s/15s 三次）。

### I3 按"当前工作区列表"自动清洗 membership 并回写 —— 列表未就绪时会把归属当残骸清掉
- **现象**：投影阶段发现 membership 里有"当前工作区列表里没有的 id"就当残骸丢掉，并立刻把清洗后的整份状态写回 Host。工作区列表在官方自己都认为"没就绪"的时候可能是不完整的。
- **证据**：`grouping.js:417`（`workspaceIds = ctx.workspaces.length > 0 ? … : void 0`，只用"非空"判定，没有 ready 位）、`:418-428`（`changed` → `WSG_commit(projected.state)`）；`grouping.js` 对应上游官方是**另一个门**：`src/upstream/ui-workspace.client.js:3542`（官方 `workspaceReady = workspacePhase === "ready" && workspaceStreamState !== "loading"`）、`:3516`（列表来自 `useWorkspaces(state => state.items)` 的流式状态）；patch B 传进去的 ctx（`src/patches/patches.mjs:54-64`）里根本没有这个 ready 位。
- **影响**：刚打开页面/流式未完的那几帧里，尚未到位的工作区会被判"已删"，归属被清掉并**落盘**（刷新也回不来）。界面看起来"没问题"，所以极难发现。
- **未实测声明**：**这是推断**。我不能确认 `items` 在 `phase!=="ready"` 期间真的会不完整（只读审查，不能加日志/不能跑起来看）；但"用未就绪的输入做破坏性落盘"这个结构本身已经足够危险。
- **建议**：ctx 加 `ready`；`!ready` 时 `workspaceIds` 传 `undefined`（纯函数本来就支持这个分支：`src/grouping/project.pure.js:81`、`:87`，且 `test/run-tests.mjs:127` 已覆盖）。更稳的做法：**不要自动落盘清洗结果** —— Host 明确允许悬空 membership（`state-store.js:66-69`），界面也本来就忽略它（`project.pure.js:209-211`），F13 只要求"界面无残骸"。

### I4 升级脆弱度：锚点 A/B 是"锚点还在、语义已变"型失败，构建捕捉不到
- **现象**：现在 6 条锚点（+1 段注入）只校验"官方原文里这段片段还在、且恰好命中 1 次"。官方升级后如果**改的是锚点以外的行**（改名/加参数），构建照样全绿，但注入层已经错了：
  - `nestWorkspaces` 被改名 → `ctx.nestWorkspaces !== true` 恒为 true（`grouping.js:404`）→ **tree 模式也被当成 workspace 模式接管**；同一条条件在 A 锚点里也是 `if (!nestWorkspaces)`（`patches.mjs:39`）→ 官方按树拖动的逻辑被整段短路。这是**沉默的错**，不崩、不报错。
  - `rowKeys` / `setWorkspaceDrag` / `renderGroup` / `t` 等被改名 → 注入层引用一个不存在的标识符 → 侧栏渲染期 `ReferenceError`（白屏）；而 `node:vm` 只做语法解析（构建日志里的 `[语法] 产物 JS 解析通过 ✅`），未定义标识符是合法语法。
- **证据（脆弱度的另一半：没有上游指纹断言）**：`tools/build-fork.mjs` 里 `sha256` 只用于打印与"产物是否最新"（grep 命中 `:48`、`:216-219`、`:294-301`、`:313-314`），**没有与常量比对的上游哈希**；`patches.mjs:54-64` 的 ctx 是手抄标识符表。
- **影响**：升级 DSH 后功能静默变错/白屏，而 CI 式的 `--check` 给的是"全绿"。
- **建议**：①把当前上游 SHA256（`4dd7f3c5…60dc17`）写成常量，提取/构建时断言，升级即硬失败强制人工确认；②加一条静态断言：注入层用到的自由标识符清单（`nestWorkspaces`/`rowKeys`/`renderGroup`/`rootGroups`/`workspaces`/`workspaceDrag`/`setWorkspaceDrag`/`commitWorkspaceDrag`/`insertWorkspaceBefore`/`t`/`react`/`react_jsx_runtime`/`_deepseek_ai_dsh_client_ui_primitives`/`Rows_module_css_default`）必须在 upstream 文本里各出现 ≥1 次。这两条都是几十行代码，能把"沉默失败"变成"构建失败"。

## Minor

1. **`half` 的默认方向与官方相反**：官方 `over.half === "before" ? over.id : 下一个`（`ui-workspace.client.js:3128`），新实现是 `over.half === "after" ? 下一个 : over.id`（`anchor.pure.js:76-81`、`:85`）。生产调用点只会给 `"before"/"after"`（`ui-workspace.client.js:1934`、`:3003`，`grouping.js:374`），所以今天不可达；但"值意外为空时插到哪"两边不一样，建议显式 `half === "before" ? … : …`，别用反向默认。
2. **契约分歧：空组名**。客户端清洗保留空字符串名字（`project.pure.js:73`），Host 直接 400（`state-store.js:91-93`）。今天不可达（UI 挡了空名，`grouping.js:447-451`），但一旦有一份这样的状态，**整个状态写不进去**（整份 POST 被拒），界面却照旧显示。
3. **拖动分组头时不再抑制"原生拖入"**：官方在拖动期间会 `preventDefault` 全局 dragover/drop（`ui-workspace.client.js:3035-3036` 的 `nativeDragActive` 只含 `drag`/`workspaceDrag`），而分组头的拖动状态是分组层自己的 `groupDrag`（`grouping.js:412`）从未并进去。推断（未实测）：拖分组头时把一个文件夹拖到侧栏，官方"从文件夹建工作区"仍可能被触发。
4. **列表顶部投放指示线在分组层丢失**：`ui-workspace.client.js:3150` 要求 `workspaceDrag.over.id`，而分组头投放给的是 `{groupId, half}`（`grouping.js:598`）→ 拖到最上面那条工作区时不再显示官方那条蓝色指示线（功能不受影响，只是少了视觉反馈）。
5. ~~**官方标题被永久改写**~~ → **已在工作树中修复**：原先改「工作区 · WSG / Workspaces · WSG」的两条标记 patch 已被实现者删除（我重跑 `--check`：6 条锚点全绿、产物已重新生成、语言包里两条文案恢复官方原文）。留下的 `globalThis.__wsgForkLoaded` 探针不进界面，可接受。
6. **备份同秒撞名**：`state-store.js:159` 已自陈"同一秒内连续写两次会落到同一个备份名上"，配合 I1 的乱序/连写，等于可用备份份数可能少于 5。

## patch 的影响面（逐条；审查起点 8 条，现为 **6 条 patch + 1 段注入**）

| # | patch（行号已按改动后的文件核对） | 影响面 | 结论 |
|---|---|---|---|
| 1 | 探针 `globalThis.__wsgForkLoaded`（`:80-85`，find/replace 在 `:82-83`） | 只加一个全局字符串 | 无副作用；不出现在界面 |
| 2 | A：拖动提交（`:86-91`；注入判断 `if (!nestWorkspaces)` 在 `:39`） | 仅 `groupBy==="workspace"` | **已核对**：`SessionTree` 只在 `groupBy !== "flat"` 时渲染（`ui-workspace.client.js:3978` vs `:3994`），搜索态走 `SearchResults`（`:3965`），所以 `SessionTree` 里 `!nestWorkspaces` ⟺ `groupBy==="workspace"`。树的模式一字不动。守卫两行（`workspaceDropCommitted` + `setWorkspaceDrag(null)`）保留在短路之前（`patches.mjs:39-43` + `ui-workspace.client.js:3120-3123`） |
| 3 | B：顶层渲染（`:92-97`；ctx 在 `:54-64`） | 仅 workspace 模式改行序；其余原样透传 | `grouping.js:431-434` 逐字等价于官方的 `rootGroups.map(g => renderGroup(g, 0))` |
| 4 | C：工作区菜单加项（`:98-103`） | tree/flat 下 `moveMenuItems` 返回 `[]`（`grouping.js:337`），数组仍是 `[rename, delete]` | `group` 在作用域内（`ui-workspace.client.js:1950` 的 `ProjectRowItem({group})`）；`ProjectRowItem` 全文件只有一处使用（`:3223`，仅 SessionTree），不会泄漏到目录选择器/悬浮卡 |
| 5 | D：菜单选择（`:104-109`） | 只拦 `wsg-move:` 前缀（`grouping.js:362`），`rename/delete` 原样交回官方 | 对未分组桶（`group.workspaceId === undefined`）也不会误进（菜单项为空） |
| 6 | 注入分组层（构建日志里那条注入段，现为最后一条） | 只在 workspace 模式下被调用/渲染 | 注入段 41008 字节，产物解析通过 |
| — | ~~中文/英文标题标记（原 `:84-88`/`:90-94`）~~ | **已删除** | 修掉了本报告的 Minor 5；现在侧栏文案与官方逐字一致 |

**没有任何一条 patch 会在 `groupBy !== "workspace"` 时改变官方行为** —— 依据是上面第 4/5/6 行的三处代码事实（`!nestWorkspaces` ⟺ workspace 模式；`moveMenuItems` 的模式闸门），加上渲染透传（`grouping.js:431-434`）。唯一的"跨模式"副作用是 hooks/effect 仍会跑：`grouping.js:413-415`（`WSG_boot()`，tree/flat 下也会 GET 一次）与 `:425-428`（清洗回写，见 I3）。

## 风险 ①"拖动接管等价性"的结论与证据

**结论：等价（在今天这份上游代码上）。** 我把官方下标算术（`ui-workspace.client.js:3124-3132`，workspace 模式下 `parents` 是空 Map → `siblings` 就是 Host 全序，`:3048`）与新实现（`anchor.pure.js:91-98` 的模拟搬运）做穷举对照——**实测**（Node 只读内存跑，未写任何文件）：

```
对比用例总数: 1132  差异: 0
```
（1~4 个工作区的全部排列 × 每个拖动源 × 每个投放行含一个不存在的 id × before/after；同时比对"要不要调 `insertWorkspaceBefore`"和"anchor 的值"两个维度。）

逐情形对照（官方的 6 种 no-op 全部在新实现里也是 no-op）：
- `rowIndex === -1`（`over` 找不到）→ `anchor.pure.js:83` 返回 null ✔
- `anchor === 自己`（落在自己上半）+ `anchorIndex === sourceIndex`（落在自己下半）→ 模拟搬运后序列不变 → `:98` 返回 null ✔（单测 C8/C9 覆盖；穷举覆盖了全部排列）
- `anchorIndex === sourceIndex + 1`（拖到自己正后方）→ 同上 ✔
- `over` 为空/非对象 → `:67` ✔
- 源与目标是同一个 workspace（`over.id === 拖动源`）→ 序列不变 + 归属不变 → `:100` ✔
- `siblings` 判定：workspace 模式下 `parents` 空 Map，`parents.get(x)` 恒 undefined → 官方"同父才允许投放"的分支对所有人都成立（`:3155`、`:3180`），新实现不参与这个判定，但**也没有放宽**：放宽与否由官方那条分支决定，行为一致 ✔
- `anchor === undefined` 的语义：官方自己就用它表达"最后一个兄弟之后"（`:3128` 的 `siblings[rowIndex+1]?.workspaceId`），新实现同值同处（`anchor.pure.js:22-26` 末尾 → undefined，`:93` 追加末尾）。**未确认部分**：`undefined` 最终由官方 workspace store 的 `insertBefore(workspaceId, undefined)` 解释（`ui-workspace.client.js:5198-5200`），该 store 不在本次提取范围内，"undefined = 追加到全局末尾"是**由官方用法反推**，不是读它实现确认的。

**13 条 anchor 单测未覆盖的情形**（单测段 `test/run-tests.mjs:186-280`）：
1. `over.half` 是 `"before"/"after"` 以外的值（默认方向相反，见 Minor 1）——只靠手写用例覆盖不到，建议加两条。
2. `over.id` 指向"存在但不在 order 里"的工作区（当前不可能，`order` 就是全量）。
3. 落到**自己所在组的组头下沿**（`groupId` 路径 + `half="after"`）：会把"组内最后一个"重排为全局末尾；语义可接受，但会让 Host 全序悄悄变化，单测没断言过。
4. **`groupIdOrder` 与 Host 全局顺序不一致**的情形（用户拖动过组顺序后这是常态，F6 与 F10 组合）：C 段测试里两者恰好一致（`test/run-tests.mjs:190-194`），C10/C11 只覆盖了"空组"这一种不一致。
5. 我的 1132 例穷举**只覆盖了 membership 恒为空（全未分组）**下的 `over.id` 路径——`over.groupId` 那条路官方没有对应物，无法"对照官方"验证，只能靠语义与手写用例（C1/C2/C3/C7/C10/C11）兜着。这一点是我这份等价性结论的**边界**，请实现者知悉。

## 渲染插点（B 条）核对结果

- **rowKeys 与渲染行逐个对齐**：`WSG_renderTree` 每 push 一行前先 push 对应的 key（新建行 `grouping.js:504-505`、组头 `:534`+`:538`、改名行 `:675-676`、确认行 `:684-685`），成员行交给 `:717` 的官方 `renderGroup`（它自己按同一顺序 push `workspace:`/`session:`/`overflow:`，`:3160-3164`）。官方对 key 的判定是**按长度+下标全等**（`ui-workspace.client.js:2386-2388`），所以这条纪律是硬要求，目前成立。空列表时官方先放一个 `"empty"` key 并同时挂 `EmptySessions` 元素（`:3151`、`:3344-3348`），WSG 的 rows 非空且不含 `null/false`，两边数量仍然对齐。
- **收起的组完全不产会话行**：`grouping.js:716`（`if (!bucket.expanded) continue;` 在 push 成员之前），组头自身仍产 1 行 1 key ✔。
- **订阅在卸载时释放**：用 `react.useSyncExternalStore`（`grouping.js:383-390`），退路是 `useEffect` 返回 `WSG_subscribe` 的解除函数（`:186-189`）；`WSG_boot()` 只置一个布尔、不加监听（`:288-296`）→ **未发现监听器泄漏**。`WSG_setSnapshot` 遍历 `Array.from(listeners)` 的副本（`:193`），单个订阅者抛错不阻断别人 ✔。
- **hooks 不在分支/循环里**：`grouping.js:410-428` 的 5 个 hook 全在 `:431` 的模式分支之前；`WSG_renderTree` 由 patch B 在组件体顶层**无条件调用一次**（`patches.mjs:54-64` 替换的是 `const groupRows = rootGroups.map(…)` 这句）→ 模式切换时 hook 顺序不变 ✔。

## 写回与清理（F13）核对结果

- 500ms 防抖**合并**语义正确：只保留最后一份完整状态（`writer.pure.js:36-43`，单测 D 段"同一窗口内两次改动只写一次 + 写最后那份"通过）。丢改动只发生在**卸载那一下**（I1）。
- 写失败时**界面不会被回滚成空**（`grouping.js:246-260` 只 warn；`WSG_postState` 的失败不冒泡到 `WSG_commit`）——好的一面；坏的一面是"界面与磁盘不一致且用户不知道"（I1/I2）。
- `project.pure.js` 的两类残骸：**成员指向已删组** → `:86` 丢掉（单测 `test/run-tests.mjs:150`）；**工作区已不在 Host 列表** → `:87` 丢掉（单测 `:110`、`:127`）。两类都覆盖，但触发条件取决于"列表是否可信"→ 见 I3。
- Host 端不把悬空当错（`state-store.js:66-69`），所以"清不干净"只会留脏数据、不会报错，符合 F13 的容错要求 ✔。

## 客户端 ⇄ Host 契约逐项对齐

| 项 | 客户端 | Host | 结论 |
|---|---|---|---|
| 路径 | `/dsh-workspace-groups/state`（`grouping.js:16`） | `ROUTE_PATH` 同串（`plugin/lib/index.js:34`） | ✔ |
| GET | `GET` + 头（`grouping.js:233-236`） | GET 不查头，200 + 合法状态（`index.js:112-117`） | ✔ |
| POST | `POST` + `content-type` + `x-dsh-workspace-groups: 1`（`grouping.js:248-255`） | 头不对 403（`index.js:127-131`） | ✔ 头名字面量一致 |
| 形状 | `{version:1, groups:[{id,name,order}], membership}`（`project.pure.js:90-94`） | `validateState` 同构（`state-store.js:75-112`） | ✔（空组名是唯一分歧 → Minor 2） |
| 校验误伤 | 客户端送出的都合法（清洗后 membership 值恒为字符串、id 非空、order 是数字） | 不会 400 | ✔ |
| 失败回执 | 不区分 4xx/5xx，一律只 warn（`grouping.js:256-259`） | 400 不写文件、500 写失败、403 缺头（`index.js:153-173`） | 契约本身没问题，但客户端浪费了这些信息 → I1 |

## 未能审查的部分（附原因）

1. **AnimatedRows 的内部配对逻辑**：`src/upstream/` 只提取了 `ui-workspace.client.js`（+index.js），`AnimatedRows` 的实现虽然在同一文件的 `:2397` 起，但它对 `children` 的展开/配对细节我没有逐行读完（只确认了 `sameRows` 按长度+下标全等比较 `:2386-2388`）。**行序对齐我是按"构造上逐个 push"证明的，没有在浏览器里看动画是否撕裂**（只读审查，不做界面实验）。
2. **`workspaces.insertBefore(id, undefined)` 的真实语义**：实现在官方 workspace store 里，不在本次提取范围（`ui-workspace.client.js:5198-5200` 只是转发）。见上文的"未确认部分"。
3. **`useWorkspaces(state => state.items)` 在 `phase!=="ready"` 期间是否可能不完整**：需要跑起来观察或加日志，只读审查做不到 → I3 标为推断。
4. **F7（拖工作区进组/跨组）、F10（组内换位后重启保持）、F13（删工作区后清理）**：需要真机操作并会写用户真实数据（`~/.dsh/storages/workspace-groups.json`）或需要重启，超出本轮"只读 + 不重启"的授权范围，**我没有做**。拖动路径的"算术等价性"我用穷举给他证了（1132 例 0 差异），但"从鼠标按下列松手这一整条 React/DnD 链路真的走到 `WSG.commitWorkspaceDrop` 并落到 Host"仍属未验。
5. **`plugin/cordis.patch.yml`、`tools/sync.mjs`、安装/回滚链路**：属系统级改动范围（`~/.dsh`），本轮明确不碰，未审。
6. **Host 侧真实路由行为**（403/400/落盘格式）：项目已实测并记录，我未重跑（避免写用户数据）。

## 对 lead 三条补充事实的独立核对（我自己的判断，不引用别人的结论）

**① 组头上下半区语义「刻意不同」—— 我同意，并且我原本就没把它算成问题。**
我独立核对：`workspaceGroupHalf(e)` 用 `e.currentTarget.getBoundingClientRect()`（`ui-workspace.client.js:3001-3004`），而它的调用点是挂在**整个 section 容器 div** 上的 `onDragOver`/`onDrop`（同一 div 就是 `:3195-3197` 那个 `groupSection`，`:3198`、`:3213`），所以官方那个半区是"工作区 + 它全部会话行"这一整块的中线 → 落上半/下半 = 该工作区之前/之后。分组层给 30px 组头行（`grouping.js:56-70` 的 `WSG_STYLE_HEADER`）用的是**组头自己**的中线，语义是"组首/组尾"。两者不是同一个对象，**不该一致**；我在报告里只把它当"无官方对应物的新增语义"记了一笔，没判成缺陷。
补一条我能证明的、唯一的副作用（不影响判定，供实现者知道有这笔账）：当被拖动者本身就是该组**最后一个成员**、但在 Host 全序里与它前一个成员**不相邻**时，`anchor.pure.js:76-78` 算出的锚点是"第二个成员之后那个元素"，模拟搬运仍会判 `reorder=true` → 多一次 Host 写入。全局顺序变了，**桶内可见顺序不变**（成员按 Host 顺序过滤，前后相同）→ 用户看不见，只是多一次 reorder 请求。

**② F13「等价路径」是否成立 —— 成立，代码路径确实是同一条；但有一个小洞。**
- 成立的部分（代码事实）：真实删工作区时缺的输入确实就是"`ctx.workspaces` 里少了那个 id"，而清洗正好只看这个输入：`project.pure.js:81`（`known = new Set(workspaceIds)`）+ `:87`（不在 `known` 里 → 丢），触发条件 `:95`（`changed`）→ `grouping.js:418-428`（防抖写回）。塞一条假归属与真删除**走的是同一条判断**，所以"等价路径"的说法在结构上站得住（且删除后侧栏必然重渲染 → `WSG_renderTree` 必然跑到）。
- 洞（代码事实，我在报告 I3/§写回里没单独点出，补上）：清洗只在 `workspaceIds` **有定义**时生效，而定义条件是 `ctx.workspaces.length > 0`（`grouping.js:417`）。所以"把最后一个工作区删掉"这一种真实删除**不会**触发清洗 → 它那条归属会留到下次列表非空且有写回时。后果只是文件里留一条不渲染、不报错的记录，属可接受，但它说明"等价"是"**列表非空时的等价**"。
- 与 ③ 的关系：这个洞正是 ③ 那个刻意取舍的另一面，不该靠"清得更狠"来补（见 ③）。

**③ 空列表不清洗的取舍 —— 可接受，我赞成保留；但它挡不住真正的风险，风险在"列表非空但不完整"。**
- 赞成理由：悬空记录本身零代价（界面忽略它：`project.pure.js:209-211`；Host 明确允许：`state-store.js:66-69`），而"误删全部归属"是不可逆的用户数据损失。**宁可留脏、不可误删**，这个方向是对的。
- 但它不是"加载中就安全"：`grouping.js:417` 只用"非空"当就绪判据，`phase !== "ready"`（官方自己在 `ui-workspace.client.js:3542` 才敢认的 ready）时列表**非空但不完整**也一样会清并落盘 → 这就是我报告里的 **I3**。所以更稳的做法不是"空时不洗"，而是：**ctx 带 `ready`，只有 ready 才把 `workspaceIds` 传进去**（`!ready` → `undefined`，纯函数分支已存在、已被测试覆盖），并且把"自动落盘清洗结果"降级为"只在内存里忽略"。
- 建议的最终取舍（三层，代价从低到高）：保留"空列表不洗" → 加 `ready` 门 → 干脆**不自动回写清洗结果**（F13 只要求"界面无残骸"，Host 允许悬空，回写是纯收益为零、风险全在的动作）。

## 给实现者的 3 条最优建议（按性价比排序）

1. **先堵数据丢失，再谈功能**：①POST 串行化 + `pagehide` 时 `flush()`；②快照加 `loaded`，未成功加载前禁止写回；③`ctx.ready` 未就绪时 `workspaceIds` 传 `undefined`（纯函数分支已存在，一行接线）。三条都是小改动，能同时消掉 I1/I2/I3。
2. **给写回加一个"谁的新"的判断**（`rev`/`updatedAt` + Host 409），顺手把 C1 变成"刷新一下就好"而不是"手工翻 `.bak`"。这是本项目唯一一条真会丢用户数据的路径。
3. **把"沉默失败"变成"构建失败"**：上游 SHA256 常量断言 + 注入层自由标识符存在性断言（I4）。这份代码的全部价值都建立在"锚点还在就说明语义没变"这个假设上，而这个假设对"改名"型升级不成立。
