const RELATIONSHIP_LEVELS = Object.freeze([
  { at: 0, title: '初见' },
  { at: 4, title: '熟悉' },
  { at: 12, title: '默契' },
  { at: 28, title: '信赖' },
  { at: 55, title: '搭档' },
  { at: 95, title: '知心' },
  { at: 150, title: '并肩' },
  { at: 240, title: '长久相伴' }
])

const STYLE_VALUES = new Set(['calm', 'warm', 'playful'])
const QUALITY_LABELS = Object.freeze({ refined: '精炼 TOK', standard: '标准 TOK', fragments: 'TOK 碎片' })

function boundedInteger(value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Math.floor(Number(value) || 0)
  return Math.min(maximum, Math.max(minimum, number))
}

function relationshipFor(state = {}) {
  const companion = state.companion || {}
  const tasksCompleted = boundedInteger(state.lifetime?.tasksCompleted)
  const activeMinutes = boundedInteger(companion.activeMinutes)
  const points = boundedInteger(state.affection) + Math.floor(tasksCompleted / 3) + Math.floor(activeMinutes / 180)
  let index = 0
  for (let candidate = 1; candidate < RELATIONSHIP_LEVELS.length; candidate += 1) {
    if (points < RELATIONSHIP_LEVELS[candidate].at) break
    index = candidate
  }
  const current = RELATIONSHIP_LEVELS[index]
  const next = RELATIONSHIP_LEVELS[index + 1] || null
  const progress = next
    ? Math.round(((points - current.at) / Math.max(1, next.at - current.at)) * 100)
    : 100
  const interactions = companion.interactions || {}
  const favorite = Object.entries(interactions)
    .filter(([kind]) => ['tap', 'petting', 'play'].includes(kind))
    .sort((left, right) => Number(right[1] || 0) - Number(left[1] || 0))[0]
  return {
    level: index + 1,
    title: current.title,
    points,
    progress: Math.min(100, Math.max(0, progress)),
    nextAt: next?.at ?? null,
    taskStreak: boundedInteger(companion.taskStreak),
    bestTaskStreak: boundedInteger(companion.bestTaskStreak),
    favoriteInteraction: favorite && Number(favorite[1]) > 0 ? favorite[0] : null,
    daysTogether: boundedInteger(companion.daysTogether, companion.firstMetAt ? 1 : 0),
    sessionsTogether: boundedInteger(companion.sessionsTogether)
  }
}

function companionStyle(preferences = {}) {
  return STYLE_VALUES.has(preferences.companionStyle) ? preferences.companionStyle : 'warm'
}

function safeMessage(value) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 96)
}

function localHour(date) {
  return date instanceof Date && Number.isFinite(date.getTime()) ? date.getHours() : 12
}

function greetingFor(date) {
  const hour = localHour(date)
  if (hour < 6) return '夜深了'
  if (hour < 11) return '早上好'
  if (hour < 14) return '中午好'
  if (hour < 19) return '下午好'
  return '晚上好'
}

class PetCompanionEngine {
  constructor({ now = () => new Date(), random = Math.random } = {}) {
    this.now = now
    this.random = random
    this.sequence = 0
    this.lastCue = null
    this.lastCueAt = new Map()
  }

  pick(values) {
    const list = Array.isArray(values) ? values.filter(Boolean) : []
    if (!list.length) return ''
    const index = Math.min(list.length - 1, Math.max(0, Math.floor(this.random() * list.length)))
    return list[index]
  }

  emit(kind, context, { action = null, duration = 3200, cooldownMs = 0, critical = false } = {}) {
    const preferences = context.preferences || {}
    if (!critical && preferences.proactive === false) return null
    const date = this.now()
    const timestamp = date.getTime()
    const previous = this.lastCueAt.get(kind) || 0
    if (!critical && cooldownMs > 0 && timestamp - previous < cooldownMs) return null
    const message = safeMessage(context.message)
    if (!message) return null
    this.lastCueAt.set(kind, timestamp)
    this.lastCue = {
      id: `${kind}:${timestamp}:${++this.sequence}`,
      kind,
      message,
      action,
      duration: boundedInteger(duration, 1200, 8000),
      critical: Boolean(critical),
      at: date.toISOString()
    }
    return this.lastCue
  }

