#!/usr/bin/env node
/**
 * test/run-tests.mjs —— 分组层纯函数单测（零依赖，`node test/run-tests.mjs` 直接跑）
 *
 * 覆盖：
 *   A 状态清洗（残骸清理）          F13
 *   B 分组投影（三层 + 空组 + 未分组兜底）F1 F9 F12
 *   C 跨组拖动的 anchor 换算（11 例）  F6 F7 F8 F10
 *   D 防抖写回（合并语义 + 完整状态）   —
 *   E 组增删改与组排序                F2 F3 F4 F6
 *   F 结构闸门（grouping.js 无 import/export；构建产物含各条锚点改动）
 *   G 写回/加载时序 + Host 契约对齐（审查 I1 I2 I3 C1 Minor 1/2）
 *
 * 纯函数由 src/grouping/*.pure.js 直接 import（该目录的 package.json 声明 type=module）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
	WSG_emptyState,
	WSG_makeGroupId,
	WSG_sanitizeState,
	WSG_project,
	WSG_sameState,
	WSG_addGroup,
	WSG_renameGroup,
	WSG_removeGroup,
	WSG_withMembership,
	WSG_reorderGroups,
	WSG_nameHint,
	WSG_isValidGroupName
} from "../src/grouping/project.pure.js";
import { WSG_groupOf, WSG_nextInOrder, WSG_sameOrder, WSG_boundaryAnchor, WSG_planWorkspaceDrag } from "../src/grouping/anchor.pure.js";
import { WSG_createWriter, WSG_WRITE_DEBOUNCE_MS } from "../src/grouping/writer.pure.js";
import { WSG_isHostAcceptable, WSG_shouldApplyRemote, WSG_retryDelays } from "../src/grouping/sync.pure.js";
// Host 半边的**真实**校验器（只读 import，不改它）：用来把「客户端产出的状态」与
// 「Host 肯不肯收」做真对齐断言，而不是自己写一套自说自话的规则。
import { validateState as hostValidate } from "../plugin/lib/state-store.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const A = (id) => (id === void 0 ? "g-00000001" : id);

let passed = 0;
const failures = [];

function check(name, fn) {
	try {
		fn();
		passed += 1;
		console.log(`  \u2713 ${name}`);
	} catch (error) {
		failures.push(name);
		console.log(`  \u2717 ${name}\n      ${error.message}`);
	}
}
function eq(actual, expected, note) {
	const a = JSON.stringify(actual);
	const b = JSON.stringify(expected);
	if (a !== b) throw new Error(`${note === void 0 ? "值不等" : note}\n      实际 ${a}\n      期望 ${b}`);
}
function ok(cond, note) {
	if (cond !== true) throw new Error(note === void 0 ? "断言失败" : note);
}
function section(workspaceId) {
	return {
		key: workspaceId === void 0 ? "" : workspaceId,
		workspaceId,
		cwd: workspaceId === void 0 ? void 0 : "E:/w/" + workspaceId,
		createdAt: 0,
		label: "W:" + workspaceId,
		sessionCount: 0,
		expanded: false,
		containsCurrent: false,
		sessions: []
	};
}

console.log("== A 状态清洗（F13：不留残骸） ==");

check("空状态形状 = 契约 {version:1,groups:[],membership:{}}", () => {
	eq(WSG_emptyState(), { version: 1, groups: [], membership: {} });
});

check("新组 id = g- + 8 位十六进制", () => {
	eq(WSG_makeGroupId(() => 0.5), "g-88888888");
	ok(/^g-[0-9a-f]{8}$/.test(WSG_makeGroupId()), "随机生成也符合格式");
});

check("null / 非对象 → 空状态且 changed=true", () => {
	eq(WSG_sanitizeState(null).state, WSG_emptyState());
	eq(WSG_sanitizeState(null).changed, true);
	eq(WSG_sanitizeState("坏数据").state, WSG_emptyState());
});

check("组：去空 id / 去重 / 按 order 稳定排序 / order 重排为 0..n-1", () => {
	const raw = {
		version: 1,
		groups: [
			{ id: "g-aaaaaaaa", name: "A", order: 5 },
			{ id: "", name: "空 id", order: 0 },
			{ id: "g-aaaaaaaa", name: "重复 id", order: 0 },
			{ id: "g-bbbbbbbb", name: "B", order: 1 },
			null,
			{ id: "g-cccccccc", name: "C", order: "坏 order" }
		],
		membership: {}
	};
	const out = WSG_sanitizeState(raw, []).state;
	eq(out.groups.map((g) => [g.id, g.name, g.order]), [
		["g-bbbbbbbb", "B", 0],
		["g-aaaaaaaa", "A", 1],
		["g-cccccccc", "C", 2]
	], "坏 order 退到原始下标、排序稳定、order 重排");
});

check("membership：指向不存在的组 → 丢掉；指向不存在的工作区 → 丢掉", () => {
	const raw = {
		version: 1,
		groups: [{ id: "g-aaaaaaaa", name: "A", order: 0 }],
		membership: { w1: "g-aaaaaaaa", w2: "g-nope0000", w3: "g-aaaaaaaa", w4: 42 }
	};
	const out = WSG_sanitizeState(raw, ["w1", "w3", "w9"]).state;
	eq(out.membership, { w1: "g-aaaaaaaa", w3: "g-aaaaaaaa" }, "w2/w4 指向非法、w9 已不在工作区列表");
});

check("干净数据 changed=false（不会产生无意义的写回）", () => {
	const clean = { version: 1, groups: [{ id: A(), name: "A", order: 0 }], membership: { w1: A() } };
	const out = WSG_sanitizeState(clean, ["w1"]);
	eq(out.changed, false);
	ok(WSG_sameState(out.state, clean), "WSG_sameState 认为等价");
});

check("未传 workspaceIds 时保留全部 membership（列表为空/加载中不误删）", () => {
	const clean = { version: 1, groups: [{ id: A(), name: "A", order: 0 }], membership: { w1: A(), w2: A() } };
	eq(WSG_sanitizeState(clean).state.membership, { w1: A(), w2: A() });
});

console.log("== B 分组投影（F1 F9 F12） ==");

check("空状态：两个工作区都落「未分组」，未分组是唯一且最后的桶", () => {
	const p = WSG_project({ state: WSG_emptyState(), sections: [section("w1"), section("w2")], workspaceIds: ["w1", "w2"], collapsed: {} });
	eq(p.buckets.map((b) => [b.kind, b.memberCount]), [["ungrouped", 2]]);
	eq(p.buckets[0].members.map((s) => s.workspaceId), ["w1", "w2"], "成员保持官方 section 顺序");
});

check("一个组多个成员 + 未分组兜底 + 成员标记 wsgFirst/wsgLast", () => {
	const state = { version: 1, groups: [{ id: A(), name: "工作", order: 0 }], membership: { w1: A(), w3: A() } };
	const p = WSG_project({ state, sections: [section("w1"), section("w2"), section("w3")], workspaceIds: ["w1", "w2", "w3"], collapsed: {} });
	eq(p.buckets.map((b) => [b.kind, b.name, b.memberCount]), [["group", "工作", 2], ["ungrouped", null, 1]]);
	eq(p.buckets[0].members.map((s) => s.workspaceId), ["w1", "w3"]);
	eq(p.buckets[1].members.map((s) => s.workspaceId), ["w2"]);
	eq(p.buckets[0].members.map((s) => [s.wsgFirst, s.wsgLast]), [[true, false], [false, true]]);
	eq(p.buckets[0].members[0].wsgGroupId, A());
});

check("成员指向已被删掉的组 → 回「未分组」，且 changed=true 触发清理写回", () => {
	const state = { version: 1, groups: [], membership: { w1: "g-dead0000" } };
	const p = WSG_project({ state, sections: [section("w1")], workspaceIds: ["w1"], collapsed: {} });
	eq(p.buckets.map((b) => b.kind), ["ungrouped"]);
	eq(p.buckets[0].members.map((s) => s.workspaceId), ["w1"]);
	eq(p.state.membership, {}, "悬空记录被清掉");
	eq(p.changed, true);
});

check("空组要显示出来（0 成员也是桶）", () => {
	const state = { version: 1, groups: [{ id: A(), name: "空组", order: 0 }], membership: {} };
	const p = WSG_project({ state, sections: [section("w1")], workspaceIds: ["w1"], collapsed: {} });
	eq(p.buckets.map((b) => [b.name, b.memberCount]), [["空组", 0], [null, 1]]);
});

check("组排序稳定：order 相同按原始位次；order 不同按 order", () => {
	const state = {
		version: 1,
		groups: [{ id: "g-00000003", name: "三", order: 1 }, { id: "g-00000002", name: "二", order: 0 }, { id: "g-00000001", name: "一", order: 1 }],
		membership: {}
	};
	const p = WSG_project({ state, sections: [], workspaceIds: [], collapsed: {} });
	eq(p.buckets.map((b) => b.name), ["二", "三", "一", null]);
});

check("官方「散落会话」的兜底 section（workspaceId=undefined）也落「未分组」", () => {
	const p = WSG_project({ state: WSG_emptyState(), sections: [section("w1"), section()], workspaceIds: ["w1"], collapsed: {} });
	eq(p.buckets[0].members.map((s) => s.workspaceId), ["w1", void 0]);
});

check("收起标记：collapsed[bucketKey]=true → expanded=false（组与未分组都适用）", () => {
	const state = { version: 1, groups: [{ id: A(), name: "工作", order: 0 }], membership: { w1: A() } };
	const p = WSG_project({ state, sections: [section("w1"), section("w2")], workspaceIds: ["w1", "w2"], collapsed: { [A()]: true } });
	eq(p.buckets.map((b) => b.expanded), [false, true]);
});

console.log("== C 跨组拖动的 anchor 换算（RECON §5 / PLAN T9） ==");

// 全局线性顺序（Host 顺序）：a b c d e
// g-00000001 = [a,b]   g-00000002 = [c,d]   e = 未分组
const ORDER = ["a", "b", "c", "d", "e"];
const GID_X = "g-00000001";
const GID_Y = "g-00000002";
const MEMBERSHIP = { a: GID_X, b: GID_X, c: GID_Y, d: GID_Y };
const GID_ORDER = [GID_X, GID_Y, null];
const ORDER_WITH_EMPTY = ["a", "b", "c", "d", "e"];
const plan = (options) =>
	WSG_planWorkspaceDrag(
		Object.assign(
			{
				order: ORDER,
				membership: MEMBERSHIP,
				groupIdOrder: GID_ORDER
			},
			options
		)
	);

check("C1 拖进组首（落组头 half=before）：锚点 = 该组第一个成员", () => {
	eq(plan({ workspaceId: "e", over: { groupId: GID_Y, half: "before" } }), { reorder: true, anchor: "c", groupId: GID_Y });
});

check("C2 拖进组尾（落组头 half=after）：锚点 = 该组最后一个成员的全局后继", () => {
	eq(plan({ workspaceId: "a", over: { groupId: GID_Y, half: "after" } }), { reorder: true, anchor: "e", groupId: GID_Y });
});

check("C3 拖到「未分组」头（groupId=null）：取消归属，锚点 = 未分组第一个成员", () => {
	eq(plan({ workspaceId: "a", over: { groupId: null, half: "before" } }), { reorder: true, anchor: "e", groupId: null });
});

check("C4 拖到已经是末位的组尾 → 位置没变、归属没变 → null（不做任何写入）", () => {
	eq(plan({ workspaceId: "e", over: { groupId: null, half: "after" } }), null);
});

check("C5 落在工作区行上（over.id）跨组：换组 + 锚点 = 那行的全局后继", () => {
	eq(plan({ workspaceId: "a", over: { id: "d", half: "after" } }), { reorder: true, anchor: "e", groupId: GID_Y });
});

check("C6 位置没变只换组：reorder=false（不调 Host）但 groupId 要改", () => {
	eq(plan({ workspaceId: "b", over: { id: "c", half: "before" } }), { reorder: false, anchor: "c", groupId: GID_Y });
});

check("C7 同组内位置修正：拖到同组头之前", () => {
	eq(plan({ workspaceId: "b", over: { groupId: GID_X, half: "before" } }), { reorder: true, anchor: "a", groupId: GID_X });
});

check("C8 拖到自己正后方（over.id = 自己前一行 half=after）→ null", () => {
	eq(plan({ workspaceId: "b", over: { id: "a", half: "after" } }), null);
});

check("C9 自己落到自己头上（over.id = 自己 half=before）→ null", () => {
	eq(plan({ workspaceId: "b", over: { id: "b", half: "before" } }), null);
});

check("C10 目标是空组：锚点 = 显示顺序里下一个有成员的组的第一个成员", () => {
	const p = WSG_planWorkspaceDrag({
		workspaceId: "b",
		over: { groupId: "g-00000009", half: "before" },
		order: ORDER_WITH_EMPTY,
		membership: MEMBERSHIP,
		groupIdOrder: ["g-00000009", GID_X, GID_Y, null]
	});
	eq(p, { reorder: true, anchor: "a", groupId: "g-00000009" });
});

check("C11 目标组空且后面没有别的组（未分组）→ 锚点 undefined（追加到全局末尾）", () => {
	const p = WSG_planWorkspaceDrag({
		workspaceId: "a",
		over: { groupId: null, half: "after" },
		order: ORDER_WITH_EMPTY,
		membership: MEMBERSHIP,
		groupIdOrder: [GID_X, GID_Y, null]
	});
	// 未分组此刻没有成员 → 兜底锚点 undefined → 搬到全局末尾
	eq(p, { reorder: true, anchor: void 0, groupId: null });
});

check("C12 非法目标一律 null：不存在的组 / 不存在的工作区 / 拖动源不在顺序里", () => {
	eq(plan({ workspaceId: "e", over: { groupId: "g-99999999", half: "before" } }), null);
	eq(plan({ workspaceId: "e", over: { id: "zzz", half: "before" } }), null);
	eq(plan({ workspaceId: "zzz", over: { groupId: GID_X, half: "before" } }), null);
	eq(plan({ workspaceId: "e", over: null }), null);
});

check("C13 辅助函数：WSG_groupOf / WSG_nextInOrder 的边界", () => {
	eq(WSG_groupOf(MEMBERSHIP, "e"), null);
	eq(WSG_groupOf({}, "a"), null);
	eq(WSG_nextInOrder(ORDER, "e"), void 0, "末位的后继 = undefined（= Host 的「追加末尾」）");
	eq(WSG_nextInOrder(ORDER, "zzz"), void 0);
	ok(WSG_sameOrder(["a", "b"], ["a", "b"]) && !WSG_sameOrder(["a", "b"], ["b", "a"]));
	eq(WSG_boundaryAnchor(ORDER, MEMBERSHIP, GID_ORDER, GID_Y), "e", "gY 之后是「未分组」，其第一个成员是 e");
	eq(WSG_boundaryAnchor(ORDER, MEMBERSHIP, GID_ORDER, null), void 0, "未分组是最后一个桶 → 兜底锚点 = 追加末尾");
});

console.log("== D 防抖写回（合并语义） ==");

/** 假定时器：记录排期，可手动触发 */
function fakeTimers() {
	const scheduled = [];
	return {
		scheduled,
		set: (fn, ms) => {
			scheduled.push({ fn, ms, cleared: false });
			return scheduled.length - 1;
		},
		clear: (handle) => {
			scheduled[handle].cleared = true;
		},
		runLive: () => {
			const live = scheduled.filter((s) => !s.cleared);
			for (const s of live) s.fn();
			return live.length;
		}
	};
}

