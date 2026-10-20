/**
 * Host 半边：分组数据的存取路由。
 *
 * 形态照抄本机已验证可用的 `dsh-desktop-restart-button/lib/index.js`：
 *   `ctx.webServer.register({ kind: 'exact', path, handler })` + `ctx.effect(...)` 管释放；
 * 只 import `node:*` 与本目录的 `state-store.js`，不 import 任何 `@deepseek-ai/*`
 * （profile 的 node_modules 里没有 harness 运行时包，import 会解析失败）。
 *
 * 路由契约（客户端半边按它写，形状不许改）：
 *   GET  /dsh-workspace-groups/state → 200 + 状态对象；文件缺失/损坏同样 200 + 空状态（**绝不 500**，
 *        侧栏会因 500 崩掉或空掉）。损坏时原文件留一份 `.bak-<时间戳>`，日志 warn。
 *   POST /dsh-workspace-groups/state → 必须带 `x-dsh-workspace-groups: 1`（防跨站简单请求），
 *        否则 403；body 不合法 → 400 且**不写文件**；合法 → 原子写 → 200 `{ok:true}`；
 *        写失败 → 500 `{ok:false,error}`。
 *   其它方法 → 404（不吞别人的请求；本插件只精确注册这一条路径，不注册 prefix、不抢 fallback）。
 *
 * 关于「其它路径」：按 `@deepseek-ai/dsh-host-webserver` 的匹配规则，精确表 → 最长前缀 → fallback，
 * 而 fallback 这把椅子由官方 SPA dist server 占着（README:61、README:65），且二次注册 fallback 会抛错。
 * 所以我们**只**精确注册自己的路径，别的路径根本不归我们管，也就不该由我们回 404。
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

import { StateValidationError, readState, validateState, writeState } from './state-store.js'

/** 稳定的 Cordis 插件名（与包名一致）。 */
export const name = 'dsh-workspace-groups'

/** 需要宿主提供的能力：嵌入式 Web 服务器（用来注册路由）。 */
export const inject = ['webServer']

/** 唯一的精确路由路径。带包名前缀，避免与别的插件撞车。 */
const ROUTE_PATH = '/dsh-workspace-groups/state'

/** 自定义请求头：只有本插件的页面半边会带它（跨站「简单请求」带不了它）。 */
const REQUEST_HEADER = 'x-dsh-workspace-groups'

/** 请求体上限（字节）。分组状态是几十条记录量级，1 MiB 足够，防止有人往里灌数据。 */
const MAX_BODY_BYTES = 1024 * 1024

/**
 * 状态文件落在哪：`<DSH_HOME>/storages/workspace-groups.json`。
 * 默认 `DSH_HOME` 是 `~/.dsh`（本机实测该目录下已有 `storages/workspace.json`，
 * 即 DSH 自己的数据目录），所以分组数据跟着 DSH 的数据一起备份。
 * @param env - 环境变量表，默认 `process.env`（测试可注入）。
 * @returns 状态文件绝对路径。
 */
export function resolveStateFile(env = process.env) {
  const configured = env.DSH_HOME
  const home = typeof configured === 'string' && configured.trim() !== '' ? configured : join(homedir(), '.dsh')
  return join(home, 'storages', 'workspace-groups.json')
}

/** 统一 JSON 回执（发出后就不再动 res）。 */
function send(res, status, payload) {
  try {
    if (res.headersSent === true) return
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      // 分组状态必须新鲜；缓存会让刷新后看到旧分组。
      'cache-control': 'no-store',
    })
    res.end(JSON.stringify(payload))
  } catch {
    /* 连接已经断了：回执发不出去不是错误。 */
  }
}

/** 日志出口：用宿主 ctx.logger，缺失时退回 console，再缺失就静默。 */
function logWarn(logger, message) {
  const target = logger ?? console
  try {
    if (typeof target.warn === 'function') target.warn(`[dsh-workspace-groups] ${message}`)
  } catch {
    /* 日志失败不影响主流程。 */
  }
}

/** 把请求体读完（超过上限就抛错，避免无限读）。 */
async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error(`请求体超过上限 ${String(MAX_BODY_BYTES)} 字节`)
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * 路由处理器。**本函数不抛错**（宿主 webserver 对抛错的 handler 会回 400 并记 warn）。
 * @param req - 宿主 Web 服务器请求对象。
 * @param res - 宿主 Web 服务器响应对象。
 * @param stateFile - 状态文件绝对路径。
 * @param logger - 可选日志对象。
 * @returns 处理完成的 Promise（测试可以直接 await）。
 */
export async function handleRequest(req, res, stateFile, logger = undefined) {
  try {
    const url = new URL(typeof req.url === 'string' && req.url !== '' ? req.url : ROUTE_PATH, 'http://127.0.0.1')

    // 精确匹配：路径不对就 404（正常情况下不会发生，因为注册的就是 exact 路由）。
    if (url.pathname !== ROUTE_PATH) {
      send(res, 404, { ok: false, error: 'not-found' })
      req.resume?.()
      return
    }

    if (req.method === 'GET') {
      // 读路径永不抛错：文件缺失/损坏都返回合法空状态（宁可丢分组，也不能让侧栏崩）。
      send(res, 200, readState(stateFile, { logger }))
      req.resume?.()
      return
    }

    if (req.method !== 'POST') {
      // 契约第 3 条：其它方法一律 404。
      send(res, 404, { ok: false, error: 'not-found' })
      req.resume?.()
      return
    }

    // 防跨站：跨站「简单请求」带不了自定义头；带它跨域会先触发预检。
    if (req.headers?.[REQUEST_HEADER] !== '1') {
      send(res, 403, { ok: false, error: 'missing-request-header' })
      req.resume?.()
      return
    }

    let raw
    try {
      raw = await readBody(req)
    } catch (error) {
      send(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
      return
    }

    let parsed
    try {
      // 容忍手工编辑留下的 BOM。
      parsed = JSON.parse(raw.replace(/^\uFEFF/u, ''))
    } catch (error) {
      send(res, 400, {
        ok: false,
        error: `请求体不是合法 JSON：${error instanceof Error ? error.message : String(error)}`,
      })
      return
    }

    const checked = validateState(parsed)
    if (!checked.ok) {
      // 不合法**不写文件**，原文件一个字节都不动。
      send(res, 400, { ok: false, error: checked.error })
      return
    }

    try {
      const result = writeState(stateFile, checked.value, { logger })
      send(res, 200, { ok: true, bytes: result.bytes, backup: result.backup })
    } catch (error) {
      if (error instanceof StateValidationError) {
        send(res, 400, { ok: false, error: error.reason })
        return
      }
      logWarn(logger, `写入失败：${error instanceof Error ? error.message : String(error)}`)
      send(res, 500, {
        ok: false,
        error: `写入失败：${error instanceof Error ? error.message : String(error)}`,
      })
    }
  } catch (error) {
    // 兜底：任何漏网的异常都变成 500 JSON，绝不把异常抛回宿主（抛回会被答成 400 且看不出原因）。
    logWarn(logger, `处理请求时异常：${error instanceof Error ? error.message : String(error)}`)
    send(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

/**
 * 插件入口：注册精确路由，释放交给 Cordis 的 effect 生命周期。
 * @param ctx - 宿主侧插件上下文。
 */
export function apply(ctx) {
  const stateFile = resolveStateFile()
  const logger = ctx?.logger ?? console
  logWarn(logger, `分组状态文件：${stateFile}`)

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: ROUTE_PATH,
        handler: (req, res) => handleRequest(req, res, stateFile, logger),
      }),
    'dsh-workspace-groups: state route',
  )
}
