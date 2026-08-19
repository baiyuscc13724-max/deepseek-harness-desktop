const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { mkdtemp, rm, readFile, writeFile } = require('node:fs/promises')
const { existsSync } = require('node:fs')
const os = require('node:os')

const {
  DEFAULT_CONFIG,
  MemoryService,
  RECALL_POLICIES,
  SENSITIVITY_LEVELS,
  sanitizeConfig
} = require('../electron/bridge/memory-service.cjs')

async function fixture() {
  return mkdtemp(path.join(os.tmpdir(), 'memory-svc-'))
}

function destroy(root) {
  return rm(root, { recursive: true, force: true })
}

function clock() {
  let ms = 0
  return { now: () => (ms += 1000), value: () => ms }
}

function makeService(root, options = {}) {
  return new MemoryService({ dbPath: path.join(root, 'mem', 'memory.db'), ...options })
}

async function withService(root, options = {}, fn) {
  const service = makeService(root, options)
  await service.enable({ dbPath: path.join(root, 'mem', 'memory.db') })
  try {
    return await fn(service)
  } finally {
    service.disable()
  }
}

test('默认禁用：不写入、不建文件，数据操作全部拒绝', async () => {
  const root = await fixture()
  try {
    const service = makeService(root)
    const status = service.status()
    assert.equal(status.enabled, false)
    assert.equal(status.databaseAvailable, true)
    assert.equal(status.fts5, false)
    assert.equal(status.dbPath, null)
    assert.equal(status.counts.entries, 0)
    await assert.rejects(service.add({ content: 'x' }), /未启用/)
    await assert.rejects(service.update('m1', { content: 'y' }), /未启用/)
    await assert.rejects(service.delete('m1'), /未启用/)
    await assert.rejects(service.deleteAll(), /未启用/)
    await assert.rejects(service.deleteExports(), /未启用/)
    await assert.rejects(service.get('m1'), /未启用/)
    await assert.rejects(service.list(), /未启用/)
    await assert.rejects(service.search('x'), /未启用/)
    await assert.rejects(service.recall('x'), /未启用/)
    await assert.rejects(service.export({ to: path.join(root, 'out.json') }), /未启用/)
    assert.equal(existsSync(path.join(root, 'mem', 'memory.db')), false)
  } finally {
    await destroy(root)
  }
})

test('DatabaseSync 不可用时 enable 报出明确错误且不建文件', async () => {
  const root = await fixture()
  try {
    const service = new MemoryService({ sqliteFactory: () => ({}) })
    assert.equal(service.status().databaseAvailable, false)
    await assert.rejects(service.enable({ dbPath: path.join(root, 'mem', 'memory.db') }), /不可用/)
    assert.equal(existsSync(path.join(root, 'mem', 'memory.db')), false)
  } finally {
    await destroy(root)
  }
})

test('构造函数显式 enabled:true 即完成开启', async () => {
  const root = await fixture()
  try {
    const service = new MemoryService({
      enabled: true,
      dbPath: path.join(root, 'mem', 'memory.db')
    })
    try {
      const status = service.status()
      assert.equal(status.enabled, true)
      assert.equal(status.databaseAvailable, true)
      assert.equal(status.fts5, true)
      assert.equal(status.dbPath, path.join(root, 'mem', 'memory.db'))
      const entry = await service.add({ content: '构造即用' })
      assert.equal(entry.title, '')
      assert.equal(await (await service.get(entry.id)).content, '构造即用')
    } finally {
      service.disable()
    }
  } finally {
    await destroy(root)
  }
})

test('enable 创建本地数据库并报告 FTS5 与 SQLite 版本', async () => {
  const root = await fixture()
  try {
    const service = makeService(root)
    const status = await service.enable({ dbPath: path.join(root, 'mem', 'memory.db') })
    assert.equal(status.enabled, true)
    assert.equal(status.fts5, true)
    assert.equal(status.counts.entries, 0)
    assert.ok(status.sqliteVersion && status.sqliteVersion.length > 0)
    assert.equal(existsSync(path.join(root, 'mem', 'memory.db')), true)
    // 幂等：同一路径重复 enable 不报错。
    await service.enable({ dbPath: path.join(root, 'mem', 'memory.db') })
    service.disable()
  } finally {
    await destroy(root)
  }
})

