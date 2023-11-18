import fs from "fs"
import { unlink } from "fs/promises"
import { filesize } from "filesize"

import {
  AppState,
  ChannelHandler,
  Choice,
  FlagsOptions,
  PromptConfig,
  PromptData,
  Shortcut,
} from "../types/core"

import {
  GetAppData,
  KeyData,
  AppMessage,
  EditorOptions,
  Config,
  KitStatus,
  Field,
  GuideSection,
  KitTheme,
  MicConfig,
  Fields,
  ClipboardItem,
} from "../types/kitapp"

import {
  format,
  formatDistanceToNow,
  compareAsc,
} from "@johnlindquist/kit-internal/date-fns"

import {
  filter,
  Observable,
  share,
  switchMap,
  take,
  takeUntil,
  tap,
  Subject,
  merge,
} from "@johnlindquist/kit-internal/rxjs"
import { minimist } from "@johnlindquist/kit-internal/minimist"
import { stripAnsi } from "@johnlindquist/kit-internal/strip-ansi"

import {
  Key,
  Mode,
  Channel,
  UI,
  Value,
  PROMPT,
} from "../core/enum.js"
import {
  assignPropsTo,
  getMainScriptPath,
  cmd,
  defaultShortcuts,
  escapeShortcut,
  closeShortcut,
  editScriptShortcut,
  formShortcuts,
  argShortcuts,
  smallShortcuts,
  isMac,
  debounce,
  adjustPackageName,
  editorShortcuts,
  shortcutsShortcut,
} from "../core/utils.js"
import { keyCodeFromKey } from "../core/keyboard.js"
import {
  errorPrompt,
  getFlagsFromActions,
} from "../api/kit.js"
import { Rectangle } from "../types/electron"
import { Dirent } from "fs"
import { EventEmitter } from "events"

interface DisplayChoicesProps
  extends Partial<PromptConfig> {
  className: string
  generated?: boolean
  inputRegex?: string
  state: AppState
}

let promptId = 0

global.__kitPromptId = ""

global.onExit = handler => {
  process.once("beforeExit", handler)
}

let createHandlerWrapper = (
  channel: Channel,
  handler: (data: any) => void
) => {
  let wrappedHandler = (data: any) => {
    // log(data)
    if (data?.channel === channel) {
      handler(data.state)
    }
  }
  process.on("message", wrappedHandler)

  return () => {
    process.off("message", wrappedHandler)
  }
}

global.onClick = handler => {
  log(`Registering onClick handler`)
  return createHandlerWrapper(Channel.SYSTEM_CLICK, handler)
}

global.onMousedown = handler => {
  return createHandlerWrapper(
    Channel.SYSTEM_MOUSEDOWN,
    handler
  )
}

global.onMouseup = handler => {
  return createHandlerWrapper(
    Channel.SYSTEM_MOUSEUP,
    handler
  )
}

global.onMousemove = handler => {
  return createHandlerWrapper(
    Channel.SYSTEM_MOUSEMOVE,
    handler
  )
}

global.onWheel = handler => {
  return createHandlerWrapper(Channel.SYSTEM_WHEEL, handler)
}

global.onKeydown = handler => {
  return createHandlerWrapper(
    Channel.SYSTEM_KEYDOWN,
    handler
  )
}

global.onKeyup = handler => {
  return createHandlerWrapper(Channel.SYSTEM_KEYUP, handler)
}

let _exec = global.exec
global.exec = (
  command: string,
  options = { shell: true, all: true, cwd: process.cwd() }
) => {
  let child = _exec(command, options)
  if (child?.all) child.all.pipe(process.stdout)
  return child as any
}

let displayChoices = async ({
  choices,
  className,
  scripts,
  generated,
  inputRegex,
}: DisplayChoicesProps) => {
  switch (typeof choices) {
    case "string":
      global.setPanel(choices, className)
      break

    case "object":
      if (choices === null) {
        global.setChoices(null)
      } else {
        let resultChoices = checkResultInfo(choices)
        global.setChoices(resultChoices, {
          className,
          generated: Boolean(generated),
          inputRegex: inputRegex || ``,
        })
      }

      break
  }
}

let checkResultInfo = result => {
  if (result?.preview) {
    global.setPanel(result.preview, result?.className || "")
  }
  if (result?.panel) {
    global.setPanel(result.panel, result?.className || "")
  }
  if (result?.hint) {
    global.setHint(result.hint)
  }
  if (result?.choices) {
    return result.choices
  }

  return result
}

interface InvokeChoicesProps extends DisplayChoicesProps {
  promptId: number
  tabIndex: number
}

let invocation = 0
let invokeChoices = async (props: InvokeChoicesProps) => {
  invocation++
  let localInvocation = invocation
  if (!props?.choices) return

  if (Array.isArray(props.choices)) {
    displayChoices(props)
    return props.choices
  }
  let resultOrPromise = (props.choices as Function)(
    props.state.input
  )

  if (resultOrPromise && resultOrPromise.then) {
    let result = await resultOrPromise
    if (localInvocation !== invocation) return
    if (
      props.promptId === promptId &&
      props.tabIndex === global.onTabIndex
    ) {
      displayChoices({
        ...props,
        choices: result,
        generated: (props.choices as Function).length !== 0,
      })
      return result
    }
  } else {
    displayChoices({
      ...props,
      choices: resultOrPromise,
      generated: (props.choices as Function).length !== 0,
    })
    return resultOrPromise
  }
}

let getInitialChoices = async (
  props: InvokeChoicesProps
) => {
  if (Array.isArray(props.initialChoices)) {
    setChoices(props.initialChoices)
    return
  }
  if (!Array.isArray(props.choices)) {
    setChoices([])
  }
  if (typeof props?.choices === "function") {
    log({ getInitialChoices: props?.choices?.length })
    return await invokeChoices({ ...props })
  } else {
    displayChoices(props)
    return props.choices
  }
}

interface WaitForPromptValueProps
  extends DisplayChoicesProps {
  validate?: PromptConfig["validate"]
}

let invalid = Symbol("invalid")
global.preventSubmit = Symbol("preventSubmit")

let truncate = (str: string, length: number) => {
  if (str.length > length) {
    return str.slice(0, length) + "..."
  }
  return str
}

let createOnChoiceFocusDefault = (
  debounceChoiceFocus: number,
  onUserChoiceFocus?: ChannelHandler
) => {
  let _promptId = promptId
  let debouncedChoiceFocus = debounce(
    async (input: string, state: AppState = {}) => {
      if (_promptId !== promptId) return
      let preview = ``

      let { index, focused } = state
      let { id } = focused

      let currentChoices = (
        global?.kitPrevChoices || []
      ).concat(global?.kitFlagsAsChoices || [])
      let choice = currentChoices.find(
        (c: Choice) => c?.id === id
      )

      if (choice?.onFocus) {
        try {
          choice?.onFocus(input, state)
        } catch (error) {
          throw new Error(error)
        }
      }

      if (
        choice &&
        choice?.preview &&
        typeof choice?.preview === "function"
      ) {
        ;(choice as any).index = index
        ;(choice as any).input = input

        try {
          preview = await choice?.preview(input, state)
        } catch {
          preview = md(`# Failed to render preview... 🤔`)
        }

        setPreview(preview)
      }

      if (global?.__currentPromptConfig?.shortcuts) {
        const shortcuts =
          global?.__currentPromptConfig?.shortcuts?.filter(
            shortcut => {
              if (shortcut?.condition) {
                return shortcut.condition(state.focused)
              }
              return true
            }
          )

        send(Channel.SET_SHORTCUTS, shortcuts)
      }

      if (typeof onUserChoiceFocus === "function")
        onUserChoiceFocus(input, state)
    },
    debounceChoiceFocus
  )
  return debouncedChoiceFocus
}

let onTabChanged = (input, state) => {
  let { tab } = state
  let tabIndex = global.onTabs.findIndex(({ name }) => {
    return name == tab
  })

  global.onTabIndex = tabIndex
  global.currentOnTab = global.onTabs?.[tabIndex]?.fn(input)
}

