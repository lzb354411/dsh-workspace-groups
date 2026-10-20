/**
 * src/patches/patches.mjs —— 对官方 client.js 的「锚点式改动清单」
 *
 * 契约（PLAN.md 第五节）：
 *   export const patches = [{ name, find, replace, count }]
 *   - find 必须是官方原文里**真实存在**的片段（含缩进，官方文件是 LF 换行 + Tab 缩进）。
 *   - count 是期望命中次数（默认 1）；构建时命中次数 != count → 立刻失败并打印原文片段，
 *     **绝不静默跳过**（官方升级后锚点漂移必须被立刻发现）。
 *   - 多条 patch 按数组顺序依次应用，后面的 patch 在前面的结果上继续查找。
 *
 * 本轮内容：① 接管探针（保留，不改变任何界面）；② 分组层接入官方渲染与拖动提交（A~D 四条锚点）。
 * 已移除：曾在中文 / 英文侧栏标题后加「· WSG」的两条临时标记 —— 交付物**不改官方文案**
 * （SPEC F11：官方原有功能与外观一字不改）。「跑的是我们这份代码」改由 ① 的
 * `globalThis.__wsgForkLoaded` 单独承担，它不出现在界面里。
 *
 * 锚点核实（实测，2026-10-20，官方 v0.2.1-rc.2 / 232747 字节 / 5354 个 LF）：
 *   - L5351 `\t\treturn module.exports;`                              全文 1 次
 *   - L3124 `\t\t\t\tconst owner = parents.get(activeDrag.workspaceId);` 全文 1 次
 *   - L3330 `\t\t\tconst groupRows = rootGroups.map((group) => renderGroup(group, 0));` 全文 1 次
 *   - L1955 `\t\t\tconst workspaceMenuItems = [{`                      全文 1 次
 *   - L2005 `\t\t\t\t\t\t\t\tif (id !== "rename" && id !== "delete") return;` 全文 1 次
 */

const T1 = "\t";
const T2 = "\t\t";
const T3 = "\t\t\t";
const T4 = "\t\t\t\t";

// ── 锚点 A：SessionTree 里的工作区拖动提交（L3120-L3136） ─────────────────────────
const ANCHOR_A_FIND = [
	T4 + "const owner = parents.get(activeDrag.workspaceId);",
	T4 + "const siblings = workspaces.filter((workspace) => parents.get(workspace.workspaceId) === owner);"
].join("\n");

const ANCHOR_A_REPLACE = [
	// workspace 模式（= 自定义分组模式）下，把「(目标组, 组内位置)」的换算整段交给分组层：
	//   先写 membership，再按纯函数算出的全局线性 anchor 调官方 Host 的 insertWorkspaceBefore。
	// tree 模式（按工作区树）完全不走这里 → 官方原逻辑一字不动。
	T4 + "if (!nestWorkspaces) {",
	T4 + T1 + "WSG.commitWorkspaceDrop(activeDrag.workspaceId, over, workspaces, insertWorkspaceBefore);",
	T4 + T1 + "return;",
	T4 + "}",
	ANCHOR_A_FIND
].join("\n");

// ── 锚点 B：SessionTree 的顶层行渲染（L3330） ───────────────────────────────────
const ANCHOR_B_FIND = T3 + "const groupRows = rootGroups.map((group) => renderGroup(group, 0));";

const ANCHOR_B_REPLACE = [
	// 用分组层的三层渲染替换「扁平 section 列表」：
	//   组头行（自己 push data-row-key 进 rowKeys）→ 组内官方 section（renderGroup(group, 1) 缩进一级）
	//   「未分组」是兜底组；被收起的组直接不产出成员行。
	// 非 workspace 模式（nestWorkspaces === true）时本函数原样透传 renderGroup(group, 0)。
	T3 + "const groupRows = WSG.renderTree({",
	T4 + "rootGroups,",
	T4 + "renderGroup,",
	T4 + "rowKeys,",
	T4 + "workspaces,",
	T4 + "nestWorkspaces,",
	// 官方自己的「工作区列表可信了吗」信号（上游 L3542 的 workspaceReady，SessionTree 本来就有这个 prop）：
	// 未就绪时分组层不做任何「按列表清洗归属」的落盘动作（审查 I3）。find/count 一字未动。
	T4 + "ready: workspaceReady,",
	T4 + "workspaceDrag,",
	T4 + "setWorkspaceDrag,",
	T4 + "commitWorkspaceDrag,",
	T4 + "t",
	T3 + "});"
].join("\n");

// ── 锚点 C / D：工作区行「…」菜单里加「移到分组…」（F8 的菜单兜底入口） ──────────
const ANCHOR_C_FIND = T3 + "const workspaceMenuItems = [{";
const ANCHOR_C_REPLACE = T3 + "const workspaceMenuItems = [...WSG.moveMenuItems(group.workspaceId, t), {";

const ANCHOR_D_INDENT = T4 + T4;
const ANCHOR_D_FIND = ANCHOR_D_INDENT + 'if (id !== "rename" && id !== "delete") return;';
const ANCHOR_D_REPLACE = [
	// 分组项自己消化掉；非分组 id 原样交给官方那两个分支（rename / delete）
	ANCHOR_D_INDENT + "if (WSG.moveSelect(id, group.workspaceId)) return;",
	ANCHOR_D_FIND
].join("\n");

export const patches = [
	{
		name: "标记①：点亮 globalThis.__wsgForkLoaded（接管成功探针）",
		find: T2 + "return module.exports;",
		replace: '\t\ttry { globalThis.__wsgForkLoaded = "0.2.1-rc.2+wsg.1"; } catch (error) { void error }\n' + T2 + "return module.exports;",
		count: 1
	},
	{
		name: "分组层 A：workspace 模式的工作区拖动提交交给 WSG（tree 模式保持官方原逻辑）",
		find: ANCHOR_A_FIND,
		replace: ANCHOR_A_REPLACE,
		count: 1
	},
	{
		name: "分组层 B：SessionTree 顶层行渲染改为 WSG.renderTree（组头 + 组内官方 section）",
		find: ANCHOR_B_FIND,
		replace: ANCHOR_B_REPLACE,
		count: 1
	},
	{
		name: "分组层 C：工作区行「…」菜单追加「移到分组…」项（F8；tree/flat 模式下为空数组）",
		find: ANCHOR_C_FIND,
		replace: ANCHOR_C_REPLACE,
		count: 1
	},
	{
		name: "分组层 D：菜单选择里先让分组项自己消化，其余 id 交回官方分支",
		find: ANCHOR_D_FIND,
		replace: ANCHOR_D_REPLACE,
		count: 1
	}
];