test('CRUD：add/get/update/delete 与全部字段', async () => {
  const root = await fixture()
  try {
    const tick = clock()
    let seq = 0
    const service = makeService(root, { now: tick.now, idFactory: () => `m${++seq}` })
    await service.enable({ dbPath: path.join(root, 'mem', 'memory.db') })
    try {
      const entry = await service.add({
        kind: 'note',
        title: '标题',
        content: '内容',
        tags: ['a', 'b', 'a'],
        sourceSessionId: 'sess-1'
      })
      assert.equal(entry.id, 'm1')
      assert.equal(entry.kind, 'note')
      assert.equal(entry.title, '标题')
      assert.equal(entry.content, '内容')
      assert.deepEqual(entry.tags, ['a', 'b'])
      assert.equal(entry.sourceSessionId, 'sess-1')
      assert.equal(entry.sensitivity, 0)
      assert.equal(entry.recallPolicy, 'auto')
      assert.equal(entry.createdAt, '1970-01-01T00:00:02.000Z')
      assert.equal(entry.updatedAt, entry.createdAt)
      assert.equal(entry.lastUsedAt, null)

      const fetched = await service.get('m1')
      assert.deepEqual(fetched, entry)

      const updated = await service.update('m1', { content: '新内容', tags: ['c'] })
      assert.equal(updated.content, '新内容')
      assert.deepEqual(updated.tags, ['c'])
      assert.equal(updated.createdAt, '1970-01-01T00:00:02.000Z')
      assert.equal(updated.updatedAt, '1970-01-01T00:00:04.000Z')
      assert.ok(updated.updatedAt > updated.createdAt)

      assert.deepEqual((await service.delete('m1')), { deleted: true })
      assert.equal(await service.get('m1'), null)
      assert.deepEqual((await service.delete('m1')), { deleted: false })
      await assert.rejects(service.update('m1', { content: 'x' }), /不存在/)
    } finally {
      service.disable()
    }
  } finally {
    await destroy(root)
  }
})

test('输入校验：大小/标签/敏感级别/召回策略均有约束', async () => {
  const root = await fixture()
  try {
    const service = makeService(root)
    await service.enable({ dbPath: path.join(root, 'm.db'), maxEntryChars: 10, maxQueryLength: 4, recallMaxSensitivity: 2 })
    try {
      await assert.rejects(service.add({ content: '012345678901' }), /过长/)
      await assert.rejects(service.add({ content: 'x', title: '012345678901' }), /过长/)
      await assert.rejects(service.add({ content: '' }), /不能为空/)
      await assert.rejects(service.add({ content: '  ' }), /不能为空/)
      await assert.rejects(service.add({ content: 'x', kind: 'bad kind!' }), /kind/)
      await assert.rejects(service.add({ content: 'x', tags: ['a', 42] }), /字符串数组/)
      await assert.rejects(service.add({ content: 'x', tags: Array.from({ length: 21 }, (_, i) => `t${i}`) }), /数量过多/)
      await assert.rejects(service.add({ content: 'x', tags: ['A'.repeat(41)] }), /标签过长/)
      await assert.rejects(service.add({ content: 'x', sensitivity: 99 }), /敏感级别/)
      await assert.rejects(service.add({ content: 'x', recallPolicy: 'sometimes' }), /召回策略/)
      await assert.rejects(service.get('bad id!'), /无效/)
      await assert.rejects(service.search(''), /不能为空/)
      await assert.rejects(service.search(' '.repeat(10)), /不能为空/)
      await assert.rejects(service.search('x'.repeat(5)), /查询过长/)

      const custom = await service.add({ id: 'custom-1', content: 'x' })
      assert.equal(custom.id, 'custom-1')
      await assert.rejects(service.add({ id: 'custom-1', content: 'y' }), /已存在/)
      assert.ok(RECALL_POLICIES.includes('auto') && RECALL_POLICIES.includes('never'))
      assert.equal(SENSITIVITY_LEVELS.restricted, 3)
      assert.equal(DEFAULT_CONFIG.enabled, false)
    } finally {
      service.disable()
    }
  } finally {
    await destroy(root)
  }
})