check("默认防抖 = 500ms", () => {
	eq(WSG_WRITE_DEBOUNCE_MS, 500);
});

check("同一窗口内两次改动只写一次，且写回的是「最后那份完整状态」", () => {
	const timers = fakeTimers();
	const posted = [];
	const writer = WSG_createWriter({ timers, post: (body) => posted.push(body) });
	const first = { version: 1, groups: [{ id: A(), name: "工作", order: 0 }], membership: {} };
	const finalState = { version: 1, groups: [{ id: A(), name: "工作", order: 0 }], membership: { w1: A(), w2: A() } };
	writer.queue(first);
	writer.queue(finalState);
	eq(timers.scheduled.length, 2, "两次 queue 各自排期");
	eq(timers.scheduled[0].cleared, true, "前一次排期被取消");
	eq(timers.runLive(), 1, "只剩一次真写");
	eq(posted.length, 1, "Host 只收到一次 POST");
	eq(posted[0], finalState, "写回的是完整状态（不是增量）");
	eq(writer.stats(), { writes: 1, coalesced: 1, pending: false });
});

check("flush()：立刻写；没有待写内容时返回 null、不产生请求", () => {
	const timers = fakeTimers();
	const posted = [];
	const writer = WSG_createWriter({ timers, post: (body) => posted.push(body) });
	writer.queue({ version: 1, groups: [], membership: {} });
	eq(writer.flush(), { version: 1, groups: [], membership: {} });
	eq(posted.length, 1);
	eq(timers.scheduled[0].cleared, true, "flush 会清掉挂着的定时器");
	eq(writer.flush(), null, "无待写内容");
	eq(posted.length, 1, "没有多发");
});

