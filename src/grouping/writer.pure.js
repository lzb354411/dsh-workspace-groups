/**
 * WSG 纯函数（三）：防抖合并写回。
 *
 * 语义（SPEC：界面立刻变、数据最终一致）：
 *   - `queue(state)` 只记「最新一份完整状态」，delayMs 内多次改动**只写一次**；
 *   - 写回的内容永远是**整份状态**（不是增量），Host 收到即可直接落盘；
 *   - `flush()` 立刻写（测试与页面卸载时用），没有待写内容时返回 null、不产生写请求。
 *
 * 定时器与 post 都是注入的 → 纯逻辑，可在 Node 里用假定时器单测（无真实等待）。
 */

/** 默认防抖时长（毫秒） */
export const WSG_WRITE_DEBOUNCE_MS = 500;

export function WSG_createWriter(options) {
	const settings = options === void 0 ? {} : options;
	const delayMs = typeof settings.delayMs === "number" ? settings.delayMs : WSG_WRITE_DEBOUNCE_MS;
	const timers = settings.timers;
	const post = settings.post;
	let handle = null;
	let pending = null;
	let writes = 0;
	let coalesced = 0;
	const flush = () => {
		if (handle !== null) {
			timers.clear(handle);
			handle = null;
		}
		const body = pending;
		pending = null;
		if (body === null) return null;
		writes += 1;
		post(body);
		return body;
	};
	return {
		/** 排队一次写回（同一次防抖窗口内只保留最后一份） */
		queue(state) {
			if (pending !== null) coalesced += 1;
			pending = state;
			if (handle !== null) timers.clear(handle);
			handle = timers.set(flush, delayMs);
		},
		flush,
		/** 观测用（测试断言「只写一次」） */
		stats() {
			return {
				writes,
				coalesced,
				pending: pending !== null
			};
		}
	};
}
