// The closed list of causes of the environment check (M6): a refusal gives one of them, a detail key and numbers,
// never the text of a program. INTERRUPTED names a check killed before the current one (`previous`).
//
// The preparation of the folder of the deferred server step (decision 95) and its three causes are parked on the
// local branch wip/m6-server-folder (from 7a185f7), to be reviewed again when the step comes back before M16.
export const CAUSES=Object.freeze(['DB_ABSENT','DB_NOT_LOCAL','DB_UNKNOWN','DB_AUTH_UNSUPPORTED','MIGRATIONS_PENDING','MIGRATIONS_UNREADABLE','DB_AHEAD','ACCOUNT_MISSING','INTERRUPTED']);

export class Stop extends Error {
  constructor(cause,detail=null,extra={}) {super(cause);if(!CAUSES.includes(cause))throw new Error('Unknown cause.');this.cause=cause;this.detail=detail;this.extra=extra;}
}
export const stop=(cause,detail,extra)=>{throw new Stop(cause,detail,extra);};