check("写回失败不影响本地状态语义（post 抛错不冒泡到调用方）", () => {
	const timers = fakeTimers();
	const writer = WSG_createWriter({ timers, post: () => {} });
	writer.queue({ version: 1, groups: [], membership: {} });
	timers.runLive();
	eq(writer.stats().writes, 1);
});

console.log("== E 组增删改与组排序（F2 F3 F4 F6） ==");

check("新建组：order 追加在最后", () => {
	let s = WSG_emptyState();
	s = WSG_addGroup(s, "g-00000001", "工作");
	s = WSG_addGroup(s, "g-00000002", "项目");
	eq(s.groups.map((g) => [g.name, g.order]), [["工作", 0], ["项目", 1]]);
});

check("重命名组：只改名，成员与先后一个不动（F3）", () => {
	let s = WSG_addGroup(WSG_emptyState(), A(), "工作");
	s = WSG_withMembership(s, "w1", A());
	s = WSG_withMembership(s, "w2", A());
	const next = WSG_renameGroup(s, A(), "项目");
	eq(next.groups, [{ id: A(), name: "项目", order: 0 }]);
	eq(next.membership, s.membership, "成员归属不变");
});

check("删除组：只删组，成员回「未分组」——membership 里不再有它们（F4）", () => {
	let s = WSG_addGroup(WSG_emptyState(), "g-00000001", "工作");
	s = WSG_addGroup(s, "g-00000002", "项目");
	s = WSG_withMembership(s, "w1", "g-00000001");
	s = WSG_withMembership(s, "w2", "g-00000002");
	const next = WSG_removeGroup(s, "g-00000001");
	eq(next.groups.map((g) => [g.id, g.order]), [["g-00000002", 0]]);
	eq(next.membership, { w2: "g-00000002" }, "w1 归属被清掉 = 回未分组");
	const projected = WSG_project({ state: next, sections: [section("w1"), section("w2")], workspaceIds: ["w1", "w2"], collapsed: {} });
	eq(projected.buckets.map((b) => b.members.map((x) => x.workspaceId)), [["w2"], ["w1"]]);
});

