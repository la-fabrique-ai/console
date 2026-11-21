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

export interface MissionDetail extends Mission {
  /** What the operator added to the issue before validating the request. */
  details: string[];
  /** What Pilot is working on. Absent when it waits for the operator. */
  pilotBusy?: "questions" | "proposal" | "spec";
  /** Absent until Pilot has sent its first spec. */
  spec?: Spec;
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
