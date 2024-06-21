import type { GlobalsApi } from '@johnlindquist/globals'
import type { KitApi, Run } from './kit'
import type { AppApi } from './kitapp'
import type { PackagesApi } from './packages'
import type { PlatformApi } from './platform'
import type { ProAPI } from './pro'

export type GlobalApi = Omit<GlobalsApi, 'path'> & KitApi & PackagesApi & PlatformApi & AppApi & ProAPI

declare global {
  var kit: GlobalApi & Run

  namespace NodeJS {
    interface Global extends GlobalApi {}
  }
}

export * from './core'
export * from '../core/utils'

export default kit
