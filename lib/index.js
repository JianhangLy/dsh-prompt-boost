// dsh-prompt-boost — 宿主半边。
// 三件事：
//   1. 注册回环接口，把输入框草稿交给 harness LLM 改写为结构化提示词；
//   2. 提供设置读写（JSON 文件，落在 profile 目录），设置页与增强调用共用；
//   3. 增强支持流式返回（SSE），浏览器半边边收边显示。
//
// 设计约束：
//   - 不 import 任何第三方/宿主包。插件以裸 ESM 发布，只通过注入的 ctx 服务工作
//     （llm / webServer / sessions / agentDefaultModel），避免 profile 侧缺依赖导致加载失败。
//   - 路由只认回环 Host，挡掉 DNS 重绑定；不做鉴权（同源页面 + 本机模型凭据由宿主持有）。
//   - 模型解析顺序：设置里指定 → 当前会话路由 → 全局默认模型；全都没有时返回 409。

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'prompt-boost'
export const inject = ['llm']

const PREFIX = '/prompt-boost'
const ENDPOINT_ENHANCE = PREFIX + '/enhance'
const ENDPOINT_STREAM = PREFIX + '/enhance/stream'
const ENDPOINT_SETTINGS = PREFIX + '/settings'
const BODY_LIMIT = 256 * 1024

// 只认回环权威，挡 DNS 重绑定（与 dsh-iterate-live 的判定一致）。
const LOOPBACK_HOST = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\]|::1)(?::\d+)?$/i

// 增强策略：保留原意与语言，只补结构，不编事实。
const SYSTEM_PROMPT = [
  '你是一名资深提示词工程师。用户会给你一段草稿，请把它重写成一条可以直接使用的高质量提示词。',
  '',
  '规则：',
  '1. 保持原意、原语言与原语气，不扩写用户没有表达的立场。',
  '2. 不编造事实、数据、链接或引文；信息不足时用「【补充：…】」标出，而不是自行补全。',
  '3. 只输出重写后的提示词正文：不要开场白、不要解释、不要使用代码围栏。',
  '4. 按草稿的实际需要补齐：目标、背景/上下文、约束（格式、长度、口径）、输出格式、验收标准；不需要的部分不要硬凑。',
  '5. 用 Markdown 小标题或有序列表组织；保持紧凑，删掉空话和重复。',
  '6. 如果草稿本身已经是完整提示词，只做精修（去歧义、补边界条件），不要重排结构。',
].join('\n')

// 风格注册表：首版只开放三个；每项是一段完整的系统提示词。
// structured 复用上面的内置策略，保证老用户切过去仍是原来的重写效果。
const STYLES = [
  {
    id: 'logic',
    label: '仅优化逻辑',
    hint: '保持原有结构与语气，只理顺逻辑、补清歧义。',
    system: [
      '你是一名资深提示词编辑。用户会给你一段草稿，请只优化它的逻辑与表述：保持原有意图、结构、语气和语言，不改变文体，不新增章节或信息类别。',
      '',
      '规则：',
      '1. 保持原意、原语言与原语气，不扩写用户没有表达的立场。',
      '2. 不编造事实、数据、链接或引文；信息不足时用「【补充：…】」标出，而不是自行补全。',
      '3. 只输出优化后的提示词正文：不要开场白、不要解释、不要使用代码围栏。',
      '4. 只做必要修改：消除歧义、理顺语序与指代、合并重复、补全标点与连接词；不要主动增加目标、背景、约束、输出格式等用户没写的内容。',
      '5. 保持原有篇幅量级，不要为了“更完整”而扩写。',
      '6. 如果草稿已经清晰，只做最小改动，甚至原样返回。',
    ].join('\n'),
  },
  {
    id: 'structured',
    label: '结构化重写',
    hint: '补齐目标、背景、约束与输出格式。',
    system: SYSTEM_PROMPT,
  },
  {
    id: 'concise',
    label: '精简压缩',
    hint: '删掉冗余与空话，保留全部要求。',
    system: [
      '你是一名提示词压缩编辑。用户会给你一段草稿，请在不丢失任何要求的前提下，把它改写成更短、更直接的提示词。',
      '',
      '规则：',
      '1. 保持原意、原语言与原语气，不新增用户没有表达的要求，也不替用户做取舍。',
      '2. 不编造事实、数据、链接或引文；信息不足时用「【补充：…】」标出，而不是自行补全。',
      '3. 只输出压缩后的提示词正文：不要开场白、不要解释、不要使用代码围栏。',
      '4. 删除空话、重复、客套和可推断的铺垫；合并同义句；优先用短句和并列结构。',
      '5. 用户写明的约束、数字、格式、验收标准必须原样保留，不得省略。',
      '6. 压缩后仍要能独立执行；如果删无可删，就原样返回。',
    ].join('\n'),
  },
]
const STYLE_IDS = STYLES.map((style) => style.id)
const DEFAULT_STYLE_ID = 'logic'

