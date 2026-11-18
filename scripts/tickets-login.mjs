#!/usr/bin/env node
import {ticketLoginMain as main} from '../integrations/tickets/factory.mjs';
import {isMain} from './install.mjs';
export {main};
if(isMain(import.meta.url))try{await main();}catch(error){console.error(error.code?`${error.code}: ${error.message}`:'Tracker OAuth login failed.');process.exitCode=1;}
