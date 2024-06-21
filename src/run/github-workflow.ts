process.env.KIT_TARGET = 'github-workflow'

import { randomUUID } from 'node:crypto'
import os from 'node:os'
import { pathToFileURL } from 'node:url'

process.env.KIT_CONTEXT = 'workflow'

import { configEnv, kitPath, resolveToScriptPath } from '../core/utils.js'

let kitImport = async (...pathParts: string[]) =>
  await import(pathToFileURL(kitPath(...pathParts)).href + '?uuid=' + randomUUID())

await kitImport('api', 'global.js')
await kitImport('api', 'kit.js')
await kitImport('api', 'lib.js')
await import('../platform/base.js')

let platform = process.env?.PLATFORM || os.platform()

await kitImport('platform', `${platform}.js`)

configEnv()

await kitImport('target', 'terminal.js')

global.core = await npm('@actions/core')
global.github = await npm('@actions/github')

let scriptPath = resolveToScriptPath(await arg('Path to script'))
await run(scriptPath)
