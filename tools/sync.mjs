#!/usr/bin/env node
/**
 * tools/sync.mjs —— 免重装同步：把项目源码复制进「已安装副本」，不必重装/重启（刷新页面即生效）
 *
 * 只做一件事：**复制**。本脚本不会删除任何文件，也不会执行 pnpm / dsh 等命令。
 *
 * 同步清单**不是写死的文件名**：`plugin/lib/*.js` 是**遍历目录**得来的，所以新增一个模块文件
 * （例如后来的 plugin/lib/state-store.js）不用改本脚本，跑一次就会跟着同步过去。
 *
 * 存在性策略（关键，别再改动它的粒度）：
 *   - 以**包根目录**为单位判断：目标包根目录不存在 → 整块「尚未安装，跳过」，一个字节都不写、不创建任何东西。
 *   - 包根目录存在 → 逐文件同步：**同名文件必须覆盖**；包里新增的模块文件会**新建**（打印「新建」），
 *     否则只同步 index.js 会让插件报 ERR_MODULE_NOT_FOUND。
 *
 * 用法（在项目根目录执行）：
 *   node tools/sync.mjs                 按计划同步
 *   node tools/sync.mjs --dry-run       只打印计划，一个字节都不写
 *   node tools/sync.mjs --force         当 fork 目标仍是官方原件（版本号无 +wsg.）时强制覆盖
 *   node tools/sync.mjs --target=<dir>  指定 node_modules 目录（默认 desktop profile）
 *
 * 每次都会打印「源文件 SHA256 → 目标文件 SHA256」，一致才算成功。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const FORCE = args.includes("--force");
const targetArg = args.find((a) => a.startsWith("--target="));
const NODE_MODULES =
	(targetArg && targetArg.slice("--target=".length)) ||
	path.join(os.homedir(), ".dsh", "profiles", "desktop", "node_modules");

const FORK_NAME = "@deepseek-ai/dsh-client-ui-workspace";
const WSG_NAME = "dsh-workspace-groups";
const PLUGIN_LIB_SRC = path.join(ROOT, "plugin", "lib");

const sha256 = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/") || p;

/**
 * 遍历 plugin/lib 下的所有 .js（字典序，输出稳定）→ 同步到已装副本的同名 lib/ 下。
 * 新增模块文件不需要改本脚本。
 */
function pluginLibFiles() {
	if (!fs.existsSync(PLUGIN_LIB_SRC)) return { files: [], subdirs: [] };
	const entries = fs.readdirSync(PLUGIN_LIB_SRC, { withFileTypes: true });
	const files = entries
		.filter((e) => e.isFile() && e.name.endsWith(".js"))
		.map((e) => e.name)
		.sort()
		.map((name) => ({ src: `plugin/lib/${name}`, dest: path.join("lib", name) }));
	const subdirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
	return { files, subdirs };
}

const pluginLib = pluginLibFiles();

const packages = [
	{
		group: "fork 同名副本",
		root: path.join(NODE_MODULES, FORK_NAME),
		guard: "fork",
		files: [
			{ src: "fork/lib/client.js", dest: path.join("lib", "client.js") },
			{ src: "fork/lib/index.js", dest: path.join("lib", "index.js") },
			{ src: "fork/package.json", dest: "package.json" }
		]
	},
	{
		group: "插件包",
		root: path.join(NODE_MODULES, WSG_NAME),
		guard: null,
		files: [
			...pluginLib.files,
			{ src: "plugin/package.json", dest: "package.json" },
			{ src: "plugin/cordis.patch.yml", dest: "cordis.patch.yml" }
		]
	}
];

console.log(`== tools/sync.mjs ${DRY ? "(--dry-run：只打印计划，不写文件)" : ""}${FORCE ? " (--force)" : ""}`);
console.log(`   已安装副本根目录 node_modules = ${NODE_MODULES}`);
console.log(`   存在性：${fs.existsSync(NODE_MODULES) ? "存在" : "不存在"}`);
console.log(`   同步清单来源：plugin/lib 下遍历到 ${pluginLib.files.length} 个 .js —— ${pluginLib.files.map((f) => path.basename(f.src)).join(", ") || "（无）"}`);
if (pluginLib.subdirs.length > 0)
	console.log(`   ⚠ plugin/lib 下还有子目录未纳入同步（本脚本只同步该目录下的 .js 文件）：${pluginLib.subdirs.join(", ")}`);

let errors = 0;
let skipped = 0;
let copied = 0;
let created = 0;
let same = 0;

