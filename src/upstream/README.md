# src/upstream —— 官方客户端半边的逐字副本（只读素材，不要手改）

| 项 | 值 |
|---|---|
| 包名 | `@deepseek-ai/dsh-client-ui-workspace` |
| 版本 | `0.2.1-rc.2` |
| 许可证 | MIT（版权归 DeepSeek Harness 官方；`fork/LICENSE` 保留原文） |
| 取自 | `C:\Users\<用户>\AppData\Local\Programs\DeepSeek Harness\resources\app.asar` → 包路径 `dsh/node_modules/@deepseek-ai/dsh-client-ui-workspace/` |
| 取用日期 | 2026-10-20 |

| 本目录文件 | 来源（asar 内路径） | 字节数 | SHA256 |
|---|---|---|---|
| `ui-workspace.client.js` | `lib/client.js` | 232747 | `4dd7f3c580f2316af8172ee4dc542b10e19b030e81f9242f4696e8139260dc17` |
| `ui-workspace.index.js` | `lib/index.js` | 453 | `e6cdc4b725585354102a5c4598c9d8c79d6abac62d7979c09919821716370438` |

两个文件都是**逐字副本（一个字节都没改）**：实测 SHA256 与 asar 头部自带的 `integrity.hash` 完全一致
（`fork/LICENSE` = 官方 `LICENSE`，1065 字节，SHA256 `ebb4f09972aee8608be255debaf78451a68e95c290f55c240dec2ecfa16ea6be`）。

## 升级 DSH 后怎么重新取（原文命令）

```powershell
cd E:\DSH\03-DSH-plugins\dsh-workspace-groups
node tools\extract-upstream.mjs "C:\Users\<用户>\AppData\Local\Programs\DeepSeek Harness\resources\app.asar" src\upstream
node tools\build-fork.mjs --check
```

- 第 1 条会把新版 `lib/client.js` / `lib/index.js` 覆盖进本目录（内容变了会先在同目录留 `.bak-时间戳`），
  并打印官方 `version` 与各文件 SHA256 + integrity 校验结果 → **把新版本号与哈希回填到上表**。
- 第 2 条会告诉你 `src/patches/patches.mjs` 里的锚点在新版里还命中不命中；锚点漂移会**直接失败并打印原文**。
- ⚠ 不要用 `%TEMP%\dsh-asar-study\asar-tool.mjs` 重取：它有 8 字节偏移 bug（实测，详见 `tools/README.md`）。
