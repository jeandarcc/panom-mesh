export class MeshLockError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'MeshLockError'
  }
}

export class MeshLockTimeoutError extends MeshLockError {
  public constructor(key: string) {
    super(`Timed out waiting for mesh lock "${key}".`)
    this.name = 'MeshLockTimeoutError'
  }
}
