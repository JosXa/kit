// Name: New Script
// Description: Create a new script
// Log: false
// Pass: true
// Keyword: n

import { keywordInputTransformer, returnOrEnter, run } from '../core/utils.js'
import type { Choice } from '../types/core'
import type { CLI, Main } from './index'

let inputTransformer = keywordInputTransformer(arg?.keyword)

setFlags({})

let newChoices: Choice<keyof CLI | keyof Main>[] = [
  {
    name: 'New Script',
    description: 'Create a script from scratch',
    value: 'new',
  },
  {
    name: 'New from Clipboard',
    description: 'Create a script from your clipboard',
    value: 'new-from-clipboard',
  },
  {
    name: 'New from Tips',
    description: 'Browse a variety of tips and tricks to get started',
    value: 'tips',
  },
  {
    name: 'New Script from Template',
    description: 'Create a script from a template',
    value: 'new-from-template',
  },
  {
    name: 'New from URL/Gist',
    description: 'Create a script from a URL or Gist',
    value: 'new-from-url',
  },
  {
    name: 'New from Community Examples',
    description: 'Visit scriptkit.com/scripts/ for a variety of examples',
    value: 'hot',
  },
]

let onNoChoices = async (input) => {
  input = inputTransformer(input)
  if (input) {
    let scriptName = input
      .replace(/[^\w\s-]/g, '')
      .replace(/\s/g, '-')
      .toLowerCase()

    setPanel(
      md(`# Create <code>${scriptName}</code>

Type <kbd>${returnOrEnter}</kbd> to create a script named <code>${scriptName}</code>
    `),
    )
  }
}

if (arg?.pass && !arg?.keyword) {
  await cli('new')
} else {
  let cliScript: string = await arg<keyof CLI | keyof Main>(
    {
      placeholder: 'Create a new script',
      strict: false,
      onNoChoices,
      resize: false,
      input: arg?.input,
      shortcuts: [],
      enter: 'Run',
    },
    newChoices,
  )
  cliScript = inputTransformer(cliScript)
  if (arg?.keyword) {
    arg.keyword = undefined
  }

  if (cliScript === 'snippets' || cliScript === 'templates') {
    await run(kitPath('main', `${cliScript}.js`))
  } else if (cliScript === 'tips') {
    await main('tips')
  } else if (cliScript === 'hot') {
    await main('hot')
  } else if (newChoices.find((script) => script.value === cliScript)) {
    await run(kitPath('cli', cliScript + '.js'))
  } else {
    await run(`${kitPath('cli', 'new')}.js`, cliScript.replace(/\s/g, '-').toLowerCase(), '--scriptName', cliScript)
  }
}
