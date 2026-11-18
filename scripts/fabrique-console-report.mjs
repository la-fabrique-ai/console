#!/usr/bin/env node
import {writeDevReport} from '../src/dev-report.mjs';
import {AppError} from '../src/common.mjs';
import {noteAgentSession} from '../src/traces.mjs';
import {realStateRoot} from '../src/trial.mjs';
// The agent that runs this command says its session to its trace first (M12), whatever becomes of its report.
await noteAgentSession({env:process.env,root:process.env.FABRIQUE_CONSOLE_HOME??realStateRoot()});
let result;
try{result={ok:true,...await writeDevReport(process.argv.slice(2))};}
catch(error){result={ok:false,error:{code:error instanceof AppError?error.code:'INTERNAL_ERROR',message:error instanceof AppError?error.message:'Le compte rendu n’a pas pu être enregistré.'}};process.exitCode=1;}
process.stdout.write(JSON.stringify(result)+'\n');
