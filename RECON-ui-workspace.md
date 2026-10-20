# 官方 `@deepseek-ai/dsh-client-ui-workspace` 源码测绘（自定义分组插点调研）

- 调研日期：2026-10-20
- 调研员：recon-ui（只读调研；仅写本文件）
- 证据分层：**实测**（跑了命令/读到文件原文） > **代码事实**（读到的源码原文，附行号） > **推断**（未实测，已标注）
- 被测对象：`<DSH 安装目录>\resources\app.asar` → `dsh/node_modules/@deepseek-ai/dsh-client-ui-workspace/`
- 解包到：`%TEMP%\dsh-asar-recon2\`（**实测**：`asar-tool.mjs extract` 成功，9 个文件 0.3 MB，未整体解包 app.asar）
- 主测绘文件：`lib/client.js`（5355 行 / 232747 字节）。**下文所有 `L####` 均指该文件行号。**

> 命令留痕（唯一一次解包）：
> `node ...\asar-tool.mjs "<asar>" extract "dsh/node_modules/@deepseek-ai/dsh-client-ui-workspace/" "%TEMP%\dsh-asar-recon2"`
> 输出：`已解包 9 个文件（0.3 MB）`

---

## 0. 结论摘要

1. **这不是「有源码的 npm 包」，而是 DSH 客户端打包产物**：单文件、包在一个自定义模块加载器 `_ModuleLoader__.load({id, factory})` 里，factory 内部用 **CJS `require`**（L1–L11）。**外部依赖面极小，只有 5 个 require**，全是公共外部位（react、react/jsx-runtime、cordis、dsh-client-store、dsh-client-ui-primitives）→ **fork 后不需要任何私有源码依赖**（结论：可行性高）。
2. **分组层的主插点在 `deriveGroups`（L1091–L1113）**：它把 `groupByWorkspace`（L1027–L1046）吐出的扁平分组成 section 列表，每个 section 有固定 9 个字段（见 §3）。**在这里插入「自定义分组」是唯一干净的切入点**——往下所有渲染/拖动都按 `section.key` 工作。
3. **「分区头」不是 CSS 里的 `sectionHeader`**。CSS 类 `sectionHeader`（L3828）是列表**顶部标题行**（工作区/会话/搜索/视图选项）。真正的「工作区分区头 + 折叠」是 **`ProjectRowItem`（L1950–L2059）**，也就是官方把每个工作区渲染成一行「文件夹行」（`data-row-key="workspace:<key>"`，L1967），点击它折叠其会话子树。
4. **官方已有「折叠」机制可直接复用**：`groupExpansion`（store 初始值 L1270 / setter L1284–1286 / 渲染消费 L3061–3068、L3231），持久化随 view store（`persist: "dsh.workspace.view.v5"`，L1274）。**自定义分组的收起/展开几乎可以照抄这套**。
5. **拖动是 HTML5 原生 drag（`draggable` + onDragStart/Over/Drop/End），不是 pointer 事件、没有像素阈值**（L1971–1977、L2285–2301、L3198–3221）。提交路径唯一一处：`commitWorkspaceDrag`（L3120–3136）→ `insertWorkspaceBefore(workspaceId, anchor)`（L3133）→ `workspaces.insertBefore`（L5199，**Host API**）。
6. **跨分组拖动是最大改动点（大）**：官方在 L3155 用 `parents.get(drag.workspaceId) === parents.get(group.key)` 限定「只能在同一父级内拖」，L3200/L3215 对不兼容目标直接把 `dropEffect` 设为 `none` 并清空 over。**自定义分组想跨组拖动，必须重写这一层判定 + 提交时的 anchor 计算（Host 只认线性顺序）**。
7. **DOM 层增强替代方案：不推荐**（§8 详述）。理由基于代码事实：行动画组件 `AnimatedRows` 只认 `[data-row-key]`（L2488）并用 FLIP/`element.animate` 迁移行（L2445–2454），且**列表 children 完全由 React 渲染**（L3344–3348）；折叠由官方 React 状态驱动（L3229–3232）。纯 DOM 注入能做到「视觉分组」，但**无法让官方派生与拖动提交路径认可分组**，跨组排序写不回 Host，且会与 FLIP 动画互相打架、随官方升级易碎。
8. **总体判断：fork 遮蔽方案可行，属「中等偏大」工程**。数据模型/持久化/派生/头渲染/增删改 UI/i18n 都是中或小；**拖动跨组提交是大**；**每次 DSH 升级需要重放补丁（大，长期维护成本）**。

---

## 1. 模块格式与依赖面（问 1）

### 1.1 格式：DSH 客户端模块加载器 + CJS 工厂

**代码事实**（L1–L11 原文）：

```js
_ModuleLoader__.load({
	id: "@deepseek-ai/dsh-client-ui-workspace",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_dsh_client_store = require("@deepseek-ai/dsh-client-store");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let _deepseek_ai_cordis = require("@deepseek-ai/cordis");
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
```

