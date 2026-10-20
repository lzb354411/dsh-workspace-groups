/**
 * Host 半边自测：用假 ctx（记录注册了哪些路由 + 最小 logger）在临时目录里驱动真实实现。
 * 无第三方依赖，直接 `node test/host-state.test.mjs`。
 *
 * 覆盖：契约里的每条状态码、损坏文件的兜底与备份、原子写、备份份数上限、
 * 以及「路由注册只在精确路径上」这一条接线事实。
 */

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

import { apply, handleRequest, inject, name, resolveStateFile } from '../plugin/lib/index.js'
import { MAX_BACKUPS, emptyState, validateState } from '../plugin/lib/state-store.js'

/** 结果统计。 */
let passed = 0
let failed = 0

/**
 * 断言一条用例。
 * @param label - 用例名。
 * @param fn - 断言体（可异步）；抛错即失败。
 */
async function test(label, fn) {
  try {
    await fn()
    passed += 1
    console.log(`PASS  ${label}`)
  } catch (error) {
    failed += 1
    console.log(`FAIL  ${label}\n      ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** 造一个假 ctx：记录路由、收集日志、effect 直接执行。 */
function makeCtx() {
  const routes = []
  const logs = { warn: [], info: [] }
  const ctx = {
    logger: {
      warn: (message) => logs.warn.push(String(message)),
      info: (message) => logs.info.push(String(message)),
    },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {
          const index = routes.indexOf(route)
          if (index >= 0) routes.splice(index, 1)
        }
      },
    },
    effect(fn) {
      return fn()
    },
  }
  return { ctx, routes, logs }
}

/** 造一个最小的 res 替身。 */
function makeRes() {
  return {
    headersSent: false,
    status: 0,
    headers: null,
    body: '',
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
      this.headersSent = true
      return this
    },
    end(chunk) {
      if (chunk !== undefined) this.body += String(chunk)
    },
  }
}

/**
 * 按 HTTP 语义调用一次路由。
 * @param route - 已注册的路由对象。
 * @param request - `{ method, path, headers, body }`。
 * @returns `{ status, headers, json, text }`。
 */
async function call(route, request = {}) {
  const { method = 'GET', path = '/dsh-workspace-groups/state', headers = {}, body } = request
  const req = Readable.from(body === undefined ? [] : [Buffer.from(body, 'utf8')])
  req.method = method
  req.url = path
  req.headers = headers
  const res = makeRes()
  await route.handler(req, res)
  let json = null
  try {
    json = JSON.parse(res.body)
  } catch {
    /* 非 JSON 回执（不该出现）留给断言自己看 text。 */
  }
  return { status: res.status, headers: res.headers, text: res.body, json }
}

/** 合法状态样例。 */
function sampleState() {
  return {
    version: 1,
    groups: [
      { id: 'g-1a2b3c4d', name: '工作', order: 0 },
      { id: 'g-5e6f7a8b', name: '项目', order: 1 },
    ],
    membership: { 'E:\\DSH\\03-DSH-plugins': 'g-1a2b3c4d', 'E:\\DSH\\04-agent': 'g-5e6f7a8b' },
  }
}

/** 目录里的备份名（升序）。 */
function backupNames(file) {
  const prefix = `${file.split(/[\\/]/u).pop()}.bak-`
  return readdirSync(join(file, '..')).filter((entry) => entry.startsWith(prefix)).sort()
}

const root = mkdtempSync(join(tmpdir(), 'wsg-host-state-'))
// 与 apply() 的解析规则一致：<DSH_HOME>/storages/workspace-groups.json。
const stateFile = join(root, 'storages', 'workspace-groups.json')
const ctxBox = makeCtx()

console.log(`临时目录：${root}\n`)

// ——— 接线：apply 只注册一条精确路由 ———
await test('apply 注册且仅注册一条 exact 路由，路径正确', () => {
  process.env.DSH_HOME = root
  apply(ctxBox.ctx)
  assert.equal(ctxBox.routes.length, 1)
  assert.equal(ctxBox.routes[0].kind, 'exact')
  assert.equal(ctxBox.routes[0].path, '/dsh-workspace-groups/state')
  assert.deepEqual(inject, ['webServer'])
  assert.equal(name, 'dsh-workspace-groups')
  assert.equal(resolveStateFile({ DSH_HOME: root }), stateFile)
  // DSH_HOME 缺省时应落到 ~/.dsh/storages/workspace-groups.json（与 DSH 自己的数据同目录）。
  assert.equal(resolveStateFile({}), join(homedir(), '.dsh', 'storages', 'workspace-groups.json'))
})

const route = ctxBox.routes[0]

// ——— GET：文件不存在 → 200 + 空状态 ———
await test('GET 文件不存在 → 200 + 合法空状态', async () => {
  const res = await call(route)
  assert.equal(res.status, 200)
  assert.match(res.headers['content-type'], /application\/json/u)
  assert.deepEqual(res.json, emptyState())
})

// ——— POST：合法 → 200 且文件人可读、内容一致 ———
await test('POST 合法状态 → 200 ok，文件内容与提交一致且人可读', async () => {
  const res = await call(route, {
    method: 'POST',
    headers: { 'x-dsh-workspace-groups': '1' },
    body: JSON.stringify(sampleState()),
  })
  assert.equal(res.status, 200)
  assert.equal(res.json.ok, true)

  const text = readFileSync(stateFile, 'utf8')
  assert.deepEqual(JSON.parse(text), sampleState(), '文件内容应与提交内容一致')
  assert.ok(text.startsWith('{\n  "version": 1,'), '应是缩进 2 空格的人可读 JSON')
  assert.ok(text.endsWith('}\n'), '应以换行结尾')
  assert.notEqual(text.charCodeAt(0), 0xfeff, '不应有 BOM')
  assert.ok(text.includes('工作'), '中文应原样落盘（UTF-8 直写，不转义）')
  assert.ok(!text.includes('\\u'), '不应出现 Unicode 转义')
})

await test('POST 只保留契约字段（多余字段不污染文件）', async () => {
  const polluted = { ...sampleState(), extra: 'x', groups: sampleState().groups.map((g) => ({ ...g, junk: 1 })) }
  const res = await call(route, {
    method: 'POST',
    headers: { 'x-dsh-workspace-groups': '1' },
    body: JSON.stringify(polluted),
  })
  assert.equal(res.status, 200)
  assert.deepEqual(JSON.parse(readFileSync(stateFile, 'utf8')), sampleState())
})

// ——— POST：缺头 → 403 且文件未动 ———
await test('POST 缺请求头 → 403，文件未被改动', async () => {
  const before = readFileSync(stateFile, 'utf8')
  const res = await call(route, {
    method: 'POST',
    body: JSON.stringify({ version: 1, groups: [], membership: {} }),
  })
  assert.equal(res.status, 403)
  assert.equal(res.json.ok, false)
  assert.equal(readFileSync(stateFile, 'utf8'), before)
})

// ——— POST：形状非法 → 400 且文件未动 ———
const badBodies = [
  ['缺 version', { groups: [], membership: {} }],
  ['version 不是 1', { version: 2, groups: [], membership: {} }],
  ['membership 的值不是字符串', { version: 1, groups: [], membership: { ws: 42 } }],
  ['groups 项缺 id', { version: 1, groups: [{ name: '工作', order: 0 }], membership: {} }],
  ['groups 项 id 为空串', { version: 1, groups: [{ id: '  ', name: '工作', order: 0 }], membership: {} }],
  ['groups 项 order 非有限数', { version: 1, groups: [{ id: 'g-1', name: '工作', order: 'x' }], membership: {} }],
  ['groups 不是数组', { version: 1, groups: {}, membership: {} }],
]
for (const [label, body] of badBodies) {
  await test(`POST 形状非法（${label}）→ 400，文件未被改动`, async () => {
    const before = readFileSync(stateFile, 'utf8')
    const res = await call(route, {
      method: 'POST',
      headers: { 'x-dsh-workspace-groups': '1' },
      body: JSON.stringify(body),
    })
    assert.equal(res.status, 400)
    assert.equal(res.json.ok, false)
    assert.ok(typeof res.json.error === 'string' && res.json.error.length > 0, 'error 应是人话原因')
    assert.equal(readFileSync(stateFile, 'utf8'), before)
  })
}

await test('POST body 不是 JSON → 400，文件未被改动', async () => {
  const before = readFileSync(stateFile, 'utf8')
  const res = await call(route, { method: 'POST', headers: { 'x-dsh-workspace-groups': '1' }, body: 'not json' })
  assert.equal(res.status, 400)
  assert.equal(readFileSync(stateFile, 'utf8'), before)
})

// ——— 损坏文件 → 空状态 + .bak ———
await test('文件内容不是 JSON → GET 200 空状态、不抛错、产生 .bak 备份', async () => {
  const broken = join(root, 'broken.json')
  writeFileSync(broken, '{"version": 1, "groups": [', 'utf8')
  const real = await callRouteFile(broken)
  assert.equal(real.status, 200)
  assert.deepEqual(real.json, emptyState())
  assert.equal(backupNames(broken).length, 1, '应留一份 .bak- 备份')
  assert.equal(readFileSync(broken, 'utf8'), '{"version": 1, "groups": [', '原文件不应被删或改写')
  assert.ok(
    ctxBox.logs.warn.some((line) => line.includes('不是合法 JSON')),
    '日志里应有 warn',
  )
})

/**
 * 用状态文件路径直接打一次 GET（不经过注册表，用于损坏文件的用例）。
 * @param file - 状态文件路径。
 * @returns 与 {@link call} 同形状的结果。
 */
async function callRouteFile(file) {
  const req = Readable.from([])
  req.method = 'GET'
  req.url = '/dsh-workspace-groups/state'
  req.headers = {}
  const res = makeRes()
  await handleRequest(req, res, file, ctxBox.ctx.logger)
  return { status: res.status, headers: res.headers, text: res.body, json: JSON.parse(res.body) }
}

await test('文件是合法 JSON 但形状不对 → GET 200 空状态 + .bak 备份', async () => {
  const wrong = join(root, 'wrongshape.json')
  writeFileSync(wrong, JSON.stringify({ version: 1, groups: 'nope', membership: {} }), 'utf8')
  const res = await callRouteFile(wrong)
  assert.equal(res.status, 200)
  assert.deepEqual(res.json, emptyState())
  assert.equal(backupNames(wrong).length, 1)
  assert.ok(ctxBox.logs.warn.some((line) => line.includes('形状不合法')))
})

// ——— 原子性 ———
await test('连续两次 POST 后文件是完整合法 JSON，且不留临时文件', async () => {
  const file = join(root, 'atomic.json')
  const first = { version: 1, groups: [{ id: 'g-a', name: '一', order: 0 }], membership: {} }
  const second = { version: 1, groups: [{ id: 'g-b', name: '二', order: 0 }], membership: { ws1: 'g-b' } }
  for (const body of [first, second]) {
    const req = Readable.from([Buffer.from(JSON.stringify(body), 'utf8')])
    req.method = 'POST'
    req.url = '/dsh-workspace-groups/state'
    req.headers = { 'x-dsh-workspace-groups': '1' }
    const res = makeRes()
    await handleRequest(req, res, file, ctxBox.ctx.logger)
    assert.equal(res.status, 200)
  }
  const text = readFileSync(file, 'utf8')
  assert.deepEqual(JSON.parse(text), second, '应是完整合法 JSON，无半截内容')
  assert.ok(validateState(JSON.parse(text)).ok)
  const leftovers = readdirSync(join(root)).filter((entry) => entry.includes('.tmp-'))
  assert.deepEqual(leftovers, [], '不应留下临时文件')
})

// ——— 备份份数上限 ———
await test(`备份份数不超过 ${String(MAX_BACKUPS)} 份（旧的先删）`, async () => {
  const file = join(root, 'prune.json')
  writeFileSync(file, JSON.stringify(emptyState()), 'utf8')
  const seeded = []
  for (let index = 1; index <= 7; index += 1) {
    const name = `${file.split(/[\\/]/u).pop()}.bak-20260101-00000${String(index)}`
    seeded.push(name)
    writeFileSync(join(root, name), '{}', 'utf8')
  }
  const req = Readable.from([Buffer.from(JSON.stringify(sampleState()), 'utf8')])
  req.method = 'POST'
  req.url = '/dsh-workspace-groups/state'
  req.headers = { 'x-dsh-workspace-groups': '1' }
  const res = makeRes()
  await handleRequest(req, res, file, ctxBox.ctx.logger)
  assert.equal(res.status, 200)

  const names = backupNames(file)
  assert.equal(names.length, MAX_BACKUPS, `应只剩 ${String(MAX_BACKUPS)} 份，实际 ${String(names.length)}`)
  assert.ok(!names.includes(seeded[0]), '最旧的两份应被清掉')
  assert.ok(!names.includes(seeded[1]), '最旧的两份应被清掉')
})

// ——— 方法/路径 ———
await test('其它方法（DELETE）→ 404；其它路径 → 404', async () => {
  const del = await call(route, { method: 'DELETE' })
  assert.equal(del.status, 404)
  const other = await call(route, { method: 'GET', path: '/dsh-workspace-groups/other' })
  assert.equal(other.status, 404)
})

await test('写失败 → 500（用同名目录占位制造失败）', async () => {
  const file = join(root, 'isdir.json')
  mkdirSync(file) // 该路径是目录 → rename 必然失败
  const req = Readable.from([Buffer.from(JSON.stringify(emptyState()), 'utf8')])
  req.method = 'POST'
  req.url = '/dsh-workspace-groups/state'
  req.headers = { 'x-dsh-workspace-groups': '1' }
  const res = makeRes()
  await handleRequest(req, res, file, ctxBox.ctx.logger)
  const json = JSON.parse(res.body)
  assert.equal(res.status, 500)
  assert.equal(json.ok, false)
  assert.ok(ctxBox.logs.warn.some((line) => line.includes('写入失败')), '日志里应带原因')
})

rmSync(root, { recursive: true, force: true })
console.log(`\n结果：通过 ${String(passed)} ｜ 失败 ${String(failed)}`)
if (failed > 0) process.exitCode = 1
