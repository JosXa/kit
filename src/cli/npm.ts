import { adjustPackageName } from '../core/utils.js'
import { appInstallMultiple } from '../target/app.js'

flag.trigger = undefined
flag.force = undefined

let missingPackages = [
  ...new Set(
    args.reduce((acc, pkg) => {
      !pkg.startsWith('node:') && acc.push(adjustPackageName(pkg))
      return acc
    }, []),
  ),
]
args = []

if (missingPackages.length > 1) {
  await appInstallMultiple(missingPackages)
} else if (missingPackages.length === 1) {
  await installMissingPackage(missingPackages[0])
}
