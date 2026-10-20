# RECON：官方 composer 文本输入路径（只读）

> 代码：`C:\Users\14544\AppData\Local\Programs\DeepSeek Harness\resources\app.asar`；解包＝8B 头＋u32@12(jsonLen)＋JSON@16，数据区起 `16+jsonLen`；按 asar 自带 SHA256 校验通过（conversation client.js 773901B）。
> `CONV:` = asar 内 `dsh/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js`。等级：**实测 > 代码事实 > 推断**。

## 结论

官方代码里**不存在**「只在安卓 + 只对逐键英文 → 光标重置到最前」的完整路径：**未证实**。但存在两块与症状形状吻合的碎片：
- **代码事实**：`insertText`（逐键英文）与 `insertCompositionText`（输入法）在 Lexical 里是**两条不同分支**（`CONV:6593-6595`、`6752-6759`），只有英文那条被 `preventDefault()` 后**由编辑器自己重写 DOM**。
- **代码事实**：该分支末端官方调用**裸的** `rootElement.focus({preventScroll:true})`（`CONV:9054`、`9062`），而 DSH 自己在注释里写明「裸 DOM focus 会把光标落到开头」（`CONV:15363-15365`）。

## 逐条

**Q1 contenteditable 还是 textarea → contenteditable div。** `CONV:18096-18104`：`("div", { ref, contentEditable: editor !== null && editable, suppressContentEditableWarning: true, role: "textbox", "aria-multiline": "true", "data-composer-input": true, ...rest })`。全 asar（18309 文件，按 offset 映射回路径）`data-composer-input` **仅此 1 处**。`<textarea>` 只在 message-feedback / schedule / user-questions / documentpreview / xterm 里，均非 composer。

**Q2 路径＝Lexical 编辑器；官方自己 preventDefault 后手动插入，不是受控 value+onChange。** `CONV:6761` `switch (e.preventDefault(), n) {`；`CONV:6752-6759`：`if ("insertText" === n || "insertTranspose" === n) { … else null != c && Bn(…) ? (e.preventDefault(), Nl(r, je$2, c), jn(c)) : i.unprocessedBeforeInputData = c; return i.lastBeforeInputInsertTextTimeStamp = e.timeStamp, !0; }`（`je$2`＝INSERT_TEXT_COMMAND）。无 `execCommand`（composer 内 0 处）。DSH 侧改文只走 `editor.update`（`CONV:14675-14687`、`14730-14736`）；DSH 只注册键位/粘贴（`CONV:18186-18270`），**没有 beforeinput 处理器**——全 asar 中 conversation 客户端的 `beforeinput` 仅 3 处（6592/8936/13346，全在 Lexical 内）；`dsh-web-frontend/dist/assets/index-CN7NIWNw.js` 那 2 处是 React DOM 自己的事件表。

**Q3 按 inputType / isComposing / keyCode 229 的分岔 → 有，正是「中英不同路」的根源。** `CONV:6593-6595`：`const n = t.inputType; if ("deleteCompositionText" === n || i && bl(e)) return; if ("insertCompositionText" === n) return;`（输入法那条**直接 return，不接 DOM**）。`CONV:6708`：`if ("insertText" === n && e.data && i.isInsertTextAfterHandledSelectionCommand) { … e.preventDefault() … }`；`CONV:6768` `case "insertFromComposition":`；`CONV:6837/6839` `"insertCompositionText" === t.inputType && … && !e.isComposing()` / `… && e.isComposing() && Xo(h) && Ks(h)`。DSH 另有一套组合态判定 `CONV:18177-18179` `function isComposingEvent(event, recentlyComposing) { return event.isComposing || event.keyCode === 229 || recentlyComposing(); }`（用于放行 Enter/Space，`18229/18238`）——**只影响快捷键，不碰光标**。