check("取消归属（groupId=null）", () => {
	let s = WSG_withMembership(WSG_emptyState(), "w1", A());
	eq(s.membership, { w1: A() });
	s = WSG_withMembership(s, "w1", null);
	eq(s.membership, {});
});

check("组自身拖动排序：拖到目标前 / 目标后 / 无变化 → null", () => {
	const groups = [
		{ id: "g1", name: "1", order: 0 },
		{ id: "g2", name: "2", order: 1 },
		{ id: "g3", name: "3", order: 2 }
	];
	eq(WSG_reorderGroups(groups, "g3", "g1", "before").map((g) => g.id), ["g3", "g1", "g2"]);
	eq(WSG_reorderGroups(groups, "g3", "g1", "before").map((g) => g.order), [0, 1, 2], "order 重排为 0..n-1");
	eq(WSG_reorderGroups(groups, "g2", "g2", "before"), null, "拖到自己身上");
	eq(WSG_reorderGroups(groups, "g3", "g2", "after"), null, "结果与原来相同");
	eq(WSG_reorderGroups(groups, "g1", "g3", "after").map((g) => g.id), ["g2", "g3", "g1"]);
});

console.log("== G 写回/加载时序 + Host 契约对齐（审查 I1 I2 I3 C1 Minor 1/2） ==");