test('maxEntries 总条数上限生效', async () => {
  const root = await fixture()
  try {
    const service = makeService(root)
    await service.enable({ dbPath: path.join(root, 'm.db'), maxEntries: 3 })
    try {
      for (let i = 1; i <= 3; i++) await service.add({ content: `条目${i}` })
      await assert.rejects(service.add({ content: '第四条' }), /上限/)
      assert.equal(service.status().counts.entries, 3)
    } finally {
      service.disable()
    }
  } finally {
    await destroy(root)
  }
})

test('FTS5 搜索优先命中并说明为何匹配', async () => {
  const root = await fixture()
  try {
    const service = makeService(root)
    await service.enable({ dbPath: path.join(root, 'm.db') })
    try {
      await service.add({ title: 'hello world', content: 'the quick brown fox', sourceSessionId: 's1' })
      await service.add({ title: 'unrelated', content: 'nothing here', sourceSessionId: 's2' })

      const byTitle = await service.search('world')
      assert.equal(byTitle.total, 1)
      assert.equal(byTitle.source, 'fts5')
      assert.equal(byTitle.fts5, true)
      assert.equal(byTitle.hits[0].id, (await service.list()).entries.find(e => e.title === 'hello world').id)
      assert.equal(byTitle.hits[0].source, 'fts5')
      assert.ok(byTitle.hits[0].matched.includes('title'))
      assert.ok(byTitle.hits[0].snippet.title.includes('world'))
      assert.equal(byTitle.hits[0].sourceSessionId, 's1')

      const byContent = await service.search('quick')
      assert.equal(byContent.total, 1)
      assert.ok(byContent.hits[0].matched.includes('content'))
      assert.ok(byContent.hits[0].snippet.content.includes('quick'))

      const none = await service.search('不存在词')
      assert.equal(none.total, 0)
    } finally {
      service.disable()
    }
  } finally {
    await destroy(root)
  }
})

test('中文子串经 LIKE 补充命中，不丢结果', async () => {
  const root = await fixture()
  try {
    const service = makeService(root)
    await service.enable({ dbPath: path.join(root, 'm.db') })
    try {
      await service.add({ title: '日常', content: '用户喜欢大熊猫和竹子' })
      const result = await service.search('熊猫')
      assert.equal(result.total, 1)
      assert.equal(result.fts5, true)
      assert.ok(result.source === 'fts5+like' || result.source === 'fts5')
      assert.ok(result.hits[0].matched.includes('content'))
      assert.ok(result.hits[0].content.includes('大熊猫'))
    } finally {
      service.disable()
    }
  } finally {
    await destroy(root)
  }
})

test('FTS5 不可用时安全回退 LIKE 扫描', async () => {
  const root = await fixture()
  try {
    const service = makeService(root)
    const status = await service.enable({ dbPath: path.join(root, 'm.db'), forceFts5: false })
    assert.equal(status.fts5, false)
    try {
      await service.add({ title: 'hello world', content: 'the quick brown fox' })
      const result = await service.search('world')
      assert.equal(result.source, 'like')
      assert.equal(result.fallbackReason, 'fts-unavailable')
      assert.equal(result.total, 1)
      assert.equal(result.hits[0].source, 'like')
      assert.ok(result.hits[0].matched.includes('title'))
    } finally {
      service.disable()
    }
  } finally {
    await destroy(root)
  }
})

test('FTS 查询语法不合法时回退 LIKE，不抛错', async () => {
  const root = await fixture()
  try {
    const service = makeService(root)
    await service.enable({ dbPath: path.join(root, 'm.db') })
    try {
      await service.add({ content: 'keep calm and carry on' })
      const clean = await service.search('calm')
      assert.equal(clean.total, 1)
      assert.equal(clean.source, 'fts5')

      const broken = await service.search('"unbalanced')
      assert.equal(broken.total, 0)
      assert.equal(broken.fallbackReason, 'fts-query-failed')
      assert.equal(broken.source, 'like')
    } finally {
      service.disable()
    }
  } finally {
    await destroy(root)
  }
})

test('搜索条数与查询长度受控，不整库返回', async () => {
  const root = await fixture()
  try {
    const service = makeService(root)
    await service.enable({ dbPath: path.join(root, 'm.db') })
    try {
      for (let i = 1; i <= 4; i++) await service.add({ content: `共同词 共享内容${i}` })
      const limited = await service.search('共同词', { maxResults: 2 })
      assert.equal(limited.total, 2)
      const all = await service.search('共同词')
      assert.equal(all.total, 4)
      const pages = await service.list({ page: 1, pageSize: 2 })
      assert.equal(pages.entries.length, 2)
      assert.equal(pages.total, 4)
      assert.equal(pages.pages, 2)
    } finally {
      service.disable()
    }
  } finally {
    await destroy(root)
  }
})

