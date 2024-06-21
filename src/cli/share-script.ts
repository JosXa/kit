//Menu: Share Script as Gist
//Description: Create a gist from the selected script

import { authenticate } from '../api/kit.js'

let { filePath, command } = await selectScript('Share which script?')

let octokit = await authenticate()

div(md('## Creating Gist...'))
setLoading(true)

let fileBasename = path.basename(filePath)

let response = await octokit.rest.gists.create({
  files: {
    [fileBasename]: {
      content: await readFile(filePath, 'utf8'),
    },
  },
  public: true,
})

let link = response.data?.files[command + path.extname(filePath)].raw_url

copy(link)

setLoading(false)

await div(
  await highlight(`## Copied Gist to Clipboard

  [${link}](${link})
`),
)
