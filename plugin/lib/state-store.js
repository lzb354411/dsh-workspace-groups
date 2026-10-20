/**
 * 分组状态的存取核心（Host 半边）。
 *
 * 为什么是「自己用 node:fs 读写一份人可读 JSON」，而不是官方存储服务
 * （`@deepseek-ai/dsh-storage` / `-storage-json` / `-storage-domain`）：
 *   1) 官方存储族的**唯一公共入口**是域形态：`ctx.storageDomain` + 由
 *      `defineDomain` / `domainTable` 声明的域，并要传 zod 记录 schema
 *      （`dsh-storage-domain/README.md:36-58`）。这两个函数来自
 *      `@deepseek-ai/dsh-storage-domain`，而本机 profile 的 node_modules
 *      里**没有**任何 storage 家族包（实测 `~/.dsh/profiles/desktop/node_modules/@deepseek-ai`
 *      只有 `cosmokit`、`dsh-client-ui-workspace`、`schemastery`）→ 运行期 import 解析不到。
 *   2) 域是「表 + 键 + 单条记录」的 KV 模型，与本插件契约里「客户端整份读写一个
 *      分组对象」不是一回事，硬套要加一层双向映射。
 *   3) `single` 布局的落盘格式是 `{ unit, global, tables }` 包裹
 *      （`dsh-storage-json/README.md:78-88`），用户打开看是一层无关结构；
 *      而 SPEC「数据」一节要求「存的数据要能被人看懂」。
 * 代价：原子写、备份、损坏隔离都要自己保证 —— 就是本文件做的事。
 *
 * 本文件只依赖 `node:*`，不 import 任何 `@deepseek-ai/*`（理由同上第 1 条）。
 */

import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'

/** 当前支持的状态版本；只接受这一个值（不认识的版本一律当「坏数据」处理）。 */
export const SUPPORTED_VERSION = 1

/** 备份文件保留份数上限。 */
export const MAX_BACKUPS = 5

/** 校验失败时抛的错；路由层据此回 400（而不是 500）。 */
export class StateValidationError extends Error {
  /** @param reason - 人话原因（会出现在 400 回执的 error 字段里）。 */
  constructor(reason) {
    super(reason)
    this.name = 'StateValidationError'
    this.reason = reason
  }
}

/** 一份合法的空状态（文件不存在、内容损坏时都用它兜底）。 */
export function emptyState() {
  return { version: SUPPORTED_VERSION, groups: [], membership: {} }
}

/** 是不是「普通对象」（排除 null 与数组）。 */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 校验一份状态对象是否符合契约形状。
 *
 * 注意：这里只做**契约要求的形状检查**，不做业务判断 ——
 *   - 不检查组名重复（SPEC F12 明确允许重名）；
 *   - 不检查 membership 指向的组是否存在（工作区被官方删掉后会有悬空记录，
 *     SPEC F13 要求「界面无残骸、不报错」，所以悬空是合法数据，由客户端忽略）。
 *
 * @param value - 待校验的对象。
 * @returns `{ ok: true, value }`（value 是规范化后的新对象，只含契约字段）
 *          或 `{ ok: false, error }`（error 是人话原因）。
 */
