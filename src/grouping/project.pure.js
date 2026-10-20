/**
 * WSG 纯函数（一）：分组状态的清洗 + 「自定义分组 → 工作区分区」两层投影。
 *
 * 约定：
 *   - 本文件内容会被 tools/build-fork.mjs 去掉行首 `export ` 后，原样拼进官方 factory，
 *     所以**不允许出现 import**，也不要在顶层调用官方函数；只用标准 ES2015+ 语法。
 *   - 所有标识符加 `WSG_` 前缀，避免与官方 factory 内的名字（deriveGroups / buildGroup / …）重名。
 *   - 纯函数：不碰 DOM、不碰网络、不依赖 React，可在 Node 里直接 import 测试。
 *
 * 契约状态形状（与 Host 半边一致）：
 *   { version: 1, groups: [{ id, name, order }], membership: { [workspaceId]: groupId } }
 */

/** 空状态（契约形状）。读不到 / 坏掉时一律退到这里。 */
export function WSG_emptyState() {
	return {
		version: 1,
		groups: [],
		membership: {}
	};
}

/** 生成新分组 id：`g-` + 8 位十六进制（random 可注入，便于测试） */
export function WSG_makeGroupId(random) {
	const pick = random === void 0 ? Math.random : random;
	let hex = "";
	for (let i = 0; i < 8; i++) hex += "0123456789abcdef"[Math.floor(pick() * 16) % 16];
	return "g-" + hex;
}

/**
 * 分组名输入框的提示文案：`null` = 合法、不用提示。
 *
 * **刻意做成「渲染期按 draft 派生」的纯函数**，而不是「点确定时设一次状态」：
 *   ① SPEC F2 的验收要求「输入空名字或只有空格 → 不允许建 + 输入框下面提示」，派生式让用户
 *      打空格的当下就能看到原因（键盘用户也感知得到，配合 aria-live）；
 *   ② 它不依赖任何点击事件链路 —— 提示出不出现不再取决于某个 handler 有没有跑到。
 * 规则与 Host 一致（`plugin/lib/state-store.js:91`：`name.trim() === ''` → 400）。
 */
export function WSG_nameHint(draft, emptyMessage) {
	const value = typeof draft === "string" ? draft : "";
	return value.trim() === "" ? emptyMessage : null;
}

/** 名字能不能用来建组 / 改名（trim 后必须非空）—— 与上面的提示同一条规则 */
export function WSG_isValidGroupName(draft) {
	return typeof draft === "string" && draft.trim() !== "";
}

/** 两个状态是否等价（只比契约字段；用于「界面算出来的干净状态要不要写回」的判定） */
export function WSG_sameState(a, b) {
	if (a === b) return true;
	if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
	const ag = Array.isArray(a.groups) ? a.groups : [];
	const bg = Array.isArray(b.groups) ? b.groups : [];
	if (ag.length !== bg.length) return false;
	for (let i = 0; i < ag.length; i++) {
		if (ag[i].id !== bg[i].id || ag[i].name !== bg[i].name || ag[i].order !== bg[i].order) return false;
	}
	const am = a.membership === null || typeof a.membership !== "object" ? {} : a.membership;
	const bm = b.membership === null || typeof b.membership !== "object" ? {} : b.membership;
	const ak = Object.keys(am);
	const bk = Object.keys(bm);
	if (ak.length !== bk.length) return false;
	for (const key of ak) if (am[key] !== bm[key]) return false;
	return true;
}

/**
 * 清洗状态：去残骸、去重、稳定排序。
 *
 * - 组的 id 必须是非空字符串；重复 id 只留第一个（按 order 排序前的原始位次）。
 * - `order` 是数字才认，否则用原始下标；清洗后重排为 0..n-1（保证「组的排序稳定」）。
 * - `membership` 里指向**不存在组**的记录一律丢掉 → F13 不留残骸。
 * - 传了 `workspaceIds`（当前官方工作区全集）时，指向**已不存在的工作区**的记录也丢掉。
 *
 * @returns {{ state: object, changed: boolean }} changed=true 表示原数据有残骸，应写回干净状态
 */
export function WSG_sanitizeState(raw, workspaceIds) {
	if (raw === null || typeof raw !== "object") return { state: WSG_emptyState(), changed: true };
	const rawGroups = Array.isArray(raw.groups) ? raw.groups : [];
	const seen = new Set();
	const picked = [];
	for (let i = 0; i < rawGroups.length; i++) {
		const group = rawGroups[i];
		if (group === null || typeof group !== "object") continue;
		const id = typeof group.id === "string" ? group.id.trim() : "";
		if (id === "" || seen.has(id)) continue;
		seen.add(id);
		const trimmedName = typeof group.name === "string" ? group.name.trim() : "";
		picked.push({
			id,
			// 与 Host 的校验规则**逐字对齐**（plugin/lib/state-store.js:91 `name.trim() === ''` → 400）：
			// trim 后为空的名字绝不允许进入待写状态 —— 否则 Host 会拒掉**整份** POST，
			// 那一次攒着的所有改动就一起丢了。兜底用 id 当名字：不丢组、不丢成员、语言中立、可改名。
			name: trimmedName === "" ? id : trimmedName,
			order: typeof group.order === "number" && Number.isFinite(group.order) ? group.order : i,
			at: i
		});
	}
	picked.sort((a, b) => (a.order - b.order) || (a.at - b.at));
	const groups = picked.map((group, index) => ({ id: group.id, name: group.name, order: index }));
	const idSet = new Set(groups.map((group) => group.id));
	const known = workspaceIds === void 0 ? void 0 : new Set(workspaceIds);
	const rawMembership = raw.membership !== null && typeof raw.membership === "object" ? raw.membership : {};
	const membership = {};
	for (const workspaceId of Object.keys(rawMembership)) {
		const groupId = rawMembership[workspaceId];
		if (typeof groupId !== "string" || !idSet.has(groupId)) continue;
		if (known !== void 0 && !known.has(workspaceId)) continue;
		membership[workspaceId] = groupId;
	}
	const state = {
		version: 1,
		groups,
		membership
	};
	return { state, changed: !WSG_sameState(state, raw) };
}

