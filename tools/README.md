# tools —— 构建与同步脚本（Node 原生，无第三方依赖）

> 数据流：`src/upstream/`（官方原文，只读）＋ `src/patches/patches.mjs`（改动清单）＋ `src/grouping/`（分组层）
> → `tools/build-fork.mjs` → `fork/lib/client.js`（构建产物，**不要手改**）→ `tools/sync.mjs` → 已安装副本 → 刷新页面生效。

| 脚本 | 干什么 |
|---|---|
| `build-fork.mjs` | 锚点式合成 `fork/lib/client.js`；锚点或分组层代码不合法 → **立刻失败并打印原文**，绝不静默跳过 |
| `sync.mjs` | 把 `fork/`、`plugin/` 的源文件**复制**进已安装副本（免重装）；`plugin/lib/*.js` 是**遍历目录**得来的，新增模块不用改脚本；只复制，不删除、不跑 pnpm/dsh |
| `extract-upstream.mjs` | 从 `app.asar` 逐字取官方两个文件进 `src/upstream/`，并用 asar 自带的 integrity 校验 SHA256 |

## `src\grouping\` 注入约定（写分组层的人看这一节；文件级细则见 `src\grouping\README.md`）

1. `src\grouping\` 下所有 `*.pure.js` 按**文件名字典序**拼接进产物，每个文件前插一行 `// ==== <文件名> ====`。
2. 拼接前做一次**机械转换**：删掉**行首**的 `export `（`export function` / `export const` / `export let` / `export async function` 都覆盖）
   —— 这样这些纯函数既能被注入工厂，又能被 Node 测试**单独 import**。
3. 转换后若**仍残留** `export ` 或 `import `（正则粗判：行首、或紧跟空白/分号/花括号的），**立刻失败**并打印文件名与该行原文；
   `export default` 也直接拒绝（删掉 export 就成语法错误）。粗判前会**先跳过注释** —— 注释里出现「import 测试」这种词不会误报
   （实测踩过：`anchor.pure.js` 的文档注释中文写着「可在 Node 里直接 import 测试」曾被误拦），真语法错误仍由产物末尾的 `node:vm` 语法闸门兜底。
4. `src\grouping\grouping.js` 若存在，接在纯函数段**之后**、**原样不做转换**；它含 `export `/`import ` 同样失败。
5. 整段注入到 `exports.apply = apply;` 之前（用 patch 表达，不硬编码行号）；一个匹配文件都没有 → 不注入，
   `--selftest` 必须仍报「与官方原文逐字节一致」。
6. 文件开头的 UTF-8 BOM（PowerShell `Set-Content -Encoding utf8` 会写）会被自动剥掉并打日志；
   BOM 出现在中间则直接失败（不可见字符会静默改变产物字节）。

## 验收命令（在项目根目录 <项目目录> 执行）

```powershell
node tools\build-fork.mjs --selftest   # 硬条件：空改动时产物必须与官方原文逐字节一致
node tools\build-fork.mjs              # 正式构建，打印产物 SHA256
node tools\build-fork.mjs --check      # 只校验不写，并比对现有产物是否过期
node tools\build-fork.mjs --allow-upstream-drift          # 放行「上游哈希变了」（主动升级时用，会醒目告警）
node tools\build-fork.mjs --check --upstream=<另一份client.js>   # 换一份上游做实验（不动 src/upstream/）
node tools\sync.mjs --dry-run          # 只看计划，一个字节都不写
node tools\sync.mjs                    # 真正同步（目标不存在则「尚未安装，跳过」）
```

**两道防漂移闸门**（`锚点还在、语义已变`是锚点式改动的头号静默失败）：