**Q4 重写 DOM／恢复选区的代码都有；官方确实依赖 `.focus()`。** 官方唯一整篇重写＝`CONV:14672-14688` `setDraft(text){ … root.clear(); … root.selectEnd(); }`（`discrete:true`）→ 重写后光标到**末尾**。Lexical 把编辑器选区写回 DOM：`CONV:9051-9057` `… || r.has("skip-selection-focus") || s.focus({ preventScroll: true }); … if ("element" !== f.type) return;`、`CONV:9058` 同类 `s.focus({preventScroll:true})`（tag 定义见 `CONV:7496`）→ **每次应用选区都会调用根元素 focus()**。Lexical 的 `editor.focus()` 自身不 focus DOM，只把选区落回：`CONV:10615-10623` `… null !== o ? o.dirty || ol(o.clone()) : 0 !== r.getChildrenSize() && ("rootStart" === e.defaultSelection ? r.selectStart() : r.selectEnd())`——无选区时是 **selectEnd（末尾）**，全库无 selectStart 兜底。DSH 明说后果：`CONV:15362-15370` 注释「Lexical's own focus restores its stored selection; **a bare DOM focus on the contenteditable would land the caret at the start instead.**」实现 `focus(){ this.editor.getRootElement()?.focus({preventScroll:true}); this.editor.focus(); }`。官方还有**只做裸 focus、不接 editor.focus()** 的调用点：`CONV:18386-18389` `keepDraftFocus(event, editor){ event.preventDefault(); editor?.getRootElement()?.focus({preventScroll:true}); }`。React 不重写子节点（`ComposerContentEditable` 只有属性、无 children 无 `dangerouslySetInnerHTML`；placeholder 是**兄弟**节点 `18163-18168`），但根元素属性会按需写：`18161` `style: hint === null ? void 0 : {"--dsh-composer-hint": JSON.stringify(hint)}`、`18153` `"data-phase": phase`（hint 仅命令 claim 期变化，`18964-18968`）；`editable` 仅 phase∈{adjudicating,submitting} 翻转（`18823-18826`），普通打字不变。DOM 清空只发生在换根元素：`CONV:10244` `e.textContent = ""`（`setRootElement`）。

**Q5 安卓判定 → 全 asar 只有 1 处 UA 判定（来自 Lexical 环境模块）；DSH 自有代码 0 处。** `CONV:5303`：`const n = … , c = n && /Android/.test(navigator.userAgent), a = n && /Version\/[\d.]+.*Safari/… && !c, u = n && /^(?=.*Chrome).*/i.test(navigator.userAgent), f = n && c && u, d$1 = …`（IS_ANDROID=c、IS_CHROME=u、**IS_ANDROID_CHROME=f**、IS_IOS=l、IS_APPLE_WEBKIT=d$1）。命名信度锚点（**代码事实**）：`CONV:6538` `i ? n.compositionPhase = "ending-firefox" : l || !a && !d$1 ? Nl(e, We$2, t) : (n.compositionPhase = "ending-safari", …)`——字符串与 i=Firefox、l=iOS、d$1=AppleWebKit 一一对应。同一规则下**安卓专属分支确实存在于输入路径**（标识符语义为**推断**：`Gn` 体内未声明同名局部变量，`CONV:6833-6851`）：`CONV:6850` `… , f && e.isComposing() && (n.lastKeyDownTimeStamp = 0, Vs(null));`、`CONV:6861` `… || !f && (i.getFormat() !== o.format || Xo(i) && i.getStyle() !== o.style) || …`、`CONV:6738` `let d = f && n && !u && a;`＋`6742`（删除键）。**这三处都不把选区设到开头**。另：`setSelectionRange` 在 composer 内 0 处（全 asar 仅 devtools/inspector 与 `lib/preload-app.cjs`）；`prototype.focus` 在官方 asar 内**只在 devtools 包**出现 → 官方**没有**改 `HTMLElement.prototype.focus`。

