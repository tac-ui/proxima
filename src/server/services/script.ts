import fs from "node:fs";
import path from "node:path";
import { getConfig } from "../lib/config";

const FILENAME_PATTERN = /^[a-z0-9_-]+\.sh$/;

export class ScriptService {
  static getScriptsDir(projectName: string): string {
    const config = getConfig();
    return path.resolve(config.dataDir, "scripts", projectName);
  }

  static ensureScriptsDir(projectName: string): void {
    const dir = ScriptService.getScriptsDir(projectName);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  static list(projectName: string): { name: string; filename: string }[] {
    const dir = ScriptService.getScriptsDir(projectName);
    if (!fs.existsSync(dir)) return [];
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sh")).sort();
    return files.map((f) => ({
      name: f.replace(/\.sh$/, ""),
      filename: f,
    }));
  }

  static read(projectName: string, filename: string): string {
    ScriptService.validateFilename(filename);
    const filePath = ScriptService.getScriptPath(projectName, filename);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Script file not found: ${filename}`);
    }
    return fs.readFileSync(filePath, "utf-8");
  }

  static save(projectName: string, filename: string, content: string): void {
    ScriptService.validateFilename(filename);
    ScriptService.ensureScriptsDir(projectName);
    const filePath = ScriptService.getScriptPath(projectName, filename);
    fs.writeFileSync(filePath, content, { mode: 0o755 });
  }

  static delete(projectName: string, filename: string): void {
    ScriptService.validateFilename(filename);
    const filePath = ScriptService.getScriptPath(projectName, filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  static getScriptPath(projectName: string, filename: string): string {
    ScriptService.validateFilename(filename);
    return path.resolve(ScriptService.getScriptsDir(projectName), filename);
  }

  static deleteProjectDir(projectName: string): void {
    const dir = ScriptService.getScriptsDir(projectName);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  static slugify(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      || "script";
  }

  static toFilename(name: string): string {
    return `${ScriptService.slugify(name)}.sh`;
  }

  static validateFilename(filename: string): void {
    if (!FILENAME_PATTERN.test(filename)) {
      throw new Error(`Invalid script filename: ${filename}`);
    }
    if (filename.includes("..") || filename.includes("/")) {
      throw new Error("Path traversal detected");
    }
  }
}
