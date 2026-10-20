#!/usr/bin/env node
/**
 * tools/build-fork.mjs —— 锚点式合成器（核心交付物）
 *
 *   官方原文 src/upstream/ui-workspace.client.js
 *   + src/patches/patches.mjs 里的每条 {name, find, replace, count}
 *   + （可选）src/grouping/ 下的分组层代码作为「注入段」插到 exports.apply = apply; 之前：
 *       · src/grouping/*.pure.js → 按文件名字典序拼接（每个文件前插一行 `// ==== <文件名> ====`），
 *         拼接前删掉行首的 `export `（纯函数写在这里，既能被注入工厂，又能被 Node 测试单独 import）；
 *       · src/grouping/grouping.js → 接在纯函数段之后（原样、不做转换）；
 *       · 任一文件里残留 `export ` / `import ` → 立刻失败并打印文件名与该行原文，
 *         绝不把语法错误静默写进产物。
 *   = 产物 fork/lib/client.js（构建产物，禁止手改）
 *
 * 设计要点：
 *   - 绝不允许静默跳过：find 命中次数 != count → 立即失败，打印 patch 名 / 期望次数 /
 *     实际次数 / find 前 120 字符原文。
 *   - 不硬编码行号：分组层的插点也用一条 patch 表达。
 *   - 语法闸门：产物用 node:vm 解析一次，解析不过就失败（防止 patch 写出语法错误的代码）。
 *   - 闸门①上游 pin：官方副本的 SHA256/字节数硬编码在 UPSTREAM_PIN 里比对，不一致即中止
 *     （锚点「还在但语义已变」是最危险的静默失败；--allow-upstream-drift 可放行但会醒目告警）。
 *   - 闸门②标识符存在性：产物里必须仍存在被我们依赖的标识符（nestWorkspaces / rowKeys / …），
 *     因为 node:vm 只查语法、查不出「官方把它改名了」→ 运行期 ReferenceError 白屏。
 *   - 任何断言失败都**不写产物**。
 *   - 验收硬条件：patches 为空且无 grouping.js 时，产物必须与官方原文**逐字节一致**。
 *     用 `--selftest` 可在不看当前 patches 内容的情况下亲自验证这一条。
 *
 * 用法（在项目根目录执行）：
 *   node tools/build-fork.mjs                            构建并写入 fork/lib/client.js
 *   node tools/build-fork.mjs --check                    只校验不写文件，并与现有产物比对是否过期
 *   node tools/build-fork.mjs --selftest                 空改动自检：证明「不改东西时逐字节等于官方原文」
 *   node tools/build-fork.mjs --allow-upstream-drift     放行上游哈希漂移（我们主动升级时用，会醒目告警）
 *   node tools/build-fork.mjs --upstream=<路径>          临时换一份上游做实验（不动 src/upstream/）
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PATCH_MODULE = path.join(ROOT, "src", "patches", "patches.mjs");
const GROUPING_DIR = path.join(ROOT, "src", "grouping");
const GROUPING_ENTRY = path.join(GROUPING_DIR, "grouping.js");
const PURE_SUFFIX = ".pure.js";
const OUT = path.join(ROOT, "fork", "lib", "client.js");
// 分组层插点（官方 v0.2.1-rc.2 L5349，实测全文唯一）——用 patch 表达，不硬编码行号
const GROUPING_ANCHOR = "\t\texports.apply = apply;";

const args = process.argv.slice(2);
const CHECK = args.includes("--check");
const SELFTEST = args.includes("--selftest");
// --allow-upstream-drift：显式放行「上游副本哈希变了」（我们主动升级时才用），放行时会醒目告警
const ALLOW_DRIFT = args.includes("--allow-upstream-drift");
// --upstream=<路径>：临时换一份上游做实验（例如验证漂移断言），不动 src/upstream/
const upstreamArg = args.find((a) => a.startsWith("--upstream="));
const UPSTREAM = upstreamArg
	? path.resolve(upstreamArg.slice("--upstream=".length))
	: path.join(ROOT, "src", "upstream", "ui-workspace.client.js");

/**
 * 上游哈希 pin（闸门一）：官方升级后，锚点可能「还在但语义已变」，这是最危险的静默失败。
 * 官方 v0.2.1-rc.2 = 232747 字节；升级时按 src/patches/patches.mjs 的锚点清单重核后更新这里。
 */
