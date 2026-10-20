/**
 * WSG 纯函数（二）：拖动的锚点换算。
 *
 * 这是本功能最容易错的地方（RECON §5：Host 只认「全局线性顺序」的 insertBefore）：
 *   界面上的投放目标是「(哪个分组, 组内哪个位置)」，而官方 Host 只接受
 *   `insertWorkspaceBefore(workspaceId, anchor)` —— 把一个个工作区搬到 `anchor` 前面，
 *   `anchor === undefined` 表示搬到全局末尾。
 *
 * 同时还要判定「要不要真搬」：位置没变但换了组时，只改归属、**不调 Host**。
 *
 * 约定同 project.pure.js：无 import、顶层不调官方函数、标识符 WSG_ 前缀、纯函数可单测。
 */

/** 取某工作区当前所属组；未归属返回 null（= 「未分组」兜底组） */
export function WSG_groupOf(membership, workspaceId) {
	if (membership === null || typeof membership !== "object") return null;
	const groupId = membership[workspaceId];
	return groupId === void 0 ? null : groupId;
}

/** 全局线性顺序里 id 的下一个（末尾返回 undefined，正好是「追加」语义） */
export function WSG_nextInOrder(order, id) {
	const at = order.indexOf(id);
	if (at === -1) return void 0;
	return order[at + 1];
}

/** 两个 id 序列是否完全相同（判断「其实没动」） */
export function WSG_sameOrder(a, b) {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

/** 目标组一个成员都没有时的兜底锚点：退到「显示顺序里下一个有成员的组」的第一个成员；都没有 → undefined（追加末尾） */
export function WSG_boundaryAnchor(order, membership, groupIdOrder, groupId) {
	const at = groupIdOrder.indexOf(groupId);
	if (at === -1) return void 0;
	for (let i = at + 1; i < groupIdOrder.length; i++) {
		for (const workspaceId of order) {
			if (WSG_groupOf(membership, workspaceId) === groupIdOrder[i]) return workspaceId;
		}
	}
	return void 0;
}

/**
 * 把一次「工作区投放」换算成提交计划。
 *
 * @param options.workspaceId 被拖动的工作区 id
 * @param options.over        投放目标：
 *                            - `{ groupId, half }` —— 落在分组头上（groupId=null 表示「未分组」头）
 *                            - `{ id, half }`      —— 落在某个工作区行上（官方原有形态）
 * @param options.order       当前 Host 全局线性顺序（工作区 id 数组）
 * @param options.membership  已清洗的归属表 `{ [workspaceId]: groupId }`
 * @param options.groupIdOrder 分组的显示顺序（自定义组 id…，最后一项是 null=未分组）
 * @returns {null | { reorder: boolean, anchor: string|undefined, groupId: string|null }}
 *          null = 什么都不用做（位置与归属都没变、或目标非法）
 *          anchor 只在 reorder=true 时有意义
 */
export function WSG_planWorkspaceDrag(options) {
	const workspaceId = options.workspaceId;
	const over = options.over;
	const order = Array.isArray(options.order) ? options.order : [];
	const membership = options.membership === null || typeof options.membership !== "object" ? {} : options.membership;
	const groupIdOrder = Array.isArray(options.groupIdOrder) ? options.groupIdOrder : [null];
	if (over === null || over === void 0 || typeof over !== "object") return null;
	if (order.indexOf(workspaceId) === -1) return null;

	let targetGroup;
	let anchor;
	if (over.groupId !== void 0) {
		targetGroup = over.groupId === null ? null : over.groupId;
		if (groupIdOrder.indexOf(targetGroup) === -1) return null;
		const members = order.filter((id) => id !== workspaceId && WSG_groupOf(membership, id) === targetGroup);
		// 方向默认值刻意与官方一致（审查 Minor 1）：官方是 `half === "before" ? 前面 : 后面`
		// （ui-workspace.client.js:3128），所以「before」写成分支、"before 以外"一律当「后面」。
		if (over.half === "before") {
			anchor = members.length > 0 ? members[0] : WSG_boundaryAnchor(order, membership, groupIdOrder, targetGroup);
		} else {
			const last = members[members.length - 1];
			anchor = last === void 0 ? WSG_boundaryAnchor(order, membership, groupIdOrder, targetGroup) : WSG_nextInOrder(order, last);
		}
	} else if (typeof over.id === "string") {
		if (order.indexOf(over.id) === -1) return null;
		targetGroup = WSG_groupOf(membership, over.id);
		// 同官方 L3128：`half === "before" ? over.id : siblings[rowIndex + 1]?.workspaceId`
		anchor = over.half === "before" ? over.id : WSG_nextInOrder(order, over.id);
	} else {
		return null;
	}

	// 用「模拟搬一次」来判断位置到底有没有变 —— 比照官方那套下标算术更不容易错
	const without = order.filter((id) => id !== workspaceId);
	let at;
	if (anchor === void 0) at = without.length;
	else if (anchor === workspaceId) at = Math.min(order.indexOf(workspaceId), without.length);
	else at = without.indexOf(anchor);
	if (at === -1) return null;
	const next = without.slice(0, at).concat([workspaceId], without.slice(at));
	const reorder = !WSG_sameOrder(next, order);
	const membershipChanged = WSG_groupOf(membership, workspaceId) !== targetGroup;
	if (!reorder && !membershipChanged) return null;
	return {
		reorder,
		anchor,
		groupId: targetGroup
	};
}
