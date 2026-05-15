import { homedir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"

export const CLI_DATA_DIR_NAME = "parallel-cli"
export const CLI_HOME_ENV = "PARALLEL_CLI_HOME"
export const ARTIFACT_DIR_ENV = "PARALLEL_CLI_ARTIFACT_DIR"
export const STATE_DIR_ENV = "PARALLEL_CLI_STATE_DIR"

const resolvePath = (path: string) => (isAbsolute(path) ? path : resolve(path))

const resolveEnvPath = (envVar: string, fallback: string) => {
  const override = Bun.env[envVar]?.trim()
  return resolvePath(override && override.length > 0 ? override : fallback)
}

export const getCliHome = () => {
  return resolveEnvPath(CLI_HOME_ENV, join(homedir(), ".config", CLI_DATA_DIR_NAME))
}

export const getArtifactDir = () => {
  return resolveEnvPath(ARTIFACT_DIR_ENV, join(getCliHome(), "artifacts"))
}

export const getStateDir = () => {
  return resolveEnvPath(STATE_DIR_ENV, join(getCliHome(), "state"))
}
