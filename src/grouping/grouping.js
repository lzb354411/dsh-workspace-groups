/**
 * WSG 分组层（工厂内代码）—— 由 tools/build-fork.mjs 原样注入官方 factory 的
 * `exports.apply = apply;` 之前，因此：
 *   - 本文件**不允许出现 import / export**（构建脚本会因此失败）；
 *   - 与官方代码共享同一作用域：可以直接按名字用官方内部的函数 / 常量 / CSS 类对象；
 *   - 但**不要在顶层调用官方函数**（本文件顶层只做「自己的常量与纯函数调用」）；
 *   - 纯函数在 src/grouping/*.pure.js 里，构建时被拼到本文件**之前**，直接按名字用。
 *
 * 功能（SPEC F1–F13）：在官方 `groupBy === "workspace"` 模式之上叠一层自定义分组
 *   组头（组名 + 收起箭头 + 成员数）→ 组内官方工作区分区 → 会话行。
 *   官方另外两种模式（按工作区树 / 单列表）与所有官方子槽位一字不改地照旧。
 */

// ─────────────────────────────────────────────────────────── 常量 / 文案 / 样式

const WSG_STATE_URL = "/dsh-workspace-groups/state";
const WSG_COLLAPSE_KEY = "dsh.workspace.groups.view.v1";
const WSG_VERSION = "wsg-grouping-2";

const WSG_TEXT = {
	zh: {
		newGroup: "＋ 新建分组",
		rename: "重命名",
		remove: "删除分组",
		namePlaceholder: "分组名字",
		nameEmpty: "名字不能为空",
		confirmBody: "只删这个组，里面的工作区不会被删",
		confirmOk: "删除",
		cancel: "取消",
		save: "确定",
		actions: "分组操作",
		count: "个"
	},
	en: {
		newGroup: "+ New group",
		rename: "Rename",
		remove: "Delete group",
		namePlaceholder: "Group name",
		nameEmpty: "Name cannot be empty",
		confirmBody: "Only this group is deleted; its workspaces stay",
		confirmOk: "Delete",
		cancel: "Cancel",
		save: "OK",
		actions: "Group actions",
		count: "items"
	}
};

const WSG_LABEL = "var(--dsw-alias-label-secondary, currentColor)";
const WSG_LABEL_DIM = "var(--dsw-alias-label-tertiary, currentColor)";
const WSG_LABEL_STRONG = "var(--dsw-alias-label-primary, currentColor)";
const WSG_HOVER = "var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.14))";
const WSG_ACCENT = "var(--dsw-alias-state-business-primary, #4c8dff)";
const WSG_BORDER = "var(--dsw-alias-border-l4, rgba(127, 127, 127, 0.3))";

const WSG_STYLE_HEADER = {
	display: "flex",
	alignItems: "center",
	gap: "4px",
	height: "30px",
	paddingLeft: "6px",
	paddingRight: "4px",
	boxSizing: "border-box",
	cursor: "default",
	userSelect: "none",
	fontSize: "12px",
	fontWeight: 500,
	color: WSG_LABEL,
	borderRadius: "4px"
};
const WSG_STYLE_CHEVRON = {
	display: "inline-flex",
	alignItems: "center",
	justifyContent: "center",
	width: "16px",
	height: "16px",
	flexShrink: 0,
	transition: "transform 120ms ease"
};
// 组头里「箭头 + 组名 + 成员数」这一块做成真正的 <button>：键盘 Tab 能到、回车/空格能开合。
// 官方 ProjectRowItem 的行是个带 onClick 的 div（没有 tabIndex）→ 键盘同样进不去，所以这里不能照抄。
const WSG_STYLE_TOGGLE = {
	display: "flex",
	alignItems: "center",
	gap: "4px",
	flex: "1 1 auto",
	minWidth: 0,
	margin: 0,
	padding: "0 4px 0 0",
	font: "inherit",
	color: "inherit",
	textAlign: "left",
	background: "transparent",
	border: "0 none",
	borderRadius: "4px",
	cursor: "pointer"
};
const WSG_STYLE_NAME = {
	flex: "1 1 auto",
	minWidth: 0,
	overflow: "hidden",
	whiteSpace: "nowrap",
	textOverflow: "ellipsis"
};
const WSG_STYLE_COUNT = {
	flexShrink: 0,
	fontSize: "11px",
	fontWeight: 400,
	color: WSG_LABEL_DIM,
	fontVariantNumeric: "tabular-nums"
};
const WSG_STYLE_ROW = {
	display: "flex",
	alignItems: "center",
	gap: "6px",
	padding: "4px 8px",
	boxSizing: "border-box",
	fontSize: "12px",
	color: WSG_LABEL
};
const WSG_STYLE_INPUT = {
	flex: "1 1 auto",
	minWidth: 0,
	height: "24px",
	boxSizing: "border-box",
	padding: "0 6px",
	fontSize: "12px",
	fontFamily: "inherit",
	color: WSG_LABEL_STRONG,
	background: "transparent",
	border: "1px solid " + WSG_BORDER,
	borderRadius: "4px",
	outline: "none"
};
const WSG_STYLE_BUTTON = {
	flexShrink: 0,
	height: "24px",
	padding: "0 8px",
	fontSize: "12px",
	fontFamily: "inherit",
	color: WSG_LABEL_STRONG,
	background: "transparent",
	border: "1px solid " + WSG_BORDER,
	borderRadius: "4px",
	cursor: "pointer"
};
const WSG_STYLE_LINK_BUTTON = {
	display: "block",
	width: "100%",
	textAlign: "left",
	padding: "4px 8px",
	fontSize: "12px",
	fontFamily: "inherit",
	color: WSG_LABEL_DIM,
	background: "transparent",
	border: "0 none",
	borderRadius: "4px",
	cursor: "pointer"
};
const WSG_STYLE_ERROR = {
	flexShrink: 0,
	fontSize: "11px",
	color: "var(--dsw-alias-state-error-primary, #e5484d)"
};
const WSG_STYLE_CONFIRM_TEXT = {
	flex: "1 1 auto",
	minWidth: 0,
	fontSize: "12px",
	color: WSG_LABEL_DIM
};

