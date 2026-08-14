const crossSpawn = require('cross-spawn')

function spawnCommand(command, args = [], options = {}) {
  return crossSpawn(command, args, options)
}

module.exports = { spawnCommand }
