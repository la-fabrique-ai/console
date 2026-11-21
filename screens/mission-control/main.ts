// The Mission Control window: issues, the page of one mission (the request,
// then Pilot's questions) and the list of missions. Drawn after
// docs/mockups/prepare-flow (states 01, 02, 08 to 13, 23 and 24).
import { View, div, type Context, type NativeElement } from "gpui-kit";
import { v_flex, h_flex, TextView, InputState, Input } from "gpui-base";
import { exec, checking, props } from "herdr";
import type { Action, IssueDetail, IssueSummary, Mission, MissionDetail, Payloads, Question, Reply, Stage } from "../../engine/contract.ts";

type Page = "issues" | "request" | "development";
type Spawner = Pick<Context, "spawn">;
type Field = "request" | "answer" | "again" | "tell" | "change";
type Tab = "request" | "questions" | "spec";
const TABS: Tab[] = ["request", "questions", "spec"];
type Tone = "todo" | "done" | "fixed";

// A field keeps the placeholder it was created with: one field per placeholder.
const FIELDS: Record<Field, string> = {
  request: "Ajoutez une précision…",
  answer: "Écrivez une autre réponse…",
  again: "Écrivez encore, Pilot ajuste sa réponse…",
  tell: "Autre chose à dire à Pilot ?",
  change: "Demandez un changement…",
};