export function validateState(value) {
  if (!isPlainObject(value)) return { ok: false, error: 'state 必须是一个 JSON 对象' }

  if (value.version !== SUPPORTED_VERSION) {
    return { ok: false, error: `version 必须是 ${String(SUPPORTED_VERSION)}（收到 ${JSON.stringify(value.version)}）` }
  }

  if (!Array.isArray(value.groups)) return { ok: false, error: 'groups 必须是数组' }

  const groups = []
  for (let index = 0; index < value.groups.length; index += 1) {
    const group = value.groups[index]
    if (!isPlainObject(group)) return { ok: false, error: `groups[${String(index)}] 必须是对象` }
    if (typeof group.id !== 'string' || group.id.trim() === '') {
      return { ok: false, error: `groups[${String(index)}].id 必须是非空字符串` }
    }
    if (typeof group.name !== 'string' || group.name.trim() === '') {
      return { ok: false, error: `groups[${String(index)}].name 必须是非空字符串` }
    }
    if (typeof group.order !== 'number' || !Number.isFinite(group.order)) {
      return { ok: false, error: `groups[${String(index)}].order 必须是有限数字` }
    }
    // 只保留契约字段：客户端将来多送的字段不会污染这份人可读的文件。
    groups.push({ id: group.id, name: group.name, order: group.order })
  }

  if (!isPlainObject(value.membership)) return { ok: false, error: 'membership 必须是对象' }

  const membership = {}
  for (const [workspaceId, groupId] of Object.entries(value.membership)) {
    if (typeof groupId !== 'string') {
      return { ok: false, error: `membership["${workspaceId}"] 必须是字符串` }
    }
    membership[workspaceId] = groupId
  }

  return { ok: true, value: { version: SUPPORTED_VERSION, groups, membership } }
}

/**
 * 生成备份用的时间戳（本地时间，`yyyyMMdd-HHmmss`，与全机其它备份命名一致）。
 * @param date - 取时间的基准时刻，默认现在。
 * @returns 形如 `20261020-113500` 的字符串。
 */
