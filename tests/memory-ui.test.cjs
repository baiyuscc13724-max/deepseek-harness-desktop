const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { readFile } = require('node:fs/promises')

const root = path.join(__dirname, '..')

test('desktop shell exposes low-profile automatic local memory with deletion controls', async () => {
  const [html, renderer, preload, main] = await Promise.all([
    readFile(path.join(root, 'renderer', 'index.html'), 'utf8'),
    readFile(path.join(root, 'renderer', 'memory-manager.js'), 'utf8'),
    readFile(path.join(root, 'electron', 'preload.cjs'), 'utf8'),
    readFile(path.join(root, 'electron', 'main.cjs'), 'utf8')
  ])

  assert.match(html, /id="memoryQuickButton" class="memory-quick-button hidden"/u)
  assert.match(html, /id="memoryOverlay"/u)
  assert.match(html, /完全本地、后台低干扰/u)
  assert.match(html, /密码、令牌、Cookie、银行卡和验证码不会保存/u)
  assert.match(html, /id="memoryAutoCapture"/u)
  assert.match(html, /id="memoryEnableToggle"[^>]*disabled>正在读取…<\/button>/u)
  assert.match(html, /id="memoryDeleteAllConfirm"/u)
  assert.match(html, /id="memoryDeleteExports"/u)
  assert.match(html, /安全擦除数据库中的全部本地记忆/u)
  assert.match(html, /memory-manager\.js/u)

  assert.match(renderer, /setMemoryEnabled/u)
  assert.match(renderer, /searchMemories/u)
  assert.match(renderer, /autoCapture: autoCapture\.checked/u)
  assert.match(renderer, /enableToggle\.textContent = enabled \? '关闭本地记忆' : '开启本地记忆'/u)
  assert.match(renderer, /enableToggle\.disabled = false/u)
  assert.match(renderer, /onOpenDataManager/u)
  assert.match(renderer, /deleteAllMemories\(\{ confirmed: true, deleteExports: deleteExports\.checked \}\)/u)
  assert.match(renderer, /已安全擦除/u)
  assert.doesNotMatch(renderer, /node:sqlite|document\.cookie|localStorage/u)

  for (const channel of ['memory:status', 'memory:setEnabled', 'memory:setPreferences', 'memory:add', 'memory:search', 'memory:deleteAll']) {
    assert.ok(preload.includes(channel), `preload missing ${channel}`)
    assert.ok(main.includes(channel), `main missing ${channel}`)
  }
  assert.match(main, /assertDesktopShellSender\(event\)/u)
  assert.match(main, /request\?\.confirmed !== true/u)
  assert.match(main, /MemoryService/u)
})

test('memory manager exposes review lifecycle controls on a backward-compatible contract', async () => {
  const [html, renderer, css] = await Promise.all([
    readFile(path.join(root, 'renderer', 'index.html'), 'utf8'),
    readFile(path.join(root, 'renderer', 'memory-manager.js'), 'utf8'),
    readFile(path.join(root, 'renderer', 'styles.css'), 'utf8')
  ])

  // 状态/作用域筛选控件：候选、有效、过期、替代、冲突、停用
  assert.match(html, /id="memoryStateFilter"/u)
  assert.match(html, /id="memoryScopeFilter"/u)
  for (const value of ['candidate', 'active', 'stale', 'superseded', 'conflict', 'archived']) {
    assert.match(html, new RegExp(`<option value="${value}">`, 'u'), `html missing state option ${value}`)
  }
  assert.match(html, /role="group" aria-label="记忆审核筛选"/u)

  // 生命周期写入契约：统一经 api.updateMemory 的 status/recallPolicy/编辑纠错 patch
  assert.match(renderer, /const STATUS_PATCH_KEY = 'status'/u)
  assert.match(renderer, /\{ \[STATUS_PATCH_KEY\]: target \}/u)
  assert.match(renderer, /setStatus\(entry\.id, status, MEMORY_STATUS\.ACTIVE\)/u)
  assert.match(renderer, /setStatus\(entry\.id, status, MEMORY_STATUS\.ARCHIVED\)/u)
  assert.match(renderer, /setRecallPolicy\(entry\.id, 'never'\)/u)
  assert.match(renderer, /setRecallPolicy\(entry\.id, 'auto'\)/u)
  assert.match(renderer, /api\.updateMemory\(id, \{ recallPolicy: policy \}\)/u)
  assert.match(renderer, /api\.updateMemory\(entry\.id, \{\s*title: nextTitle,\s*content: nextContent,\s*tags:/u)

  // 向后兼容读取：v1 无生命周期字段时回退 active；新字段一律可选
  assert.match(renderer, /entry\.status \?\? entry\.lifecycle \?\? entry\.lifecycleStatus \?\? entry\.state/u)
  assert.match(renderer, /MEMORY_STATUS_VALUES\.has\(value\) \? value : MEMORY_STATUS\.ACTIVE/u)
  assert.match(renderer, /entry\.scopeType/u)
  assert.match(renderer, /entry\.scopeRef/u)
  assert.match(renderer, /entry\.sourceType/u)
  assert.match(renderer, /entry\.sourceRef/u)
  assert.match(renderer, /entry\.revision/u)
  assert.match(renderer, /entry\.verifiedAt/u)
  assert.match(renderer, /entry\.expiresAt/u)
  assert.match(renderer, /entry\.pinned === true/u)
  assert.match(renderer, /entry\.supersedesId/u)
  assert.match(renderer, /counts\.candidates/u)
  assert.match(renderer, /\['stale', '过期'\]/u)

  // 列表过滤：透传 status/scopeType 给后端 + 客户端兜底过滤；有界分页
  assert.match(renderer, /options\.status = activeStatus/u)
  assert.match(renderer, /options\.scopeType = activeScope/u)
  assert.match(renderer, /statusOf\(entry\) === activeStatus/u)
  assert.match(renderer, /api\.listMemories\(\{ \.\.\.options, page \}\)/u)
  assert.match(renderer, /MAX_LOAD_ENTRIES/u)

  // 编辑纠错与可访问性
  assert.match(renderer, /aria-label', '编辑记忆纠错'/u)
  assert.match(renderer, /form\.addEventListener\('submit'/u)

  // 保留删除/导出与默认私有保证
  assert.match(renderer, /api\.deleteMemory\(id\)/u)
  assert.match(renderer, /api\.exportMemories\(\)/u)
  assert.match(renderer, /deleteAllMemories\(\{ confirmed: true, deleteExports: deleteExports\.checked \}\)/u)
  assert.doesNotMatch(renderer, /node:sqlite|document\.cookie|localStorage|rm\(|unlink\(|rmdir\(/u)

  // 审核界面样式：工具栏、徽章、编辑表单、候选高亮
  assert.match(css, /\.memory-review-card/u)
  assert.match(css, /\.memory-review-toolbar/u)
  assert.match(css, /\.memory-badge\.is-candidate/u)
  assert.match(css, /\.memory-badge\.is-stale/u)
  assert.match(css, /\.memory-badge\.is-archived/u)
  assert.match(css, /\.memory-edit-form/u)
  assert.match(css, /\.memory-result\.is-candidate/u)
  assert.match(css, /\.memory-result-actions button\[data-action="approve"\]/u)
})
