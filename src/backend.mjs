import {normalizeBackendOptions,ticketAction,ticketError} from '../integrations/tickets/factory.mjs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fail, exec as defaultExec, object } from './common.mjs';
import { createStorage } from './state.mjs';
import { createCommands } from './commands.mjs';
import { createHerdr } from './herdr.mjs';
import { createTraces, tracedHerdr } from './traces.mjs';
import { createMissionBudgets } from './mission-budgets.mjs';
import { createTicketTokens } from './ticket-tokens.mjs';
import { createTicketFactory } from '../integrations/tickets/factory.mjs';
import { createTicketReader,createEnrichedTicketReader } from './ticket-read.mjs';
import { createProjects } from './projects.mjs';
import { createWorktrees } from './worktrees.mjs';
import { createProofs } from './proofs.mjs';
import { createSessions } from './sessions.mjs';
import { createLauncher } from './launch.mjs';
import { createReports } from './reports.mjs';
import { createConfigMigration } from './config-migration.mjs';
import { createRepositoryPreview } from './repository-preview.mjs';
import { createWorkspaceState } from './workspace-state.mjs';
import { createWorkspacePlans } from './workspace-plans.mjs';
import { createWorkspacePreparation } from './workspace-preparation.mjs';
import { createTicketQualification } from './ticket-qualification-read.mjs';
import { createMissions } from './missions.mjs';
import { createMissionRegistry,createMissionActions } from './mission.mjs';
import { createMissionClose } from './mission-close.mjs';
import { createPoLauncher } from './po-launch.mjs';
import { createPoQuestions } from './po-questions.mjs';
import { createAgentStart } from './agent-start.mjs';
import { createIssueWorktree } from './issue-worktree.mjs';
import { createDevFlow } from './dev-flow.mjs';
import { createTicketWorktrees } from './ticket-worktree.mjs';
import { createDevChain, macNotify } from './dev-chain.mjs';
import { createQuestionRegistry, createQuestionActions } from './questions.mjs';
import { createRequestRegistry } from './requests.mjs';
import { createMockups } from './mockups.mjs';
import { createWaiting } from './waiting.mjs';
import { createLeadWake } from './lead-wake.mjs';
import { createWatchActions } from './watch.mjs';
import { createPilot } from './pilot.mjs';
import { createValidationDesk } from './validation-desk.mjs';
import { createEnvironmentCheck } from './environment-check.mjs';
import { createEnvironmentView } from './environment-view.mjs';
import { trialOf, trialExec, assertConfined, forbid, TrialTracker } from './trial.mjs';
import { AGENT_MARK, ROLE_MARK, LEAD_ROLE, PILOT_ROLE } from '../ui/v3/view.js';