  awakening({ state = {}, preferences = {}, awayMinutes = 0 } = {}) {
    const style = companionStyle(preferences)
    const relationship = relationshipFor(state)
    const completed = boundedInteger(state.lifetime?.tasksCompleted)
    const awayHours = Math.floor(boundedInteger(awayMinutes) / 60)
    const greeting = greetingFor(this.now())
    const message = awayHours >= 20 && completed > 0
      ? {
          calm: `欢迎回来。我们已经一起完成 ${completed} 项任务。`,
          warm: `欢迎回来，我还记得我们一起完成过 ${completed} 项任务。`,
          playful: `女仆鲸重新报到！共同完成的 ${completed} 项任务我都记着呢。`
        }[style]
      : {
          calm: `${greeting}。女仆鲸已就位，需要处理任务时我会提醒。`,
          warm: `${greeting}，${relationship.title} Lv.${relationship.level} 的陪伴继续。`,
          playful: `${greeting}！女仆鲸巡航恢复，今天也一起把任务海域照看好。`
        }[style]
    return this.emit('awakening', { preferences, message }, { action: 'wave', duration: 3600, cooldownMs: 30_000 })
  }

  taskStarted({ state = {}, preferences = {}, running = 1 } = {}) {
    const style = companionStyle(preferences)
    const daily = state.companion?.daily || {}
    const streak = boundedInteger(state.companion?.taskStreak)
    let message
    if (running > 1) {
      message = {
        calm: `现在有 ${running} 项任务进行中；我会优先提醒需要你处理的那项。`,
        warm: `${running} 项任务同时开工啦，我会替你盯住需要处理的节点。`,
        playful: `多线巡航启动：${running} 项任务在跑，我来当你的瞭望员。`
      }[style]
    } else if (streak >= 3) {
      message = {
        calm: `任务开始，当前连续完成 ${streak} 项。`,
        warm: `连续完成 ${streak} 项的节奏还在，我继续陪你跑这一项。`,
        playful: `${streak} 连胜还在发光，这一项也一起拿下！`
      }[style]
    } else if (boundedInteger(daily.tasks) === 0) {
      message = {
        calm: '今天第一项任务已开始；需要你时我会提醒。',
        warm: '今天第一项开始啦，我会安静陪跑，需要你时再叫你。',
        playful: '今日首次出航！这项任务由女仆鲸陪你一起盯。'
      }[style]
    } else {
      message = {
        calm: '任务已开始；状态变化时我会提醒。',
        warm: '新任务开工，我会陪你守着进度。',
        playful: '新的任务浪头来了，出发！'
      }[style]
    }
    return this.emit('task-started', { preferences, message }, { duration: 3000, cooldownMs: 8_000 })
  }

  needsInput({ preferences = {} } = {}) {
    const style = companionStyle(preferences)
    const message = {
      calm: '这一步需要你决定。点我即可回到对应任务。',
      warm: '任务走到需要你决定的地方了，点我就能马上回去。',
      playful: '侦测到一个选择题！点我回任务现场拍板吧。'
    }[style]
    return this.emit('needs-input', { preferences, message }, { duration: 5200, critical: true })
  }

  inputResolved({ preferences = {} } = {}) {
    const style = companionStyle(preferences)
    const message = {
      calm: '已收到你的决定，任务继续。',
      warm: '收到啦，任务继续往前走，我接着陪你守着。',
      playful: '指令收到，航线恢复！'
    }[style]
    return this.emit('input-resolved', { preferences, message }, { duration: 2600, cooldownMs: 10_000 })
  }