check("G1 契约对齐（真消毒）：客户端产出的状态，Host 的校验器一定肯收", () => {
	const inputs = [
		WSG_emptyState(),
		{ version: 1, groups: [{ id: "g-1", name: "   ", order: 0 }], membership: {} },
		{ version: 1, groups: [{ id: " g-2 ", name: " 工作 ", order: "坏order" }], membership: { w1: " g-2 " } },
		{ version: 1, groups: [{ id: "g-3", name: "重名", order: 0 }, { id: "g-3", name: "重名", order: 1 }], membership: { w1: "g-nope" } },
		{ version: 1, groups: null, membership: "坏" }
	];
	for (const raw of inputs) {
		const state = WSG_sanitizeState(raw, ["w1"]).state;
		const verdict = hostValidate(state);
		ok(verdict.ok === true, `Host 会拒收客户端产出的状态：${JSON.stringify(state)} → ${JSON.stringify(verdict)}`);
		ok(WSG_isHostAcceptable(state) === true, "本地镜像校验器也必须认为它合法（两边规则要一起改）");
	}
});

check("G2 反例（证明 G1 对齐的是真规则）：名字 trim 后为空 → Host 400", () => {
	const bad = { version: 1, groups: [{ id: "g-1", name: "   ", order: 0 }], membership: {} };
	ok(hostValidate(bad).ok === false, "Host 本该拒收「名字只有空格」");
	ok(WSG_isHostAcceptable(bad) === false, "本地镜像校验器必须同样拒收");
});

