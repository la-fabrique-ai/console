export function configV2() {
  return {
    version: 2,
    tracker: { transport: 'mcp', endpoint: 'https://mcp.linear.app/mcp/readonly' },
    worktreesRoot: '/example/worktrees',
    wip: { dev: 2, review: 3, maxParallelDevs: 2 },
    launch: { confirm: 'each' },
    projects: [{
      key: 'example', name: 'Example', teamId: 'team-fixture', projectId: 'project-fixture',
      kind: 'produit', color: '#2e8b57', preferredAgent: 'codex', machine: null,
      wip: { dev: 1, review: 2 },
      repos: [{
        key: 'app', path: '/example/app', labels: ['web'], aliases: ['packages', 'infra'],
        mainBranch: 'main', verification: 'required',
        tests: { quick: { argv: ['pnpm', 'typecheck'], timeoutMs: 120000, terminal: false } },
      }, {
        key: 'specs', path: '/example/specs', labels: ['specs'], aliases: [],
        mainBranch: 'main', verification: 'required', tests: {},
      }],
    }],
    profiles: {
      version: 'fixture-1',
      dev: {
        codex: { léger: { model: 'gpt-6-luna', effort: 'low' }, standard: { model: 'gpt-6.1-sol', effort: 'medium' }, fort: { model: 'gpt-6-astra', effort: 'high' } },
        claude: { léger: { model: 'claude-haiku-5-5', effort: 'low' }, standard: { model: 'claude-sonnet-5-5', effort: 'medium' }, fort: { model: 'claude-opus-5-5', effort: 'high' } },
      },
      review: {
        codex: { léger: { model: 'gpt-6.1-sol', effort: 'medium' }, standard: { model: 'gpt-6.1-sol', effort: 'high' }, fort: { model: 'gpt-6-astra', effort: 'high' } },
        claude: { léger: { model: 'claude-sonnet-5-5', effort: 'medium' }, standard: { model: 'claude-sonnet-5-5', effort: 'high' }, fort: { model: 'claude-opus-5-5', effort: 'high' } },
      },
    },
  };
}
