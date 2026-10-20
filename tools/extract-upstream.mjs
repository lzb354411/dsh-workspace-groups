#!/usr/bin/env node
/**
 * tools/extract-upstream.mjs —— 从 app.asar 里逐字取出官方 ui-workspace 包的两个文件
 *
 * 为什么需要它：本机原有的解包脚本 %TEMP%\dsh-asar-study\asar-tool.mjs **有偏移 bug**
 * （实测：它算出的数据区起点比真实值小 8 字节，导致每个文件都「开头少 8 字节、结尾多 8 字节」，
 * 例如 package.json 会变成以 `e": "@deepseek-ai/...` 开头）。本脚本按 asar 头部真实布局取字节，
 * 并用 asar 头部里自带的 integrity.hash 逐个校验 SHA256。
 *
 * 用法（在项目根目录执行）：
 *   node tools/extract-upstream.mjs "<app.asar 路径>" [目标目录，默认 src/upstream]
 *
 * 产出：<目标目录>/ui-workspace.client.js、<目标目录>/ui-workspace.index.js
 * 覆盖前会把旧文件另存为 <文件名>.bak-YYYYMMDD-HHmmss（同目录），并在终端打印新旧 SHA256。
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const PKG_PREFIX = "dsh/node_modules/@deepseek-ai/dsh-client-ui-workspace/";
const WANTED = { "lib/client.js": "ui-workspace.client.js", "lib/index.js": "ui-workspace.index.js" };

const asarPath = process.argv[2];
const outDir = path.resolve(process.argv[3] || "src/upstream");
if (!asarPath || !fs.existsSync(asarPath)) {
	console.error(`✗ 用法：node tools/extract-upstream.mjs "<app.asar 路径>" [目标目录]\n  给定的路径不存在：${asarPath}`);
	process.exit(1);
}

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const stamp = () => {
	const d = new Date();
	const p = (n) => String(n).padStart(2, "0");
	return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

const fd = fs.openSync(asarPath, "r");
try {
	// asar 头部真实布局（实测，见本文件说明）：u32@0=4、u32@4=pickle2 长度、JSON 从 16 开始、长度在 u32@12
	const head = Buffer.alloc(16);
	fs.readSync(fd, head, 0, 16, 0);
	const jsonLen = head.readUInt32LE(12);
	const jsonBuf = Buffer.alloc(jsonLen);
	fs.readSync(fd, jsonBuf, 0, jsonLen, 16);
	const dataOffset = 16 + jsonLen;
	if (dataOffset !== 8 + head.readUInt32LE(4)) throw new Error("asar 头部布局与假设不符，拒绝继续（换一版脚本再试）");

	const header = JSON.parse(jsonBuf.toString("utf8"));
	let node = header;
	for (const seg of PKG_PREFIX.split("/").filter(Boolean)) node = node.files[seg];
	if (!node) throw new Error(`asar 里找不到包路径：${PKG_PREFIX}`);

	const pkgMeta = node.files["package.json"];
	if (pkgMeta) {
		const b = Buffer.alloc(pkgMeta.size);
		fs.readSync(fd, b, 0, pkgMeta.size, dataOffset + Number(pkgMeta.offset));
		const pkg = JSON.parse(b.toString("utf8"));
		console.log(`[官方包] ${pkg.name}  version=${pkg.version}  license=${pkg.license}`);
	}

	fs.mkdirSync(outDir, { recursive: true });
	for (const [inner, outName] of Object.entries(WANTED)) {
		let n = node;
		for (const seg of inner.split("/")) n = n.files[seg];
		if (!n) throw new Error(`asar 里找不到 ${inner}`);
		const buf = Buffer.alloc(n.size);
		fs.readSync(fd, buf, 0, n.size, dataOffset + Number(n.offset));
		const sha = sha256(buf);
		const declared = n.integrity?.hash;
		if (declared && declared !== sha) throw new Error(`${inner} 的 SHA256 与 asar 头部声明不符（取字节可能出错），已中止`);
		const dest = path.join(outDir, outName);
		if (fs.existsSync(dest)) {
			const old = fs.readFileSync(dest);
			if (!old.equals(buf)) {
				const bak = `${dest}.bak-${stamp()}`;
				fs.copyFileSync(dest, bak);
				console.log(`[覆盖前备份] ${path.basename(bak)}（旧 SHA256=${sha256(old)}）`);
			}
		}
		fs.writeFileSync(dest, buf);
		console.log(`  ✓ ${outName}  ${buf.length} 字节  SHA256=${sha}  （来源 ${PKG_PREFIX}${inner}，integrity 校验 ${declared ? "通过" : "asar 未声明"}）`);
	}
	console.log("");
	console.log("用户现在要做什么：什么都不用做；升级 DSH 后重新跑本命令，再用 tools/build-fork.mjs 看锚点是否还命中。");
} finally {
	fs.closeSync(fd);
}