- 文件**不是原生 ESM**（没有 `import`/`export` 语句，末尾是 `exports.apply = apply; exports.inject = inject;`，L5349–5350），也**不是普通 CJS 文件**（没有顶层 `module.exports`，且被 `_ModuleLoader__.load` 包裹）。
- `package.json` 声明 `"type": "module"`、`main: lib/index.js`、`exports["./client"] = ./lib/client.js`；而 `lib/client.js` 实际由 DSH 的 web 端加载器解释。**`lib/index.js` 只有 453 字节，是宿主侧入口**（未展开测绘）。
- CSS 是**内联进 JS 的**：`const css = "..."; const tagId = ".../WorkspaceBrowser.module.css"`（L2720–2721）、`tagId$2 = ".../AnimatedRows.module.css"`（L2372）。CSS 类名映射对象如 `sectionHeader/sectionLabel/sectionLabelHidden`（L2760–2762）。**fork 时必须整段搬运这些 CSS 字符串与方法**。

### 1.2 完整外部 require 说明符（共 5 个）

| 行号 | 说明符 | 性质 |
|---|---|---|
| L7 | `@deepseek-ai/dsh-client-store` | 官方客户端包（`defineStore`、`createSnapshotStore`） |
| L8 | `@deepseek-ai/dsh-client-ui-primitives` | 官方 UI 原子件（`Menu`/`Tooltip`/`HoverCardGroup`/一堆 `Icon*`） |
| L9 | `@deepseek-ai/cordis` | 框架（peerDependency `~4.0.5`） |
| L10 | `react/jsx-runtime` | 公共 |
| L11 | `react` | 公共 |

**没有第三个 require**（**实测**：`grep '^\s*(import|export|const .*require\()|require\(["']'` 全文仅 7 处匹配，其中 5 处是上面的 require、2 处是 L5349–5350 的 exports）。

### 1.3 另外两条「注入面」（不是 require）

- **cordis 服务注入**（`inject` 导出，L5004–5014，原文）：`slots, sessions, workspaces, locale, remote, remote.directoryPicker, layout, shortcuts, remoteAccess` —— 这 9 个是**机制名**，运行时用 `ctx.get("sessions")` 等取（L5022–5023），**不产生 import**。
- **包元数据注入**（`package.json` → `dsh.client.inject`，L30–43）：列了 12 个 `@deepseek-ai/*` 包。**代码事实**：L4996–5002 的注释明确说明这是「informational (loading/prefetch metadata, never apply sequencing)」——**只影响加载/预取，不影响 apply 顺序，也不是代码依赖**。

### 1.4 结论（对 fork 的意义）

**实测 + 代码事实**：fork 一份 `lib/client.js` 只需保证这 5 个 require 可解析即可，**全部是公共外部位，无需任何 `./src/*` 私有导入**（`package.json` 的 `exports["./src/*"]` 在 asar 里根本没有对应文件——**实测**：解包出的 9 个文件里没有 `src/`）。**这是本方案能成立的关键前提。**
风险提示：fork 出来的包必须以同样形态 `_ModuleLoader__.load` 注册（即需要 DSH 客户端打包链路，或直接**改这一份产物文件**作为自己的 `lib/client.js`）。

---

## 2. 数据流：数据从哪来（问 2）

### 2.1 注册与 store 注入（L5220–L5251）

```js
ctx.slots.inject("sidebar.workspaces", () => ctx.slots.register({
	name: "sidebar.workspaces",
	children: { "sidebar.workspaces.directoryFlow": {...}, ... },
	store: viewStore,
	inject: browserInjected,
	locale: NS
}, WorkspaceBrowser));
```

- **代码事实**：`register` 调用**没有 `id` 字段**，即它占用 `sidebar.workspaces` 这个 single 槽位。子槽位声明与任务描述一致（`directoryFlow` single、`session.menu.item` list、`session.row.action` list、`session.row.hover`、`session.row.leading`），**确认没有「工作区分组」扩展槽位**。
- `store: viewStore`（L5024–5029）= `createWorkspaceViewStore()` 的实例（`create` 被覆写为返回同一实例）。它是**跨组件共享的单例**（Browser 与 SessionTree 都用）。

### 2.2 数据 hooks 的注入

| 数据 | 注入点 | 说明 |
|---|---|---|
| `useWorkspaces` | L5039–5042 `ctx.slots.provideRoot({ hooks: { workspaces: workspaces.list }, keyedHooks: {...} })` | 列表由 `ctx.get("workspaces")`（L5023）的 `.list` 提供 |
| `useSessions` / `useSessionStatus` | **框架全局 hooks**（L5015–5019 注释：「data reads use the framework's global hooks」）；运行时从 slot props 传入（见 L3509、L3994） | 不经本包的 provideRoot |
| `useStore` | 槽位 `store: viewStore`（L5248） | 组件内 `useStore((s) => s.groupBy)`（L3527） |
| `usePanelInfo` / `useHostInfo` / `useShortcuts` / `useDirectoryFlow` | `browserInjected().hooks`（L5209–5214）+ 框架 | — |

### 2.3 `browserInjected` 注入了什么（L5181–L5215，原文摘要）

**服务/回调**：`startSession`(L5182)、`open`(L5185)、`searchSessions`(L5186)、`searchResultLimit`(L5187)、`requestSessionRename`(L5188)、`notifyArchivedNotOpenable`(L5189)、`renameWorkspace`→`workspaces.rename`(L5192–5194)、`deleteWorkspace`→`workspaces.delete`(L5195–5197)、**`insertWorkspaceBefore`→`workspaces.insertBefore`(L5198–5200)**、`unarchiveSession`(L5201–5203)、`createWorkspace`(L5204)、`requestSearch`(L5205)、`requestAddWorkspace`(L5206)、`closeAddWorkspace`(L5207)、`setDirectoryBusy`(L5208)。

