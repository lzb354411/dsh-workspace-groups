# 第三方代码归属（NOTICE）

本项目以 **MIT** 许可发布（见 `LICENSE`）。其中一部分代码**不是原创**，归属如下 —— 这部分上游同为 MIT 许可，可合法复制与修改，本项目按要求保留了其版权与许可声明。

## DeepSeek Harness 官方包：`@deepseek-ai/dsh-client-ui-workspace`

| 项 | 内容 |
|---|---|
| 来源 | DeepSeek Harness 官方安装包内 `dsh/node_modules/@deepseek-ai/dsh-client-ui-workspace/` |
| 版本 | `0.2.1-rc.2` |
| 许可证 | MIT ｜ Copyright (c) 2026 DeepSeek |
| 许可证原文 | 逐字保留在 [`fork/LICENSE`](fork/LICENSE) |
| 取用范围 | `src/upstream/ui-workspace.client.js`（官方客户端半边逐字副本，232747 字节 / SHA256 `4dd7f3c580f2316af8172ee4dc542b10e19b030e81f9242f4696e8139260dc17`）、`src/upstream/ui-workspace.index.js`（官方 Host 半边逐字副本）、`fork/lib/client.js`（在上述副本上做锚点式改动后的构建产物） |
| 来源与复取方式 | 见 [`src/upstream/README.md`](src/upstream/README.md) |
| 我们对它做了什么改动 | 全部以**锚点式补丁**记录在 [`src/patches/patches.mjs`](src/patches/patches.mjs)，每条补丁的锚点、替换内容与命中次数都可逐条复核；不做任何未记录的修改 |

## 其余部分

除上述上游副本外，本项目的代码、工具链与文档均为本项目原创：

- `plugin/`（Cordis 插件包：组合补丁、Host 半边路由与存储、客户端诊断半边）
- `src/grouping/`（自定义分组层：三层渲染、组头交互、拖动接管、状态清洗、写回时序）
- `tools/`（锚点式构建器、同步器、上游取件器）
- `test/`（零依赖单测，含对照组）
- 各 `*.md` 文档

## 关于 DSH 本身

本项目是 **DeepSeek Harness 的第三方插件**，与 DeepSeek 官方无隶属关系。文中出现的 DSH 内部路径、版本号与行为描述，均来自对作者本机安装包（`0.2.1-rc.2`）的只读观察；官方升级后行为可能变化，本项目对此不做保证。
