// Every label of the V4 screens, in one place. Worded by Codex, chosen by the user.
const counted=(one,many)=>n=>n===1?'1 '+one:n+' '+many;
export const W={
  brand:'Mission Control',logo:'DV',
  nav:{inbox:'Inbox',issues:'Issues',devs:'Development',projects:'Projects'},
  glyph:{inbox:'✉',issues:'◫',devs:'‹/›',projects:'▣'},
  bar:{collapse:'Collapse',expand:'Expand'},
  rail:{all:'All',allGlyph:'⌂',local:'Mac',localGlyph:'M',add:'+'},
  side:{nothing:'No active missions',missions:counted('mission','missions')},
  // The column on the right, worded by Codex.
  right:{summary:'Summary',tickets:'Tickets',merged:(done,total)=>done+'/'+total+' merged',noSummary:'No summary yet.',ask:'Open Pilot',noLead:'Not leading a development.',
    status:(review,fix)=>review+' in review · '+fix+' fixing',hidden:n=>n+' more merged',all:'Show all',
    live:{qa:'QA running',dev:id=>id+' in progress',review:id=>id+' in review',waits:'waiting for you',since:clock=>'started at '+clock}},
  watcher:{on:'Watcher active',off:'Watcher status unknown',watching:clock=>clock?'Last seen · '+clock:'Watching',last:clock=>clock?'Last seen · '+clock:'Last seen: unknown'},
  tabs:{pilot:'Pilot',pinned:'⌂ Pinned',close:'✕',add:'+',search:'⌕',settings:'⚙',lead:id=>'Lead · '+id},
  picker:{title:'Show an agent',empty:'No other agents to show.'},
  lead:{glyph:'⎈'},
  pilot:{title:'Pilot',glyph:'◎',sub:'Tell Pilot what you want to work on.',starting:'Starting Pilot…',failed:'Pilot is unavailable right now.',retry:'Try again',compact:'Compact',clear:'Clear',compacting:'Compacting…',clearing:'Clearing…',compacted:'Compact sent to Pilot',cleared:'Pilot starts afresh'},
  steps:{requested:'Preparation',delegated:'Preparation',analysing:'Preparation',building:'Development',qa:'Development',validating:'Validation',validated:'Closure',closed:'Closed'},
  phase:{devs:counted('ticket','tickets'),waiting:counted('question','questions'),review:'Review'},
  stepBar:['Prepare','Develop','Validate','Close'],
  prepare:{button:'Prepare ticket',for:'Choose a project',cancel:'Cancel preparation'},
  sheet:{summary:'Summary',subTickets:'Subtickets',done:'Activity',development:'Development',comments:'Comments',state:'Status',priority:'Priority',assignee:'Assigned to',labels:'Labels',branch:'Branch',openDev:'Open development',loading:'Loading ticket…',unavailable:'Couldn’t load this ticket from the tracker.',noSummary:'No summary available.',created:d=>'Created '+d,updated:d=>'Updated '+d,count:(n,done,doing)=>n+' shown · '+done+' done · '+doing+' in progress'},
  plan:{title:'Development plan',origin:'Prepared with Pilot · completed by Lead',decided:'Decisions',links:'Links',mockups:'Mockups',show:'Show plan',hide:'Hide plan',unavailable:'Couldn’t read the plan from the tracker.',none:'No plan in the issue yet.'},
  close:{ready:'Ready to close',line:'Ask the Lead to check the merge, deployment, tickets and final summary, then close.',problems:n=>n===1?'1 test has an issue. Go to Lead for a fix, or close anyway.':n+' tests have issues. Go to Lead for fixes, or close anyway.',button:'Close development',closing:'Asking Lead to close…',asked:'Closure requested'},
  tools:{claude:'Claude',codex:'Codex'},strong:'Extra review',
  ticket:{dev:'In progress',review:'In review',fix:'Fixing',accepted:'Review passed',mergeRefused:'Merge refused',merged:'Merged',waiting:'Awaiting reply',asking:'Needs your OK',toLaunch:'Not started',waits:list=>'Waiting for '+list,after:list=>'after '+list},
  item:{decision:'Decision needed',authorization:'Permission needed',stuck:'Blocked',validation:'Final approval',urgent:'High priority',normal:'Normal priority'},
  qa:{start:'Start QA',title:id=>'QA · '+id,modes:{browser:'Browser',app:'App',special:'Special'},quit:'Quit',starting:'Starting…',appOn:'App on the iPhone',serverOn:url=>'Server · '+url,noUrl:'The test server gives no address.',waitingServer:'Starting the test server…',preparing:{browser:'Starting the test server…',app:'Starting the app…',special:'Looking for the logs…'},serverStopped:'The test server stopped.',leadSetup:'Ask the Lead to play it',leadAsked:'The Lead is playing this test…',leadLate:'No result from the Lead yet.',feedbackTitle:'What is wrong? The Lead reads it to prepare the fix.',feedbackHint:'What you see, what you expected',cancel:'Cancel',saveProblem:'Save the problem',removeProblem:'Remove the problem',yourFeedback:'Your feedback',problemsNoted:n=>n+(n>1?' problems noted':' problem noted'),problemsSend:'Send them to the Lead',problemsAgain:'Send them again',problemsSending:'Sending…',problemsSent:'Sent to the Lead',problemsUncertain:'They may not have reached the Lead.',leadResult:'Lead result',leadVerdict:{ok:'Matches',ko:'Does not match',unsure:'Unsure'},noLead:'No Lead is running for this development.',logs:'Logs of the test',nothing:'Nothing to show for this test',follow:'Follow the steps on the right.',compare:'Compare to mockup',backToTest:'Hide the mockup',shot:'Open the QA capture'},
  sim:{title:t=>'Simulator'+(t?' · '+t:''),close:'Close',run:'Run app',starting:'Starting…',open:'Open simulator'},
  mockup:{open:'View mockup',title:'Mockups',note:'Note for the Lead (optional)',choose:name=>'Choose '+name,approve:'Choose this mockup',choosing:'Sending…',chosen:name=>'Chosen: '+name,browser:'Open in browser',none:'This mockup is no longer available.'},
  inbox:{title:'Inbox',none:'Nothing pending',count:counted('request waiting','requests waiting'),empty:'Nothing needs your attention right now.',recommendation:'The Lead suggests: ',open:'Go to Pilot',proofs:'References',agentsWaiting:'Agents waiting for you',sent:'Answer sent',asksToRun:'Asks to run:',openTerminal:'Open terminal',or:'ou',ago:{now:"à l'instant",before:'il y a ',units:{m:' min',h:' h',d:' j'}},delegate:'Let the Lead decide',delegated:'The Lead will decide',more:'Show details',less:'Hide details',agentWaits:'waiting for your reply'},
  issues:{title:'Issues',all:'All',filters:{active:'Active',backlog:'Backlog',all:'All issues'},open:'Go to Pilot',created:day=>'Created '+day,mission:(id,phase)=>'Mission '+id+' · '+phase,placeholder:'New issue title',create:'Create issue',creating:'Creating…',
    empty:{active:'No active issues.',backlog:'No issues in Backlog.',all:'No issues.'},loading:'Loading issues…',teamError:'Issues unavailable: ',pending:'An issue with this title may already have been created.',resume:'Resume creation',another:'Create another issue'},
  devs:{title:'Development',count:counted('active mission','active missions'),none:'No active missions',watched:'Tracked by the watcher',lead:name=>'Lead · '+name,journal:id=>'Watcher log · '+id,noJournal:'No events yet.',tickets:id=>id+' · tickets',noTickets:'No tickets yet.',tracker:'Open ticket',goLead:'Go to Lead',goQa:'Go to QA',goPilot:'Go to Pilot',empty:'No active missions here.'},
  // Provisional until Codex words them.
  detail:{back:'‹',launch:'Start devs',launching:'Sending start request…',launchAsked:'Start requested',launchWhenReady:'Start devs when ready',preparing:'The Lead is preparing the plan and tickets.',ready:n=>'Plan and '+counted('ticket','tickets')(n)+' ready',readyStart:(first,total)=>first<1?'':(first===1?'1 dev will start':first+' devs will start together')+'.'+(first<total?' The rest will start when the tickets they depend on are accepted.':''),waitingStart:'Waiting for you to start',tldr:'TL;DR',done:'What was done',reviews:'Reviews',full:'Full report',hide:'Hide report',tickets:'Tickets',progress:'Progress',activity:'Recent activity',noActivity:'Nothing yet.',branch:'Branch',machine:'Machine',checks:'Checks',lead:'Lead',noLead:'Not running',status:{working:'Working',blocked:'Waiting for a reply',idle:'Idle',done:'Idle'},qaAgent:'QA agent',qaState:{running:'Running',starting:'Starting…',asking:'Waiting for a reply',stopped:'Stopped before its report',gone:'Tab closed before its report',done:'Done',unknown:'Unknown'},qaStarted:at=>'started '+at,qaTests:n=>n+(n>1?' tests captured':' test captured'),qaNoShot:'no capture yet',qaLast:at=>'last at '+at,qaReport:at=>'report at '+at,waiting:counted('decision waiting for you','decisions waiting for you'),dev:'Dev',review:n=>'Review '+n,verdict:{accepted:'Passed',changes_requested:'Changes requested'},noReport:'No report yet.',delivered:(id,tool)=>id+' delivered'+(tool?' by '+tool:''),passed:id=>id+' passed review',changes:id=>id+' needs changes',qaPassed:'Checks passed',qaProblems:'Checks found problems',tests:counted('test','tests')},
  // Provisional until Codex words them.
  check:{decisionsUncertain:'The decisions of the QA may not have reached the Lead.',sendAgain:'Send them again',found:'What the QA found',checkFirst:'Check first',risks:n=>'Risks ('+n+')',fullReport:'Full QA report',playedBy:(played,total,you)=>played+' of '+total+' played by the QA'+(you?' · '+you+' for you':''),notPlayedYet:n=>n+(n>1?' tests were':' test was')+' not played by the QA: you play '+(n>1?'them':'it')+'.',qaProblem:title=>'The QA found a problem: '+title,decision:'Decision',testsLabel:(n,ranges)=>(n>1?'tests ':'test ')+ranges,title:'Validation',progress:(ok,ko,n)=>(ok+ko)+' / '+n+' checked'+(ko?' · '+ko+(ko>1?' problems':' problem'):''),start:'Start',stop:'Stop',running:'Running',stopped:'Server stopped',appRunning:'App running',appStopped:'App stopped',none:'No server in the plan',port:n=>'port '+n,code:'Code',repositories:counted('repository','repositories'),notPushed:'Not pushed',pushed:'Pushed',somePushed:'Partly pushed',noPr:'No pull request',prUnknown:'Pull request unknown',pr:n=>'PR #'+n,testOf:(a,n)=>'Test '+a+' of '+n,todo:'To do',expected:'Expected',passed:'Passed →',problem:'Problem',prev:'‹',next:'›',allDone:'All tests are checked.',review:'Review tests',report:'Report',hide:'Hide report',qa:'QA',qaFound:'Found problems',qaClean:'No problems found',played:(a,n)=>a+' of '+n+' played in a browser',notPlayed:'Not played in a browser',qaResult:{ok:'QA passed',ko:'QA failed',skipped:'QA skipped'},noPlan:'No test plan yet.'},
  project:{issuesCount:counted('issue','issues'),devsTitle:'Active missions',issuesTitle:'Issues',tickets:counted('ticket','tickets'),questions:counted('question waiting','questions waiting'),nothing:'No active missions.'},
  // The page of a ticket (v2). The strings of the mockup, as ticket 29 kept them, and those Codex worded for ticket 30; a
  // number or an identifier is a parameter. Each one is checked to the letter by tests/v4-page.test.mjs.
  toolNames:{claude:'Claude Code',codex:'Codex'},
  page:{stages:{prepare:'Prepare',develop:'Develop',validate:'Validate'},flag:'⚑',back:'‹',more:'⋯',pilot:'Talk to Pilot',pilotStarting:'Opening Pilot…',
    menu:{tracker:'Open issue in tracker',out:'↗',tabOf:name=>name+"'s tab",previous:'Previous screen',status:{working:'working',blocked:'waiting',idle:'idle',done:'idle'}},
    // The confirmation of screen 06, before the approval (decision 71): the words of the mockup.
    // The same box for the changes approved after the approval (decision 81): what is approved, ticket by ticket and part
    // by part, then the frozen copy. Not in the mockup: worded by Codex, chosen by the user (decision 87).
    reconfirm:{title:'Approve these changes?',go:'Approve these changes',never:'no further development, review or merge',settings:values=>'development settings: '+values,
      // Decision 85: a ticket removed whose dev still runs; the pointer of the box to the details, which Cancel returns to.
      stopsAfter:'Its dev will stop after this turn. Its work will stay on its branch, without review or merge.',detailsLabel:'Details',details:'Choose Cancel to review the full before and after.',frozenText:'the updated plan and these changes, dated today',levels:{léger:'Light',light:'Light',standard:'Standard',fort:'Heavy',heavy:'Heavy'},effort:e=>e+' effort'},
    confirm:{title:'Approve the plan and start the devs?',starts:'What starts',frozen:'Frozen copy',frozenText:'the preparation as you see it, dated today',cancel:'Cancel',go:'Approve and start',
      many:(n,branch,first,dev,tool)=>n+' tickets, one at a time'+(branch?' on '+branch:'')+' · first ticket '+first+' with Dev '+dev+(tool?' · '+tool:''),one:(branch,dev,tool)=>'1 ticket'+(branch?' on '+branch:'')+', with Dev '+dev+(tool?' · '+tool:'')},
    band:{breaking:'The Lead is breaking the issue down',written:n=>counted('ticket','tickets')(n)+' written',nothingToDo:'nothing for you to do',leadIs:{none:'The Lead is not running',idle:'The Lead is idle',blocked:'The Lead is waiting'},
      leadWaits:(q,s=0)=>'The Lead is waiting on you: '+[q?counted('question','questions')(q):'',s?counted('suggestion','suggestions')(s):''].filter(Boolean).join(' and '),approveAfter:'You can approve the plan right after.',answer:'Answer',decide:'Decide',choose:'Choose',
      planReady:n=>'The plan is ready: '+counted('ticket','tickets')(n),noQuestion:'No open question',firstTicket:(id,total,dev=1)=>(total===1?'':'first ticket ')+id+' with Dev '+dev,approve:'Approve and start the dev',approving:'Starting…',
      envFailed:'The plan is ready, but the test server does not start',envHeld:'Starting is held until the environment is ready',seeCheck:'See the check',approveDevs:'Approve and start the devs',
      starting:'Starting the dev…',startingDevs:'Starting the devs…',devStarting:(dev=1)=>'Dev '+dev+' is starting',checkingLaunch:'Checking the launch…',launchNotConfirmed:'The launch is not confirmed. Nothing for you to do.',
      onTrack:(id,state,rounds)=>'On track: '+id+' '+(state==='fix'?(rounds>1?'is being fixed after review '+rounds:'is being fixed after the first review'):state==='review'?'in review':'in dev'),onTrackIdle:'Between tickets',
      accepted:(a,n)=>a+' of '+n+' accepted',nothingWaiting:'nothing is waiting on you',
      blocked:(id,span='')=>id?'Blocked: '+id+' stopped'+(span?' for '+span:''):'Blocked',migrationFails:migration=>'Migration '+migration+' fails locally',leadOnIt:'the Lead is on it',seeBlocking:"See what's blocking",
      // The pause (screens 08 and 11; N02 of the final list while the agent at work finishes its turn). « Pausing » alone, when no agent is known to be at work, is the text of Codex (decision 110).
      pause:'Pause',resume:'Resume',paused:id=>id?'Paused · '+id+' will resume where it stopped':'Paused',nothingRunning:'nothing is running',pausing:agent=>agent?'Pausing · '+agent+' is finishing its turn':'Pausing',noNewWork:'No new work will start after this turn.',
      // What « Pausing » waits for when it is not an agent seen at work, and the alert when that lasts (M11 review 1): texts of Codex, decision 110.
      pauseWaits:list=>'Waiting for '+list.join(', '),pauseLong:'Pause unconfirmed for 5 min. Check the agents.',
      pauseWho:{dev:id=>'the dev'+(id?' for '+id:''),reviewer:id=>'the reviewer'+(id?' for '+id:''),qa:()=>'the QA agent',agents:()=>'the agents'},
      pauseWhy:{unknown:'status unknown','not-seen':'launch not confirmed',foreign:'unexpected terminal',unreadable:'status unavailable'},
      question:(id,from)=>'Waiting on you: a question'+(from?' from '+from:'')+(id?' on '+id:''),waitsAnswer:id=>id+' waits for your answer',waitsVerdict:id=>id+' waits for your verdict',waitsChoice:id=>id+' waits for your choice',
      // The other requests (screens 18 to 20, and the two of decision 41 worded in the final list, N07 and N08). « suggestion » in Develop is composed here: provisional.
      verdict:'Waiting on you: a review verdict to decide',overnight:(accepted,waiting)=>'Overnight: '+counted('ticket','tickets')(accepted)+' accepted · '+(waiting===1?'1 decision is':waiting+' decisions are')+' waiting on you',
      // M14, decision 106 (E3): the same, after an absence that does not cover the night; at the first visit (no visit
      // before), from the start of the mission. Texts of Codex, decision 110.
      sinceVisit:(accepted,waiting)=>'Since your last visit: '+counted('ticket','tickets')(accepted)+' accepted · '+(waiting===1?'1 decision is':waiting+' decisions are')+' waiting on you',
      firstVisit:(accepted,waiting)=>'So far: '+counted('ticket','tickets')(accepted)+' accepted · '+(waiting===1?'1 decision is':waiting+' decisions are')+' waiting on you',
      copy:what=>'Waiting on you: choose the copy'+(what?' for '+what:''),mockup:id=>'Waiting on you: choose a mockup'+(id?' for '+id:''),
      permission:(id,from)=>'Waiting on you: a permission request'+(from?' from '+from:'')+(id?' on '+id:''),suggestion:(id,from)=>'Waiting on you: a suggestion'+(from?' from '+from:'')+(id?' on '+id:''),
      allAccepted:n=>n===1?'The ticket is accepted · QA is next':'All '+n+' tickets are accepted · QA is starting',qaNotNeeded:'QA not needed · single-ticket plan',toValidate:'moving to Validate, with no way back to Develop',
      waiting:n=>'Decisions waiting on you: '+n,qaRunning:'QA is running',nothingYet:'nothing for you to do yet',
      yourTurn:n=>'Your turn: '+counted('point','points')(n)+' to test',pointsDone:(a,n)=>a+' of '+n+' checked',startTesting:'Start testing',continueTesting:'Continue testing',allJudged:'All points checked',closed:'Closed',
      // The end of a mission (wording by Codex, 2026-11-17).
      close:'Close mission',closeAsked:'Closure requested · the Lead will check, then close',
      // Once closed by the one approval (provisional words of « pre-close », until the wording pass by Codex).
      mergedInto:base=>'Closed · merged into '+base,closedDet:'Ticket closed in the tracker',reopen:'Reopen…',openPr:'Open PR',openPrs:'Open PRs'},
    // The closure box (screen 06) and the reopening box (screen 08): the words of the mockup, provisional until Codex.
    closeBox:{title:id=>'Close '+id+'?',checkTitle:'Before closing',checking:'Checking…',unknown:"Couldn't load the checklist. Open this dialog again to retry.",
      rows:{qa:()=>'QA finished',judgments:()=>'Every point checked',problems:()=>'Problems and tickets resolved',branch:()=>'Mission branch',checks:()=>'PR checks',
        repositories:()=>'Repositories',step:()=>'In Validate',push:()=>'Push',pr:()=>'Pull request',merge:()=>'Merge'},
      triggers:'Your approval allows',triggersText:base=>'Push the branch, create a PR if needed, then merge it into '+base+' with a merge commit. The Lead then closes the ticket and the mission. If GitHub checks are not registered yet or the target branch changes, review the checklist and approve again before merging.',cancel:'Cancel',go:'Approve and close'},
    reopenBox:{title:id=>'Reopen '+id+'?',text:'The mission returns to Validate, never to Develop. Give a reason. Reopening does not undo the merge.',hint:'Why reopen it?',cancel:'Cancel',go:'Reopen in Validate'},
    // The page before the closure and once closed: the words of the mockup (Claude Design « pre-close »), provisional until
    // the wording pass by Codex.
    end:{summaryHead:'Summary · what was done',closedHead:'Closed · what was done',noSummary:'No summary from the Lead yet.',
      checkedTitle:'How it was checked',ticketsTitle:'Ticket by ticket',qa:'QA',qaSub:(a,n)=>a+' of '+n+' points passed',signoff:'Your sign-off',
      signoffSub:(a,n,k)=>a+'/'+n+' checked'+(k?' · '+k+(k===1?' problem':' problems'):''),reviews:'Reviews',
      reviewsSub:(n,k)=>n+(n===1?' review':' reviews')+(k?' · '+k+' requested changes':''),problems:'Problems',problemsSub:n=>n+' reported',
      decisions:'Your decisions',decisionsSub:n=>n+(n===1?' answer':' answers'),started:(day,clock)=>'Started '+day+' at '+clock,
      tickets:n=>n+(n===1?' ticket':' tickets'),beforeClosing:'Before closing',leftForYou:'Left for you',ofChecks:(a,n)=>a+' of '+n,
      qaFinished:'QA finished',passed:n=>n+' passed',everyJudged:'Every point checked',byQaAndYou:'by QA and you',problemsHandled:'Problems reported',
      handled:n=>n+' reported',nothingLeft:'No manual steps listed',tokenUsage:'Token usage',soFar:'since Prepare started',final:'since Prepare started',
      tokensIn:'tokens in',tokensOut:'tokens out',perTicket:'average input per ticket',byAgent:'By role',byTicket:'By ticket',
      role:r=>({lead:'Lead',dev:'Devs',reviewer:'Reviewers',qa:'QA agent'})[r]||r},
    // The plan: its head, the line of the tickets, the card of a ticket, the legend (ticket 31). The strings of the mockup.
    plan:{title:'Plan',tickets:counted('ticket','tickets'),oneAtATime:'one at a time on',before:n=>'‹ '+n+' before',after:n=>n+' after ›',hint:'Click a ticket for its details',waitsFor:'waits for',unblocks:'unblocks',kanban:'Kanban'},
    // The Kanban view (screen 09): its columns, and what an empty column says. « The dev waits for the review. » is written by the source of the mockup, on no screen of the final list.
    board:{todo:'To do',dev:'In dev',review:'In review',accepted:'Accepted',next:'Validate',noReview:'No review running. The reviewer steps in when the dev hands over.',devWaits:'The dev waits for the review.',allDone:'All done.'},
    card:{heavy:'Heavy',light:'Light',qa:'QA',qaSub:'one video per flow',signoff:'Sign-off',signoffSub:'what QA cannot judge',reviewEnd:'Review',reviewEndSub:'one review, no QA agent on a single ticket',running:'Running',upcoming:'Upcoming',starting:'Starting',inDev:'In dev',fixing:'Fixing',round:n=>'round '+n,
      inReview:'In review',reviewer:tool=>'Reviewer'+(tool?' · '+tool:''),ofTwo:n=>n+' of 2',accepted:'Accepted',blocked:'Blocked',paused:'Paused',waiting:'Waiting on you',question:'question',merged:'Merged',into:id=>'into '+id,canceled:'Canceled',
      review:(n,marks,rounds)=>'review'+(n?' '+n:'')+' '+marks+(rounds>1?' · '+rounds+' rounds':''),done:n=>'Done · '+n+' passed',yourTurn:n=>'Your turn · '+n+' left',doneAll:'Done',closed:'Closed',
      // The tests of the plan (Claude Design, 2026-11-17): a counter in mono in place of the review trace, the state word alone at the foot.
      passedOf:(a,n)=>a+' / '+n+' passed',checkedOf:(a,n)=>a+' / '+n+' checked',yourTurnWord:'Your turn',
      verdict:'verdict',copyChoice:'copy choice',mockupChoice:'mockup choice',tip:{copy:'copy to write',question:'open question',drift:'drift from the approved plan'}},
    legend:{heavyPrepare:'tests first, two reviews',heavyDevelop:'2 reviews',standard:'no tag: Standard',copyPrepare:'copy to write',copyDevelop:'copy',question:'open question',drift:'drift',accepted:'accepted',changes:'changes requested',yourCall:'your call',reviewing:'reviewing now'},
    // The details of a ticket, in the column on the right. `steps` alone: the time in total (« Steps · 58 min in total »)
    // is not known yet. `none` is for a ticket in the middle that waits for nothing, or unblocks nothing.
    detail:{position:(at,n)=>'Ticket '+at+' of '+n,previous:'Previous ticket',next:'Next ticket',close:'Close',before:'‹',after:'›',shut:'✕',summary:'Summary',timeline:'Timeline',technical:'Technical',criteria:'Tests & criteria',what:'What the ticket does',expected:'Expected result',
      dev:'Dev',reviewer:'Reviewer',waits:'Waits for',unblocks:'Unblocks',delivery:'Delivery',mergedInto:id=>'merged into '+id,first:'nothing, first ticket',last:'nothing, last ticket',none:'nothing',toBeSet:'to be set',
      heavy:'Heavy · tests first, two reviews',standard:'Standard',todo:'To do',effort:level=>level+' effort',reviews:n=>n===2?'two reviews':'one review',
      steps:'Steps',stepsRunning:'Steps · in progress',inDev:who=>'In dev · '+who,running:'running',fixing:who=>'Fixing · '+who,round:n=>'round '+n,roundRunning:n=>'round '+n+', running',
      review:n=>'Review'+(n?' '+n:''),reviewAccepted:n=>'Review'+(n?' '+n:'')+' · accepted',reviewChanges:n=>'Review'+(n?' '+n:'')+' · changes requested',remarkCount:n=>n+(n>1?' remarks':' remark'),reviewRunning:(n,two)=>'Review'+(two?' '+n+' of 2':'')+' · running',reading:'the reviewer is reading',
      upNext:'up next',accepted:'Accepted',totalTime:'total time',stepsTotal:t=>'Steps · '+t+' in total',decided:answer=>'you decided: '+answer,remarks:'Remarks from the "changes requested" review',commits:'Commits',testsRun:'Tests run',technicalDetails:'Technical details',testsPlanned:'Tests planned by the dev',acceptance:'Acceptance criteria of the ticket',notStarted:'Not started yet. This ticket is waiting for its turn.',fullOpen:'▸',fullShut:'▾'},
    // The band under the line (one dev): what happens now, in large. In Prepare the approach of the Lead and its phases;
    // in Develop the ticket in hand; a single ticket has its path; all accepted, the QA that starts.
    strip:{leadWorking:'The Lead is working',approach:"Lead's approach",approachLink:"Lead's approach ›",phases:'Phases, in order',coming:'coming',execution:'Execution',oneAtATime:'one at a time',heavyTickets:'Heavy tickets',migrations:'Migrations',readApproach:'Read the approach ›',
      current:(id,at,n)=>'Current ticket · '+id+' · '+at+' of '+n,theTicket:id=>'The ticket · '+id,expected:text=>'Expected: '+text,steps:'Steps · time per step',reviews:'Reviews',one:'one',two:'two',tokensIn:'Tokens in',tokensOut:'Tokens out',open:'Open the ticket ›',yourCall:n=>'Review'+(n?' '+n:'')+' · your call',leadAsks:n=>'Review'+(n?' '+n:'')+' · the Lead asks you a question',
      path:'Path',oneReview:'One review',yourCheck:'Your check',points:counted('point','points'),close:'Close',migration:'Migration',copy:'Copy to write',none:'none',qaAgent:'QA agent',notNeeded:'not needed',
      qa:'QA · automatic, recorded',qaStarting:'QA is starting',qaText:'You only test what QA cannot judge: look, feel, and what it could not play. Everything else stays one click away.',flows:n=>n+' flows',passed:'Passed',forYou:'For you',videos:'Videos',yourTime:'Your time',about:min=>'about '+min+' min',problems:'Problems'},
    // The three blocks at the bottom, in Prepare and in Develop: what was decided and what waits, the coverage of the
    // issue or the drift from the plan approved, and what to plan for.
    blocks:{decisions:'Your decisions',waiting:'Waiting on you',nothing:'Nothing is waiting on you',answer:'Answer',asked:{question:'question',suggestion:'suggestion',verdict:'verdict',copy:'copy choice',mockup:'mockup choice',permission:'permission request'},askedBy:(what,who)=>what+' from '+who,
      coverage:'Issue coverage',covered:(a,n)=>a+' of '+n,readIssue:'Read the issue ›',noTicketYet:'no ticket yet',notCovered:'not covered',leadAsks:'the Lead asks you the question',postponed:day=>'postponed by you'+(day?' on '+day:'')+' · follow-up ticket',
      drift:'Drift from approved plan',noDrift:'No drift from the approved plan',changed:id=>id+' changed',
      // Decision 87: a ticket or a part of the plan by what happened to it.
      added:id=>id+' added',removed:id=>id+' removed',
      // M7: what changed and when, as the engine gives it (not in the mockup): provisional, to be written by Codex.
      // M7 review: a change given with what it was and what it is says both (« model: sonnet 5.5 → opus 5.5 », as the
      // mockup's « child windows: 100 → 50 »); a part of the plan is named in the words of the page.
      // Decision 84: every change said whole, the parts of one joined by « ; » (a list keeps its commas): a field by what
      // it was and is, a list of entries by those added, removed and changed, a field given alone by its name, a part
      // added or removed by what it holds.
      driftAdded:'added after approval',driftRemoved:'removed from the plan',driftHolds:(head,what)=>what?head+': '+what:head,
      change:(name,from,to)=>(name?name+': ':'')+from+' → '+to,
      // Decision 85: a list whose order moved says « order changed »; a list with nothing said gives nothing, never « items: ».
      entries:(name,added,removed,changed,moved=false)=>{const said=[added.length?added.join(', ')+' added':'',removed.length?removed.join(', ')+' removed':'',changed.length?changed.join(', ')+' changed':'',moved?'order changed':''].filter(Boolean).join('; ');return said?(name?name+': ':'')+said:'';},
      fieldsChanged:names=>names.join(', ')+' changed',somethingChanged:'details changed',summaryChanged:'summary changed',joinChanges:list=>list.join('; '),
      fieldNames:{agent:'tool',deps:'dependencies',rank:'position',dev:'tool',difficulty:'level'},partChanged:name=>name+' changed',itemAt:n=>'Item '+n,
      parts:{approach:"Lead's approach",phases:'Phases',migrations:'Migrations',requests:'Issue coverage',simple:'Execution',points:'Sign-off points','toPlan.manual':'Your manual steps','toPlan.risks':'Risks','toPlan.copy':'Copy to write','toPlan.accounts':'Test accounts',branch:'Branch'},driftWhen:(what,when)=>what+(when?' · '+when:''),frozen:'Frozen copy',approvedOn:when=>'plan approved on '+when,requests:(a,n,postponed)=>a+' of '+n+(n>1?' requests':' request')+(postponed?' · '+postponed+' postponed':''),
      toPlan:'To plan for',environment:'Environment',envReady:'server, accounts, migrations: ready',startHeld:what=>what+' · start held',manual:'Your manual steps',noMigration:'no migration',risks:'Risks',noneFlagged:'none flagged',copy:'Copy to write',none:'none',copyOf:(section,id)=>section+' · '+id,copyChosen:(section,variant)=>section+' · variant '+variant+' chosen',
      mockups:'Mockups',noMockup:'none for this issue',accounts:'Test accounts',go:'›'},
    // What a row of the blocks, or a link of the band, opens in the column on the right (decision 40): the approach of the
    // Lead, the frozen copy of the plan, the issue, a decision taken, a request of the issue, a list to plan for.
    sheet:{close:'Close',shut:'✕',settled:kind=>kind+' · settled',kinds:{question:'Question',suggestion:'Suggestion',copy:'Copy',dev:'Question from the dev',lead:'Question from the Lead',verdict:'Verdict'},yourAnswer:when=>'Your answer'+(when?' · '+when:''),whatChanged:'What it changed',history:'History',
      request:'Request from the issue',coveredBy:n=>'covered by '+counted('ticket','tickets')(n),openQuestion:'open question',postponed:'not covered, postponed',cover:'Tickets that cover it',noTicket:'No ticket',outlined:'The tickets that cover it are outlined in the plan.',
      mode:'Execution mode',oneBranch:branch=>'One ticket at a time'+(branch?' on branch '+branch:'')+'. Nothing runs in parallel.',tickets:'Tickets',single:'a single ticket',devs:'Devs',devWith:(name,tool)=>name+(tool?' ('+tool+')':''),heavyOf:n=>n+', tests first and two reviews',thenList:list=>list.join(', then '),
      frozenTitle:when=>'Plan approved on '+when,frozenText:'Your approval is saved. This view shows its summary. Later changes are listed under “Drift from approved plan”.',inCopy:'In the copy',ticketsOn:(count,branch)=>count+', one at a time'+(branch?' on '+branch:''),questions:'Questions',allSettled:'all settled',yourSteps:'Your steps',
      issue:id=>'The issue · '+id,openTracker:'Open the issue in tracker ›',goal:'Goal',forWhom:'For whom',inScope:'In scope',outScope:'Out of scope',criteria:'Acceptance criteria',withPilot:'Decisions taken with Pilot',
      manualTitle:'Your manual steps, outside the app',manualIntro:'In this order, once the tickets are merged.',manualNone:'No migration: only the deploy will be yours, after closing.',risksIntro:'What can go wrong, and what is planned for it.',risksNone:'No risk flagged for this ticket.',
      copyIntro:'The dev will propose variants during the ticket; you choose from the banner.',copyChosen:'The copy has been chosen.',copyNone:'No copy to write.',chosen:variant=>'chosen: variant '+variant,mockupsNone:'No mockup for this issue: it creates no new screen.',
      accountsTitle:'Test accounts for your sign-off test',accountsIntro:'Checked by the environment check.',accountsNote:'No password here: the QA assistant opens the app with the right account.',
      envCheck:'Environment check',envReady:'Everything is ready to start',envIntro:'Checked by the tool.',envHeld:'Starting is held until this is cleared.',envAgain:'Run the check again',checks:{server:'The server starts',accounts:'The test accounts exist',migrations:'The migrations pass locally'},
      coveredTitle:(a,n)=>a+' of '+n+(n>1?' requests':' request')+' covered',unchanged:'Unchanged since approval.',driftTitle:n=>counted('ticket','tickets')(n)+' changed since approval',driftIntro:day=>'Changes since your approval'+(day?' on '+day:'')+'.',driftNote:'A ticket added or postponed would show up here the same way, and on its card.',
      // M7, not in the mockup: worded by Codex, chosen by the user (decision 87).
      driftItem:(id,what)=>id+': '+what,driftSeenOn:when=>when?'Detected on '+when:'',reapprove:'Approve these changes',changesTitle:n=>counted('change','changes')(n)+' since approval',
      // Decision 85: the before and the after of each change, whole (words of decision 87).
      beforeAfter:'Before and after',before:'before',after:'after',added:'added',removed:'removed',orderBefore:'order before',orderAfter:'order after',nothing:'—',itsDev:'Dev',devRunning:'Still running. Will stop after this turn. Its work will stay on its branch, without review or merge.',
      // M7 review, decision 82: the approvals of before, readable from the sheet of the frozen copy.
      approvedChanges:'Approved changes',earlier:'Earlier approvals',earlierRow:(when,kind)=>(kind==='reapproval'?'Changes approved on ':'Plan approved on ')+when+' ›',replaced:when=>'Replaced by the approval on '+when+'.',
      // The details of what blocks a ticket (screen 13). « Nothing to do for now. » alone, when the engine names no last try, and « {ticket} has been stopped » without its time are the sentences of the mockup cut short: provisional.
      blocked:'Blocked ticket',stoppedFor:(id,span='')=>id+' has been stopped'+(span?' for '+span:''),blockedInDev:'Blocked in dev',since:clock=>'since '+clock,why:'Why',tried:'What is being tried',sameFailure:clock=>[clock,'same failure'].filter(Boolean).join(' · '),tryRunning:clock=>[clock,'running'].filter(Boolean).join(' · '),lastTry:'last try before asking you',
      forYou:'For you',nothingForNow:nth=>'Nothing to do for now.'+(nth?' If the '+nth+' try fails, the Lead will ask you here.':''),nth:['first','second','third','fourth','fifth'],toPilot:'To stop or reorder, talk to Pilot.',
      justNow:'just now',thisMorning:'this morning',monthDay:(month,day)=>month+' '+day,dayAt:(day,clock)=>day+' at '+clock,dayClock:(day,clock)=>day+', '+clock},
    // A request answered in place, in the column on the right (screens 03, 15, 17, 19, 20; a permission and a choice of
    // mockup after N07 and N08 of the final list). The strings of the mockup; `previous` and `next` name the two arrows
    // for a reader of the screen, `variants` counts in words up to four: the words the review of the screen kept.
    answer:{question:who=>'Question from '+who+' · yours to answer',suggestion:who=>'Suggestion from '+who+' · yours to answer',verdict:'Review verdict · your call',copy:'Copy to choose · yours to answer',permission:who=>'Permission request from '+who+' · yours to answer',mockup:'Mockup to choose · yours to answer',
      askedAt:clock=>'Asked at '+clock+'.',madeAt:clock=>'Made at '+clock+'.',recommended:'recommended',choose:'Choose',differently:'Answer differently…',ticket:'Ticket concerned',tickets:'Tickets concerned',previous:'Previous request',next:'Next request',
      variant:letter=>'Variant '+letter,saidVariant:letter=>'variant '+letter,variants:(n,id)=>(['','','Two','Three','Four'][n]||n)+' variants proposed'+(id?' during '+id+'. The ticket waits for your choice.':'.'),
      theReviewer:'the reviewer',theQa:'the QA agent',
      foot:{prepare:'Your answer is saved on the ticket; the Lead updates the plan.',dev:'The ticket waits for your answer; the dev resumes right after.',drift:'The ticket waits for your answer. A yes is recorded as drift from the approved plan.',verdict:'The rest of the plan waits for your answer: the next ticket only starts after.',copy:'For another wording, talk to Pilot.',mockup:'For another mockup, talk to Pilot.'}},
    // M6 (b), provisional, to be worded by Codex: the environment check as the engine runs it (decisions 89, 93 and 95):
    // its three steps (database, migrations, accounts; no server step in v1), its causes, and the states the mockup does
    // not draw (not configured, never checked, stale, unreadable). « environment ready » is the word of screen 04.
    environment:{bandReady:'environment ready',ready:names=>names.join(', ')+': ready',names:{server:'server',database:'database',migrations:'migrations',accounts:'accounts'},
      notConfigured:'not checked · no environment declared',notConfiguredTitle:'No environment declared',notConfiguredIntro:'This project declares no environment, so nothing is checked. Starting is not held.',
      checks:{database:'The local database is recognised',migrations:'No migration is pending',accounts:'The test accounts exist'},
      causes:{DB_ABSENT:'the local database is not running',DB_NOT_LOCAL:'the database is not proven local',DB_UNKNOWN:'the database is not the one enrolled',DB_AUTH_UNSUPPORTED:'the database asks for a password',
        MIGRATIONS_UNREADABLE:'the migrations cannot be read',DB_AHEAD:'the database is ahead of the migrations',CONFIG_INVALID:'the environment settings are invalid',INCOMPLETE:'not every check is declared',
        CHECKING:'checking…',INTERRUPTED:'the last check was interrupted: run it again',NOT_CHECKED:'not checked yet',STALE:'the settings changed since the last check',UNREADABLE:'the last check cannot be read'},
      notEnrolled:'the database is not enrolled yet',enrollAgain:'the database must be enrolled again',pending:n=>n===1?'1 migration to apply by hand':n+' migrations to apply by hand',
      missing:names=>'test account missing: '+names.join(', '),failed:'the check failed',applied:n=>n+' applied, none pending',found:names=>names.join(', '),
      notRun:'not run: an earlier check failed',notDeclared:'not declared',lastAt:when=>'Last checked '+when+'.',interrupted:'The check before it was interrupted.',checking:'Checking…',checkingTitle:'A check is running',checkingIntro:'Starting is held until it ends. The result of before is not shown.'},
    // « Since yesterday, 7:10 pm » (screen 18) and « Since your last visit » are the two titles the mockup writes; « So far »,
    // at the first visit, and the word of a recap that cannot be read are texts of Codex (decision 110). With two
    // devs (screen 41) the column tells the steps of the ticket in hand and the tokens of the issue, agent by agent.
    side:{since:{yesterday:clock=>'Since yesterday, '+clock,lastVisit:'Since your last visit',firstVisit:'So far',verdict:id=>id+' · verdict to decide',accepted:id=>id+' accepted',reviews:n=>(['','one','two'][n]||n)+(n===1?' review':' reviews'),fixes:n=>(['','one','two'][n]||n)+(n===1?' fixing round':' fixing rounds'),leftToYou:'the reviewer leaves it to you',unavailable:"Couldn't refresh this recap. Nothing new is marked as seen."},title:'Right now',who:"Who's working",current:id=>'Current ticket · '+id+' · time per step',tokens:'Token usage · this issue',tokensIn:'in',tokensOut:'out',tokensNote:'since Prepare started · updates live',reviewers:'Reviewers',devsOf:tool=>'Devs · '+tool,activity:'Recent activity',noActivity:'No activity yet.',refs:'References',foot:'Click a ticket or a row: its details open here.',openTab:'Open tab ›'},
    who:{lead:'Lead',theLead:'the Lead',dev:n=>'Dev '+n,reviewer:'Reviewer',qa:'QA agent',noLead:'not running',breaking:'breaking the issue down',waitingAnswer:'waiting for your answer',planReady:'idle, plan ready',idle:'idle',waiting:'waiting',working:'working',
      paused:'paused',stopped:'stopped, waiting for the Lead',lookingForFix:'looking for a fix',inDev:'in dev',inDevFor:span=>'in dev for '+span,fixing:n=>'fixing, round '+n,asks:'asks you a question',inReview:id=>id+' is in review',next:id=>'next ticket: '+id,doneAll:'done with its tickets',
      reviewN:n=>'review '+n,qaPlaying:'playing flows',qaDone:'done'},
    // The activity, from the reports of the agents: a review passed while another is still to come is said by its number;
    // the verdict of the QA is worded here, the lists of the other screens keep theirs.
    story:{delivered:(id,who)=>id+' delivered by '+who,accepted:id=>id+' accepted',changes:(n,id)=>'Review '+n+' of '+id+': changes requested',passed:(n,id)=>'Review '+n+' of '+id+': passed',qaPassed:'QA passed',qaProblems:'QA found problems'},
    refs:{issue:'Issue',inTracker:id=>id+' in tracker ›',branch:'Branch',from:base=>'from '+base,repo:'Repo',code:'Code'},
    // Ticket M13, the tokens (decision 106): a count is an estimate, « Unknown » when the engine cannot read it, never 0.
    // « ≈ » and « Unknown » are the texts of Codex (decision 110): a total with one count unknown is « Unknown »; « Token usage · this
    // ticket », « dev … in, review … in » are the words of the mockup (screen 10).
    tokens:{about:n=>'≈ '+n,unknown:'Unknown',ticket:'Token usage · this ticket',total:(into,out)=>into+' in · '+out+' out',dev:n=>'dev '+n+' in',review:n=>'review '+n+' in'}},
  months:['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
  age:{now:'<1m',minutes:'m',hours:'h',days:'d'},
  feed:{snapshot:(clock,message)=>'Couldn’t refresh agent status.'+(clock?' Last update: '+clock+'.':'')+' '+message,error:(view,message)=>'Couldn’t refresh '+view+': '+message},
  errors:{install:'FABRIQUE_CONSOLE isn’t set up. Run npm run install:console from the repository.',unreadable:'FABRIQUE_CONSOLE returned an unreadable response. Check the local backend.',tracker:'Ticket connection unavailable. Run npm run tickets:login from the repository.',failed:'This action couldn’t be completed.'},
};
