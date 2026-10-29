// dsh-prompt-boost — 浏览器半边（手写、无构建步骤）。
// 只 require('react')，不 import 任何 Harness Client 包。
//
// 注册点：
//   conversation.input.right  ✦ 增强按钮（发送键左侧）
//   conversation.input.dock   预览卡（原文 / 增强后，流式时边收边显示）
//   conversation.input.dock   撤销条（回填后出现）
//   settings.section          「提示词增强」设置页
//
// 跨组件状态放在模块级 sessions Map 里：按钮和预览卡是同一页面上的两个插槽，
// 通过一份轻量订阅让它们同时刷新。
'use strict'

window.__ModuleLoader__.load({
  id: 'dsh-prompt-boost',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'dsh-prompt-boost'
    const ENDPOINT_STREAM = '/prompt-boost/enhance/stream'
    const ENDPOINT_SETTINGS = '/prompt-boost/settings'
    const SETTINGS_SECTION_ID = 'prompt-boost'
    const SETTINGS_SECTION_ORDER = 115
    const STYLE_STORAGE_KEY = 'dsh-prompt-boost.style'

    const zh = {
      title: '增强结果',
      original: '原文',
      enhanced: '增强后',
      apply: '回填',
      copy: '复制',
      copied: '已复制',
      cancel: '取消',
      close: '关闭',
      undo: '撤销',
      undoHint: '已替换为增强后的提示词',
      buttonTitle: '增强提示词',
      emptyHint: '先输入一段草稿',
      busy: '正在增强…',
      generating: '生成中…',
      errorCommand: '命令输入不支持增强',
      errorGeneric: '增强失败',
      settingsNav: '提示词增强',
      settingsTitle: '提示词增强',
      settingsIntro: '控制 ✦ 增强按钮的行为。保存后立即生效，无需重启。',
      settingEnabled: '启用增强按钮',
      settingModel: '增强用的模型',
      settingFollowSession: '跟随当前会话 / 全局默认模型',
      settingProvider: 'provider',
      settingModelName: 'model',
      settingModelNameHint: '关闭跟随后必须同时填写 provider 与 model。',
      settingGeneration: '生成参数',
      settingTemperature: '温度',
      settingMaxTokens: '最大输出 tokens',
      settingMaxInput: '最大输入字符',
      settingTimeout: '超时（毫秒）',
      settingContext: '上下文感知',
      settingContextAware: '把当前会话最近的消息作为参考',
      settingContextMessages: '最多参考消息数',
      settingContextChars: '参考字符预算',
      settingStreaming: '流式输出',
      settingStreamingHint: '关闭后等生成完再一次性显示。',
      settingSystem: '系统提示词',
      settingSystemHint: '留空时显示当前风格的默认提示词；手动编辑后进入自定义模式，风格选择不生效。',
      settingDefaultStyle: '默认风格',
      settingDefaultStyleHint: '生成前没有手动选择时使用这个风格。',
      settingCustomModeHint: '已填写自定义系统提示词：风格选择不生效。',
      styleTitle: '增强风格',
      styleCustomMode: '自定义模式',
      styleCustomHint: '已启用自定义系统提示词，风格选择不生效',
      styleLogic: '仅优化逻辑',
      styleStructured: '结构化重写',
      styleConcise: '精简压缩',
      settingFillBuiltin: '填入内置策略',
      settingSave: '保存',
      settingReset: '恢复默认',
      settingLoading: '正在读取设置…',
      settingLoadFailed: '读取设置失败',
      settingSaved: '已保存',
      settingSaveFailed: '保存失败',
    }

    const en = {
      title: 'Enhanced prompt',
      original: 'Original',
      enhanced: 'Enhanced',
      apply: 'Fill back',
      copy: 'Copy',
      copied: 'Copied',
      cancel: 'Cancel',
      close: 'Close',
      undo: 'Undo',
      undoHint: 'Replaced with the enhanced prompt',
      buttonTitle: 'Enhance prompt',
      emptyHint: 'Type a draft first',
      busy: 'Enhancing…',
      generating: 'Generating…',
      errorCommand: 'Commands cannot be enhanced',
      errorGeneric: 'Enhancement failed',
      settingsNav: 'Prompt Boost',
      settingsTitle: 'Prompt Boost',
      settingsIntro: 'Controls the ✦ enhance button. Changes apply immediately after saving.',
      settingEnabled: 'Enable the enhance button',
      settingModel: 'Model used for enhancement',
      settingFollowSession: 'Follow the current session / global default model',
      settingProvider: 'provider',
      settingModelName: 'model',
      settingModelNameHint: 'When not following, both provider and model are required.',
      settingGeneration: 'Generation',
      settingTemperature: 'Temperature',
      settingMaxTokens: 'Max output tokens',
      settingMaxInput: 'Max input characters',
      settingTimeout: 'Timeout (ms)',
      settingContext: 'Context awareness',
      settingContextAware: 'Use the latest messages of this session as reference',
      settingContextMessages: 'Max reference messages',
      settingContextChars: 'Reference character budget',
      settingStreaming: 'Streaming output',
      settingStreamingHint: 'When off, the result appears only after generation completes.',
      settingSystem: 'System prompt',
      settingSystemHint: 'Leave empty to show the selected style’s default prompt; editing it enters custom mode and disables style selection.',
      settingDefaultStyle: 'Default style',
      settingDefaultStyleHint: 'Used when no style is picked before generating.',
      settingCustomModeHint: 'A custom system prompt is set: style selection is inactive.',
      styleTitle: 'Enhance style',
      styleCustomMode: 'Custom mode',
      styleCustomHint: 'A custom system prompt is set; style selection is inactive.',
      styleLogic: 'Logic only',
      styleStructured: 'Structured rewrite',
      styleConcise: 'Concise',
      settingFillBuiltin: 'Fill in built-in strategy',
      settingSave: 'Save',
      settingReset: 'Reset to defaults',
      settingLoading: 'Loading settings…',
      settingLoadFailed: 'Failed to load settings',
      settingSaved: 'Saved',
      settingSaveFailed: 'Save failed',
    }

    const CSS = [
      '.pb-button{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;line-height:1}',
      '.pb-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.pb-button:disabled{opacity:.45;cursor:default}',
      '.pb-style-wrap{display:inline-flex;align-items:center;gap:6px}',
      '.pb-style-dd{display:inline-flex;max-width:100%}',
      '.pb-dd{position:relative;display:inline-flex;max-width:100%}',
      '.pb-dd-trigger{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:space-between;gap:8px;height:28px;min-height:28px;padding:0 8px 0 9px;border:1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.28));border-radius:8px;background:var(--dsw-alias-bg-layer-1, rgba(127,127,127,.06));color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:12px;line-height:1;white-space:nowrap;cursor:pointer}',
      '.pb-dd-trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.14));color:var(--dsw-alias-label-primary)}',
      '.pb-dd-trigger:disabled{opacity:.55;cursor:default}',
      '.pb-dd-trigger:focus-visible{outline:2px solid var(--dsw-alias-brand-primary, #4c8dff);outline-offset:1px}',
      '.pb-dd-value{white-space:nowrap}',
      '.pb-dd-chevron{flex:none;width:6px;height:6px;margin-top:-3px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;opacity:.7;transform:rotate(45deg)}',
      '.pb-dd-menu{box-sizing:border-box;position:fixed;z-index:9999;width:max-content;max-width:280px;max-height:320px;overflow:auto;padding:4px;border:1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.28));border-radius:10px;background:var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-layer-1, #1c1f24));box-shadow:0 12px 30px rgba(0,0,0,.35),0 2px 8px rgba(0,0,0,.2);display:flex;flex-direction:column;gap:2px}',
      '.pb-dd-item{box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;padding:6px 8px 6px 9px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:12px;line-height:1.35;text-align:left;white-space:nowrap;cursor:pointer}',
      '.pb-dd-item:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.14));color:var(--dsw-alias-label-primary)}',
      '.pb-dd-item:focus-visible{outline:2px solid var(--dsw-alias-brand-primary, #4c8dff);outline-offset:-2px}',
      '.pb-dd-item.is-selected{color:var(--dsw-alias-label-primary)}',
      '.pb-dd-check{flex:none;width:12px;font-size:12px;line-height:1;color:var(--dsw-alias-brand-primary, #4c8dff)}',
      '.pb-style-dd .pb-dd-trigger{height:26px;min-height:26px;padding:0 7px 0 8px;font-size:12px}',
      '.pb-style-custom{height:26px;min-height:26px;padding:0 8px;font-size:12px}',
      '.pb-glyph{font-size:16px}',
      '.pb-pulse{animation:pb-pulse 1s ease-in-out infinite}',
      '@keyframes pb-pulse{50%{opacity:.35}}',
      '.pb-card{box-sizing:border-box;width:calc(100% - var(--dsh-composer-side-clearance, 16px) - var(--dsh-composer-side-clearance, 16px));max-width:var(--dsh-composer-card-max-width, 952px);margin:0 auto 8px;padding:12px 14px;border:1px solid rgba(127,127,127,.28);border-radius:12px;background:rgba(127,127,127,.05);color:var(--dsw-alias-label-primary);font-size:13px}',
      '.pb-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:8px}',
      '.pb-title{font-weight:600}',
      '.pb-meta{color:var(--dsw-alias-label-tertiary);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.pb-cols{display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:stretch}',
      '@media (max-width:720px){.pb-cols{grid-template-columns:1fr}}',
      '.pb-col{display:flex;flex-direction:column;min-width:0}',
      '.pb-col-title{flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary);margin-bottom:4px}',
      '.pb-pre{flex:1 1 auto;margin:0;max-height:280px;overflow:auto;white-space:pre-wrap;word-break:break-word;font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:rgba(127,127,127,.08);border-radius:8px;padding:8px 10px}',
      '.pb-actions{display:flex;gap:8px;margin-top:10px}',
      '.pb-primary,.pb-ghost,.pb-link{font:inherit;cursor:pointer}',
      '.pb-primary{border:0;border-radius:8px;padding:6px 14px;background:#2f6fed;color:#fff}',
      '.pb-ghost{border:1px solid rgba(127,127,127,.35);border-radius:8px;padding:6px 12px;background:transparent;color:var(--dsw-alias-label-primary)}',
      '.pb-link{border:0;background:transparent;padding:0;color:#2f6fed}',
      '.pb-fill-strategy{flex:none;font-size:12px;line-height:1.4;white-space:nowrap}',
      '.pb-error{display:flex;align-items:center;justify-content:space-between;gap:12px;border-color:rgba(220,80,80,.5)}',
      '.pb-error-text{color:#d05050}',
      '.pb-undo{box-sizing:border-box;display:flex;align-items:center;gap:10px;width:calc(100% - var(--dsh-composer-side-clearance, 16px) - var(--dsh-composer-side-clearance, 16px));max-width:var(--dsh-composer-card-max-width, 952px);margin:0 auto 8px;padding:6px 12px;border-radius:10px;background:rgba(127,127,127,.08);color:var(--dsw-alias-label-secondary);font-size:12px}',
      '.pb-undo-text{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.pb-undo-close{flex:none;display:flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:15px;line-height:1;cursor:pointer}',
      '.pb-undo-close:hover{background:rgba(127,127,127,.16);color:var(--dsw-alias-label-secondary)}',
      '.pb-settings{display:flex;flex-direction:column;gap:16px;max-width:680px;color:var(--dsw-alias-label-primary)}',
      '.pb-settings-title{margin:0;font-size:15px;font-weight:600}',
      '.pb-settings-intro{margin:0;font-size:12px;color:var(--dsw-alias-label-tertiary)}',
      '.pb-field{display:flex;flex-direction:column;gap:6px}',
      '.pb-field-label{font-size:13px;font-weight:600}',
      '.pb-field-hint{margin:0;font-size:12px;color:var(--dsw-alias-label-tertiary)}',
      '.pb-input,.pb-textarea{box-sizing:border-box;width:100%;padding:6px 8px;border:1px solid rgba(127,127,127,.35);border-radius:8px;background:transparent;color:inherit;font:inherit}',
      '.pb-number{box-sizing:border-box;width:120px;padding:6px 8px;border:1px solid rgba(127,127,127,.35);border-radius:8px;background:transparent;color:inherit;font:inherit}',
      '.pb-dd-settings{display:flex;width:220px;max-width:100%}',
      '.pb-dd-settings .pb-dd-trigger{width:100%}',
      '.pb-textarea{min-height:120px;resize:vertical;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}',
      '.pb-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}',
      '.pb-inline{display:flex;align-items:center;gap:8px}',
      '.pb-actions-row{display:flex;gap:10px;align-items:center}',
      '.pb-status{font-size:12px;color:var(--dsw-alias-label-tertiary)}',
      '.pb-status-error{font-size:12px;color:#d05050}',
    ].join('')

    const sessions = new Map()
    const listeners = new Set()
    let boundT = (key) => zh[key] || key

    function readState(sessionId) {
      let state = sessions.get(sessionId)
      if (state === undefined) {
        state = {
          phase: 'idle',
          draft: '',
          text: '',
          model: '',
          elapsedMs: 0,
          error: '',
          undo: null,
          copied: false,
          abort: null,
        }
        sessions.set(sessionId, state)
      }
      return state
    }

    function patch(sessionId, fields) {
      const state = readState(sessionId)
      let changed = false
      for (const key of Object.keys(fields)) {
        if (state[key] !== fields[key]) {
          state[key] = fields[key]
          changed = true
        }
      }
      if (changed) {
        for (const notify of listeners) notify(sessionId)
      }
    }

    function useSession(sessionId) {
      const pair = React.useState(0)
      const bump = pair[1]
      React.useEffect(() => {
        const notify = (changedId) => {
          if (changedId === sessionId) bump((n) => n + 1)
        }
        listeners.add(notify)
        return () => {
          listeners.delete(notify)
        }
      }, [sessionId])
      return readState(sessionId)
    }

    function translator(props) {
      return (key) => {
        if (props && typeof props.t === 'function') {
          const value = props.t(key)
          if (typeof value === 'string' && value !== '' && value !== key) return value
        }
        return zh[key] || key
      }
    }

    function modelLabel(provider, model) {
      return [provider, model].filter((part) => typeof part === 'string' && part !== '').join(' / ')
    }

    // —— 增强请求（SSE）——

    function requestEnhance(sessionId, text, styleId) {
      const initial = readState(sessionId)
      if (initial.phase === 'loading') return
      const controller = new AbortController()
      patch(sessionId, {
        phase: 'loading',
        draft: text,
        text: '',
        model: '',
        elapsedMs: 0,
        error: '',
        copied: false,
        undo: null,
        abort: controller,
      })

      // 流式增量按 80ms 合批，避免每个 token 都触发一次 React 渲染。
      let pending = ''
      let timer = 0
      const flush = () => {
        timer = 0
        if (pending === '') return
        const state = readState(sessionId)
        patch(sessionId, { text: state.text + pending })
        pending = ''
      }
      const push = (delta) => {
        pending += delta
        if (timer === 0) timer = setTimeout(flush, 80)
      }
      const stopFlush = () => {
        if (timer !== 0) clearTimeout(timer)
        timer = 0
        pending = ''
      }

      const run = async () => {
        let response
        try {
          response = await fetch(ENDPOINT_STREAM, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId, text, styleId }),
            signal: controller.signal,
          })
        } catch (error) {
          if (error && error.name === 'AbortError') {
            stopFlush()
            patch(sessionId, { phase: 'idle', text: '', abort: null })
            return
          }
          throw error
        }

        const type = response.headers.get('content-type') || ''
        if (!response.ok || !type.includes('text/event-stream')) {
          let payload = null
          try {
            payload = await response.json()
          } catch {
            payload = null
          }
          const message = payload && payload.error && payload.error.message
            ? payload.error.message
            : 'HTTP ' + response.status
          throw new Error(message)
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let finalPayload = null

        for (;;) {
          const chunk = await reader.read()
          if (chunk.done) break
          buffer += decoder.decode(chunk.value, { stream: true })
          let index
          while ((index = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, index).trim()
            buffer = buffer.slice(index + 2)
            if (frame === '' || frame.startsWith(':')) continue
            if (!frame.startsWith('data:')) continue
            let payload
            try {
              payload = JSON.parse(frame.slice(5).trim())
            } catch {
              continue
            }
            if (payload && typeof payload.delta === 'string') {
              push(payload.delta)
            } else if (payload && payload.done === true) {
              finalPayload = payload
            } else if (payload && payload.error) {
              throw new Error(payload.error.message || '增强失败')
            }
          }
        }

        stopFlush()
        if (finalPayload && typeof finalPayload.text === 'string' && finalPayload.text !== '') {
          patch(sessionId, {
            phase: 'preview',
            text: finalPayload.text,
            model: modelLabel(finalPayload.provider, finalPayload.model),
            elapsedMs: typeof finalPayload.elapsedMs === 'number' ? finalPayload.elapsedMs : 0,
            abort: null,
          })
        } else {
          patch(sessionId, { phase: 'error', error: '模型没有返回内容', abort: null })
        }
      }

      run().catch((error) => {
        stopFlush()
        if (error && error.name === 'AbortError') {
          patch(sessionId, { phase: 'idle', text: '', abort: null })
          return
        }
        patch(sessionId, { phase: 'error', error: (error && error.message) || '增强失败', abort: null })
      })
    }

    // —— 输入框插槽组件 ——

    // 风格文案优先走词典，词典缺项时退回宿主给的 label。
    function styleLabel(t, id) {
      const key = 'style' + id.charAt(0).toUpperCase() + id.slice(1)
      const value = t(key)
      return value === key ? id : value
    }

    function readStoredStyle() {
      try {
        return typeof window === 'undefined' ? '' : (window.localStorage.getItem(STYLE_STORAGE_KEY) || '')
      } catch {
        return ''
      }
    }

    function storeStyle(styleId) {
      try {
        if (typeof window !== 'undefined') window.localStorage.setItem(STYLE_STORAGE_KEY, styleId)
      } catch {
        // localStorage 不可用时只影响“记住上次”，不影响本次生成。
      }
    }

    // 自绘下拉：原生 select 的展开列表无法跟随页面主题，收起态也容易截断。
    // 行为仍是受控单选：value / options / onChange / disabled 与原来一致。
    function StyleDropdown(props) {
      const [open, setOpen] = React.useState(false)
      const [menuStyle, setMenuStyle] = React.useState(null)
      const rootRef = React.useRef(null)
      const options = Array.isArray(props.options) ? props.options : []
      const selected = options.find((option) => option.value === props.value) || options[0] || null
      const disabled = props.disabled === true

      React.useEffect(() => {
        if (!open) return undefined
        const close = () => setOpen(false)
        const onPointerDown = (event) => {
          if (rootRef.current && !rootRef.current.contains(event.target)) close()
        }
        const onKeyDown = (event) => {
          if (event.key === 'Escape') close()
        }
        document.addEventListener('mousedown', onPointerDown)
        document.addEventListener('keydown', onKeyDown)
        window.addEventListener('resize', close)
        window.addEventListener('scroll', close, true)
        return () => {
          document.removeEventListener('mousedown', onPointerDown)
          document.removeEventListener('keydown', onKeyDown)
          window.removeEventListener('resize', close)
          window.removeEventListener('scroll', close, true)
        }
      }, [open])

      function openMenu() {
        const node = rootRef.current
        const rect = node && node.getBoundingClientRect ? node.getBoundingClientRect() : null
        if (rect && typeof window !== 'undefined') {
          const up = props.placement === 'up'
          const style = {
            position: 'fixed',
            minWidth: Math.round(rect.width),
          }
          if (up) {
            style.right = Math.max(8, Math.round(window.innerWidth - rect.right))
            style.bottom = Math.max(8, Math.round(window.innerHeight - rect.top + 6))
          } else {
            style.left = Math.max(8, Math.round(rect.left))
            style.top = Math.round(rect.bottom + 6)
          }
          if (props.width === 'trigger') style.width = Math.round(rect.width)
          setMenuStyle(style)
        } else {
          setMenuStyle(null)
        }
        setOpen(true)
      }

      function choose(value) {
        setOpen(false)
        if (value !== props.value && typeof props.onChange === 'function') props.onChange(value)
      }

      const trigger = h('button', {
        type: 'button',
        className: 'pb-dd-trigger',
        disabled,
        title: props.title,
        'aria-label': props.ariaLabel || props.title,
        'aria-haspopup': 'listbox',
        'aria-expanded': open ? 'true' : 'false',
        onClick: () => {
          if (disabled) return
          if (open) setOpen(false)
          else openMenu()
        },
      },
        h('span', { className: 'pb-dd-value' }, selected ? selected.label : ''),
        h('span', { className: 'pb-dd-chevron', 'aria-hidden': 'true' }))

      const menu = open && !disabled
        ? h('div', {
          className: 'pb-dd-menu',
          role: 'listbox',
          'aria-label': props.ariaLabel || props.title,
          style: menuStyle || undefined,
        }, options.map((option) => h('button', {
          key: option.value,
          type: 'button',
          role: 'option',
          'aria-selected': option.value === props.value ? 'true' : 'false',
          className: 'pb-dd-item' + (option.value === props.value ? ' is-selected' : ''),
          onClick: () => choose(option.value),
        },
          h('span', { className: 'pb-dd-item-label' }, option.label),
          h('span', { className: 'pb-dd-check', 'aria-hidden': 'true' }, option.value === props.value ? '✓' : ''))))
        : null

      return h('span', {
        className: 'pb-dd' + (props.className ? ' ' + props.className : ''),
        ref: rootRef,
      }, trigger, menu)
    }

    function EnhanceButton(props) {
      const sessionId = props.sessionId
      const t = translator(props)
      const draft = props.useInput((state) => state.draft)
      const state = useSession(sessionId)
      const busy = state.phase === 'loading'
      const empty = typeof draft !== 'string' || draft.trim() === ''
      const disabled = busy || empty
      const [styles, setStyles] = React.useState([])
      const [customMode, setCustomMode] = React.useState(false)
      const [styleId, setStyleId] = React.useState(readStoredStyle)

      // 生成前读一次设置：拿风格清单、默认风格与自定义模式标记。
      React.useEffect(() => {
        let alive = true
        fetch(ENDPOINT_SETTINGS)
          .then((response) => response.json())
          .then((payload) => {
            if (!alive || !payload || payload.ok !== true) return
            const list = Array.isArray(payload.styles) ? payload.styles : []
            const stored = readStoredStyle()
            const fallback = payload.value && typeof payload.value.defaultStyleId === 'string'
              ? payload.value.defaultStyleId
              : ''
            const known = (id) => list.some((style) => style.id === id)
            const preferred = known(stored) ? stored : (known(fallback) ? fallback : (list[0] ? list[0].id : ''))
            setStyles(list)
            setCustomMode(payload.customMode === true)
            if (preferred !== '') setStyleId(preferred)
          })
          .catch(() => {
            // 设置读不到时隐藏选择器，增强按钮仍按宿主默认风格工作。
          })
        return () => {
          alive = false
        }
      }, [sessionId])

      function start() {
        if (disabled) return
        const text = draft
        if (text.trim().startsWith('/')) {
          patch(sessionId, { phase: 'error', error: t('errorCommand') })
          return
        }
        requestEnhance(sessionId, text, styleId)
      }

      function choose(value) {
        setStyleId(value)
        storeStyle(value)
      }

      const selector = customMode
        ? h('button', {
          type: 'button',
          className: 'pb-dd-trigger pb-style-custom',
          disabled: true,
          title: t('styleCustomHint'),
          'aria-label': t('styleCustomHint'),
        },
          h('span', { className: 'pb-dd-value' }, t('styleCustomMode')),
          h('span', { className: 'pb-dd-chevron', 'aria-hidden': 'true' }))
        : styles.length > 0
          ? h(StyleDropdown, {
            className: 'pb-style-dd',
            value: styleId,
            options: styles.map((style) => ({ value: style.id, label: styleLabel(t, style.id) })),
            onChange: choose,
            disabled: busy,
            placement: 'up',
            title: t('styleTitle'),
            ariaLabel: t('styleTitle'),
          })
          : null

      const button = h('button', {
        type: 'button',
        className: 'pb-button' + (busy ? ' pb-button-busy' : ''),
        title: empty ? t('emptyHint') : t('buttonTitle'),
        'aria-label': t('buttonTitle'),
        disabled,
        onClick: start,
      }, h('span', { className: 'pb-glyph' + (busy ? ' pb-pulse' : '') }, '✦'))

      return selector === null ? button : h('span', { className: 'pb-style-wrap' }, selector, button)
    }

    function PreviewPanel(props) {
      const sessionId = props.sessionId
      const t = translator(props)
      const state = useSession(sessionId)

      if (state.phase === 'error') {
        return h('div', { className: 'pb-card pb-error' },
          h('span', { className: 'pb-error-text' }, state.error || t('errorGeneric')),
          h('button', {
            type: 'button',
            className: 'pb-link',
            onClick: () => patch(sessionId, { phase: 'idle', error: '' }),
          }, t('close')),
        )
      }
      if (state.phase !== 'preview' && state.phase !== 'loading') return null

      const loading = state.phase === 'loading'

      function accept() {
        props.inputActions.setDraft(state.text)
        patch(sessionId, { phase: 'idle', undo: { original: state.draft }, copied: false })
      }

      function copy() {
        if (typeof navigator === 'undefined' || !navigator.clipboard) return
        navigator.clipboard.writeText(state.text).then(() => {
          patch(sessionId, { copied: true })
          setTimeout(() => patch(sessionId, { copied: false }), 1500)
        }).catch(() => {})
      }

      function cancel() {
        if (loading && state.abort) state.abort.abort()
        patch(sessionId, { phase: 'idle', text: '', abort: null })
      }

      const meta = loading
        ? t('generating')
        : [state.model, state.elapsedMs > 0 ? state.elapsedMs + ' ms' : '']
          .filter((part) => part !== '')
          .join(' · ')

      const actions = loading
        ? h('div', { className: 'pb-actions' },
          h('button', { type: 'button', className: 'pb-ghost', onClick: cancel }, t('cancel')))
        : h('div', { className: 'pb-actions' },
          h('button', { type: 'button', className: 'pb-primary', onClick: accept }, t('apply')),
          h('button', { type: 'button', className: 'pb-ghost', onClick: copy }, state.copied ? t('copied') : t('copy')),
          h('button', { type: 'button', className: 'pb-ghost', onClick: cancel }, t('cancel')))

      return h('div', { className: 'pb-card' },
        h('div', { className: 'pb-head' },
          h('span', { className: 'pb-title' }, loading ? t('busy') : t('title')),
          h('span', { className: 'pb-meta' }, meta)),
        h('div', { className: 'pb-cols' },
          h('div', { className: 'pb-col' },
            h('div', { className: 'pb-col-title' }, t('original')),
            h('pre', { className: 'pb-pre' }, state.draft)),
          h('div', { className: 'pb-col' },
            h('div', { className: 'pb-col-title' }, t('enhanced')),
            h('pre', { className: 'pb-pre' }, state.text))),
        actions,
      )
    }

    function UndoBar(props) {
      const sessionId = props.sessionId
      const t = translator(props)
      const state = useSession(sessionId)
      const draftEmpty = props.useInput((input) => input.draft.trim() === '')
      const inputPhase = props.useInput((input) => input.phase)
      const visible = state.undo !== null && state.phase === 'idle'
      const sending = inputPhase === 'adjudicating' || inputPhase === 'submitting'

      // 发送即收：提交开始（adjudicating/submitting）或输入框被清空时，
      // 这条提示已经失去“撤销回填”的意义，直接移除。
      React.useEffect(() => {
        if (!visible) return
        if (draftEmpty || sending) patch(sessionId, { undo: null })
      }, [draftEmpty, sending, visible, sessionId])

      if (!visible) return null

      return h('div', { className: 'pb-undo' },
        h('span', { className: 'pb-undo-text' }, t('undoHint')),
        h('button', {
          type: 'button',
          className: 'pb-link',
          onClick: () => {
            props.inputActions.setDraft(state.undo.original)
            patch(sessionId, { undo: null })
          },
        }, t('undo')),
        h('button', {
          type: 'button',
          className: 'pb-undo-close',
          title: t('close'),
          'aria-label': t('close'),
          onClick: () => patch(sessionId, { undo: null }),
        }, '×'),
      )
    }

    // —— 设置页 ——

    function numberField(label, value, onChange, hint) {
      return h('div', { className: 'pb-field' },
        h('span', { className: 'pb-field-label' }, label),
        h('input', {
          type: 'number',
          className: 'pb-number',
          value: value,
          onChange: (event) => onChange(Number(event.target.value)),
        }),
        hint ? h('p', { className: 'pb-field-hint' }, hint) : null)
    }

    function SettingsPage() {
      const t = boundT
      const [form, setForm] = React.useState(null)
      const [builtin, setBuiltin] = React.useState('')
      const [defaults, setDefaults] = React.useState(null)
      const [styles, setStyles] = React.useState([])
      const [status, setStatus] = React.useState(t('settingLoading'))
      const [failed, setFailed] = React.useState(false)
      const [busy, setBusy] = React.useState(false)

      React.useEffect(() => {
        let alive = true
        fetch(ENDPOINT_SETTINGS)
          .then((response) => response.json())
          .then((payload) => {
            if (!alive) return
            if (payload && payload.ok === true && payload.value) {
              setForm(payload.value)
              setBuiltin(typeof payload.builtinSystemPrompt === 'string' ? payload.builtinSystemPrompt : '')
              setDefaults(payload.defaults && typeof payload.defaults === 'object' ? payload.defaults : null)
              setStyles(Array.isArray(payload.styles) ? payload.styles : [])
              setStatus('')
              setFailed(false)
            } else {
              setStatus((payload && payload.error && payload.error.message) || t('settingLoadFailed'))
              setFailed(true)
            }
          })
          .catch((error) => {
            if (!alive) return
            setStatus((error && error.message) || t('settingLoadFailed'))
            setFailed(true)
          })
        return () => {
          alive = false
        }
      }, [])

      if (form === null) {
        return h('section', { className: 'pb-settings' },
          h('h3', { className: 'pb-settings-title' }, t('settingsTitle')),
          h('p', { className: failed ? 'pb-status-error' : 'pb-status' }, status),
        )
      }

      const update = (key, value) => setForm((current) => ({ ...current, [key]: value }))

      const customMode = String(form.systemPrompt || '').trim() !== ''
      const selectedStyle = styles.find((style) => style.id === (form.defaultStyleId || 'logic'))
      const stylePrompt = selectedStyle && typeof selectedStyle.system === 'string' ? selectedStyle.system : builtin
      const shownSystemPrompt = customMode ? form.systemPrompt : stylePrompt

      function save() {
        setBusy(true)
        fetch(ENDPOINT_SETTINGS, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ patch: form }),
        })
          .then((response) => response.json())
          .then((payload) => {
            if (payload && payload.ok === true && payload.value) {
              setForm(payload.value)
              setStatus(t('settingSaved'))
              setFailed(false)
              setTimeout(() => setStatus(''), 2000)
            } else {
              setStatus((payload && payload.error && payload.error.message) || t('settingSaveFailed'))
              setFailed(true)
            }
          })
          .catch((error) => {
            setStatus((error && error.message) || t('settingSaveFailed'))
            setFailed(true)
          })
          .finally(() => setBusy(false))
      }

      function reset() {
        if (defaults !== null) {
          setForm({ ...form, ...defaults })
          setStatus('')
          setFailed(false)
        }
      }

      return h('section', { className: 'pb-settings' },
        h('h3', { className: 'pb-settings-title' }, t('settingsTitle')),
        h('p', { className: 'pb-settings-intro' }, t('settingsIntro')),

        h('div', { className: 'pb-inline' },
          h('input', {
            type: 'checkbox',
            checked: Boolean(form.enabled),
            onChange: (event) => update('enabled', event.target.checked),
          }),
          h('span', { className: 'pb-field-label' }, t('settingEnabled'))),

        h('div', { className: 'pb-field' },
          h('span', { className: 'pb-field-label' }, t('settingModel')),
          h('label', { className: 'pb-inline' },
            h('input', {
              type: 'checkbox',
              checked: Boolean(form.followSession),
              onChange: (event) => update('followSession', event.target.checked),
            }),
            h('span', {}, t('settingFollowSession'))),
          form.followSession ? null : h('div', { className: 'pb-grid' },
            h('div', { className: 'pb-field' },
              h('span', { className: 'pb-field-label' }, t('settingProvider')),
              h('input', {
                type: 'text',
                className: 'pb-input',
                value: form.provider,
                placeholder: 'bailian',
                onChange: (event) => update('provider', event.target.value),
              })),
            h('div', { className: 'pb-field' },
              h('span', { className: 'pb-field-label' }, t('settingModelName')),
              h('input', {
                type: 'text',
                className: 'pb-input',
                value: form.model,
                placeholder: 'deepseek-v4.1-flash-1017',
                onChange: (event) => update('model', event.target.value),
              }))),
          form.followSession ? null : h('p', { className: 'pb-field-hint' }, t('settingModelNameHint'))),

        h('div', { className: 'pb-field' },
          h('span', { className: 'pb-field-label' }, t('settingGeneration')),
          h('div', { className: 'pb-grid' },
            numberField(t('settingTemperature'), form.temperature, (value) => update('temperature', value)),
            numberField(t('settingMaxTokens'), form.maxOutputTokens, (value) => update('maxOutputTokens', value)),
            numberField(t('settingMaxInput'), form.maxInputChars, (value) => update('maxInputChars', value)),
            numberField(t('settingTimeout'), form.timeoutMs, (value) => update('timeoutMs', value)))),

        h('div', { className: 'pb-field' },
          h('label', { className: 'pb-inline' },
            h('input', {
              type: 'checkbox',
              checked: Boolean(form.contextAware),
              onChange: (event) => update('contextAware', event.target.checked),
            }),
            h('span', { className: 'pb-field-label' }, t('settingContext'))),
          h('p', { className: 'pb-field-hint' }, t('settingContextAware')),
          form.contextAware ? h('div', { className: 'pb-grid' },
            numberField(t('settingContextMessages'), form.contextMaxMessages, (value) => update('contextMaxMessages', value)),
            numberField(t('settingContextChars'), form.contextMaxChars, (value) => update('contextMaxChars', value))) : null),

        h('div', { className: 'pb-field' },
          h('label', { className: 'pb-inline' },
            h('input', {
              type: 'checkbox',
              checked: Boolean(form.streaming),
              onChange: (event) => update('streaming', event.target.checked),
            }),
            h('span', { className: 'pb-field-label' }, t('settingStreaming'))),
          h('p', { className: 'pb-field-hint' }, t('settingStreamingHint'))),

        h('div', { className: 'pb-field' },
          h('span', { className: 'pb-field-label' }, t('settingDefaultStyle')),
          h(StyleDropdown, {
            className: 'pb-dd-settings',
            value: form.defaultStyleId || 'logic',
            options: styles.map((style) => ({ value: style.id, label: styleLabel(t, style.id) })),
            onChange: (value) => update('defaultStyleId', value),
            disabled: customMode,
            placement: 'down',
            width: 'trigger',
            ariaLabel: t('settingDefaultStyle'),
          }),
          customMode
            ? h('p', { className: 'pb-field-hint' }, t('settingCustomModeHint'))
            : h('p', { className: 'pb-field-hint' }, t('settingDefaultStyleHint'))),

        h('div', { className: 'pb-field' },
          h('span', { className: 'pb-field-label' }, t('settingSystem')),
          h('textarea', {
            className: 'pb-textarea',
            value: shownSystemPrompt,
            onChange: (event) => update('systemPrompt', event.target.value),
          }),
          h('div', { className: 'pb-actions-row' },
            h('button', {
              type: 'button',
              className: 'pb-link pb-fill-strategy',
              onClick: () => update('systemPrompt', builtin),
            }, t('settingFillBuiltin')),
            h('span', { className: 'pb-field-hint' }, t('settingSystemHint')))),

        h('div', { className: 'pb-actions-row' },
          h('button', {
            type: 'button',
            className: 'pb-primary',
            disabled: busy,
            onClick: save,
          }, t('settingSave')),
          h('button', {
            type: 'button',
            className: 'pb-ghost',
            disabled: busy,
            onClick: reset,
          }, t('settingReset')),
          h('span', { className: failed ? 'pb-status-error' : 'pb-status' }, status)),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => {
          const tag = document.createElement('style')
          tag.dataset.plugin = NS
          tag.textContent = CSS
          document.head.appendChild(tag)
          return () => tag.remove()
        }, 'dsh-prompt-boost: styles')

        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-prompt-boost: dictionaries')
        boundT = ctx.locale.bind(NS)

        ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
          name: 'conversation.input.right',
          id: 'prompt-boost',
          order: 55,
          locale: NS,
        }, EnhanceButton))

        ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
          name: 'conversation.input.dock',
          id: 'prompt-boost-preview',
          order: 80,
          locale: NS,
        }, PreviewPanel))

        ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
          name: 'conversation.input.dock',
          id: 'prompt-boost-undo',
          order: 90,
          locale: NS,
        }, UndoBar))

        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: SETTINGS_SECTION_ID,
          order: SETTINGS_SECTION_ORDER,
          label: () => boundT('settingsNav'),
          locale: NS,
        }, SettingsPage))
      },
    }
  },
})