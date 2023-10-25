/*
# Google Search

Perform a basic Google search
*/

// Name: Google
// Description: Search Google for Information
// Pass: true
// Keyword: goo

import {
  cmd,
  keywordInputTransformer,
} from "../core/utils.js"
let { default: google } = await import("googlethis")
const options = {
  page: 0,
  safe: false,
  additional_params: {
    // add additional parameters here, see https://moz.com/blog/the-ultimate-guide-to-the-google-search-parameters and https://www.seoquake.com/blog/google-search-param/
    hl: "en",
  },
}
let currentInput = ``
let title = ``
let url = ``
let pleaseType = [
  {
    name: `Type at least 2 characters`,
    skip: true,
    info: true,
  },
]
let transformer = keywordInputTransformer(arg?.keyword)
let pasteOptions = async () => {
  let asMarkdown = `[${title}](${url})`
  let asInputMarkdown = `[${currentInput}](${url})`
  let result = await arg(
    {
      placeholder: "Paste",
      enter: "Paste",
    },
    [
      {
        name: `Site Title + URL`,
        description: asMarkdown,
        value: asMarkdown,
      },
      {
        name: `Input + URL`,
        description: asInputMarkdown,
        value: asInputMarkdown,
      },
      { name: `URL`, description: url, value: url },
      { name: `Title`, description: title, value: title },
    ]
  )
  setSelectedText(result)
}

await arg(
  {
    preventCollapse: true,
    input: arg?.pass
      ? arg.pass
      : arg?.keyword
      ? `${arg.keyword} `
      : "",
    ...(!arg?.pass && { initialChoices: pleaseType }),
    placeholder: "Search Google",
    enter: `Open in Browser`,
    resize: true,
    alwaysOnTop: true,
    onBlur: async () => {
      focus()
    },
    shortcuts: [
      {
        name: `Paste Options`,
        key: `${cmd}+shift+v`,
        bar: `right`,
        onPress: pasteOptions,
      },
      {
        name: `Open and keep focus`,
        key: `${cmd}+enter`,
        bar: `right`,
        onPress: async () => {
          open(url)
        },
      },
    ],
    onChoiceFocus: async (_, { focused }) => {
      title = focused?.name
      url = focused?.value
    },
  },
  async input => {
    input = transformer(input)
    if (!input || input?.length < 2) {
      return pleaseType
    }
    currentInput = input
    try {
      let response = await google.search(input, options)

      const results = response.results.map(r => {
        let url = new URL(r.url)
        let img = `https://icons.duckduckgo.com/ip3/${url.hostname}.ico`
        return {
          name: r.title,
          description: r.url,
          value: r.url,
          img: r?.favicons?.high_res || img,
          preview: md(`# ${r.title}
  ${r.description}
  
  ${r.url}`),
        }
      })

      if (results.length) {
        return results
      } else {
        return [
          {
            name: `🤔 No Results... Open google.com?`,
            miss: true,
            enter: "Open Google",
            value: `https://google.com/search?q=${encodeURIComponent(
              input
            )}`,
          } as any,
          {
            name: `Update googlethis npm package?`,
            description:
              "An outdated package may cause search to fail",
            enter: `Update googlethis`,
            value: `Update googlethis`,
          },
        ]
      }
    } catch (e) {
      return [
        {
          name: `Error: ${e.message}`,
          description: `Try again later...`,
          value: `Try again`,
        },
      ]
    }
  }
)

if (url === `Update googlethis`) {
  await cli("update-kit-package", "googlethis")
} else {
  open(url)
}
