import crypto from 'node:crypto'

export class MeshIdFactory {
  public createInstanceId(service: string): string {
    const suffix = crypto.randomBytes(3).toString('hex')
    return `${service}-${suffix}`
  }
}