// If you call a prompt while a prompt is already running, end the stream
// This is especially important when switching tabs
global.__kitEndPrevPromptSubject = new Subject()
global.__kitPromptState = {}
global.finishPrompt = () => {}
let waitForPromptValue = ({
  ui,
  choices,
  initialChoices,
  validate,
  className,
  onNoChoices,
  onInput,
  onFlagInput,
  onSelected,
  onChange,
  onEscape,
  onAbandon,
  onBack,
  onForward,
  onUp,
  onDown,
  onTab,
  onKeyword,
  onChoiceFocus,
  onMessageFocus,
  onBlur,
  onLeft,
  onRight,
  onPaste,
  onDrop,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onMenuToggle,
  onInit,
  onSubmit,
  onValidationFailed,
  onAudioData,
  state,
  shortcuts,
  inputRegex,
}: WaitForPromptValueProps) => {
  global.actionFlag = ""
  global.__kitPromptState = {}
  global.__kitEndPrevPromptSubject.next()
  return new Promise((resolve, reject) => {
    if (
      ui === UI.arg ||
      ui === UI.hotkey ||
      ui === UI.div
    ) {
      getInitialChoices({
        promptId,
        tabIndex: global.onTabIndex,
        choices,
        initialChoices,
        className,
        onNoChoices,
        state,
        inputRegex,
      })
    } else {
      setChoices([])
    }

    global.__kitPromptSubject = new Subject()
    let process$ = merge(
      global.__kitPromptSubject as Subject<AppMessage>,
      new Observable<AppMessage>(observer => {
        let messageHandler = (data: AppMessage) => {
          observer.next(data)
        }
        let errorHandler = (error: Error) => {
          observer.error(error)
        }

        global.finishPrompt()
        process.on("message", messageHandler)
        process.on("error", errorHandler)

        global.finishPrompt = () => {
          process.off("message", messageHandler)
          process.off("error", errorHandler)
          global.finishPrompt = () => {}
        }

        return global.finishPrompt
      })
    ).pipe(
      takeUntil(global.__kitEndPrevPromptSubject),
      share()
    )

    let tab$ = process$.pipe(
      filter(data => data.channel === Channel.TAB_CHANGED),
      share()
    )

    let message$ = process$.pipe(takeUntil(tab$), share())

    let valueSubmitted$ = message$.pipe(
      filter(
        data => data.channel === Channel.VALUE_SUBMITTED
      ),
      share()
    )

    let value$ = valueSubmitted$.pipe(
      tap(data => {
        if (data.state?.flag) {
          global.flag[data.state?.flag] = true
          global.actionFlag = data.state?.flag || ""
        }
      }),
      switchMap(async (data: AppMessage) => {
        if (!data?.state) {
          global.warn(
            `AppMessage failed: ${JSON.stringify(
              data,
              null,
              2
            )}`
          )
          return
        }
        let { value, focused, multiple, selected } =
          data?.state
        let choice = (global.kitPrevChoices || []).find(
          (c: Choice) => c.id === focused?.id
        )

        // handle when a select prompt uses a flag
        if (multiple) {
          return selected
        }

        // TODO: Dont use onSubmit for chat component? onUserMessage maybe?
        if (global.__kitPromptState?.ui !== UI.chat) {
          let checkPreventSubmit: any

          if (!data?.state?.flag) {
            if (choice?.onSubmit) {
              checkPreventSubmit = await choice?.onSubmit(
                data?.state?.input,
                data?.state
              )
            } else {
              checkPreventSubmit = await onSubmit(
                data?.state?.input,
                data.state
              )
            }
          }

          if (checkPreventSubmit === preventSubmit) {
            send(Channel.PREVENT_SUBMIT)
            return preventSubmit
          }
        }

        // TODO: Refactor out an invalid$ stream
        if (validate) {
          let validateMessage = await validate(value)
          if (
            typeof validateMessage === "boolean" &&
            !validateMessage
          ) {
            send(
              Channel.VALUE_INVALID,
              chalk`${value} is {red not valid}`
            )
            return invalid
          }

          if (typeof validateMessage === "string") {
            send(Channel.VALUE_INVALID, validateMessage)

            return invalid
          } else {
            return value
          }
        } else {
          return value
        }
      }),
      filter(
        value =>
          value !== invalid && value !== preventSubmit
      ),
      take(1),
      share()
    )

    tab$.pipe(takeUntil(value$)).subscribe(data => {
      onTabChanged(data.state.input, data.state)
    })

    message$.pipe(takeUntil(value$), share()).subscribe({
      next: async data => {
        // if (data?.promptId !== global.__kitPromptId) {
        //   log(
        //     `🤔 ${data?.channel} ${data?.promptId} : ${global.__kitPromptId} Received "prompt" message from an unmatched prompt`
        //   )
        //   return
        // }
        if (data?.state?.input === Value.Undefined) {
          data.state.input = ""
        }

        global.__kitPromptState = data.state

        switch (data.channel) {
          case Channel.PING:
            send(Channel.PONG)
            break

          case Channel.ON_SUBMIT:
            await onSubmit(data.state.input, data.state)
            break

          case Channel.INPUT:
            onInput(data.state.input, data.state)
            break

          case Channel.ACTION:
            if (data?.state?.action?.name) {
              let f = global.kitFlagsAsChoices?.find(
                f => f?.name === data?.state?.action?.name
              )
              if (f?.onAction) {
                await f?.onAction(
                  data?.state?.input,
                  data.state
                )
              }
            }

            break

          case Channel.FLAG_INPUT:
            onFlagInput(data.state.input, data.state)
            break

          case Channel.SELECTED:
            onSelected(data.state.input, data.state)
            break

          case Channel.CHANGE:
            onChange(data.state.input, data.state)
            break

          case Channel.NO_CHOICES:
            onNoChoices(data.state.input, data.state)
            break

          case Channel.ESCAPE:
            onEscape(data.state.input, data.state)

            break

          case Channel.BACK:
            onBack(data.state.input, data.state)
            break

          case Channel.FORWARD:
            onForward(data.state.input, data.state)
            break

          case Channel.UP:
            onUp(data.state.input, data.state)
            break

          case Channel.DOWN:
            onDown(data.state.input, data.state)
            break

          case Channel.LEFT:
            onLeft(data.state.input, data.state)
            break

          case Channel.RIGHT:
            onRight(data.state.input, data.state)
            break

          case Channel.TAB:
            onTab(data.state.input, data.state)
            break

          case Channel.KEYWORD_TRIGGERED:
            onKeyword(data.state.input, data.state)
            break

          case Channel.CHOICE_FOCUSED:
            onChoiceFocus(data.state.input, data.state)
            break

          case Channel.MESSAGE_FOCUSED:
            onMessageFocus(data.state.input, data.state)
            break

          case Channel.BLUR:
            onBlur(data.state.input, data.state)
            break

          case Channel.ABANDON:
            global.__kitAbandoned = true
            onAbandon(data.state.input, data.state)
            break

          case Channel.SHORTCUT:
            if (data?.state?.flag) {
              global.flag[data.state.flag] = true
              global.actionFlag = data.state.flag || ""
            }
            const shortcut = (
              global.__currentPromptConfig?.shortcuts || []
            )?.find(({ key }) => {
              return key === data?.state?.shortcut
            })

            if (shortcut?.onPress) {
              shortcut.onPress?.(
                data.state.input,
                data.state
              )
            } else if (shortcut) {
              submit(shortcut.value || shortcut.name)
            }

            if (data.state.shortcut === "enter") {
              if (data?.state?.multiple) {
                submit(data?.state?.selected)
              } else {
                submit(
                  data?.state?.focused?.value ||
                    data?.state?.input
                )
              }
            }

            break

          case Channel.ON_PASTE:
            onPaste(data.state.input, data.state)
            break

          case Channel.ON_DROP:
            onDrop(data.state.input, data.state)
            break

          case Channel.ON_DRAG_ENTER:
            onDragEnter(data.state.input, data.state)
            break

          case Channel.ON_DRAG_LEAVE:
            onDragLeave(data.state.input, data.state)
            break

          case Channel.ON_DRAG_OVER:
            onDragOver(data.state.input, data.state)
            break

          case Channel.ON_MENU_TOGGLE:
            onMenuToggle(data.state.input, data.state)
            break

          case Channel.ON_INIT:
            onInit(data.state.input, data.state)
            break

          case Channel.ON_VALIDATION_FAILED:
            onValidationFailed(data.state.input, data.state)
            break

          case Channel.ON_AUDIO_DATA:
            if (
              typeof data?.state?.value === "string" &&
              data?.state?.value?.startsWith("data:")
            ) {
              // log(`Found data.state.value`)
              const [header, content] =
                data.state.value.split(",")
              const [type, encoding] = header.split(";")
              // log(`decoding ${encoding} ${type}`)
              if (encoding === "base64") {
                data.state.value = Buffer.from(
                  content,
                  "base64"
                )
              }
            }
            onAudioData(data.state.input, data.state)
            break

          case Channel.SCRIPTS_CHANGED:
            global.__kitScriptsFromCache = false
            break
        }
      },
      // TODO: Add a kit log
      // TODO: Why abandon on CLI?
      complete: () => {
        // global.log(
        //   `${process.pid}: ✂️  Remove all handlers`
        // )
      },
    })

    value$.subscribe({
      next: value => {
        if (value?.data) {
          console.log(`Found value.data`)
          value = value.data
        }
        if (
          typeof value === "string" &&
          value.startsWith("data:")
        ) {
          const [header, content] = value.split(",")
          const [type, encoding] = header.split(";")

          // log(`decoding ${encoding} ${type}`)

          if (encoding === "base64") {
            value = Buffer.from(content, "base64")
          }
        }

        // for (let eventName of process.eventNames()) {
        //   let count = process.listenerCount(eventName)

        //   console.log(
        //     `${process.pid}: ✅  ${String(
        //       eventName
        //     )} ${count} listeners left.`
        //   )
        // }

        global.finishPrompt()
        resolve(value)

        global.__kitAddErrorListeners()
      },
      complete: () => {
        // global.log(
        //   `${process.pid}: Prompt #${promptId} complete 👍`
        // )
      },
      error: error => {
        reject(error)
      },
    })
  })
}

let onNoChoicesDefault = async (input: string) => {
  setPreview(``)
}

let onEscapeDefault: ChannelHandler = async (
  input: string,
  state: AppState
) => {
  send(Channel.BEFORE_EXIT)
  finishScript()
}

let onAbandonDefault = () => {
  global.log(
    `${process.pid}: Abandon caused exit. Provide a "onAbandon" handler to override.`
  )
  finishScript()
}

let onBackDefault = async () => {}
let onForwardDefault = async () => {}
let onUpDefault = async () => {}
let onDownDefault = async () => {}
let onLeftDefault = async () => {}
let onRightDefault = async () => {}
let onTabDefault = async () => {}
let onMessageFocusDefault = async () => {}
let onFlagInputDefault = async () => {}
let onSelectedDefault = async () => {}

let onKeywordDefault = async (input, state) => {
  if (!state.keyword) {
    await mainScript(state.input)
  }
}
let onMenuToggleDefault = async (input, state) => {
  if (state.flaggedValue) {
    let localChoice: Choice = (
      global.kitPrevChoices || []
    ).find((c: Choice) => c.id === state?.focused?.id)
    if (localChoice && localChoice?.actions) {
      let flags = getFlagsFromActions(localChoice?.actions)
      setFlags(flags)
    }
  }
}
let onPasteDefault = async (input, state) => {
  if (state.paste) setSelectedText(state.paste, false)
}
let onDropDefault = async (input, state) => {
  log(`onDrop`)
  if (state.drop && state.ui === UI.arg) {
    setInput(state.drop)
  }
  await focus()
}

let onDragEnterDefault = async (input, state) => {
  log(`onDragEnter`)
}
let onDragLeaveDefault = async (input, state) => {
  log(`onDragLeave`)
}
let onDragOverDefault = async (input, state) => {
  log(`onDragOver`)
}

let onInitDefault = async (input, state) => {}
let onSubmitDefault = async (input, state) => {}
let onValidationFailedDefault = async (input, state) => {}
let onAudioDataDefault = async (input, state) => {}

global.setPrompt = (data: Partial<PromptData>) => {
  let { tabs } = data
  if (tabs) global.onTabs = tabs

  // let id = uuid()
  let id = `${global.kitScript}-${promptId}`
  global.__kitPromptId = id
  global.send(Channel.SET_PROMPT_DATA, {
    id,
    scriptPath: global.kitScript,
    flags: prepFlags(data?.flags),
    hint: "",
    ignoreBlur: false,
    input: "",
    kitScript: global.kitScript,
    kitArgs: global.args,
    mode: Mode.FILTER,
    placeholder: "",
    panel: "",
    preview: "",
    secret: false,
    selected: "",
    strict: false,
    tabs: global.onTabs?.length
      ? global.onTabs.map(({ name }) => name)
      : [],
    tabIndex: 0,
    type: "text",
    ui: UI.arg,
    resize: false,
    env: global.env,
    ...(data as PromptData),
  })
}

