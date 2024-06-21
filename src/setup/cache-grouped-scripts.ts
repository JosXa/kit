// Description: Clear Timestamps

import { getGroupedScripts, processScriptPreview, scriptFlags } from '../api/kit.js'
import { Channel } from '../core/enum.js'
import { formatChoices } from '../core/utils.js'
import type { Script } from '../types/core'

let groupedScripts = await getGroupedScripts()
let scripts = formatChoices(groupedScripts)
let firstScript = scripts.find((script) => !script.skip)
let preview = ''
try {
  preview = await processScriptPreview(firstScript as unknown as Script)()
} catch {}

process.send({
  channel: Channel.CACHE_SCRIPTS,
  scripts,
  preview,
  scriptFlags,
})