**hooks**：`directoryFlow: browserFlowSource`(L5210)、`hostInfo`(L5211)、`workspaceShortcuts`(L5212)、`shortcuts: ctx.shortcuts.catalog`(L5213)。

**对分组功能的意义（代码事实）**：**没有任何「工作区分组」相关的 Host API 出现在注入面**。可用的 Host 写操作只有 create/rename/delete/insertBefore。→ **自定义分组数据必须自带持久化（客户端 store 或新增 Host 侧存储），不能指望官方 API。**

---

## 3. 分区派生：数据结构与主插点（问 3）

### 3.1 `buildGroup` —— section 的「原始形态」（L1001–L1011，原文）

```js
function buildGroup(key, workspaceId, cwd, createdAt, label, members) {
	return { key, workspaceId, cwd, createdAt, label, sessions: [...members] };
}
```

| 字段 | 含义 |
|---|---|
| `key` | 分组键 = `workspace.workspaceId`；**「未分组」用空串 `""`**（L1044） |
| `workspaceId` | 工作区 id；未分组时为 `undefined`（渲染层据此显示 `t("group.ungrouped")`，L1952） |
| `cwd` / `createdAt`（Number，`Date.parse`）/ `label`（标题） | 展示用 |
| `sessions` | 该组的会话 summary 数组（**已按可见性过滤**） |

### 3.2 `groupByWorkspace`（L1027–L1046）——「分区派生」

- 入参：`(list, workspaces, archived, archivedFilter, ungroupedOrder)`。
- 行为（代码事实）：遍历 `workspaces`（**保持调用者给的顺序**，即 Host 顺序经 `orderedWorkspaces` 投影），按 `workspace.sessionIds` 收集成员（L1033–L1039）；`archivedFilter === "only"` 且无成员时跳过该组（L1040）；**兜底组**：不属于任何工作区的会话按 `ungroupedOrder` 追加一个 `key === ""` 的组（L1043–L1044）。
- **注意**：这里的顺序 = `workspaces` 数组顺序，**没有任何分组/类别概念**。

### 3.3 `deriveGroups`（L1091–L1113）——**主插点**

入参（L1084–L1088 注释 + 实参 L3069–L3072）：`list`、`workspaces`、`rowState`（pin/archive 集 + archivedFilter）、`statuses`、`view = { expandedGroups, ungroupedOrder }`。

出参（L1100–L1110，**渲染层真正消费的 section 结构**）：

```js
groups.push({
	key: g.key,                       // 分组键（L1101）
	workspaceId: g.workspaceId,       // L1102
	cwd: g.cwd, createdAt: g.createdAt, label: g.label,   // L1103-1105
	sessionCount: g.sessions.length,  // L1106
	expanded,                         // L1107 ← 由 view.expandedGroups 决定
	containsCurrent: g.key === currentGroup,   // L1108
	sessions: expanded ? sectionMembers(...).map(sessionNode) : []   // L1109
});
```

- `expanded` 的判定：`const expanded = expandedGroups.has(g.key)`（L1099）。
- `sectionMembers`（L979–L991）负责组内排序：**blank 会话（新建占位行）→ pinned → 其余**，且不改变调用者顺序。
- `sessionNode`（L1059–L1074）把 summary 投影成行：`{id, title, blank, running, runningSubagentCount, completed, pinned, archived, updatedAt, [pendingInteraction]}`。

**消费方**（**代码事实**，全部按 `group.key` 工作，这是插点干净的原因）：
- `SessionTree` 的 `groups = useMemo(() => deriveGroups(...))`（L3069–L3079）；
- `baselines`/`foldedKeys`/`childrenByParent`（L3088–L3094、L3137–L3148）；
- `renderGroup`（L3152–L3329）→ `<ProjectRowItem group={group}>`（L3223）+ `sessions.map(SessionNodeItem)`（L3295–L3307）→ 全部塞进一个 `<AnimatedRows rowKeys={rowKeys}>`（L3338–L3349）。
- **`FlatList`（L3355）与 `SearchResults`（L3441）不消费 `deriveGroups`** → 自定义分组只需在 tree 模式生效。

### 3.4 `nestWorkspaces` 的入参出参（L3047–L3055、L4004）

- 入参：**布尔**，来自 `nestWorkspaces: groupBy === "workspace-tree"`（L4004）。
- 它**不产出分组**，只控制 `parents` 映射：`Map<workspaceId, parentWorkspaceId | undefined>`，用 `owningParentFolder(workspace.path, paths)`（L1233）按路径父目录判定（L3047–L3055）；`!nestWorkspaces` 时返回空 Map（L3048）。
- 出参用途：`currentAncestors`（L3056–3060）、`expandedGroups` 的祖先自动展开（L3061–3068）、`childrenByParent` 树（L3137–L3148）、**跨父级拖动禁止判定**（L3155）、`underFoldedAncestor`（L3090–3093）。
- **关键**：`nestWorkspaces` 这条「父级」通道与「自定义分组」是**两套并行的层级**。若要让「自定义分组」也能做组内拖动判定，最省事的做法是**让 `parents` 的语义从「目录父级」扩展为「分组父级」**（或新增一条 `groupParents`），因为下游 L3155/L3200 已经按 `parents` 判定兼容性。

