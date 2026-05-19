export class MeshError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

export class MeshConfigError extends MeshError {}
export class MeshStateError extends MeshError {}
export class MeshProcessError extends MeshError {}
export class MeshIdResolutionError extends MeshError {}