  taskBlocked({ preferences = {}, cancelled = false } = {}) {
    const style = companionStyle(preferences)
    const message = cancelled
      ? {
          calm: '任务已停止；需要时可以重新开始。',
          warm: '这项任务先停在这里，准备好后我们再出发。',
          playful: '这次先返航，整理好补给再开一局。'
        }[style]
      : {
          calm: '任务遇到问题。点我回去查看错误。',
          warm: '任务卡住了，点我回去看看；我先替你守住现场。',
          playful: '前方触礁！点我返回现场，我们一起找突破口。'
        }[style]
    return this.emit(cancelled ? 'task-cancelled' : 'task-blocked', { preferences, message }, { duration: 5200, critical: !cancelled })
  }

  taskCompleted({ state = {}, preferences = {}, quantity = 0, quality = 'standard' } = {}) {
    const style = companionStyle(preferences)
    const daily = state.companion?.daily || {}
    const streak = boundedInteger(state.companion?.taskStreak)
    const today = boundedInteger(daily.completed)
    const tok = boundedInteger(quantity)
    const reward = tok > 0 ? `，获得 +${tok} ${QUALITY_LABELS[quality] || QUALITY_LABELS.standard}` : ''
    const streakText = streak >= 2 ? `，连续完成 ${streak} 项` : ''
    const message = {
      calm: `今天第 ${today} 项完成${streakText}${reward}。`,
      warm: `今天第 ${today} 项顺利完成${streakText}${reward}，辛苦啦！`,
      playful: `第 ${today} 项拿下${streakText}${reward}！庆功时间到。`
    }[style]
    return this.emit('task-completed', { preferences, message }, { duration: 5600, critical: true })
  }

  interaction({ state = {}, preferences = {}, kind = 'tap', previousLevel = null } = {}) {
    const style = companionStyle(preferences)
    const relationship = relationshipFor(state)
    const leveledUp = Number(previousLevel) > 0 && relationship.level > Number(previousLevel)
    let message
    if (leveledUp) {
      message = {
        calm: `陪伴关系提升为「${relationship.title}」Lv.${relationship.level}。`,
        warm: `我们的默契升级到「${relationship.title}」Lv.${relationship.level} 了。`,
        playful: `默契升级！「${relationship.title}」Lv.${relationship.level} 达成。`
      }[style]
    } else if (kind === 'petting') {
      message = {
        calm: `已记下这次互动，当前默契 Lv.${relationship.level}。`,
        warm: `好舒服，我会记得你喜欢这样陪我。默契 Lv.${relationship.level}。`,
        playful: `摸摸能量已充满！默契 Lv.${relationship.level}。`
      }[style]
    } else if (kind === 'play') {
      message = {
        calm: '互动已记录。',
        warm: '尾巴也有自己的小脾气哦。',
        playful: '抓到尾巴啦——反击！'
      }[style]
    } else {
      message = {
        calm: '我在。',
        warm: '我在呢，需要看任务就点菜单。',
        playful: '女仆鲸在线，随时听候差遣！'
      }[style]
    }
    return this.emit('interaction', { preferences, message }, { duration: 2800, cooldownMs: leveledUp ? 0 : 45_000 })
  }

  longRunning({ preferences = {}, elapsedMinutes = 0 } = {}) {
    const style = companionStyle(preferences)
    if (style === 'calm') return null
    const minutes = boundedInteger(elapsedMinutes)
    const message = style === 'playful'
      ? `这项任务已经航行 ${minutes} 分钟，我还在瞭望；需要你时会立刻提醒。`
      : `这项任务已经运行 ${minutes} 分钟，我还在替你盯着，需要你时会提醒。`
    return this.emit('long-running', { preferences, message }, { duration: 4200, cooldownMs: 20 * 60_000 })
  }
}

module.exports = {
  PetCompanionEngine,
  QUALITY_LABELS,
  RELATIONSHIP_LEVELS,
  companionStyle,
  relationshipFor,
  safeMessage
}