const UPSTREAM_PIN = {
	version: "0.2.1-rc.2",
	bytes: 232747,
	sha256: "4dd7f3c580f2316af8172ee4dc542b10e19b030e81f9242f4696e8139260dc17"
};

/**
 * 被依赖标识符清单（闸门二）：node:vm 语法闸门只查语法、不查标识符存不存在，
 * 官方一旦把某个名字改掉，产物照样「语法正确」，跑到那行就是 ReferenceError 白屏。
 * 本清单**从实际引用推导**：usedBy 记的是真正用到它的文件（不是凭印象列的）。
 */
const REQUIRED_IDENTIFIERS = [
	{
		name: "nestWorkspaces",
		why: '区分「按工作区」与「按工作区树」两种模式；改名/丢失会让 `!nestWorkspaces` 恒真 → 连树模式也被我们接管，静默改变官方行为',
		usedBy: "patches.mjs 锚点 A/B + grouping.js"
	},
	{
		name: "rowKeys",
		why: "行动画容器的行键数组；我们新增的组头/重命名/确认行必须 push 进去，丢了这些行不参与动画并可能错位",
		usedBy: "patches.mjs 锚点 B + grouping.js"
	},
	{
		name: "setWorkspaceDrag",
		why: "工作区拖动状态 setter；跨组拖动时靠它更新投放目标，丢了拖动直接失效",
		usedBy: "patches.mjs 锚点 B + grouping.js"
	},
	{
		name: "commitWorkspaceDrag",
		why: "工作区拖动提交函数；跨组投放的提交入口，丢了松手不生效",
		usedBy: "patches.mjs 锚点 B + grouping.js"
	},
	{
		name: "insertWorkspaceBefore",
		why: "官方 Host 写操作（唯一能写回工作区顺序的通道）；丢了跨组排序写不回 Host，界面顺序与 Host 不一致",
		usedBy: "patches.mjs 锚点 A + grouping.js + anchor.pure.js"
	},
	{
		name: "deriveGroups",
		why: "官方分区派生函数（section 九字段形状的来源）；名字/语义变了，我们的三层投影就对不上官方渲染层",
		usedBy: "project.pure.js（目前只在注释里引用：我们依赖的是它产出的 section 形状）"
	},
	{
		name: "rootGroups",
		why: "顶层 section 列表；我们把它整段交给 WSG.renderTree 重排，丢了组头无处可插",
		usedBy: "patches.mjs 锚点 B + grouping.js"
	},
	{
		name: "renderGroup",
		why: "单个 section 的渲染函数；组内 section 靠它按 depth 缩进渲染，丢了组内工作区不显示",
		usedBy: "patches.mjs 锚点 B + grouping.js"
	}
];

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const log = (msg) => console.log(msg);
const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");

class AnchorError extends Error {
	constructor(patch, expected, actual) {
		const head = patch.find.length > 120 ? patch.find.slice(0, 120) + "…" : patch.find;
		super(
			[
				"✗ 锚点校验失败，构建中止（绝不静默跳过）",
				`  patch 名    ：${patch.name}`,
				`  期望命中次数：${expected}`,
				`  实际命中次数：${actual}`,
				`  find 前 120 字符原文：${JSON.stringify(head)}`
			].join("\n")
		);
		this.name = "AnchorError";
	}
}

function assertPatchShape(patch, i) {
	const at = `patches[${i}]`;
	if (!patch || typeof patch !== "object") throw new Error(`${at} 不是对象`);
	if (typeof patch.name !== "string" || patch.name === "") throw new Error(`${at}.name 必须是非空字符串`);
	if (typeof patch.find !== "string" || patch.find === "") throw new Error(`${at}.find 必须是非空字符串`);
	if (typeof patch.replace !== "string") throw new Error(`${at}.replace 必须是字符串`);
	if (patch.count !== undefined && (!Number.isInteger(patch.count) || patch.count < 1))
		throw new Error(`${at}.count 必须是 >=1 的整数`);
}

