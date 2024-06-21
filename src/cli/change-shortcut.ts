// Description: Change Script Shortcut

import { getMainScriptPath, trashScript } from '../core/utils.js'
import type { Script } from '../types/core'

let { filePath, command, menu, name } = await selectScript('Change shortcut of which script?', true, (scripts) =>
  scripts
    .sort((a, b) => {
      if (a?.shortcut && !b?.shortcut) {
        return -1
      }
      if (b?.shortcut && !a?.shortcut) {
        return 1
      }
      if (!(a?.shortcut || b?.shortcut)) {
        return 0
      }
      return a?.shortcut > b?.shortcut ? 1 : a?.shortcut < b?.shortcut ? -1 : 0
    })
    .map((script: Script) => {
      return {
        ...script,
        name: script?.menu || script.command,
        description: script?.description,
        value: script,
      }
    }),
)

let { shortcut } = await hotkey({
  placeholder: 'Enter a key combo:',
  description: `Changing shortcut for ${name}`,
})

let fileContents = await readFile(filePath, 'utf-8')
let reg = /(?<=^\/\/\s*Shortcut:\s).*(?=$)/gim
if (fileContents.split('\n').some((line) => line.match(reg))) {
  let newContents = fileContents.replace(reg, shortcut)

  await writeFile(filePath, newContents)
} else {
  await writeFile(filePath, `// Shortcut: ${shortcut}\n${fileContents}`)
}

arg('Shortcut Changed', [
  {
    name: `Shortcut changed to ${shortcut}`,
    info: true,
  },
])

await wait(1500)
submit('')

if (process.env.KIT_CONTEXT === 'app') {
  await run(getMainScriptPath())
}