global.kitShortcutsMap = new Map()

let prepPrompt = async (config: PromptConfig) => {
  let escapeDefault = Boolean(
    !config?.onEscape ||
      config?.onEscape === onEscapeDefault
  )
  let hasEscapeShortcut = Boolean(
    (config?.shortcuts || []).find(s => s.key === `escape`)
  )

  if (config?.actions) {
    let actionsFlags = getFlagsFromActions(config.actions)

    if (typeof config?.flags === "object") {
      config.flags = {
        ...config.flags,
        ...actionsFlags,
      }
    } else {
      config.flags = actionsFlags
    }
  }

  global.kitShortcutsMap.clear()
  if (Array.isArray(config?.actions)) {
    for (let action of config?.actions) {
      if (action?.shortcut) {
        global.kitShortcutsMap.set(
          action.shortcut,
          action.name
        )
      }
    }
  }

  for (let shortcut of config?.shortcuts || []) {
    if (shortcut?.key) {
      global.kitShortcutsMap.set(
        shortcut.key,
        shortcut.name
      )
    }
  }

  let {
    choices,
    placeholder,
    footer,
    preview,
    previewWidthPercent,
    panel,
    onInputSubmit = {},
    hideOnEscape,
    keyword = config?.ui !== UI.arg ? "" : undefined,
    ...restConfig
  } = config

  if (typeof keyword === "string") {
    delete arg?.keyword
  }

  if (typeof hideOnEscape === "undefined") {
    hideOnEscape = Boolean(
      escapeDefault && !hasEscapeShortcut
    )
  }
  let choicesAreAFunction = typeof choices === "function"
  let choicesHasAnInputArg =
    (choices as Function)?.length > 0

  let mode =
    !choicesAreAFunction || !choicesHasAnInputArg
      ? Mode.FILTER
      : Mode.GENERATE

  let promptData = {
    footer: footer || "",
    strict: Boolean(choices),
    hasPreview: Boolean(preview),
    headerClassName: "",
    footerClassName: "",
    inputClassName: "",
    css: "",
    preventCollapse: false,
    ...restConfig,
    onInputSubmit,
    tabIndex: global.onTabs?.findIndex(
      ({ name }) => global.arg?.tab
    ),
    mode,
    placeholder: stripAnsi(placeholder || ""),
    panel:
      panel && typeof panel === "function"
        ? await (panel as Function)()
        : (panel as string),
    preview:
      preview && typeof preview === "function"
        ? await (preview as Function)()
        : (preview as string),
    previewWidthPercent: previewWidthPercent || 60,
    env: config?.env || global.env,
    choicesType: determineChoicesType(choices),
    hasOnNoChoices: Boolean(config?.onNoChoices),
    inputCommandChars: config?.inputCommandChars || [],
    hideOnEscape,
    keyword,
    searchKeys: config?.searchKeys || [
      "slicedName",
      "friendlyShortcut",
      "tag",
      "group",
      "command",
    ],
  }

  global.setPrompt(promptData as PromptData)
}

let createOnInputDefault = (
  choices,
  className,
  debounceInput
) => {
  let choicesAreAFunction = typeof choices === "function"
  let choicesHasAnInputArg = choices?.length > 0

  if (!choicesAreAFunction || !choicesHasAnInputArg) {
    return async () => {}
  }

  // "input" is on the state, so this is only provided as a convenience for the user
  let _promptId = promptId
  return debounce(async (input, state) => {
    if (_promptId !== promptId) return
    return invokeChoices({
      promptId,
      tabIndex: global.onTabIndex,
      choices,
      className,
      state,
    })
  }, debounceInput)
}

let createOnActionInputDefault = (
  actions,
  className,
  debounceInput
) => {
  let actionsAreAFunction = typeof actions === "function"
  let actionsHasAnInputArg = actions?.length > 0

  if (!actionsAreAFunction || !actionsHasAnInputArg) {
    return async () => {}
  }

  // "input" is on the state, so this is only provided as a convenience for the user
  let _promptId = promptId
  return debounce(async (input, state) => {
    if (_promptId !== promptId) return
    let result = await actions(input, state)
    return setFlags(getFlagsFromActions(result))
  }, debounceInput)
}

let onBlurDefault = () => {
  global.log(
    `${process.pid}: Blur caused exit. Provide a "onBlur" handler to override.`
  )
  finishScript()
}

let onChangeDefault = () => {}

let determineChoicesType = choices => {
  if (!choices) return "null"
  if (typeof choices === "function") {
    if (choices.constructor.name === "AsyncFunction")
      return "async"
    return "function"
  } else if (Array.isArray(choices)) {
    return "array"
  } else if (typeof choices === "string") {
    return "string"
  }
}

global.__currentPromptSecret = false
global.__currentPromptConfig = {}

global.kitPrompt = async (config: PromptConfig) => {
  promptId++
  global.__currentPromptSecret = config.secret || false
  let ui = config?.ui || UI.arg
  global.__kitCurrentUI = ui

  //need to let onTabs() gather tab names. See Word API
  if (global?.onTabs?.length) {
    await new Promise(r => setTimeout(r, 0))
  }

  config.shortcuts ||= []
  config.width ||= PROMPT.WIDTH.BASE

  // if (!config.shortcuts.find(s => s.key === `escape`)) {
  //   config.shortcuts.push({
  //     ...backToMainShortcut,
  //     bar: "",
  //   })
  // }

  if (!config.shortcuts.find(s => s.key === `${cmd}+o`)) {
    config.shortcuts.push({
      ...editScriptShortcut,
      bar: "",
    })
  }

  if (!config.shortcuts.find(s => s.key === `${cmd}+w`)) {
    config.shortcuts.push({
      ...closeShortcut,
      bar: "",
    })
  }

  if (!config.shortcuts.find(s => s.key === `${cmd}+/`)) {
    config.shortcuts.push({
      ...shortcutsShortcut,
      bar: "",
    })
  }

  if (config?.ignoreBlur && !config?.onBlur) {
    config.onBlur = () => {}
  }
  if (config?.onBlur) {
    config.ignoreBlur = true
  }

  if (typeof config?.keyword === "string") {
    delete arg?.keyword
  }

  if (config?.focused) {
    config.defaultValue = config.focused
  }

  if (config?.focusedId) {
    config.defaultChoiceId = config.focusedId
  }

  let {
    input = "",
    inputRegex = arg?.keyword
      ? `(?<=${arg?.keyword}\\s)(.*)`
      : "",
    choices = null,
    initialChoices = null,
    className = "",
    validate = null,
    onNoChoices = onNoChoicesDefault,
    onEscape = onEscapeDefault,
    onAbandon = onAbandonDefault,
    onBack = onBackDefault,
    onForward = onForwardDefault,
    onUp = onUpDefault,
    onDown = onDownDefault,
    onLeft = onLeftDefault,
    onRight = onRightDefault,
    onTab = onTabDefault,
    onKeyword = onKeywordDefault,
    debounceChoiceFocus = 0,
    onChoiceFocus,
    onMessageFocus = onMessageFocusDefault,
    debounceInput = 200,
    onInput = createOnInputDefault(
      choices,
      className,
      debounceInput
    ),
    onFlagInput = createOnActionInputDefault(
      config?.actions,
      className,
      debounceInput
    ),
    onSelected = onSelectedDefault,
    onChange = onChangeDefault,
    onBlur = onBlurDefault,
    onPaste = onPasteDefault,
    onDrop = onDropDefault,
    onMenuToggle = onMenuToggleDefault,
    onDragEnter = onDragEnterDefault,
    onDragLeave = onDragLeaveDefault,
    onDragOver = onDragOverDefault,
    onInit = onInitDefault,
    onSubmit = onSubmitDefault,
    onValidationFailed = onValidationFailedDefault,
    onAudioData = onAudioDataDefault,
  } = config

  global.__currentPromptConfig = config
  await prepPrompt(config)

  let choiceFocus = createOnChoiceFocusDefault(
    debounceChoiceFocus,
    onChoiceFocus
  )

  return await waitForPromptValue({
    ui,
    choices,
    validate,
    className,
    onInput,
    onFlagInput,
    onSelected,
    onChange,
    onNoChoices,
    onEscape,
    onAbandon,
    onBack,
    onForward,
    onUp,
    onDown,
    onLeft,
    onRight,
    onKeyword,
    onTab,
    onChoiceFocus: choiceFocus,
    onMessageFocus,
    onBlur,
    onPaste,
    onDrop,
    onDragEnter,
    onDragLeave,
    onDragOver,
    onMenuToggle,
    onInit,
    onSubmit,
    onValidationFailed,
    onAudioData,
    shortcuts: config.shortcuts,
    state: { input },
    inputRegex,
    initialChoices,
  })
}

global.drop = async (
  placeholder = "Drop something here..."
) => {
  let config: Partial<PromptConfig> =
    typeof placeholder === "string"
      ? { placeholder }
      : placeholder

  return await global.kitPrompt({
    ui: UI.drop,
    enter: "",
    width: config?.preview
      ? PROMPT.WIDTH.BASE
      : PROMPT.WIDTH.XXS,
    height: PROMPT.WIDTH.XXS,
    shortcuts: [escapeShortcut, closeShortcut],
    ...config,
    ignoreBlur: true,
  })
}

global.emoji = async (config?: PromptConfig) => {
  return await global.kitPrompt({
    ui: UI.emoji,
    enter: "Select",
    shortcuts: [escapeShortcut],
    ignoreBlur: true,
    width: 350,
    height: 510,
    ...config,
  })
}

global.showEmojiPanel = () => {
  send(Channel.SHOW_EMOJI_PANEL)
}