class GroupingError extends Error {
	constructor(fileName, lineText, reason) {
		super(
			[
				"✗ 分组层代码检查失败，构建中止（绝不把语法错误静默写进产物）",
				`  文件    ：src/grouping/${fileName}`,
				`  原因    ：${reason}`,
				`  残留那行：${JSON.stringify(lineText)}`
			].join("\n")
		);
		this.name = "GroupingError";
	}
}

/**
 * 去掉注释（保留换行，行号不漂移）再粗判。
 * 为什么必须先去注释：实测 grouping-impl 的 anchor.pure.js 第 8 行是文档注释，中文写着
 * 「可在 Node 里直接 import 测试」，粗判若不跳注释就会误报构建失败 —— 注释里的词不该让构建失败；
 * 真正的语法错误由最后的 node:vm 语法闸门兜底。
 */
function stripComments(text) {
	const noBlock = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
	return noBlock
		.split("\n")
		.map((line) => {
			const i = line.indexOf("//");
			return i === -1 ? line : line.slice(0, i);
		})
		.join("\n");
}

/** 粗判残留的 export / import（行首或紧跟空白/分号/花括号的都算）；报错时回原文取那一行 */
function findModuleSyntax(originalText, codeText) {
	const codeLines = codeText.split("\n");
	const originalLines = originalText.split("\n");
	for (let i = 0; i < codeLines.length; i++) {
		if (/(^|[\s;{}])export\s/.test(codeLines[i]) || /(^|[\s;{}])import\s/.test(codeLines[i])) {
			return { line: originalLines[i], no: i + 1 };
		}
	}
	return null;
}

/**
 * 把一份分组层源码变成「工厂内代码」：
 *   stripExport = true  → 先删掉行首的 `export `（纯函数文件用，供 Node 单独 import）
 *   stripExport = false → 原样保留（grouping.js 用）
 * 之后无论哪种，都检查是否残留 export/import，残留即抛错。
 */
function toFactoryCode(fileName, text, { stripExport }) {
	let out = text.replace(/\r\n/g, "\n");
	// 开头的 UTF-8 BOM：不能不处理（Windows PowerShell 的 `Set-Content -Encoding utf8` 会写 BOM），
	// 否则它会被当成不可见字符混进产物中间。
	if (out.charCodeAt(0) === 0xfeff) {
		out = out.slice(1);
		log(`[分组层] ${fileName} 开头的 UTF-8 BOM 已剥掉（否则会变成产物里的不可见字符）`);
	}
	const bomLines = out.split("\n");
	const strayBom = bomLines.findIndex((l) => l.includes("\uFEFF"));
	if (strayBom >= 0) throw new GroupingError(fileName, bomLines[strayBom], `第 ${strayBom + 1} 行含不可见的 U+FEFF（BOM），会静默改变产物字节`);
	if (stripExport) {
		const defaultIdx = stripComments(out)
			.split("\n")
			.findIndex((l) => /^\s*export\s+default\b/.test(l));
		if (defaultIdx >= 0)
			throw new GroupingError(fileName, out.split("\n")[defaultIdx], "含 `export default`，机械删除 export 后会变成语法错误；请改成具名导出");
		out = out.replace(/^(\s*)export\s+/gm, "$1");
	}
	const residual = findModuleSyntax(out, stripComments(out));
	if (residual !== null)
		throw new GroupingError(
			fileName,
			residual.line,
			stripExport
				? `删掉行首 export 后，第 ${residual.no} 行仍残留 export/import`
				: `第 ${residual.no} 行含 export/import（grouping.js 必须原样注入、不得带模块语法）`
		);
	return out;
}

