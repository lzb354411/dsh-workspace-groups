/**
 * WSG 纯函数（四）：加载 / 刷新 / 写回的**时序与自证**判定。
 *
 * 这一组存在的理由（独立审查 REVIEW-1 的 I2 / I3 / C1 / Minor 2）：
 *   - 客户端每次写回都是**整份状态**，所以「什么时候可以写」和「读回来的能不能采纳」
 *     是两条会丢用户数据的判断，必须能单独测，不能埋在 fetch 的 then 里。
 *   - Host 只收它认得的形状（plugin/lib/state-store.js 的 validateState），
 *     送一份它拒收的状态 = **整份** POST 被 400 拒 = 那一次攒着的所有改动一起丢
 *     → 所以写回前要能自证「这份状态 Host 一定肯收」。
 *
 * 约定同其它 .pure.js：无 import、顶层不调官方函数、标识符 WSG_ 前缀、纯函数可单测。
 */

/**
 * 镜像 Host 的校验规则（逐条对应 plugin/lib/state-store.js:75-112 的 validateState）。
 *
 * 用途：客户端在**把状态交给写回层之前**自证合法性，把「形状分歧」在本地就变成
 * 「修一下再送」，而不是让 Host 400 掉整份 POST。两边规则必须同步改动。
 */
export function WSG_isHostAcceptable(state) {
	if (state === null || typeof state !== "object" || Array.isArray(state)) return false;
	if (state.version !== 1) return false;
	if (!Array.isArray(state.groups)) return false;
	for (const group of state.groups) {
		if (group === null || typeof group !== "object" || Array.isArray(group)) return false;
		if (typeof group.id !== "string" || group.id.trim() === "") return false;
		if (typeof group.name !== "string" || group.name.trim() === "") return false;
		if (typeof group.order !== "number" || !Number.isFinite(group.order)) return false;
	}
	if (state.membership === null || typeof state.membership !== "object" || Array.isArray(state.membership)) return false;
	for (const workspaceId of Object.keys(state.membership)) {
		if (typeof state.membership[workspaceId] !== "string") return false;
	}
	return true;
}

/**
 * 从 Host 读回来的状态**要不要采纳**（把「整份覆盖」这个丢数据窗口压到最小）。
 *
 * 两种情形的答案相反，刻意如此：
 *   - **还没成功加载过**（`loaded === false`）：本地基线不可信（是空状态），
 *     用户此刻的操作是拿空基线算出来的 → 必须以磁盘为准，否则第一次操作就会把
 *     磁盘上的真状态覆盖成「几乎空」（REVIEW-1 的 I2）。代价：加载期那几毫秒内的
 *     本地操作会被丢弃（页面会 warn 一句），但**磁盘不会被破坏**。
 *   - **已加载过**（`loaded === true`）：本地基线是对的；若这次请求发出之后本地又改过
 *     （`localRev !== revAtRequest`），说明本地比读回来的新 → 这次远端结果作废，别把
 *     本地改动冲掉。
 *
 * @param options - `{ loaded, localRev, revAtRequest }`
 * @returns 该不该用这份远端状态替换内存快照
 */
export function WSG_shouldApplyRemote(options) {
	const settings = options === void 0 ? {} : options;
	if (settings.loaded !== true) return true;
	const localRev = typeof settings.localRev === "number" ? settings.localRev : 0;
	const revAtRequest = typeof settings.revAtRequest === "number" ? settings.revAtRequest : 0;
	return localRev === revAtRequest;
}

/**
 * 首次加载失败后的重试退避（毫秒）。三次之后不再重试，但**永不写回** ——
 * 「读不到真状态」绝不等于「以空状态覆盖它」。
 */
export function WSG_retryDelays() {
	return [2000, 5000, 15000];
}
