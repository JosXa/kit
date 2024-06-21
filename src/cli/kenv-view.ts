// Name: Kit Environment
// Description: Script Kit

import { cmd, getKenvs, run } from '../core/utils.js'

let { name: selectedKenv } = await selectKenv(
  {
    placeholder: 'Select a Kenv',
    enter: 'Select Kenv',
  },
  /____/,
)
let kenvs = await getKenvs()

let kenvRunner = (kenv) => async () => {
  setFlags({
    '': {
      name: 'Run Script',
      shortcut: 'enter',
    },
    open: {
      name: 'Open script in editor',
      shortcut: `${cmd}+o`,
    },
    'share-copy': {
      name: 'Copy script content to clipboard',
      shortcut: `${cmd}+c`,
    },
    duplicate: {
      name: 'Duplicate script',
      shortcut: `${cmd}+d`,
    },
    rename: {
      name: 'Rename script',
      shortcut: `${cmd}+r`,
    },
    remove: {
      name: 'Remove script',
      shortcut: `${cmd}+shift+backspace`,
    },
    'open-script-log': {
      name: 'Open script log',
      shortcut: `${cmd}+l`,
    },
    'open-script-database': {
      name: 'Open script database',
      shortcut: `${cmd}+b`,
    },
    'share-script': {
      name: 'Share as Gist',
      shortcut: `${cmd}+g`,
    },
    'share-script-as-link': {
      name: 'Share as URL',
      shortcut: `${cmd}+u`,
    },
    'share-script-as-discussion': {
      name: 'Prep for discussion',
      shortcut: `${cmd}+p`,
    },
    'change-shortcut': {
      name: 'Change shortcut',
    },
  })

  let script = await selectScript(
    {
      placeholder: 'Run Script',
      enter: 'Run',
    },
    true,
    (scripts) => scripts.filter((script) => script.kenv === kenv || (kenv === 'main' && !script.kenv)),
  )

  if (typeof script === 'string') {
    process.exit()
  }

  let shouldEdit = script.watch || script.schedule || script.system || flag?.open

  if (script.background) {
    await cli('toggle-background', script.filePath)
  } else if (shouldEdit) {
    await edit(script.filePath, kenvPath())
  } else {
    let selectedFlag: any = Object.keys(flag).find(Boolean)

    if (selectedFlag) {
      await cli(selectedFlag, script.filePath)
    } else {
      await run(script.filePath)
    }
  }
}

kenvs = [selectedKenv, ...kenvs.map((k) => path.basename(k)).filter((kenv) => kenv !== selectedKenv)]

kenvs.forEach((kenv) => {
  onTab(kenv, kenvRunner(kenv))
})
