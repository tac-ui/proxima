import { type NextRequest } from "next/server";
import { requireAuth, errorResponse, ok } from "../../../_lib/auth";
import { ensureDb } from "../../../_lib/db";
import { getDb, schema } from "@server/db/index";
import { eq } from "drizzle-orm";
import { readFile, access } from "node:fs/promises";
import path from "node:path";

interface SuggestedScript {
  name: string;
  command: string;
  preCommand?: string;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function detectPackageManager(repoPath: string): Promise<{ run: (name: string) => string; install: string }> {
  if (await fileExists(path.join(repoPath, "pnpm-lock.yaml"))) {
    return { run: (name) => `pnpm run ${name}`, install: "pnpm install" };
  }
  if (await fileExists(path.join(repoPath, "yarn.lock"))) {
    return { run: (name) => `yarn ${name}`, install: "yarn install" };
  }
  return { run: (name) => `npm run ${name}`, install: "npm install" };
}

async function detectNodeScripts(repoPath: string): Promise<SuggestedScript[]> {
  const suggestions: SuggestedScript[] = [];
  try {
    const pkgRaw = await readFile(path.join(repoPath, "package.json"), "utf-8");
    const pkg = JSON.parse(pkgRaw);
    if (pkg.scripts && typeof pkg.scripts === "object") {
      const pm = await detectPackageManager(repoPath);
      for (const [name, cmd] of Object.entries(pkg.scripts)) {
        if (typeof cmd === "string") {
          suggestions.push({ name, command: pm.run(name), preCommand: pm.install });
        }
      }
    }
  } catch {
    // no package.json
  }
  return suggestions;
}

async function detectMavenScripts(repoPath: string): Promise<SuggestedScript[]> {
  if (!(await fileExists(path.join(repoPath, "pom.xml")))) return [];
  return [
    { name: "build", command: "mvn clean package", preCommand: "mvn dependency:resolve" },
    { name: "run", command: "mvn spring-boot:run" },
    { name: "test", command: "mvn test" },
  ];
}

async function detectGradleScripts(repoPath: string): Promise<SuggestedScript[]> {
  const hasBuildGradle = await fileExists(path.join(repoPath, "build.gradle"));
  const hasBuildGradleKts = await fileExists(path.join(repoPath, "build.gradle.kts"));
  if (!hasBuildGradle && !hasBuildGradleKts) return [];

  const hasGradlew = await fileExists(path.join(repoPath, "gradlew"));
  const cmd = hasGradlew ? "./gradlew" : "gradle";

  const scripts: SuggestedScript[] = [
    { name: "build", command: `${cmd} build` },
    { name: "test", command: `${cmd} test` },
  ];

  // Only suggest bootRun if Spring Boot is detected
  try {
    const gradleFile = hasBuildGradleKts ? "build.gradle.kts" : "build.gradle";
    const content = await readFile(path.join(repoPath, gradleFile), "utf-8");
    if (content.includes("org.springframework.boot") || content.includes("spring-boot")) {
      scripts.push({ name: "run", command: `${cmd} bootRun` });
    }
  } catch {
    // ignore read error
  }

  return scripts;
}

async function detectPythonScripts(repoPath: string): Promise<SuggestedScript[]> {
  const suggestions: SuggestedScript[] = [];

  // Check pyproject.toml for Poetry
  try {
    const pyproject = await readFile(path.join(repoPath, "pyproject.toml"), "utf-8");
    if (pyproject.includes("[tool.poetry]")) {
      suggestions.push({ name: "install", command: "poetry install" });
      if (await fileExists(path.join(repoPath, "main.py"))) {
        suggestions.push({ name: "run", command: "poetry run python main.py" });
      }
      return suggestions;
    }
  } catch {
    // no pyproject.toml
  }

  // Check requirements.txt
  const hasRequirements = await fileExists(path.join(repoPath, "requirements.txt"));
  const hasManagePy = await fileExists(path.join(repoPath, "manage.py"));

  if (hasRequirements) {
    suggestions.push({ name: "install", command: "pip install -r requirements.txt" });
  }

  if (hasManagePy) {
    suggestions.push({
      name: "runserver",
      command: "python manage.py runserver",
      ...(hasRequirements ? { preCommand: "pip install -r requirements.txt" } : {}),
    });
    suggestions.push({ name: "migrate", command: "python manage.py migrate" });
  }

  return suggestions;
}

async function detectMakefileScripts(repoPath: string): Promise<SuggestedScript[]> {
  const suggestions: SuggestedScript[] = [];
  try {
    const makefile = await readFile(path.join(repoPath, "Makefile"), "utf-8");
    const targets = makefile.match(/^([a-zA-Z_][\w-]*):/gm);
    if (targets) {
      for (const t of targets) {
        const name = t.replace(":", "");
        suggestions.push({ name, command: `make ${name}` });
      }
    }
  } catch {
    // no Makefile
  }
  return suggestions;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    ensureDb();
    requireAuth(req);

    const { id } = await params;
    const repoId = parseInt(id, 10);
    if (isNaN(repoId)) throw new Error("Invalid repository id");

    const db = getDb();
    const repo = db.select().from(schema.repositories).where(eq(schema.repositories.id, repoId)).get();
    if (!repo) throw new Error("Repository not found");

    const results = await Promise.all([
      detectNodeScripts(repo.path),
      detectMavenScripts(repo.path),
      detectGradleScripts(repo.path),
      detectPythonScripts(repo.path),
      detectMakefileScripts(repo.path),
    ]);

    const suggestions = results.flat();

    return ok({ suggestions });
  } catch (err) {
    return errorResponse(err);
  }
}