const PROJECT = "Jiroo";
const STAGES: [Stage, string][] = [["prepare", "Préparer"], ["develop", "Développer"], ["test", "Tester"], ["validate", "Valider"]];
const STEPS = ["Demande", "Questions", "Spec", "Plan"];
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
  /** The question the operator chose to look at; none: the first one still open. */
  viewing = "";
  /** What the operator adds to the issue before validating the request. */
  details: string[] = [];
  inputs: Partial<Record<Field, InputState>> = {};
  /** Why the mission could not be read. */
  detailError = "";
  /** The missions with a gesture on its way to the engine. */
  sending = new Set<string>();
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
    cx.timer.every(3000, (cx) => this.follow(cx)); // Pilot answers in its own time
    this.refresh(cx);
  }

  refresh(cx: Spawner) {
    const turn = ++this.refreshes; // a later refresh has the last word
    // The missions are local: they never wait for Linear.
    cx.spawn(async (cx) => {
      const reply = await call("missions.list", {});
      if (turn !== this.refreshes) return;
      this.missionsError = "error" in reply ? reply.error.message : "";
      if ("data" in reply) this.missions = reply.data;
      cx.notify();
    });
    cx.spawn(async (cx) => {
      const reply = await call("issues.list", {});
      if (turn !== this.refreshes) return;
      this.issuesError = "error" in reply ? reply.error.message : "";
      if ("data" in reply) this.issues = reply.data;
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
    cx.spawn(async (cx) => {
      const reply = await call("missions.show", { issueKey: key });
      if (this.reading === turn) this.reading = 0;
      if (turn !== this.opens || sends !== this.sends) return;
      const error = "error" in reply ? reply.error.message : "";
      if (error === this.detailError && ("error" in reply || JSON.stringify(reply.data) === JSON.stringify(this.detail))) return;
      this.detailError = error;
      if ("data" in reply) this.detail = reply.data;
      cx.notify();
    });
  }

  /** A gesture about the page on screen is on its way: its button and its field wait for the engine. */
  busy(): boolean {
    return this.sending.has(this.requested) || this.creating.has(this.requested);
  }

  /** What is written belongs to the question on screen: it never follows the operator to another one. */
  clear() {
    for (const field of ["answer", "again", "tell", "change"] as const) this.inputs[field]?.set_value("");
  }

  /** One gesture of the operator towards Pilot; the button is off until the engine answers. */
  send<A extends "questions.validate" | "questions.reply" | "pilot.tell" | "spec.write" | "spec.change" | "spec.validate">(action: A, payload: Payloads[A], cx: Context, field?: Field) {
    const key = payload.issueKey;
    if (this.sending.has(key)) return;
    const turn = this.opens;
    this.clear(); // what was written is on its way; it comes back to its field if the engine refuses it
    this.sending.add(key);
    this.sends++;
    this.requestError = "";
    cx.notify();
    cx.spawn(async (cx) => {
      const reply = await call(action, payload);
      this.sending.delete(key);
      if (turn === this.opens) {
        if ("data" in reply) {
          this.detail = reply.data as MissionDetail;
          // A reply stays on its question, to see Pilot's new proposal; a validation moves on.
          this.viewing = action === "questions.reply" ? (payload as Payloads["questions.reply"]).questionId : "";
          if (action === "spec.write") this.tab = ""; // on to the step the preparation has reached
        } else {
          this.requestError = reply.error.message;
          if (field && "text" in payload) this.inputs[field]?.set_value(payload.text);
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
      if ("data" in reply) this.missions = [...(this.missions ?? []).filter((mission) => mission.issueKey !== issue.key), reply.data];
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

  /** The step the preparation has reached: 0 the request, 1 the questions, 2 the spec. */
  reached(created: boolean): number {
    return !created ? 0 : this.detail?.spec || this.detail?.pilotBusy === "spec" ? 2 : 1;
  }

  /** The four steps of the preparation. A step that was reached opens its page. */
  steps(created: boolean): NativeElement {
    const current = this.reached(created);
    const shown = created && this.tab ? TABS.indexOf(this.tab) : current;
    const questions = this.detail?.questions ?? [];
    const answers = questions.filter((question) => question.answer !== undefined).length;
    const spec = this.detail?.spec;
    const smalls = [
      created ? "validée" : "",
      !questions.length ? "" : current > 1 ? (answers === 1 ? "1 réponse" : `${answers} réponses`) : `${answers} sur ${questions.length}`,
      !spec ? "" : spec.validated ? `validée · v${spec.version}` : "à relire",
      "",
    ];
    const parts: NativeElement[] = [];
    STEPS.forEach((name, index) => {
      if (index > 0) parts.push(div().text_size(13).text_color("#4A5066").child("›"));
      const on = index === shown;
      const done = !on && (index < current || (index === 2 && spec?.validated === true));
      const small = smalls[index];
      const pill = h_flex().id(`step-${index}`).h(30).items_center().gap(8).pl(5).pr(13).rounded(15).border_1()
        .border_color(on ? "#4A52A8" : "#2A2F40").bg(on ? "#1C2040" : CLEAR).text_size(13.5).text_color(on ? "#ffffff" : done ? "#C9CFDB" : "#8C93A6")
        .child(h_flex().w(20).h(20).rounded_full().items_center().justify_center().text_size(11).font_semibold()
          .bg(done ? "#163028" : on ? "#7B8CFF" : "#262B3A").text_color(done ? "#5DE3B8" : on ? "#12151D" : "#C9CFDB").child(done ? "✓" : String(index + 1)))
        .child(name)
        .when(small, (el) => el.child(div().text_size(12.5).text_color(on ? "#A9B4FF" : "#6F7689").child(small!)));
      parts.push(created && index <= current ? pill.cursor_pointer().on_click((_event, cx) => {
        this.tab = TABS[index]!;
        cx.notify();
      }) : pill);
    });
    return h_flex().h(30).flex_none().items_center().gap(8).children(parts);
  }

  // One block, one button (mockup README, "Le composeur"): the button validates
  // while the field is empty and sends what is written once it is not.
  composer(field: Field, hint: string, label: string, validate: ((cx: Context) => void) | null,
    sendHint = "", send: ((text: string, cx: Context) => void) | null = null): NativeElement {
    const input = this.inputs[field];
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
          .child(input && send && !this.busy() ? Input.new(input) : div().text_color("#6F7689").child(FIELDS[field])))
        .child(h_flex().items_center().gap(12).pl(18).pr(10).py(10).border_t_1().border_color("#2A2F40").bg("#1B1F2B")
          .child(div().flex_1().min_w_0().truncate().text_size(13.5).text_color(this.requestError ? "#F2C14E" : "#8C93A6")
            .child(this.requestError || (text ? sendHint : hint)))
          .child(button)));
  }

  /** The main card: what the step shows, then the composer. */
  conversation(id: string, content: NativeElement[], composer: NativeElement): NativeElement {
    return this.card().h_full()
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
    if (total === 0 && !busy) {
      // Pilot answered that the request is enough.
      return page(this.heading("LES QUESTIONS", "Pilot n’a pas de question", "Votre demande lui suffit pour écrire la spec."),
        this.composer("tell", "votre demande suffit · Pilot écrit ensuite la spec", "✓  Écrire la spec", write, "Pilot en tient compte pour la spec", tell),
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
          : this.said(`${total === 1 ? "J’ai votre réponse" : `J’ai vos ${total} réponses`}. Je peux écrire la spec : une page, à relire avant le découpage.`),
      ], this.composer("tell", "vos réponses sont validées · Pilot écrit ensuite la spec",
        detail.spec ? "Spec écrite" : "✓  Écrire la spec", busy || detail.spec || detail.pilotBusy === "spec" ? null : write, "Pilot en tient compte pour la spec", tell),
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
    const composer = current.answer !== undefined
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
      const version = index + 1;
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
    const composer = spec.validated ? this.composer("change", "la spec est dans le projet · le plan arrive avec la prochaine étape", "Spec validée", null)
      : pending ? this.composer("change", "Pilot réécrit ce qui change, le reste ne bouge pas.", "Pilot met la spec à jour…", null)
      : this.composer("change", "ou validez la spec · Pilot découpe ensuite en tickets", "✓  Valider la spec", (cx) => this.send("spec.validate", { issueKey: key }, cx),
        "Pilot met la spec à jour · vous validez ensuite", (text, cx) => this.send("spec.change", { issueKey: key, text }, cx, "change"));
    return page(content, composer);
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
        : tab === "spec" ? this.specBody(this.detail) : this.questionsBody(this.detail)];
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
