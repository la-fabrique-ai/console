export type Stage = "prepare" | "develop" | "test" | "validate";

export interface IssueSummary {
  key: string;
  title: string;
  status: string;
  missionStage?: Stage;
}

export interface IssueDetail extends IssueSummary {
  description: string;
  url: string;
}

export interface Mission {
  issueKey: string;
  title: string;
  stage: Stage;
}

export interface Question {
  id: string;
  text: string;
  /** One line saying why Pilot asks. */
  context: string;
  /** Pilot's proposed answers, oldest first; the last one is the current one. */
  proposals: string[];
  /** What the operator wrote instead of validating, oldest first. */
  replies: string[];
  /** The proposal the operator validated. Absent while the question is open. */
  answer?: string;
}

export interface SpecPassage {
  text: string;
  /** Where it comes from, as shown beside it: the request, an answer, Pilot. */
  source: string;
  /** Changed in this version. */
  changed?: boolean;
}

export interface Spec {
  /** 1 for Pilot's first spec, one more for each one it sends after a change request. */
  version: number;
  /** Pilot's message above the document: what it wrote, or what changed. */
  note: string;
  sections: { title: string; passages: SpecPassage[] }[];
  /** The operator's change requests, oldest first. */
  requests: string[];
  /** Set once the operator validated this version: the spec is then in the project's `docs/`. */
  validated?: boolean;
}

export type Tool = "claude" | "codex";

export interface PlanTicket {
  /** "1", "2"… in the order one dev builds them. */
  id: string;
  title: string;
  /** What it changes for the user. */
  change: string;
  how: string;
  /** The points of the spec it covers. */
  covers: string[];
  /** The tickets that must be done before it, by id. */
  after: string[];
  minutes: number;
  /** A high-risk ticket: approach reviewed before code, two reviews. */
  sensitive: boolean;
  /** Its place when two devs work: which dev, and at which step (1, 2…). Tickets of one step run at the same time. */
  parallel: { dev: 1 | 2; step: number };
  /** Its key in the tracker, once the launch has created it. */
  key?: string;
}

export interface Plan {
  /** What Pilot has found so far, while it is still splitting. */
  found: { id: string; title: string; change: string }[];
  /** Empty until the split is complete. */
  tickets: PlanTicket[];
  testMinutes: number;
  validationMinutes: number;
  /** Pilot's one-line advice on the team. */
  advice: string;
  /** The operator's choice: one tool per dev, one or two devs. Starts with one dev. */
  team: Tool[];
  /** Set once the operator approved the plan: the sub-tickets exist in the tracker and nothing changes any more. */
  launched?: boolean;
}

/** One turn of work on a ticket. The last step says who holds the ticket; a step without `endedAt` is running. */
export interface TicketStep {
  /** "fix" is a dev's turn after a review asked for fixes. */
  kind: "build" | "review" | "fix";
  tool: Tool;
  /** ISO dates. */
  startedAt: string;
  endedAt?: string;
  /** build and fix: what the dev says it did, and the commit handed to the reviewer. */
  summary?: string;
  commit?: string;
  /** review: the verdict, and the remarks to fix when it is not accepted. */
  accepted?: boolean;
  remarks?: string[];
}

/** A ticket of the plan once a dev has started it. It is accepted, and its PR merged into the mission branch, when its last step is an accepted review. */
export interface TicketRun {
  /** The id of its `PlanTicket`. */
  id: string;
  branch: string;
  steps: TicketStep[];
  /** Its draft PR towards the mission branch, opened when the dev first hands it to review. */
  pr?: { number: number; url: string };
}

/** What an agent needs from the operator (decision 0006). Answered on screen; the answer reaches the agent's terminal once. */
export interface Request {
  id: string;
  from: "lead" | "dev" | "reviewer";
  /** The plan ticket it is about, if any: that ticket waits for the answer. */
  ticketId?: string;
  text: string;
  /** One line saying why the agent asks. */
  context: string;
  /** Proposed answers, the recommended one first. May be empty. */
  choices: string[];
  answer?: string;
}

export interface Development {
  /** The tickets started so far, in the order they started. */
  tickets: TicketRun[];
  /** Oldest first. */
  requests: Request[];
  /** The mission's draft PR towards the project's main branch. The system never merges it. */
  pr?: { number: number; url: string };
}

export interface MissionDetail extends Mission {
  /** What the operator added to the issue before validating the request. */
  details: string[];
  /** What Pilot is working on. Absent when it waits for the operator. */
  pilotBusy?: "questions" | "proposal" | "spec" | "split";
  /** Absent until Pilot has sent its first spec. */
  spec?: Spec;
  /** Absent until Pilot has found a first ticket. A draft until it is launched. */
  plan?: Plan;
  /** Absent until the Lead has been started. */
  development?: Development;
  /** Pilot's terminal in Herdr Core, for whoever wants to open it. */
  pilotTerminal?: string;
  /** Empty until Pilot has sent its questions. */
  questions: Question[];
}

