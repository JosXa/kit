// Name: Focus Kit Window
// Description: Focus a Kit Window
// Keyword: kw
// Enter: Focus

import type { Choice } from '../types/core'

let windows = await getKitWindows()
windows = windows.filter((w) => !w.isFocused)

if (windows.length) {
  let id = await arg(
    {
      placeholder: 'Focus Kit Window',
      enter: 'Focus',
    },
    windows as Choice[],
  )

  await focusKitWindow(id)
} else {
  await div(
    md(`# No Kit Windows Found...
    
Try launching a script with a "widget", then run this again.    

~~~js
await widget(md(\`# Hello world\`), {
    title: "My Widget",
})
~~~
    `),
  )
}