---

## 4. 渲染层（问 4）

### 4.1 两个「section header」，别搞混

| 名称 | 位置 | 是什么 |
|---|---|---|
| **列表顶部标题行**（CSS `sectionHeader`） | L3828–L3834 | 一行放「工作区/会话」标签（`groupBy === "flat" ? t("section.sessions") : t("section.workspaces")`，L3833）+ 搜索框（L3835–L3894）+ `ViewOptionsMenu` 等动作（L3895+） |
| **工作区分区头（真实体）** | `ProjectRowItem` L1950–L2059，渲染于 L3223–L3250 | 每个工作区一行：文件夹图标（L1979–1982）+ 折叠箭头（L1983–1986）+ 标题（L1987–1993）+ hover 动作菜单（L1994–L2014：rename/delete）。`data-row-key="workspace:<key>"`（L1967）、`role="treeitem"`、`aria-expanded`（L1969） |

### 4.2 行组件速查

| 组件 | 行号 | 说明 |
|---|---|---|
| `ProjectRowItem` | L1950–L2059 | **工作区行 = 官方分区头**；`onToggle` 由父层传入 |
| `SessionNodeItem` | L2254–L2369 | 会话行（`Rows.module.css`，`draggable` 条件 L2261、`onDragOver/onDrop` L2292–L2301） |
| `AnimatedRows` | L2397–L2560 | 行动画容器（见 §8） |
| `FlatList` | L3355–L3440 | 「单列表」模式 |
| `SearchResults` | L3441–L3508 | 搜索结果 |
| `SessionTree` | L3024–L3353 | **tree 模式主体（分组 + 拖动都在这里）** |
| `WorkspaceBrowser` | L3509–L4120 | 根组件（注入面 + 头部 + 列表区） |
| `ViewOptionsMenu` | L2877–L2985 | 视图选项菜单 |
| `WorkspacePicker` / `WorkspacePickFlow` | L2704 / L2569 | 工作区选择器（另一处 UI） |

### 4.3 折叠状态与持久化键名

- store 初始值：`groupExpansion: {}`（L1270）。
- setter：`setGroupExpanded: (d, key, expanded) => { d.groupExpansion[key] = expanded; }`（**L1284–L1286**）。
- 清理：`retainAccountKeys`（L1287–L1292）按工作区键裁剪 `groupExpansion` → **新增自定义分组的展开键必须一并登记，否则会被裁掉**。
- 消费：`expandedGroups`（L3061–3068）→ `deriveGroups`（L1099）→ `expanded`；点击切换在 `ProjectRowItem.onToggle`（L3229–3232）：
  ```js
  onToggle: () => { if (group.expanded) dropWatermarks((key) => withinGroup(key, group.key)); setGroupExpanded(group.key, !group.expanded); }
  ```
- 默认展开规则：有子目录的祖先默认展开（`ancestorKeys.has(key)`，L3062–3063）；当前会话所在组首次挂载时自动展开（L3038–3046）；reveal 目标链强制展开（L3080–3087）。
- **持久化键名**：`persist: "dsh.workspace.view.v5"`（**L1274**）。
- 另有**不持久化**的 UI 状态：`storedWatermarks`（「展开更多会话」水位线，L3029、L3157–3159、L3309–3326）。

### 4.4 `ViewOptionsMenu` 与 `groupBy` 的联动

- `ViewOptionsMenu` 定义 L2877–L2985；菜单项 id：`workspace` / `workspace-tree` / `flat`（L2890–2904）、`manual` / `updated`（L2914–2923）、`hide-archived` / `show-archived` / `only-archived`（L2933–L2947）；`selectedIds` L2949–2957；`onSelect` 分发 L2958–2965（`onGroupPick(id)` 等）。
- store 侧：`groupBy: "workspace"` 默认（**L1268**）、`orderBy: "updated"`（L1269）、`archivedFilter: "default"`（L1272）；actions `setGroupBy`（L1276–1278）/`setOrderBy`（L1279–1283）/`setArchivedFilter`（L1310–1312）。
- 联动链：`useStore((s) => s.groupBy)`（**L3527**）→ 头部标签（L3833）→ `ViewOptionsMenu groupBy`（L3898）→ 内容切换：`normalizedQuery !== ""` ? `SearchResults` : `groupBy === "flat"` ? `FlatList`（L3978） : `SessionTree`（L3994，`nestWorkspaces: groupBy === "workspace-tree"` L4004）。
- **`animationResetKey`** = `` `${groupBy}/${orderBy}/${archivedFilter}` ``（L3985、L4005）——**切换分组模式会重置行动画**。

**对分组功能的含义（推断）**：自定义分组要么复用 `groupBy === "workspace"` 并叠加一层分组，要么新增第四个模式 `groupBy === "custom"`（需同时改 L2890–2904、L3833、L3978/L3994、i18n）。

---

## 5. 拖动实现（问 5）

