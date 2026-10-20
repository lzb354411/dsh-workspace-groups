# src/grouping —— 分组层源码（本目录的内容由 `tools/build-fork.mjs` 注入 `fork/lib/client.js`）

本目录**只放**两类文件，其它名字一律不参与构建：

| 文件名 | 怎么写 | 会被构造成什么 |
|---|---|---|
| `*.pure.js` | 标准 ESM：写 `export function` / `export const` 等 | 构建时**删掉行首 `export `**，再拼进工厂（所以同一份文件既能被注入，又能被 Node 测试 `import`） |
| `grouping.js` | **工厂内代码**：不要写 `import`/`export`，直接用上层作用域里的变量 | 原样拼进工厂（不做任何转换） |

## 硬规则（违反 → 构建立刻失败并打印文件名与该行原文）

1. `*.pure.js` 按**文件名字典序**拼接，每个文件前自动插一行 `// ==== <文件名> ====`。
2. `*.pure.js` 里**只有行首的 `export ` 会被删**；任何地方还残留 `import ` 或 `export `（例如 `import x from "y"`、
   `const a = 1; export { a }`、`export default`）→ 构建失败。要导出的东西一律写成行首 `export function` / `export const`。
3. `grouping.js` 不做转换：里面出现 `import `/`export ` 直接失败。
4. 文件编码 **UTF-8 无 BOM**、换行 **LF**。开头带 BOM 会被自动剥掉（PowerShell `Set-Content -Encoding utf8` 会写 BOM，注意）；
   BOM 出现在文件中间会直接报错（不可见字符会静默改变产物字节，宁可不放过）。
5. `grouping.js` 与 `*.pure.js` 里的代码会在**同一个工厂作用域**里执行，注意别重名。

## 例子

```js
// src/grouping/order.pure.js —— 纯函数，Node 测试可以直接 import
export function migrateGroupData(raw) {
	return raw && raw.version === 1 ? raw : { version: 1, groups: [], membership: {} };
}
```

```js
// 测试里（Node 直接 import 同一份文件，不需要任何转换）
import { migrateGroupData } from "./src/grouping/order.pure.js";
```

## 自检

```powershell
node tools\build-fork.mjs --check      # 锚点 + 分组层代码检查 + 产物是否最新
node tools\build-fork.mjs              # 正式构建（打印产物 SHA256）
Select-String -Path fork\lib\client.js -Pattern '==== .*\.pure\.js ===='   # 看注入段是否真进去了
```

> 建模约定（PLAN 第五节）：`{ version: 1, groups: [{ id, name, order }], membership: { [workspaceId]: groupId } }`；
> 视图状态里的分组键要加前缀 `g:`，别跟工作区键撞。
