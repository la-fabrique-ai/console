import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CommandError, type MissionDetail, type Plan } from "./contract.ts";
import { gitAt, worktree } from "./pilot.ts";

// Keep the raw words readable. Escape block markers on each source line and literal HTML tags.
export function markdownText(value: string) {
  return value.replace(/\r\n?/g, "\n")
    .replace(/(\\*)<(?=\/?[a-zA-Z][\w-]*(?:[\s/>]|$)|[!?])/g,
      (tag, slashes: string) => slashes.length % 2 ? tag : slashes + "\\<")
    .replace(/^([ \t]*)(#{1,6}(?=[ \t]|$)|[-*+](?=[ \t]|$)|>|`{3,}|~{3,}|=+[ \t]*$|(?:-[ \t]*){2,}$|(?:\*[ \t]*){3,}$|(?:_[ \t]*){3,}$)/gm, "$1\\$2")
    .replace(/^([ \t]*)\[(?=(?:\\[^\n]|[^\[\]\\\n])+]:)/gm, "$1\\[")
    .replace(/^([ \t]*\d{1,9})([.)])(?=[ \t]|$)/gm, "$1\\$2");
}

export function singleLine(value: string) {
  return value.replace(/\r\n?|\n/g, " ");
}

function heading(value: string) {
  return markdownText(singleLine(value));
}

export function localDate() {
  const day = new Date();
  return [day.getFullYear(), day.getMonth() + 1, day.getDate()].map(n => String(n).padStart(2, "0")).join("-");
}

function header(key: string, date: string, title: string, author: string) {
  return ["---", "title: " + key + " — " + title, "status: validated", "date: " + date, "author: " + author, "---", "", "# " + title];
}

function commitDocuments(repository: string, key: string, docs: [string, string[]][], message: string) {
  const cwd = worktree(repository, key);
  // Check each directory before creating its child. A link could lead into the project's own checkout.
  let directory = cwd;
  for (const name of ["docs", "missions", key]) {
    directory = join(directory, name);
    const entry = lstatSync(directory, { throwIfNoEntry: false });
    if (!entry) mkdirSync(directory);
    else if (!entry.isDirectory()) throw new Error("Invalid document directory");
  }
  for (const [name, content] of docs) {
    const file = join(directory, name);
    const tmp = join(directory, "." + randomUUID());
    writeFileSync(tmp, content.join("\n") + "\n", { flag: "wx" });
    try { renameSync(tmp, file); }
    finally { rmSync(tmp, { force: true }); }
  }
  const paths = docs.map(([name]) => join("docs", "missions", key, name));
  gitAt(cwd, "add", "--", ...paths);
  if (gitAt(cwd, "diff", "--cached", "--name-only", "HEAD", "--", ...paths).trim()) {
    gitAt(cwd, "commit", "--only", "-m", message + key, "--", ...paths);
  }
}

export function commitSpec(repository: string, m: MissionDetail, date: string) {
  try {
    const spec = header(m.issueKey, date, "Spec", "Pilot");
    for (const section of m.spec!.sections) spec.push("", "## " + heading(section.title), "", section.passages.map(p => markdownText(p.text)).join("\n\n"));
    const answers = header(m.issueKey, date, "Answers", "Operator");
    if (m.details.length) answers.push("", "## Request details", "", m.details.map(markdownText).join("\n\n"));
    answers.push("", "## Validated answers");
    for (const q of m.questions) answers.push("", "### " + heading(q.text), "", markdownText(q.answer!));
    commitDocuments(repository, m.issueKey, [["spec.md", spec], ["answers.md", answers]], "Validate spec and answers for ");
  } catch { throw new CommandError("Impossible d’enregistrer la spec et les réponses sur la branche de la mission."); }
}

const splitFileError = "Impossible d’enregistrer le découpage sur la branche de la mission.";

export function hasCommittedSplit(repository: string, key: string) {
  try {
    return Boolean(gitAt(worktree(repository, key), "ls-tree", "HEAD", "--", join("docs", "missions", key, "split.md")).trim());
  } catch { throw new CommandError(splitFileError); }
}

export function commitSplit(repository: string, key: string, plan: Plan, date: string) {
  try {
    const split = header(key, date, "Split", "Pilot");
    split.push("", "Team: " + plan.team.join(" / "), "", markdownText(plan.advice), "",
      "Testing: " + plan.testMinutes + " min", "Validation: " + plan.validationMinutes + " min");
    for (const t of plan.tickets) {
      split.push("", "## Ticket " + heading(t.id) + " — " + heading(t.title),
        "", "### Change", "", markdownText(t.change), "", "### Implementation", "", markdownText(t.how));
      if (t.covers.length) split.push("", "### Coverage", "", t.covers.map(markdownText).join("\n\n"));
      if (t.after.length) split.push("", "### Dependencies", "", t.after.map(markdownText).join("\n\n"));
      split.push("", "Size: " + t.minutes + " min" + (t.sensitive ? " · high-risk" : ""),
        "Parallel schedule: dev " + t.parallel.dev + ", step " + t.parallel.step);
    }
    commitDocuments(repository, key, [["split.md", split]], "Approve ticket plan for ");
  } catch { throw new CommandError(splitFileError); }
}
