'use strict'

// electron-builder normally asks the detected package manager to print the
// production dependency tree. Some managed Windows build environments deny
// that nested package-manager process even though all dependencies are already
// installed. electron-builder ships a filesystem traversal collector for this
// exact fallback; force that supported collector for reproducible local builds.
const collectors = require('app-builder-lib/out/node-module-collector')
const { TraversalNodeModulesCollector } = require('app-builder-lib/out/node-module-collector/traversalNodeModulesCollector')

collectors.getCollectorByPackageManager = (_packageManager, rootDir, tempDirManager) => (
  new TraversalNodeModulesCollector(rootDir, tempDirManager)
)
