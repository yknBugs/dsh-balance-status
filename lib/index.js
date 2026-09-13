/**
 * dsh-balance-status —— 宿主半边。
 *
 * 职责：
 * 1. 从 DSH 凭据里解析 DeepSeek API Key（跟随 llm-deepseek 设置里的 apiKeyEnv / baseURL）；
 * 2. 调用 `GET {baseURL}/user/balance` 取账户余额，30 秒结果缓存；
 * 3. 通过一个只读 HTTP 路由把结果交给浏览器半边；
 * 4. 用「余额差值记账」维护两个用量数字（当前进程 / 当前对话）。
 *
 * 用量数据只存在于本进程内存中，绝不写入会话记录：进程退出即消失（这是刻意的，
 * 以保证会话日志格式与后续版本保持兼容）。
 *
 * @module dsh-balance-status
 */

/** 插件名：与 package.json 的 name 一致。 */
export const name = 'dsh-balance-status'

/** webServer 是硬依赖：没有它浏览器半边拿不到任何数据。 */
export const inject = ['webServer']

/** 默认的凭据引用（环境变量名）。 */
const DEFAULT_REF = 'DEEPSEEK_API_KEY'
/** 默认的 API 端点。 */
const DEFAULT_BASE_URL = 'https://api.deepseek.com'
/** 内部端点用的凭据引用，与 llm-deepseek 的 BASE_URL_ENV 一致。 */
const BASE_URL_REF = 'DEEPSEEK_BASE_URL'
/** llm-deepseek 的设置命名空间，用于跟随用户改过的 apiKeyEnv / baseURL。 */
const SETTINGS_NS = 'llm-deepseek'
/** 命中缓存时不再请求接口的时间窗。 */
const CACHE_MS = 30_000
/** 单次余额请求的超时。 */
const REQUEST_TIMEOUT_MS = 15_000
/** 余额接口路径。 */
const BALANCE_PATH = '/user/balance'
/** 浏览器半边读取数据的路由。 */
export const ROUTE_PATH = '/dsh-balance-status/balance'

/**
 * 把一次观测到的余额并入账本：只累计“下降”，充值导致的上升只抬高基准点。
 * @param ledger - 账本，{ ref, used }。
 * @param total - 本次观测到的总余额（数值）。
 */
function accumulate(ledger, total) {
  if (ledger.ref === null) {
    ledger.ref = total
    return
  }
  const delta = ledger.ref - total
  if (delta > 0) ledger.used = Math.round((ledger.used + delta) * 100) / 100
  ledger.ref = total
}

/**
 * 把接口返回的余额明细整理成面板需要的最小标量集合。
 * @param parsed - 解析后的接口响应体。
 * @param at - 观测时间戳。
 * @returns 归一化后的负载。
 */
function summarize(parsed, at) {
  if (parsed === null || typeof parsed !== 'object') {
    return { ok: false, code: 'error', error: '接口返回的不是 JSON 对象', at }
  }
  const raw = Array.isArray(parsed.balance_infos) ? parsed.balance_infos : []
  const infos = raw.filter((item) => item !== null && typeof item === 'object')
  if (infos.length === 0) return { ok: false, code: 'error', error: '接口未返回余额明细', at }
  // 优先取有余额的 CNY 条目；否则取第一个非零条目；再退化为 CNY / 首条。
  const nonZero = infos.filter((item) => Number(item.total_balance) > 0)
  const pick = nonZero.find((item) => item.currency === 'CNY')
    ?? nonZero[0]
    ?? infos.find((item) => item.currency === 'CNY')
    ?? infos[0]
  const text = (value) => (value === undefined || value === null ? '' : String(value))
  return {
    ok: true,
    at,
    available: parsed.is_available !== false,
    currency: text(pick.currency),
    total: text(pick.total_balance),
    granted: text(pick.granted_balance),
    toppedUp: text(pick.topped_up_balance),
  }
}

/**
 * 挂载余额查询、用量记账与浏览器取数路由。
 * @param ctx - 宿主 Cordis 上下文。
 */
