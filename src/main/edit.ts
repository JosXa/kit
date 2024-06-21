// Name: Edit Menu
// Description: Select a script then edit action.
// Exclude: true

import type { CLI } from '../cli'
import type { Choice } from '../types/core'

let { command, filePath } = await selectScript('Edit script:')

let editActions: Choice<keyof CLI>[] = [
  {
    name: 'Open',
    description: `Open ${command}${env.KIT_EDITOR ? ` in ${env.KIT_EDITOR}` : ''}`,
    value: 'edit',
  },
  {
    name: 'Duplicate',
    description: `Make a copy of ${command} and open${env.KIT_EDITOR ? ` in ${env.KIT_EDITOR}` : ''}`,
    value: 'duplicate',
  },
  {
    name: 'Rename',
    description: `Prompt to rename ${command}`,
    value: 'rename',
  },
  {
    name: 'Remove',
    description: `Delete ${command} to trash`,
    value: 'remove',
  },

  {
    name: `Open ${command}.log`,
    description: `Opens ${command}.log in your editor`,
    value: 'open-command-log',
  },
]

let kenvDirs = (await readdir(kenvPath('kenvs'))) || []
if (kenvDirs.length) {
  editActions.splice(4, 0, {
    name: 'Move',
    description: `Move ${command} to a selected kenv`,
    value: 'move',
  })
}

let editAction = await arg<keyof CLI>('Which action?', editActions)
await cli(editAction, filePath)
