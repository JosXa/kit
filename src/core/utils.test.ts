import test from 'ava'
import slugify from 'slugify'
import { outputTmpFile } from '../api/kit'
import { parseMarkdownAsScripts, parseScript, shortcutNormalizer } from './utils'

/**
 * [IMPORTANT]
 * These test create files in the tmp directory.
 * They each need unique names or tests will fail
 */

test('parseScript name comment metadata', async (t) => {
  let name = 'Testing Parse Script Comment'
  let fileName = slugify(name, { lower: true })
  let scriptContent = `
import "@johnlindquist/kit"

// Name: ${name}
  `.trim()

  let scriptPath = await outputTmpFile(`${fileName}.ts`, scriptContent)

  let script = await parseScript(scriptPath)
  t.is(script.name, name)
  t.is(script.filePath, scriptPath)
})

test('parseScript comment full metadata', async (t) => {
  let name = 'Testing Parse Script Comment Full Metadata'
  let description = 'This is a test description'
  let schedule = '0 0 * * *'
  let shortcut = `${cmd}+9`
  let normalizedShortcut = shortcutNormalizer(shortcut)
  let fileName = slugify(name, { lower: true })
  let scriptContent = `
import "@johnlindquist/kit"

// Name: ${name}
// Description: ${description}
// Schedule: ${schedule}
// Shortcut: ${shortcut}
  `.trim()

  let scriptPath = await outputTmpFile(`${fileName}.ts`, scriptContent)

  let script = await parseScript(scriptPath)
  t.is(script.name, name)
  t.is(script.description, description)
  t.is(script.schedule, schedule)
  t.is(script.filePath, scriptPath)
  t.is(script.shortcut, normalizedShortcut)
})

test('parseScript export convention metadata name', async (t) => {
  let name = 'Testing Parse Script Convention'
  let fileName = slugify(name, { lower: true })
  let scriptContent = `
import "@johnlindquist/kit"

export const metadata = {
  name: "${name}"
}
  `.trim()

  let scriptPath = await outputTmpFile(`${fileName}.ts`, scriptContent)

  let script = await parseScript(scriptPath)
  t.is(script.name, name)
  t.is(script.filePath, scriptPath)
})

test('parseScript global convention metadata name', async (t) => {
  let name = 'Testing Parse Script Convention Global'
  let fileName = slugify(name, { lower: true })
  let scriptContent = `
import "@johnlindquist/kit"

metadata = {
  name: "${name}"
}
  `.trim()

  let scriptPath = await outputTmpFile(`${fileName}.ts`, scriptContent)

  let script = await parseScript(scriptPath)
  t.is(script.name, name)
  t.is(script.filePath, scriptPath)
})

test('parseScript ignore metadata variable name', async (t) => {
  let name = 'Testing Parse Script Convention Ignore Metadata Variable Name'
  let fileName = slugify(name, { lower: true })
  let scriptContent = `
import "@johnlindquist/kit"

const metadata = {
  name: "${name}"
}
  `.trim()

  let scriptPath = await outputTmpFile(`${fileName}.ts`, scriptContent)

  let script = await parseScript(scriptPath)
  // Don't pick up on the metadata variable name, so it's the slugified version
  t.is(script.name, fileName)
  t.is(script.filePath, scriptPath)
})

test('parseMarkdownAsScripts', async (t) => {
  let markdown = `
## Open Script Kit
<!-- 
Trigger: sk
Alias:
Enabled: Yes
  -->

\`\`\`submit
value: https://scriptkit.com
browser: Google
\`\`\`

This Script Opens the Script Kit URL

I hope you enjoy!


## Open GitHub
<!-- 
Trigger: gh
Alias:
Enabled: Yes
  -->

\`\`\`submit
value: https://github.com
browser: Firefox
\`\`\`

This opens the GitHub URL

### This is a subtitle

Here we go!
  `

  const scripts = await parseMarkdownAsScripts(markdown)
  t.log(scripts)
  t.is(scripts.length, 2)
  t.is(scripts[0].name, 'Open Script Kit')
  t.is(scripts[1].name, 'Open GitHub')
  t.is(scripts[0].trigger, 'sk')
  t.is(scripts[1].trigger, 'gh')
  t.is(scripts[0].value, 'https://scriptkit.com')
  t.is(scripts[1].value, 'https://github.com')
  t.is(scripts[0].group, 'Links')
  t.is(scripts[1].group, 'Links')
  // TODO: Runner is timing out locally?
  //   t.is(
  //     scripts[0].preview,
  //     `This Script Opens the Script Kit URL

  // I hope you enjoy!`
  //   )
  //   t.is(
  //     scripts[1].preview,
  //     `This opens the GitHub URL

  // ### This is a subtitle

  // Here we go!`
  //   )
})