**Q6 草稿同步：有本地持久化，无远端/服务端回灌。** 写进编辑器只有 4 条：会话绑定种入 `CONV:15825` `shell.setDraft(readConversationDraft(binding.sessionId))`（读 localStorage `${CONVERSATION_STORE_KEY}.${sessionId}`，`4464-4479`）、切工作区搬家 `19786-19789`、`options.prompt` `15085`、提交后清空 `15329`。反方向只是出：`CONV:15688-15696` `publish()` 内 `this.persistDraft?.(draft)` → `17936` `bindDraftPersistence(actions.setDraft)`，而 `actions.setDraft` 是 localStorage store 动作（`4440-4442`），**不回写编辑器**。故即使重连/重建 shell 触发回灌，效果也是 `root.selectEnd()` → 光标到**末尾**，仍非开头。

## 候选机制（附证伪观察）

- **M1 逐键英文经 preventDefault 后由编辑器重写 DOM，末端裸 `rootElement.focus()` 复位；若此刻已失焦则浏览器把光标放开头，且该分支随后 `return` 不再 `setBaseAndExtent`** ｜代码事实（分支与语义）+ 推断（安卓上「失焦」这一步）｜证伪：平板 Chrome 每键打印 `document.activeElement === document.querySelector('[data-composer-input]')` 与 `getSelection().anchorOffset`；若 activeElement 恒为它，M1 不成立。
- **M2 安卓专属组合分支 `CONV:6850`（`f && e.isComposing()` → 每次组合更新 `Vs(null)` 清 compositionKey、`lastKeyDownTimeStamp=0`）打乱 Lexical 的 DOM 复用与选区锚点** ｜代码事实（分支）+ 推断（与「英文坏中文好」的因果）｜证伪：若英文键入时 `compositionstart/end` 根本不触发（纯 `insertText`），M2 与英文无关。
- **M3 官方对 `insertCompositionText` 直接 return（`CONV:6595`）不接管 DOM，只有 `insertText` 才接管 → 中文天然免疫** ｜代码事实 ｜证伪：若某输入法英文模式也走 `insertText` 而它正常，则该分岔不构成根因。
- **M4 第三方竖屏 focus 猴补丁吞掉 `HTMLElement.prototype.focus`，使官方「依赖 focus 复位」的路径失效** ｜推断（官方侧只证明依赖关系）｜证伪：横屏也坏（已知）→ M4 不足以解释全部。

## 我找过但没找到的

- **没有**任何「把光标/选区设到开头」的官方代码：`selectStart()` 全库 0 处（仅 `defaultSelection === "rootStart"` 这个**入参名**，无调用方），composer 内 `setSelectionRange` 0 处。
- **没有**DSH 自有的 android/userAgent/平台分支：conversation 客户端除 `CONV:5303`（Lexical 环境模块）外 0 处；其它 `dsh-client-*` 亦 0 处（仅 open-in-app 的 "Android Studio" 文案、xterm 的 isAndroid）。
- **没有**官方对 `HTMLElement.prototype.focus` 的改写（全 asar 仅 devtools `legacy-*.js` 2 处 `prototype.focus`）。
- **没有**把草稿写回输入框的服务端/远端 Remote（客户端侧只有 localStorage 读种，`CONV:15825`）；`dsh-*/lib`（host 侧）未逐包检查 → **未证实**，非「不存在」。
- **没有** `@lexical/*` 独立包：全 asar 路径 0 命中（Lexical 内联在 conversation 客户端内）；asar 内 `.map` 文件总数 0（有 `//# sourceMappingURL=client.js.map` 但文件不存在）。
- **未证实**：`CONV:6738/6742/6850/6861` 的 `f` ＝ IS_ANDROID_CHROME。依据＝`CONV:6538` 命名锚点＋函数内无同名局部；压缩混淆下无法 100% 确认。

## 下一步取证配方

在平板上对 `[data-composer-input]` 打日志：`beforeinput(inputType,isComposing,data)`、`compositionstart/end`、`keydown(key,keyCode,isComposing)`、`focus/blur`、`selectionchange(anchorOffset)`、`document.activeElement`。英文（坏）与中文（好）各打一遍对比这四项，即可判定 M1/M2/M3。
