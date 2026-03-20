import simpleGit, { type SimpleGit, type SimpleGitProgressEvent } from "simple-git";
import { existsSync } from "node:fs";
import path from "node:path";
import { logger } from "../lib/logger";
import type { GitCloneRequest, GitCloneProgress } from "@/types";
import { getGithubToken, injectTokenIntoUrl } from "./github";
import { validateSshKeyPath } from "../lib/validators";

export class GitService {
  private stacksDir: string;

  constructor(stacksDir: string) {
    this.stacksDir = stacksDir;
  }

  async cloneRepo(
    request: GitCloneRequest,
    onProgress?: (progress: GitCloneProgress) => void
  ): Promise<{ path: string; composeFiles: string[] }> {
    const targetPath = path.join(this.stacksDir, request.targetDir);
    const resolvedTarget = path.resolve(targetPath);
    const resolvedStacksDir = path.resolve(this.stacksDir);

    if (!resolvedTarget.startsWith(resolvedStacksDir + path.sep)) {
      throw new Error("Target directory must be within the stacks directory");
    }

    if (existsSync(targetPath)) {
      throw new Error(`Target directory already exists: ${request.targetDir}`);
    }

    const git: SimpleGit = simpleGit({
      progress: (event: SimpleGitProgressEvent) => {
        onProgress?.({
          stage: event.stage,
          progress: event.progress,
          total: event.total,
        });
      },
    });

    if (request.sshKeyPath) {
      const validatedPath = validateSshKeyPath(request.sshKeyPath);
      const sshCmd = `ssh -i "${validatedPath}" -o StrictHostKeyChecking=accept-new`;
      git.env("GIT_SSH_COMMAND", sshCmd);
      logger.debug("git", `Using SSH key: ${validatedPath}`);
    }

    const cloneArgs: string[] = ["--depth", "1"];
    if (request.branch) {
      cloneArgs.push("--branch", request.branch);
    }

    // Inject GitHub OAuth token if available for github.com HTTPS URLs
    let cloneUrl = request.repoUrl;
    const githubToken = getGithubToken();
    if (githubToken) {
      cloneUrl = injectTokenIntoUrl(cloneUrl, githubToken);
    }

    logger.info("git", `Cloning ${request.repoUrl} -> ${targetPath}`);
    await git.clone(cloneUrl, targetPath, cloneArgs);
    logger.info("git", `Clone complete: ${targetPath}`);

    const composeFiles = this.detectComposeFiles(targetPath);
    logger.debug("git", `Detected compose files: ${composeFiles.join(", ") || "none"}`);

    return { path: targetPath, composeFiles };
  }

  /** Configure git to use GitHub token via environment (never written to .git/config). */
  private configureGithubToken(git: SimpleGit): void {
    const githubToken = getGithubToken();
    if (githubToken) {
      git.env("GIT_CONFIG_COUNT", "1");
      git.env("GIT_CONFIG_KEY_0", "url.https://x-access-token:" + githubToken + "@github.com/.insteadOf");
      git.env("GIT_CONFIG_VALUE_0", "https://github.com/");
    }
  }

  /** Configure SSH to accept new host keys (prevents "Host key verification failed" in Docker). */
  private configureSsh(git: SimpleGit, sshKeyPath?: string): void {
    const parts = ["ssh", "-o", "StrictHostKeyChecking=accept-new"];
    if (sshKeyPath && existsSync(sshKeyPath)) {
      parts.push("-i", sshKeyPath);
    }
    git.env("GIT_SSH_COMMAND", parts.join(" "));
  }

  /** Configure both GitHub token and SSH for a repo operation. */
  private configureRepo(git: SimpleGit, repoUrl?: string, sshKeyPath?: string): void {
    this.configureGithubToken(git);
    // For SSH URLs, always configure SSH command
    if (!repoUrl || repoUrl.startsWith("git@") || repoUrl.includes("ssh://")) {
      this.configureSsh(git, sshKeyPath);
    }
  }

  async pullRepo(repoPath: string, branch?: string, repoUrl?: string, sshKeyPath?: string): Promise<string> {
    if (!existsSync(repoPath)) {
      throw new Error(`Repository path does not exist: ${repoPath}`);
    }

    const git: SimpleGit = simpleGit(repoPath);
    this.configureRepo(git, repoUrl, sshKeyPath);

    // Unshallow if needed (clone was --depth 1)
    const isShallow = existsSync(path.join(repoPath, ".git", "shallow"));
    if (isShallow) {
      await git.fetch(["--unshallow"]);
    }
    const result = await git.pull("origin", branch || undefined);
    logger.info("git", `Pull complete in ${repoPath}: ${JSON.stringify(result.summary)}`);
    return result.summary.changes
      ? `Updated: ${result.summary.insertions} insertions, ${result.summary.deletions} deletions, ${result.summary.changes} files changed`
      : "Already up to date.";
  }

  async checkoutBranch(repoPath: string, branch: string, repoUrl?: string, sshKeyPath?: string): Promise<string> {
    if (!existsSync(repoPath)) {
      throw new Error(`Repository path does not exist: ${repoPath}`);
    }

    const git: SimpleGit = simpleGit(repoPath);
    this.configureRepo(git, repoUrl, sshKeyPath);

    // Unshallow first if needed
    const isShallow = existsSync(path.join(repoPath, ".git", "shallow"));
    if (isShallow) {
      await git.fetch(["--unshallow"]);
    }

    await git.fetch(["origin"]);
    await git.checkout(branch);
    const result = await git.pull("origin", branch);
    logger.info("git", `Checkout ${branch} in ${repoPath}`);
    return result.summary.changes
      ? `Switched to ${branch}: ${result.summary.changes} files changed`
      : `Switched to ${branch}`;
  }

  async listRemoteBranches(repoPath: string, repoUrl?: string, sshKeyPath?: string): Promise<string[]> {
    if (!existsSync(repoPath)) return [];

    const git: SimpleGit = simpleGit(repoPath);
    this.configureRepo(git, repoUrl, sshKeyPath);

    try {
      await git.fetch(["origin"]);
      const branches = await git.branch(["-r"]);
      const remote = branches.all
        .filter((b) => b.startsWith("origin/") && !b.includes("HEAD"))
        .map((b) => b.replace("origin/", ""));
      if (remote.length > 0) return remote;
    } catch {
      // Remote fetch failed (auth/network), fall back to local branches
    }

    const local = await git.branchLocal();
    return local.all;
  }

  detectComposeFiles(dir: string): string[] {
    const composePatterns = [
      "docker-compose.yml",
      "docker-compose.yaml",
      "compose.yml",
      "compose.yaml",
    ];
    return composePatterns.filter((f) => existsSync(path.join(dir, f)));
  }
}