global.fields = async formFields => {
  let config: Parameters<Fields>[0] = []
  let f = []
  if (
    Array.isArray(formFields) &&
    !(formFields as any)[0]?.fields // not sure if I can safely deprecate this
  ) {
    f = formFields
  } else {
    config = formFields
    f = (config as any)?.fields
  }

  let inputs = f
    .map((field, i) => {
      let defaultElement: any = {
        element: "input",
        label: "Label",
      }
      let fieldString = typeof field === "string"
      if (fieldString) {
        defaultElement.label = field
        defaultElement.placeholder = field
      } else {
        Object.entries(field).forEach(([key, value]) => {
          defaultElement[key] = value
        })
      }
      if (global.args.length) {
        defaultElement.value = global.args.shift()
      }
      let { element, label, id, name, ...attrs } =
        defaultElement
      let attributes = Object.entries(attrs)
        .map(([key, value]) => {
          return ` ${key}="${value}" `
        })
        .join("")
      // log(attributes)
      return `
      <div class="w-full pt-4 flex flex-col-reverse">
           
              <${element}
                  id="${id || i}"
                  name="${name || i}"
                  data-name="${
                    name ? name : fieldString ? field : i
                  }"
                  ${
                    i === 0 ? `autofocus` : ``
                  }                  
                  ${attributes}   
                  class="peer text-xl h-10 px-4 py-0 outline-none border-b border-opacity-25 placeholder-text-base placeholder-opacity-25 border-text-base border-opacity-15 focus:border-primary w-full"/>

                  <label for=${id || i} htmlFor=${
        id || i
      } class="text-sm px-4 block font-normal text-text-base text-opacity-75 peer-focus:text-primary peer-focus:text-opacity-90">
                          ${label}
                        </label>
          </div>
      
      `
    })
    .join("")

  ;(
    config as PromptConfig
  ).html = `<div class="flex flex-col items-center min-h-full flex-1 w-full">

${inputs}

<div class="w-full px-4 invisible h-0">
<input type="reset" name="reset-form" value="Reset" accesskey="r"> class="focus:underline underline-offset-4 outline-none p-3 dark:text-white text-opacity-50 dark:text-opacity-50 font-medium text-sm focus:text-text-base dark:focus:text-primary-light  hover:text-text-base dark:hover:text-primary-light hover:underline dark:hover:underline"/>
<input type="submit" name="submit-form" value="Submit" class="focus:underline underline-offset-4 outline-none p-3 text-contrast-dark dark:text-contrast-light text-opacity-75 dark:text-opacity-75 font-medium text-sm focus:text-text-base dark:focus:text-primary-light hover:text-text-base dark:hover:text-primary-light hover:underline dark:hover:underline bg-opacity-75 dark:bg-opacity-75"/>
</div>
</div>`
  ;(config as PromptConfig).shortcuts = formShortcuts

  if (typeof (config as PromptConfig).enter !== "string") {
    ;(config as PromptConfig).enter = "Submit"
  }

  let formResponse = await global.form(
    config as PromptConfig
  )
  return formResponse.orderedValues
}

global.setDisableSubmit = async (disable = true) => {
  await sendWait(Channel.SET_DISABLE_SUBMIT, disable)
}

global.setFormData = async (formData = {}) => {
  await sendWait(Channel.SET_FORM_DATA, formData)
}

global.form = async (html = "", formData = {}) => {
  let config: PromptConfig = {}
  if ((html as PromptConfig)?.html) {
    config = html as PromptConfig
    config.formData = formData
  } else {
    config = {
      html: html as string,
      formData,
    }
  }

  config.ui = UI.form
  if (typeof config.enter !== "string") {
    config.enter = "Submit"
  }
  config.shortcuts ||= formShortcuts

  return await global.kitPrompt(config)
}

// global.form = async (
//   ...fields: PromptConfig[] | string[]
// ) => {
//   let configs: PromptConfig[] = []

//   for await (let f of fields) {
//     if (typeof f === "string") {
//       configs.push({
//         placeholder: f,
//       })
//     } else {
//       configs.push(f)
//     }
//   }
//   send(Channel.SET_FORM, configs)
// }

let maybeWrapHtml = (html = "", containerClasses = "") => {
  return containerClasses?.length === 0
    ? html
    : `<div class="${containerClasses}">${html}</div>`
}

global.div = async (
  htmlOrConfig = "",
  containerClasses = ""
) => {
  let config: {
    html?: string
  } =
    typeof htmlOrConfig === "string"
      ? { html: htmlOrConfig }
      : htmlOrConfig

  if (config.html.trim() === "")
    htmlOrConfig = md("⚠️ html string was empty")
  return await global.kitPrompt({
    enter: `Continue`,
    shortcuts: [escapeShortcut],
    ...config,
    choices: maybeWrapHtml(config?.html, containerClasses),
    ui: UI.div,
  })
}

global.docs = async (filePath: string, options = {}) => {
  let fileMarkdown = await readFile(filePath, "utf-8")
  let lexer = new marked.Lexer()
  let tokens = lexer.lex(fileMarkdown)

  let sections: GuideSection[] = []
  let placeholder = ""
  let group = ""
  let order = []
  let useGroups = tokens.find(
    t => t.type === "heading" && t.depth === 3
  )

  let parseKVFromText = (text: string) => {
    return (
      text
        .replace(/<!--(.*)-->/, "$1")
        .trim()
        // Only split on the first colon and filter out empty strings
        .split(/:(.+)/)
        .map(s => s.trim())
        .filter(s => s.length > 0)
    )
  }

  let h1Value = ""
  let h2Value = ""
  let currentHeading = ""

  for (let token of tokens) {
    if (token.type === "heading" && token.depth < 3) {
      currentHeading = `h${token.depth}`
    }

    if (token.type === "heading" && token.depth === 1) {
      setName(token.text)
      placeholder = token.text

      continue
    }

    if (
      token.type === "heading" &&
      token.depth === 2 &&
      useGroups
    ) {
      group = token.text
      if (!order.includes(group)) order.push(group)
    } else if (
      token.type === "heading" &&
      token.depth === 3
    ) {
      sections.push({
        name: token.text,
        group,
        raw: `# ${token.text}\n\n`,
        comments: {
          // TODO: determine if we want to keep a strategy where values can default to the parent heading value
          // value: h2Value || h1Value,
        },
      })
    } else if (
      token.type === "html" &&
      token.text.startsWith("<!--")
    ) {
      // Fallback to h2/h1s
      let [key, value] = parseKVFromText(token.text)
      let trimmedValue = value.trim()
      if (key === "value") {
        if (currentHeading === "h1") {
          h1Value = trimmedValue
        } else if (currentHeading === "h2") {
          h2Value = trimmedValue
        }
      }

      if (sections.length) {
        sections[sections.length - 1].comments[key.trim()] =
          trimmedValue
      }
    } else if (sections.length) {
      sections[sections.length - 1].raw += token.raw
    }
  }

  let config =
    typeof options === "function"
      ? await options(sections, tokens)
      : options

  let containerClasses =
    "p-5 prose dark:prose-dark prose-sm"

  let choices = sections.map(section => {
    let value = section?.comments?.value || section?.name

    return {
      name: section.name,
      className: "text-base",
      preview: async () =>
        highlight(section.raw, containerClasses),
      value,
      ...section.comments,
      group: section?.group,
    }
  })

  let groupedChoices = groupChoices(choices, {
    order,
    sortChoicesKey: Array.from(
      { length: order.length },
      () => false
    ),
  })

  return await arg(
    {
      placeholder,

      ...config,
    },
    groupedChoices
  )
}

global.editor = async (options?: EditorOptions) => {
  if (options?.language) {
    let fileTypes = {
      css: "css",
      js: "javascript",
      jsx: "javascript",
      json: "json",
      md: "markdown",
      mjs: "javascript",
      ts: "typescript",
      tsx: "typescript",
    }

    if (fileTypes[options?.language]) {
      options.language = fileTypes[options.language]
    }
  }

  let defaultOptions: EditorOptions = {
    value: "",
    language: "markdown",
    scrollTo: "top",
    onInput: () => {},
    onEscape: () => {},
    onAbandon: onAbandonDefault,
    onPaste: onPasteDefault,
    onDrop: onDropDefault,
    onBlur: () => {},
    ignoreBlur: true,
  }

  let editorOptions =
    typeof options === "string"
      ? { ...defaultOptions, value: options }
      : { ...defaultOptions, ...options }

  send(Channel.SET_EDITOR_CONFIG, editorOptions)

  return await global.kitPrompt({
    ui: UI.editor,
    input: editorOptions.value,
    flags: {},
    shortcuts: editorShortcuts,
    height: PROMPT.HEIGHT.XL,
    ...editorOptions,
    enter: "",
    choices: [],
    hideOnEscape: false,
  })
}

global.editor.setSuggestions = async (
  suggestions: string[] = []
) => {
  await sendWait(
    Channel.SET_EDITOR_SUGGESTIONS,
    suggestions
  )
}

global.editor.setConfig = async (config: EditorOptions) => {
  await sendWait(Channel.SET_EDITOR_CONFIG, config)
}

global.editor.append = async (value: string) => {
  await sendWait(Channel.APPEND_EDITOR_VALUE, value)
}

global.editor.getSelection = async () => {
  let message = await sendWait(Channel.EDITOR_GET_SELECTION)
  return message?.state?.value
}

global.editor.getCursorOffset = async () => {
  let message = await sendWait(
    Channel.EDITOR_GET_CURSOR_OFFSET
  )
  return message?.state?.value
}

global.editor.moveCursor = async (offset: number) => {
  let message = await sendWait(
    Channel.EDITOR_MOVE_CURSOR,
    offset
  )
  return message?.state?.value
}

global.editor.insertText = async (text: string) => {
  let message = await sendWait(
    Channel.EDITOR_INSERT_TEXT,
    text
  )
  return message?.state?.value
}

// global.editor.setCodeHint = async (value: string) => {
//   await sendWait(Channel.EDITOR_SET_CODE_HINT, value)
// }

global.template = async (
  template: string = "",
  options: EditorOptions = { language: "plaintext" }
) => {
  return global.editor({
    template,
    ...options,
    enter: "",
  })
}

global.hotkey = async (
  placeholder = "Press a key combo:"
) => {
  let config =
    typeof placeholder === "string"
      ? { placeholder }
      : placeholder

  return await global.kitPrompt({
    resize: true,
    shortcuts: [escapeShortcut],
    enter: "",
    ui: UI.hotkey,
    ...config,
  })
}