// ─────────────────────────────────────────────────────────── 极小的快照 store（React 外部可读）

const WSG_listeners = new Set();
let WSG_snapshot = {
	state: null,
	collapsed: WSG_readCollapsed(),
	// I2：只有**成功从 Host 读到过**真状态才置 true；在此之前一律不写回（见 WSG_commit）
	loaded: false
};
/** 本地改动版本号：每次 WSG_commit 加一，用来判断「读回来的远端状态是不是已经过时了」 */
let WSG_localRev = 0;

function WSG_getSnapshot() {
	return WSG_snapshot;
}

function WSG_subscribe(listener) {
	WSG_listeners.add(listener);
	return () => {
		WSG_listeners.delete(listener);
	};
}

function WSG_setSnapshot(patch) {
	WSG_snapshot = Object.assign({}, WSG_snapshot, patch);
	for (const listener of Array.from(WSG_listeners)) {
		try {
			listener();
		} catch (error) {
			console.warn("[wsg] 状态订阅者抛错：", error);
		}
	}
}

/** 当前分组状态（读不到就按空状态） */
function WSG_state() {
	return WSG_snapshot.state === null ? WSG_emptyState() : WSG_snapshot.state;
}

// ─────────────────────────────────────────────────────────── 持久化（分组走 Host 路由；收起状态走浏览器本地）

function WSG_readCollapsed() {
	try {
		if (typeof window === "undefined" || window.localStorage === void 0) return {};
		const raw = window.localStorage.getItem(WSG_COLLAPSE_KEY);
		if (raw === null) return {};
		const parsed = JSON.parse(raw);
		return parsed !== null && typeof parsed === "object" ? parsed : {};
	} catch (error) {
		console.warn("[wsg] 读取收起状态失败（按全部展开处理）：", error);
		return {};
	}
}

function WSG_writeCollapsed(collapsed) {
	try {
		if (typeof window === "undefined" || window.localStorage === void 0) return;
		window.localStorage.setItem(WSG_COLLAPSE_KEY, JSON.stringify(collapsed));
	} catch (error) {
		console.warn("[wsg] 保存收起状态失败（本次会话内仍然有效）：", error);
	}
}

/** 读一次 Host 状态；**读不到就返回 null**（调用方据此重试或保持现状 —— 绝不拿空状态去写回） */
async function WSG_loadState() {
	try {
		const response = await fetch(WSG_STATE_URL, {
			method: "GET",
			headers: { "x-dsh-workspace-groups": "1" }
		});
		if (response.ok !== true) throw new Error("HTTP " + response.status);
		const raw = await response.json();
		return WSG_sanitizeState(raw).state;
	} catch (error) {
		console.warn("[wsg] 读取分组状态失败（本次不写回，稍后重试）：", error);
		return null;
	}
}