/** 组装分组层注入段：*.pure.js（字典序，带分隔注释）在前，grouping.js 在后 */
function buildGroupingSegment() {
	const pureFiles = fs.existsSync(GROUPING_DIR)
		? fs.readdirSync(GROUPING_DIR).filter((f) => f.endsWith(PURE_SUFFIX)).sort()
		: [];
	const parts = [];
	for (const file of pureFiles) {
		const raw = fs.readFileSync(path.join(GROUPING_DIR, file), "utf8");
		const converted = toFactoryCode(file, raw, { stripExport: true });
		parts.push(`// ==== ${file} ====\n` + converted.replace(/\n+$/, "\n"));
		log(`[分组层] 纯函数文件 ${file}  ${Buffer.byteLength(raw)} 字节 → 去 export 后 ${Buffer.byteLength(converted)} 字节`);
	}
	if (pureFiles.length > 0) log(`[分组层] 拼接顺序（文件名字典序）：${pureFiles.join("  →  ")}`);

	if (fs.existsSync(GROUPING_ENTRY)) {
		const raw = fs.readFileSync(GROUPING_ENTRY, "utf8");
		const verbatim = toFactoryCode("grouping.js", raw, { stripExport: false });
		parts.push(verbatim.replace(/\n+$/, "\n"));
		log(`[分组层] 入口文件 grouping.js  ${Buffer.byteLength(raw)} 字节（原样、不做转换）`);
	}

	if (parts.length === 0) {
		log(`[跳过] ${rel(GROUPING_DIR)} 下没有 ${PURE_SUFFIX} 文件、也没有 grouping.js → 本轮不注入分组层（按可选处理）`);
		return null;
	}
	const segment = parts.join("\n");
	log(`[分组层] 注入段共 ${parts.length} 段 / ${Buffer.byteLength(segment)} 字节 → 插到 ${GROUPING_ANCHOR.trim()} 之前`);
	return segment;
}

/** 依次应用全部 patch；任一条不命中/次数不符 → 抛 AnchorError */
function compose(sourceText, patchList) {
	let out = sourceText;
	const applied = [];
	patchList.forEach((patch, i) => {
		assertPatchShape(patch, i);
		const expected = patch.count === undefined ? 1 : patch.count;
		const actual = out.split(patch.find).length - 1;
		if (actual !== expected) throw new AnchorError(patch, expected, actual);
		out = out.split(patch.find).join(patch.replace);
		applied.push({ name: patch.name, hits: actual });
	});
	return { text: out, applied };
}

function syntaxGate(text) {
	new vm.Script(text, { filename: "fork/lib/client.js" });
}

/**
 * 闸门一：上游哈希 pin。不一致 → 打印期望哈希 / 实际哈希 / 怎么重核锚点，然后中止（不写产物）。
 * --allow-upstream-drift 可显式放行（我们主动升级时用），但放行时必须醒目告警。
 */
function assertUpstreamPin(buf) {
	const actualSha = sha256(buf);
	if (buf.length === UPSTREAM_PIN.bytes && actualSha === UPSTREAM_PIN.sha256) {
		log(`[闸门①上游pin] ${rel(UPSTREAM)} 与 pin 一致 ✅（官方 ${UPSTREAM_PIN.version}，${UPSTREAM_PIN.bytes} 字节，SHA256=${UPSTREAM_PIN.sha256}）`);
		return;
	}
	const detail = [
		`✗ 上游副本与构建里 pin 的哈希不一致，构建中止（不动产物）`,
		`  文件       ：${rel(UPSTREAM)}`,
		`  期望 SHA256：${UPSTREAM_PIN.sha256}（${UPSTREAM_PIN.bytes} 字节，官方 ${UPSTREAM_PIN.version}）`,
		`  实际 SHA256：${actualSha}（${buf.length} 字节）`,
		`  怎么办     ：官方升级后请按 src/patches/patches.mjs 的锚点清单重新核对`,
		`               （每条锚点必须仍命中、且语义未变）；核对完把 tools/build-fork.mjs 里的`,
		`               UPSTREAM_PIN 更新为新的哈希与字节数。`
	].join("\n");
	if (!ALLOW_DRIFT) throw new Error(detail);
	log("");
	log("================================================================");
	log("⚠⚠ 已用 --allow-upstream-drift 放行上游漂移 —— 这是一次「不被 pin 认可」的构建 ⚠⚠");
	log(`   期望 SHA256 ${UPSTREAM_PIN.sha256}（${UPSTREAM_PIN.bytes} 字节，官方 ${UPSTREAM_PIN.version}）`);
	log(`   实际 SHA256 ${actualSha}（${buf.length} 字节）`);
	log("   锚点可能「还在但语义已变」：产物仅供实验/主动升级核对用，务必人工复核 patches.mjs 全部锚点。");
	log("================================================================");
	log("");
}

