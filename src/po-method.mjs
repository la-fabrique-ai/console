// A legacy plan may mean the old second step. Keep it at the new first step:
// persisted phase names are never evidence that the user approved a gate.
export const PO_STEPS=Object.freeze(['plan','split','dev','check','close']);
export const PO_GATES=Object.freeze({plan:'split',split:'dev',launch:'dev',check:'close'});
export const poStep=value=>PO_STEPS.includes(value)?value:'plan';
const GATE_FROM={plan:['plan'],split:['plan','split'],launch:['plan','split','dev'],check:['check']};
// A delivered answer may concern an older proposal: it must not rewind or re-close the work.
export const poGateNext=(gate,step)=>typeof gate==='string'&&Object.hasOwn(GATE_FROM,gate)&&GATE_FROM[gate].includes(step)?PO_GATES[gate]:null;