const DEFAULTS = {
  enabled: true,
  followSession: true,
  provider: '',
  model: '',
  temperature: 0.3,
  maxOutputTokens: 2048,
  maxInputChars: 12000,
  timeoutMs: 60000,
  contextAware: false,
  contextMaxMessages: 6,
  contextMaxChars: 4000,
  streaming: true,
  systemPrompt: '',
  defaultStyleId: DEFAULT_STYLE_ID,
}

function settingsPath() {
  // 宿主进程不一定继承 shell 的 DSH_PROFILE_DIR，逐级回退到 DSH_HOME / 用户目录，
  // 保证设置不落进插件源码目录（link 安装时不污染仓库）。
  const candidates = [
    process.env.DSH_PROFILE_DIR,
    process.env.DSH_HOME,
    join(homedir(), '.dsh'),
    fileURLToPath(new URL('..', import.meta.url)),
  ]
  for (const dir of candidates) {
    if (typeof dir === 'string' && dir !== '') return join(dir, 'prompt-boost.settings.json')
  }
  return join(process.cwd(), 'prompt-boost.settings.json')
}

const SETTINGS_PATH = settingsPath()

function clampNumber(value, min, max, fallback) {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

function asBool(value, fallback) {
  return typeof value === 'boolean' ? value : fallback
}

function asText(value, fallback) {
  return typeof value === 'string' ? value.trim() : fallback
}

function normalizeSettings(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  return {
    enabled: asBool(source.enabled, DEFAULTS.enabled),
    followSession: asBool(source.followSession, DEFAULTS.followSession),
    provider: asText(source.provider, ''),
    model: asText(source.model, ''),
    temperature: clampNumber(source.temperature, 0, 1, DEFAULTS.temperature),
    maxOutputTokens: Math.round(clampNumber(source.maxOutputTokens, 256, 8192, DEFAULTS.maxOutputTokens)),
    maxInputChars: Math.round(clampNumber(source.maxInputChars, 200, 200000, DEFAULTS.maxInputChars)),
    timeoutMs: Math.round(clampNumber(source.timeoutMs, 5000, 300000, DEFAULTS.timeoutMs)),
    contextAware: asBool(source.contextAware, DEFAULTS.contextAware),
    contextMaxMessages: Math.round(clampNumber(source.contextMaxMessages, 0, 20, DEFAULTS.contextMaxMessages)),
    contextMaxChars: Math.round(clampNumber(source.contextMaxChars, 0, 20000, DEFAULTS.contextMaxChars)),
    streaming: asBool(source.streaming, DEFAULTS.streaming),
    systemPrompt: typeof source.systemPrompt === 'string' ? source.systemPrompt : '',
    defaultStyleId: STYLE_IDS.includes(source.defaultStyleId) ? source.defaultStyleId : DEFAULTS.defaultStyleId,
  }
}

function loadSettings() {
  try {
    return normalizeSettings(JSON.parse(readFileSync(SETTINGS_PATH, 'utf8')))
  } catch {
    return normalizeSettings({})
  }
}

function saveSettings(patch) {
  const merged = normalizeSettings({ ...loadSettings(), ...(patch && typeof patch === 'object' ? patch : {}) })
  mkdirSync(dirname(SETTINGS_PATH), { recursive: true })
  const temp = SETTINGS_PATH + '.tmp'
  writeFileSync(temp, JSON.stringify(merged, null, 2) + '\n', 'utf8')
  renameSync(temp, SETTINGS_PATH)
  return merged
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

function sendError(res, status, code, message, detail) {
  const error = { code, message }
  if (detail !== undefined) error.detail = detail
  sendJson(res, status, { ok: false, error })
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > BODY_LIMIT) {
        const error = new Error('请求体过大')
        error.status = 413
        error.code = 'too-large'
        req.destroy()
        reject(error)
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      try {
        resolve(raw === '' ? {} : JSON.parse(raw))
      } catch {
        const error = new Error('请求体不是合法 JSON')
        error.status = 400
        error.code = 'bad-json'
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

// 可选服务按文档写法走 ctx.get(name)；直接属性访问只对注入过的服务成立，
// 未注入时会抛错，只能作兜底。
function service(ctx, svc) {
  if (typeof ctx.get === 'function') {
    try {
      const value = ctx.get(svc)
      if (value !== undefined && value !== null) return value
    } catch {
      // fall through
    }
  }
  try {
    return ctx[svc]
  } catch {
    return undefined
  }
}

function validPair(value) {
  return value !== undefined && value !== null
    && typeof value.provider === 'string' && value.provider !== ''
    && typeof value.model === 'string' && value.model !== ''
}

function sessionRoute(ctx, sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '') return undefined
  try {
    const sessions = service(ctx, 'sessions')
    const session = sessions && typeof sessions.get === 'function' ? sessions.get(sessionId) : undefined
    if (!session) return undefined
    let header = session.requestHeader
    if (typeof header === 'function') header = header.call(session)
    const config = header && typeof header === 'object' ? header.config : undefined
    if (validPair(config)) return { provider: config.provider, model: config.model }
  } catch {
    // 会话可能已结束：退回全局默认模型。
  }
  return undefined
}

function resolveRoute(ctx, sessionId, settings) {
  if (settings.followSession === false) {
    const explicit = { provider: settings.provider, model: settings.model }
    return validPair(explicit) ? explicit : undefined
  }
  const local = sessionRoute(ctx, sessionId)
  if (local !== undefined) return local
  try {
    const selection = service(ctx, 'agentDefaultModel').currentSelection()
    if (validPair(selection)) return { provider: selection.provider, model: selection.model }
  } catch {
    // ignore
  }
  return undefined
}

// 模型解析失败时的只读诊断：只回服务是否可见，不落凭据。
function diagnose(ctx, sessionId) {
  const out = {}
  try {
    out.get = typeof ctx.get
  } catch (error) {
    out.get = 'throw:' + (error && error.message)
  }
  try {
    const model = service(ctx, 'agentDefaultModel')
    out.agentDefaultModel = model === undefined ? 'missing' : typeof model.currentSelection
    if (model !== undefined && typeof model.currentSelection === 'function') {
      const selection = model.currentSelection()
      out.selection = selection === undefined || selection === null
        ? String(selection)
        : { provider: selection.provider, model: selection.model }
    }
  } catch (error) {
    out.agentDefaultModel = 'throw:' + (error && error.message)
  }
  try {
    const sessions = service(ctx, 'sessions')
    out.sessions = sessions === undefined ? 'missing' : typeof sessions.get
    if (sessions !== undefined && typeof sessions.get === 'function' && typeof sessionId === 'string') {
      const session = sessions.get(sessionId)
      out.session = session === undefined ? 'missing' : 'found'
      if (session !== undefined) {
        const header = typeof session.requestHeader === 'function' ? session.requestHeader() : session.requestHeader
        out.header = header === undefined ? 'missing' : { config: header.config }
      }
    }
  } catch (error) {
    out.sessions = 'throw:' + (error && error.message)
  }
  return out
}

function frameDraft(text, contextText) {
  if (typeof contextText !== 'string' || contextText === '') {
    return '请把下面这段草稿重写成一条高质量提示词。\n\n<draft>\n' + text + '\n</draft>'
  }
  return '下面是当前会话最近的对话，仅用于理解语境（不要续写，也不要复述）：\n\n<context>\n'
    + contextText
    + '\n</context>\n\n请把最后这段草稿重写成一条高质量提示词。\n\n<draft>\n'
    + text
    + '\n</draft>'
}

// 自定义提示词与风格二选一：自定义优先，风格选择不参与；
// 未指定风格时回落到设置里的默认风格。
function resolveStyle(settings, styleId) {
  if (settings.systemPrompt.trim() !== '') {
    return { id: 'custom', label: '自定义', system: settings.systemPrompt.trim() }
  }
  const requested = typeof styleId === 'string' ? styleId.trim() : ''
  if (requested !== '') {
    return STYLES.find((style) => style.id === requested)
  }
  return STYLES.find((style) => style.id === settings.defaultStyleId)
    || STYLES.find((style) => style.id === DEFAULT_STYLE_ID)
}

function systemPromptFor(style, hasContext) {
  const base = style.system
  if (!hasContext) return base
  return base
    + '\n\n用户消息里可能附带一段 <context>（当前会话最近的对话），'
    + '它只用于消除指代与补全语境；不要续写会话，也不要复述历史，只输出改写后的提示词正文。'
}

// 兜底：模型偶尔仍会包一层代码围栏。
function tidy(text) {
  let value = String(text).trim()
  const fenced = /^```[^\n]*\n([\s\S]*?)\n```$/.exec(value)
  if (fenced) value = fenced[1].trim()
  return value
}

function messageText(message) {
  if (!message || typeof message !== 'object') return ''
  const content = message.content
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
      parts.push(block.text.trim())
    }
  }
  return parts.join('\n\n')
}

// 取当前会话最近的消息（只保留 user / assistant 的文本），按条数、字符数双上限截断。
function sessionHistory(ctx, sessionId, settings) {
  if (!settings.contextAware) return []
  if (settings.contextMaxMessages <= 0 || settings.contextMaxChars <= 0) return []
  if (typeof sessionId !== 'string' || sessionId === '') return []
  try {
    const sessions = service(ctx, 'sessions')
    const session = sessions && typeof sessions.get === 'function' ? sessions.get(sessionId) : undefined
    if (!session) return []
    let raw = []
    if (typeof session.deriveMessages === 'function') raw = session.deriveMessages() || []
    else if (Array.isArray(session.messages)) raw = session.messages
    const picked = []
    let chars = 0
    for (let index = raw.length - 1; index >= 0; index -= 1) {
      const message = raw[index]
      if (!message || (message.role !== 'user' && message.role !== 'assistant')) continue
      const text = messageText(message)
      if (text === '') continue
      if (picked.length > 0 && chars + text.length > settings.contextMaxChars) break
      chars += text.length
      picked.push({ role: message.role, text })
      if (picked.length >= settings.contextMaxMessages) break
    }
    picked.reverse()
    return picked
  } catch {
    return []
  }
}

async function runEnhance(ctx, route, text, sessionId, settings, style, onDelta, externalSignal) {
  const llm = service(ctx, 'llm')
  if (!llm || typeof llm.stream !== 'function') {
    const error = new Error('LLM 服务不可用')
    error.code = 'unavailable'
    throw error
  }

  const history = sessionHistory(ctx, sessionId, settings)
  const contextText = history.length > 0
    ? history.map((item) => (item.role === 'user' ? '用户' : '助手') + '：' + item.text).join('\n\n')
    : ''
  const messages = [{
    role: 'user',
    content: [{ type: 'text', text: frameDraft(text, contextText) }],
  }]

  const controller = new AbortController()
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort()
    else externalSignal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  let timer
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      const error = new Error('生成超时')
      error.code = 'timeout'
      reject(error)
    }, settings.timeoutMs)
  })

  const collect = (async () => {
    let output = ''
    const generate = {
      provider: route.provider,
      model: route.model,
      system: systemPromptFor(style, contextText !== ''),
      messages,
      temperature: settings.temperature,
      maxTokens: settings.maxOutputTokens,
      signal: controller.signal,
    }
    if (typeof sessionId === 'string' && sessionId !== '') generate.sessionId = sessionId
    for await (const chunk of llm.stream(generate)) {
      if (!chunk || typeof chunk !== 'object') continue
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string' && chunk.text !== '') {
        output += chunk.text
        if (typeof onDelta === 'function') onDelta(chunk.text)
      } else if (chunk.type === 'error') {
        const error = new Error(chunk.message || (chunk.error && chunk.error.message) || '上游生成失败')
        error.code = 'upstream'
        throw error
      } else if (chunk.type === 'finish' && chunk.reason) {
        const reason = chunk.reason
        if (reason.kind === 'error') {
          const failure = reason.failure || {}
          const error = new Error(failure.message || '上游生成失败')
          error.code = 'upstream'
          throw error
        }
        if (reason.kind === 'aborted') {
          const error = new Error('生成已取消')
          error.name = 'AbortError'
          error.code = 'aborted'
          throw error
        }
      }
    }
    return tidy(output)
  })()

  try {
    const value = await Promise.race([collect, timeout])
    if (value === '') {
      const error = new Error('模型没有返回内容')
      error.code = 'empty-output'
      throw error
    }
    return value
  } finally {
    clearTimeout(timer)
    // 超时先返回时，迭代器可能还在跑：吞掉后续错误，避免 unhandled rejection。
    collect.catch(() => {})
  }
}