// The approval and the answers by click (decision 70): a click of the user on the screen, never a command of an agent.
// What this does not stop: a program written on purpose under the same account, without the mark.
// « Pause » and « Resume » too (M11): the pause is the user's, and no agent lifts it. « Seen » too (M14): what the page
// showed is the user's, and no agent hides a fact from him.
export const SCREEN_COMMANDS=['mission-launch','mission-stop-after','mission-reapprove','inbox-answer','mission-pause','mission-resume','mission-visit-seen','mission-approve-close','mission-reopen'];
const LEAD_COMMANDS=['lead-block'],LEAD_ONLY='Refusé : lead-block est réservée au Lead ; une autre session d\'agent lancée par Mission Control ne peut pas l\'utiliser. Rien n\'est écrit.';
const AGENT_SESSION='Refusé : cette commande est réservée au propriétaire dans Mission Control. Rien n\'a été modifié. Demande-lui d\'effectuer l\'action à l\'écran.';
export function createBackend(options={}) {
  let {env=process.env,home=homedir(),root=env.FABRIQUE_CONSOLE_HOME??join(home,'.config','fabrique-console'),exec=defaultExec,transport:injectedTransport,trustedPagination=false,tickets:injectedTickets,ticketFactory=null,herdr:injectedHerdr=null,workspaceOptions={},ticketReadOptions={},missionOptions={},traceAgents=true}=normalizeBackendOptions(options);
  root=resolve(root);
  // A trial folder (src/trial.mjs): its tracker, its agents, its worktrees, its core; refused when mixed with the real.
  const trial=trialOf({root,env,home});
  // A trial runs only in the sandbox of the trial launcher: checked first, nothing is read or started otherwise.
  if(trial) {
    assertConfined(trial);
    exec=trialExec(exec,trial);injectedTransport=new TrialTracker(trial);
    missionOptions={agentFolder:trial.agentFolder,...missionOptions};
  }
  const storage=createStorage({root});
  const commands=createCommands({exec});
  const {getTickets,createWriter}= (ticketFactory??createTicketFactory)({root,exec,loadConfig:storage.loadConfig,injectedTransport,injectedTickets,trustedPagination,enrichedOptions:ticketReadOptions});
  // Herdr, through its one module: a trial gives it the programs of its folder, beneath its confinement.
  const plain=trial?createHerdr({invoke:commands.invoke,trial}):injectedHerdr??createHerdr({invoke:commands.invoke});
  // Every agent it starts is traced (M12): the link to its session, by mission, ticket, role and turn, never its content.
  const traces=createTraces({root,env,home}),herdr=tracedHerdr(plain,traceAgents?traces:null);
  // The tokens of each ticket and agent, read in full from the sessions of those traces at each reading (M13, decision 101).
  const ticketTokens=createTicketTokens({traces});
  const context={root,herdr,...storage,...commands,readTerminals:herdr.readTerminals,getTickets};
  const projects=createProjects(context);
  const repositoryPreview=createRepositoryPreview(context);
  const workspaceStore=createWorkspaceState(root);
  const workspacePlans=createWorkspacePlans({...context,...(trial?{worktreesRoot:trial.worktreesRoot}:{}),store:workspaceStore,fetchTimeoutMs:workspaceOptions.fetchTimeoutMs,fetchProof:workspaceOptions.fetchProof,fetchWaitMs:workspaceOptions.fetchWaitMs});
  const workspacePreparation=createWorkspacePreparation({...context,store:workspaceStore,plans:workspacePlans,workerPath:workspaceOptions.workerPath,alertAfterMs:workspaceOptions.alertAfterMs});
  const migration=createConfigMigration({root});
  const worktrees=createWorktrees(context);
  const proofs=createProofs({...context,...worktrees});
  const sessions=createSessions({...context,...proofs});
  const reports=createReports({...context,...worktrees,...proofs});
  const reader=createTicketReader(context);
  const enriched=createEnrichedTicketReader({...context,options:ticketReadOptions});
  const qualification=createTicketQualification({...context,readIssue:enriched.issue});
  const missions=createMissions({...context,store:workspaceStore,workspaceOptions,ticketReadOptions},missionOptions);
  const writer=createWriter(context);
  const durable=createMissionRegistry({root}),asked=createQuestionRegistry({root,loadConfig:storage.loadConfig}),inbox=createRequestRegistry({root,loadConfig:storage.loadConfig,questions:asked,missions:durable,notify:macNotify({invoke:commands.invoke})});
  const launcher=createLauncher({...context,...worktrees,...proofs,...sessions,missions:durable,chainLaunch:input=>devChain.launch(input)});
  const po=createPoLauncher({...context,getTickets,...sessions,missions:durable});
  const questions=createPoQuestions(context);
  const agentStart=createAgentStart({...context,...(missionOptions.agentFolder?{agentFolder:missionOptions.agentFolder}:{})});
  const issueWorktree=createIssueWorktree({...context,...(trial?{worktreesRoot:trial.worktreesRoot}:{})});
  const devFlow=createDevFlow(context);
  const ticketWorktrees=createTicketWorktrees(context);
  // The environment check of a project (M6): reads only; its enrollment is the user's, refused from an agent.
  const environment=createEnvironmentCheck({root,loadConfig:storage.loadConfig,invoke:commands.invoke,env});
  // What the page of a mission shows of it, and « Run the check again » for the project of a mission (M6 b). Read again
  // by every launch of the first dev of a mission: not green, refused (decision 111).
  const environmentView=createEnvironmentView({root,loadConfig:storage.loadConfig,check:environment.check});
  const missionBudgets=createMissionBudgets({...context,missions:durable,usage:ticketTokens,inbox});
  // Every message to a Lead wakes it first when the chain put it to rest (lot 1B).
  const leadSend=createLeadWake({root,loadState:context.loadState,missions:durable,leadLaunch:po.lead,send:devFlow.send});
  const devChain=createDevChain({...context,detail:reader.detail,reports:devFlow.reports,send:leadSend,ensureWorktree:issueWorktree.ensure,ticketBranch:ticketWorktrees.prepare,ticketMerge:ticketWorktrees.merge,setStep:questions.step,missions:durable,questions:asked,inbox,leadLaunch:leadSend.launch,validation:devFlow.validation,environment:environmentView.read,environmentHold:environmentView.hold,budgetCheck:missionBudgets.tick});
  const environmentCheck=input=>input&&typeof input==='object'&&Object.hasOwn(input,'mission')?environmentView.runMission(input,durable):environment.check(input);
  const missionActions=createMissionActions({...context,window:herdr.window,tokens:missionBudgets.read,environment:environmentView.read,registry:durable,previewRead:missions.read,chain:devChain,questions:asked,inbox,validation:devFlow.validation,send:leadSend,environmentHold:environmentView.hold});
  const missionClose=createMissionClose({...context,registry:durable,validation:devFlow.validation,send:leadSend,close:missionActions.close});
  const exchanges=createQuestionActions({questions:asked,inbox,missions:durable,launch:devChain.launch,unpaused:devChain.unpaused});
  const waiting=createWaiting({...context,missions:durable,send:leadSend});
  // A trial keeps its pictures in its own Herdr home; it renders none (Chrome would need the network of the machine).
  const mockups=createMockups({...context,root,registry:durable,inbox,send:leadSend,decide:exchanges.choose,...(trial?{appHome:trial.herdrAppHome,capture:async()=>forbid(trial,'A trial renders no mockup: the capture needs Chrome and the network.',{kind:'application',program:'chrome'})}:{})});
  const pilot=createPilot({...context,getTickets,missions:durable,questions:asked,inbox,reports:devFlow.reports,validation:devFlow.validation,...(missionOptions.agentFolder?{agentFolder:missionOptions.agentFolder}:{})});
  const desk=createValidationDesk({...context,registry:durable});
  const watch=createWatchActions({root,env,...(missionOptions.watchRunner?{runner:missionOptions.watchRunner}:{}),...(missionOptions.spawnProcess?{spawnProcess:missionOptions.spawnProcess}:{})});
  const actions=new Map([
    ['mission-close-check',missionClose.check], ['mission-approve-close',missionClose.approve], ['mission-reopen',missionClose.reopen],
    ['ticket-backlog',reader.backlog], ['ticket-my-issues',reader.myIssues], ['ticket-create',writer.create], ['po-launch',po.launch], ['po-ask',questions.ask], ['po-answer',questions.answer], ['po-ready',questions.ready], ['po-step',questions.step], ['agent-start',agentStart.start], ['issue-worktree',issueWorktree.ensure], ['dev-launch',devChain.launch], ['dev-chain-read',devChain.read], ['dev-chain-tick-all',devChain.tickAll], ['ticket-branch',ticketWorktrees.prepare], ['ticket-merge',ticketWorktrees.merge], ['dev-reports',devFlow.reports], ['dev-send',leadSend], ['validation-read',devFlow.validation], ['validation-mark',devFlow.mark], ['watch-start',watch.start], ['watch-status',watch.status], ['watch-poke',watch.poke],
    ['read-config',storage.readConfig],
    ['environment-check',environmentCheck], ['environment-enroll',environment.enroll],
    ['repo-preview',repositoryPreview.preview],
    ['worktree-plan',workspacePlans.plan],
    ['worktree-prepare',workspacePreparation.prepare], ['worktree-reconcile',workspacePreparation.reconcile], ['worktree-release',workspacePreparation.release],
    ['worktree-cleanup',workspacePreparation.cleanup],
    ['fetch-inspect',workspacePlans.inspectFetches], ['fetch-abandon',workspacePlans.abandonFetch],
    ['config-migrate',migration.migrate], ['config-save',projects.saveConfig], ['snapshot',sessions.snapshot],
    ['ticket-list',reader.list], ['project-summary',projects.projectSummary],
    ['ticket-detail',reader.detail], ['ticket-meta',reader.meta],
    ['ticket-projects',enriched.projects], ['ticket-issues-enriched',enriched.issues],
    ['ticket-issue-enriched',enriched.issue], ['ticket-document',enriched.document],
    ['ticket-qualify',qualification.qualify],
    ['mission-measure',missionBudgets.measure], ['mission-preview',missions.preview], ['mission-read',missionActions.read], ['mission-visit-seen',missionActions.visitSeen],
    ['mission-create',missionActions.create], ['mission-tldr',missionActions.tldr], ['mission-launch',missionActions.launch], ['mission-stop-after',missionActions.stopAfter], ['mission-reapprove',missionActions.reapprove], ['mission-pause',devChain.pause], ['mission-resume',devChain.resume], ['mission-close',missionActions.close], ['mission-plan',missionActions.plan], ['lead-plan',missionActions.savePlan], ['issue-sheet',missionActions.sheet], ['lead-close',missionActions.leadClose], ['inbox-delegate',missionActions.delegate], ['inbox-discuss',missionActions.discuss], ['agent-waiting',waiting.read], ['agent-started',waiting.started], ['agent-discuss',waiting.discuss], ['mockup-publish',mockups.publish], ['mockup-pick',mockups.pick], ['mission-list',missionActions.list],
    ['lead-launch',leadSend.launch], ['lead-request',exchanges.request], ['lead-answer',exchanges.answer], ['lead-escalate',exchanges.escalate], ['lead-block',exchanges.block],
    ['pilot-decide',exchanges.decide], ['inbox-answer',exchanges.click], ['inbox-list',exchanges.list], ['mission-delivery',desk.delivery], ['mission-server',desk.server], ['qa-browser',desk.qaBrowser], ['inbox-open',pilot.open], ['pilot-launch',pilot.launch], ['pilot-command',pilot.command],
    ['launch',launcher.launch], ['git',worktrees.inspectSessionGit],
    ['qa',proofs.qa], ['test-proofs',proofs.testProofs], ['stop',sessions.stop], ['propose',reports.propose], ['ticket-mutate',writer.mutate],
  ]);
  async function dispatch(action,input={}) {
    object(input);
    action=ticketAction(action);
    const handler=actions.get(action);
    if(!handler)fail('UNKNOWN_ACTION','Unknown local backend action.');
    // Decision 70: the commands of the screens refuse a request from a session of an agent the tool launched (the mark
    // it sets when it starts one, ui/v3/view.js), before anything is read or written.
    if(SCREEN_COMMANDS.includes(action)&&env[AGENT_MARK])fail('AGENT_SESSION',AGENT_SESSION);
    // The commands of the Lead refuse a session of another agent the tool launched (M10 review): the same barrier, by
    // the role mark the tool gives the Lead alone. the user by hand carries no mark and is not refused.
    if(LEAD_COMMANDS.includes(action)&&env[AGENT_MARK]&&env[ROLE_MARK]!==LEAD_ROLE)fail('LEAD_ONLY',LEAD_ONLY);
    // The limit of a mission is the user's (chantier 1, point 16): passed on by Pilot (its role mark), never set by the Lead
    // nor by any other agent the tool launched.
    if(action==='lead-launch'&&input.stopAfter!==undefined&&env[AGENT_MARK]&&env[ROLE_MARK]!==PILOT_ROLE)fail('STOP_AFTER_RESERVED','Refusé : seul le propriétaire (ou Pilot de sa part) fixe où s\'arrête un développement. Rien n\'est écrit.');
    try{return await handler(input);}catch(error){throw ticketError(error);}
  }
  return {dispatch,root,loadConfig:storage.loadConfig};
}
