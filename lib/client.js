/**
 * dsh-balance-status —— 浏览器半边（预构建产物）。
 *
 * DSH 的 client-modules 直接按字节提供 bundle（不做转换），所以这里必须保持
 * `window.__ModuleLoader__.load({ id, factory })` 工厂格式，并且只 require
 * 平台种子模块（`react`）。模块 id 必须等于 package.json 的 name。
 *
 * 贡献：
 * - `conversation.composer.dock`：状态行之后追加一枚余额按钮；
 * - `shell.overlay`：该按钮的详情面板（框架级浮层，不会被输入框裁切）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-balance-status',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')

    var BALANCE_ENDPOINT = '/dsh-balance-status/balance'
    // 自动刷新间隔。DeepSeek 的余额接口最多可能有 5 分钟延迟，刷得比这更勤只是白打接口，
    // 所以默认与数据延迟对齐：5 分钟一次。点击余额始终会强制立即刷新（绕过缓存）。
    // 设为 0 即完全关闭自动刷新，只在点击时查询。
    var REFRESH_MS = 300000
    var LOW_BALANCE = 10
    var PANEL_WIDTH = 300
    var STYLE_ATTR = 'data-dsh-balance-status'

    // 余额按钮与详情面板的样式。面板部分逐条照搬自带状态浮窗
    // （ui-chat 的 stat-dialog.module.css），以保证配色、圆角、字号完全一致。
    var PILL_CSS = [
      '[data-dsh-balance]{box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;margin-top:4px;padding:1px 8px;border:0;border-radius:24px;background:0 0;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));font-variant-numeric:tabular-nums;white-space:nowrap;cursor:pointer;flex:none}',
      '[data-dsh-balance]:hover{background:var(--dsw-alias-interactive-bg-hover,transparent);color:var(--dsw-alias-label-secondary)}',
      '[data-dsh-balance][data-dsh-balance-tone="low"]{color:var(--dsw-alias-state-warn-primary)}',
      '[data-dsh-balance][data-dsh-balance-tone="error"]{color:var(--dsw-alias-state-error-primary)}',
      '[data-slot="conversation.composer.dock"]:has(> [data-dsh-balance]){display:flex !important;flex-direction:row;align-items:flex-start;justify-content:center;gap:0}',
      '[data-slot="conversation.composer.dock"]:has(> [data-dsh-balance]) > [data-composer-stats]{width:auto;padding-left:0;padding-right:0;flex:none}',
      '[data-dsh-balance-panel]{position:fixed;transform:translateX(-50%);z-index:1100;box-sizing:border-box;background:var(--dsw-specific-menu);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);width:max-content;min-width:min(300px,100vw - 24px);max-width:min(440px,100vw - 24px);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-secondary);cursor:default;border:0;border-radius:12px;padding:16px;font-size:12px;line-height:18px;pointer-events:auto}',
      '[data-dsh-balance-panel] .dsh-balance-title{color:var(--dsw-alias-label-primary);justify-content:space-between;gap:16px;margin-bottom:8px;font-weight:500;display:flex}',
      '[data-dsh-balance-panel] .dsh-balance-rule{border-top:.5px solid var(--dsw-alias-border-l2);margin-bottom:10px}',
      '[data-dsh-balance-panel] .dsh-balance-details{color:var(--dsw-alias-label-tertiary);grid-template-columns:minmax(76px,auto) minmax(0,1fr);gap:6px 16px;margin:0;display:grid}',
      '[data-dsh-balance-panel] .dsh-balance-details dt,[data-dsh-balance-panel] .dsh-balance-details dd{min-width:0;margin:0}',
      '[data-dsh-balance-panel] .dsh-balance-details dd{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;text-align:right}',
      '[data-dsh-balance-panel] .dsh-balance-hint{margin-top:10px;color:var(--dsw-alias-label-tertiary)}',
    ].join('\n')

    /** 货币符号。 */
    function symbolOf(currency) {
      if (currency === 'CNY') return '¥'
      if (currency === 'USD') return '$'
      return currency.length > 0 ? currency + ' ' : ''
    }

    /** 金额保留两位；非法值给 --。 */
    function two(value) {
      var number = Number(value)
      return Number.isFinite(number) ? number.toFixed(2) : '--'
    }

    /** 失败态视图。 */
    function failureView(reason) {
      return { text: '余额 --', tone: 'error', title: '余额查询失败：' + reason }
    }

    /** 从任意异常里取出可读原因。 */
    function reasonOf(error) {
      return error !== null && typeof error === 'object' && typeof error.message === 'string' ? error.message : String(error)
    }

    /** 把宿主响应折成按钮要显示的文字 / 色调 / 悬停说明。 */
    function viewOf(result) {
      if (result === null || typeof result !== 'object') return failureView('宿主端无返回')
      if (result.ok === true) {
        var currency = typeof result.currency === 'string' ? result.currency : ''
        var symbol = symbolOf(currency)
        var total = typeof result.total === 'string' && result.total.length > 0 ? result.total : '--'
        var parts = []
        if (typeof result.toppedUp === 'string' && result.toppedUp.length > 0) parts.push('充值 ' + symbol + result.toppedUp)
        if (typeof result.granted === 'string' && result.granted.length > 0) parts.push('赠送 ' + symbol + result.granted)
        parts.push('点击查看详情')
        return {
          text: '余额 ' + symbol + total,
          tone: Number(result.total) < LOW_BALANCE ? 'low' : 'normal',
          title: parts.join(' · '),
        }
      }
      if (result.code === 'unconfigured') {
        return {
          text: '余额 未配置',
          tone: 'normal',
          title: '未找到凭据 ' + String(result.ref) + '，请在 DSH 凭据中配置 DeepSeek API Key',
        }
      }
      return failureView(typeof result.error === 'string' ? result.error : '未知错误')
    }

    /** 注入样式表；返回移除它的 disposer。 */
    function mountStyles() {
      if (document.querySelector('style[' + STYLE_ATTR + ']') !== null) return function () {}
      var tag = document.createElement('style')
      tag.setAttribute(STYLE_ATTR, '')
      tag.textContent = PILL_CSS
      document.head.appendChild(tag)
      return function () {
        tag.remove()
      }
    }

    /** 向宿主路由取一次余额。 */
    function loadBalance(force, sessionId) {
      var params = []
      if (force === true) params.push('force=1')
      if (typeof sessionId === 'string' && sessionId.length > 0) params.push('session=' + encodeURIComponent(sessionId))
      var url = BALANCE_ENDPOINT + (params.length > 0 ? '?' + params.join('&') : '')
      return fetch(url, { headers: { accept: 'application/json' } }).then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status)
        return response.json()
      })
    }

    /**
     * 挂载余额按钮与详情面板。
     * @param ctx - 浏览器端 Cordis 上下文。
     */
    function apply(ctx) {
      ctx.effect(mountStyles, 'dsh-balance-status: 样式')

      // 按钮与面板共享的包内状态。
      var panel = { open: false, anchor: null, data: null, listeners: [] }

      var notify = function () {
        var listeners = panel.listeners.slice()
        for (var index = 0; index < listeners.length; index++) listeners[index]()
      }

      var subscribe = function (listener) {
        panel.listeners.push(listener)
        return function () {
          var index = panel.listeners.indexOf(listener)
          if (index >= 0) panel.listeners.splice(index, 1)
        }
      }

      var closePanel = function () {
        if (panel.open !== true) return
        panel.open = false
        notify()
      }

      var openPanel = function (element) {
        if (element !== null && element !== undefined && typeof element.getBoundingClientRect === 'function') {
          var rect = element.getBoundingClientRect()
          var half = PANEL_WIDTH / 2
          var center = rect.left + rect.width / 2
          panel.anchor = {
            left: Math.max(half + 12, Math.min(window.innerWidth - half - 12, center)),
            bottom: window.innerHeight - rect.top + 8,
          }
        }
        panel.open = true
        notify()
      }

      var term = function (label, value) {
        return React.createElement(React.Fragment, { key: label },
          React.createElement('dt', null, label),
          React.createElement('dd', null, value))
      }

      var hint = function (text) {
        return React.createElement('div', { className: 'dsh-balance-hint' }, text)
      }

      /** 详情面板：挂在 shell.overlay，常驻但不占布局。 */
      function BalancePanel() {
        var revisionState = React.useState(0)
        var setRevision = revisionState[1]
        React.useEffect(function () {
          return subscribe(function () {
            setRevision(function (value) { return value + 1 })
          })
        }, [])

        var open = panel.open === true

        // 关闭逻辑挂在 document 上而不是全屏遮罩，避免吃掉滚轮与指针事件。
        React.useEffect(function () {
          if (!open) return undefined
          var onPointerDown = function (event) {
            var target = event.target
            if (target === null || target === undefined || typeof target.closest !== 'function') return
            if (target.closest('[data-dsh-balance-panel]') !== null) return
            if (target.closest('[data-dsh-balance]') !== null) return
            closePanel()
          }
          var onKeyDown = function (event) {
            if (event.key === 'Escape') closePanel()
          }
          document.addEventListener('mousedown', onPointerDown, true)
          document.addEventListener('keydown', onKeyDown, true)
          return function () {
            document.removeEventListener('mousedown', onPointerDown, true)
            document.removeEventListener('keydown', onKeyDown, true)
          }
        }, [open])

        if (!open) return null

        var anchor = panel.anchor
        var style = {
          left: (anchor === null ? PANEL_WIDTH / 2 + 12 : anchor.left) + 'px',
          bottom: (anchor === null ? 104 : anchor.bottom) + 'px',
        }
        var data = panel.data
        var terms = []
        var notes = []

        if (data === null || typeof data !== 'object') {
          terms.push(term('状态', '正在查询…'))
        } else if (data.ok === true) {
          var symbol = symbolOf(typeof data.currency === 'string' ? data.currency : '')
          terms.push(term('余额', symbol + (typeof data.total === 'string' ? data.total : '--')))
          if (typeof data.toppedUp === 'string' && data.toppedUp.length > 0) terms.push(term('充值', symbol + data.toppedUp))
          if (typeof data.granted === 'string' && data.granted.length > 0) terms.push(term('赠送', symbol + data.granted))
          var usage = data.usage !== null && typeof data.usage === 'object' ? data.usage : {}
          terms.push(term('当前对话已用', usage.session === null || usage.session === undefined ? '--' : symbol + two(usage.session)))
          terms.push(term('当前进程已用', usage.process === null || usage.process === undefined ? '--' : symbol + two(usage.process)))
          if (data.available === false) notes.push('账户当前不可用')
        } else if (data.code === 'unconfigured') {
          terms.push(term('状态', '未配置凭据'))
          notes.push('请在 DSH 凭据中配置 ' + String(data.ref))
        } else {
          terms.push(term('状态', '查询失败'))
          notes.push(typeof data.error === 'string' ? data.error : '未知错误')
        }
        notes.push('点击余额刷新 · 点击空白处或 Esc 关闭')

        var children = [React.createElement('div', { className: 'dsh-balance-title' }, 'DeepSeek 余额')]
        children.push(React.createElement('div', { className: 'dsh-balance-rule' }))
        children.push(React.createElement('dl', { className: 'dsh-balance-details' }, terms))
        for (var index = 0; index < notes.length; index++) children.push(hint(notes[index]))

        return React.createElement('div', { 'data-dsh-balance-panel': '', style: style }, children)
      }

      /** 状态行上的余额按钮。 */
      function BalancePill(props) {
        var sessionId = props !== null && typeof props === 'object' && typeof props.sessionId === 'string' && props.sessionId.length > 0
          ? props.sessionId
          : null
        var buttonRef = React.useRef(null)
        var viewState = React.useState({ text: '余额 …', tone: 'normal', title: '正在查询 DeepSeek 余额' })
        var view = viewState[0]
        var setView = viewState[1]

        var publish = function (result) {
          panel.data = result
          setView(viewOf(result))
          notify()
        }

        var load = function (force) {
          loadBalance(force, sessionId).then(function (result) {
            publish(result)
          }).catch(function (error) {
            publish({ ok: false, code: 'transport', error: reasonOf(error) })
          })
        }

        React.useEffect(function () {
          var alive = true
          var tick = function () {
            loadBalance(false, sessionId).then(function (result) {
              if (alive) publish(result)
            }).catch(function (error) {
              if (alive) publish({ ok: false, code: 'transport', error: reasonOf(error) })
            })
          }
          tick()
          var handle = REFRESH_MS > 0 ? window.setInterval(tick, REFRESH_MS) : null
          return function () {
            alive = false
            if (handle !== null) window.clearInterval(handle)
            closePanel()
          }
        }, [])

        return React.createElement('button', {
          type: 'button',
          ref: buttonRef,
          'data-dsh-balance': '',
          'data-dsh-balance-tone': view.tone,
          title: view.title,
          onClick: function () {
            load(true)
            if (panel.open === true) closePanel()
            else openPanel(buttonRef.current)
          },
        }, view.text)
      }

      ctx.slots.inject('conversation.composer.dock', function () {
        return ctx.slots.register({ name: 'conversation.composer.dock', id: 'balance', order: 1 }, BalancePill)
      })

      ctx.slots.inject('shell.overlay', function () {
        return ctx.slots.register({ name: 'shell.overlay', id: 'balance-panel', order: 20 }, BalancePanel)
      })
    }

    exports.name = 'dsh-balance-status'
    exports.inject = ['slots']
    exports.apply = apply
    return module.exports
  },
})