/**
 * 闸门二：产物里必须存在这些被依赖标识符（各至少 1 次）。
 * 缺任何一个 → 打印缺哪个 + 用途一句话，然后中止（不写产物）。
 */
function assertRequiredIdentifiers(productText) {
	// 只在**真代码**里计数（先去注释）：否则我们自己注释里写一句「官方 deriveGroups …」
	// 就会在官方把它改名后仍然数到匹配，把真正的漂移盖住。
	const codeText = stripComments(productText);
	const counts = REQUIRED_IDENTIFIERS.map((item) => ({
		...item,
		hits: codeText.split(item.name).length - 1
	}));
	log("[闸门②标识符] 产物内被依赖标识符存在性（只数真代码，不算注释）：");
	for (const item of counts) log(`  ${item.hits > 0 ? "✓" : "✗"} ${item.name}  ×${item.hits}`);
	const missing = counts.filter((item) => item.hits === 0);
	if (missing.length === 0) return;
	const lines = [
		"✗ 产物里缺少被依赖标识符，构建中止（不动产物）：官方升级后它们可能被改名/删掉了",
		`  缺失清单（${missing.length} 个）：`
	];
	for (const item of missing) lines.push(`    · ${item.name} —— ${item.why}`, `      （我们用它是因为：${item.usedBy}）`);
	lines.push("  为什么语法闸门没拦住：node:vm 只查语法，不查标识符存在与否；这类问题会在运行期变成 ReferenceError/白屏。");
	throw new Error(lines.join("\n"));
}

/** 清单自检：清单里的名字必须在 patches.mjs / src/grouping/*.js 里真被引用（防止凭印象加名字） */
function reportIdentifierSources() {
	const sources = [fs.readFileSync(PATCH_MODULE, "utf8")];
	if (fs.existsSync(GROUPING_DIR))
		for (const f of fs.readdirSync(GROUPING_DIR).filter((n) => n.endsWith(".js")))
			sources.push(fs.readFileSync(path.join(GROUPING_DIR, f), "utf8"));
	const joined = sources.join("\n");
	for (const item of REQUIRED_IDENTIFIERS) {
		const hits = joined.split(item.name).length - 1;
		if (hits === 0)
			log(`  ⚠ 清单里的 ${item.name} 在 src/patches/patches.mjs 与 src/grouping/*.js 里已无任何引用 —— 这条可能已过时，请核对后删掉`);
	}
}

// ---------------------------------------------------------------- 自检模式
if (SELFTEST) {
	const upstreamBuf = fs.readFileSync(UPSTREAM);
	const upstreamText = upstreamBuf.toString("utf8");
	log("== --selftest：空改动自检（patches = [] 且 src/grouping/ 无任何可用文件）==");
	log("  说明：本模式**不读取** src/patches/patches.mjs、也**不读取** src/grouping/，纯粹验证合成器本身零改动。");
	const { text } = compose(upstreamText, []);
	const outBuf = Buffer.from(text, "utf8");
	syntaxGate(text);
	const upstreamSha = sha256(upstreamBuf);
	const outSha = sha256(outBuf);
	log(`  官方原文 ${rel(UPSTREAM)}  ${upstreamBuf.length} 字节  SHA256=${upstreamSha}`);
	log(`  自检产物                   ${outBuf.length} 字节  SHA256=${outSha}`);
	log(`  逐字节一致：${outBuf.equals(upstreamBuf) ? "通过 ✅" : "失败 ❌"}`);
	if (!outBuf.equals(upstreamBuf)) process.exit(1);
	log("");
	log("用户现在要做什么：什么都不用做。");
	process.exit(0);
}