/** 写回在途计数：避免「读回来的可能是写之前的旧文件」这种自我打脸（见 WSG_refreshFromHost） */
let WSG_postInFlight = 0;
let WSG_postChain = Promise.resolve();

async function WSG_postOnce(body) {
	try {
		const response = await fetch(WSG_STATE_URL, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-dsh-workspace-groups": "1"
			},
			body: JSON.stringify(body),
			// keepalive：页面正在卸载（刷新 / 关窗）时也把这次请求发完（I1）
			keepalive: true
		});
		if (response.ok !== true) throw new Error("HTTP " + response.status);
	} catch (error) {
		console.warn("[wsg] 分组状态写回失败（界面已更新，但可能没存下来）：", error);
	}
}

/**
 * 写回串成一条 Promise 链（I1）：两次写回不再并发 → 后发的不会先落盘。
 * 失败已经在 WSG_postOnce 里吞掉，所以链永不断。
 */
function WSG_postState(body) {
	const fire = () => {
		WSG_postInFlight += 1;
		const settled = () => {
			WSG_postInFlight -= 1;
		};
		return WSG_postOnce(body).then(settled, settled);
	};
	WSG_postChain = WSG_postChain.then(fire, fire);
	return WSG_postChain;
}

// ─────────────────────────────────────────────────────────── 写回（乐观更新 + 500ms 防抖）

let WSG_writerInstance = null;

function WSG_writer() {
	if (WSG_writerInstance === null) {
		WSG_writerInstance = WSG_createWriter({
			delayMs: WSG_WRITE_DEBOUNCE_MS,
			timers: {
				set: (fn, ms) => setTimeout(fn, ms),
				clear: (handle) => clearTimeout(handle)
			},
			post: (body) => {
				WSG_postState(body);
			}
		});
	}
	return WSG_writerInstance;
}

/** 立即把待写改动发出去（pagehide / 页面转后台时用；flush 早就有了，这里只是接线） */
function WSG_flushNow() {
	try {
		WSG_writer().flush();
	} catch (error) {
		console.warn("[wsg] 立即写回失败：", error);
	}
}

/** 本地状态立即改、界面立即变；500ms 内合并成一次完整状态 POST */
function WSG_commit(next) {
	WSG_localRev += 1;
	WSG_setSnapshot({ state: next });
	if (WSG_snapshot.loaded !== true) {
		// I2：还没成功读到过 Host 上的真状态 → 本地基线是空状态，这一刻写回等于把
		// 磁盘上的真状态覆盖成「几乎空」。所以只改内存、绝不 POST。
		console.warn("[wsg] 尚未成功加载到 Host 上的分组状态：本次改动只在本页生效、暂不写回");
		return;
	}
	if (WSG_isHostAcceptable(next) !== true) {
		// Minor 2 的最后一道闸：形状 Host 会拒收就干脆不发 —— 否则整份 POST 被 400，
		// 那一次攒着的所有改动会一起丢。
		console.warn("[wsg] 状态形状不被 Host 接受，已跳过本次写回：", next);
		return;
	}
	WSG_writer().queue(next);
}

let WSG_booted = false;
let WSG_retryIndex = 0;
let WSG_retryTimer = null;

/** 加载一次并按 WSG_shouldApplyRemote 决定是否采纳；失败按退避重试（期间永不写回） */
function WSG_loadOnce(allowRetry) {
	const revAtRequest = WSG_localRev;
	WSG_loadState().then((loaded) => {
		if (loaded === null) {
			if (allowRetry === true) WSG_scheduleRetry();
			return;
		}
		WSG_retryIndex = 0;
		const hadLocalEdits = WSG_snapshot.loaded !== true && WSG_localRev > 0;
		const apply = WSG_shouldApplyRemote({
			loaded: WSG_snapshot.loaded,
			localRev: WSG_localRev,
			revAtRequest
		});
		if (apply === true) {
			if (hadLocalEdits === true) {
				console.warn("[wsg] 首次加载到的 Host 状态覆盖了本页在加载期间的改动（那时还没有可信基线，写回反而会丢数据）");
			}
			WSG_setSnapshot({ state: loaded, loaded: true });
		} else {
			WSG_setSnapshot({ loaded: true });
			console.warn("[wsg] 已读到 Host 状态，但本页在此期间有更新的改动 → 保留本地改动");
		}
	});
}