global.basePrompt = async (
  placeholderOrConfig = "Enter text...",
  choices = ``,
  actions = ``
) => {
  if (
    typeof placeholderOrConfig === "object" &&
    placeholderOrConfig?.choices
  ) {
    choices = placeholderOrConfig.choices
  }
  if (!choices) {
    setChoices([])
    if (!(placeholderOrConfig as PromptConfig)?.panel) {
      setPanel(``)
    }
  }
  let firstArg = global.args.length
    ? global.args.shift()
    : null

  let hint =
    (placeholderOrConfig as PromptConfig)?.hint || ""

  if (
    typeof firstArg !== "undefined" &&
    firstArg !== null
  ) {
    let validate = (placeholderOrConfig as PromptConfig)
      ?.validate

    if (typeof validate === "function") {
      let valid: boolean | string = await validate(firstArg)

      if (typeof valid === "boolean" && valid)
        return firstArg

      hint =
        typeof valid === "boolean" && !valid
          ? `${firstArg} is not valid`
          : (valid as string)
    } else {
      return firstArg
    }
  }

  let height = PROMPT.HEIGHT.BASE
  if (!choices)
    height =
      PROMPT.HEIGHT.HEADER +
      PROMPT.INPUT.HEIGHT.SM +
      PROMPT.HEIGHT.FOOTER
  if (typeof placeholderOrConfig === "object") {
    let {
      headerClassName = "",
      footerClassName = "",
      inputHeight,
    } = placeholderOrConfig as PromptConfig
    if (inputHeight) {
      height = inputHeight
    }
    if (headerClassName.includes("hidden")) {
      height -= PROMPT.HEIGHT.HEADER
    }

    if (footerClassName.includes("hidden")) {
      height -= PROMPT.HEIGHT.FOOTER
    }
  }

  let promptConfig: PromptConfig = {
    ui: UI.arg,
    enter: "Submit",
    inputHeight: PROMPT.INPUT.HEIGHT.SM,
    itemHeight: PROMPT.ITEM.HEIGHT.SM,
    hint,
    height,
    resize: !choices ? true : undefined,
    shortcuts: (placeholderOrConfig as PromptConfig)?.resize
      ? smallShortcuts
      : argShortcuts,
    choices,
    actions,
    preview:
      typeof actions === "string" ? actions : undefined,
  }

  if (
    Array.isArray(choices) &&
    !(choices as Choice[]).find(c => c?.preview)
  ) {
    promptConfig.resize ??= true
  }

  if (typeof placeholderOrConfig === "string") {
    promptConfig.placeholder = placeholderOrConfig
  }

  if (typeof placeholderOrConfig === "object") {
    promptConfig = {
      ...promptConfig,
      ...(placeholderOrConfig as any),
    }
  }

  return await global.kitPrompt(promptConfig)
}

global.select = async (
  placeholderOrConfig = "Type a value:",
  choices = [],
  actions = []
) => {
  let config: PromptConfig = {
    multiple: true,
    enter: "Select",
    shortcuts: [
      {
        name: "Toggle All",
        key: `${cmd}+a`,
        onPress: async (input, state) => {
          toggleAllSelectedChoices()
        },
        bar: "right",
        visible: true,
      },
      {
        name: "Submit",
        key: `${cmd}+enter`,
        onPress: async (input, state) => {
          submit(state.selected)
        },
        bar: "right",
        visible: true,
      },
    ],
  }

  if (typeof placeholderOrConfig === "string") {
    config.placeholder = placeholderOrConfig
  } else {
    config = {
      ...config,
      ...(placeholderOrConfig as PromptConfig),
    }
  }

  return await arg(config, choices, actions)
}

global.mini = async (
  placeholderOrConfig = "Type a value:",
  choices = ``,
  actions = ``
) => {
  let miniConfig = {
    headerClassName: "hidden",
    footerClassName: "hidden",
    inputHeight: PROMPT.INPUT.HEIGHT.SM,
    itemHeight: PROMPT.ITEM.HEIGHT.SM,
    height: PROMPT.INPUT.HEIGHT.SM,
    placeholder: "",
  }

  if (typeof placeholderOrConfig === "string") {
    miniConfig.placeholder = placeholderOrConfig
  }

  if (typeof placeholderOrConfig === "object") {
    miniConfig = {
      ...miniConfig,
      ...(placeholderOrConfig as PromptConfig),
    }
  }

  return await global.basePrompt(
    miniConfig,
    choices,
    actions
  )
}

global.micro = async (
  placeholderOrConfig = "Type a value:",
  choices = ``,
  actions = ``
) => {
  let microConfig = {
    headerClassName: "hidden",
    footerClassName: "hidden",
    inputHeight: PROMPT.INPUT.HEIGHT.XS,
    itemHeight: PROMPT.ITEM.HEIGHT.XS,
    height: PROMPT.INPUT.HEIGHT.XS,
    width: PROMPT.WIDTH.XS,
    placeholder: "",
  }

  if (typeof placeholderOrConfig === "string") {
    microConfig.placeholder = placeholderOrConfig
  }

  if (typeof placeholderOrConfig === "object") {
    microConfig = {
      ...microConfig,
      ...(placeholderOrConfig as PromptConfig),
    }
  }

  return await global.basePrompt(
    microConfig,
    choices,
    actions
  )
}

global.arg =
  process?.env?.KIT_MAIN_SCRIPT === "v1"
    ? global.basePrompt
    : global.mini

global.chat = async (options = {}) => {
  let messages = await global.kitPrompt({
    placeholder: "",
    ignoreBlur: true,
    resize: true,
    ui: UI.chat,
    width: PROMPT.WIDTH.BASE,
    height: PROMPT.HEIGHT.XL,
    enter: "",
    shortcuts: [
      {
        name: "Done",
        key: `${cmd}+enter`,
        onPress: async () => {
          let messages = await chat.getMessages()
          submit(messages)
        },
        bar: "right",
      },
    ],
    ...options,
  })

  return messages
}

global.chat.addMessage = async (message = {}) => {
  if (typeof message === "string") {
    message = { text: message }
  }
  let messageDefaults = {
    type: "text",
    position: "left",
    text: "",
  }
  await sendWait(Channel.CHAT_ADD_MESSAGE, {
    ...messageDefaults,
    ...message,
  })
}

global.chat.getMessages = async () => {
  return await sendWait(Channel.CHAT_GET_MESSAGES)
}

global.chat.setMessages = async (messages = []) => {
  await sendWait(Channel.CHAT_SET_MESSAGES, messages)
}

global.chat.pushToken = async (token: string = "") => {
  await sendWait(Channel.CHAT_PUSH_TOKEN, token)
}

global.chat.setMessage = async (
  index: number,
  message = ""
) => {
  if (typeof message === "string") {
    message = { text: message }
  }
  let messageDefaults = {
    type: "text",
    position: "left",
    text: "",
  }
  await sendWait(Channel.CHAT_SET_MESSAGE, {
    index,
    message: {
      ...messageDefaults,
      ...message,
    },
  })
}

global.textarea = async (options = "") => {
  let config =
    typeof options === "string"
      ? { value: options }
      : options

  return await global.kitPrompt({
    ui: UI.textarea,
    ignoreBlur: true,
    enter: "",
    shortcuts: defaultShortcuts,
    height: PROMPT.HEIGHT.XL,
    ...config,
    input: config?.value || config?.input || "",
  })
}

global.args = []
global.updateArgs = arrayOfArgs => {
  let argv = minimist(arrayOfArgs)
  global.args = [...argv._, ...global.args]
  global.argOpts = Object.entries(argv)
    .filter(([key]) => key != "_")
    .flatMap(([key, value]) => {
      if (typeof value === "boolean") {
        if (value) return [`--${key}`]
        if (!value) return [`--no-${key}`]
      }
      return [`--${key}`, value as string]
    })

  assignPropsTo(argv, global.arg)
  global.flag = { ...argv, ...global.flag }
  delete global.flag._
}

global.updateArgs(process.argv.slice(2))

export let appInstall = async packageName => {
  // don't try to install explicit built-in node modules
  if (packageName.startsWith("node:")) return

  // if it detects an import like "langchain/models", we need to adjust the package name
  // allow a slash for scoped packages like "@johnlindquist/kit"
  packageName = adjustPackageName(packageName)

  if (!global.arg?.trust) {
    let placeholder = `${packageName} is required for this script`
    setDescription(placeholder)
    setName(" ")

    let stripVersion = packageName.replace(
      /(?<=.)(@|\^|~).*/g,
      ""
    )
    let packageLink = `https://npmjs.com/package/${stripVersion}`

    let response = null
    try {
      response = await get<{ downloads: number }>(
        `https://api.npmjs.org/downloads/point/last-week/` +
          stripVersion
      )
    } catch (error) {}

    let downloads =
      response?.data?.downloads || `an unknown number of`

    let preview = md(
      `[${stripVersion}](${packageLink}) has had ${downloads} downloads from npm in the past week`
    )

    let trust = await global.arg(
      { placeholder, ignoreBlur: true },
      [
        {
          name: `Abort`,
          value: "false",
          preview,
        },
        {
          name: `Install ${packageName}`,
          value: "true",
          preview,
        },
      ]
    )

    if (trust === "false") {
      echo(`Ok. Exiting...`)
      exit()
    }
  }

  setHint(`Installing ${packageName}...`)
  setIgnoreBlur(true)

  await global.cli("install", packageName)
  console.clear()
}

let { createNpm, createKenvPackageMissingInstall } =
  await import("../api/npm.js")
global.npm = createNpm(appInstall)
global.npmInstall = createNpm(appInstall, false)
global.installMissingPackage =
  createKenvPackageMissingInstall(appInstall, false)

global.setPanel = async (h, containerClasses = "") => {
  let html = maybeWrapHtml(h, containerClasses)
  global.send(Channel.SET_PANEL, html)
}

global.setFooter = (footer: string) => {
  global.send(Channel.SET_FOOTER, footer)
}

global.setDiv = async (h, containerClasses = "") => {
  let html = maybeWrapHtml(h, containerClasses)
  global.send(Channel.SET_PANEL, html)
}

global.setPreview = async (h, containerClasses = "") => {
  let html = maybeWrapHtml(h, containerClasses)
  global.send(Channel.SET_PREVIEW, html)
  // setLoading(false)
}

global.setHint = async hint => {
  global.send(Channel.SET_HINT, hint)
}

global.setInput = async input => {
  return await global.sendWait(Channel.SET_INPUT, input)
}

global.getInput = async () => {
  let message = await global.sendWait(Channel.GET_INPUT)
  return message?.state?.input
}

global.appendInput = async text => {
  return await global.sendWait(Channel.APPEND_INPUT, text)
}

global.scrollTo = async location => {
  return await global.sendWait(Channel.SCROLL_TO, location)
}

global.setFilterInput = async inputFilter => {
  global.send(Channel.SET_FILTER_INPUT, inputFilter)
}

global.setIgnoreBlur = async ignore => {
  return global.sendWait(Channel.SET_IGNORE_BLUR, ignore)
}

global.setResize = async ignore => {
  global.send(Channel.SET_RESIZE, ignore)
}

global.setPauseResize = async pause => {
  await global.sendWait(Channel.SET_PAUSE_RESIZE, pause)
}

