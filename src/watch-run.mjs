#!/usr/bin/env node
// The resident watcher process: started detached by the watch-start action, it runs the loop of src/watch.mjs on
// the backend of this repository until the window lets its lease lapse, asks it to stop, or another watcher owns
// the lock. It prints nothing, and exits as soon as the loop ends: a read still in flight is abandoned.
import { createBackend } from './backend.mjs';
import { createWatcher } from './watch.mjs';

const backend=createBackend();
const watcher=createWatcher({root:backend.root,dispatch:backend.dispatch,loadConfig:backend.loadConfig});
try {await watcher.run();process.exit(0);}
// Another watcher runs: nothing to do. A lock busy for too long is a failure: the window starts one again later.
catch(error) {process.exit(error.code==='WATCHER_RUNNING'?0:1);}