/** 首次加载失败后的退避重试；用完就停（之后一直 loaded=false → 永不写回） */
function WSG_scheduleRetry() {
	const delays = WSG_retryDelays();
	if (WSG_retryIndex >= delays.length) return;
	const delay = delays[WSG_retryIndex];
	WSG_retryIndex += 1;
	if (WSG_retryTimer !== null) clearTimeout(WSG_retryTimer);
	WSG_retryTimer = setTimeout(() => {
		WSG_retryTimer = null;
		WSG_loadOnce(true);
	}, delay);
}

/**
 * 重新可见 / 重新获得焦点时重新读一次（C1 的可做部分）：把「整份覆盖」的丢数据窗口
 * 从「任意时长」压到「两个窗口同时编辑的几百毫秒内」。
 *
 * 两种情况下**刻意不发** GET：① 还有没写出去的本地改动（先 flush；此刻读回来的是旧文件）；
 * ② 写回还在路上（读回来的可能是写之前的旧文件 → 采纳它会把界面回退，而下一次改动
 * 又会把这份旧状态写回磁盘 = 真丢数据）。
 */
function WSG_refreshFromHost() {
	if (WSG_booted !== true) return;
	if (WSG_snapshot.loaded !== true) {
		WSG_loadOnce(true);
		return;
	}
	if (WSG_writer().stats().pending === true) {
		WSG_flushNow();
		return;
	}
	if (WSG_postInFlight > 0) return;
	WSG_loadOnce(false);
}

function WSG_boot() {
	if (WSG_booted) return;
	WSG_booted = true;
	WSG_loadOnce(true);
	try {
		if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
			// I1：卸载前把待写改动立刻发出去（配合 fetch 的 keepalive 让请求活过卸载）
			window.addEventListener("pagehide", WSG_flushNow);
			window.addEventListener("focus", WSG_refreshFromHost);
			if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
				document.addEventListener("visibilitychange", () => {
					if (document.visibilityState === "hidden") WSG_flushNow();
					else WSG_refreshFromHost();
				});
			}
		}
	} catch (error) {
		console.warn("[wsg] 注册卸载 / 可见性监听失败（不影响主要功能）：", error);
	}
}

// ─────────────────────────────────────────────────────────── 拖动提交（被 patch 调用的入口）

/**
 * workspace 模式下接管官方的工作区拖动提交：
 *   「(目标组, 组内位置)」→ Host 全局线性 anchor + 同时改 membership。
 * 由 patches.mjs 注入的 `commitWorkspaceDrag` 分支调用；tree 模式完全不经过这里。
 */
function WSG_commitWorkspaceDrop(workspaceId, over, workspaces, insertWorkspaceBefore) {
	const state = WSG_state();
	const plan = WSG_planWorkspaceDrag({
		workspaceId,
		over,
		order: workspaces.map((workspace) => workspace.workspaceId),
		membership: state.membership,
		groupIdOrder: state.groups.map((group) => group.id).concat([null])
	});
	if (plan === null) return null;
	if (plan.groupId !== void 0) WSG_commit(WSG_withMembership(state, workspaceId, plan.groupId));
	if (plan.reorder === true && typeof insertWorkspaceBefore === "function") {
		const outcome = insertWorkspaceBefore(workspaceId, plan.anchor);
		if (outcome !== null && outcome !== void 0 && typeof outcome.catch === "function") {
			outcome.catch((reason) => {
				console.warn("[wsg] workspace reorder rejected:", reason);
			});
		}
	}
	return plan;
}

// ─────────────────────────────────────────────────────────── F8「移到分组…」菜单兜底（拖动不方便时的等价入口）

/** 当前渲染是不是「按工作区」模式 —— 由 WSG_renderTree 每次渲染时刷新（tree / flat 模式下菜单里不出现分组项） */
let WSG_workspaceMode = false;

/**
 * 追加到官方工作区行「…」菜单里的分组项。
 * 只在 workspace 模式、且当前工作区不在该组里时才出现；`wsg-move:` 前缀避免与官方的 rename/delete id 冲突。
 */
function WSG_moveMenuItems(workspaceId, t) {
	if (WSG_workspaceMode !== true) return [];
	const zh = /[\u4e00-\u9fff]/.test(WSG_safeT(t, "group.ungrouped", "未分组"));
	const prefix = zh ? "移到分组：" : "Move to ";
	const state = WSG_state();
	const items = [];
	for (const group of state.groups) {
		if (state.membership[workspaceId] === group.id) continue;
		items.push({
			id: "wsg-move:" + group.id,
			label: prefix + group.name,
			icon: react_jsx_runtime.jsx(_deepseek_ai_dsh_client_ui_primitives.IconFolderCloseRegular, {})
		});
	}
	if (state.membership[workspaceId] !== void 0) {
		items.push({
			id: "wsg-move:",
			label: prefix + WSG_safeT(t, "group.ungrouped", "未分组"),
			icon: react_jsx_runtime.jsx(_deepseek_ai_dsh_client_ui_primitives.IconFolderCloseRegular, {})
		});
	}
	return items;
}