/** 按 id 找组（找不到返回 undefined） */
export function WSG_findGroup(groups, groupId) {
	for (const group of groups) if (group.id === groupId) return group;
	return void 0;
}

/** 追加一个分组（order 排在最后） */
export function WSG_addGroup(state, id, name) {
	const groups = state.groups.concat([{ id, name, order: state.groups.length }]);
	return {
		version: 1,
		groups,
		membership: state.membership
	};
}

/** 重命名一个分组（组内成员与先后不变，F3） */
export function WSG_renameGroup(state, groupId, name) {
	return {
		version: 1,
		groups: state.groups.map((group) => (group.id === groupId ? { id: group.id, name, order: group.order } : group)),
		membership: state.membership
	};
}

/** 删除一个分组：只删组，成员回「未分组」（F4） */
export function WSG_removeGroup(state, groupId) {
	const membership = {};
	for (const workspaceId of Object.keys(state.membership)) {
		if (state.membership[workspaceId] !== groupId) membership[workspaceId] = state.membership[workspaceId];
	}
	return {
		version: 1,
		groups: state.groups.filter((group) => group.id !== groupId).map((group, index) => ({ id: group.id, name: group.name, order: index })),
		membership
	};
}

/** 设置 / 取消（groupId = null）某个工作区的归属 */
export function WSG_withMembership(state, workspaceId, groupId) {
	const membership = Object.assign({}, state.membership);
	if (groupId === null) delete membership[workspaceId];
	else membership[workspaceId] = groupId;
	return {
		version: 1,
		groups: state.groups,
		membership
	};
}

/** 组自身拖动排序（F6）：把 dragId 放到 targetId 的前/后；无需变更时返回 null */
export function WSG_reorderGroups(groups, dragId, targetId, half) {
	const ids = groups.map((group) => group.id);
	const dragAt = ids.indexOf(dragId);
	const targetAt = ids.indexOf(targetId);
	if (dragAt === -1 || targetAt === -1 || dragId === targetId) return null;
	const dragged = groups[dragAt];
	const without = groups.filter((group) => group.id !== dragId);
	const at = without.findIndex((group) => group.id === targetId) + (half === "after" ? 1 : 0);
	const next = without.slice(0, at).concat([dragged], without.slice(at)).map((group, index) => ({ id: group.id, name: group.name, order: index }));
	if (next.every((group, index) => group.id === ids[index])) return null;
	return next;
}

/**
 * 投影：官方 `deriveGroups` 产出的 section 列表（每个工作区一个分区）
 *       → 「自定义分组 → 该组内的工作区分区」两层桶。
 *
 * - 桶顺序 = 组的 order 顺序；「未分组」永远是最后一个兜底桶。
 * - 空组也产出桶（F9：空组要显示出来）。
 * - 成员顺序保持官方 section 顺序（= Host 工作区顺序），组内不再重排。
 * - `membership` 指向不存在组 / 不存在工作区的记录在这里被忽略（F13）。
 * - 官方 section 对象**不被改写**，只做浅拷贝并加 `wsgGroupId` 标记。
 *
 * @returns {{ buckets: Array, state: object, changed: boolean, groupIdOrder: Array }}
 */
export function WSG_project(options) {
	const sections = Array.isArray(options.sections) ? options.sections : [];
	const workspaceIds = Array.isArray(options.workspaceIds) ? options.workspaceIds : [];
	const collapsed = options.collapsed !== null && typeof options.collapsed === "object" ? options.collapsed : {};
	const sanitized = WSG_sanitizeState(options.state, workspaceIds);
	const state = sanitized.state;
	const buckets = [];
	const byId = new Map();
	for (const group of state.groups) {
		const bucket = {
			kind: "group",
			id: group.id,
			name: group.name,
			bucketKey: group.id,
			expanded: collapsed[group.id] !== true,
			members: []
		};
		buckets.push(bucket);
		byId.set(group.id, bucket);
	}
	const ungrouped = {
		kind: "ungrouped",
		id: null,
		name: null,
		bucketKey: "",
		expanded: collapsed[""] !== true,
		members: []
	};
	buckets.push(ungrouped);
	for (const section of sections) {
		const workspaceId = section.workspaceId;
		if (workspaceId === void 0) {
			ungrouped.members.push(section);
			continue;
		}
		const groupId = state.membership[workspaceId];
		const bucket = groupId === void 0 ? ungrouped : byId.get(groupId);
		(bucket === void 0 ? ungrouped : bucket).members.push(section);
	}
	const marked = new Map();
	for (const bucket of buckets) {
		bucket.memberCount = bucket.members.length;
		bucket.members = bucket.members.map((section, index) => {
			const copy = Object.assign({}, section, {
				wsgGroupId: bucket.id,
				wsgFirst: index === 0,
				wsgLast: index === bucket.members.length - 1
			});
			marked.set(copy.key, copy);
			return copy;
		});
	}
	return {
		buckets,
		state,
		changed: sanitized.changed,
		groupIdOrder: buckets.map((bucket) => bucket.id)
	};
}