export function apply(ctx) {
  /** 最近一次成功的余额结果。 */
  const cache = { at: 0, payload: null }
  /** 当前进程的用量账本（重启即重置）。 */
  const processLedger = { ref: null, used: 0 }
  /** 每个会话一份用量账本（开新对话即重置）。 */
  const sessionLedgers = new Map()

  /** 读取 llm-deepseek 的设置，拿到凭据引用与端点；缺失时用默认值。 */
  function readConfig() {
    const config = { ref: DEFAULT_REF, baseURL: null }
    const settings = ctx.get('settings')
    if (settings === undefined) return config
    try {
      const section = settings.get(SETTINGS_NS)
      if (section === null || typeof section !== 'object') return config
      if (typeof section.apiKeyEnv === 'string' && section.apiKeyEnv.length > 0) config.ref = section.apiKeyEnv
      if (typeof section.baseURL === 'string' && section.baseURL.length > 0) config.baseURL = section.baseURL
    } catch (error) {
      ctx.logger?.debug?.(`dsh-balance-status: 读取 ${SETTINGS_NS} 设置失败，改用默认值：${String(error)}`)
    }
    return config
  }

  /** 解析端点：优先设置，其次 DEEPSEEK_BASE_URL 凭据，最后公共端点。 */
  async function resolveBaseUrl(configured) {
    if (configured !== null) return configured
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      try {
        const hit = await credentials.resolve(BASE_URL_REF)
        if (hit !== undefined && typeof hit.value === 'string' && hit.value.length > 0) return hit.value
      } catch (error) {
        ctx.logger?.debug?.(`dsh-balance-status: 解析 ${BASE_URL_REF} 失败，改用公共端点：${String(error)}`)
      }
    }
    return DEFAULT_BASE_URL
  }

  /** 请求并解析余额接口；非 2xx 抛错并带上响应片段。 */
  async function requestBalance(url, key) {
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`HTTP ${response.status}：${text.slice(0, 180)}`)
    return JSON.parse(text)
  }

  /**
   * 取一次余额（带缓存）。
   * @param force - 跳过缓存。
   * @returns { payload, fresh }：负载本身，以及本次是否真的重新请求了接口。
   */
  async function query(force) {
    const now = Date.now()
    if (force !== true && cache.payload !== null && now - cache.at < CACHE_MS) {
      return { payload: cache.payload, fresh: false }
    }
    try {
      const config = readConfig()
      const credentials = ctx.get('credentials')
      if (credentials === undefined) throw new Error('宿主端缺少 credentials 服务')
      const hit = await credentials.resolve(config.ref)
      if (hit === undefined || typeof hit.value !== 'string' || hit.value.length === 0) {
        return { payload: { ok: false, code: 'unconfigured', ref: config.ref, at: now }, fresh: false }
      }
      const base = await resolveBaseUrl(config.baseURL)
      const url = base.replace(/\/+$/, '') + BALANCE_PATH
      const payload = summarize(await requestBalance(url, hit.value), Date.now())
      if (payload.ok === true) {
        cache.at = Date.now()
        cache.payload = payload
      }
      return { payload, fresh: payload.ok === true }
    } catch (error) {
      return {
        payload: {
          ok: false,
          code: 'error',
          error: error !== null && typeof error === 'object' && typeof error.message === 'string' ? error.message : String(error),
          at: Date.now(),
        },
        fresh: false,
      }
    }
  }

  /**
   * 组织一次对外响应：余额 + 两个用量数字。
   * @param force - 跳过缓存。
   * @param sessionId - 浏览器传来的会话 id，用于「当前对话已用」。
   * @returns 可直接序列化为 JSON 的负载。
   */
  async function respond(force, sessionId) {
    const outcome = await query(force)
    const payload = outcome.payload
    let sessionUsed = null
    if (payload.ok === true) {
      const total = Number(payload.total)
      if (Number.isFinite(total)) {
        // 进程账本只在真正重新请求接口时推进，避免多标签页重复计同一笔下降。
        if (outcome.fresh === true) accumulate(processLedger, total)
        if (sessionId !== null && sessionId.length > 0) {
          const existing = sessionLedgers.get(sessionId)
          if (existing === undefined) sessionLedgers.set(sessionId, { ref: total, used: 0 })
          else accumulate(existing, total)
          sessionUsed = sessionLedgers.get(sessionId).used
        }
      }
    }
    return {
      ok: payload.ok === true,
      code: typeof payload.code === 'string' ? payload.code : null,
      error: typeof payload.error === 'string' ? payload.error : null,
      ref: typeof payload.ref === 'string' ? payload.ref : null,
      available: payload.available === true,
      currency: typeof payload.currency === 'string' ? payload.currency : '',
      total: typeof payload.total === 'string' ? payload.total : '',
      granted: typeof payload.granted === 'string' ? payload.granted : '',
      toppedUp: typeof payload.toppedUp === 'string' ? payload.toppedUp : '',
      at: typeof payload.at === 'number' ? payload.at : Date.now(),
      usage: { process: processLedger.used, session: sessionUsed },
    }
  }

  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: ROUTE_PATH,
      handler: async (req, res) => {
        let status = 200
        let body
        try {
          const url = new URL(req.url ?? ROUTE_PATH, 'http://127.0.0.1')
          body = await respond(url.searchParams.get('force') === '1', url.searchParams.get('session') ?? null)
        } catch (error) {
          status = 500
          body = {
            ok: false,
            code: 'error',
            error: error !== null && typeof error === 'object' && typeof error.message === 'string' ? error.message : String(error),
            usage: { process: processLedger.used, session: null },
          }
        }
        const text = JSON.stringify(body)
        res.writeHead(status, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'content-length': Buffer.byteLength(text),
        })
        res.end(text)
      },
    }),
    'dsh-balance-status: 余额取数路由',
  )
}
