export interface Config {
  port: number;
  hostname: string;
  dataDir: string;
  hostDataDir: string;
  stacksDir: string;
  jwtSecret?: string;
  githubClientId?: string;
  githubClientSecret?: string;
}

export function getConfig(): Config {
  const dataDir = process.env.PXM_DATA_DIR || "./data";
  return {
    port: parseInt(process.env.PXM_PORT || "20222"),
    hostname: process.env.PXM_HOSTNAME || "0.0.0.0",
    dataDir,
    hostDataDir: process.env.PXM_HOST_DATA_DIR || dataDir,
    stacksDir: process.env.PXM_STACKS_DIR || "./data/stacks",
    githubClientId: process.env.GITHUB_CLIENT_ID,
    githubClientSecret: process.env.GITHUB_CLIENT_SECRET,
  };
}
