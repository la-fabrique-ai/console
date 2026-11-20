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

export interface Payloads {
  "issues.list": Record<string, never>;
  "issues.show": { key: string };
  "missions.create": { issueKey: string };
  "missions.list": Record<string, never>;
}

export interface Results {
  "issues.list": IssueSummary[];
  "issues.show": IssueDetail;
  "missions.create": Mission;
  "missions.list": Mission[];
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
