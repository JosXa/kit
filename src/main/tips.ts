// Name: Tips
// Description: Docs for Script Kit Tips
// Keyword: tips
// Pass: true
// Enter: Open Tips

import { createTipsConfig } from './main-helper.js'

let tipsPath = kitPath('TIPS.md')

await docs(
  tipsPath,
  createTipsConfig({
    name: 'Tips',
    guidePath: tipsPath,
    itemHeight: PROMPT.ITEM.HEIGHT.SM,
    input: arg?.input || '',
    placeholder: 'Browse Tips',
    enter: 'Create Script',
    preventCollapse: true,
    onNoChoices: async (input) => {
      setPanel(
        md(`# Expected ${input} in the Tips?
Tips are constantly evolving. If you're missing something, [suggest an edit](https://github.com/johnlindquist/kit-docs/blob/main/TIPS.md) to the tips.
`),
      )
    },
  }),
)
