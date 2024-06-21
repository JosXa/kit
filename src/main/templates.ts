// Description: Templates
// Exclude: true

import { closeShortcut, escapeShortcut } from '../core/utils.js'
setName('')

await arg({
  placeholder: 'Reserved for future use',
  enter: 'Exit',
  shortcuts: [escapeShortcut, closeShortcut],
})
