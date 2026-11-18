#!/usr/bin/env node
import {login,MCP_ENDPOINT} from './linear-mcp.mjs';
import { options } from '../../../scripts/install.mjs';
export async function loginMain() {
  const args=options();
  if(args.help){console.log('npm run tickets:login — authorize read-only Linear MCP access; OAuth secrets are stored in macOS Keychain.');return;}
  console.error('Opening Linear authorization in your browser. Credentials remain in the dedicated macOS Keychain item.');
  const result=await login({root:args.state,endpoint:MCP_ENDPOINT});
  console.log(JSON.stringify(result,null,2));
}