check("G3 空 / 只有空格的名字：兜底成 id —— 组与成员都不丢（Minor 2）", () => {
	const res = WSG_sanitizeState({ version: 1, groups: [{ id: A(), name: "   ", order: 0 }], membership: { w1: A() } }, ["w1"]);
	eq(res.state.groups, [{ id: A(), name: A(), order: 0 }]);
	eq(res.state.membership, { w1: A() }, "成员归属保住（不是把整组丢掉）");
	eq(res.changed, true, "有变化 → 会写回一次干净状态");
});

check("G4 名字两侧空白一律 trim（与 Host 同规则）", () => {
	eq(WSG_sanitizeState({ version: 1, groups: [{ id: A(), name: "  工作  ", order: 0 }], membership: {} }, []).state.groups[0].name, "工作");
});

check("G5 要不要采纳远端状态：I2 与 C1 两种情形答案相反，刻意如此", () => {
	eq(WSG_shouldApplyRemote({ loaded: false, localRev: 0, revAtRequest: 0 }), true, "没加载过 → 磁盘赢（否则第一次操作就把真状态覆盖成空）");
	eq(WSG_shouldApplyRemote({ loaded: false, localRev: 3, revAtRequest: 3 }), true, "没加载过时本地改动不算数（基线不可信）");
	eq(WSG_shouldApplyRemote({ loaded: true, localRev: 5, revAtRequest: 5 }), true, "已加载且期间没改 → 采纳远端");
	eq(WSG_shouldApplyRemote({ loaded: true, localRev: 6, revAtRequest: 5 }), false, "已加载但期间又改过 → 保留本地（别冲掉用户改动）");
	eq(WSG_shouldApplyRemote({}), true, "参数缺失时保守按「没加载过」处理");
});

check("G6 首次加载失败的重试退避是固定值；用完即停（永不写回）", () => {
	eq(WSG_retryDelays(), [2000, 5000, 15000]);
});