// ---------------------------------------------------------------- 正常构建
let patchList;
try {
	patchList = (await import(pathToFileURL(PATCH_MODULE).href)).patches;
} catch (error) {
	console.error(`✗ 无法加载 ${rel(PATCH_MODULE)}：${error.message}`);
	process.exit(1);
}
if (!Array.isArray(patchList)) {
	console.error(`✗ ${rel(PATCH_MODULE)} 必须导出数组 patches`);
	process.exit(1);
}

// 闸门一：先把上游读进来并核对 pin（漂移就立刻中止，不浪费后面的工作，也不写产物）
const upstreamBuf = fs.readFileSync(UPSTREAM);
const upstreamText = upstreamBuf.toString("utf8");
try {
	assertUpstreamPin(upstreamBuf);
} catch (error) {
	console.error(error.message);
	process.exit(1);
}
log(`[输入] ${rel(PATCH_MODULE)} 共 ${patchList.length} 条 patch`);

// 可选的分组层注入段（src/grouping/ 为空时跳过并说明）
let groupingSegment;
try {
	groupingSegment = buildGroupingSegment();
} catch (error) {
	console.error(error.message);
	process.exit(1);
}
if (groupingSegment !== null) {
	const indented = groupingSegment
		.split("\n")
		.map((line) => (line === "" ? line : "\t\t" + line))
		.join("\n");
	patchList = patchList.concat([
		{
			name: `注入分组层（${rel(GROUPING_DIR)}/*${PURE_SUFFIX} + grouping.js，插到 exports.apply = apply; 之前）`,
			find: GROUPING_ANCHOR,
			replace: indented + GROUPING_ANCHOR,
			count: 1
		}
	]);
}

let composed;
try {
	composed = compose(upstreamText, patchList);
} catch (error) {
	console.error(error.message);
	process.exit(1);
}
for (const a of composed.applied) log(`  ✓ 命中 ${a.hits} 次  ${a.name}`);

const outBuf = Buffer.from(composed.text, "utf8");

// 验收硬条件：无任何改动（patches 为空 + 分组层无可用文件）时必须与官方原文逐字节一致
if (patchList.length === 0) {
	const same = outBuf.equals(upstreamBuf);
	log(`[断言] patches 为空且 src/grouping/ 无可用文件 → 产物必须与官方原文逐字节一致：${same ? "通过 ✅" : "失败 ❌"}`);
	if (!same) process.exit(1);
}

try {
	syntaxGate(composed.text);
	log("[语法] 产物 JS 解析通过 ✅（node:vm）");
} catch (error) {
	console.error(`✗ 产物语法检查失败：${error.message}`);
	process.exit(1);
}

// 闸门二：语法过了不代表标识符还在（官方改名 → 运行期 ReferenceError/白屏）
reportIdentifierSources();
try {
	assertRequiredIdentifiers(composed.text);
} catch (error) {
	console.error(error.message);
	process.exit(1);
}

const outSha = sha256(outBuf);
log(`[输出] ${rel(OUT)}  ${outBuf.length} 字节  SHA256=${outSha}`);

if (CHECK) {
	log("== --check：只校验不写文件 ==");
	if (fs.existsSync(OUT)) {
		const cur = sha256(fs.readFileSync(OUT));
		log(`  现有产物 SHA256=${cur}`);
		log(`  与本次合成结果${cur === outSha ? "一致（产物是最新的）✅" : "不一致（需要重新构建）⚠️"}`);
	} else {
		log(`  现有产物不存在（${rel(OUT)}）——需要执行一次不带 --check 的构建`);
	}
	log("");
	log("用户现在要做什么：什么都不用做。");
	process.exit(0);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, outBuf);
const written = sha256(fs.readFileSync(OUT));
log(`[写入] 已写出；回读校验 SHA256=${written} ${written === outSha ? "一致 ✅" : "不一致 ❌"}`);
if (written !== outSha) process.exit(1);
log("");
log("用户现在要做什么：什么都不用做（想生效就运行 node tools/sync.mjs，再刷新页面）。");