/** 处理菜单选择：是分组项就落地并返回 true（官方 onSelect 据此提前 return） */
function WSG_moveSelect(id, workspaceId) {
	if (typeof id !== "string" || id.indexOf("wsg-move:") !== 0) return false;
	const state = WSG_state();
	const raw = id.slice("wsg-move:".length);
	const groupId = raw === "" ? null : raw;
	if (groupId !== null && WSG_findGroup(state.groups, groupId) === void 0) return true;
	WSG_commit(WSG_withMembership(state, workspaceId, groupId));
	return true;
}

// ─────────────────────────────────────────────────────────── 渲染

/**
 * 半区分判定：行的上半 → 插到前面，下半 → 插到后面。
 *
 * 刻意与官方 `workspaceGroupHalf`（上游 L3001-3004）**不是同一个对象**，所以也不该长得一样：
 *   官方那个挂在「工作区 + 它全部会话行」的整块 section 容器上，用的是**整块**中线
 *   （落上半/下半 = 该工作区之前 / 之后）；
 *   这里只服务于 30px 高的**组头行**，用组头自身中线，语义是「插到组首 / 组尾」。
 * 后人别为了「看起来一致」把两者改成同一套 —— 那是把组头当容器块了。
 */
function WSG_halfOf(event) {
	try {
		const rect = event.currentTarget.getBoundingClientRect();
		return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
	} catch (error) {
		return "after";
	}
}

function WSG_useSnapshot() {
	if (typeof react.useSyncExternalStore === "function") {
		return react.useSyncExternalStore(WSG_subscribe, WSG_getSnapshot);
	}
	const [value, setValue] = react.useState(WSG_getSnapshot);
	react.useEffect(() => WSG_subscribe(() => setValue(WSG_getSnapshot())), []);
	return value;
}

/**
 * 三层渲染的入口：官方 `const groupRows = rootGroups.map((group) => renderGroup(group, 0));` 被换成本函数。
 *
 * 注意：本函数在 SessionTree 的**渲染期**被无条件调用一次，所以内部可以安全地使用 React hooks
 * （等价于一个自定义 hook）。hooks 必须在任何分支之前全部调用完（切换视图模式时 hook 顺序不变）。
 *
 * @param ctx 由 patches.mjs 在 SessionTree 里就地组装：
 *            { rootGroups, renderGroup, rowKeys, workspaces, nestWorkspaces,
 *              workspaceDrag, setWorkspaceDrag, commitWorkspaceDrag, t }
 * @returns 行数组，直接作为 AnimatedRows 的 children 之一
 */
