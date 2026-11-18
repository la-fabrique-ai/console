// Holds the lane of a mission until its stdin closes: the other process of the test of the real lock.
import { createDevLane } from '../../src/dev-lane.mjs';
const [root,mission]=process.argv.slice(2);
const lane=createDevLane({root,kernel:null,load:null,change:null});
await lane.withLane(mission,async()=>{
  process.stdout.write('held\n');
  await new Promise(done=>{process.stdin.on('end',done);process.stdin.on('close',done);process.stdin.resume();});
},{patient:false});
