// Description: Kit.app Settings

import { closeShortcut, cmd, escapeShortcut } from '../core/utils.js'

let kenvEnvPath = kenvPath('.env')
await editor({
  value: await readFile(kenvEnvPath, 'utf-8'),
  language: 'properties',
  shortcuts: [
    escapeShortcut,
    closeShortcut,
    {
      name: 'Save',
      key: `${cmd}+s`,
      onPress: async (input) => {
        await writeFile(kenvEnvPath, input)
      },
      bar: 'right',
    },
  ],
})