function WSG_renderTree(ctx) {
	const isWorkspaceMode = ctx.nestWorkspaces !== true;
	// 子组件（ProjectRowItem）的渲染发生在本函数之后，所以这里刷新的标记对本次渲染的菜单项一定是最新的
	WSG_workspaceMode = isWorkspaceMode;
	const t = ctx.t;
	const ungroupedLabel = WSG_safeT(t, "group.ungrouped", "未分组");
	const text = WSG_TEXT[/[\u4e00-\u9fff]/.test(ungroupedLabel) ? "zh" : "en"];
	const snapshot = WSG_useSnapshot();
	const [ui, setUi] = react.useState(null);
	const [groupDrag, setGroupDrag] = react.useState(null);
	react.useEffect(() => {
		WSG_boot();
	}, []);
	const state = snapshot.state === null ? WSG_emptyState() : snapshot.state;
	// I3：只有**官方自己认就绪**（上游 L3542 的 workspaceReady）且列表非空时，工作区列表才可信。
	// 未就绪 / 列表为空 → 传 undefined，纯函数的「不传就不洗」分支生效（project.pure.js:81/:87）：
	// 不完整的列表会把有效归属当残骸丢掉并落盘（刷新也回不来），这个风险必须堵住。
	const workspaceIds = ctx.ready === true && ctx.workspaces.length > 0 ? ctx.workspaces.map((workspace) => workspace.workspaceId) : void 0;
	const projected = WSG_project({
		state,
		sections: isWorkspaceMode ? ctx.rootGroups : [],
		workspaceIds,
		collapsed: snapshot.collapsed
	});
	const salt = projected.changed ? "1" : "0";
	react.useEffect(() => {
		if (salt !== "1") return;
		WSG_commit(projected.state);
	}, [salt]);

	const rows = [];
	if (!isWorkspaceMode) {
		for (const section of ctx.rootGroups) rows.push(ctx.renderGroup(section, 0));
		return rows;
	}

	const closeUi = () => setUi(null);

	const toggleBucket = (bucket) => {
		const next = Object.assign({}, snapshot.collapsed);
		if (bucket.expanded) next[bucket.bucketKey] = true;
		else delete next[bucket.bucketKey];
		WSG_writeCollapsed(next);
		WSG_setSnapshot({ collapsed: next });
	};

	const submitGroupName = (name) => {
		if (WSG_isValidGroupName(name) !== true) {
			// 提示本身由渲染期派生（见 renderInputRow），这里只是保留一条显式错误、并**保持输入行打开**
			setUi(Object.assign({}, ui, { error: text.nameEmpty }));
			return;
		}
		const trimmed = name.trim();
		if (ui.kind === "new") WSG_commit(WSG_addGroup(state, WSG_makeGroupId(), trimmed));
		else WSG_commit(WSG_renameGroup(state, ui.bucketKey, trimmed));
		closeUi();
	};

	const commitGroupDrag = (drag, target) => {
		setGroupDrag(null);
		if (drag === null || target === null) return;
		const next = WSG_reorderGroups(state.groups, drag.id, target.id, target.half);
		if (next !== null) WSG_commit(Object.assign({}, state, { groups: next }));
	};

	const renderInputRow = (options) => {
		// 提示**在渲染期从 draft 派生**（不是只在点「确定」时设一次状态）：这样键盘用户一打空格
		// 就能看到原因，而且完全不依赖点击事件链路 —— SPEC F2 要求「输入框下面提示」。
		// 行内用 flexWrap + flexBasis:100% 让提示落在输入行**下面**，同时保持「一行一个 row-key」。
		const derived = WSG_nameHint(options.draft, text.nameEmpty);
		const hint = derived !== null ? derived : ui.error === null || ui.error === void 0 ? null : ui.error;
		return react_jsx_runtime.jsxs(
			"div",
			{
				"data-row-key": options.rowKey,
				style: Object.assign({}, WSG_STYLE_ROW, { paddingLeft: options.indent, flexWrap: "wrap" }),
				children: [
					react_jsx_runtime.jsx("input", {
						autoFocus: true,
						value: options.draft,
						placeholder: text.namePlaceholder,
						spellCheck: false,
						style: WSG_STYLE_INPUT,
						"aria-invalid": hint !== null,
						onChange: (event) => setUi(Object.assign({}, ui, { draft: event.target.value, error: null })),
						onClick: (event) => event.stopPropagation(),
						onKeyDown: (event) => {
							event.stopPropagation();
							if (event.key === "Enter") submitGroupName(options.draft);
							else if (event.key === "Escape") closeUi();
						}
					}),
					react_jsx_runtime.jsx("button", {
						type: "button",
						style: WSG_STYLE_BUTTON,
						onClick: () => submitGroupName(options.draft),
						children: text.save
					}),
					react_jsx_runtime.jsx("button", {
						type: "button",
						style: WSG_STYLE_BUTTON,
						onClick: closeUi,
						children: text.cancel
					}),
					hint === null
						? null
						: react_jsx_runtime.jsx("span", {
								"data-wsg-hint": options.kind,
								role: "status",
								"aria-live": "polite",
								style: Object.assign({}, WSG_STYLE_ERROR, { flexBasis: "100%" }),
								children: hint
							})
				]
			},
			options.rowKey
		);
	};

	// 顶部「＋ 新建分组」行 —— F2 的入口
	const newRowKey = "wsg:new";
	ctx.rowKeys.push(newRowKey);
	if (ui !== null && ui.kind === "new") {
		rows.push(renderInputRow({
			rowKey: newRowKey,
			kind: "new",
			indent: "6px",
			draft: ui.draft
		}));
	} else {
		rows.push(
			react_jsx_runtime.jsx(
				"div",
				{
					"data-row-key": newRowKey,
					style: WSG_STYLE_ROW,
					children: react_jsx_runtime.jsx("button", {
						type: "button",
						style: WSG_STYLE_LINK_BUTTON,
						onClick: () => setUi({ kind: "new", draft: "", error: null }),
						children: text.newGroup
					})
				},
				newRowKey
			)
		);
	}

	for (const bucket of projected.buckets) {
		const isUngrouped = bucket.kind === "ungrouped";
		const bucketKey = bucket.bucketKey;
		const rowKey = "wsg:group:" + bucketKey;
		const name = isUngrouped ? ungroupedLabel : bucket.name;
		const menuOpen = ui !== null && ui.kind === "menu" && ui.bucketKey === bucketKey;
		const dragOver = groupDrag !== null && groupDrag.overKey === bucketKey ? groupDrag.half : null;
		ctx.rowKeys.push(rowKey);

		const menuItems = isUngrouped ? void 0 : [
			{
				id: "rename",
				label: text.rename,
				icon: react_jsx_runtime.jsx(_deepseek_ai_dsh_client_ui_primitives.IconEditOutlineRegular, {})
			},
			{
				id: "remove",
				label: text.remove,
				icon: react_jsx_runtime.jsx(_deepseek_ai_dsh_client_ui_primitives.IconTrashOutlineRegular, {}),
				danger: true
			}
		];

		const header = react_jsx_runtime.jsxs(
			"div",
			{
				"data-row-key": rowKey,
				role: "treeitem",
				"aria-expanded": bucket.expanded,
				"aria-label": name,
				draggable: !isUngrouped,
				style: Object.assign({}, WSG_STYLE_HEADER, dragOver === "before" ? { boxShadow: "inset 0 2px 0 0 " + WSG_ACCENT } : {}, dragOver === "after" ? { boxShadow: "inset 0 -2px 0 0 " + WSG_ACCENT } : {}),
				onClick: () => toggleBucket(bucket),
				onDragStart: isUngrouped
					? void 0
					: (event) => {
							event.stopPropagation();
							if (event.dataTransfer !== null && event.dataTransfer !== void 0) {
								event.dataTransfer.effectAllowed = "move";
								event.dataTransfer.setData("text/plain", "wsg-group:" + bucketKey);
							}
							setGroupDrag({ id: bucketKey, overKey: null, half: null });
						},
				onDragEnd: isUngrouped
					? void 0
					: (event) => {
							event.stopPropagation();
							// 松手在列表外 → 什么都不提交，顺序保持拖动前（F6）
							setGroupDrag(null);
						},
				onDragOver: (event) => {
					if (groupDrag !== null) {
						if (isUngrouped || groupDrag.id === bucketKey) return;
						event.preventDefault();
						event.stopPropagation();
						if (event.dataTransfer !== null && event.dataTransfer !== void 0) event.dataTransfer.dropEffect = "move";
						const half = WSG_halfOf(event);
						if (groupDrag.overKey !== bucketKey || groupDrag.half !== half) setGroupDrag(Object.assign({}, groupDrag, { overKey: bucketKey, half }));
						return;
					}
					const active = ctx.workspaceDrag;
					if (active === null || active === void 0) return;
					event.preventDefault();
					event.stopPropagation();
					if (event.dataTransfer !== null && event.dataTransfer !== void 0) event.dataTransfer.dropEffect = "move";
					const half = WSG_halfOf(event);
					if (active.over !== null && active.over !== void 0 && active.over.groupId === bucket.id && active.over.half === half) return;
					ctx.setWorkspaceDrag(Object.assign({}, active, { over: { groupId: bucket.id, half } }));
				},
				onDrop: (event) => {
					if (groupDrag !== null) {
						event.preventDefault();
						event.stopPropagation();
						commitGroupDrag(groupDrag, isUngrouped ? null : { id: bucketKey, half: WSG_halfOf(event) });
						return;
					}
					const active = ctx.workspaceDrag;
					if (active === null || active === void 0) return;
					event.preventDefault();
					event.stopPropagation();
					ctx.commitWorkspaceDrag(active, { groupId: bucket.id, half: WSG_halfOf(event) });
				},
				children: [
					react_jsx_runtime.jsxs(
						"button",
						{
							type: "button",
							"aria-expanded": bucket.expanded,
							"aria-label": name,
							style: WSG_STYLE_TOGGLE,
							// 行本身也留了整行点击；这里必须 stopPropagation，否则一次点击会开合两次（净效果为零）
							onClick: (event) => {
								event.stopPropagation();
								toggleBucket(bucket);
							},
							children: [
								react_jsx_runtime.jsx("span", {
									style: Object.assign({}, WSG_STYLE_CHEVRON, { transform: bucket.expanded ? "rotate(90deg)" : "rotate(0deg)" }),
									children: react_jsx_runtime.jsx(_deepseek_ai_dsh_client_ui_primitives.IconTriangleRightFillRegular, {})
								}),
								react_jsx_runtime.jsx("span", {
									style: WSG_STYLE_NAME,
									title: name,
									children: name
								}),
								react_jsx_runtime.jsx("span", {
									style: WSG_STYLE_COUNT,
									children: String(bucket.memberCount)
								})
							]
						},
						"toggle"
					),
					menuItems === void 0
						? null
						: react_jsx_runtime.jsx(_deepseek_ai_dsh_client_ui_primitives.Menu, {
								open: menuOpen,
								onClose: closeUi,
								items: menuItems,
								onSelect: (id) => {
									closeUi();
									if (id === "rename") setUi({ kind: "rename", bucketKey, draft: name, error: null });
									else if (id === "remove") setUi({ kind: "confirm", bucketKey });
								},
								portal: true,
								closeOnPointerLeave: true,
								anchor: react_jsx_runtime.jsx("button", {
									type: "button",
									className: Rows_module_css_default.iconButton,
									"aria-label": text.actions,
									onClick: (event) => {
										event.stopPropagation();
										setUi(menuOpen ? null : { kind: "menu", bucketKey });
									},
									children: react_jsx_runtime.jsx(_deepseek_ai_dsh_client_ui_primitives.IconEllipsisOutlineRegular, {})
								})
							})
				]
			},
			rowKey
		);
		rows.push(header);

		if (menuOpen === false && ui !== null && ui.kind === "rename" && ui.bucketKey === bucketKey) {
			const renameRowKey = rowKey + ":rename";
			ctx.rowKeys.push(renameRowKey);
			rows.push(renderInputRow({
				rowKey: renameRowKey,
				kind: "rename",
				indent: "22px",
				draft: ui.draft
			}));
		}
		if (ui !== null && ui.kind === "confirm" && ui.bucketKey === bucketKey) {
			const confirmRowKey = rowKey + ":confirm";
			ctx.rowKeys.push(confirmRowKey);
			rows.push(
				react_jsx_runtime.jsxs(
					"div",
					{
						"data-row-key": confirmRowKey,
						style: Object.assign({}, WSG_STYLE_ROW, { paddingLeft: "22px" }),
						children: [
							react_jsx_runtime.jsx("span", { style: WSG_STYLE_CONFIRM_TEXT, children: text.confirmBody }),
							react_jsx_runtime.jsx("button", {
								type: "button",
								style: WSG_STYLE_BUTTON,
								onClick: () => {
									closeUi();
									WSG_commit(WSG_removeGroup(state, bucketKey));
								},
								children: text.confirmOk
							}),
							react_jsx_runtime.jsx("button", {
								type: "button",
								style: WSG_STYLE_BUTTON,
								onClick: closeUi,
								children: text.cancel
							})
						]
					},
					confirmRowKey
				)
			);
		}

		if (!bucket.expanded) continue;
		for (const section of bucket.members) rows.push(ctx.renderGroup(section, 1));
	}

	return rows;
}

