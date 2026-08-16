const assert = require('node:assert/strict')
const { open, readdir, readFile, stat } = require('node:fs/promises')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const assetRoot = path.join(root, 'third_party', 'pgr-q')

async function walk(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await walk(full))
    else if (entry.isFile()) files.push(full)
  }
  return files
}

test('authorized Q-version character collection stays complete and GitHub-safe', async () => {
  const catalog = JSON.parse(await readFile(path.join(assetRoot, 'catalog.json'), 'utf8'))
  assert.equal(catalog.characters.length, 19)
  assert.equal(new Set(catalog.characters.map(character => character.id)).size, 19)

  for (const character of catalog.characters) {
    const directory = path.resolve(assetRoot, 'characters', character.sourceDirectory)
    const model = path.resolve(directory, character.sourceModel)
    assert.ok(directory.startsWith(path.join(assetRoot, 'characters') + path.sep))
    const modelStat = await stat(model)
    assert.ok(modelStat.size > 1024 * 1024)
    assert.ok(modelStat.size < 100 * 1024 * 1024)
    assert.ok(character.bones >= 24)
    assert.ok(character.animationClips >= 39)
    const handle = await open(model, 'r')
    try {
      const header = Buffer.alloc(23)
      await handle.read(header, 0, header.length, 0)
      assert.match(header.toString('ascii'), /^Kaydara FBX Binary/)
    } finally {
      await handle.close()
    }
  }

  const files = await walk(path.join(assetRoot, 'characters'))
  assert.equal(files.filter(file => path.extname(file).toLowerCase() === '.fbx').length, 19)
  assert.equal(files.filter(file => path.extname(file).toLowerCase() === '.png').length, 78)
})
