import fs from 'node:fs'
import path from 'node:path'

const fileWriteQueues = new Map<string, Promise<void>>()
let atomicWriteSequence = 0

export async function ensureDir(dir: string): Promise<void> {
  await fs.promises.mkdir(dir, { recursive: true })
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath)
    return true
  } catch {
    return false
  }
}

async function runSerializedFileWrite(filePath: string, operation: () => Promise<void>): Promise<void> {
  const previous = fileWriteQueues.get(filePath) ?? Promise.resolve()
  const current = previous
    .catch(() => undefined)
    .then(operation)

  fileWriteQueues.set(filePath, current)

  try {
    await current
  } finally {
    if (fileWriteQueues.get(filePath) === current) {
      fileWriteQueues.delete(filePath)
    }
  }
}

export async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  await runSerializedFileWrite(filePath, async () => {
    await ensureDir(path.dirname(filePath))
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.${atomicWriteSequence += 1}.tmp`
    const handle = await fs.promises.open(tempPath, 'w')

    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }

    await fs.promises.rename(tempPath, filePath)
  })
}