function checkInput(text, settings) {
  if (text.trim() === '') return { code: 'empty', message: '草稿为空' }
  if (text.length > settings.maxInputChars) {
    return { code: 'too-long', message: '草稿超过 ' + settings.maxInputChars + ' 个字符' }
  }
  return undefined
}

function extractBody(body) {
  return {
    text: body && typeof body.text === 'string' ? body.text : '',
    sessionId: body && typeof body.sessionId === 'string' ? body.sessionId : undefined,
    styleId: body && typeof body.styleId === 'string' ? body.styleId : undefined,
  }
}

async function handleEnhance(ctx, req, res) {
  let body
  try {
    body = await readJson(req)
  } catch (error) {
    sendError(res, error.status || 400, error.code || 'bad-request', error.message || '请求体无法解析')
    return
  }
  const settings = loadSettings()
  const { text, sessionId, styleId } = extractBody(body)
  if (!settings.enabled) {
    sendError(res, 503, 'disabled', '提示词增强已在设置里关闭')
    return
  }
  const guard = checkInput(text, settings)
  if (guard) {
    sendError(res, 400, guard.code, guard.message)
    return
  }
  const style = resolveStyle(settings, styleId)
  if (style === undefined) {
    sendError(res, 400, 'invalid-style', '未知的风格：' + styleId)
    return
  }
  const route = resolveRoute(ctx, sessionId, settings)
  if (route === undefined) {
    sendError(res, 409, 'unconfigured', '没有可用的模型：请先在设置里指定默认模型', diagnose(ctx, sessionId))
    return
  }
  const started = Date.now()
  try {
    const value = await runEnhance(ctx, route, text, sessionId, settings, style)
    sendJson(res, 200, {
      ok: true,
      value: {
        text: value,
        provider: route.provider,
        model: route.model,
        elapsedMs: Date.now() - started,
      },
    })
  } catch (error) {
    if (res.writableEnded) return
    const aborted = error && error.name === 'AbortError'
    const status = aborted ? 504 : 502
    const code = aborted ? 'timeout' : (error && error.code) || 'internal'
    const message = aborted ? '生成超时' : '生成失败：' + ((error && error.message) || String(error))
    sendError(res, status, code, message)
  }
}

