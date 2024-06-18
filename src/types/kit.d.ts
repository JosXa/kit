import { Low } from "@johnlindquist/kit-internal/lowdb"
import {
  format,
  formatDistanceToNow,
} from "@johnlindquist/kit-internal/date-fns"
import { RestEndpointMethodTypes } from "@octokit/plugin-rest-endpoint-methods"
import {
  Action,
  ChannelHandler,
  Choice,
  Choices,
  FlagsOptions,
  Panel,
  Preview,
  PromptConfig,
  ScoredChoice,
  Script,
  Shortcut,
} from "./core"
import { ConfigOptions, Options } from "quick-score"

export interface Arg {
  [key: string]: any
  <T = string>(
    placeholderOrConfig?: string | PromptConfig,
    choicesOrPanel?: Choices<T> | Panel,
    actionsOrPreview?: Action[] | Preview
  ): Promise<T>
}

export interface Select {
  <T = any[]>(
    placeholderOrConfig?: string | PromptConfig,
    choices: Choices<T>,
    actions?: Action[]
  ): Promise<T>
}
export interface EnvConfig extends PromptConfig {
  reset?: boolean
}
export interface Env {
  (
    envKey: string,
    promptConfig?:
      | string
      | EnvConfig
      | (() => Promise<string>)
  ): Promise<string>
  [key: string]: any
}

export interface Args extends Array<string> {}

export interface UpdateArgs {
  (args: string[]): void
}

export interface PathFn {
  (...pathParts: string[]): string
}

export interface Inspect {
  (data: any, extension?: string): Promise<void>
}

export interface Store {
  (key: string, initialData?: any): Promise<
    InstanceType<typeof import("keyv")>
  >
}

export type DB = <T = any>(
  dataOrKeyOrPath?: string | T | (() => Promise<T>),
  data?: T | (() => Promise<T>),
  fromCache?: boolean
) => Promise<
  T extends string
    ? {
        write: () => Promise<void>
        read: () => Promise<any>
        data: any
        [key: string]: any
      }
    : {
        write: () => Promise<void>
        read: () => Promise<T>
        data: any
      } & T
>

export interface OnTab {
  (
    name: string,
    fn: (input?: string) => void | Promise<void>
  ): void
}

export interface Trace {
  enabled: boolean
  begin: (
    fields: Parameters<
      InstanceType<
        typeof import("chrome-trace-event").Tracer
      >["begin"]
    >[0]
  ) => void
  end: (
    fields: Parameters<
      InstanceType<
        typeof import("chrome-trace-event").Tracer
      >["end"]
    >[0]
  ) => void
  instant: (
    fields: Parameters<
      InstanceType<
        typeof import("chrome-trace-event").Tracer
      >["instantEvent"]
    >[0]
  ) => void
  flush: () => void
}

export interface OnExit {
  (fn: () => void): void
}

export interface KitModuleLoader {
  (
    packageName: string,
    ...moduleArgs: string[]
  ): Promise<any>
}
export interface Edit {
  (
    file: string,
    dir?: string,
    line?: string | number,
    col?: string | number
  ): Promise<void>
}

export interface Browse {
  (url: string): ReturnType<
    typeof import("@johnlindquist/open")
  >
}

export interface Wait {
  (time: number, submitValue?: any): Promise<void>
}

export interface IsCheck {
  (file: string): Promise<boolean>
}

export interface PathResolver {
  (dir: string): (...pathParts: string[]) => string
}

export interface GetScripts {
  (fromCache?: boolean): Promise<Script[]>
}

export type FlagFn = (flags: FlagsOptions) => void
export type ActionsFn = (actions: Action[]) => void
export type PrepFlags = (
  flags: FlagsOptions
) => FlagsOptions
export type Flags = {
  [key: string]: boolean | string
  cmd?: boolean | string
  ctrl?: boolean | string
  shift?: boolean | string
  option?: boolean | string
  alt?: boolean | string
}

export interface SelectKitEditor {
  (reset: boolean): Promise<string>
}

export interface SelectScript {
  (
    message?: string,
    fromCache?: boolean,
    xf?: (x: Script[]) => Script[]
  ): Promise<Script>
  (
    message: PromptConfig,
    fromCache?: boolean,
    xf?: (x: Script[]) => Script[]
  ): Promise<Script | string>
}

export interface Kenv {
  name: string
  dirPath: string
}
export interface SelectKenv {
  (
    config?: PromptConfig,
    ignorePattern?: RegExp
  ): Promise<Kenv>
}

export interface Highlight {
  (
    markdown: string,
    containerClass?: string,
    injectStyles?: string
  ): Promise<string>
}

interface PathConfig extends PromptConfig {
  startPath?: string
  onlyDirs?: boolean
}

type PathPicker = (
  config?: string | PathConfig
) => Promise<string>
export type PathSelector = typeof import("path") &
  PathPicker

type GistOptions = {
  fileName?: string
  description?: string
  isPublic?: boolean
}
export interface CreateGist {
  (content: string, options?: GistOptions): Promise<
    RestEndpointMethodTypes["gists"]["create"]["response"]["data"]
  >
}

export interface SetShortcuts {
  (shortcuts: Shortcut[]): Promise<void>
}
export interface KitApi {
  path: PathSelector
  db: DB

  wait: Wait

  checkProcess: (processId: number) => string

