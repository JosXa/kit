import path from 'node:path'
import { parentPort } from 'node:worker_threads'
import { createBinFromScript } from '../cli/lib/utils.js'
import { Bin } from '../core/enum.js'
import type { Script } from '../types/core'

parentPort?.on('message', async (filePath) => {
  try {
    let command = path.parse(filePath).name

    await createBinFromScript(Bin.scripts, {
      filePath,
      command,
    } as Script)
    console.log(`Created bin from script: ${filePath}`)
  } catch (error) {
    console.log(`Error creating bin from script: ${filePath}`, error)
  }
  parentPort?.postMessage({ filePath })
})