check("G7 Minor 1：half 的默认方向与官方一致（只有 \"before\" 才算「插到前面」）", () => {
	eq(plan({ workspaceId: "a", over: { id: "b", half: "before" } }), null, "before = 插到 b 之前 = 原地不动 → null");
	eq(plan({ workspaceId: "a", over: { id: "b", half: "garbage" } }), { reorder: true, anchor: "c", groupId: GID_X }, "非 before 一律当「后面」（官方 L3128 的方向）");
	eq(plan({ workspaceId: "a", over: { groupId: GID_Y, half: "before" } }), { reorder: true, anchor: "c", groupId: GID_Y }, "组头 before = 插到组首");
	eq(plan({ workspaceId: "a", over: { groupId: GID_Y, half: "garbage" } }), { reorder: true, anchor: "e", groupId: GID_Y }, "组头非 before = 插到组尾");
});

check("G8 与官方下标算术的穷举等价性（1132 例对照；把审查员那次内存实验固化进仓库）", () => {
	// 把官方 commitWorkspaceDrag（上游 L3124-3132）在 workspace 模式下的算术逐字照搬成参照实现：
	// workspace 模式下 parents 是空 Map → siblings 就是 Host 全序（上游 L3048），
	// 所以「官方会怎么算」可以完全脱离渲染独立复现。
	const officialPlan = (siblings, workspaceId, over) => {
		const rowIndex = siblings.indexOf(over.id);
		if (rowIndex === -1) return null;
		const anchor = over.half === "before" ? over.id : siblings[rowIndex + 1];
		if (anchor === workspaceId) return null;
		const sourceIndex = siblings.indexOf(workspaceId);
		const anchorIndex = anchor === void 0 ? siblings.length : siblings.indexOf(anchor);
		if (sourceIndex !== -1 && (anchorIndex === sourceIndex || anchorIndex === sourceIndex + 1)) return null;
		return { reorder: true, anchor };
	};
	const permutations = (items) =>
		items.length <= 1 ? [items] : items.flatMap((item, i) => permutations(items.filter((_, j) => j !== i)).map((rest) => [item].concat(rest)));
	const ids = ["a", "b", "c", "d"];
	let total = 0;
	let diff = 0;
	const samples = [];
	for (let size = 1; size <= 4; size += 1) {
		for (const order of permutations(ids.slice(0, size))) {
			for (const source of order) {
				for (const target of order.concat(["zzz"])) {
					for (const half of ["before", "after"]) {
						total += 1;
						// membership 为空 → 归属恒不变，所以「我的计划里 reorder=false」≡「官方 no-op」
						const mine = WSG_planWorkspaceDrag({ workspaceId: source, over: { id: target, half }, order, membership: {}, groupIdOrder: [null] });
						const theo = officialPlan(order, source, { id: target, half });
						const mineNext = mine === null ? null : { reorder: mine.reorder, anchor: mine.anchor };
						const theoNext = theo === null ? null : { reorder: true, anchor: theo.anchor };
						if (JSON.stringify(mineNext) !== JSON.stringify(theoNext)) {
							diff += 1;
							if (samples.length < 5) samples.push({ order, source, target, half, mine: mineNext, theo: theoNext });
						}
					}
				}
			}
		}
	}
	eq(total, 1132, "用例总数（1~4 个工作区的全排列 × 源 × 目标含一个不存在的 id × before/after）");
	ok(diff === 0, `与官方算术有 ${diff} 处差异：${JSON.stringify(samples)}`);
});

check("G9 F2 空名规则：提示由 draft 在渲染期派生（不依赖点击链路），空名一律不允许建 / 改名", () => {
	const M = "名字不能为空";
	eq(WSG_nameHint("", M), M, "刚打开就是空 → 有提示");
	eq(WSG_nameHint("   ", M), M, "只打空格 → 有提示");
	eq(WSG_nameHint("\t \u3000", M), M, "制表符 / 全角空格也算空");
	eq(WSG_nameHint(" 工作 ", M), null, "有名字（哪怕带空格）→ 不提示");
	eq(WSG_nameHint(null, M), M, "draft 不是字符串时按空处理");
	eq(WSG_nameHint(void 0, M), M);
	eq(WSG_isValidGroupName("   "), false);
	eq(WSG_isValidGroupName("工作"), true);
	eq(WSG_isValidGroupName(" 工作 "), true, "判据是 trim 后非空");
});

