import { existsSync } from "fs"

//Description: Adds the .kenv bin dir to your $PATH
export {}

let kenv = await selectKenv()

let exportKenvPath = `export PATH="$PATH:${path.resolve(
  kenv.dirPath,
  "bin"
)}"`

let choices = [
  `.zshrc`,
  `.bashrc`,
  `.bash_profile`,
  `.config/fish/config.fish`,
  `.profile`,
]

let profiles = choices
  .map(profile => `${env.HOME}/${profile}`)
  .filter(profile => existsSync(profile))

let selectedProfile = await arg(
  "Select your profile:",
  profiles
)

await appendFile(selectedProfile, `\n${exportKenvPath}`)
let { stdout } = execaCommandSync(`wc ${selectedProfile}`)
let lineCount = stdout.trim().split(" ").shift()

await edit(selectedProfile, kenvPath(), lineCount)
