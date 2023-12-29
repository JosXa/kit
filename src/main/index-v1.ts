export interface Main {
  api: Promise<typeof import("./api")>
  edit: Promise<typeof import("./edit")>
  guide: Promise<typeof import("./guide")>
  hot: Promise<typeof import("./hot")>
  index: Promise<typeof import("./index")>
  account: Promise<typeof import("./account")>
  kenv: Promise<typeof import("./kenv")>
  kit: Promise<typeof import("./kit")>
  new: Promise<typeof import("./new")>
  showandtell: Promise<typeof import("./showandtell")>
  snippets: Promise<typeof import("./snippets")>
  templates: Promise<typeof import("./templates")>
  tips: Promise<typeof import("./tips")>
  community: Promise<typeof import("./community")>
  announcements: Promise<typeof import("./announcements")>
}

interface MainModuleLoader {
  (
    packageName: keyof Main,
    ...moduleArgs: string[]
  ): Promise<any>
}

declare global {
  var main: MainModuleLoader
}

global.onTabs = []

onTab("Script", async (input = "") => {
  await main("index", "--input", arg?.input || input)
})

// onTab("New", async (input = "") => {
//   await main("new", "--input", input)
// })

onTab("Kit", async (input = "") => {
  await main("kit", "--input", input)
})

onTab("API", async (input = "") => {
  await main("api", "--input", input)
})

onTab("Guide", async (input = "") => {
  await main("guide", "--input", input)
})

onTab("Community", async (input = "") => {
  await main("hot", "--input", input)
})

onTab("Account__", async input => {
  await main("account", "--input", input)
})
