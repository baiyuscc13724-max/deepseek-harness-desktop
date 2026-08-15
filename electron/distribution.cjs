const STORE_COMPLIANCE_LINKS = Object.freeze({
  privacy: 'https://github.com/baiyuscc13724-max/deepseek-harness-desktop/blob/main/docs/PRIVACY.md',
  aiReport: 'https://github.com/baiyuscc13724-max/deepseek-harness-desktop/issues/new?template=ai-content-report.yml',
  pluginPolicy: 'https://github.com/baiyuscc13724-max/deepseek-harness-desktop/blob/main/docs/PLUGIN_CONTENT_POLICY.md'
})

function isStoreDistribution({ windowsStore = process.windowsStore, env = process.env } = {}) {
  return Boolean(windowsStore || env.HARNESS_DESKTOP_STORE_BUILD === '1')
}

function distributionInfo(options = {}) {
  const store = isStoreDistribution(options)
  return {
    channel: store ? 'microsoft-store' : 'direct',
    store,
    appUpdatesManagedByStore: store,
    nonCommercialContentAvailable: !store,
    desktopPetAvailable: !store,
    links: STORE_COMPLIANCE_LINKS
  }
}

module.exports = { STORE_COMPLIANCE_LINKS, distributionInfo, isStoreDistribution }