global.setValue = async value => {
  global.send(Channel.SET_VALUE, value)
}

global.getDataFromApp = global.sendWait = async (
  channel: GetAppData,
  data?: any,
  timeout: number = 1000
) => {
  if (process?.send) {
    return await new Promise((res, rej) => {
      let timeoutId = null
      let messageHandler = data => {
        // if (data?.promptId !== global.__kitPromptId) {
        //   log(
        //     `🤔 ${data?.channel} ${data?.promptId} : ${global.__kitPromptId} Received "sendWait" from an unmatched prompt`
        //   )
        //   return
        // }
        if (data.channel === channel) {
          res(
            typeof data?.value === "undefined"
              ? data
              : data?.value
          )
          if (timeoutId) {
            clearTimeout(timeoutId)
          }
          process.off("message", messageHandler)

          let count = process.listenerCount("message")
          // log(
          //   `******* 🤔 ${process.pid}: REMOVE ${channel} Listener: message listener count ${count}`
          // )
        }
      }
      process.on("message", messageHandler)
      // log(
      //   `******* 🤔 ${
      //     process.pid
      //   }: ADD ${channel} Listener: message listener count ${process.listenerCount(
      //     "message"
      //   )}`
      // )
      if (timeout) {
        timeoutId = setTimeout(() => {
          process.off("message", messageHandler)

          let count = process.listenerCount("message")
          // log(
          //   `******* 🤔 ${process.pid}: REMOVE ${channel} Listener: message listener count ${count}`
          // )
        }, timeout)
      }
      send(channel, data)
    })
  } else {
    return null
  }
}

global.getBackgroundTasks = () =>
  global.getDataFromApp(Channel.GET_BACKGROUND)

global.getSchedule = () =>
  global.getDataFromApp(Channel.GET_SCHEDULE)
global.getBounds = async () => {
  let data = await global.getDataFromApp(Channel.GET_BOUNDS)
  return data?.bounds
}

global.getCurrentScreen = async () => {
  let data = await global.getDataFromApp(
    Channel.GET_SCREEN_INFO
  )
  return data?.screen
}

global.getScriptsState = () =>
  global.getDataFromApp(Channel.GET_SCRIPTS_STATE)

global.setBounds = async (bounds: Partial<Rectangle>) => {
  await global.sendWait(Channel.SET_BOUNDS, bounds)
}

let clipboardStore
let getClipboardStore = async () => {
  if (clipboardStore) return clipboardStore
  clipboardStore = await store(
    kitPath("db", "clipboard.json"),
    {
      history: [],
    }
  )

  return clipboardStore
}

global.getClipboardHistory = async () => {
  let clipboardStore = await getClipboardStore()

  let clipboardHistory = (await clipboardStore.get(
    "history"
  )) as ClipboardItem[]

  return clipboardHistory
}

global.removeClipboardItem = async (itemId: string) => {
  let clipboardStore = await getClipboardStore()
  let clipboardHistory = (await clipboardStore.get(
    "history"
  )) as ClipboardItem[]

  const index = clipboardHistory.findIndex(
    ({ id }) => itemId === id
  )
  if (index > -1) {
    clipboardHistory.splice(index, 1)
  }

  await clipboardStore.set("history", clipboardHistory)

  send(Channel.CLIPBOARD_SYNC_HISTORY)
}

global.clearClipboardHistory = async () => {
  let clipboardStore = await getClipboardStore()
  await clipboardStore.set("history", [])

  send(Channel.CLIPBOARD_SYNC_HISTORY)
}

global.submit = async (value: any) => {
  global.send(Channel.VALUE_SUBMITTED, value)
  if (global.__kitPromptSubject) {
    global.__kitPromptSubject.next({
      channel: Channel.VALUE_SUBMITTED,
      state: {
        ...(global.__kitPromptState || {
          input: "",
        }),
        value,
      },
    })
  }
}

global.wait = async (time: number) => {
  return new Promise(res =>
    setTimeout(() => {
      res()
    }, time)
  )
}

global.setDescription = async (description: string) => {
  await global.sendWait(
    Channel.SET_DESCRIPTION,
    description
  )
}

global.setName = async (name: string) => {
  await global.sendWait(Channel.SET_NAME, name)
}

global.setTextareaValue = (value: string) => {
  global.send(Channel.SET_TEXTAREA_VALUE, value)
}

global.appKeystroke = (data: KeyData) => {
  global.send(Channel.SEND_KEYSTROKE, {
    keyCode: keyCodeFromKey(data?.key),
    ...data,
  })
}

global.setLoading = (loading: boolean) => {
  global.send(Channel.SET_LOADING, loading)
}

global.setRunning = (running: boolean) => {
  global.send(Channel.SET_RUNNING, running)
}

let loadingList = [
  "$",
  "applescript",
  "download",
  "exec",
  "fetch",
  "get",
  "patch",
  "post",
  "put",
  "del",
  "wait",
  "say",
  "playAudioFile",
]
for (let method of loadingList) {
  let original = global[method]
  global[method] = function (...args: any[]) {
    setLoading(true)
    let result = original.apply(this, args)
    result.then(() => setLoading(false))
    return result
  }
}

global.Key = Key

global.mainScript = async (
  input: string = "",
  tab: string
) => {
  if (arg?.keyword) delete arg.keyword
  if (arg?.fn) delete arg.fn
  preload(getMainScriptPath())
  setPlaceholder("Script Kit")
  setInput(input || "")
  global.args = []
  global.flags = {}
  if (process.env.KIT_CONTEXT === "app") {
    process.removeAllListeners("message")
    clearAllTimeouts()
    clearAllIntervals()
    let m = run(getMainScriptPath(), `--input`, input)
    if (tab) {
      await wait(200)
      setTab(tab)
    }
    await m
  }
}

let getFileInfo = async (filePath: string) => {
  return applescript(`
  set aFile to (POSIX file "${filePath}") as alias
  info for aFile    
  `)
}

export let createPathChoices = async (
  startPath: string,
  {
    dirFilter = (dirent: Dirent) => true,
    dirSort = (a: any, b: any) => 0,
    onlyDirs = false,
  }
) => {
  let dirFiles = await readdir(startPath, {
    withFileTypes: true,
  })

  // Sort .files and .folders to the bottom
  dirFiles = dirFiles.sort((a, b) => {
    if (a.name.startsWith(".") && !b.name.startsWith(".")) {
      return 1
    }
    if (!a.name.startsWith(".") && b.name.startsWith(".")) {
      return -1
    }
    return 0
  })

  let dirents = dirFiles.filter(dirFilter)

  let folders = dirents.filter(dirent =>
    dirent.isDirectory()
  )
  let files = onlyDirs
    ? []
    : dirents.filter(dirent => !dirent.isDirectory())

  let mapDirents = (dirents: Dirent[]): Choice[] => {
    return dirents.map(dirent => {
      let fullPath = path.resolve(startPath, dirent.name)
      let { size, mtime } = fs.statSync(fullPath)
      let type = dirent.isDirectory() ? "folder" : "file"
      let description =
        type === "folder"
          ? ""
          : `${filesize(
              size
            )} - Last modified ${formatDistanceToNow(
              mtime
            )} ago`

      return {
        img: kitPath("icons", type + ".svg"),
        name: dirent.name,
        value: fullPath,
        description,
        drag: fullPath,
        mtime,
        size,
        // preview: async () => {
        //   try {
        //     let fileInfo = await getFileInfo(fullPath)
        //     let formattedInfo = fileInfo
        //       .split(", ")
        //       .map(line => {
        //         return `* ${line}`
        //       })
        //       .join("\n")

        //     return md(formattedInfo)
        //   } catch (error) {
        //     return md(error)
        //   }
        // },
      }
    })
  }

  let mapped = mapDirents(folders.concat(files))

  return (mapped as any).sort(dirSort)
}

let verifyFullDiskAccess = async () => {
  return global.sendWait(Channel.VERIFY_FULL_DISK_ACCESS)
}

type PathConfig = PromptConfig & {
  startPath?: string
  onlyDirs?: boolean
}