function WSG_safeT(t, key, fallback) {
	try {
		const value = t(key);
		return typeof value === "string" && value !== "" ? value : fallback;
	} catch (error) {
		return fallback;
	}
}

// ─────────────────────────────────────────────────────────── 对外接口（被 patches.mjs 引用）

const WSG = {
	version: WSG_VERSION,
	renderTree: WSG_renderTree,
	commitWorkspaceDrop: WSG_commitWorkspaceDrop,
	planWorkspaceDrag: WSG_planWorkspaceDrag,
	moveMenuItems: WSG_moveMenuItems,
	moveSelect: WSG_moveSelect,
	state: WSG_state,
	project: WSG_project
};

try {
	globalThis.__wsgGrouping = {
		version: WSG_VERSION,
		state: () => WSG_state(),
		collapsed: () => WSG_snapshot.collapsed,
		// 只读诊断出口（真机验证用）：加载状态 / 本地改动版本 / 在途写回 / 待写改动
		loaded: () => WSG_snapshot.loaded === true,
		localRev: () => WSG_localRev,
		inFlight: () => WSG_postInFlight,
		pendingWrites: () => WSG_writer().stats(),
		flush: () => {
			WSG_flushNow();
		},
		refresh: () => {
			WSG_refreshFromHost();
		},
		clearCollapsed: () => {
			WSG_writeCollapsed({});
			WSG_setSnapshot({ collapsed: {} });
		}
	};
} catch (error) {
	console.warn("[wsg] 挂调试句柄失败（不影响功能）：", error);
}