/** fork 包安全闸：目标包根目录里的 package.json 必须是我们那个同名包；仍是官方原件则默认拒绝覆盖 */
function forkGuard(rootDir) {
	if (FORCE) return null;
	const pkgPath = path.join(rootDir, "package.json");
	if (!fs.existsSync(pkgPath)) return `目标根目录里没有 package.json，无法确认是不是我们的同名副本 → 拒绝写入（${pkgPath}）`;
	try {
		const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
		if (pkg.name !== FORK_NAME) return `目标 package.json 的 name 是「${pkg.name}」，不是「${FORK_NAME}」→ 拒绝写入（目录可能指错了）`;
		if (typeof pkg.version === "string" && !pkg.version.includes("+wsg."))
			return `目标仍是官方原件（version=${pkg.version}，无 +wsg. 后缀）→ 跳过；请先用 install.bat 安装 fork，或加 --force 强制覆盖`;
	} catch (error) {
		return `目标 package.json 读不动（${error.message}）→ 拒绝写入`;
	}
	return null;
}

for (const pkg of packages) {
	console.log("");
	if (!fs.existsSync(pkg.root)) {
		console.log(`⊘ [${pkg.group}] 尚未安装，跳过（目标包根目录不存在：${pkg.root}）—— 本块不写任何文件、不创建任何东西`);
		skipped += pkg.files.length;
		continue;
	}
	console.log(`-- [${pkg.group}] 已安装：${pkg.root}（${pkg.files.length} 个文件）`);
	if (pkg.guard === "fork") {
		const reason = forkGuard(pkg.root);
		if (reason) {
			console.log(`⚠ [${pkg.group}] ${reason}`);
			skipped += pkg.files.length;
			continue;
		}
	}
	for (const item of pkg.files) {
		const src = path.join(ROOT, item.src);
		const dest = path.join(pkg.root, item.dest);
		const line = `[${pkg.group}] ${rel(src)}`;
		if (!fs.existsSync(src)) {
			console.log(`✗ ${line}：源文件不存在 → 无法同步`);
			errors++;
			continue;
		}
		const srcHash = sha256(src);
		if (!fs.existsSync(dest)) {
			// 包根目录已安装、但这是包里新增的模块文件 → 必须新建，否则插件会 ERR_MODULE_NOT_FOUND
			if (DRY) {
				console.log(`▶ [计划] 新建 ${line} → ${dest}（目标文件不存在）\n    源 SHA256 ${srcHash}  → dry-run，未写`);
				continue;
			}
			fs.mkdirSync(path.dirname(dest), { recursive: true });
			fs.copyFileSync(src, dest);
			const after = sha256(dest);
			const ok = after === srcHash;
			console.log(`${ok ? "✓" : "✗"} ${line} → ${dest}\n    目标文件不存在 → 新建；源 SHA256 ${srcHash} → 目标 SHA256 ${after}  → ${ok ? "一致" : "不一致（复制失败）"}`);
			if (ok) created++;
			else errors++;
			continue;
		}
		const destHashBefore = sha256(dest);
		if (srcHash === destHashBefore) {
			console.log(`= ${line}\n    源 SHA256 ${srcHash}\n    目标 SHA256 ${destHashBefore}  → 一致（无需复制）`);
			same++;
			continue;
		}
		if (DRY) {
			console.log(`▶ [计划] 覆盖 ${line} → ${dest}（同名文件必须覆盖）\n    源 SHA256 ${srcHash} → 目标 SHA256 ${destHashBefore}  → 不一致（dry-run，未写）`);
			continue;
		}
		fs.copyFileSync(src, dest);
		const destHashAfter = sha256(dest);
		const ok = destHashAfter === srcHash;
		console.log(`${ok ? "✓" : "✗"} ${line} → ${dest}\n    源 SHA256 ${srcHash} → 目标 SHA256 ${destHashAfter}  → ${ok ? "一致" : "不一致（复制失败）"}`);
		if (ok) copied++;
		else errors++;
	}
}

console.log("");
console.log(`-- 汇总：覆盖复制 ${copied} 个，新建 ${created} 个，无需复制 ${same} 个，跳过 ${skipped} 个，失败 ${errors} 个`);
if (skipped > 0) console.log("-- 说明：「尚未安装，跳过」不代表出错：目标包根目录不存在时本脚本整块跳过，不动任何东西。");
console.log(DRY ? "-- dry-run 结束：没有写入任何文件。" : "-- 结束：一个文件都没被删除（只覆盖同名文件、新建缺失模块）；刷新 DSH 页面即可生效。");
process.exit(errors > 0 ? 1 : 0);