interface OfMission {
  issueKey: string;
}

/**
 * The screen's actions, then Pilot's (`pilot.*`). A screen action that needs
 * Pilot reaches its terminal once; a Pilot action clears `pilotBusy`.
 */
export interface Payloads {
  "issues.list": Record<string, never>;
  "issues.show": { key: string };
  /** Validate the request: the mission is created and Pilot starts. */
  "missions.create": OfMission & { details?: string[] };
  "missions.list": Record<string, never>;
  "missions.show": OfMission;
  /** Validate the current proposal of a question. */
  "questions.validate": OfMission & { questionId: string };
  /** Write another answer: Pilot proposes again. Reopens a validated question. */
  "questions.reply": OfMission & { questionId: string; text: string };
  /** Every question has an answer: ask Pilot for the spec. */
  "spec.write": OfMission;
  /** Ask for a change: Pilot sends the next version. */
  "spec.change": OfMission & { text: string };
  /** Validate the current version: it is written in the project's `docs/`, on the mission branch. */
  "spec.validate": OfMission;
  "pilot.spec": OfMission & { note: string; sections: Spec["sections"] };
  /** Choose one or two devs and their tools. Local: nothing is asked of Pilot, nothing is written to the tracker. */
  "plan.team": OfMission & { team: Tool[] };
  /** Approve the plan: the sub-tickets are created in the tracker and the mission moves to the develop stage. */
  "plan.launch": OfMission;
  /** One ticket found: the screen shows the split as it grows. */
  "pilot.ticket": OfMission & { ticket: Plan["found"][number] };
  /** The split is complete. `summary` is the short summary of the spec written in the main ticket at launch. */
  "pilot.plan": OfMission & { tickets: Omit<PlanTicket, "key">[]; testMinutes: number; validationMinutes: number; advice: string; summary: string };
  /**
   * Start the Lead in a fresh terminal, unless it is already running. `plan.launch` does the same after creating the
   * sub-tickets; this action is for a mission launched before, or whose Lead terminal is gone. Writes nothing to the tracker.
   */
  "develop.start": OfMission;
  /** Answer a request: the text reaches the terminal of the agent that asked, once. */
  "requests.answer": OfMission & { requestId: string; text: string };
  /**
   * The agents' actions. The engine knows who calls from the terminal it started, not from the payload.
   * Lead: have a ready ticket built. The engine creates its branch from the mission branch and its worktree, and starts its dev.
   */
  "lead.build": OfMission & { ticketId: string };
  /** Dev: the work is committed. The engine pushes, opens the draft PR the first time, and starts a fresh reviewer of the other family on that commit. */
  "dev.done": OfMission & { ticketId: string; summary: string };
  /** Reviewer: accepted, the engine merges the ticket's PR into the mission branch and tells the Lead; otherwise the remarks reach the dev, once. */
  "review.verdict": OfMission & { ticketId: string; accepted: boolean; remarks: string[] };
  /** Any agent: ask the operator. */
  "request.ask": OfMission & { ticketId?: string; text: string; context: string; choices: string[] };
  /** Anything else the operator tells Pilot. */
  "pilot.tell": OfMission & { text: string };
  /** Pilot's questions, or questions it adds after an answer. */
  "pilot.questions": OfMission & { questions: { id: string; text: string; context: string; proposal: string }[] };
  "pilot.propose": OfMission & { questionId: string; proposal: string };
}

export interface Results {
  "issues.list": IssueSummary[];
  "issues.show": IssueDetail;
  "missions.create": Mission;
  "missions.list": Mission[];
  "missions.show": MissionDetail;
  "questions.validate": MissionDetail;
  "questions.reply": MissionDetail;
  "spec.write": MissionDetail;
  "spec.change": MissionDetail;
  "spec.validate": MissionDetail;
  "pilot.spec": MissionDetail;
  "plan.team": MissionDetail;
  "plan.launch": MissionDetail;
  "develop.start": MissionDetail;
  "requests.answer": MissionDetail;
  "lead.build": MissionDetail;
  "dev.done": MissionDetail;
  "review.verdict": MissionDetail;
  "request.ask": MissionDetail;
  "pilot.ticket": MissionDetail;
  "pilot.plan": MissionDetail;
  "pilot.tell": MissionDetail;
  "pilot.questions": MissionDetail;
  "pilot.propose": MissionDetail;
}

export type Action = keyof Payloads;
export type ErrorCode = "issue_not_allowed" | "linear_key_missing" | "failed";
export type Reply<A extends Action> = { data: Results[A] } | { error: { code: ErrorCode; message: string } };

/** Only fixed operator-facing messages cross the CLI boundary. */
export class CommandError extends Error {
  readonly code: ErrorCode;
  constructor(message: string, code: ErrorCode = "failed") {
    super(message);
    this.code = code;
  }
}
