// Description: Git Push Kenv Repo

import { getKenvs, getShellSeparator } from '../core/utils.js'

let kenvs = (await getKenvs()).map((value) => ({
  name: path.basename(value),
  value,
}))

kenvs.unshift({
  name: 'main',
  value: kenvPath(),
})

let dir = await arg('Push which kenv', kenvs)

cd(dir)

let shellSep = getShellSeparator()

await term({
  command: 'git status',
  cwd: dir,
  shortcuts: [
    {
      name: 'Add, Commit, Push',
      key: `${cmd}+p`,
      bar: 'left',
      onPress: async () => {
        term.write(`git add . ${shellSep} git commit -m "pushed from Script Kit" ${shellSep} git push`)
      },
    },
    {
      name: 'Add All',
      key: `${cmd}+g`,
      bar: 'right',
      onPress: async () => {
        term.write('git add .')
      },
    },
    {
      name: 'Commit',
      key: `${cmd}+i`,
      bar: 'right',
      onPress: async () => {
        term.write(`git commit -m "pushed from Script Kit"`)
      },
    },
    {
      name: 'Push',
      key: `${cmd}+t`,
      bar: 'right',
      onPress: async () => {
        term.write('git push')
      },
    },
    {
      name: 'Exit',
      key: `${cmd}+w`,
      bar: 'right',
      onPress: async () => {
        submit('')
      },
    },
  ],
})

await mainScript()