export function backupStamp(date = new Date()) {
  const pad = (value, width = 2) => String(value).padStart(width, '0')
  return (
    `${String(date.getFullYear())}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  )
}

/** 本文件自己的 warn 出口：调用方给了 logger 就用它的，否则静默（测试里不刷屏）。 */
function warn(logger, message) {
  try {
    if (logger !== undefined && logger !== null && typeof logger.warn === 'function') {
      logger.warn(`[dsh-workspace-groups] ${message}`)
    }
  } catch {
    /* 日志失败不影响主流程。 */
  }
}

/**
 * 给现存文件留一份 `.bak-<时间戳>` 备份，并把备份数量裁到 {@link MAX_BACKUPS} 份。
 * @param file - 被备份的文件绝对路径。
 * @param logger - 可选日志对象。
 * @returns 备份文件路径；备份失败时返回 null（备份不该阻断主流程）。
 */
export function backupFile(file, logger) {
  try {
    const backupPath = `${file}.bak-${backupStamp()}`
    copyFileSync(file, backupPath)
    pruneBackups(file, logger)
    return backupPath
  } catch (error) {
    warn(logger, `备份失败（已忽略）：${file} -> ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

/**
 * 只保留最近 `keep` 份 `<file>.bak-*` 备份。
 * 时间戳格式固定且可字典序比较，所以按文件名排序 = 按时间排序。
 * （同一秒内连续写两次会落到同一个备份名上，属已知取舍：文件名格式是契约要求的。）
 * @param file - 主文件绝对路径。
 * @param logger - 可选日志对象。
 * @param keep - 保留份数，默认 {@link MAX_BACKUPS}。
 */
export function pruneBackups(file, logger = undefined, keep = MAX_BACKUPS) {
  const directory = dirname(file)
  const prefix = `${basename(file)}.bak-`
  let names
  try {
    names = readdirSync(directory).filter((entry) => entry.startsWith(prefix))
  } catch {
    return
  }
  const stale = names.sort().slice(0, Math.max(0, names.length - keep))
  for (const name of stale) {
    try {
      unlinkSync(join(directory, name))
    } catch (error) {
      warn(logger, `清理旧备份失败（已忽略）：${name} -> ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

/**
 * 读一份状态。**任何情况下都返回一份合法状态，绝不抛错**（路由层靠这一点保证不 500）。
 * 文件不存在 → 空状态；内容不是 JSON 或形状不对 → 先把原文件备份成 `.bak-<时间戳>`，
 * 记一条 warn，再返回空状态。
 * @param file - 状态文件绝对路径。
 * @param options - `{ logger }`。
 * @returns 合法状态对象。
 */
export function readState(file, options = {}) {
  const logger = options.logger
  let raw
  try {
    if (!existsSync(file)) return emptyState()
    raw = readFileSync(file, 'utf8')
  } catch (error) {
    warn(logger, `读取失败，按空状态处理：${file} -> ${error instanceof Error ? error.message : String(error)}`)
    backupFile(file, logger)
    return emptyState()
  }

  let parsed
  try {
    // 有人手工编辑过文件时可能带 BOM；这不改变「人可读」的初衷，顺手容忍。
    parsed = JSON.parse(raw.replace(/^\uFEFF/u, ''))
  } catch (error) {
    warn(logger, `内容不是合法 JSON，已备份原文件并按空状态处理：${file} -> ${error instanceof Error ? error.message : String(error)}`)
    backupFile(file, logger)
    return emptyState()
  }

  const checked = validateState(parsed)
  if (!checked.ok) {
    warn(logger, `形状不合法（${checked.error}），已备份原文件并按空状态处理：${file}`)
    backupFile(file, logger)
    return emptyState()
  }
  return checked.value
}

/**
 * 原子地写一份状态：
 *   同目录写临时文件 → fsync → rename 覆盖 → 读回校验 → 裁备份。
 * 覆盖前给旧文件留一份 `.bak-<时间戳>`（最多留 5 份）。
 * 写失败一律抛错，由路由层转成 500（读路径则完全不抛）。
 * @param file - 状态文件绝对路径。
 * @param state - 待写入的状态对象（会再校验一次）。
 * @param options - `{ logger }`。
 * @returns `{ file, bytes, backup }`。
 */
export function writeState(file, state, options = {}) {
  const logger = options.logger
  const checked = validateState(state)
  if (!checked.ok) throw new StateValidationError(checked.error)

  // 缩进 2 空格 + 结尾换行 + UTF-8 无 BOM：用户可能自己打开看。
  const text = `${JSON.stringify(checked.value, null, 2)}\n`

  try {
    mkdirSync(dirname(file), { recursive: true })
  } catch (error) {
    throw new Error(`创建目录失败：${error instanceof Error ? error.message : String(error)}`)
  }

  const backup = existsSync(file) ? backupFile(file, logger) : null

  // 临时文件名带 pid 与时间，避免同目录并发写互相踩；写在同一目录才能保证 rename 是原子的。
  const tempFile = `${file}.tmp-${String(process.pid)}-${String(Date.now())}`
  let handle
  try {
    handle = openSync(tempFile, 'w')
    writeSync(handle, text)
    fsyncSync(handle)
  } catch (error) {
    try {
      if (handle !== undefined) closeSync(handle)
    } catch {
      /* 关闭失败无所谓，下面统一清理临时文件。 */
    }
    try {
      unlinkSync(tempFile)
    } catch {
      /* 临时文件可能根本没建起来。 */
    }
    throw new Error(`写临时文件失败：${error instanceof Error ? error.message : String(error)}`)
  }
  closeSync(handle)

  try {
    // Windows 上 libuv 的 rename 走 MoveFileExW + 替换语义，可原子覆盖已存在文件
    // （dsh-storage-json/README.md:142 的同一依据）。
    renameSync(tempFile, file)
  } catch (error) {
    try {
      unlinkSync(tempFile)
    } catch {
      /* 清理失败不影响报错。 */
    }
    throw new Error(`替换状态文件失败：${error instanceof Error ? error.message : String(error)}`)
  }

  // 读回自证：落盘的就是我们以为的那份合法状态（半截内容在这里就会被抓住）。
  try {
    const landed = readFileSync(file, 'utf8')
    if (landed !== text) throw new Error('落盘内容与提交内容不一致')
    const again = validateState(JSON.parse(landed))
    if (!again.ok) throw new Error(`落盘内容形状不合法：${again.error}`)
  } catch (error) {
    throw new Error(`写入后校验失败：${error instanceof Error ? error.message : String(error)}`)
  }

  return { file, bytes: Buffer.byteLength(text, 'utf8'), backup }
}
