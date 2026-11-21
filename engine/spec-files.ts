import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CommandError, type MissionDetail } from "./contract.ts";
import { gitAt, worktree } from "./pilot.ts";

export function commitSpec(repository: string, m: MissionDetail, date: string) {
  try {
    const cwd = worktree(repository, m.issueKey);
    // Check each directory before creating its child. A link could lead into the project's own checkout.
    let directory = cwd;
    for (const name of ["docs", "missions", m.issueKey]) {
      directory = join(directory, name);
      const entry = lstatSync(directory, { throwIfNoEntry: false });
      if (!entry) mkdirSync(directory);
      else if (!entry.isDirectory()) throw new Error("Invalid document directory");
    }
    const header = (title: string, author: string) =>
      ["---", "title: " + m.issueKey + " — " + title, "status: validated", "date: " + date, "author: " + author, "---", "", "# " + title];
    const spec = header("Spec", "Pilot");
    for (const section of m.spec!.sections) spec.push("", "## " + section.title, "", section.passages.map(p => p.text).join("\n\n"));
    const answers = header("Answers", "Operator");
    answers.push("", "## Request details", "", m.details.join("\n\n"), "", "## Validated answers");
    for (const q of m.questions) answers.push("", "### " + q.text, "", q.answer!);
    const docs = [["spec.md", spec.join("\n")], ["answers.md", answers.join("\n")]];
    for (const [name, content] of docs) {
      const file = join(directory, name);
      const tmp = join(directory, "." + randomUUID());
      writeFileSync(tmp, content + "\n", { flag: "wx" });
      try { renameSync(tmp, file); }
      finally { rmSync(tmp, { force: true }); }
    }
    const paths = docs.map(([name]) => join("docs", "missions", m.issueKey, name));
    gitAt(cwd, "add", "--", ...paths);
    if (gitAt(cwd, "diff", "--cached", "--name-only", "HEAD", "--", ...paths).trim()) {
      gitAt(cwd, "-c", "commit.gpgSign=false", "commit", "--only", "-m", "Validate spec and answers for " + m.issueKey, "--", ...paths);
    }
  } catch { throw new CommandError("Impossible d’enregistrer la spec et les réponses sur la branche de la mission."); }
}
