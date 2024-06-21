// Name: View Schedule
// Description: Select a scheduled script to edit

import { cliShortcuts, closeShortcut, escapeShortcut, parseScript } from '../core/utils.js'
import type { Schedule } from '../types/kitapp'

import { compareAsc, format, formatDistanceToNowStrict } from '@johnlindquist/kit-internal/date-fns'

let { schedule } = await global.getSchedule()

let choices = (
  await Promise.all(
    schedule.map(async ({ filePath, date }) => {
      let script = await parseScript(filePath)
      let d = new Date(date)
      return {
        date,
        name: script?.menu || script.command,
        description: `Next ${formatDistanceToNowStrict(d)} - ${format(d, 'MMM eo, h:mm:ssa ')} - ${script?.schedule}`,
        value: filePath,
      } as Schedule
    }),
  )
).sort(({ date: a }, { date: b }) => compareAsc(new Date(a), new Date(b))) as Schedule[]

let filePath = await arg(
  {
    placeholder: 'Select a scheduled script to edit',
    enter: 'Select',
    shortcuts: cliShortcuts,
  },
  choices,
)

await run(kitPath('cli', 'edit-script.js'), filePath)