- **闸门① 上游哈希 pin**：`UPSTREAM_PIN` 里硬编码官方副本的 SHA256 与字节数（当前官方 v0.2.1-rc.2 / 232747 字节），
  构建时逐个比对；不一致 → **中止且不写产物**，报错里给出期望哈希、实际哈希和「按 `src/patches/patches.mjs`
  锚点清单重新核对（每条锚点必须仍命中且语义未变）」；核对完把 `UPSTREAM_PIN` 更新成新值。
  主动升级/做实验时用 `--allow-upstream-drift` 显式放行，此时日志会打出醒目的方框告警。
- **闸门② 被依赖标识符存在性**：在**产物**里断言 `nestWorkspaces`、`rowKeys`、`setWorkspaceDrag`、`commitWorkspaceDrag`、
  `insertWorkspaceBefore`、`deriveGroups`、`rootGroups`、`renderGroup` 各至少出现 1 次（**只数真代码、先去掉注释**，
  否则我们自己注释里提到某个名字会把官方改名盖住）。缺任何一个 → 中止并打印**缺哪个 + 它的用途一句话**。
  为什么必须有它：`node:vm` 语法闸门只查语法，官方把 `nestWorkspaces` 改名后，`!nestWorkspaces` 恒真
  （连「按工作区树」也被我们接管）或运行期 `ReferenceError` 白屏，而语法闸门**照样绿**。
  清单是**从实际引用推导**的（每条都记了用处），构建时会打一行「清单里的 X 在 patches/grouping 里已无引用」的过时提醒。

**实测基线**（2026-10-20，官方 v0.2.1-rc.2）：`--selftest` 输出 `232747` 字节 /
`4dd7f3c580f2316af8172ee4dc542b10e19b030e81f9242f4696e8139260dc17`，与 `src/upstream/ui-workspace.client.js` 完全相同。
⚠ **产物哈希随 `src/patches/` 与 `src/grouping/` 的改动而变，别把产物哈希写进文档**——以 `--check` 的输出为准；
闸门① pin 的只是**上游**（那份不该变的官方副本）。

## 已知坑（实测）

- ⚠ `%TEMP%\dsh-asar-study\asar-tool.mjs` **有 8 字节偏移 bug**：每个文件都「开头少 8 字节、结尾多 8 字节」
  （例如它取出的 `package.json` 以 `e": "@deepseek-ai/...` 开头）。**不要用它取官方原文**，用 `tools\extract-upstream.mjs`。
- `sync.mjs` 的同步清单**不是写死的文件名**：`plugin/lib/*.js` 由遍历目录得到（字典序），新增一个模块文件
  （如 `state-store.js`）不用改脚本就会跟着同步。存在性判断以**包根目录**为单位：目标包根目录不存在 → 整块「尚未安装，跳过」，
  不创建任何东西；包根目录存在 → 同名文件**覆盖**、包里新增的模块文件**新建**
  （只同步 `index.js` 而不带新模块会让插件报 `ERR_MODULE_NOT_FOUND`）。
- `sync.mjs` 对 fork 目标有安全闸：目标 `package.json` 的版本号没有 `+wsg.` 后缀（说明还是官方原件）时**默认跳过**，加 `--force` 才覆盖。
- `src/patches/patches.mjs` 里的锚点带 **Tab 缩进**、官方文件是 **LF** 换行；升级后锚点漂移会由构建直接报错暴露。
- 分组层文件请存成 **UTF-8 无 BOM**、LF 换行（脚本会剥掉开头 BOM，但中间的不可见字符会直接报错）。
- 两道闸门的**异常路径都实测过**：上游加 1 个字节 → `exit=1` 并打印期望/实际哈希；沙箱里把官方 `deriveGroups`
  改名成别的词 → 6 条锚点**照样全部命中**、语法闸门**照样绿**，只有闸门②报 `✗ deriveGroups ×0` 并打印它的用途。
- 闸门②数的是**子串**：把标识符改名成「仍含原名字」的名字（例如 `deriveGroupsX`）它会放过——
  这种改名由闸门①的上游哈希变化兜底，别指望闸门②单独扛。