let __pathSelector = async (
  config: string | PathConfig = home(),
  { showHidden } = { showHidden: false }
) => {
  let startPath = ``
  let focusOn = ``
  let onInputHook = null
  let onlyDirs = false
  if (typeof config === "string") startPath = config
  if (typeof config === "object") {
    startPath = config?.startPath || home()
    onlyDirs = config?.onlyDirs || false
  }

  let initialChoices = await createPathChoices(startPath, {
    onlyDirs,
    dirFilter: dirent => {
      // if (dirent.name.startsWith(".")) {
      //   return showHidden
      // }

      return true
    },
  })

  let currentDirChoices = async (
    startPath,
    dirFilter = () => true
  ) => {
    try {
      let choices = await createPathChoices(startPath, {
        dirFilter,
        onlyDirs,
      })

      choices.push({
        name: `Create File "{base}"`,
        miss: true,
        value: "create-file",
        enter: "Create File",
      })

      choices.push({
        name: `Create Folder "{base}"`,
        miss: true,
        value: "create-folder",
        enter: "Create Folder",
      })

      await setChoices(choices, {
        skipInitialSearch: false,
        inputRegex: `[^\\${path.sep}]+$`,
      })
      setPauseResize(false)
      if (focusOn) setFocused(focusOn)
      focusOn = ``
    } catch {
      setPanel(md(`### Failed to read ${startPath}`))
    }
  }

  let inputRegex = `[^\\${path.sep}]+$`
  setFilterInput(inputRegex)

  if (
    !startPath.endsWith(path.sep) &&
    (await isDir(startPath))
  )
    startPath += path.sep
  let slashCount = startPath.split(path.sep).length

  let lsCurrentDir = async input => {
    // if (!input) {
    //   await mainScript()
    // }

    if (input?.startsWith("~")) startPath = home()

    if (input?.endsWith(path.sep)) {
      startPath = input
    } else {
      startPath = path.dirname(input)
    }
    let isCurrentDir = await isDir(startPath)
    if (isCurrentDir) {
      await currentDirChoices(startPath)
    } else {
      setPanel(md(`### ${startPath} is not a path`))
    }
  }

  let upDir = async dir => {
    await setInput(path.dirname(startPath) + path.sep)
    if (dir) focusOn = path.basename(path.dirname(dir))
  }

  let downDir = async dir => {
    let targetPath = path.resolve(startPath, dir)
    let allowed = true
    let needsPermission =
      targetPath === home("Downloads") ||
      targetPath === home("Documents") ||
      targetPath === home("Desktop")

    if (needsPermission && isMac) {
      let testFile = createPathResolver(targetPath)(
        `._kit_test_file_${Date.now()}.txt`
      )
      await writeFile(testFile, `success`)
      allowed = await isFile(testFile)
      if (allowed) {
        global.log(`Access granted to ${targetPath}`)
        await unlink(testFile)
      }
    }

    if (allowed) {
      if (await isDir(targetPath)) {
        setInput(targetPath + path.sep)
      }
    } else {
      let html = md(`
## Unable to Access Folder

Kit needs permission to access \`${targetPath}\`. 

Please grant permission in System Preferences > Security & Privacy > Privacy > Files and Folders (or Full Disk Access).
`)

      await div({
        html,
        ignoreBlur: true,
        enter: "Back to Main",
        shortcuts: [
          {
            name: "Quit",
            key: `${cmd}+q`,
            bar: "right",
            onPress: async () => {
              send(Channel.QUIT_APP)
            },
          },
        ],
      })

      await mainScript()
    }
  }

  let currentInput = ``
  let prevInput = ``
  let onInput = async (input, state) => {
    let inputLess = input.length < prevInput.length
    prevInput = input
    currentInput = input
    setEnter((config as PathConfig)?.enter || "Actions")
    if (onInputHook) onInputHook(input, state)
    // if (input.endsWith(">")) {
    //   let choices = await createPathChoices(
    //     startPath,
    //     () => true,
    //     compareAsc
    //   )
    //   setChoices(choices)
    //   return
    // }
    // if (input.endsWith("<")) {
    //   let choices = await createPathChoices(
    //     startPath,
    //     () => true,
    //     (a, b) => compareAsc(b, a)
    //   )
    //   setChoices(choices)
    //   return
    // }
    // if (input.endsWith(";")) {
    //   let choices = await createPathChoices(
    //     startPath,
    //     () => true,
    //     ()=> 0
    //   )
    //   setChoices(choices)
    //   return
    // }

    if (!input) return

    if (input?.startsWith("~")) {
      setInput(home() + path.sep)
      return
    }

    // if (input?.endsWith(path.sep + ".")) {
    //   let choices = await createPathChoices(startPath, {
    //     dirFilter: () => true,
    //     onlyDirs,
    //   })
    //   setChoices(choices, {
    //     skipInitialSearch: true,
    //     inputRegex: `[^\\${path.sep}]+$`,
    //   })
    //   if (focusOn) setFocused(focusOn)
    //   focusOn = ``
    //   return
    // }
    let currentSlashCount = input?.split(path.sep).length
    if (
      currentSlashCount != slashCount ||
      (input.endsWith(path.sep) && inputLess)
    ) {
      slashCount = currentSlashCount
      await lsCurrentDir(input)
    }
  }

  let onTab = async (input, state) => {
    let dir = state.focused.value

    if (state.modifiers.includes("shift")) {
      upDir(dir)
    } else {
      downDir(dir)
    }
  }

  let onRight = async (input, state) => {
    downDir(state.focused.value)
  }

  let onLeft = async (input, state) => {
    upDir(state.focused.value)
  }

  let onEscape = async () => {
    await mainScript()
  }

  let sort = `name`
  let dir = `desc`
  let sorters = {
    date: ({ mtime: a }, { mtime: b }) =>
      dir === `asc` ? compareAsc(a, b) : compareAsc(b, a),
    name: ({ name: a }, { name: b }) =>
      dir === `desc` ? (a > b ? 1 : -1) : a > b ? -1 : 1,
    size: ({ size: a }, { size: b }) =>
      dir === `asc` ? (a > b ? 1 : -1) : a > b ? -1 : 1,
  }
  let createSorter = (s: "date" | "name" | "size") => {
    return async () => {
      if (sort !== s) {
        dir = `desc`
      } else {
        dir = dir === `asc` ? `desc` : `asc`
      }

      sort = s
      let dirSort = sorters[s]
      let choices = await createPathChoices(startPath, {
        dirFilter: () => true,
        dirSort,
        onlyDirs,
      })

      setChoices(choices)
      setPauseResize(false)
    }
  }
  let bar = (config as PromptConfig)?.shortcuts?.length
    ? ""
    : ("right" as PromptConfig["shortcuts"][0]["bar"])
  setPauseResize(true)
  let selectedPath = await arg(
    {
      placeholder: "Browse",
      ...(config as PromptConfig),
      inputCommandChars: ["/"],
      input: startPath,
      inputRegex: `[^\\${path.sep}]+$`,
      onInput,
      onTab,
      onMenuToggle: async (input, state) => {
        onMenuToggleDefault(input, state)

        if (!state.flaggedValue) {
          setInput(currentInput)
          await lsCurrentDir(currentInput)
        }
      },
      ignoreBlur: true,
      alwaysOnTop: true,
      // onRight,
      // onLeft,
      // onNoChoices,
      // onEscape,
      // TODO: If I want resize, I need to create choices first?
      onInit: async () => {
        setResize(true)
        lsCurrentDir(startPath)
      },
      shortcuts: [
        {
          name: "Out",
          key: "left",
          bar,
          onPress: onLeft,
        },
        {
          name: "In",
          key: "right",
          bar,
          onPress: onRight,
        },
        {
          name: "Name",
          key: `${cmd}+,`,
          onPress: createSorter("name"),
          bar,
        },
        {
          name: "Size",
          key: `${cmd}+.`,
          onPress: createSorter("size"),
          bar,
        },
        {
          name: "Date",
          key: `${cmd}+/`,
          onPress: createSorter("date"),
          bar,
        },
        ...((config as PromptConfig).shortcuts || []),
      ],
    },
    initialChoices
  )

  if (!selectedPath) return ""
  if (selectedPath === "create-file") {
    selectedPath = currentInput
    let doesPathExist = await pathExists(selectedPath)
    if (!doesPathExist) {
      await ensureFile(selectedPath)
    }
  }

  if (selectedPath === "create-folder") {
    selectedPath = currentInput
    let doesPathExist = await pathExists(selectedPath)
    if (!doesPathExist) {
      await ensureDir(selectedPath)
    }
  }

  return selectedPath.trim()
}

let __path = global.path
global.path = new Proxy(__pathSelector, {
  get: (target, k: string) => {
    if (k === "then") return __pathSelector
    return __path[k]
  },
}) as any

global.getEditorHistory = async () => {
  return (
    await global.getDataFromApp(Channel.GET_EDITOR_HISTORY)
  )?.state?.editorHistory
}

global.setFocused = (id: string) => {
  send(Channel.SET_FOCUSED, id)
}

global.keyboard = {
  type: async (...textOrKeys: (string | Key)[]) => {
    await sendWait(Channel.KEYBOARD_TYPE, textOrKeys)
  },
  pressKey: async (...keys: Key[]) => {
    await sendWait(Channel.KEYBOARD_PRESS_KEY, keys)
  },
  releaseKey: async (...keys: Key[]) => {
    await sendWait(Channel.KEYBOARD_RELEASE_KEY, keys)
  },
  config: async config => {
    send(Channel.KEYBOARD_CONFIG, config)
  },
}

global.mouse = {
  leftClick: async () => {
    await sendWait(Channel.MOUSE_LEFT_CLICK)
  },
  rightClick: async () => {
    await sendWait(Channel.MOUSE_RIGHT_CLICK)
  },
  move: async points => {
    await sendWait(Channel.MOUSE_LEFT_CLICK, points)
  },
  setPosition: async position => {
    await sendWait(Channel.MOUSE_SET_POSITION, position)
  },
}

global.clipboard = {
  readText: async () => {
    return await sendWait(Channel.CLIPBOARD_READ_TEXT)
  },
  readHTML: async () => {
    return await sendWait(Channel.CLIPBOARD_READ_HTML)
  },
  readImage: async () => {
    let tmpPath = await sendWait(
      Channel.CLIPBOARD_READ_IMAGE
    )
    return await readFile(tmpPath)
  },
  readRTF: async () => {
    return await sendWait(Channel.CLIPBOARD_READ_RTF)
  },
  readBookmark: async () => {
    return await sendWait(Channel.CLIPBOARD_READ_BOOKMARK)
  },
  readFindText: async () => {
    return await sendWait(Channel.CLIPBOARD_READ_FIND_TEXT)
  },
  writeText: async (text: string) => {
    return await sendWait(
      Channel.CLIPBOARD_WRITE_TEXT,
      text
    )
  },
  writeHTML: async (html: string) => {
    return await sendWait(
      Channel.CLIPBOARD_WRITE_HTML,
      html
    )
  },
  writeImage: async (image: Buffer) => {
    let imagePath = tmpPath(`${uuid()}.png`)
    await writeFile(imagePath, image)
    return await sendWait(
      Channel.CLIPBOARD_WRITE_IMAGE,
      imagePath
    )
  },
  writeRTF: async (rtf: string) => {
    return await sendWait(Channel.CLIPBOARD_WRITE_RTF, rtf)
  },
  writeBookmark: async (bookmark: {
    url: string
    title: string
  }) => {
    return await sendWait(
      Channel.CLIPBOARD_WRITE_BOOKMARK,
      bookmark
    )
  },
  writeFindText: async (findText: string) => {
    return await sendWait(
      Channel.CLIPBOARD_WRITE_FIND_TEXT,
      findText
    )
  },

  clear: async () => {
    return await sendWait(Channel.CLIPBOARD_CLEAR)
  },
}

global.setStatus = async (status: KitStatus) => {
  await sendWait(Channel.SET_STATUS, status)
}

global.setTheme = async (theme: KitTheme) => {
  await sendWait(Channel.SET_THEME, theme)
}

global.setScriptTheme = async (theme: KitTheme) => {
  await sendWait(Channel.SET_TEMP_THEME, theme)
}

global.setAlwaysOnTop = async (alwaysOnTop: boolean) => {
  return sendWait(Channel.SET_ALWAYS_ON_TOP, alwaysOnTop)
}

global.focus = async () => {
  return sendWait(Channel.FOCUS)
}

delete process.env?.["ELECTRON_RUN_AS_NODE"]
delete global?.env?.["ELECTRON_RUN_AS_NODE"]

type ExtraLib = { content: string; filePath: string }