**机制：HTML5 原生 drag & drop（不是 pointer events）。没有像素阈值——按行的上半/下半判定插入位置。**

| 环节 | 位置 | 原文/要点 |
|---|---|---|
| 拖动源 | `ProjectRowItem` L1971–1977 | `draggable: drag !== void 0`；`onDragStart`：`e.dataTransfer.effectAllowed="move"`、`setData("text/plain", row.key)`、`drag.start()`；`onDragEnd: drag?.end` |
| 拖起收尾 | SessionTree L3166–L3179 | `start`: 置 `workspaceDropCommitted=false`，`setWorkspaceDrag({workspaceId, over:null})`；`end`: 有 over 则 `commitWorkspaceDrag`，否则 `setWorkspaceDrag(null)` |
| 拖动状态标记 | L3033–L3035 | `const [workspaceDrag, setWorkspaceDrag] = useState(null)`；`workspaceDropCommitted = useRef(false)`（防重复提交）；`nativeDragActive = drag !== null \|\| workspaceDrag !== null` |
| 半区分判定 | `workspaceGroupHalf`（L3001）、`rowHalf`（L1932） | 由事件推算 before/after（会话行用法见 L2296 `drag.hover(rowHalf(e))`） |
| 兼容性判定（**关键**） | **L3155** | `const compatibleDrag = workspaceDrag !== null && parents.get(workspaceDrag.workspaceId) === parents.get(group.key);` |
| 容器 dragover/drop | L3198–L3221 | `onDragOver`：`e.preventDefault()`；若不兼容且该组有父级 → 直接 return；不兼容时 `dropEffect="none"` 并清空 over（L3202–3207）；兼容时 `dropEffect="move"` + `hoverWorkspace(workspaceGroupHalf(e))`（L3209–3211）。`onDrop` 对称（L3213–L3221），不兼容且无父级时只「吃掉」事件（L3217–3220） |
| 会话行拖动 | `SessionNodeItem` L2285–L2301 | `onDragStart` L2286–L2290；`onDragOver` 要求 `drag.active`（L2292–L2297）；`onDrop`（L2298–L2301） |
| 原生 drag 兜底 | `useNativeDragAcceptance`（L2858–L2874） | `nativeDragActive` 时在 **document** 层挂 `dragover` 并 `preventDefault`（L2868），使**最后一次 over 标记不被浏览器拒收** |
| **工作区排序提交** | **`commitWorkspaceDrag`（L3120–L3136）** | 找同父兄弟（L3125）→ 目标 index（L3126）→ `anchor = half==="before" ? over.id : siblings[rowIndex+1]?.workspaceId`（L3128）→ 惰性判定（L3129–L3132）→ **`insertWorkspaceBefore(activeDrag.workspaceId, anchor)`（L3133）**，失败 `console.warn("workspace reorder rejected:", reason)` |
| **`insertWorkspaceBefore` 唯一调用点** | **L3133**（**实测**：全文 grep `insertWorkspaceBefore` 仅 L3024 形参、L4013 传参、L5198 注入、L3133 调用） | 落地到 `workspaces.insertBefore`（L5198–L5200，**Host API**） |
| 会话排序提交 | `commitSessionDrag` L3107–L3119 → `sessionDragOrder` L2987–L3000 → `setSessionOrder(accountKey, nextOrder)` L3118 | **会话排序只存在客户端 store，不写 Host** |
| 「列表最顶」投放指示 | L3150、L3334–L3339 | `workspaceDropAtListStart` 仅对 `rootGroups[0]` 生效 |

**跨分组拖动要改哪里（代码事实推导）**：
1. **L3155** 的 `compatibleDrag` 必须从「同目录父级」放宽为「同自定义分组（或允许跨组）」；
2. **L3200 / L3215** 的「不兼容就 return / dropEffect none」分支要放行跨组目标；
3. **L3120–L3136 的 anchor 计算**：Host 只接受**全局线性顺序**的 `insertBefore`，跨组投放必须把「(组, 组内位置)」换算成「全局 after 哪个工作区」——**这是本功能最容易出错、也最值得先写测试的地方**；
4. **L3133 之后**：若分组是「持久化在客户端」的，跨组后还要同时写回分组成员关系（否则下次派生又按 Host 顺序重排）；
5. 可选：L3174–L3178 的 `end` 与 `workspaceDropCommitted` 去重逻辑要保持。

---

## 6. 持久化（问 6）

