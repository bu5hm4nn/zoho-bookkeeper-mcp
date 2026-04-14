project:
  name: zoho-bookkeeper-mcp
  description: >
    MCP server for Zoho Books bookkeeping workflows.
    Curated tools, working uploads, bank matching/categorization.

docs:
  overview: README.md
  ci: devops.md
  server: src/index.ts
  api_client: src/api/client.ts
  validation: src/utils/validation.ts
  tools: src/tools/
  tests: src/__tests__/

stack:
  runtime: Node.js 20+
  framework: FastMCP
  language: TypeScript
  build: tsup
  tests: vitest

structure:
  tool_files: src/tools/*.ts
  shared_api: src/api/
  shared_utils: src/utils/
  auth: src/auth/

rules:
  - Prefer separate tools when Zoho endpoints use different payloads.
  - Reuse shared client/validation helpers; do not hand-roll fetch logic in tool files.
  - Keep new tool schemas strict with z.object(...).strict(); validate numbers, dates, IDs, and file inputs.
  - Banking flow: match or categorize first; journals are exception workflow.
  - Tool descriptions should help the agent choose the right workflow.
  - Add happy-path and error-path tests for every new tool.
  - Before PRs: run pnpm lint, pnpm test, pnpm build.

commands:
  dev: pnpm dev
  serve: pnpm serve
  test: pnpm test
  lint: pnpm lint
  build: pnpm build

notes:
  auth: OAuth refresh-token flow; see README.md and src/auth/oauth.ts
  org_id: organization_id may be optional when ZOHO_ORGANIZATION_ID is configured; keep schema and wording consistent across tools.
  next_focus: vendor management for expense and bank categorization workflows.
