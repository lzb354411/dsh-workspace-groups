/**
 * Client（页面）半边 —— **只做诊断，不画任何界面**。
 *
 * 为什么这么小：
 *  - 真正的工作区列表已经由 `fork/`（官方 `@deepseek-ai/dsh-client-ui-workspace` 的改写版）承担，
 *    分组层就长在那份代码里；本包不再往侧栏塞任何自己的按钮/面板，避免污染官方界面。
 *  - 这个文件存在只是为了：① 证明本包的客户端半边确实被装载；② 留一个只读诊断出口，
 *    出问题时能直接在页面里查「模块表能不能 require」「槽位竞争是谁」。
 *
 * 形状取自本机已验证可用的 `dsh-desktop-restart-button`：
 * `window.__ModuleLoader__.load({ id, factory(require) {...} })`，factory 内是 CJS 风格 require，
 * 返回 { name, inject, apply }；无 JSX、无构建步骤。
 */
window.__ModuleLoader__.load({
  id: "dsh-workspace-groups",
  factory(require) {
    /** 平台模块表里我们关心的说明符（fork 的客户端半边依赖其中 5 个）。 */
    const SPECIFIERS = [
      "react",
      "react/jsx-runtime",
      "@deepseek-ai/cordis",
      "@deepseek-ai/dsh-client-store",
      "@deepseek-ai/dsh-client-ui-slots",
      "@deepseek-ai/dsh-client-ui-primitives",
    ];

    /** 探测结果：只记「能不能拿到 + 导出个数」，不记实现。 */
    const moduleProbe = SPECIFIERS.map((spec) => {
      try {
        return { spec, ok: true, exports: Object.keys(require(spec) ?? {}).length };
      } catch (error) {
        return { spec, ok: false, error: String((error && error.message) || error) };
      }
    });

    function apply(ctx) {
      const diag = {
        version: "0.1.0",
        moduleProbe,
        /** 某个槽位当前有几条注册、各自的 priority 与 id。 */
        slotEntries: (slotKey) => {
          try {
            return ctx.slots.entries(slotKey).map((entry) => ({
              priority: entry?.options?.priority ?? 0,
              id: entry?.options?.id ?? null,
            }));
          } catch (error) {
            return String((error && error.message) || error);
          }
        },
        /** 侧栏工作区列表的竞争情况（我们的 fork 应当以官方同名条目胜出渲染）。 */
        sidebar: () => diag.slotEntries("sidebar.workspaces"),
      };
      try {
        globalThis.__wsgDiag = diag;
      } catch (error) {
        void error;
      }
    }

    return { name: "dsh-workspace-groups", inject: ["slots"], apply };
  },
});