  /**
   * @example
   * ```
   * let pathToProject =  await home("projects", "my-code-project")
   * // /Users/johnlindquist/projects/my-code-project
   * ```
   */
  home: PathFn
  isFile: IsCheck
  isDir: IsCheck
  isBin: IsCheck
  createPathResolver: PathResolver
  /**
   * @example
   * ```
   * let value =  await arg()
   * ```
   */
  arg: Arg
  select: Select
  mini: Arg
  micro: Arg
  /**
   * @example
   * ```
   * // Reads from .env or prompts if not set
   * let SOME_ENV_VAR = await env("SOME_ENV_VAR")
   * ```
   */
  env: Env
  argOpts: string[]

  kitPath: PathFn
  kenvPath: PathFn
  knodePath: PathFn
  /**
   * Generate a path `~/.kenv/tmp/{command}/...parts`
   *
   * @example
   * ```
   * tmpPath("taco.txt") // ~/.kenv/tmp/command/taco.txt
   * ```
   */
  tmpPath: PathFn
  kenvTmpPath: PathFn

  inspect: Inspect

  onTab: OnTab
  onExit: OnExit

  attemptImport: KitModuleLoader
  npm: KitModuleLoader
  setup: KitModuleLoader

  edit: Edit
  browse: Browse

  args: Args
  updateArgs: UpdateArgs

  kitScript: string

  terminal: (script: string) => Promise<string>
  iterm: (iterm: string) => Promise<string>
  hyper: (hyper: string) => Promise<string>

  onTabs: {
    name: string
    fn: (input?: string) => void | Promise<any>
  }[]
  onTabIndex: number

  kitPrevChoices: Choices<any>

  getScripts: GetScripts

  memoryMap: Map<string, any>

  selectKitEditor: SelectKitEditor

  run: Run

  flag: Flags
  setFlags: FlagFn
  prepFlags: PrepFlags
  selectScript: SelectScript
  selectKenv: SelectKenv
  highlight: Highlight
  projectPath: PathFn
  createGist: CreateGist
  setShortcuts: SetShortcuts
  isWin: boolean
  isMac: boolean
  isLinux: boolean
  cmd: "cmd" | "ctrl"
  formatDate: typeof format
  formatDateToNow: typeof formatDistanceToNow
}

interface KeyValue {
  [key: string]: any
}

export interface Run {
  (command?: string, ...args: string[]): Promise<any>
}

type Utils = typeof import("../core/utils")

declare global {
  var path: PathSelector
  var edit: Edit
  var browse: Browse

  var kitPath: PathFn
  var kenvPath: PathFn
  var knodePath: PathFn
  var tmpPath: PathFn
  var kenvTmpPath: PathFn

  var attemptImport: KitModuleLoader
  /** @deprecated Use standard or dynamic imports instead. */
  var npm: KitModuleLoader
  var npmInstall: (packageName: string) => Promise<void>
  var installMissingPackage: (
    packageName: string
  ) => Promise<void>
  var run: Run
  var setup: KitModuleLoader

  var env: Env
  var arg: Arg
  var select: Select
  var basePrompt: Arg
  var mini: Arg
  var micro: Arg
  var onTab: OnTab
  var onExit: OnExit
  var args: Args

  var updateArgs: UpdateArgs
  var argOpts: string[]

  var wait: Wait

  var home: PathFn
  var isFile: IsCheck
  var isDir: IsCheck
  var isBin: IsCheck
  var createPathResolver: PathResolver

  var inspect: Inspect

  var db: DB
  var store: Store

  var memoryMap: Map<string, any>

  var onTabIndex: number

  var selectKitEditor: SelectKitEditor

  var getScripts: GetScripts
  var blur: () => Promise<void>
  var flag: Flags
  var actionFlag: string
  var setFlags: FlagFn
  var setActions: ActionsFn
  var setFlagValue: (value: any) => Promise<void>
  var prepFlags: PrepFlags

  var selectScript: SelectScript
  var selectKenv: SelectKenv
  var highlight: Highlight

  var terminal: (script: string) => Promise<string>
  var iterm: (iterm: string) => Promise<string>
  var hyper: (hyper: string) => Promise<string>
  var projectPath: PathFn
  var clearAllTimeouts: () => void
  var clearAllIntervals: () => void
  var createGist: CreateGist
  var setShortcuts: SetShortcuts
  var isWin: boolean
  var isMac: boolean
  var isLinux: boolean
  var cmd: "cmd" | "ctrl"
  var formatDate: typeof format
  var formatDateToNow: typeof formatDistanceToNow

  var debounce: Utils["debounce"]
  var sortBy: Utils["sortBy"]
  var isUndefined: Utils["isUndefined"]
  var isString: Utils["isString"]

  var createChoiceSearch: (
    choices: Choice[],
    config: Partial<Options & ConfigOptions>
  ) => Promise<(query: string) => ScoredChoice[]>

  var setScoredChoices: (
    scoredChoices: ScoredChoice[]
  ) => Promise<void>

  var groupChoices: (
    choices: Choice[],
    options?: {
      groupKey?: string
      missingGroupName?: string
      order?: string[]
      sortChoicesKey?: (string | boolean)[]
      recentKey?: string
      recentLimit?: number
      excludeGroups?: string[]
    }
  ) => Choice[]

  var formatChoices: (
    choices: Choice[],
    className?: string
  ) => Choice[]

  var preload: (scriptPath?: string) => void

  var setSelectedChoices: (
    choices: Choice[]
  ) => Promise<void>
  var toggleAllSelectedChoices: () => Promise<void>
  var trace: Trace

  type Metadata = import("./core").Metadata
  var metadata: Metadata
}