| 状态 | 位置 | 介质 |
|---|---|---|
| `groupBy`(L1268) / `orderBy`(L1269) / `groupExpansion`(L1270) / `sessionOrderByAccount`(L1271) / `archivedFilter`(L1272) | `defineStore`（L1266–L1314） | **客户端 store，`persist: "dsh.workspace.view.v5"`（L1274）** |
| 会话顺序（每组 + 扁平） | `sessionOrderByAccount`，key = workspaceId / `""` / `__flat_session_order__`（L1256、L1297–L1302） | 同上（客户端） |
| 「展开更多会话」水位线 | `storedWatermarks`（L3029） | **组件内 useState，不持久化** |
| 工作区本身（id/路径/标题/**顺序**） | `ctx.get("workspaces")`（L5023）；写操作 `workspaces.create`(L5204)/`rename`(L5193)/`delete`(L5196)/**`insertBefore`(L5199)** | **Host 持久化** |
| pin / archived 集合 | `rowState.pinnedSessionIds` / `archivedSessionIds`（L1092–L1093） | 来自 Host/registry（本文件未展开） |

**实测补充**：全文 `grep localStorage` **零匹配** → 持久化实现不在本文件里，而在 `@deepseek-ai/dsh-client-store` 的 `defineStore` 内。
**实测限制**：我尝试按同样方式解包 `dsh/node_modules/@deepseek-ai/dsh-client-store/`，返回 **「已解包 0 个文件」**；`asar-tool.mjs list` 也搜不到该包名 → **该包不在这个路径下（可能已并入其它 web bundle）**，因此**「`persist` 字符串即 localStorage 键」属「推断」**，建议实现时用浏览器实测确认（DevTools → Application → Local Storage 搜 `dsh.workspace`）。

**对分组功能的意义**：新增的自定义分组数据有两条合法落盘路径——
(a) 扩展 view store 的持久化结构（**必须沿用/迁移 `dsh.workspace.view.v5` 键**，否则用户既有视图偏好丢失）；
(b) 新增独立 store / 独立持久化键（隔离性好，但要自己处理与工作区删除的清理，参考 `retainAccountKeys` L1287–L1292）。

---

## 7. 最少改动清单（问 7）

> 工作量口径：**小** ≈ 单点改动、可一次改完；**中** ≈ 需新增组件/状态并改动多处联动；**大** ≈ 涉及 Host 语义换算或跨模块状态机，需专门设计与测试。

| # | 功能 | 文件:行 | 改什么 | 风险 | 工作量 |
|---|---|---|---|---|---|
| 7.1 | **分组数据模型** | L1265–L1314（`createWorkspaceViewStore`） | 新增 `groupDefs: [{id, name, order}]`、`workspaceGroup: {workspaceId: groupId}`、`groupCollapsed` 或复用 `groupExpansion` | 与既有 `persist: "dsh.workspace.view.v5"`（L1274）共用一个持久化对象 → 必须做**向后兼容/迁移**，否则老用户视图状态丢失 | 中 |
| 7.2 | **持久化与清理** | L1274、L1287–L1292（`retainAccountKeys`） | 让分组键纳入保留/清理；工作区被 Host 删除后要摘掉其分组归属 | 清理不全会留下悬空 id（渲染时找不到组）；调用方在 `WorkspaceBrowser` 里（需找 `retainAccountKeys` 调用点） | 中 |
| 7.3 | **分区派生（主插点）** | **L1091–L1113（`deriveGroups`）**，配合 L1027–L1046（`groupByWorkspace`）、L1001–L1011（`buildGroup`） | 在 `groupByWorkspace` 结果之上套一层「自定义分组 → 组内 section 列表」的投影；或直接在 `deriveGroups` 里按 `workspaceGroup` 聚合。保持 section 9 字段结构不变（`key/workspaceId/cwd/createdAt/label/sessionCount/expanded/containsCurrent/sessions`） | 一旦改动 section 结构，`renderGroup`/`childrenByParent`/watermark 全受影响；**建议只加字段不改语义** | 中 |
| 7.4 | **分组头渲染** | 新增组件（参照 `ProjectRowItem` L1950–L2059）+ 挂载点 `renderGroup` L3152–L3329 / 列表容器 L3149、L3330、L3338 | 在 `rootGroups` 之外插入「分组头行」，并让分组内的 section 缩进渲染 | 列表整体在 `<AnimatedRows rowKeys>` 内（L3338–L3349）：**新增行必须把 key 计入 `rowKeys`（L3151–L3164 的 push 习惯）**，否则入场/退出动画错位 | 中 |
| 7.5 | **分组收起/展开** | L1270、L1284–1286、L3061–3068、L3229–3232 | 复用 `groupExpansion` 机制，给分组头一个 `onToggle` 写 `setGroupExpanded(groupKey, !expanded)` | 键空间与工作区键冲突（都用 `workspaceId` 作 key）→ **分组键需加前缀**（如 `g:<id>`），否则 L3061–3068 的 `expandedGroups` 会把两者混为一谈 | 小 |
| 7.6 | **拖动：组内/跨组排序提交** | **L3120–L3136（`commitWorkspaceDrag`）**、L3155、L3198–L3221、L3133（`insertWorkspaceBefore`） | ① 放宽 `compatibleDrag`；② 跨组投放时把「(目标组, 组内位)」换算成 Host 线性 anchor；③ 提交后同时更新分组归属 | **本功能最高风险点**：Host 只认全局线性顺序，跨组换算写错会导致工作区「跳位」；建议先用 JavaScript 纯函数把换算逻辑单测覆盖 | **大** |
| 7.7 | **分组自身拖动排序** | 新增（可参照 L3166–L3179 的 drag props 形状 + L1971–1977 的 draggable 写法） | 分组头独立 drag 状态与提交（只写客户端 store，不碰 Host） | 与工作区拖动共存时的状态互斥（现在是 `drag` 与 `workspaceDrag` 两个 state，加第三个要防止同时激活） | 中 |
| 7.8 | **分组增/删/改 UI** | 新增（复用 `_deepseek_ai_dsh_client_ui_primitives.Menu`，参照 L1996–2014、L2879–2984）+ 头部动作区 L3895+ | 新建分组入口（头部「+」或视图菜单）、重命名/删除（菜单项）、把工作区移入分组（工作区行菜单 L1955–1964 加一项） | 头部空间有限（`headerActions` L3896 有 `searchExpanded` 隐藏逻辑）；重命名/删除需二次确认（可参照 L3807–3824 的删除确认流程） | 中 |
| 7.9 | **i18n 文案** | `zh` L4749–L4870、`en` L4871–L4992（`NS = "workspace"` L4995，注册 L5043–5046）；另可走 `locale/zh.json`、`locale/en.json` | 新增 group.* / 「新建分组/重命名分组/删除分组/移入分组」等键 | 键名必须与 `t()` 调用一致；`locale/*.json`（48/128 字节）与内联字典的关系需实测确认 | 小 |
| 7.10 | **视图模式联动** | L2890–2904（菜单项）、L2958–2965（分发）、L3833（标题）、L3978/L3994（内容切换）、L4004/L4005（nestWorkspaces / resetKey） | 决定「自定义分组」是叠加在 `workspace` 模式上，还是新增第四个 `groupBy` 取值 | 新增模式会牵动 `animationResetKey`（L3985/L4005）与 `nestWorkspaces` 的兼容性（分组 vs 目录树谁是外层） | 中 |
| 7.11 | **fork 工程的构建与注册** | `lib/client.js` L1–L11、L5349–5350；`package.json` L28–L46 | 以同形态产出 `_ModuleLoader__.load` 客户端产物并注册到 `sidebar.workspaces`（遮蔽官方） | **遮蔽机制未实测**（同槽位重复 register 是「后注册覆盖」还是「报错/并存」需验证）；每次 DSH 升级需重新 diff 并重放补丁 | **大**（长期维护） |

**汇总**：小 2 项、中 6 项、大 2 项（拖动提交、fork 构建与升级维护）。**核心工作量集中在 7.6 与 7.11。**

---

## 8. 替代方案评估：不占槽位、DOM 层增强（问 8）

设想的替代方案：不 fork，用 `MutationObserver` 观测侧栏列表，注入分组头 DOM，自实现拖动。

### 8.1 代码事实（支持该方案的部分）

- 行有稳定锚点：`data-row-key` 命名规则为 `workspace:<key>` / `session:<id>` / `overflow:<key>`（L1967、L3160、L3163、L3164、L3312）→ **DOM 层可精确定位每一行**，这一条对该方案有利。
- 容器结构固定：`HoverCardGroup.treeBody`（L3331–3332）→ `AnimatedRows.list`（L3338–L3339）→ 每个 section 一个 `div`（L3195–3197，带 `--dsh-workspace-indent`）。
- 拖动是**原生 HTML5 drag**（L1971–L1977），DOM 层可以监听/拦截 `dragstart/dragover/drop` 事件。

### 8.2 代码事实（对该方案不利的部分）

1. **列表 children 由 React 全权渲染**：`AnimatedRows` 的 children 是 `[空态?, groupRows]`（L3344–L3348），`groupRows = rootGroups.map(renderGroup)`（L3330）——官方每次状态变化都**按自己的 fiber 记录重建/重排这些节点**。外来注入的 DOM 节点不在 fiber 树里；**推断**：在官方增删行、切换 `rowKeys`（L3341）或 `resetKey`（L3343）时，注入节点可能被挤到错误位置（React 按自身记录做 insertBefore/appendChild），极端情况下被一并移除。**这条我无法在本轮实测**（只读任务、不启服务、不改 DSH）。
2. **动画组件只认 `data-row-key` 且直接用 DOM API 操作行**：`readPositions()` = `list.current.querySelectorAll("[data-row-key]")`（**L2488**）；移动用 FLIP（L2445–L2454 `translate(dx,dy)` → `translate(0,0)`，`ROW_GLIDE_MS=200`）；退出时**克隆节点**塞进 overlay（L2412–L2419、L2456–L2481）。
   → 后果：① 若注入的头不带 `data-row-key`，它**不参与动画**，官方行滑动时它会静止/错位（视觉撕裂）；② 若给它加 `data-row-key`，**它会进入动画的状态机**，但它的 key 不在官方 `rowKeys`（L3341）里 → 在 `getSnapshotBeforeUpdate` 的 `nextKeys`（L2408）判定中会被当作「已删除行」而**克隆进 overlay 播放淡出**（L2410–L2420、L2456–2482）→ 表现为**分组头闪烁/重影**；③ 退出行的克隆体带 `--dsh-workspace-indent` 样式复制（L2415），注入层若靠缩进表达分组从属关系，克隆体会带着错误的缩进闪一下。
3. **折叠是官方 React 状态**：`ProjectRowItem.onToggle`（L3229–3232）→ `setGroupExpanded` → store → `deriveGroups.expanded`（L1099）→ 组内会话**根本不渲染**（L1109 `sessions: expanded ? ... : []`）。
   → 后果：DOM 层要做「分组收起」，只能**自己隐藏 N 个官方 section 节点**（`display:none`）。但官方 `AnimatedRows` 仍在按这些节点的几何位置做 FLIP 与 watermarks 计算（L3088–L3096 依赖 `group.sessions`）→ **隐藏后的行仍参与动画计算**，容易出现高度跳变；且官方「当前会话自动展开」（L3038–3046）、「reveal 强制展开」（L3080–3087）会与注入层的折叠状态**互相打架**（推断）。
4. **跨分组拖动写不回 Host**：官方提交路径唯一在 `commitWorkspaceDrag`（L3120–3136）→ `insertWorkspaceBefore`（L3133）→ `workspaces.insertBefore`（L5199）。DOM 层**要么伪造官方拖动、要么完全自实现拖动并直接调用不上**——**关键**：`insertWorkspaceBefore` 是通过闭包注入到组件的（L4013），**DOM 层拿不到这个函数**（除非另找一个能调 Host API 的通道，例如插件自己的 `ctx.get("workspaces")`——**推断**：作为独立插件确实可以拿到 `workspaces` 服务，但**官方 `AnimatedRows`/派生层不会因为 Host 顺序改变而认可「分组」**，只是把工作区换个位置）。
5. **官方的 `compatibleDrag` 会直接拒绝跨父级拖动**（**L3155**），且不兼容时 `dropEffect="none"`（L3206）→ 浏览器会在指针处显示「禁止」光标，DOM 层必须**在捕获阶段拦截并阻止官方 dragover 状态机**才能自实现，属破坏性 hack（推断）。
6. **官方自带 `sectionHeader`（L3828）与 `ViewOptionsMenu`（L3895+）**：注入分组头后，头部会出现「工作区/自定义分组」两套分组语义叠加的**信息重复**；视图菜单里的 `groupBy` 三态（L2890–2904）与自定义分组是什么关系也需要在 UI 上解释清楚，否则用户困惑。

### 8.3 对比结论

| 维度 | fork 遮蔽（推荐） | DOM 层增强 |
|---|---|---|
| 分组数据可信度 | 派生层与渲染层一致，单一事实源 | 视觉一层、数据一层，两套状态需手工同步 |
| 跨分组拖动排序 | 可直接改 `commitWorkspaceDrag`（L3120–3136），走官方 Host API | 拿不到注入的 `insertWorkspaceBefore`，且官方判定直接拒绝（L3155/L3206），需破坏性拦截 |
| 折叠 | 复用 `groupExpansion`（L1284–1286） | 需自己隐藏节点，与官方自动展开（L3038–3046）、watermark（L3088–3096）打架 |
| 动画 | 新行计入 `rowKeys` 即可与 FLIP 协同 | 不带 key 会撕裂；带 key 会被克隆淡出（L2408–2420、L2456–2482）→ 闪烁/重影 |
| 官方升级 | 需重放补丁（**成本已知、可测**） | 依赖 DOM 结构、`data-row-key`、CSS 类名与动画时机（**隐性依赖更多、更难测**） |
| 结论 | **推荐** | **不推荐**；只适合做一次性视觉验证原型，或「只读式分组展示（不允许拖动/不写 Host）」的极简需求 |

---

## 9. 未确认与推断（诚实清单）

**推断（未实测，必须验证后才能作为设计前提）**
- I1. `persist: "dsh.workspace.view.v5"`（L1274）的落盘介质是浏览器 localStorage。依据：`defineStore` 属客户端包 + 键名形如浏览器存储键；**未读到 `defineStore` 实现**（该包不在我解包的路径下）。
- I2. 外来 DOM 节点在官方列表容器内的存活/位置行为。依据：React fiber 与实际 DOM 的既有语义；**未运行任何代码验证**。
- I3. 同槽位 `sidebar.workspaces` 被两个插件 register 时的解析规则（覆盖 / 并存 / 报错）。**未实测**——这是整个 fork 方案的前置条件，**建议最先做一次 30 分钟的最小验证**。
- I4. DOM 层方案里「自实现拖动能驱动 Host 顺序」的替代通道（插件自己 `ctx.get("workspaces")`）是否可用。**未实测**。
- I5. `locale/zh.json`（128 字节）/ `locale/en.json`（48 字节）与内联字典（L4749–L4992）的实际加载优先级。**未读**。
- I6. session 拖动与 workspace 拖动在同一容器内的**事件竞争**细节（例如从一个工作区拖到另一个工作区时 `drag` 与 `workspaceDrag` 是否可能同时非空）。

**本轮明确没有做的事（只读约束）**
- 没有修改/创建除本文件以外的任何文件；没有碰 `~/.dsh/**`；没有安装依赖；没有启动/重启 DSH 或任何服务；没有对 app.asar 以外做解包。
- 未读区段（如后续需要细读）：`ProjectRowItem` 尾部 L2015–L2059、`AnimatedRows` 尾部 L2502–L2560、`FlatList` L3355–L3440、`SearchResults` L3441–L3508、`WorkspaceBrowser` L3510–L3800 / L3900–L3958 / L4033–L4120、`navigation.js` L1347–L1788、`lib/index.js`（宿主侧 453 字节）。

**测绘环境**
- 解包产物：`%TEMP%\dsh-asar-recon2\`（临时目录，非工作区）。
- 行号基准：`...\dsh-client-ui-workspace\lib\client.js` v0.2.1-rc.2（232747 字节）。**DSH 升级后行号会漂移，套用本清单前必须先核对锚点字符串。**
