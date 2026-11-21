// The Mission Control window: issues, the page of one mission (the request,
// then Pilot's questions) and the list of missions. Drawn after
// docs/mockups/prepare-flow (states 01, 02, 08 to 13, 23 and 24).
import { View, div, type Context, type NativeElement } from "gpui-kit";
import { v_flex, h_flex, TextView, InputState, Input } from "gpui-base";
import { exec, checking, props } from "herdr";
import type { Action, IssueDetail, IssueSummary, Mission, MissionDetail, Payloads, Plan, PlanTicket, Question, Reply, Request, Stage, TicketRun, TicketStep, Tool } from "../../engine/contract.ts";

type Page = "issues" | "request" | "development";
type Spawner = Pick<Context, "spawn">;
type Field = "request" | "answer" | "again" | "tell" | "change" | "reply";
type Tab = "request" | "questions" | "spec" | "plan" | "develop";
const TABS: Tab[] = ["request", "questions", "spec", "plan", "develop"];
const TOOLS: Record<Tool, string> = { claude: "Claude", codex: "Codex" };

/** "45 min", "3 h", "3 h 10". */
function duration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours === 0 ? `${rest} min` : rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, "0")}`;
}

/** The steps of a plan built by two devs: at each step, each dev builds its tickets while the other builds its own. */
function stepsOf(tickets: PlanTicket[]): PlanTicket[][] {
  const steps: PlanTicket[][] = [];
  for (const ticket of tickets) (steps[ticket.parallel.step - 1] ??= []).push(ticket);
  return Array.from(steps, (step) => step ?? []);
}

/** Minutes of development with this many devs: one after the other, or step by step with the slower dev setting the pace. */
function development(tickets: PlanTicket[], devs: number): number {
  const sum = (list: PlanTicket[]) => list.reduce((total, ticket) => total + ticket.minutes, 0);
  if (devs === 1) return sum(tickets);
  return stepsOf(tickets).reduce((total, step) =>
    total + Math.max(sum(step.filter((ticket) => ticket.parallel.dev === 1)), sum(step.filter((ticket) => ticket.parallel.dev === 2))), 0);
}
type Tone = "todo" | "done" | "fixed";

/** Where a ticket stands during the development: who holds it. */
type Holding = "todo" | "building" | "review" | "fixing" | "waiting" | "accepted";

function holding(id: string, run: TicketRun | undefined, requests: Request[]): Holding {
  if (requests.some((request) => request.ticketId === id && request.answer === undefined)) return "waiting";
  if (!run) return "todo";
  const last = run.steps.at(-1);
  if (last?.kind === "review") return !last.endedAt ? "review" : last.accepted ? "accepted" : "fixing";
  return last?.kind === "fix" ? "fixing" : "building";
}

/** Whole minutes a step has taken; up to now while it runs. */
function spent(step: TicketStep): number {
  return Math.max(0, Math.round(((step.endedAt ? Date.parse(step.endedAt) : Date.now()) - Date.parse(step.startedAt)) / 60000));
}

/** "14:05". */
function hour(date: string): string {
  const at = new Date(date);
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

// A field keeps the placeholder it was created with: one field per placeholder.
const FIELDS: Record<Field, string> = {
  request: "Ajoutez une précision…",
  answer: "Écrivez une autre réponse…",
  again: "Écrivez encore, Pilot ajuste sa réponse…",
  tell: "Autre chose à dire à Pilot ?",
  change: "Demandez un changement…",
  reply: "Répondez autrement…",
};

const PROJECT = "Jiroo";
const STAGES: [Stage, string][] = [["prepare", "Préparer"], ["develop", "Développer"], ["test", "Tester"], ["validate", "Valider"]];
const STEPS = ["Demande", "Questions", "Spec", "Plan", "Développement"];
const ASKERS: Record<Request["from"], string> = { lead: "du Lead", dev: "du dev", reviewer: "du relecteur" };
const CLEAR = "#00000000";

function stageName(stage: Stage): string {
  return STAGES.find(([key]) => key === stage)?.[1] ?? stage;
}

async function call<A extends Action>(action: A, payload: Payloads[A]): Promise<Reply<A>> {
  try {
    const { engine } = props() as { engine: string };
    const { stdout } = await exec("sh", [engine, action, JSON.stringify(payload)]);
    return JSON.parse(stdout) as Reply<A>;
  } catch {
    return { error: { code: "failed", message: "Mission Control n’a pas pu lire la réponse de son moteur." } };
  }
}

export default class MissionControl extends View {
  page: Page = "issues";
  issues: IssueSummary[] | null = null;
  issuesError = "";
  missions: Mission[] | null = null;
  missionsError = "";
  refreshes = 0;
  lists = 0;
  /** The readings of the list on their way: the clock starts none while one is. */
  listing = 0;
  opens = 0;
  requested = "";
  issue: IssueDetail | null = null;
  /** Why the issue could not be read. */
  issueError = "";
  /** Why the operator's last gesture failed; shown in the composer. */
  requestError = "";
  /** The issues whose request is being validated. */
  creating = new Set<string>();
  /** The open mission as the engine knows it: Pilot's questions and the answers. */
  detail: MissionDetail | null = null;
  /** The step the operator chose to look at; none: the one the preparation has reached. */
  tab: Tab | "" = "";
  /** Orders the engine's answers about a mission's stage; see `staged`. */
  clock = 0;
  stamps = new Map<string, number>();
  /** The ticket of the plan the operator is looking at; none: the estimate. */
  ticket = "";
  /** How many times the operator chose a step: a gesture's answer never undoes a choice made meanwhile. */
  choices = 0;
  /** The question the operator chose to look at; none: the first one still open. */
  viewing = "";
  /** What the operator adds to the issue before validating the request. */
  details: string[] = [];
  inputs: Partial<Record<Field, InputState>> = {};
  /** Why the mission could not be read. */
  detailError = "";
  /** The missions with a gesture on its way to the engine, and which gesture. */
  sending = new Map<string, Action>();
  sends = 0;
  /** The opening whose mission is being read: one reading at a time, so a slow one is never overtaken. */
  reading = 0;

  init(_props: unknown, cx: Spawner & Pick<Context, "timer">) {
    if (checking()) return;
    for (const field of Object.keys(FIELDS) as Field[]) {
      const input = InputState.new({ placeholder: FIELDS[field] });
      input.on("change", (_event, cx) => cx.notify()); // the button changes role with the field
      this.inputs[field] = input;
    }
    // Pilot answers in its own time, and the missions move on by themselves: the window reads both again
    // at each tick, so whatever the order of the engine's answers, what is shown is at most one tick late.
    cx.timer.every(3000, (cx) => {
      if (this.page === "request" && this.detail?.development) cx.notify(); // the time spent goes on
      this.follow(cx);
      if (!this.listing) this.relist(cx);
    });
    this.refresh(cx);
  }

  refresh(cx: Spawner) {
    const turn = ++this.refreshes; // a later refresh has the last word
    this.relist(cx);
    cx.spawn(async (cx) => {
      const reply = await call("issues.list", {});
      if (turn !== this.refreshes) return;
      this.issuesError = "error" in reply ? reply.error.message : "";
      if ("data" in reply) this.issues = reply.data;
      cx.notify();
    });
  }

  /** Reads the missions again. They are local: they never wait for Linear. */
  relist(cx: Spawner) {
    const turn = ++this.lists; // a later reading has the last word
    const asked = ++this.clock;
    this.listing++;
    cx.spawn(async (cx) => {
      const reply = await call("missions.list", {});
      this.listing--;
      if (turn !== this.lists) return;
      this.missionsError = "error" in reply ? reply.error.message : "";
      // A mission whose stage was given by a later answer keeps it: this list was read before.
      if ("data" in reply) {
        this.missions = reply.data.map((mission) => {
          const known = this.mission(mission.issueKey);
          if (known && asked < (this.stamps.get(mission.issueKey) ?? 0)) return { ...mission, stage: known.stage };
          this.stamps.set(mission.issueKey, asked);
          return mission;
        });
      }
      cx.notify();
    });
  }

  mission(key: string): Mission | undefined {
    return this.missions?.find((mission) => mission.issueKey === key);
  }

  show(page: "issues" | "development", cx: Context) {
    this.page = page;
    this.refresh(cx);
    cx.notify();
  }

  open(key: string, cx: Context) {
    const turn = ++this.opens;
    this.page = "request";
    this.requested = key;
    this.issue = null;
    this.issueError = "";
    this.requestError = "";
    this.detail = null;
    this.detailError = "";
    this.tab = "";
    this.viewing = "";
    this.ticket = "";
    this.details = [];
    for (const input of Object.values(this.inputs)) input.set_value("");
    cx.notify();
    this.follow(cx);
    cx.spawn(async (cx) => {
      const reply = await call("issues.show", { key });
      if (turn !== this.opens) return; // the operator opened a page again meanwhile
      if ("data" in reply) this.issue = reply.data;
      else this.issueError = reply.error.message;
      cx.notify();
    });
  }

  /** Reads the open mission again. A reply that crossed an action of the operator is dropped. */
  follow(cx: Spawner) {
    const key = this.requested;
    if (this.page !== "request" || !this.mission(key) || this.sending.has(key)) return;
    const turn = this.opens;
    const sends = this.sends;
    if (this.reading === turn) return;
    this.reading = turn;
    const asked = ++this.clock;
    cx.spawn(async (cx) => {
      const reply = await call("missions.show", { issueKey: key });
      if (this.reading === turn) this.reading = 0;
      if (turn !== this.opens || sends !== this.sends) return;
      const error = "error" in reply ? reply.error.message : "";
      const moved = "data" in reply && this.staged(reply.data, asked);
      if (!moved && error === this.detailError && ("error" in reply || JSON.stringify(reply.data) === JSON.stringify(this.detail))) return;
      this.detailError = error;
      if ("data" in reply) {
        // What is written answers the request on screen: it never lands on the next one.
        const asked = (detail: MissionDetail | null) => detail?.development?.requests.find((request) => request.answer === undefined)?.id;
        if (asked(reply.data) !== asked(this.detail)) this.inputs.reply?.set_value("");
        this.detail = reply.data;
      }
      cx.notify();
    });
  }

  /**
   * The menu and the header follow the stage the engine last gave for a mission. Answers arrive in any order:
   * a reading counts from the moment it was asked, a gesture from the moment it is answered, and the later one wins.
   */
  staged(mission: Mission, stamp: number): boolean {
    if (stamp < (this.stamps.get(mission.issueKey) ?? 0)) return false;
    this.stamps.set(mission.issueKey, stamp);
    const moved = this.mission(mission.issueKey)?.stage !== mission.stage;
    this.missions = (this.missions ?? []).map((known) => (known.issueKey === mission.issueKey ? { ...known, stage: mission.stage } : known));
    return moved; // the menu must be drawn again
  }

  /** A gesture about the page on screen is on its way: its button and its field wait for the engine. */
  busy(): boolean {
    return this.sending.has(this.requested) || this.creating.has(this.requested);
  }

  /** What is written belongs to the question on screen: it never follows the operator to another one. */
  clear() {
    for (const field of ["answer", "again", "tell", "change", "reply"] as const) this.inputs[field]?.set_value("");
  }

  /** One gesture of the operator towards Pilot; the button is off until the engine answers. */
  send<A extends "questions.validate" | "questions.reply" | "pilot.tell" | "spec.write" | "spec.change" | "spec.validate" | "plan.team" | "plan.launch" | "develop.start" | "requests.answer">(action: A, payload: Payloads[A], cx: Context, field?: Field) {
    const key = payload.issueKey;
    if (this.sending.has(key)) return;
    const turn = this.opens;
    const choices = this.choices;
    const viewing = this.viewing;
    this.clear(); // what was written is on its way; it comes back to its field if the engine refuses it
    this.sending.set(key, action);
    this.sends++;
    this.requestError = "";
    cx.notify();
    cx.spawn(async (cx) => {
      const reply = await call(action, payload);
      this.sending.delete(key);
      if ("data" in reply) {
        this.staged(reply.data as MissionDetail, ++this.clock); // also when the operator opened another page meanwhile
        // A reading asked while the gesture was on its way may have seen more or less than its answer: read once more.
        this.relist(cx);
      }
      if (this.page === "request" && this.requested === key) { // its mission is on screen, even opened again meanwhile
        if ("data" in reply) {
          this.detail = reply.data as MissionDetail;
          // A reply stays on its question, to see Pilot's new proposal; a validation moves on.
          this.viewing = action === "questions.reply" ? (payload as Payloads["questions.reply"]).questionId : "";
          // On to the step the preparation has reached, unless the operator chose another one meanwhile.
          if ((action === "spec.write" || action === "spec.validate" || action === "plan.launch") && this.choices === choices) this.tab = "";
        } else {
          this.requestError = reply.error.message;
          // A mission opened again while its gesture was on its way has not been read yet: read it now.
          if (!this.detail) this.follow(cx);
          // A refused text comes back to its field only if the operator is still on its step.
          // It never lands on a page opened again, nor on another question.
          if (field && "text" in payload && turn === this.opens && this.choices === choices && this.viewing === viewing) this.inputs[field]?.set_value(payload.text);
        }
      }
      cx.notify();
    });
  }

  validate(cx: Context) {
    const issue = this.issue;
    if (!issue || this.creating.has(issue.key)) return;
    const turn = this.opens;
    this.creating.add(issue.key);
    this.requestError = "";
    cx.notify();
    cx.spawn(async (cx) => {
      const reply = await call("missions.create", { issueKey: issue.key, details: this.details });
      this.creating.delete(issue.key);
      if ("data" in reply) {
        this.missions = [...(this.missions ?? []).filter((mission) => mission.issueKey !== issue.key), reply.data];
        this.stamps.set(issue.key, ++this.clock);
      }
      else if (turn === this.opens) this.requestError = reply.error.message;
      this.refresh(cx);
      this.follow(cx);
      cx.notify();
    });
  }

  // ---- frame: left menu, pinned PILOT tab, page header ---------------------
  sidebar(): NativeElement {
    const item = (page: "issues" | "development", label: string) => {
      const on = this.page === page || (page === "development" && this.page === "request");
      return h_flex().id(`nav-${page}`).h(34).items_center().px(10).rounded(8).border_1()
        .border_color(on ? "#3A4180" : CLEAR).bg(on ? "#1F2440" : CLEAR).text_color(on ? "#ffffff" : "#C9CFDB")
        .cursor_pointer().on_click((_event, cx) => this.show(page, cx)).child(label);
    };
    const missions = this.missions ?? [];
    const count = missions.length;
    return v_flex().w(248).flex_none().h_full().bg("#151821").border_r_1().border_color("#232838").px(14).py(18).gap(4)
      .text_size(14).text_color("#C9CFDB")
      .child(div().mx(6).mb(14).text_size(15).font_bold().text_color("#ffffff").child("Mission Control"))
      .child(item("issues", "☰  Issues"))
      .child(item("development", "‹/›  Development"))
      .child(div().mt(16).mx(10).mb(6).text_size(11.5).text_color("#6F7689").child("PROJETS"))
      .child(h_flex().items_center().gap(10).px(10).py(6)
        .child(div().w(22).h(22).rounded(6).border_1().border_color("#8E7CFF").bg("#261F4A"))
        .child(v_flex().child(PROJECT).child(div().text_size(11.5).text_color("#6F7689")
          .child(count === 0 ? "Aucune mission en cours" : count === 1 ? "1 mission" : `${count} missions`))))
      .children(missions.map((mission) => h_flex().justify_between().pl(42).pr(10).py(4).text_size(13).text_color("#A3AABB")
        .child(mission.issueKey).child(stageName(mission.stage))));
  }

  // Drawn and inert: Pilot is reached from the page of its mission.
  pilotTab(): NativeElement {
    return h_flex().h(44).flex_none().bg("#0F1218").border_b_1().border_color("#2A2F40")
      .child(h_flex().items_center().gap(8).px(18).border_r_1().border_color("#2A2F40").text_size(12.5).text_color("#C9CFDB").opacity(0.55)
        .child(div().w(7).h(7).rounded_full().bg("#3DD6B0"))
        .child(div().font_family("JetBrains Mono").child("PILOT"))
        .child(div().text_size(11.5).text_color("#8C93A6").child("⌂ épinglé")));
  }

  header(title: string, sub: NativeElement): NativeElement {
    return h_flex().h(52).flex_none().items_center().gap(14)
      .child(h_flex().w(44).h(44).flex_none().rounded(10).border_1().border_color("#5563D8").bg("#1C2040").items_center().justify_center().text_color("#C9D0FF").child("⚑"))
      .child(v_flex().flex_1().min_w_0()
        .child(div().text_size(22).font_semibold().truncate().child(title))
        .child(sub.mt(3).text_size(13).text_color("#8C93A6")));
  }

  card(): NativeElement {
    return v_flex().flex_1().min_h_0().rounded(12).border_1().border_color("#2A2F40").bg("#1B1F2B");
  }

  row(id: string, key: string, title: string, right: string): NativeElement {
    return h_flex().id(id).w_full().items_center().gap(12).px(12).py(13).rounded(9).border_1().border_color(CLEAR)
      .hover((style) => style.border_color("#3A4052").bg("#161923")).cursor_pointer()
      .on_click((_event, cx) => this.open(key, cx))
      .child(h_flex().flex_none().h(22).px(8).items_center().rounded(6).bg("#262B3A").text_size(12).text_color("#8C93A6").child(key))
      .child(div().flex_1().min_w_0().truncate().text_size(15).font_medium().text_color("#E6E9F0").child(title))
      .child(div().flex_none().text_size(12.5).text_color("#8C93A6").child(right));
  }

  note(text: string, color: `#${string}` = "#8C93A6"): NativeElement {
    return div().px(12).py(13).text_size(15).text_color(color).child(text);
  }

  list(id: string, title: string, rows: NativeElement[] | undefined, error: string, empty: string, action?: NativeElement): NativeElement {
    const body = error ? [this.note(error, "#F2C14E")]
      : !rows ? [this.note("Chargement…")]
      : rows.length === 0 ? [this.note(empty)] : rows;
    return this.card().px(24).py(22)
      .child(h_flex().h(40).flex_none().items_center().justify_between().mb(24)
        .child(div().text_size(21).font_semibold().text_color("#ffffff").child(title))
        .when(action, (el) => el.child(action!)))
      .child(v_flex().id(id).flex_1().min_h_0().overflow_y_scrollbar().gap(4).children(body));
  }

  // ---- issues (mockup 01) and missions ------------------------------------
  issuesPage(): NativeElement[] {
    // Drawn and inert: a new main ticket is a write to the tracker that decision 0005 does not allow yet.
    const newTicket = h_flex().h(40).px(20).items_center().rounded(10).bg("#6B6CF5").text_size(14.5).font_semibold().text_color("#ffffff").opacity(0.4).child("Nouveau ticket");
    return [
      this.header(PROJECT, h_flex().child(`${this.issues?.length ?? 0} issues · ${this.missions?.length ?? 0} missions en cours`)),
      this.list("issues", "Issues", this.issues?.map((issue) => this.row(`issue-${issue.key}`, issue.key, issue.title, issue.status)),
        this.issuesError, "Aucune issue ouverte", newTicket),
    ];
  }

  developmentPage(): NativeElement[] {
    return [
      this.header(PROJECT, h_flex().child(`${this.missions?.length ?? 0} missions en cours`)),
      this.list("missions", "Development", this.missions?.map((mission) =>
        this.row(`mission-${mission.issueKey}`, mission.issueKey, mission.title, stageName(mission.stage))), this.missionsError, "Aucune mission"),
    ];
  }

  // ---- the page of a mission: its frame ------------------------------------
  stages(key: string, current: Stage): NativeElement {
    const parts: NativeElement[] = [div().child(`${PROJECT} · ${key}`)];
    STAGES.forEach(([stage, label], index) => {
      if (index > 0) parts.push(div().text_color("#5C6378").child("›"));
      const on = stage === current;
      parts.push(h_flex().items_center().gap(5)
        .child(div().w(7).h(7).rounded_full().bg(on ? "#7B8CFF" : "#5C6378"))
        .child(on ? div().font_semibold().text_color("#ffffff").child(label) : div().child(label)));
    });
    return h_flex().items_center().gap(10).children(parts);
  }

  /** The step the mission has reached: 0 the request, 1 the questions, 2 the spec, 3 the plan, 4 the development. */
  reached(created: boolean): number {
    const detail = this.detail;
    return !created ? 0 : detail?.plan?.launched ? 4 : detail?.plan || detail?.spec?.validated ? 3 : detail?.spec || detail?.pilotBusy === "spec" ? 2 : 1;
  }

  /** The four steps of the preparation. A step that was reached opens its page. */
  steps(created: boolean): NativeElement {
    const current = this.reached(created);
    const shown = created && this.tab ? TABS.indexOf(this.tab) : current;
    const questions = this.detail?.questions ?? [];
    const answers = questions.filter((question) => question.answer !== undefined).length;
    const spec = this.detail?.spec;
    const plan = this.detail?.plan;
    const smalls = [
      created ? "validée" : "",
      !questions.length ? "" : current > 1 ? (answers === 1 ? "1 réponse" : `${answers} réponses`) : `${answers} sur ${questions.length}`,
      !spec ? "" : spec.validated ? `validée · v${spec.version}` : "à relire",
      current < 3 ? "" : !plan?.tickets.length ? "en cours" : plan.tickets.length === 1 ? "1 ticket" : `${plan.tickets.length} tickets`,
      "",
    ];
    const parts: NativeElement[] = [];
    STEPS.slice(0, plan?.launched ? 5 : 4).forEach((name, index) => {
      if (index > 0) parts.push(div().text_size(13).text_color("#4A5066").child("›"));
      const on = index === shown;
      const done = !on && index < current || (index === 3 && plan?.launched === true);
      const small = smalls[index];
      const pill = h_flex().id(`step-${index}`).h(30).items_center().gap(8).pl(5).pr(13).rounded(15).border_1()
        .border_color(on ? "#4A52A8" : "#2A2F40").bg(on ? "#1C2040" : CLEAR).text_size(13.5).text_color(on ? "#ffffff" : done ? "#C9CFDB" : "#8C93A6")
        .child(h_flex().w(20).h(20).rounded_full().items_center().justify_center().text_size(11).font_semibold()
          .bg(done ? "#163028" : on ? "#7B8CFF" : "#262B3A").text_color(done ? "#5DE3B8" : on ? "#12151D" : "#C9CFDB").child(done ? "✓" : String(index + 1)))
        .child(name)
        .when(small, (el) => el.child(div().text_size(12.5).text_color(on ? "#A9B4FF" : "#6F7689").child(small!)));
      parts.push(created && index <= current ? pill.cursor_pointer().on_click((_event, cx) => {
        if (index === shown) return;
        this.tab = TABS[index]!;
        this.choices++;
        this.clear(); // a draft belongs to its step
        cx.notify();
      }) : pill);
    });
    return h_flex().h(30).flex_none().items_center().gap(8).children(parts);
  }

  // One block, one button (mockup README, "Le composeur"): the button validates
  // while the field is empty and sends what is written once it is not.
  /** `field` is null for a composer that only says where things stand. */
  composer(field: Field | null, hint: string, label: string, validate: ((cx: Context) => void) | null,
    sendHint = "", send: ((text: string, cx: Context) => void) | null = null): NativeElement {
    const input = field ? this.inputs[field] : undefined;
    const text = send ? input?.value().trim() ?? "" : "";
    const role = this.busy() ? "off" : text ? "send" : validate ? "validate" : "off";
    const button = h_flex().id("validate").flex_none().h(40).px(18).items_center().rounded(10).border_1().text_size(14.5).font_semibold()
      .border_color(role === "off" ? "#2A2F40" : role === "send" ? "#6B6CF5" : "#2FA37A")
      .bg(role === "off" ? "#262B3A" : role === "send" ? "#6B6CF5" : "#1F7A5C").text_color(role === "off" ? "#8C93A6" : "#ffffff")
      .when(role !== "off", (el) => el.cursor_pointer().on_click((_event, cx) => (role === "send" ? send!(text, cx) : validate!(cx))))
      .child(role === "send" ? "Envoyer à Pilot  ↑" : label);
    return div().flex_none().px(36).pt(18).pb(22).border_t_1().border_color("#2A2F40")
      .child(v_flex().rounded(14).border_1().border_color(text ? "#4A52A8" : "#3A4052").bg("#0F1219").overflow_hidden()
        .child(div().min_h(66).px(18).pt(16).pb(18).text_size(15).text_color("#E6E9F0")
          // No field while a gesture is on its way: nothing can be written that the answer would erase.
          .child(input && send && !this.busy() ? Input.new(input) : div().text_color("#6F7689").child(field ? FIELDS[field] : "")))
        .child(h_flex().items_center().gap(12).pl(18).pr(10).py(10).border_t_1().border_color("#2A2F40").bg("#1B1F2B")
          .child(div().flex_1().min_w_0().truncate().text_size(13.5).text_color(this.requestError ? "#F2C14E" : "#8C93A6")
            .child(this.requestError || (text ? sendHint : hint)))
          .child(button)));
  }

  /** The main card: what the step shows, then the composer. */
  conversation(id: string, content: NativeElement[], composer: NativeElement): NativeElement {
    return this.card().h_full().min_w_0() // long passages never push the right column out of the window
      .child(v_flex().id(id).flex_1().min_h_0().overflow_y_scrollbar().px(36).pt(30).pb(22).child(v_flex().max_w(880).children(content)))
      .child(composer);
  }

  heading(label: string, title: string, lead = ""): NativeElement[] {
    return [
      div().text_size(12).font_semibold().text_color("#A9B4FF").child(label),
      div().mt(6).text_size(26).font_semibold().text_color("#ffffff").child(title),
      ...(lead ? [div().mt(10).text_size(15.5).text_color("#C9CFDB").child(lead)] : []),
    ];
  }

  /** The right column, 440 px wide on every step. */
  column(title: string, id: string, children: NativeElement[]): NativeElement {
    return v_flex().w(440).flex_none().h_full().min_h_0().rounded(12).border_1().border_color("#3A4052").bg("#1D2130")
      .child(h_flex().h(52).flex_none().items_center().px(18).border_b_1().border_color("#2A2F40")
        .child(div().text_size(12).font_semibold().text_color("#A3AABB").child(title)))
      .child(v_flex().id(id).flex_1().min_h_0().overflow_y_scrollbar().px(10).pt(16).pb(18).children(children));
  }

  label(text: string): NativeElement {
    return div().mt(20).mb(8).px(10).text_size(11.5).font_semibold().text_color("#8C93A6").child(text);
  }

  line(badge: string, text: string, small = "", tone: Tone = "todo", on = false): NativeElement {
    const [bg, fg] = tone === "done" ? ["#163028", "#5DE3B8"] as const : tone === "fixed" ? ["#3A2E12", "#F2C14E"] as const : ["#262B3A", "#C9CFDB"] as const;
    return h_flex().items_start().gap(11).px(10).py(7).rounded(9).border_1().border_color(on ? "#4A52A8" : CLEAR).bg(on ? "#1C2040" : CLEAR)
      .text_size(14).text_color("#E6E9F0")
      .when(badge, (el) => el.child(h_flex().flex_none().min_w(22).h(22).px(4).rounded(6).bg(bg).items_center().justify_center().text_size(11).font_bold().text_color(fg).child(badge)))
      .child(v_flex().flex_1().min_w_0().child(text).when(small, (el) => el.child(div().mt(2).text_size(13).text_color("#8C93A6").child(small))));
  }

  // ---- the request (mockup 02) ---------------------------------------------
  bubble(text: string, label = "VOUS"): NativeElement {
    return h_flex().mt(14).justify_end().child(v_flex().max_w(686).px(14).py(10).rounded(12).border_1().border_color("#4A52A8").bg("#262B5E")
      .text_size(14.5).text_color("#E6E9F0")
      .child(div().mb(3).text_size(11.5).font_semibold().text_color("#A9B4FF").child(label)).child(text));
  }

  requestBody(issue: IssueDetail, created: boolean): NativeElement {
    const chip = (text: string) => h_flex().h(26).px(9).items_center().rounded(6).border_1().border_color("#363C50").text_size(12.5).text_color("#C9CFDB").child(text);
    const details = this.detail?.details ?? this.details;
    const composer = created
      ? this.composer("request", "Pilot a votre demande · la suite est à l’étape Questions", "Demande validée", null)
      : this.composer("request", "ou validez la demande · Pilot prépare ensuite ses questions", "✓  Valider la demande", (cx) => this.validate(cx),
        "la précision s’ajoute à votre demande · vous validez ensuite", (text, cx) => {
          this.details = [...this.details, text];
          this.inputs.request?.set_value("");
          cx.notify();
        });
    return h_flex().flex_1().min_h_0().gap(14).items_stretch()
      .child(this.conversation("request", [
        div().text_size(12).font_semibold().text_color("#A9B4FF").child(`${issue.key} · LA DEMANDE`),
        div().mt(6).text_size(26).font_semibold().text_color("#ffffff").child(issue.title),
        h_flex().mt(12).gap(6).child(chip(issue.status)).child(chip(PROJECT)),
        div().mt(12).text_size(15.5).text_color("#D6DAE6").child(TextView.markdown("description", issue.description)),
        ...details.map((detail) => this.bubble(detail)),
      ], composer))
      .child(this.column("LA DEMANDE EN BREF", "brief", [
        div().px(10).text_size(20).font_semibold().text_color("#ffffff").child(issue.key),
        div().px(10).mt(6).text_size(13.5).text_color("#8C93A6").child("L’issue telle qu’elle est dans le tracker."),
        this.label("RANGEMENT"),
        this.line("P", `Projet · ${PROJECT}`),
        ...(details.length ? [this.label("VOS PRÉCISIONS"), ...details.map((detail, index) => this.line(String(index + 1), detail))] : []),
        this.label("ENSUITE"),
        this.line("2", "Les questions de Pilot", "une par page, avec une réponse proposée"),
        this.line("3", "La spec", "écrite par Pilot, relue par vous"),
        this.line("4", "Le plan", "les tickets, l’équipe, l’estimation"),
      ]));
  }

  // ---- Pilot's questions (mockups 08 to 13, 23, 24) -------------------------
  proposal(label: string, text: string, kind: "current" | "first" | "kept"): NativeElement {
    const first = kind === "first";
    return v_flex().mt(20).px(first ? 16 : 18).py(first ? 14 : 16).rounded(12).border_1().border_color(kind === "kept" ? "#2E6B56" : "#2A2F40").bg("#161923")
      .child(div().mb(4).text_size(12).font_semibold().text_color(first ? "#8C93A6" : "#5DE3B8").child(label))
      .child(first ? div().text_size(15).text_color("#A3AABB").child(text) : div().text_size(17).font_semibold().text_color("#ffffff").child(text));
  }

  waiting(text: string, small = ""): NativeElement {
    return h_flex().items_center().gap(14).mt(20).px(16).py(14).rounded(12).border_1().border_color("#3A4AB8").bg("#151A38")
      .child(div().flex_none().w(20).text_size(16).text_color("#A9B4FF").frames(["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"], 90))
      .child(v_flex().child(div().text_size(15.5).font_semibold().text_color("#ffffff").child(text))
        .when(small, (el) => el.child(div().mt(2).text_size(13.5).text_color("#A9B1D6").child(small))));
  }

  tone(question: Question): Tone {
    return question.answer === undefined ? "todo" : question.replies.length ? "fixed" : "done";
  }

  badge(question: Question, index: number): string {
    return question.answer === undefined ? String(index + 1) : question.replies.length ? "✎" : "✓";
  }

  questionsBody(detail: MissionDetail): NativeElement {
    const key = detail.issueKey;
    const questions = detail.questions;
    const total = questions.length;
    const done = questions.filter((question) => question.answer !== undefined).length;
    const current = questions.find((question) => question.id === this.viewing) ?? questions.find((question) => question.answer === undefined);
    const tell = (text: string, cx: Context) => this.send("pilot.tell", { issueKey: key, text }, cx, "tell");
    const write = (cx: Context) => this.send("spec.write", { issueKey: key }, cx);
    const side = (counter: string, lead: string, rows: NativeElement[]) => this.column("LES QUESTIONS DE PILOT", "questions-list", [
      div().px(10).text_size(20).font_semibold().text_color("#ffffff").child(counter),
      div().px(10).mt(6).mb(8).text_size(13.5).text_color("#8C93A6").child(lead),
      ...rows,
    ]);
    const rows = [
      ...questions.map((question, index) => this.line(this.badge(question, index), question.text, question.answer ?? "", this.tone(question), question === current)
        .id(`question-${question.id}`).cursor_pointer().on_click((_event, cx) => {
          if (this.busy()) return; // the gesture on its way belongs to the question on screen
          this.viewing = question.id;
          this.clear();
          cx.notify();
        })),
      this.label("À SAVOIR"),
      this.line("", "Pilot peut ajouter une question selon vos réponses."),
    ];
    const page = (content: NativeElement[], composer: NativeElement, column: NativeElement) =>
      h_flex().flex_1().min_h_0().gap(14).items_stretch().child(this.conversation("questions", content, composer)).child(column);

    const busy = detail.pilotBusy === "questions";
    // Once the spec is asked, the answers it is written from no longer change here: a change goes through the spec.
    const settled = Boolean(detail.spec) || detail.pilotBusy === "spec";
    const closed = detail.spec?.validated === true;
    // A change is on its way as soon as the operator sent it, before the engine has recorded it.
    const revising = detail.spec !== undefined && !closed && (detail.spec.requests.length >= detail.spec.version || this.sending.get(key) === "spec.change");
    const validating = this.sending.get(key) === "spec.validate";
    const settledLabel = !detail.spec ? "Pilot écrit la spec…" : revising ? "Pilot met la spec à jour…" : "Spec écrite";
    const settledHint = closed ? "la spec validée est écrite d’après vos réponses"
      : validating ? "la spec est en cours de validation"
      : revising ? "Pilot prépare la prochaine version de la spec"
      : detail.spec ? "la spec est écrite d’après vos réponses · un changement se demande à l’étape Spec" : "Pilot écrit la spec d’après vos réponses";
    if (total === 0 && !busy) {
      // Pilot answered that the request is enough.
      return page(this.heading("LES QUESTIONS", "Pilot n’a pas de question", "Votre demande lui suffit pour écrire la spec."),
        settled ? this.composer(null, closed ? "la spec est validée" : validating ? "la spec est en cours de validation" : revising ? "Pilot prépare la prochaine version de la spec"
          : detail.spec ? "la spec est écrite d’après votre demande · un changement se demande à l’étape Spec" : "Pilot écrit la spec d’après votre demande", settledLabel, null)
          : this.composer("tell", "votre demande suffit · Pilot écrit ensuite la spec", "✓  Écrire la spec", write, "Pilot en tient compte pour la spec", tell),
        side("Aucune question", "Pilot a lu la demande et le projet.", []));
    }
    if (total === 0) {
      return page([
        ...this.heading("LES QUESTIONS", "Pilot prépare ses questions", "Il vous les posera une par une, avec une réponse proposée à chaque fois."),
        this.waiting("Pilot lit votre demande et le projet"),
      ], this.composer("tell", "vous pouvez quitter cette page, Pilot continue", "Pilot prépare ses questions…", null, "Pilot en tient compte dans ses questions", tell),
      side("En préparation", "Pilot lit la demande et le projet.", [this.line("…", "Première question", "en préparation"), this.line("…", "Les suivantes")]));
    }
    if (!current) {
      return page([
        ...this.heading("LES QUESTIONS", total === 1 ? "La question a une réponse" : `Les ${total} questions ont une réponse`,
          "Relisez-les si vous voulez : un clic sur une question, à droite, la rouvre."),
        v_flex().mt(18).children(questions.map((question, index) => this.line(this.badge(question, index), question.text, question.answer, this.tone(question)))),
        busy ? this.waiting("Pilot vérifie s’il lui reste une question")
          : settled ? div()
          : this.said(`${total === 1 ? "J’ai votre réponse" : `J’ai vos ${total} réponses`}. Je peux écrire la spec : une page, à relire avant le découpage.`),
      ], settled ? this.composer(null, settledHint, settledLabel, null)
        : this.composer("tell", "vos réponses sont validées · Pilot écrit ensuite la spec", "✓  Écrire la spec", busy ? null : write, "Pilot en tient compte pour la spec", tell),
      side(`${total} réponses sur ${total}`, "Une question par page. Un clic pour revenir sur une réponse.", rows));
    }

    const next = questions.find((question) => question !== current && question.answer === undefined);
    const after = next ? `question ${questions.indexOf(next) + 1} ensuite` : "c’était la dernière question";
    const revised = current.replies.length > 0;
    const pending = current.answer === undefined && current.proposals.length <= current.replies.length;
    const last = current.proposals[current.proposals.length - 1] ?? "";
    const content = this.heading(`QUESTION ${questions.indexOf(current) + 1} SUR ${total}`, current.text, current.context);
    if (current.answer !== undefined) {
      content.push(this.proposal(revised ? "VOTRE RÉPONSE · VALIDÉE, APRÈS VOTRE CORRECTION" : "VOTRE RÉPONSE · VALIDÉE", current.answer, "kept"));
    } else if (revised) {
      content.push(this.proposal("PREMIÈRE RÉPONSE PROPOSÉE PAR PILOT", current.proposals[0] ?? "", "first"), ...current.replies.map((reply) => this.bubble(reply)),
        pending ? this.waiting("Pilot met sa réponse à jour") : this.proposal("PILOT · SUGGESTION MISE À JOUR", last, "current"));
    } else content.push(this.proposal("PILOT · RÉPONSE PROPOSÉE", last, "current"));

    const reply = (text: string, cx: Context) => this.send("questions.reply", { issueKey: key, questionId: current.id, text }, cx, current.answer === undefined && revised ? "again" : "answer");
    const validate = (cx: Context) => this.send("questions.validate", { issueKey: key, questionId: current.id }, cx);
    const sendHint = "Pilot met sa réponse à jour · vous validez ensuite";
    const composer = settled ? this.composer(null, settledHint, "Réponse validée", null)
      : current.answer !== undefined
      ? this.composer("answer", `ou gardez votre réponse · ${next ? "retour aux questions" : "retour au récapitulatif"}`, "✓  Garder cette réponse", (cx) => {
        this.viewing = "";
        this.clear();
        cx.notify();
      }, sendHint, reply)
      : pending ? this.composer("again", "Pilot reformule votre réponse", "Pilot met sa réponse à jour…", null)
      : revised ? this.composer("again", `ou validez la suggestion mise à jour · ${after}`, "✓  Valider la suggestion mise à jour", validate, sendHint, reply)
      : this.composer("answer", `ou validez la réponse de Pilot · ${after}`, "✓  Valider cette réponse", validate, sendHint, reply);
    return page(content, composer, side(`${done} sur ${total}`, "Une question par page. Un clic pour revenir sur une réponse.", rows));
  }

  // ---- the spec (mockups 14 to 16, 25) --------------------------------------
  said(text: string): NativeElement {
    return v_flex().mt(22).px(18).py(16).rounded(12).border_1().border_color("#2A2F40").bg("#161923")
      .child(div().mb(4).text_size(12).font_semibold().text_color("#5DE3B8").child("PILOT"))
      .child(div().text_size(15.5).font_medium().text_color("#E6E9F0").child(text));
  }

  specBody(detail: MissionDetail): NativeElement {
    const key = detail.issueKey;
    const spec = detail.spec;
    const questions = detail.questions;
    const count = questions.length === 1 ? "1 réponse" : `${questions.length} réponses`;
    const tell = (text: string, cx: Context) => this.send("pilot.tell", { issueKey: key, text }, cx, "tell");
    const versions = !spec ? [] : [this.label("VERSIONS"), ...Array.from({ length: spec.version }, (_unused, index) => {
      const version = spec.version - index; // the one to read comes first
      const last = version === spec.version;
      const changed = spec.sections.reduce((sum, section) => sum + section.passages.filter((passage) => passage.changed).length, 0);
      return this.line(String(version), last && version > 1 && !spec.validated ? `Version ${version} · à relire` : `Version ${version}`,
        version === 1 ? `écrite d’après vos ${count}` : last ? (changed === 1 ? "1 passage modifié à votre demande" : `${changed} passages modifiés à votre demande`) : "",
        last && version > 1 ? "fixed" : "todo");
    })];
    const column = this.column("VOS RÉPONSES", "spec-answers", [
      div().px(10).text_size(20).font_semibold().text_color("#ffffff").child(questions.length ? `${count}, 1 page` : "Aucune question"),
      div().px(10).mt(6).mb(8).text_size(13.5).text_color("#8C93A6").child("La spec est écrite d’après elles. À droite de chaque passage : d’où il vient."),
      ...questions.map((question, index) => this.line(this.badge(question, index), question.text, question.answer ?? "", this.tone(question))),
      ...versions,
    ]);
    const page = (content: NativeElement[], composer: NativeElement) =>
      h_flex().flex_1().min_h_0().gap(14).items_stretch().child(this.conversation("spec", content, composer)).child(column);
    if (!spec) {
      return page([...this.heading("LA SPEC", "Pilot écrit la spec", "Une page, à relire avant le découpage en tickets."), this.waiting("Pilot écrit la spec d’après vos réponses")],
        this.composer("tell", "vous pouvez quitter cette page, Pilot continue", "Pilot écrit la spec…", null, "Pilot en tient compte pour la spec", tell));
    }

    // A change request waits for its version: version 1 answers none, version 2 the first, and so on.
    const pending = !spec.validated && spec.requests.length >= spec.version;
    const document = v_flex().mt(4).opacity(pending ? 0.45 : 1).children(spec.sections.flatMap((section) => [
      div().mt(22).mb(6).text_size(11.5).font_semibold().text_color("#8C93A6").child(section.title.toUpperCase()),
      ...section.passages.map((passage, index) => h_flex().items_start().gap(11).px(10).py(7).rounded(9).border_1()
        .border_color(passage.changed ? "#8A6B1F" : CLEAR).bg(passage.changed ? "#241F12" : CLEAR).text_size(15).text_color("#E6E9F0")
        .when(section.passages.length > 1, (el) => el.child(h_flex().flex_none().min_w(22).h(22).mt(1).rounded(6).bg("#262B3A").items_center().justify_center()
          .text_size(11).font_bold().text_color("#C9CFDB").child(String(index + 1))))
        .child(div().flex_1().min_w_0().child(passage.text))
        .when(passage.changed === true, (el) => el.child(h_flex().flex_none().h(19).px(8).rounded(11).bg("#3A2E12").items_center()
          .text_size(11.5).font_semibold().text_color("#F2C14E").child(`modifié · v${spec.version}`)))
        .child(div().flex_none().mt(3).text_size(12).text_color("#6F7689").child(passage.source))),
    ]));
    const content = [
      div().text_size(12).font_semibold().text_color("#A9B4FF").child(`LA SPEC, ÉCRITE PAR PILOT · VERSION ${spec.version}`),
      div().mt(6).text_size(26).font_semibold().text_color("#ffffff").child(detail.title),
      ...(pending ? [this.bubble(spec.requests[spec.requests.length - 1] ?? "", "VOTRE DEMANDE DE CHANGEMENT"),
        this.waiting("Pilot met la spec à jour", "Il vérifie ce que ça change ailleurs, puis réécrit ce qui doit l’être")] : [this.said(spec.note)]),
      document,
    ];
    const composer = spec.validated ? this.composer(null, "la spec est dans le projet · la suite est à l’étape Plan", "Spec validée", null)
      : pending ? this.composer("change", "Pilot réécrit ce qui change, le reste ne bouge pas.", "Pilot met la spec à jour…", null)
      : this.composer("change", "ou validez la spec · Pilot découpe ensuite en tickets", "✓  Valider la spec", (cx) => this.send("spec.validate", { issueKey: key }, cx),
        "Pilot met la spec à jour · vous validez ensuite", (text, cx) => this.send("spec.change", { issueKey: key, text }, cx, "change"));
    return page(content, composer);
  }

  // ---- the plan (mockups 17 to 21, 26) ---------------------------------------
  devBadge(dev: number, tool: Tool): NativeElement {
    const claude = tool === "claude";
    return h_flex().flex_none().min_w(26).h(20).px(5).rounded(10).border_1().border_color(claude ? "#C9A27B" : "#7B8CFF").items_center().justify_center()
      .text_size(11).font_bold().text_color(claude ? "#F0D6B8" : "#C9D0FF").child(`D${dev}`);
  }

  ticketCard(ticket: PlanTicket, plan: Plan, compact: boolean): NativeElement {
    const launched = plan.launched === true; // a launched plan shows what happened, not a ticket's detail
    const on = !launched && this.ticket === ticket.id;
    const section = (label: string, lines: NativeElement[]) => v_flex().mt(8).pt(10).gap(3).border_t_1().border_color("#2A2F40").text_size(12.5).text_color("#A3AABB")
      .when(label, (el) => el.child(div().mb(1).text_size(10.5).font_semibold().text_color("#6F7689").child(label))).children(lines);
    const card = v_flex().id(`ticket-${ticket.id}`).flex_none().w(compact ? 207 : 241).px(compact ? 13 : 15).py(compact ? 12 : 14).rounded(10).border_1()
      .border_color(on ? "#E6E9ED" : ticket.sensitive ? "#6E5BD6" : "#2A2F40").bg(ticket.sensitive ? "#221D3A" : "#1B1F2B")
      .when(!launched, (el) => el.cursor_pointer().on_click((_event, cx) => {
        this.ticket = on ? "" : ticket.id;
        cx.notify();
      }));
    const top = h_flex().flex_none().min_h(20).items_center().gap(6).text_size(11).text_color("#8C93A6")
      .child(div().font_family("JetBrains Mono").child(ticket.key ? `${ticket.id} · ${ticket.key}` : ticket.id))
      .child(div().flex_1())
      .when(ticket.after.length > 0, (el) => el.child(div().text_color("#6F7689").child(`après ${ticket.after.join(", ")}`)))
      .when(compact, (el) => el.child(this.devBadge(ticket.parallel.dev, plan.team[ticket.parallel.dev - 1] ?? "claude")));
    const content = [
      div().text_size(compact ? 14.5 : 15.5).font_semibold().text_color("#ffffff").child(ticket.title),
      div().text_size(compact ? 13 : 13.5).text_color(compact ? "#A3AABB" : "#C9CFDB").child(ticket.change),
      ...(compact ? [] : [section("COMMENT", [div().child(ticket.how)])]),
      section(compact ? "" : "COUVRE, DANS LA SPEC", ticket.covers.map((line) => h_flex().items_start().gap(6)
        .child(div().flex_none().text_size(10).text_color("#3DD6B0").child("✓")).child(div().flex_1().min_w_0().child(line)))),
    ];
    const foot = h_flex().flex_none().mt(8).min_h(20).items_center().gap(6)
      .when(ticket.sensitive, (el) => el.child(h_flex().h(19).px(6).rounded(5).border_1().border_color("#6E5BD6").bg("#3A2F6B").items_center()
        .text_size(11).font_semibold().text_color("#E3DAFF").child("Sensible")))
      .child(div().text_size(12.5).text_color("#C9CFDB").child(`~${duration(ticket.minutes)}`));
    // One dev: the card takes the height of the board, its text scrolls, its foot stays in view.
    // Two devs: a short card in its dev's line, as tall as its text.
    return compact ? card.gap(6).child(top).children(content).child(foot)
      : card.h_full().gap(6).child(top)
        .child(v_flex().id(`ticket-text-${ticket.id}`).flex_1().min_h_0().overflow_y_scrollbar().gap(6).children(content))
        .child(foot);
  }

  /** Test and validation close the plan: drawn like tickets, with a dashed border. */
  closingCard(sign: string, title: string, text: string, time: string, compact: boolean): NativeElement {
    const card = v_flex().flex_none().w(compact ? 207 : 241).gap(6).px(compact ? 13 : 15).py(compact ? 12 : 14).rounded(10).border_1().border_dashed().border_color("#3A4052").bg("#1B1F2B")
      .child(div().text_size(11).text_color("#A9B4FF").child(sign))
      .child(div().text_size(compact ? 14.5 : 15.5).font_semibold().text_color("#ffffff").child(title))
      .child(div().text_size(13).text_color("#A3AABB").child(text));
    const foot = div().mt(8).text_size(12.5).text_color("#C9CFDB").child(time);
    return compact ? card.child(foot) : card.h_full().child(div().flex_1()).child(foot); // as tall as the tickets beside it
  }

  planBody(detail: MissionDetail): NativeElement {
    const key = detail.issueKey;
    const plan = detail.plan;
    const tickets = plan?.tickets ?? [];
    const body = (left: NativeElement[], right: NativeElement) => h_flex().flex_1().min_h_0().gap(14).items_stretch()
      .child(v_flex().flex_1().min_w_0().h_full().gap(14).children(left)).child(right);

    if (!plan || tickets.length === 0) {
      // Pilot is splitting: the tickets show as it finds them (mockup 17).
      const found = plan?.found ?? [];
      const count = found.length === 0 ? "" : found.length === 1 ? " · 1 ticket trouvé" : ` · ${found.length} tickets trouvés`;
      const card = (label: string, title: string, text: string, foot: string, ghost = false) => {
        const el = v_flex().flex_1().min_w_0().gap(8).p(14).rounded(10).border_1().border_color("#2A2F40").bg(ghost ? CLEAR : "#1B1F2B")
          .child(div().font_family("JetBrains Mono").text_size(11).text_color("#8C93A6").child(label))
          .when(title, (el) => el.child(div().text_size(15).font_semibold().text_color("#ffffff").child(title)))
          .when(text, (el) => el.child(div().text_size(13).text_color("#A3AABB").child(text)))
          .child(div().mt(8).text_size(12.5).text_color("#C9CFDB").child(foot));
        return ghost ? el.border_dashed() : el;
      };
      return h_flex().flex_1().min_h_0().gap(14).items_stretch()
        .child(this.conversation("plan", [
          ...this.heading("LE PLAN", "Pilot découpe la spec en tickets", "Rien à valider pour l’instant : le plan s’affiche dès qu’il est complet."),
          this.waiting(`Pilot découpe${count}`),
          h_flex().mt(16).gap(12).items_stretch().children([
            ...found.map((ticket) => card(`TICKET ${ticket.id}`, ticket.title, ticket.change, "trouvé · pas encore estimé")),
            card(`TICKET ${found.length + 1}`, "", "", "Pilot cherche encore", true),
          ]),
        ], this.composer("tell", "vous pouvez quitter cette page, Pilot continue", "Pilot prépare le plan…", null, "Pilot en tient compte pour le plan",
          (text, cx) => this.send("pilot.tell", { issueKey: key, text }, cx, "tell"))))
        .child(this.column("EN CE MOMENT", "plan-now", [
          div().px(10).text_size(20).font_semibold().text_color("#ffffff").child("Pilot découpe la spec"),
          div().px(10).mt(6).mb(8).text_size(13.5).text_color("#8C93A6").child("Vous pouvez quitter cette page."),
          this.label("CE QU’IL FAIT"),
          this.line("✓", "Lit la spec validée", detail.spec ? `version ${detail.spec.version}` : "", "done"),
          this.line("●", "Découpe en tickets", found.length ? `${found.length === 1 ? "1 ticket trouvé" : `${found.length} tickets trouvés`}, il continue` : ""),
          this.line("○", "Range les tickets et les estime"),
          this.line("○", "Vérifie que chaque point de la spec est couvert"),
        ]));
    }

    const devs = plan.team.length;
    const closing = plan.testMinutes + plan.validationMinutes;
    const total = (count: number) => development(tickets, count) + closing;
    const team = (count: number) => (count === 1 ? "1 dev" : "2 devs en parallèle");
    const launched = plan.launched === true;
    const launching = !launched && this.sending.get(key) === "plan.launch";
    const setTeam = (next: Tool[], cx: Context) => this.send("plan.team", { issueKey: key, team: next }, cx);
    const other = (tool: Tool): Tool => (tool === "claude" ? "codex" : "claude");
    const frozen = launched || launching;
    // One gesture at a time: the team waits while a choice or the launch is on its way, so no choice is lost.
    const held = frozen || this.busy();

    const banner = h_flex().h(76).flex_none().items_center().gap(16).px(22).rounded(12).border_1()
      .border_color(frozen ? "#3A4AB8" : "#2E8F6C").bg(frozen ? "#151A38" : "#132823")
      .child(h_flex().flex_none().w(38).h(38).rounded_full().items_center().justify_center().bg(frozen ? "#1F2756" : "#1C3A31")
        .text_color(frozen ? "#A9B4FF" : "#5DE3B8").font_bold().child(launching ? "…" : "✓"))
      .child(v_flex().flex_1().min_w_0()
        .child(div().text_size(20).font_semibold().text_color("#ffffff").child(
          launching ? "Création des tickets dans le tracker…"
            : launched ? `C’est parti : ${tickets.length === 1 ? "1 ticket créé" : `${tickets.length} tickets créés`} dans le tracker`
            : tickets.length === 1 ? "Le plan est prêt : 1 ticket, pas de découpage nécessaire" : `Le plan est prêt : ${tickets.length} tickets`))
        .child(div().mt(4).text_size(14).text_color(this.requestError && !frozen ? "#F2C14E" : frozen ? "#A9B1D6" : "#A9C9BE").truncate().child(
          this.requestError && !frozen ? this.requestError
            : launching ? "Le plan est figé · rien d’autre à faire"
            : launched ? "Le plan est figé · la suite se passe dans Développement"
            : `Environ ${duration(total(devs))} avec ${team(devs)}, test et validation compris`
              + (tickets.length > 1 ? ` · ${duration(total(devs === 1 ? 2 : 1))} avec ${team(devs === 1 ? 2 : 1)}` : ""))))
      .when(!frozen, (el) => {
        // While a team choice is on its way the launch waits: an approval must never be lost, nor bear on another team.
        const waiting = this.busy();
        const button = h_flex().id("launch").flex_none().h(46).px(22).items_center().rounded(10).border_1().border_color(waiting ? "#2A2F40" : "#2E8F6C")
          .bg(waiting ? "#1B1F2B" : "#163028").text_size(15).font_semibold().text_color(waiting ? "#8C93A6" : "#5DE3B8")
          .child(devs === 1 ? "Approuver et lancer le dev" : "Approuver et lancer les devs");
        return el.child(waiting ? button : button.cursor_pointer().hover((style) => style.bg("#1C3A31"))
          .on_click((_event, cx) => this.send("plan.launch", { issueKey: key }, cx)));
      });

    const chip = (dev: number, tool: Tool) => {
      const el = h_flex().id(`dev-${dev}`).h(30).pl(5).pr(10).gap(7).items_center().rounded(9).border_1().border_color("#2A2F40").bg("#161923").text_size(13)
        .child(this.devBadge(dev, tool)).child(TOOLS[tool]);
      return held ? el : el.cursor_pointer().hover((style) => style.border_color("#7B8CFF"))
        .on_click((_event, cx) => setTeam(plan.team.map((current, index) => (index === dev - 1 ? other(current) : current)), cx));
    };
    const teamRow = h_flex().h(32).flex_none().items_center().gap(8)
      .child(div().mr(4).text_size(17).font_semibold().child("Plan"))
      .children(plan.team.map((tool, index) => chip(index + 1, tool)))
      .when(!held && devs === 2, (el) => el.child(h_flex().id("remove-dev").w(26).h(30).items_center().justify_center().rounded(8).border_1().border_color("#2A2F40")
        .text_size(11).text_color("#6F7689").cursor_pointer().on_click((_event, cx) => setTeam(plan.team.slice(0, 1), cx)).child("✕")))
      .when(!held && devs === 1 && tickets.length > 1, (el) => el.child(h_flex().id("add-dev").h(30).px(12).items_center().rounded(9).border_1().border_dashed()
        .border_color("#4A5066").text_size(13).text_color("#A9B4FF").cursor_pointer()
        .on_click((_event, cx) => setTeam([plan.team[0] ?? "claude", other(plan.team[0] ?? "claude")], cx)).child("+ Ajouter un dev")))
      .when(devs === 1 && tickets.length === 1, (el) => el.child(div().text_size(13).text_color("#8C93A6").child("Un seul ticket : un dev suffit")))
      .child(div().flex_1())
      .child(h_flex().id("estimate").h(30).px(11).gap(7).items_center().rounded(9).border_1().border_color(this.ticket || launched ? "#2A2F40" : "#7B8CFF").bg("#161923")
        .text_size(13).text_color("#C9CFDB").when(!launched, (el) => el.cursor_pointer().on_click((_event, cx) => {
          this.ticket = "";
          cx.notify();
        }))
        .child(div().font_family("JetBrains Mono").text_size(14).font_medium().text_color("#ffffff").child(`≈ ${duration(total(devs))}`)).child("›"));

    const closings = (compact: boolean) => [
      this.closingCard("▶", "Test", "Un agent joue chaque parcours de la spec.", `~${duration(plan.testMinutes)}`, compact),
      this.closingCard("✓", "Validation", "Vous vérifiez ce que la mission a livré.", `~${duration(plan.validationMinutes)} de votre temps`, compact),
    ];
    const band = (text: string, width: number) => div().flex_none().w(width).pb(4).border_b_2().border_color("#2F3547").text_size(11.5).font_semibold().text_color("#A3AABB").child(text);
    const steps = stepsOf(tickets);
    const lane = (dev: 1 | 2) => {
      const mine = tickets.filter((ticket) => ticket.parallel.dev === dev);
      return h_flex().items_stretch().gap(12)
        .child(v_flex().flex_none().w(118).gap(3).pt(12).text_size(13.5).font_semibold().child(`Dev ${dev}`)
          .child(div().text_size(12).font_normal().text_color("#8C93A6").child(TOOLS[plan.team[dev - 1] ?? "claude"]))
          .child(div().text_size(12).font_normal().text_color("#8C93A6").child(`${mine.length === 1 ? "1 ticket" : `${mine.length} tickets`} · ${duration(mine.reduce((sum, ticket) => sum + ticket.minutes, 0))}`)))
        .children(steps.map((step) => v_flex().flex_none().w(207).gap(12).children(step.filter((ticket) => ticket.parallel.dev === dev).map((ticket) => this.ticketCard(ticket, plan, true)))));
    };
    const board = devs === 1
      ? h_flex().id("plan-board").flex_1().min_h_0().overflow_x_scrollbar().items_stretch().gap(12)
        .children([...tickets.map((ticket) => this.ticketCard(ticket, plan, false)), ...closings(false)])
      : v_flex().id("plan-board").flex_1().min_h_0().overflow_scrollbar().gap(12)
        .child(h_flex().gap(12).child(div().flex_none().w(118)).children(steps.map((_step, index) => band(`ÉTAPE ${index + 1}`, 207))).child(band("TESTER ET VALIDER", 207)))
        .child(h_flex().items_start().gap(12)
          .child(v_flex().gap(12).child(lane(1)).child(lane(2)))
          .child(v_flex().flex_none().w(207).gap(12).children(closings(true))));

    const chosen = tickets.find((ticket) => ticket.id === this.ticket);
    const text = (value: string) => div().px(10).py(4).text_size(14).text_color("#E6E9F0").child(value);
    const right = launched ? this.column("LANCEMENT", "plan-side", [
      div().px(10).text_size(20).font_semibold().text_color("#ffffff").child("C’est parti"),
      div().px(10).mt(6).mb(8).text_size(13.5).text_color("#8C93A6").child("Le plan est figé. L’équipe et le dev de chaque ticket ne changent plus sans une nouvelle approbation."),
      this.label("CE QUI VIENT DE SE PASSER"),
      this.line("✓", "Plan approuvé et figé", "", "done"),
      this.line("✓", `${tickets.length === 1 ? "1 ticket créé" : `${tickets.length} tickets créés`} dans le tracker`,
        `${tickets.map((ticket) => ticket.key ?? "").filter(Boolean).join(", ")} · ${tickets.length === 1 ? "rattaché" : "rattachés"} à ${key}`, "done"),
      detail.development ? this.line("✓", "Le Lead a pris la mission", "", "done") : this.line("○", "Le Lead prend la mission"),
    ]) : chosen ? this.column(`TICKET ${tickets.indexOf(chosen) + 1} SUR ${tickets.length}`, "plan-side", [
      div().px(10).text_size(20).font_semibold().text_color("#ffffff").child(chosen.title),
      div().px(10).mt(6).text_size(13.5).text_color("#8C93A6").child(`~${duration(chosen.minutes)}${chosen.sensitive ? " · sensible : relu deux fois" : ""}`),
      this.label("CE QUE ÇA CHANGE"), text(chosen.change),
      this.label("COMMENT"), text(chosen.how),
      this.label("COUVRE, DANS LA SPEC"), ...chosen.covers.map((line) => this.line("✓", line, "", "done")),
      ...(chosen.after.length ? [this.label("ATTEND"), ...chosen.after.map((id) => this.line("→", `Le ticket ${id}`, tickets.find((ticket) => ticket.id === id)?.title ?? ""))] : []),
      this.label("FAIT PAR"),
      this.line(`D${devs === 1 ? 1 : chosen.parallel.dev}`, `Dev ${devs === 1 ? 1 : chosen.parallel.dev} · ${TOOLS[plan.team[devs === 1 ? 0 : chosen.parallel.dev - 1] ?? "claude"]}`),
    ]) : this.column("ESTIMATION", "plan-side", [
      h_flex().px(10).items_end().gap(12)
        .child(div().font_family("JetBrains Mono").text_size(34).font_medium().text_color("#ffffff").child(`≈ ${duration(total(devs))}`))
        .child(div().pb(6).text_size(13.5).text_color("#8C93A6").child(`avec ${team(devs)} · test et validation compris`)),
      this.label("DÉTAIL"),
      this.line("D", `Développement · ${duration(development(tickets, devs))}`,
        devs === 1 ? (tickets.length === 1 ? "1 ticket" : `${tickets.length} tickets, l’un après l’autre`) : `${steps.length === 1 ? "1 étape" : `${steps.length} étapes`}, un ticket par dev en même temps`),
      this.line("▶", `Test · ${duration(plan.testMinutes)}`, "automatique"),
      this.line("✓", `Validation · ${duration(plan.validationMinutes)}`, "de votre temps"),
      ...(tickets.length > 1 ? [
        this.label("UN 2ᵉ DEV FERAIT-IL GAGNER DU TEMPS ?"),
        this.line(devs === 1 ? "✓" : " ", `1 dev · ${duration(total(1))}`, TOOLS[plan.team[0] ?? "claude"], devs === 1 ? "done" : "todo")
          .when(devs !== 1 && !held, (el) => el.id("team-1").cursor_pointer().on_click((_event, cx) => setTeam(plan.team.slice(0, 1), cx))),
        this.line(devs === 2 ? "✓" : " ", `2 devs · ${duration(total(2))}`, "les tickets d’une même étape se font en même temps", devs === 2 ? "done" : "todo")
          .when(devs !== 2 && !held, (el) => el.id("team-2").cursor_pointer().on_click((_event, cx) => setTeam([plan.team[0] ?? "claude", other(plan.team[0] ?? "claude")], cx))),
      ] : []),
      ...(plan.advice ? [this.label("CONSEIL"), text(plan.advice)] : []),
    ]);

    return v_flex().flex_1().min_h_0().gap(14).child(banner)
      .child(body([v_flex().flex_1().min_h_0().gap(16).px(24).pt(20).pb(18).rounded(12).border_1().border_color("#2A2F40").bg("#1B1F2B").child(teamRow).child(board)], right));
  }

  // ---- the development (mockup develop, states 1dev-01 to 1dev-17) -----------
  developBody(detail: MissionDetail): NativeElement {
    const key = detail.issueKey;
    const plan = detail.plan!;
    const tickets = plan.tickets;
    const work = detail.development;
    const requests = work?.requests ?? [];
    const runOf = (ticket: PlanTicket) => work?.tickets.find((run) => run.id === ticket.id);
    const name = (ticket: PlanTicket) => ticket.key ?? `ticket ${ticket.id}`;
    const devOf = (ticket: PlanTicket) => (plan.team.length === 1 ? 1 : ticket.parallel.dev);
    const toolOf = (ticket: PlanTicket) => plan.team[devOf(ticket) - 1] ?? "claude";
    const held = new Map(tickets.map((ticket) => [ticket.id, holding(ticket.id, runOf(ticket), requests)]));
    const accepted = tickets.filter((ticket) => held.get(ticket.id) === "accepted").length;
    const count = `${accepted} sur ${tickets.length} ${accepted > 1 ? "acceptés" : "accepté"}`;
    const open = requests.find((request) => request.answer === undefined);
    const about = (request: Request) => tickets.find((ticket) => ticket.id === request.ticketId);
    const active = tickets.find((ticket) => ["building", "review", "fixing"].includes(held.get(ticket.id)!));
    const time = (work?.tickets ?? []).reduce((sum, run) => sum + run.steps.reduce((total, step) => total + spent(step), 0), 0);
    const clock = `${duration(time)} sur ≈ ${duration(development(tickets, plan.team.length) + plan.testMinutes + plan.validationMinutes)}`;
    const starting = this.sending.get(key) === "develop.start";
    const doing: Record<Holding, string> = { todo: "à faire", building: "en construction", review: "en relecture", fixing: "en correction", waiting: "vous attend", accepted: "accepté" };
    const spinner = () => div().text_size(16).frames(["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"], 90);

    // One message at a time, the first that applies (mockup README, "Le bandeau").
    const [tone, sign, title, sub, action]: ["blue" | "amber" | "green", NativeElement | string, string, string, [string, string, (cx: Context) => void] | null] =
      !work ? ["blue", starting ? spinner() : "▶", starting ? "Le Lead démarre…" : "Le développement n’a pas démarré", "Le plan est approuvé · le Lead lit la spec, le plan et vos réponses, puis lance le dev",
        starting || this.busy() ? null : ["start-develop", "Lancer le développement", (cx) => this.send("develop.start", { issueKey: key }, cx)]]
      : open ? ["amber", "◆", `À vous : une demande ${ASKERS[open.from]}${about(open) ? ` sur ${name(about(open)!)}` : ""}`,
        `${about(open) ? `${name(about(open)!)} attend votre réponse · ` : ""}${count}`,
        this.ticket ? ["see-request", "Répondre", (cx) => { this.ticket = ""; cx.notify(); }] : null]
      : accepted === tickets.length ? ["green", "✓", tickets.length === 1 ? "Le ticket est accepté" : `Les ${tickets.length} tickets sont acceptés`,
        "Fusionné dans la branche de la mission · le test arrive avec une prochaine étape", null]
      : active ? ["blue", spinner(), `En cours : ${name(active)} ${doing[held.get(active.id)!]}`, `${count} · ${clock}`, null]
      : accepted === 0 ? ["blue", spinner(), "Le Lead prend la mission", "Il lit la spec, le plan et vos réponses, puis lance le premier ticket", null]
      : ["blue", "✓", count[0]!.toUpperCase() + count.slice(1), "Les tickets suivants se lancent avec une prochaine étape", null];
    const [edge, back, disc, ink, soft] = tone === "blue" ? ["#3A4AB8", "#151A38", "#1F2756", "#A9B4FF", "#A9B1D6"] as const
      : tone === "amber" ? ["#8F6B1E", "#2A220F", "#3A2E12", "#F2C14E", "#D9C9A3"] as const : ["#2E8F6C", "#132823", "#1C3A31", "#5DE3B8", "#A9C9BE"] as const;
    const banner = h_flex().h(76).flex_none().items_center().gap(16).px(22).rounded(12).border_1().border_color(edge).bg(back)
      .child(h_flex().flex_none().w(38).h(38).rounded_full().items_center().justify_center().bg(disc).text_color(ink).font_bold().child(sign))
      .child(v_flex().flex_1().min_w_0()
        .child(div().text_size(20).font_semibold().text_color("#ffffff").truncate().child(title))
        .child(div().mt(4).text_size(14).text_color(this.requestError ? "#F2C14E" : soft).truncate().child(this.requestError || sub)))
      .when(action, (el) => el.child(h_flex().id(action![0]).flex_none().h(46).px(22).items_center().rounded(10).border_1().border_color(edge).bg(disc)
        .text_size(15).font_semibold().text_color(ink).cursor_pointer().on_click((_event, cx) => action![2](cx)).child(action![1])));

    const pick = (id: string, cx: Context) => {
      this.ticket = this.ticket === id ? "" : id;
      cx.notify();
    };
    const row = h_flex().h(32).flex_none().items_center().gap(8)
      .child(div().mr(4).text_size(17).font_semibold().child("Plan"))
      .children(plan.team.map((tool, index) => {
        const mine = tickets.find((ticket) => devOf(ticket) === index + 1 && !["todo", "accepted"].includes(held.get(ticket.id)!));
        return h_flex().h(30).pl(5).pr(10).gap(7).items_center().rounded(9).border_1().border_color("#2A2F40").bg("#161923").text_size(13)
          .child(this.devBadge(index + 1, tool)).child(TOOLS[tool])
          .when(mine, (el) => el.child(div().text_color("#8C93A6").child(`${name(mine!)} ${doing[held.get(mine!.id)!]}`)));
      }))
      .child(div().flex_1())
      .child(h_flex().id("develop-now").h(30).px(11).items_center().rounded(9).border_1().border_color(this.ticket ? "#2A2F40" : "#7B8CFF").bg("#161923")
        .font_family("JetBrains Mono").text_size(13).text_color("#ffffff").cursor_pointer().on_click((_event, cx) => pick(this.ticket, cx)).child(clock));

    const stepLine = (ticket: PlanTicket, step: TicketStep, steps: TicketStep[]) => {
      const round = steps.slice(0, steps.indexOf(step) + 1).filter((other) => other.kind === "fix").length;
      const tool = TOOLS[step.tool];
      const running = !step.endedAt;
      const text = step.kind === "build" ? (running ? `${tool} construit` : `Dev · D${devOf(ticket)}`)
        : step.kind === "fix" ? (running ? `${tool} corrige · tour ${round}` : `Corrections · tour ${round}`)
        : running ? `${tool} relit` : step.accepted ? `Relecture · ${tool}` : "Relecture · corrections demandées";
      const [mark, color] = running ? ["●", "#7B8CFF"] as const : step.kind === "review" && !step.accepted ? ["✗", "#F2C14E"] as const : ["✓", "#3DD6B0"] as const;
      return h_flex().items_center().gap(7).text_size(12.5).text_color(running ? "#ffffff" : "#C9CFDB")
        .child(div().flex_none().w(12).text_size(10).text_color(color).child(mark)).child(div().flex_1().min_w_0().truncate().child(text))
        .child(div().flex_none().text_color("#8C93A6").child(duration(spent(step))));
    };
    const card = (ticket: PlanTicket) => {
      const state = held.get(ticket.id)!;
      const run = runOf(ticket);
      const last = run?.steps.at(-1);
      const on = this.ticket === ticket.id;
      const [border, fill]: [`#${string}`, `#${string}`] = state === "waiting" ? ["#8F6B1E", "#2A220F"] : state === "accepted" ? ["#1F5A47", "#14211E"]
        : state === "todo" ? [ticket.sensitive ? "#6E5BD6" : "#2A2F40", ticket.sensitive ? "#221D3A" : "#1B1F2B"] : ["#3A4AB8", "#151A38"];
      const holder: [string, `#${string}`, `#${string}`] = state === "waiting" ? ["Vous", "#F2C14E", "#3A2E12"] : state === "review" ? ["R", "#A9B4FF", "#1F2756"]
        : state === "building" || state === "fixing" ? [`D${devOf(ticket)}`, "#A9B4FF", "#1F2756"] : ["●", state === "accepted" ? "#3DD6B0" : "#6F7689", CLEAR];
      const section = (label: string, lines: NativeElement[]) => v_flex().mt(8).pt(10).gap(4).border_t_1().border_color("#2A2F40")
        .child(div().mb(1).text_size(10.5).font_semibold().text_color("#6F7689").child(label)).children(lines);
      return v_flex().id(`ticket-${ticket.id}`).flex_none().w(241).h_full().gap(6).px(15).py(14).rounded(10).border_1().border_color(on ? "#E6E9ED" : border).bg(fill)
        .cursor_pointer().on_click((_event, cx) => pick(ticket.id, cx))
        .child(h_flex().flex_none().min_h(20).items_center().gap(6).text_size(11).text_color("#8C93A6")
          .child(div().font_family("JetBrains Mono").child(ticket.key ? `${ticket.id} · ${ticket.key}` : ticket.id)).child(div().flex_1())
          .when(plan.team.length > 1, (el) => el.child(this.devBadge(devOf(ticket), toolOf(ticket)))))
        .child(div().text_size(15.5).font_semibold().text_color("#ffffff").child(ticket.title))
        .child(h_flex().flex_none().items_center().gap(7).text_size(13).font_semibold().text_color(holder[1])
          .child(h_flex().flex_none().min_w(20).h(18).px(5).rounded(9).bg(holder[2]).items_center().justify_center().text_size(10.5).child(holder[0]))
          .child(div().flex_1().child(state === "fixing" ? `En correction · tour ${run!.steps.filter((step) => step.kind === "review").length}` : doing[state].replace(/^./, (first) => first.toUpperCase())))
          .when(last && state !== "todo", (el) => el.child(div().font_normal().text_color("#8C93A6").child(duration(state === "accepted" ? run!.steps.reduce((sum, step) => sum + spent(step), 0) : spent(last!))))))
        .child(v_flex().id(`ticket-text-${ticket.id}`).flex_1().min_h_0().overflow_y_scrollbar().gap(6)
          .when(run, (el) => el.child(section("ÉTAPES", [
            ...run!.steps.map((step) => stepLine(ticket, step, run!.steps)),
            ...(state === "building" || state === "fixing" ? [h_flex().gap(7).text_size(12.5).text_color("#6F7689").child(div().w(12).text_size(10).child("○")).child("Relecture")] : []),
          ])))
          .child(div().mt(run ? 6 : 0).text_size(13.5).text_color("#C9CFDB").child(ticket.change))
          .child(section("COUVRE, DANS LA SPEC", ticket.covers.map((line) => h_flex().items_start().gap(6).text_size(12.5).text_color("#A3AABB")
            .child(div().flex_none().text_size(10).text_color("#3DD6B0").child("✓")).child(div().flex_1().min_w_0().child(line))))))
        .child(h_flex().flex_none().mt(8).min_h(20).items_center().gap(6)
          .when(ticket.sensitive, (el) => el.child(h_flex().h(19).px(6).rounded(5).border_1().border_color("#6E5BD6").bg("#3A2F6B").items_center()
            .text_size(11).font_semibold().text_color("#E3DAFF").child("Sensible")))
          .child(div().text_size(12.5).text_color("#C9CFDB").child(`~${duration(ticket.minutes)}`)));
    };
    const board = h_flex().id("develop-board").flex_1().min_h_0().overflow_x_scrollbar().items_stretch().gap(12).children([
      ...tickets.map(card),
      this.closingCard("▶", "Test", "Un agent joue chaque parcours de la spec.", `~${duration(plan.testMinutes)}`, false),
      this.closingCard("✓", "Validation", "Vous vérifiez ce que la mission a livré.", `~${duration(plan.validationMinutes)} de votre temps`, false),
    ]);

    const text = (value: string) => div().px(10).py(4).text_size(14).text_color("#E6E9F0").child(value);
    const chosen = tickets.find((ticket) => ticket.id === this.ticket);
    const sent = this.sending.get(key) === "requests.answer";
    const answer = (request: Request, said: string, cx: Context) => this.send("requests.answer", { issueKey: key, requestId: request.id, text: said }, cx, "reply");
    const reply = this.inputs.reply;
    const written = reply?.value().trim() ?? "";
    const side = chosen ? (() => {
      const run = runOf(chosen);
      const reviewer: Tool = toolOf(chosen) === "claude" ? "codex" : "claude";
      return this.column(`TICKET ${tickets.indexOf(chosen) + 1} SUR ${tickets.length}`, "develop-side", [
        div().px(10).text_size(20).font_semibold().text_color("#ffffff").child(chosen.title),
        div().px(10).mt(6).text_size(13.5).text_color("#8C93A6").child(`${doing[held.get(chosen.id)!]} · ~${duration(chosen.minutes)}`),
        this.label("CE QUE ÇA CHANGE"), text(chosen.change),
        this.label("COMMENT"), text(chosen.how),
        this.label("FAIT PAR"),
        this.line(`D${devOf(chosen)}`, `Dev ${devOf(chosen)} · ${TOOLS[toolOf(chosen)]}`),
        this.line("R", `Relecteur · ${TOOLS[reviewer]}`, "une session neuve à chaque relecture"),
        ...(run ? [
          this.label("DÉROULÉ"),
          ...run.steps.flatMap((step) => [
            this.line(!step.endedAt ? "●" : step.kind === "review" && !step.accepted ? "✗" : "✓",
              `${hour(step.startedAt)} · ${step.kind === "review" ? "Relecture" : step.kind === "fix" ? "Corrections" : "Construction"} · ${TOOLS[step.tool]} · ${duration(spent(step))}`,
              [step.summary, step.commit ? `commit ${step.commit.slice(0, 7)}` : ""].filter(Boolean).join(" · "),
              !step.endedAt ? "todo" : step.kind === "review" && !step.accepted ? "fixed" : "done"),
            ...(step.remarks ?? []).map((remark) => div().pl(43).pr(10).py(3).text_size(13).text_color("#D9C9A3").child(`– ${remark}`)),
          ]),
          this.label("CODE"),
          this.line("⑂", run.branch, run.pr ? `PR #${run.pr.number} vers mission/${key}` : "pas encore poussée"),
        ] : []),
      ]);
    })() : open ? this.column(`DEMANDE ${ASKERS[open.from].toUpperCase()} · À VOUS DE RÉPONDRE`, "develop-side", [
      div().px(10).text_size(20).font_semibold().text_color("#ffffff").child(open.text),
      div().px(10).mt(8).mb(10).text_size(14).text_color("#C9CFDB").child(open.context),
      ...open.choices.map((choice, index) => h_flex().mx(10).mb(10).p(14).gap(12).items_center().rounded(10).border_1()
        .border_color(index === 0 ? "#2E8F6C" : "#2A2F40").bg(index === 0 ? "#132823" : "#161923")
        .child(v_flex().flex_1().min_w_0().gap(4).child(div().text_size(14.5).font_semibold().text_color("#ffffff").child(choice))
          .when(index === 0, (el) => el.child(div().text_size(11.5).font_semibold().text_color("#5DE3B8").child("Recommandé"))))
        .child(h_flex().id(`choice-${index}`).flex_none().h(34).px(13).items_center().rounded(8).border_1().border_color(index === 0 ? "#2E8F6C" : "#3A4052")
          .text_size(13.5).font_semibold().text_color(this.busy() ? "#6F7689" : index === 0 ? "#5DE3B8" : "#E6E9F0")
          .when(!this.busy(), (el) => el.cursor_pointer().on_click((_event, cx) => answer(open, choice, cx))).child("Choisir"))),
      h_flex().mx(10).gap(10).items_center().pl(14).pr(8).py(8).rounded(10).border_1().border_color(written ? "#4A52A8" : "#3A4052").bg("#0F1219")
        .child(div().flex_1().min_w_0().text_size(14).child(reply && !this.busy() ? Input.new(reply) : div().text_color("#6F7689").child(sent ? "Envoi de votre réponse…" : FIELDS.reply)))
        .child(h_flex().id("send-reply").flex_none().h(34).px(13).items_center().rounded(8).bg(written && !this.busy() ? "#6B6CF5" : "#262B3A")
          .text_size(13.5).font_semibold().text_color(written && !this.busy() ? "#ffffff" : "#8C93A6")
          .when(written !== "" && !this.busy(), (el) => el.cursor_pointer().on_click((_event, cx) => answer(open, written, cx))).child("Envoyer  ↑")),
      ...(about(open) ? [this.label("TICKET CONCERNÉ"), this.line("#", name(about(open)!), about(open)!.title)] : []),
      div().px(10).mt(16).text_size(13).text_color("#8C93A6").child("Votre réponse arrive une seule fois dans le terminal de l’agent."),
    ]) : (() => {
      const events = (work?.tickets ?? []).flatMap((run) => {
        const ticket = tickets.find((candidate) => candidate.id === run.id);
        const label = ticket ? name(ticket) : `ticket ${run.id}`;
        return run.steps.flatMap((step) => [
          { at: step.startedAt, text: step.kind === "build" ? `Le dev a commencé ${label}` : step.kind === "fix" ? `Le dev corrige ${label}` : `Relecture de ${label} commencée` },
          ...(step.kind === "review" && step.endedAt ? [{ at: step.endedAt, text: step.accepted ? `${label} accepté et fusionné`
            : `${step.remarks?.length === 1 ? "1 correction demandée" : `${step.remarks?.length ?? 0} corrections demandées`} sur ${label}` }] : []),
        ]);
      }).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);
      const reviewing = tickets.find((ticket) => held.get(ticket.id) === "review");
      const answered = requests.filter((request) => request.answer !== undefined);
      return this.column("EN CE MOMENT", "develop-side", [
        div().px(10).font_family("JetBrains Mono").text_size(26).font_medium().text_color("#ffffff").child(clock),
        div().px(10).mt(4).text_size(13.5).text_color("#8C93A6").child(`temps passé sur temps estimé · ${count}`),
        this.label("QUI TRAVAILLE"),
        ...(work ? [this.line("L", "Lead · Claude", accepted === tickets.length ? "tous les tickets sont acceptés" : "coordonne la mission"),
          // The window cannot tell whether the Lead's terminal is still there: starting it again changes nothing when it is.
          ...(accepted < tickets.length && !this.busy() ? [div().id("restart-lead").pl(43).pb(4).text_size(13).text_color("#A9B4FF").cursor_pointer()
            .on_click((_event, cx) => this.send("develop.start", { issueKey: key }, cx)).child("Son terminal a disparu ? Relancer le Lead")] : []),
        ] : [this.line("L", "Lead", "pas encore démarré")]),
        ...plan.team.map((tool, index) => {
          const mine = tickets.find((ticket) => devOf(ticket) === index + 1 && !["todo", "accepted"].includes(held.get(ticket.id)!));
          return this.line(`D${index + 1}`, `Dev ${index + 1} · ${TOOLS[tool]}`, mine ? `${name(mine)} ${doing[held.get(mine.id)!]}` : "attend son prochain ticket");
        }),
        ...(reviewing ? [this.line("R", `Relecteur · ${TOOLS[runOf(reviewing)!.steps.at(-1)!.tool]}`, `relit ${name(reviewing)}`)] : []),
        ...(events.length ? [this.label("ACTIVITÉ RÉCENTE"), ...events.map((event) => h_flex().px(10).py(4).gap(12).text_size(13.5)
          .child(div().flex_none().font_family("JetBrains Mono").text_size(12.5).text_color("#8C93A6").child(hour(event.at))).child(div().flex_1().min_w_0().child(event.text)))] : []),
        ...(answered.length ? [this.label("VOS RÉPONSES"), ...answered.map((request) => this.line("✓", request.answer!, request.text, "done"))] : []),
        this.label("RÉFÉRENCES"),
        this.line("#", key, "le ticket principal"),
        this.line("⑂", `mission/${key}`, work?.pr ? `PR #${work.pr.number} vers main · brouillon, vous seul la fusionnez` : "pas encore poussée"),
      ]);
    })();

    return v_flex().flex_1().min_h_0().gap(14).child(banner)
      .child(h_flex().flex_1().min_h_0().gap(14).items_stretch()
        .child(v_flex().flex_1().min_w_0().h_full().gap(16).px(24).pt(20).pb(18).rounded(12).border_1().border_color("#2A2F40").bg("#1B1F2B").child(row).child(board))
        .child(side));
  }

  missionPage(): NativeElement[] {
    const key = this.requested;
    const issue = this.issue;
    const mission = this.mission(key);
    const stage = mission?.stage ?? issue?.missionStage;
    const created = stage !== undefined;
    const title = issue?.title ?? mission?.title;
    const header = title ? this.header(title, this.stages(key, stage ?? "prepare")) : this.header(PROJECT, h_flex().child("La demande"));
    const note = (text: string, color: `#${string}` = "#8C93A6") => this.card().px(24).py(22).child(this.note(text, color));
    const tab = this.tab || TABS[this.reached(created)]!;
    if (created && tab !== "request") {
      // The questions and the spec are local: they never wait for the tracker.
      return [header, this.steps(true), !this.detail ? note(this.detailError || "Chargement…", this.detailError ? "#F2C14E" : "#8C93A6")
        : tab === "develop" ? this.developBody(this.detail) : tab === "plan" ? this.planBody(this.detail) : tab === "spec" ? this.specBody(this.detail) : this.questionsBody(this.detail)];
    }
    if (!issue) return [header, ...(created ? [this.steps(true)] : []), note(this.issueError || "Chargement…", this.issueError ? "#F2C14E" : "#8C93A6")];
    return [header, this.steps(created), this.requestBody(issue, created)];
  }

  render(): NativeElement {
    const page = this.page === "issues" ? this.issuesPage() : this.page === "request" ? this.missionPage() : this.developmentPage();
    return h_flex().id("mission-control").size_full().bg("#12151D").text_color("#E6E9F0").text_size(14)
      .child(this.sidebar())
      .child(v_flex().flex_1().min_w_0().h_full()
        .child(this.pilotTab())
        .child(v_flex().flex_1().min_h_0().px(24).pt(16).pb(20).gap(14).children(page)));
  }
}