test('reject 模式：高风险内容拒绝保存且审计不含原文', async () => {
  const root = await fixture()
  try {
    const service = makeService(root)
    await service.enable({ dbPath: path.join(root, 'm.db') })
    try {
      await service.add({ content: '正常内容' })
      let caught = null
      try {
        await service.add({ content: 'password=sup3rSecret!' })
      } catch (error) {
        caught = error
      }
      assert.ok(caught, '应拒绝保存高风险内容')
      assert.match(caught.message, /高风险内容/)
      assert.equal(caught.code, 'HIGH_RISK_REJECTED')
      const firstId = (await service.list()).entries[0].id
      await assert.rejects(
        () => service.update(firstId, { content: '卡号 5555555555554444' }),
        /高风险内容/
      )
      assert.equal(service.status().counts.entries, 1)
      const serialized = JSON.stringify(service.audit())
      assert.ok(!serialized.includes('sup3rSecret'))
      assert.ok(!serialized.includes('5555555555554444'))
      assert.ok(serialized.includes('password'))
      const failed = service.audit().find(a => a.op === 'add' && a.ok === false)
      assert.ok(failed && failed.types.includes('password'))
    } finally {
      service.disable()
    }
  } finally {
    await destroy(root)
  }
})

test('redact 模式：先脱敏再保存，原文不入库', async () => {
  const root = await fixture()
  try {
    const service = makeService(root)
    await service.enable({ dbPath: path.join(root, 'm.db'), sensitivityMode: 'redact' })
    try {
      const entry = await service.add({ content: '登录密码是 Abc12345，验证码是 482913' })
      assert.ok(entry.content.includes('[REDACTED:password]'))
      assert.ok(entry.content.includes('[REDACTED:verification-code]'))
      assert.ok(!entry.content.includes('Abc12345'))
      assert.ok(!entry.content.includes('482913'))
      const stored = await service.get(entry.id)
      assert.ok(stored.content.includes('[REDACTED:password]'))
      const auditEntry = service.audit().find(a => a.op === 'add' && a.ok && a.id === entry.id)
      assert.ok(auditEntry.redacted === true)
      assert.ok(auditEntry.types.includes('password'))
      assert.ok(auditEntry.types.includes('verification-code'))
      assert.ok(!JSON.stringify(auditEntry).includes('Abc12345'))
    } finally {
      service.disable()
    }
  } finally {
    await destroy(root)
  }
})

test('永不自动召回与敏感级别上限策略', async () => {
  const root = await fixture()
  try {
    const service = makeService(root)
    await service.enable({ dbPath: path.join(root, 'm.db'), recallMaxSensitivity: 1 })
    try {
      const a = await service.add({ content: 'hello alpha', sensitivity: 0, recallPolicy: 'auto' })
      await service.add({ content: 'hello beta', sensitivity: 3, recallPolicy: 'auto' })
      const c = await service.add({ content: 'hello gamma', sensitivity: 0, recallPolicy: 'never' })
      assert.equal(a.lastUsedAt, null)
      assert.equal(c.lastUsedAt, null)

      const recalled = await service.recall('hello')
      assert.equal(recalled.total, 1)
      assert.equal(recalled.policy.neverRecalled, 2)
      assert.equal(recalled.hits[0].id, a.id)
      assert.ok(recalled.hits[0].lastUsedAt !== null)

      // 显式搜索不受自动召回策略限制。
      const explicit = await service.search('hello')
      assert.equal(explicit.total, 3)
      const explicitC = explicit.hits.find(h => h.id === c.id)
      assert.equal(explicitC.lastUsedAt, null)

      // 再次召回仍只返回合规条目，并刷新 lastUsedAt。
      const again = await service.recall('hello')
      assert.equal(again.total, 1)
      assert.equal(again.hits[0].id, a.id)
    } finally {
      service.disable()
    }
  } finally {
    await destroy(root)
  }
})

