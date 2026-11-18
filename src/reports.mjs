import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { clean, privateDir, withLock } from './common.mjs';
import { projectForSession } from './config.mjs';
import { captureCode } from './proof-code.mjs';

export function createReports({root,loadState,getSession,inspectGit,qaFor,loadConfig}) {
  async function propose(input) {
    return withLock(root,async()=>{
      const state=await loadState(),session=getSession(state,input.sessionId),evidence=await inspectGit(session),qa=await qaFor(session);
      const source=session.review?state.sessions.find(s=>s.id===session.reviewSource?.sessionId):session;
      const current=source?await captureCode(source.worktree):null;
      const report={baseSha:(session.review?source?.baseCommit:session.baseCommit)??null,
        headSha:session.review?session.reviewSource?.head??null:current?.sha??null,currentSha:current?.sha??null,
        sourceSessionId:source?.id??null,status:!current?.sha||session.review&&!session.reviewSource?.head?'inconnu':session.review&&session.reviewSource.head!==current.sha?'périmé':'current'};
      const proposal={issueId:session.issueId,comment:`Local ${session.review?'review':'implementation'} report for ${session.identifier}. Branch: ${session.branch}. QA: ${qa?.status??'not run'}.`};
      const content=clean(`# ${session.identifier}: ${session.title}\n\nLocal report only. No Tracker mutation or remote publication performed.\n\nBranch: ${session.branch}\nWorktree: ${session.worktree}\nAgent: ${session.tool}${session.review?' (independent review)':''}\n\n## Commit binding\n\nBase commit: ${report.baseSha??'unknown'}\nReviewed commit: ${report.headSha??'unknown'}\nCurrent source commit: ${report.currentSha??'unknown'}\nCommit binding: ${report.status}\n\n## Git status\n\n\`\`\`text\n${evidence.status||'(clean)'}\n\`\`\`\n\n## Change summary\n\n\`\`\`text\n${evidence.stat||'(no tracked diff)'}\n${evidence.commits}\n\`\`\`\n\n## QA evidence\n\n${qa?`${qa.profile}: ${qa.status}; exit ${qa.exitCode??'unknown'}; ${qa.finishedAt??'still running'}`:'No QA run recorded.'}\n\n## Proposed Tracker comment (requires exact confirmation)\n\n${proposal.comment}\n`);
      const project=await projectForSession(await loadConfig(),session);
      const pr=clean({title:`${session.identifier}: ${session.title}`.slice(0,256),base:session.mainBranch??project?.mainBranch??null,head:session.branch,body:`${session.issueUrl?`Issue: ${session.issueUrl}\n\n`:''}## Local change evidence\n\n\`\`\`text\n${evidence.status||'(clean)'}\n${evidence.stat||'(no tracked diff)'}\n${evidence.commits}\n\`\`\`\n\n## Validation\n\n${qa?`${qa.profile}: ${qa.status}; exit ${qa.exitCode??'unknown'}; ${qa.finishedAt??'no completed result'}`:'No QA run recorded.'}\n\nPrepared locally for review. No remote publication performed.\n`});
      await privateDir(join(root,'reports'));const path=join(root,'reports',`${session.id}.md`);await writeFile(path,content,{mode:0o600});
      return {path,content,proposal,pr,report};
    });
  }
  return {propose};
}
