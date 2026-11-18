// Repository selection must not inherit another checkout, index or Git config overlay.
export function gitEnvironment(source=process.env) {
  return {...Object.fromEntries(Object.entries(source).filter(([key])=>!key.startsWith('GIT_'))),GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0'};
}
