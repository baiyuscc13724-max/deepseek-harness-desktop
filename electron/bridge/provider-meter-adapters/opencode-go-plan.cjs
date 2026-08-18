function createOpenCodeGoPlanAdapter() {
  return {
    id: 'opencode-go-plan-v1',
    supports: provider => provider.id === 'opencode-go',
    async refresh() {
      return {
        status: 'auth-required',
        message: '当前 API key 只能调用模型；OpenCode Go 尚未提供仅凭该 key 查询套餐用量的公开接口。',
        action: { label: '查看官方用量', url: 'https://opencode.ai/auth' },
        meters: []
      }
    }
  }
}

module.exports = { createAdapter: createOpenCodeGoPlanAdapter, createOpenCodeGoPlanAdapter }
