// The Mission Control window: issues, the request page of one issue, and the
// list of missions. Drawn after docs/mockups/prepare-flow (states 01 and 02).
import { View, div, type Context, type NativeElement } from "gpui-kit";
import { v_flex, h_flex, TextView } from "gpui-base";
import { exec, checking, props } from "herdr";
import type { Action, IssueDetail, IssueSummary, Mission, Payloads, Reply, Stage } from "../../engine/contract.ts";

type Page = "issues" | "request" | "development";
type Spawner = Pick<Context, "spawn">;

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
  requested = "";
  issue: IssueDetail | null = null;
  requestError = "";
  creating = false;

  init(_props: unknown, cx: Spawner) {
    if (!checking()) this.refresh(cx);
  }

  refresh(cx: Spawner) {
    const turn = ++this.refreshes;
    cx.spawn(async (cx) => {
      const [issues, missions] = await Promise.all([call("issues.list", {}), call("missions.list", {})]);
      if (turn !== this.refreshes) return; // a later refresh has the last word
      this.issuesError = "error" in issues ? issues.error.message : "";
      if ("data" in issues) this.issues = issues.data;
      this.missionsError = "error" in missions ? missions.error.message : "";
      if ("data" in missions) this.missions = missions.data;
      cx.notify();
    });
  }

  show(page: "issues" | "development", cx: Context) {
    this.page = page;
    this.refresh(cx);
    cx.notify();
  }

  open(key: string, cx: Context) {
    this.page = "request";
    this.requested = key;
    this.issue = null;
    this.requestError = "";
    cx.notify();
    cx.spawn(async (cx) => {
      const reply = await call("issues.show", { key });
      if (this.requested !== key) return; // the operator opened another issue meanwhile
      if ("data" in reply) this.issue = reply.data;
      else this.requestError = reply.error.message;
      cx.notify();
    });
  }

  validate(cx: Context) {
    const issue = this.issue;
    if (!issue || this.creating) return;
    this.creating = true;
    this.requestError = "";
    cx.notify();
    cx.spawn(async (cx) => {
      const reply = await call("missions.create", { issueKey: issue.key });
      this.creating = false;
      if ("data" in reply) this.missions = [...(this.missions ?? []).filter((mission) => mission.issueKey !== issue.key), reply.data];
      else if (this.requested === issue.key) this.requestError = reply.error.message;
      this.refresh(cx);
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

  // Drawn and inert in slice 1: Pilot arrives with slice 2.
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
    // Drawn and inert in slice 1: creating a ticket arrives with slice 2.
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

  // ---- request (mockup 02) -------------------------------------------------
  stages(issue: IssueDetail, current: Stage): NativeElement {
    const parts: NativeElement[] = [div().child(`${PROJECT} · ${issue.key}`)];
    STAGES.forEach(([stage, label], index) => {
      if (index > 0) parts.push(div().text_color("#5C6378").child("›"));
      const on = stage === current;
      parts.push(h_flex().items_center().gap(5)
        .child(div().w(7).h(7).rounded_full().bg(on ? "#7B8CFF" : "#5C6378"))
        .child(on ? div().font_semibold().text_color("#ffffff").child(label) : div().child(label)));
    });
    return h_flex().items_center().gap(10).children(parts);
  }

  steps(created: boolean): NativeElement {
    const parts: NativeElement[] = [];
    STEPS.forEach((name, index) => {
      if (index > 0) parts.push(div().text_size(13).text_color("#4A5066").child("›"));
      const done = index === 0 && created;
      const on = index === 0 && !created;
      parts.push(h_flex().h(30).items_center().gap(8).pl(5).pr(13).rounded(15).border_1()
        .border_color(on ? "#4A52A8" : "#2A2F40").bg(on ? "#1C2040" : CLEAR).text_size(13.5).text_color(on ? "#ffffff" : "#8C93A6")
        .child(h_flex().w(20).h(20).rounded_full().items_center().justify_center().text_size(11).font_semibold()
          .bg(done ? "#1F7A5C" : on ? "#7B8CFF" : "#262B3A").text_color(done ? "#ffffff" : on ? "#12151D" : "#C9CFDB").child(done ? "✓" : String(index + 1)))
        .child(name)
        .when(done, (el) => el.child(div().text_size(12.5).text_color("#6F7689").child("validée"))));
    });
    return h_flex().h(30).flex_none().items_center().gap(8).children(parts);
  }

  // One block, one button (mockup README, "Le composeur"). The field is drawn
  // and inert in slice 1: adding a detail arrives with Pilot, in slice 2.
  composer(created: boolean): NativeElement {
    const off = created || this.creating;
    const button = h_flex().id("validate").flex_none().h(40).px(18).items_center().rounded(10).border_1().text_size(14.5).font_semibold()
      .border_color(off ? "#2A2F40" : "#2FA37A").bg(off ? "#262B3A" : "#1F7A5C").text_color(off ? "#8C93A6" : "#ffffff")
      .when(!off, (el) => el.cursor_pointer().hover((style) => style.bg("#248A68")).on_click((_event, cx) => this.validate(cx)))
      .child(created ? "Mission créée" : "✓  Valider la demande");
    const hint = this.requestError || (created ? "La mission est dans Development · étape Préparer" : "ou validez la demande · la mission est créée");
    return div().flex_none().px(36).pt(18).pb(22).border_t_1().border_color("#2A2F40")
      .child(v_flex().rounded(14).border_1().border_color("#3A4052").bg("#0F1219").overflow_hidden()
        .child(div().min_h(66).px(18).pt(16).pb(18).text_size(15).text_color("#6F7689").child("Ajoutez une précision…"))
        .child(h_flex().items_center().gap(12).pl(18).pr(10).py(10).border_t_1().border_color("#2A2F40").bg("#1B1F2B")
          .child(div().flex_1().min_w_0().truncate().text_size(13.5).text_color(this.requestError ? "#F2C14E" : "#8C93A6").child(hint))
          .child(button)));
  }

  brief(issue: IssueDetail): NativeElement {
    const label = (text: string) => div().mt(20).mb(8).text_size(11.5).font_semibold().text_color("#8C93A6").child(text);
    const line = (badge: string, text: string, small = "") => h_flex().items_start().gap(11).py(7).text_size(14).text_color("#E6E9F0")
      .child(h_flex().flex_none().min_w(22).h(22).px(4).rounded(6).bg("#262B3A").items_center().justify_center().text_size(11).font_bold().text_color("#C9CFDB").child(badge))
      .child(v_flex().flex_1().min_w_0().child(text).when(small, (el) => el.child(div().mt(2).text_size(13).text_color("#8C93A6").child(small))));
    return v_flex().w(440).flex_none().h_full().min_h_0().rounded(12).border_1().border_color("#3A4052").bg("#1D2130")
      .child(h_flex().h(52).flex_none().items_center().px(18).border_b_1().border_color("#2A2F40")
        .child(div().text_size(12).font_semibold().text_color("#A3AABB").child("LA DEMANDE EN BREF")))
      .child(v_flex().id("brief").flex_1().min_h_0().overflow_y_scrollbar().px(20).pt(16).pb(18)
        .child(div().text_size(20).font_semibold().text_color("#ffffff").child(issue.key))
        .child(div().mt(6).text_size(13.5).text_color("#8C93A6").child("L’issue telle qu’elle est dans le tracker."))
        .child(label("RANGEMENT"))
        .child(line("P", `Projet · ${PROJECT}`))
        .child(label("ENSUITE"))
        .child(line("2", "Les questions de Pilot", "une par page, avec une réponse proposée"))
        .child(line("3", "La spec", "écrite par Pilot, relue par vous"))
        .child(line("4", "Le plan", "les tickets, l’équipe, l’estimation")));
  }

  requestPage(): NativeElement[] {
    const issue = this.issue;
    if (!issue) {
      return [
        this.header(PROJECT, h_flex().child("La demande")),
        this.card().px(24).py(22).child(this.note(this.requestError || "Chargement…", this.requestError ? "#F2C14E" : "#8C93A6")),
      ];
    }
    // The local list of missions knows first: it is updated the moment one is created.
    const stage = this.missions?.find((mission) => mission.issueKey === issue.key)?.stage ?? issue.missionStage;
    const created = stage !== undefined;
    const chip = (text: string) => h_flex().h(26).px(9).items_center().rounded(6).border_1().border_color("#363C50").text_size(12.5).text_color("#C9CFDB").child(text);
    return [
      this.header(issue.title, this.stages(issue, stage ?? "prepare")),
      this.steps(created),
      h_flex().flex_1().min_h_0().gap(14).items_stretch()
        .child(this.card().h_full()
          .child(v_flex().id("request").flex_1().min_h_0().overflow_y_scrollbar().px(36).pt(30).pb(22)
            .child(v_flex().max_w(880)
              .child(div().text_size(12).font_semibold().text_color("#A9B4FF").child(`${issue.key} · LA DEMANDE`))
              .child(div().mt(6).text_size(26).font_semibold().text_color("#ffffff").child(issue.title))
              .child(h_flex().mt(12).gap(6).child(chip(issue.status)).child(chip(PROJECT)))
              .child(div().mt(12).text_size(15.5).text_color("#D6DAE6").child(TextView.markdown("description", issue.description)))))
          .child(this.composer(created)))
        .child(this.brief(issue)),
    ];
  }

  render(): NativeElement {
    const page = this.page === "issues" ? this.issuesPage() : this.page === "request" ? this.requestPage() : this.developmentPage();
    return h_flex().id("mission-control").size_full().bg("#12151D").text_color("#E6E9F0").text_size(14)
      .child(this.sidebar())
      .child(v_flex().flex_1().min_w_0().h_full()
        .child(this.pilotTab())
        .child(v_flex().flex_1().min_h_0().px(24).pt(16).pb(20).gap(14).children(page)));
  }
}
