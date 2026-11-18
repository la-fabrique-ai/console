#!/usr/bin/env node
import { createBackend } from './backend.mjs';
import { AppError, clean, object } from './common.mjs';
import { extensions } from './extensions.mjs';
import { trialOf, assertConfined, realStateRoot } from './trial.mjs';
import { noteAgentSession } from './traces.mjs';

let result;
try {
  // A trial folder in real mode, or the real folder in trial mode, is refused before any action, extensions included;
  // a trial runs only in the sandbox of the trial launcher, checked by probes before any action.
  const trial=trialOf({root:process.env.FABRIQUE_CONSOLE_HOME??realStateRoot()});
  if(trial)assertConfined(trial);
  // A command run by a Codex agent the tool started says its session to its trace (M12); it never fails the command.
  await noteAgentSession({env:process.env,root:process.env.FABRIQUE_CONSOLE_HOME??realStateRoot()});
  if(process.argv.length>4||!process.argv[2])throw new AppError('INVALID_ARGUMENT','Usage: node src/cli.mjs <action> <JSON object>');
  let input;try {input=JSON.parse(process.argv[3]??'{}');}catch{throw new AppError('INVALID_ARGUMENT','Arguments must be a valid JSON object.');}
  const extension=Object.hasOwn(extensions,process.argv[2])?extensions[process.argv[2]]:null;
  result={ok:true,data:clean(extension?await extension(object(input)):await createBackend().dispatch(process.argv[2],input))};
}catch(error) {
  result={ok:false,error:{code:error instanceof AppError?error.code:'INTERNAL_ERROR',message:error instanceof AppError?error.message:'The local operation failed. Check the configuration and try again.',...(error instanceof AppError&&typeof error.cause==='string'?{cause:clean(error.cause)}:{})}};
  process.exitCode=1;
}
process.stdout.write(JSON.stringify(result)+'\n',()=>{
  // A read request that exceeded its deadline must not keep the CLI alive via SDK sockets.
  if(result.error?.code==='TICKET_TIMEOUT')process.exit(1);
});