test('重启与停用后持久化：数据留在本地文件，重开可读', async () => {
  const root = await fixture()
  const dbPath = path.join(root, 'mem', 'memory.db')
  try {
    const first = makeService(root)
    await first.enable({ dbPath })
    await first.add({ content: '跨会话记忆内容', tags: ['persist'] })
    await first.disable()
    assert.equal(existsSync(dbPath), true)
    await assert.rejects(first.add({ content: '停用后不可写' }), /未启用/)

    const second = makeService(root)
    await second.enable({ dbPath })
    const entries = (await second.list()).entries
    assert.equal(entries.length, 1)
    assert.equal(entries[0].content, '跨会话记忆内容')
    assert.deepEqual(entries[0].tags, ['persist'])
    await second.enable({ dbPath })
    second.disable()
  } finally {
    await destroy(root)
  }
})

test('deleteAll 清空条目并保持后续可用', async () => {
  const root = await fixture()
  try {
    const service = makeService(root)
    await service.enable({ dbPath: path.join(root, 'm.db') })
    try {
      for (let i = 1; i <= 3; i++) await service.add({ content: `temp ${i} record` })
      const deleted = await service.deleteAll()
      assert.equal(deleted.deleted, 3)
      assert.equal(deleted.storageCompacted, true)
      assert.equal(deleted.secureDelete, true)
      assert.ok(deleted.auditCleared >= 4)
      assert.equal(service.audit().length, 0)
      assert.equal(service.status().secureDelete, true)
      assert.equal(service.status().counts.entries, 0)
      assert.equal((await service.search('record')).total, 0)
      await service.add({ content: '恢复后可用' })
      assert.equal((await service.list()).total, 1)
    } finally {
      service.disable()
    }
  } finally {
    await destroy(root)
  }
})

test('deleteAll 启用 secure_delete、截断 WAL 并从数据库文件移除正文痕迹', async () => {
  const root = await fixture()
  const dbPath = path.join(root, 'm.db')
  const marker = 'ERASE_ME_7f29c4e1_unique_plaintext_memory'
  try {
    const service = makeService(root)
    await service.enable({ dbPath })
    try {
      assert.equal(service.status().secureDelete, true)
      await service.add({ title: marker, content: `${marker} body body body` })
      await service.deleteAll()
      for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
        if (!existsSync(file)) continue
        const bytes = await readFile(file)
        assert.equal(bytes.includes(Buffer.from(marker)), false, `deleted plaintext remained in ${path.basename(file)}`)
      }
    } finally {
      service.disable()
    }
  } finally {
    await destroy(root)
  }
})

test('deleteExports only removes application-generated memory export copies', async () => {
  const root = await fixture()
  const exportsDir = path.join(root, 'exports')
  const managed = path.join(exportsDir, 'memory-export-2026-08-19T18-59-04-443Z.json')
  const unrelated = path.join(exportsDir, 'keep.json')
  try {
    const service = makeService(root)
    await service.enable({ dbPath: path.join(root, 'm.db'), exportsDir })
    try {
      await service.add({ content: 'export then delete copy' })
      await service.export({ to: managed })
      await writeFile(unrelated, 'keep')
      assert.deepEqual(await service.deleteExports(), { deletedExports: 1 })
      assert.equal(existsSync(managed), false)
      assert.equal(existsSync(unrelated), true)
    } finally {
      service.disable()
    }
  } finally {
    await destroy(root)
  }
})

test('导出：JSON 原子写出、限定目录、不含审计与秘密', async () => {
  const root = await fixture()
  const dbPath = path.join(root, 'mem', 'memory.db')
  try {
    const service = makeService(root)
    await service.enable({ dbPath, sensitivityMode: 'redact', exportsDir: root })
    try {
      const entry = await service.add({
        title: '备忘',
        content: '登录密码是 Abc12345，验证码是 482913',
        tags: ['重要']
      })
      const target = path.join(root, 'out', 'export.json')
      const result = await service.export({ to: target })
      assert.equal(result.count, 1)
      assert.equal(result.format, 'dsh-memory-export')
      assert.equal(existsSync(target), true)
      const payload = JSON.parse(await readFile(target, 'utf8'))
      assert.equal(payload.version, 1)
      assert.equal(payload.entries.length, 1)
      assert.equal(payload.entries[0].id, entry.id)
      assert.deepEqual(payload.entries[0].tags, ['重要'])
      assert.ok(payload.entries[0].content.includes('[REDACTED:password]'))
      const json = JSON.stringify(payload)
      assert.ok(!json.includes('Abc12345'))
      assert.ok(!json.includes('482913'))
      assert.ok(!json.includes('audit'))

      await assert.rejects(service.export({ to: path.join(root, '..', 'escape.json') }), /导出目录内/)
      await assert.rejects(service.export({ to: dbPath }), /数据库文件/)
      await assert.rejects(service.export({ to: path.join(root, 'x.sqlite') }), /数据库文件/)
      await assert.rejects(service.export({}), /目标文件路径/)
    } finally {
      service.disable()
    }
  } finally {
    await destroy(root)
  }
})