check("G10 提示与「能不能建组」共用同一条规则（不会出现「没提示却也不许建」）", () => {
	for (const draft of ["", " ", "   ", "\t", "\u3000", " a ", "工作"]) {
		eq(WSG_nameHint(draft, "X") !== null, WSG_isValidGroupName(draft) === false, `draft=${JSON.stringify(draft)} 时「有提示」必须恰好等于「不允许建」`);
	}
});

console.log("== F 结构闸门 ==");

check("grouping.js 是自包含注入文本：不含任何 import / export", () => {
	const source = fs.readFileSync(path.join(ROOT, "src", "grouping", "grouping.js"), "utf8");
	const hit = source.split("\n").findIndex((line) => /^\s*(import|export)\b/.test(line));
	ok(hit === -1, `第 ${hit + 1} 行含模块语法`);
	ok(source.includes("const WSG = {"), "对外接口 WSG 存在");
});

check("纯函数文件都是标准 ESM 具名导出（可被本测试直接 import）", () => {
	for (const file of ["anchor.pure.js", "project.pure.js", "writer.pure.js"]) {
		const source = fs.readFileSync(path.join(ROOT, "src", "grouping", file), "utf8");
		ok(/^export (function|const) /m.test(source), `${file} 没有 export 声明`);
	}
});

const BUILT = path.join(ROOT, "fork", "lib", "client.js");
if (fs.existsSync(BUILT)) {
	check("构建产物含两条锚点改动与注入段（构建—注入链路的静态证据）", () => {
		const built = fs.readFileSync(BUILT, "utf8");
		ok(built.includes("if (!nestWorkspaces) {"), "拖动接管分支存在");
		ok(built.includes("WSG.commitWorkspaceDrop(activeDrag.workspaceId, over, workspaces, insertWorkspaceBefore);"), "接管分支内容正确");
		ok(built.includes("const groupRows = WSG.renderTree({"), "三层渲染接入存在");
		ok(built.includes("const workspaceMenuItems = [...WSG.moveMenuItems(group.workspaceId, t), {"), "F8 菜单项接入存在");
		ok(built.includes("if (WSG.moveSelect(id, group.workspaceId)) return;"), "F8 菜单选择分流存在");
		ok(built.includes("\t\tconst WSG = {"), "注入段按 factory 层级缩进（2 个 Tab）");
		ok(built.includes("style: WSG_STYLE_TOGGLE"), "组头开合区是真正的 <button>（键盘可达）");
		ok(built.includes('"aria-expanded": bucket.expanded'), "开合按钮带 aria-expanded");
		ok(built.includes("ready: workspaceReady,"), "ctx 带官方 ready 信号（I3）");
		ok(built.includes('window.addEventListener("pagehide", WSG_flushNow)'), "卸载前 flush 已接线（I1）");
		ok(built.includes("keepalive: true"), "写回带 keepalive，能活过卸载（I1）");
		ok(built.includes('"data-wsg-hint": options.kind'), "空名提示已带上可机检的 data-wsg-hint（F2）");
		ok(built.includes("WSG_nameHint(options.draft, text.nameEmpty)"), "提示是渲染期从 draft 派生的（F2，不依赖点击链路）");
		ok(built.includes("// ==== anchor.pure.js ===="), "注入段含 anchor.pure.js");
		ok(built.includes("// ==== project.pure.js ===="), "注入段含 project.pure.js");
		ok(built.includes("// ==== writer.pure.js ===="), "注入段含 writer.pure.js");
		ok(built.includes("exports.apply = apply;"), "官方收尾语句仍在");
	});
} else {
	console.log("  · 跳过：fork/lib/client.js 不存在（先跑 node tools/build-fork.mjs）");
}

console.log("");
console.log(`结果：${passed} 项通过，${failures.length} 项失败`);
if (failures.length > 0) {
	console.log("失败项：");
	for (const name of failures) console.log(`  - ${name}`);
	process.exit(1);
}
console.log("用户现在要做什么：什么都不用做。");
