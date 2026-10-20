# RECON：DSH 客户端插件加载链路（用于「侧栏工作区自定义分组」）

- 调研人：recon-loader（只读调研任务）
- 日期：2026-10-20
- DSH 版本：0.2.1-rc.2（桌面版，`<DSH 安装目录>\resources\app.asar`）
- 证据分层：**实测** = 本机跑出来的行为；**代码事实** = 原文/行号；**推断** = 我的推理，需实测复核
- 解包产物（我的目录，勿与别人混）：`%TEMP%\dsh-asar-recon1\`

---

## 一、结论（逐条回答 6 个问题）

### Q1 第三方 npm 包插件怎么进入运行
**结论**：插件要装进 profile 的 `node_modules`，并被 Cordis 组合「插」一条 entry；包本体必须自带 `dsh.bundle.patch` 指向自己的 `cordis.patch.yml`，安装器才接受。**清单 = 4 条硬要求 + 1 条针对浏览器半边的额外要求。**

1. `package.json` 必须有 `dsh.bundle.patch`（指向包内 `cordis.patch.yml`）——安装器检查阶段会拒绝没有组合包的依赖（代码事实，见 restart-button `cordis.patch.yml` 注释 + 4 个已装插件一致）。
2. 该 `cordis.patch.yml` 用 `- insert:` 形式插入一条 entry，其中 `name` **必须正好等于包名**（否则「client-module 扫描」解析不到包根，浏览器半边永不加载）。
3. 包名要出现在 profile `node_modules` 与 `.modules.yaml` 的记账里（本地 `file:` 依赖或 npm 包都行）。
4. 有浏览器半边时，`package.json` 需要 `dsh.client`（至少 `platform`）**且** `exports["./client"]` 必须存在——否则宿主直接抛错。

### Q2 浏览器半边怎么被送进浏览器
**结论**：入口是 `exports["./client"]`（本机惯例是 `lib/client.js`）。**模块格式既不是 ESM 也不是 CJS**，而是队列式 facade 闭包：`window.__ModuleLoader__.load({ id, factory(require) { ... return {name, inject, apply} } })`。宿主把一段 index 注入行写进页面 `<head>`，浏览器侧再把 bundle 拉进来注册。**实测支撑**：`dsh-desktop-restart-button` 用这个格式，且该插件本机在跑（侧栏按钮可见）。

### Q3 外部位（externals）白名单 —— **决定性问题的明确答案**
**结论**：
- `require` 的解析只有三条腿：**① platform seed words（基线模块表）∪ ② boot graph 里物化出来的模块 ∪ ③ 已注册的包工厂**；三处都没有就抛错。
- 白名单的**字面列表**（`PLATFORM_MODULES`）**在本机 asar 里读不到**（见第四节），只能用「官方包声明什么、本机什么跑通了」来推。
- `react`：**可解析**（实测：restart-button 的 client.js 只 require `react` 且在跑）。
- `@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-primitives`：**不是**独立发布的运行期包——本机 asar 里根本没有这两个目录；它们只以「版本号被依赖」的形式存在（`ui-workspace/package.json:69`）。**推断**：它们被编进了更大的 combo/外壳 bundle，是否以 seed word 形式暴露给第三方，未确认。
- 形如 `@deepseek-ai/dsh-client-xxx` 的**官方客户端包**可以由插件通过 `dsh.client.external` / `dsh.client.inject` **显式申请**后解析——这是唯一被文档承认的「非基线 specifier」通道；且申请到的**永远是那个包的 client 半边**，寻址形式是 `<包名>/client`。
- **能不能 import 官方 `ui-workspace` 包内部的 `WorkspaceBrowser` 组件？——不能。**
  - 理由一：包对模块系统只暴露 `./client` 子路径（`dsh-client-modules/lib/index.js:738` 要求 `exports["./client"]` 存在；`index.js:92` 明确「包名本身就是它的 client 半边，所以 `<id>/client` 是 exports 子路径外部位」）。
  - 理由二：`WorkspaceBrowser` 是 client bundle **内部**的符号，未导出；内部路径请求会命中「missed the module table」错误。
  - 理由三（务实的）：就算能拿到，也拿不到它的 props 契约——它读的是 `ctx.slots.provideRoot` / store / inject 那套（见 Q4 证据），耦合极深。
  - **可替代的做法**：不 import 官方组件，改为**自己声明 props 结构、复用 workspace 服务**（官方半边用的服务名可在 `inject: ["slots","locale","workspaces",...]` 里看到），或直接遮蔽后自己渲染。

### Q4 槽位遮蔽/覆盖语义
**结论（分两半，一半是代码事实、一半未确认）**：
- **代码事实**：`sidebar.workspaces` 在侧栏外壳里声明为 `kind: "single"` → 一次只有一个占用者。
- **代码事实**：官方 `ui-workspace` 注册它时**没有写 `id`**，只写了 `name`。
- **代码事实（官方文档原文）**：同一 `name` 下**复用已发布 id、换一个 `priority`，就会遮蔽（shadow）那条 action**。即取舍键是 **(name, id) + priority**。
- **未确认**：`kind:"single"` 槽位在「两个注册都没写 id」时的具体判定（默认 id 怎么生成、平局按 priority 还是注册顺序、后注册者胜还是先注册者胜）——判定代码所在包 `@deepseek-ai/dsh-client-ui-slots` **本机 asar 内不存在**，读不到。

### Q5 本机现成范例
**结论**：最接近「客户端半边 + 注册进侧栏槽位」的是 **`<插件分类目录>\dsh-desktop-restart-button`**（它注册进 `sidebar.footer.action`）。**但它进的是 `list` 槽位（新增一格），不是 `single` 遮蔽** —— 本机 5 个插件里**没有**做「single 槽位遮蔽」的先例，这条路是第一次走。
最小可复制形状 = 6 个文件：`package.json`（`type:module` + `dsh.bundle.patch` + `dsh.client` + `exports["./client"]`）、`cordis.patch.yml`、`lib/index.js`（宿主半边）、`lib/client.js`（factory 闭包）、`locale/*.json`。

### Q6 风险清单
见第三节。

---

## 二、证据（文件:行号 + 原文片段）

### 2.1 Q1 —— 包形状与装载

已装插件的 patch 与 manifest 完全同构（4 个包都有 `dsh.bundle.patch`）：

`<插件分类目录>\dsh-desktop-restart-button\package.json`
```json
"type": "module",
"exports": { ".": "./lib/index.js", "./client": "./lib/client.js", "./package.json": "./package.json",
             "./locale/*.json": "./locale/*.json", "./icon": "./icon.svg" },
"dsh": { "bundle": { "patch": "./cordis.patch.yml" },
         "client": { "platform": "web", "inject": [] } },
"peerDependencies": { "react": "^18.2.0" }
```

`<插件分类目录>\dsh-desktop-restart-button\cordis.patch.yml`
```yaml
- insert:
    - id: dsh-desktop-restart-button
      name: dsh-desktop-restart-button
```
注释原文：「client-module 扫描会把这一行的 specifier 解析到『包根』再读 package.json 的 dsh.client，所以这里的 name 必须**正好等于包名**，否则页面半边永远不会加载」

profile 记账（`<DSH_HOME>\profiles\desktop\node_modules\.modules.yaml`）——**实测读取**：
```json
"injectedDeps": { "<插件分类目录>/dsh-desktop-restart-button": ["node_modules\\dsh-desktop-restart-button"], ... },
"hoistedLocations": {
  "dsh-desktop-restart-button@file:<插件分类目录>/dsh-desktop-restart-button": [...],
  "@linxin666/dsh-remote-web-ui@0.4.6": [...], "beauticode-dsh@1.0.30": [...],
  "dsh-client-auto-continue@0.14.2(@deepseek-ai/schemastery@3.18.4)": [...], ... }
```

`<DSH_HOME>\cordis.patch.yml` —— **实测读取**，首页级补丁，当前**只有一条 disabled 的 rea-mcp insert**，没有任何第三方 UI 插件 entry。说明第三方插件**不靠这个文件**，而是靠各自的 `dsh.bundle.patch` 被安装器应用。

`dsh-client-modules/lib/index.js:738`（代码事实）：
```js
if (clientRel === void 0) throw new Error(`client-modules: ${packageName} declares dsh.client but exports no "./client" bundle`);
```

### 2.2 Q2 —— 浏览器半边的加载格式与投递

`<插件分类目录>\dsh-desktop-restart-button\lib\client.js:16-18, 225-251`（**实测在跑**）：
```js
window.__ModuleLoader__.load({
  id: "dsh-desktop-restart-button",
  factory(require) {
    const React = require("react");
    ...
    const inject = ["slots", "locale"];
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-desktop-restart-button: dictionaries");
      ctx.slots.inject("sidebar.footer.action", () =>
        ctx.slots.register({ name: "sidebar.footer.action", id: "dsh-desktop-restart", order: 15, locale: NS }, RestartButton));
    }
    return { name: "dsh-desktop-restart-button", inject, apply };
  },
});
```

`app.asar\dsh\node_modules\@deepseek-ai\dsh-client-modules\lib\client.js:758`（代码事实）：
```js
failures.push(`${url}: loaded without registering "${id}" via __ModuleLoader__.load`);
```
同文件 `:874`：`throw new Error(\`client-modules: bundle ${url} loaded without registering "${id}" via __ModuleLoader__.load\`)`

`app.asar\...\dsh-client-modules\lib\index.js:18`（代码事实，注释原文）：
```
* factory (`window.__ModuleLoader__.load({id, factory})`); every module body
```

`app.asar\...\dsh-client-modules\README.zh.md:84`（代码事实，投递机制原文）：
「宿主贡献结构化 index 行，并向 `<head>` 注入：`window.__ModuleLoader__` queue facade、每个 application combo 的提示性 preload、阻塞 parser 的 bootstrap combo 脚本……facade 的 `create()` 物化 modules bundle、把构造委托给其 `createClientModuleSystem` 导出……」

→ 投递靠 **宿主生成的 index 注入行 + combo bundle**；**具体路由字符串未确认**（见第四节）。

### 2.3 Q3 —— 解析规则与白名单来源

`app.asar\...\dsh-client-modules\lib\client.js:835, 840`（代码事实，判定逻辑原文）：
```js
if (this.seed.has(spec)) return this.seed.get(spec);
...
throw new Error(`client-modules: require("${spec}") missed the module table — not a platform seed word, not a materialized module, and no registered package factory (a build-time externals drift, or a dynamic dependency that did not arrive)`);
```
同文件 `:879, 886`（一次性的 `require`/import 路径）：
```js
if (this.seed.has(specifier)) return this.seed.get(specifier);
throw new Error(`client-modules: cannot resolve "${specifier}" — not a seed word, not a materialized module, and not a row in the boot graph (the runtime mirror of the bundle purity gate)`);
```
`this.seed = new Map(Object.entries(options.staticModules))`（`:681`）→ **基线表由宿主传入，不在客户端包里**。

`app.asar\...\dsh-client-modules\README.md:49`（代码事实，白名单来源原文）：
> The shell seeds a frozen module table ([`PLATFORM_MODULES`](../web/README.md#the-shared-module-table)); every dynamic bundle resolves its externals against exactly that baseline. `dsh.client.external` adds only exact non-baseline requests, each answered by the dynamic package row it names or an exact static-table key.

`app.asar\...\dsh-client-modules\lib\index.js:92`（代码事实，决定性）：
```
* IS its package's client half, so `<id>/client` (the exports subpath external
```
`app.asar\...\dsh-client-modules\lib\index.js:435`（代码事实）：
```js
if (dependency === entry) throw new Error(`client-modules: "${entry.id}" requests module "${name}" that it answers itself — a row must not declare its own package in dsh.client.external`);
```

**各 specifier 逐个判定**：

| specifier | 能否解析 | 依据 |
|---|---|---|
| `react` | **能** | 实测：restart-button client.js:19 只 require 它且在跑；也是所有已装插件的 peerDependency |
| `react-dom` | 很可能能（seed word） | **推断**：基线表读不到，未见第三方用例 |
| `@deepseek-ai/cordis` | **未确认** | asar 内 `dsh/node_modules/@deepseek-ai/cordis` **存在**，但它是宿主侧包；作为浏览器 seed word 未证实 |
| `@deepseek-ai/dsh-client-ui-slots` | **未确认（包不存在）** | `ls "dsh-client-ui-slots"` → **0 条**；`ls "slots"` → 仅 `@js-temporal/polyfill/lib/slots.ts` |
| `@deepseek-ai/dsh-client-ui-primitives` | **未确认（包不存在）** | `ls "dsh-client-ui-primitives"` → **0 条**；但 `ui-workspace/lib/client.js:5154` 用到 `writeClipboard`（说明源码层依赖它，只是未单独发布） |
| `@deepseek-ai/dsh-client-ui-workspace` | **仅 `/client` 可申请** | `dsh.client.external`/`inject` 通道；包名即 client 半边 |
| `@deepseek-ai/dsh-client-ui-workspace/client` | **可能可申请** | `index.js:92` 的 `<id>/client` 形式；**未实测** |
| `@deepseek-ai/dsh-client-ui-renderer` | **未确认** | asar 内包**存在**（`lib/client.js` 78 KB），但是否为 seed word 未证实 |
| `@deepseek-ai/dsh-client-locale` | **未确认** | asar 内包**存在**；`dsh-client-auto-continue` 的 `dsh.client.inject` 里**列了它**，说明可被申请 |

`dsh-client-auto-continue/package.json`（代码事实）——**这是「申请官方包」的活范例**：
```json
"dsh": { "bundle": { "patch": "./cordis.patch.yml" },
         "client": { "platform": "web",
                     "inject": [ "@deepseek-ai/dsh-client-connection", "@deepseek-ai/dsh-client-locale",
                                 "@deepseek-ai/dsh-client-ui-settings", "@deepseek-ai/dsh-client-ui-settings-plugins" ] } }
```

**Q3 决定性答案**：**不能** import 官方 `ui-workspace` 内部（非 `/client` 导出）的 `WorkspaceBrowser` 组件。模块表只认 `exports["./client"]` 这一条子路径 + 基线 seed words；内部路径既不是 seed word、也不会被物化，必然抛 `missed the module table`。

### 2.4 Q4 —— 槽位声明与遮蔽

槽位声明（代码事实）`app.asar\...\dsh-client-ui-sidebar\lib\client.js:507-510`：
```js
"sidebar.workspaces": {
  kind: "single",
  scope: "root"
},
```
（同批还有 `sidebar.toggle.badge` / `sidebar.settings` = single；`sidebar.panellist` / `sidebar.footer.action` = list）

官方注册**无 id**（代码事实）`app.asar\...\dsh-client-ui-workspace\lib\client.js:5220-5251`：
```js
ctx.slots.inject("sidebar.workspaces", () => ctx.slots.register({
  name: "sidebar.workspaces",
  children: {
    "sidebar.workspaces.directoryFlow": { kind: "single", scope: "root" },
    "sidebar.workspaces.session.menu.item": { kind: "list", scope: "root", inject: {...} },
    "sidebar.workspaces.session.row.action": { kind: "list", scope: "root" },
    "sidebar.session.row.leading": { kind: "list", scope: "root" },
    "sidebar.session.row.hover": { kind: "list", scope: "root" }
  },
  store: viewStore,
  inject: browserInjected,
  locale: NS
}, WorkspaceBrowser));
```
注意：**没有 `id` 字段**。（对比同一文件 `:5255` 的 `id: "pin"`、`:5261` 的 `id: "rename"` —— 官方给自己的 action 都写了 id，唯独宿主占用者没写。）

遮蔽规则（代码事实，官方文档原文）`app.asar\...\dsh-client-ui-workspace\README.zh.md:103`：
> ……本包自己的 action 也不例外：`apply` 以客户端插件注册自己 action 的同一方式注册 `pin`（菜单 100、按钮 200）、`rename`（200）……**以另一个 `priority` 复用内置 id 则遮蔽该 action**。

同 README `:111` 给出依赖声明规则：「将 `ui-workspace`、`ui-slots`、`ui-renderer`、`client-locale` 与 `ui-primitives` 声明为浏览器／类型开发依赖……纯类型的 `ui-workspace/client` import 会加载本包的 `SlotMap` 声明」。

`slots` 服务由谁提供（代码事实）：`ui-layout/lib/client.js:589` 与 `dsh-client-ui-sidebar/lib/client.js:437` 都是 `inject` 里**消费** `"slots"`；`ui-layout:621`、`ui-renderer:1465`、`ui-workspace:5039` 调用 `provideRoot(`。**提供者（注册表实现）不在 asar 内** → 见第四节。

### 2.5 Q5 —— 本机 5 个范例对比

| 插件 | 有 client 半边 | 槽位 | dsh.client.inject | 备注 |
|---|---|---|---|---|
| `dsh-desktop-restart-button`（`<插件分类目录>\`） | ✅ `lib/client.js`（factory 闭包） | `sidebar.footer.action`（**list**） | `[]` | **最接近**；只 require `react`；自带 locale + icon + 宿主路由 |
| `beauticode-dsh`（npm 1.0.30） | ✅ `client.js` + `browser-injection.mjs` | 自注入（不改槽位） | 未声明 | 走注入式而非槽位注册；`main` 是 `index.mjs` |
| `dsh-client-auto-continue`（0.14.2） | ✅ `lib/client.js` | 设置页/输入框 | **4 个官方包名** | **「申请官方包」的唯一活范例** |
| `@linxin666/dsh-remote-web-ui`（0.4.6） | — | — | — | 本次未展开 |
| `dsh-balance-widget`（0.7.0） | ✅ `lib/client.js` | 浮动卡片 | `[]` | `peerDependencies` 写 `@deepseek-ai/dsh": ">=0.1.2-rc.1 <0.3.0"` |

**最小可复制形状**（以 restart-button 为模板）：
```
<project>/
  package.json        # type:module；dsh.bundle.patch；dsh.client{platform,inject}；exports["./client"]；peerDeps react
  cordis.patch.yml    # - insert: [{ id: <包名>, name: <包名> }]  ← name 必须等于包名
  lib/index.js        # 宿主半边：export const inject = ["webServer"]；export function apply(ctx){}
  lib/client.js       # window.__ModuleLoader__.load({id, factory(require){...}})
  locale/zh.json, en.json
```
安装路径（**需用户确认的系统级操作**）：放进 profile `node_modules` 并在 `.modules.yaml` 记账，或按官方安装器流程走 `dsh` CLI。

---

## 三、风险清单（Q6）

| # | 风险 | 说明与缓解 |
|---|---|---|
| R1 | **遮蔽后官方功能整体消失** | `single` 槽位只有一个占用者，遮蔽即接管。`WorkspaceBrowser` 承担了搜索、拖拽排序、归档筛选、pin/rename/fork/archive 菜单、Toast、快捷键——全部要自己重建，否则功能倒退。**先做「能落哪一格」的分级方案**：优先找 `list`/`keyed` 缝隙（如 `sidebar.workspaces.session.menu.item`、`sidebar.panellist`）而不是硬遮 `single`。 |
| R2 | **默认 id 语义未确认（最大不确定性）** | 官方占用者无 `id`。若注册表要求 `single` 槽位必须写 `id` 才能覆盖，我们的覆盖写法就完全不同。**必须先跑一个最小实测**（一个只打印注册结果的空插件）再定方案。 |
| R3 | **`slot is not declared` 时序** | `ui-workspace` 的 README `:170` 明确：**即使 owner 通常已存在，也必须用 `ctx.slots.inject()`**——它等待声明、声明折叠时移除贡献项、恢复后重新注册。漏了它会在启动竞态下静默不注册。 |
| R4 | **版本升级脆断** | 我们复用/覆盖的是内部实现细节（props 形状、`inject` 服务名、slot 子键）。DSH 升级到 0.2.2 时官方重命名一个内部 slot 键或改 props，我们就静默坏掉。**缓解**：全部依赖都写成 `peerDependencies` 并声明版本区间（照 `dsh-balance-widget` 的 `>=0.1.2-rc.1 <0.3.0`），并在插件里对缺失结构做探测告警。 |
| R5 | **HMR 下重复注册/双份 UI** | `dsh-client-hmr` 存在（asar 内有 `dsh-client-hmr` 包），热更新会重跑 `apply`。`ctx.effect`/`ctx.slots.inject` 的清理必须写对，否则出现两个分组栏。参考 restart-button 用 `ctx.effect(...)` 包住 `locale.register`。 |
| R6 | **i18n 命名空间冲突** | 官方 `ui-workspace` 用 `NS`（其 `locale` 字段）。我们若复用同一个 namespace 会互相覆盖字典。**用我们自己的 namespace**（如 `workspace-groups`），并只做 `ctx.locale.register(NS, ...)` + `locale: NS`。 |
| R7 | **CSS 类名 / 主题令牌冲突** | 官方 client bundle 自带样式。安全做法是**只用 `--dsw-alias-*` 主题令牌 + 内联样式**（restart-button 就是这么做的，`lib/client.js:55-96`），不引入全局类名。 |
| R8 | **模块表解析失败 = 白屏** | 任何未在白名单里的 `require` 会抛 `missed the module table`，可能整页起不来。**只用实测过能解析的 specifier**（当前确定：`react`）；要用其它官方包，必须先在 `dsh.client.inject`/`external` 里声明并实测。 |
| R9 | **`.modules.yaml` / profile 写入属系统级操作** | 装插件会改 `~/.dsh/profiles/**`，影响所有工作区；按分类规则**必须先问用户**。 |
| R10 | **只读前提下无法验证最关键的几点** | 本轮是纯只读调研（不装依赖、不起服务、不重启 DSH），所以 R2 的默认 id 语义、`<id>/client` 能否申请、`PLATFORM_MODULES` 字面表**全部停留在未确认**。**建议下一步只做一个最小实测插件**来回答这三条。 |

---

## 四、未确认 / 推断（明确标注）

**未确认（查过哪些地方、为什么查不到）**

1. **`PLATFORM_MODULES` 基线模块表字面内容** —— 未确认。
   - `dsh-client-modules/lib/client.js:681` 只写 `this.seed = new Map(Object.entries(options.staticModules))`，值由宿主传入。
   - `README.md:49` 指向 `../web/README.md#the-shared-module-table`；但我读的 `app.asar\dsh\node_modules\@deepseek-ai\dsh-web\README.md`（168 行全文）讲的是 **`ctx.web` 搜索服务**，不是共享模块表 —— 那个 `web` 是**源码目录名**，对应发布包名不同（疑为外壳 bundle，未在 asar 的 node_modules 里以该名出现）。
   - 已 grep/搜索：`staticModules`（asar 内 0 条命中）、`platform-modules`（0 条）、`PLATFORM_MODULES`（在已解包包中仅 README 注释出现）。
   - → 要拿到字面表，需读外壳（shell）浏览器 bundle，本机 asar 的 node_modules 里没找到它。

2. **`kind:"single"` 槽位的重复注册判定 + 默认 id 生成逻辑** —— 未确认。
   - 判定代码应在 `@deepseek-ai/dsh-client-ui-slots` 内，但该包**不在 asar 内**：`node asar-tool.mjs <asar> ls "dsh-client-ui-slots"` → **匹配 0 条**；`ls "slots"` → 全库仅命中 `@js-temporal/polyfill/lib/slots.ts` 一条。
   - 它只以版本号被依赖：`app.asar\...\dsh-client-ui-workspace\package.json:69` → `"@deepseek-ai/dsh-client-ui-slots": "0.2.1-rc.2"`。
   - 已查：`ui-layout`（`slots` 消费者，`inject` 在 `:589`）、`ui-renderer`（`provideRoot` 调用在 `:1465`）、`ui-workspace`（`:5039`）、`ui-sidebar`（`:437`）——**全是消费者，没有注册表实现**。
   - → 只能确认「官方占用者无 id」这个事实，不能确认覆盖时该写什么。

3. **客户端 bundle 的确切 HTTP 路由** —— 未确认。机制确认（`dsh-client-modules/README.zh.md:84`：宿主往 `<head>` 注入 facade/preload/bootstrap combo 行），但**路由字符串**没找到；本轮未展开 `dsh-client-modules/lib/index.js` 的 wire 组装部分（42 KB）。

4. **`dsh.client.external` / `immediately` 的完整语义** —— 部分未确认。`inject` 有 4 个官方包名的活范例（`dsh-client-auto-continue`），但「`external` 能不能请求 `ui-workspace` 使其在同一页面共存」未实测。（restart-button 的 `REFERENCES.md` R11 也记录过这两个字段「未确证；5 个已装第三方插件都没用」。）

**推断（需实测复核）**

- **推断 1**：`@deepseek-ai/dsh-client-ui-slots` 与 `-primitives` 被**编译进更大的 combo / 外壳 bundle**，因此不作为独立 specifier 暴露给第三方——否则官方 client bundle 无法在浏览器里拿到 `writeClipboard`（`ui-workspace/lib/client.js:5154`）和 `ctx.slots`。
- **推断 2**：由于官方 `sidebar.workspaces` 占用者**没写 id**，注册表的默认 key 很可能是「(name, 缺省 id)」，那么我们的覆盖注册**也应当不写 id（或写同一个缺省值）**，靠 `priority` 或注册顺序取胜。**这是必须实测的第一件事**——写错 id 可能导致两个占用者并存（不报错但渲染异常）或我们的注册被静默忽略。
- **推断 3**：`react-dom` 应在基线 seed words 里（React 生态必需），但未见第三方直接 require 的用例。
- **推断 4**：遮蔽后不会有「回退到官方」的开关；要回滚只能靠「卸载我们的插件 / 删掉 profile 里的记账条目」。

---

## 五、给下一步的实测建议（按优先级，每个都很小）

1. **实测默认 id / 覆盖语义**：写一个最小 client 插件，只做 `ctx.slots.inject("sidebar.workspaces", () => ctx.slots.register({name:"sidebar.workspaces"}, OurComp))`，分别在「不写 id / 写 id / 不同 priority」三种写法下观察：是否报错、是否两个都渲染、谁胜。**这一步的答案决定整个方案可行性。**
2. **实测可解析 specifier**：在同一最小插件里逐个 `require` Q3 表里的 specifier，捕获 `missed the module table` 异常，得到**实测白名单**。
3. **实测 `<id>/client` 申请**：在 `dsh.client.external` 里加 `@deepseek-ai/dsh-client-ui-workspace/client`，看它能否解析、拿到的是不是（且仅是）client 半边。
4. 前三条都过了，再谈「自己实现分组 UI」还是「复制官方逻辑」。
