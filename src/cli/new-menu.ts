// Name: New Script From...
// Description: Script Kit
// Pass: true
// Keyword: nf

import { Choice } from "../types/core"
import { Main, CLI } from "./index"
import {
  kitMode,
  returnOrEnter,
  run,
} from "../core/utils.js"
import { addPreview, findDoc } from "./lib/utils.js"

setFlags({})

let newChoices: Choice<keyof CLI | keyof Main>[] = [
  {
    name: "New Script",
    description: `Create a script using ${
      kitMode() === "ts" ? "TypeScript" : "JavaScript"
    }`,
    value: "new",
  },
  {
    name: "New Script from Template",
    description: `Create a script from a template`,
    value: "new-from-template",
  },
  {
    name: "New from URL/Gist",
    description: "Create a script from a URL or Gist",
    value: "new-from-url",
  },
  {
    name: "New from Tips",
    description:
      "Browse a variety of tips and tricks to get started",
    value: "tips",
  },
  {
    name: "New from Community Examples",
    description:
      "Visit scriptkit.com/scripts/ for a variety of examples",
    value: "browse-examples",
  },
]

let onNoChoices = async input => {
  if (input) {
    let scriptName = input
      .replace(/[^\w\s]/g, "")
      .replace(/\s/g, "-")
      .toLowerCase()

    setPanel(
      md(`# Create <code>${scriptName}</code>

Type <kbd>${returnOrEnter}</kd> to create a script named <code>${scriptName}</code>
    `)
    )
  }
}

let cliScript = await arg<keyof CLI | keyof Main>(
  {
    placeholder: "Create a new script",
    strict: false,
    onNoChoices,
    resize: false,
    input: arg?.input,
    shortcuts: [],
    enter: "Run",
  },
  newChoices
)
if (cliScript === "snippets" || cliScript === "templates") {
  await run(kitPath("main", `${cliScript}.js`))
} else if (cliScript === "tips") {
  await mainScript("", "tips")
} else if (flag?.discuss) {
  let doc = await findDoc("templates", cliScript)
  if (doc?.discussion) {
    browse(doc?.discussion)
  }
} else if (
  newChoices.find(script => script.value === cliScript)
) {
  await run(kitPath(`cli`, cliScript + ".js"))
} else {
  await run(
    `${kitPath("cli", "new")}.js`,
    cliScript.replace(/\s/g, "-").toLowerCase(),
    `--scriptName`,
    cliScript
  )
}

export {}
