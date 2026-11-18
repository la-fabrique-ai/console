import { fail, object } from './common.mjs';

export const DEFAULT_BUDGETS=Object.freeze({lead:800000,dev:750000,reviewer:400000,qa:1000000});
export function validateBudgets(value) {
  object(value,'INVALID_CONFIG');
  for(const [role,amount] of Object.entries(value))if(!Object.hasOwn(DEFAULT_BUDGETS,role)||!Number.isSafeInteger(amount)||amount<=0||amount>Math.floor(Number.MAX_SAFE_INTEGER/2))
    fail('INVALID_CONFIG','Budgets require a known role and a positive integer token allowance.');
  return {...value};
}
export function budgetsFor(config,project) {
  return {...DEFAULT_BUDGETS,...config.budgets,...config.projects?.find(p=>p.key===project)?.budgets};
}