test('无导出目录约束时导出到任意本地路径，且不覆盖数据库', async () => {
  const root = await fixture()
  try {
    const service = makeService(root)
    await service.enable({ dbPath: path.join(root, 'm.db') })
    try {
      await service.add({ content: '可导出' })
      const outside = path.join(root, 'sibling.json')
      const result = await service.export({ to: outside })
      assert.equal(existsSync(result.file), true)
      const payload = JSON.parse(await readFile(outside, 'utf8'))
      assert.equal(payload.entries.length, 1)
    } finally {
      service.disable()
    }
  } finally {
    await destroy(root)
  }
})

test('SQL 注入形态输入被安全参数化处理', async () => {
  const root = await fixture()
  try {
    const service = makeService(root)
    await service.enable({ dbPath: path.join(root, 'm.db') })
    try {
      const attack = `x'); DROP TABLE entries;--`
      await service.add({ title: `o'Reilly "quoted"`, content: attack })
      assert.equal(service.status().counts.entries, 1)
      const row = await service.get((await service.list()).entries[0].id)
      assert.equal(row.content, attack)

      await service.add({ content: '折扣 50%_off 专属' })
      const hit = await service.search('50%_off')
      assert.equal(hit.total, 1)
      assert.ok(hit.hits[0].content.includes('50%_off'))
      // 库仍完整可用。
      assert.equal((await service.list()).total, 2)
    } finally {
      service.disable()
    }
  } finally {
    await destroy(root)
  }
})

test('enable 切换数据库路径：旧库安全关闭，新库独立', async () => {
  const root = await fixture()
  try {
    const service = makeService(root)
    await service.enable({ dbPath: path.join(root, 'mem-a', 'a.db') })
    await service.add({ content: 'A 库内容' })
    await service.enable({ dbPath: path.join(root, 'mem-b', 'b.db') })
    assert.equal(service.status().dbPath, path.join(root, 'mem-b', 'b.db'))
    await service.add({ content: 'B 库内容' })
    assert.equal((await service.list()).total, 1)
    service.disable()

    const recheck = makeService(root)
    await recheck.enable({ dbPath: path.join(root, 'mem-a', 'a.db') })
    assert.equal((await recheck.list()).total, 1)
    assert.equal((await recheck.list()).entries[0].content, 'A 库内容')
    recheck.disable()
  } finally {
    await destroy(root)
  }
})

test('auditLimit 限制审计记录数量', async () => {
  const root = await fixture()
  try {
    const service = makeService(root)
    await service.enable({ dbPath: path.join(root, 'm.db'), auditLimit: 5 })
    try {
      for (let i = 1; i <= 8; i++) await service.add({ content: `条目${i}` })
      assert.equal(service.status().auditCount, 5)
      // 审计仅保留元数据，不包含任何条目内容。
      assert.ok(!JSON.stringify(service.audit()).includes('条目1'))
    } finally {
      service.disable()
    }
  } finally {
    await destroy(root)
  }
})

test('sanitizeConfig 约束配置范围', () => {
  const config = sanitizeConfig({
    maxEntries: -5,
    maxEntryChars: 999999999,
    maxQueryLength: 0,
    sensitivityMode: 'whatever',
    recallMaxSensitivity: 9,
    auditLimit: -1
  })
  assert.equal(config.maxEntries, 1)
  assert.equal(config.maxEntryChars, 1000000)
  assert.equal(config.maxQueryLength, 1)
  assert.equal(config.sensitivityMode, 'reject')
  assert.equal(config.recallMaxSensitivity, 3)
  assert.equal(config.auditLimit, 0)
  assert.equal(config.enabled, false)
  assert.equal(sanitizeConfig({ sensitivityMode: 'redact' }).sensitivityMode, 'redact')
})