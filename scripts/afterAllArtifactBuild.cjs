// electron-builder afterAllArtifactBuild hook.
// On macOS only: injects the one-click installer helper (build/macos-install.command)
// into every produced .dmg and macOS .zip, so users can install without touching
// Gatekeeper / quarantine ("app is damaged") themselves.
// Fail-soft: if injection fails, the build still succeeds (helper is an enhancement).
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HELPER_SRC = path.join(__dirname, '..', 'build', 'macos-install.command');
const HELPER_NAME = '安装.command';

function sh(cmd, args, opts) {
  execFileSync(cmd, args, Object.assign({ stdio: 'inherit' }, opts));
}

function injectIntoDmg(dmg) {
  const mnt = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-dmg-'));
  try {
    sh('hdiutil', ['attach', dmg, '-nobrowse', '-mountpoint', mnt]);
    fs.copyFileSync(HELPER_SRC, path.join(mnt, HELPER_NAME));
    fs.chmodSync(path.join(mnt, HELPER_NAME), 0o755);
  } finally {
    sh('hdiutil', ['detach', mnt, '-quiet'], { stdio: 'ignore' });
  }
}

function injectIntoZip(zip) {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-zip-'));
  fs.copyFileSync(HELPER_SRC, path.join(stage, HELPER_NAME));
  fs.chmodSync(path.join(stage, HELPER_NAME), 0o755);
  sh('zip', ['-ur', zip, HELPER_NAME], { cwd: stage });
}

async function afterAllArtifactBuild(buildResult) {
  if (process.platform !== 'darwin') {
    return buildResult;
  }
  if (!fs.existsSync(HELPER_SRC)) {
    console.warn('[install-helper] helper file missing, skipping:', HELPER_SRC);
    return buildResult;
  }
  for (const artifact of buildResult.artifactPaths) {
    try {
      if (artifact.endsWith('.dmg')) {
        injectIntoDmg(artifact);
        console.log('[install-helper] injected into', path.basename(artifact));
      } else if (artifact.endsWith('.zip') && artifact.includes('-mac-')) {
        injectIntoZip(artifact);
        console.log('[install-helper] injected into', path.basename(artifact));
      } else {
        console.log('[install-helper] skip', path.basename(artifact));
      }
    } catch (err) {
      console.warn('[install-helper] injection failed for', path.basename(artifact), ':', err.message);
    }
  }
  return buildResult;
}

module.exports = afterAllArtifactBuild;
module.exports.default = afterAllArtifactBuild;