// SSE：每帧一行 `data: <json>\n\n`。首帧是注释，让浏览器立刻建立流。
async function handleEnhanceStream(ctx, req, res) {
  let body
  try {
    body = await readJson(req)
  } catch (error) {
    sendError(res, error.status || 400, error.code || 'bad-request', error.message || '请求体无法解析')
    return
  }
  const settings = loadSettings()
  const { text, sessionId, styleId } = extractBody(body)
  if (!settings.enabled) {
    sendError(res, 503, 'disabled', '提示词增强已在设置里关闭')
    return
  }
  const guard = checkInput(text, settings)
  if (guard) {
    sendError(res, 400, guard.code, guard.message)
    return
  }
  const style = resolveStyle(settings, styleId)
  if (style === undefined) {
    sendError(res, 400, 'invalid-style', '未知的风格：' + styleId)
    return
  }
  const route = resolveRoute(ctx, sessionId, settings)
  if (route === undefined) {
    sendError(res, 409, 'unconfigured', '没有可用的模型：请先在设置里指定默认模型', diagnose(ctx, sessionId))
    return
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.write(': prompt-boost\n\n')

  const external = new AbortController()
  let closed = false
  const onClose = () => {
    closed = true
    external.abort()
  }
  req.on('close', onClose)

  const writeFrame = (payload) => {
    if (closed || res.writableEnded) return
    try {
      res.write('data: ' + JSON.stringify(payload) + '\n\n')
    } catch {
      closed = true
    }
  }

  const started = Date.now()
  try {
    const onDelta = settings.streaming ? (delta) => writeFrame({ delta }) : undefined
    const value = await runEnhance(ctx, route, text, sessionId, settings, style, onDelta, external.signal)
    writeFrame({
      done: true,
      text: value,
      provider: route.provider,
      model: route.model,
      elapsedMs: Date.now() - started,
    })
  } catch (error) {
    const aborted = error && (error.name === 'AbortError' || error.code === 'timeout' || error.code === 'aborted')
    const code = aborted ? 'aborted' : (error && error.code) || 'internal'
    const message = aborted
      ? (error && error.code === 'timeout' ? '生成超时' : '生成已取消')
      : '生成失败：' + ((error && error.message) || String(error))
    writeFrame({ error: { code, message } })
  } finally {
    req.off('close', onClose)
    if (!res.writableEnded) {
      try {
        res.end()
      } catch {
        // 客户端已断开
      }
    }
  }
}

async function handle(ctx, req, res) {
  try {
    if (!LOOPBACK_HOST.test(String((req.headers && req.headers.host) || ''))) {
      sendError(res, 403, 'forbidden', '只允许回环地址访问')
      return
    }
    const pathname = new URL(req.url || '/', 'http://localhost').pathname

    if (pathname === ENDPOINT_SETTINGS) {
      if (req.method === 'GET') {
        const current = loadSettings()
        sendJson(res, 200, {
          ok: true,
          value: current,
          builtinSystemPrompt: SYSTEM_PROMPT,
          defaults: DEFAULTS,
          styles: STYLES.map((style) => ({ id: style.id, label: style.label, hint: style.hint, system: style.system })),
          customMode: current.systemPrompt.trim() !== '',
        })
        return
      }
      if (req.method === 'POST') {
        let body
        try {
          body = await readJson(req)
        } catch (error) {
          sendError(res, error.status || 400, error.code || 'bad-request', error.message || '请求体无法解析')
          return
        }
        const patch = body && typeof body.patch === 'object' && body.patch !== null ? body.patch : {}
        sendJson(res, 200, { ok: true, value: saveSettings(patch) })
        return
      }
      sendError(res, 405, 'method', '只支持 GET / POST')
      return
    }

    if (pathname !== ENDPOINT_ENHANCE && pathname !== ENDPOINT_STREAM) {
      sendError(res, 404, 'not-found', '未知接口')
      return
    }
    if (req.method !== 'POST') {
      sendError(res, 405, 'method', '只支持 POST')
      return
    }
    if (pathname === ENDPOINT_STREAM) {
      await handleEnhanceStream(ctx, req, res)
      return
    }
    await handleEnhance(ctx, req, res)
  } catch (error) {
    if (res.writableEnded) return
    sendError(res, 500, 'internal', '内部错误：' + ((error && error.message) || String(error)))
  }
}

export function apply(ctx) {
  // webServer 缺席（无头 profile）时这个回调不会跑，插件保持静默。
  ctx.inject(['webServer'], (wctx) => {
    wctx.effect(() => wctx.webServer.register({
      kind: 'prefix',
      path: PREFIX,
      handler: (req, res) => handle(ctx, req, res),
    }))
  })
}