let addNodeLibs = async () => {
  let extraLibs: ExtraLib[] = []
  let nodeTypesDir = kitPath(
    "node_modules",
    "@types",
    "node"
  )
  let nodeDirents = await readdir(nodeTypesDir, {
    withFileTypes: true,
  })

  for await (let dirent of nodeDirents) {
    if (dirent.isDirectory()) {
      let { name } = dirent
      let subDirent = await readdir(
        path.resolve(nodeTypesDir, name),
        {
          withFileTypes: true,
        }
      )

      for await (let sub of subDirent) {
        if (sub.isFile() && sub.name.endsWith(".d.ts")) {
          let filePath = path.resolve(
            nodeTypesDir,
            name,
            sub.name
          )
          let content = await readFile(filePath, "utf8")
          extraLibs.push({
            content,
            filePath: `file:///${name}/${sub.name}`,
          })
        }
      }
    } else {
      let { name } = dirent
      if (name.endsWith("d.ts")) {
        let content = await readFile(
          kitPath("node_modules", "@types", "node", name),
          "utf8"
        )
        extraLibs.push({
          content,
          filePath: `file:///${name}`,
        })
      }
    }
  }

  return extraLibs
}

let addKitLibs = async (): Promise<ExtraLib[]> => {
  let extraLibs: ExtraLib[] = []
  //   let utilsContent = await readFile(
  //     kitPath("core", "utils.d.ts"),
  //     "utf8"
  //   )
  //   let enumsContent = await readFile(
  //     kitPath("core", "enum.d.ts"),
  //     "utf8"
  //   )
  //   extraLibs.push({
  //     content: `declare module "@johnlindquist/kit" {
  //       ${utilsContent}
  //       ${enumsContent}
  // }`,
  //     filePath: `file:///node_modules/@types/@johnlindquist/kit/index.d.ts`,
  //   })
  let kitCoreDir = kitPath("core")
  let kitCoreTypes = await readdir(kitCoreDir)

  for await (let t of kitCoreTypes.filter(t =>
    t.endsWith(".d.ts")
  )) {
    let content = await readFile(kitPath("core", t), "utf8")

    extraLibs.push({
      content,
      filePath: `file:///core/${t}`,
    })
  }

  let kitTypesDir = kitPath("types")
  let kitTypes = await readdir(kitTypesDir)

  for await (let t of kitTypes) {
    let content = await readFile(
      kitPath("types", t),
      "utf8"
    )

    extraLibs.push({
      content,
      filePath: `file:///types/${t}`,
    })
  }

  let globalTypesDir = kitPath(
    "node_modules",
    "@johnlindquist",
    "globals",
    "types"
  )

  let globalTypeDirs = (
    await readdir(globalTypesDir, { withFileTypes: true })
  ).filter(dir => dir.isDirectory())

  for await (let { name } of globalTypeDirs) {
    let content = await readFile(
      kitPath(
        "node_modules",
        "@johnlindquist",
        "globals",
        "types",
        name,
        "index.d.ts"
      ),
      "utf8"
    )

    // let filePath = `file:///node_modules/@johnlindquist/globals/${name}/index.d.ts`
    let filePath = `file:///node_modules/@johnlindquist/globals/${name}/index.d.ts`

    extraLibs.push({
      content,
      filePath,
    })
  }

  // node_modules/@johnlindquist/globals/types/index.d.ts
  let globalsIndexContent = await readFile(
    kitPath(
      "node_modules",
      "@johnlindquist",
      "globals",
      "types",
      "index.d.ts"
    ),
    "utf8"
  )

  //   globalsIndexContent = `declare module "@johnlindquist/globals" {
  // ${globalsIndexContent}
  //   }`

  extraLibs.push({
    content: globalsIndexContent,
    filePath: `file:///node_modules/@johnlindquist/globals/index.d.ts`,
  })

  // let content = await readFile(
  //   kitPath("types", "kit-editor.d.ts"),
  //   "utf8"
  // )
  // extraLibs.push({
  //   content,
  //   filePath: `file:///kit.d.ts`,
  // })

  let shelljsContent = await readFile(
    kitPath(
      "node_modules",
      "@types",
      "shelljs",
      "index.d.ts"
    ),
    "utf8"
  )

  extraLibs.push({
    content: shelljsContent,
    filePath: `file:///node_modules/@types/shelljs/index.d.ts`,
  })

  // let reactContent = await readFile(
  //   kitPath(
  //     "node_modules",
  //     "@types",
  //     "react",
  //     "index.d.ts"
  //   ),
  //   "utf8"
  // )

  // extraLibs.push({
  //   content: reactContent,
  //   filePath: `react`,
  // })

  let nodeNotifierContent = await readFile(
    kitPath(
      "node_modules",
      "@types",
      "node-notifier",
      "index.d.ts"
    ),
    "utf8"
  )

  extraLibs.push({
    content: nodeNotifierContent,
    filePath: `file:///node_modules/@types/node-notifier/index.d.ts`,
  })

  let trashContent = await readFile(
    kitPath("node_modules", "trash", "index.d.ts"),
    "utf8"
  )

  extraLibs.push({
    content: trashContent,
    filePath: `file:///node_modules/@types/trash/index.d.ts`,
  })

  return extraLibs
}

global.getExtraLibs = async (): Promise<ExtraLib[]> => {
  let nodeLibs = []
  try {
    nodeLibs = await addNodeLibs()
  } catch (error) {
    warn(error)
  }

  let kitLibs = []
  try {
    kitLibs = await addKitLibs()
  } catch (error) {
    warn(error)
  }
  return [...nodeLibs, ...kitLibs]
}

global.setShortcuts = async shortcuts => {
  if (global.__currentPromptConfig) {
    global.__currentPromptConfig.shortcuts = shortcuts
  }
  await sendWait(Channel.SET_SHORTCUTS, shortcuts)
}

global.getAppState = async () => {
  return await sendWait(Channel.GET_APP_STATE)
}

global.formatDate = format
global.formatDateToNow = formatDistanceToNow

global.__kitAddErrorListeners = () => {
  if (process.listenerCount("unhandledRejection") === 0) {
    process.prependOnceListener(
      "unhandledRejection",
      async error => {
        await errorPrompt(error as Error)
      }
    )
  }

  if (process.listenerCount("uncaughtException") === 0) {
    process.prependOnceListener(
      "uncaughtException",
      async error => {
        await errorPrompt(error as Error)
      }
    )
  }
}

global.__kitAddErrorListeners()

let __kit__registeredShortcuts = new Map()
global.__kit__onShortcutPressed = async (
  input: string,
  state: AppState
) => {
  let callback = __kit__registeredShortcuts.get(input)
  if (callback) callback(input, state)
}

global.registerShortcut = async (
  shortcut: string,
  callback: () => void
) => {
  if (process?.send) {
    let result = await sendWait(
      Channel.REGISTER_GLOBAL_SHORTCUT,
      shortcut
    )

    log({ result })
    if (!result) {
      warn(
        `Shortcut ${shortcut} failed to register. Ending process. 😰`
      )
      exit()
    }
    let messageHandler = (data: any) => {
      if (
        data.channel === Channel.GLOBAL_SHORTCUT_PRESSED &&
        data.value === shortcut
      ) {
        callback()
      }
    }
    __kit__registeredShortcuts.set(shortcut, messageHandler)
    process.on("message", messageHandler)
    process.once("beforeExit", () => {
      global.unregisterShortcut(shortcut)
    })
  }
}

global.unregisterShortcut = async (shortcut: string) => {
  sendWait(Channel.UNREGISTER_GLOBAL_SHORTCUT, shortcut)
  let messageHandler =
    __kit__registeredShortcuts.get(shortcut)
  if (messageHandler) {
    process.off("message", messageHandler)
    __kit__registeredShortcuts.delete(shortcut)
  }
}

global.startDrag = async (
  filePath: string,
  iconPath: string
) => {
  await sendWait(Channel.START_DRAG, { filePath, iconPath })
}

global.eyeDropper = async () => {
  return await sendWait(Channel.GET_COLOR)
}

global.getTypedText = async () => {
  return await sendWait(Channel.GET_TYPED_TEXT)
}

/**
 * @experimental - API, types, etc TBD
 *
 */
global.toast = async (text: string, options: any = {}) => {
  return await sendWait(Channel.TOAST, {
    text,
    options,
  })
}

global.mic = async (config: MicConfig = {}) => {
  if (config?.dot) {
    let data = await global.sendWait(
      Channel.START_MIC,
      config
    )

    const [header, content] = data.state.value.split(",")
    const [type, encoding] = header.split(";")
    // log(`decoding ${encoding} ${type}`)
    if (encoding === "base64") {
      data.state.value = Buffer.from(content, "base64")
    }
    return Buffer.from(data?.state?.value, "base64")
  } else {
    return await global.kitPrompt({
      ui: UI.mic,
      enter: "Stop",
      width: PROMPT.WIDTH.BASE,
      height: PROMPT.HEIGHT.BASE,
      resize: true,
      shortcuts: [
        escapeShortcut,
        {
          key: `${cmd}+i`,
          name: `Select Mic`,
          onPress: async () => {
            await run(kitPath("cli", "select-mic.js"))
            await mainScript()
          },
          bar: "right",
        },

        closeShortcut,
      ],
      ignoreBlur: true,
      timeSlice: 200,
      format: "webm",
      stream: false,
      ...config,
    })
  }
}

global.micdot = async (config: MicConfig = {}) => {
  return await mic({ ...config, dot: true })
}

global.mic.stop = async () => {
  return await sendWait(Channel.STOP_MIC)
}

global.webcam = async () => {
  return await global.kitPrompt({
    ui: UI.webcam,
    enter: "Capture",
    resize: true,
    width: PROMPT.WIDTH.BASE,
    height: PROMPT.HEIGHT.BASE,
    shortcuts: [
      escapeShortcut,
      {
        key: `${cmd}+i`,
        name: `Select Webcam`,
        onPress: async () => {
          await run(kitPath("cli", "select-webcam.js"))
          await mainScript()
        },
        bar: "right",
      },
      closeShortcut,
    ],
    ignoreBlur: true,
  })
}

global.getMediaDevices = async () => {
  let appMessage = await sendWait(Channel.GET_DEVICES)

  return appMessage?.state?.value
}

global.clearTimestamps = async () => {
  return await sendWait(Channel.CLEAR_TIMESTAMPS)
}

global.removeTimestamp = async (id: string) => {
  return await sendWait(Channel.REMOVE_TIMESTAMP, id)
}

global.toggleAllSelectedChoices = async () => {
  return await sendWait(Channel.TOGGLE_ALL_SELECTED_CHOICES)
}

global.setSelectedChoices = async (choices: Choice[]) => {
  return await sendWait(
    Channel.SET_SELECTED_CHOICES,
    choices
  )
}
