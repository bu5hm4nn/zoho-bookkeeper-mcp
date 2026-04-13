# Zoho Bookkeeper MCP Server

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for Zoho Books integration, designed for bookkeeping workflows with AI agents.

## Why This Exists

The official Zoho MCP service (zohomcp.com) has limitations:

- **Cannot upload file attachments** - The MCP schema incorrectly maps binary file parameters as query strings
- **Too many tools** - 100+ tools exhaust AI tool limits quickly
- **Difficult control over tool selection** - The mcp.zoho.com interface is troublesome and cannot be used by agents

This custom MCP server provides:

- Proper multipart/form-data file uploads for attachments
- Curated set of 37 tools for bookkeeping workflows
- Auto-refreshing OAuth tokens (1-hour lifetime with 5-minute buffer)
- Both stdio (CLI) and HTTP stream transports

## Features

- **Full CRUD operations** for journals, expenses, bills, and invoices
- **File attachments** with proper multipart upload support (PDF, images, Office documents)
- **Chart of accounts** management and transaction queries
- **Bank account** integration and transaction listing
- **Contact management** for customers and vendors
- **OAuth 2.0** with automatic token refresh
- **Health checks** for container orchestration

## Available Tools (40 total)

| Category | Tools | Description |
|----------|-------|-------------|
| **Organizations** | 2 | List orgs, get org details |
| **Chart of Accounts** | 4 | List/get/create accounts, list transactions |
| **Journals** | 9 | Full CRUD + publish + attachments |
| **Expenses** | 6 | Full CRUD + receipt attachments |
| **Bills** | 6 | Full CRUD + attachments |
| **Invoices** | 5 | List/get + attachments |
| **Contacts** | 2 | List/get customers and vendors |
| **Bank Accounts** | 6 | List accounts/transactions + match and unmatch reconciliation items |

## Prerequisites

- Node.js 20+
- Zoho Books account with API access
- Zoho OAuth 2.0 credentials (see [Configuration](#configuration))

## Installation

### Option 1: Run with npx (Recommended for Desktop Agents)

```bash
npx zoho-bookkeeper-mcp
```

### Option 2: Install globally

```bash
npm install -g zoho-bookkeeper-mcp
zoho-bookkeeper-mcp
```

### Option 3: Docker

```bash
docker build -t zoho-bookkeeper-mcp .
docker run -p 8004:8004 \
  -e ZOHO_CLIENT_ID=your_client_id \
  -e ZOHO_CLIENT_SECRET=your_client_secret \
  -e ZOHO_REFRESH_TOKEN=your_refresh_token \
  zoho-bookkeeper-mcp
```

### Option 4: From source

```bash
git clone https://github.com/bu5hm4nn/zoho-bookkeeper-mcp.git
cd zoho-bookkeeper-mcp
pnpm install
pnpm build
```

## Configuration

Run the interactive setup:

```bash
pnpm setup
```

This will guide you through:
1. Creating a Zoho Self-Client application
2. Entering your Client ID and Secret
3. Generating and exchanging an authorization code
4. Saving credentials to `.env`

### Manual Configuration

If you prefer manual setup, copy `.env.example` to `.env` and follow the [Zoho OAuth Documentation](https://www.zoho.com/accounts/protocol/oauth.html) to obtain:

- `ZOHO_CLIENT_ID` - from Zoho API Console
- `ZOHO_CLIENT_SECRET` - from Zoho API Console
- `ZOHO_REFRESH_TOKEN` - obtained via OAuth authorization code flow with scope `ZohoBooks.fullaccess.all`

### Environment Variables

The `.env` file should contain:

```bash
# Required
ZOHO_CLIENT_ID=1000.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
ZOHO_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
ZOHO_REFRESH_TOKEN=1000.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Optional
ZOHO_API_URL=https://www.zohoapis.com/books/v3  # Default (US datacenter)
ZOHO_ORGANIZATION_ID=123456789                   # Default org ID (optional)
PORT=8004                                         # HTTP server port
HOST=0.0.0.0                                      # HTTP server host
```

**Regional API URLs:**

- US (default): `https://www.zohoapis.com/books/v3`
- EU: `https://www.zohoapis.eu/books/v3`
- IN: `https://www.zohoapis.in/books/v3`
- AU: `https://www.zohoapis.com.au/books/v3`

## Integration with Chat Agents

### Claude Desktop

Add to your Claude Desktop configuration (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "zoho-bookkeeper": {
      "command": "npx",
      "args": ["zoho-bookkeeper-mcp"],
      "env": {
        "ZOHO_CLIENT_ID": "your_client_id",
        "ZOHO_CLIENT_SECRET": "your_client_secret",
        "ZOHO_REFRESH_TOKEN": "your_refresh_token"
      }
    }
  }
}
```

Or if installed globally:

```json
{
  "mcpServers": {
    "zoho-bookkeeper": {
      "command": "zoho-bookkeeper-mcp",
      "env": {
        "ZOHO_CLIENT_ID": "your_client_id",
        "ZOHO_CLIENT_SECRET": "your_client_secret",
        "ZOHO_REFRESH_TOKEN": "your_refresh_token"
      }
    }
  }
}
```

### LibreChat

Add to your `librechat.yaml`:

```yaml
mcpServers:
  zoho-bookkeeper:
    type: streamable-http
    url: http://mcp-zoho-bookkeeper:8004/mcp
    timeout: 30000
```

And to your `docker-compose.yml`:

```yaml
services:
  mcp-zoho-bookkeeper:
    build:
      context: ./path/to/zoho-bookkeeper-mcp
    container_name: mcp-zoho-bookkeeper
    restart: unless-stopped
    environment:
      PORT: 8004
      ZOHO_CLIENT_ID: ${ZOHO_CLIENT_ID}
      ZOHO_CLIENT_SECRET: ${ZOHO_CLIENT_SECRET}
      ZOHO_REFRESH_TOKEN: ${ZOHO_REFRESH_TOKEN}
    ports:
      - "8004:8004"
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:8004/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s
```

### Generic MCP Client (HTTP)

Start the HTTP server:

```bash
# Using pnpm
pnpm serve

# Or directly
node dist/server.js
```

Connect to `http://localhost:8004/mcp` using streamable-http transport.

### Generic MCP Client (stdio)

```bash
# Using pnpm
pnpm start

# Or directly
node dist/bin.js
```

## Usage Examples

### Get Organization ID (Required First Step)

Most tools require an `organization_id`. Get it first:

```
Use the list_organizations tool to get your Zoho organization ID
```

### Create a Journal Entry

```
Create a journal entry dated 2025-01-15 with:
- Debit Office Supplies (account_id: 123456) for $150
- Credit Business Checking (account_id: 789012) for $150
Reference: "Office supplies purchase"
```

### Attach a Receipt

```
Upload the file /path/to/receipt.pdf to journal 4567890123456
```

### List Recent Expenses

```
List all expenses from the last 30 days
```

## Development

### Setup

```bash
git clone https://github.com/bu5hm4nn/zoho-bookkeeper-mcp.git
cd zoho-bookkeeper-mcp
pnpm install
```

### Commands

```bash
pnpm build        # Build TypeScript to dist/
pnpm dev          # Run with hot reload (HTTP server)
pnpm serve:dev    # Same as dev
pnpm start        # Run stdio transport
pnpm serve        # Run HTTP server

pnpm test         # Run all tests
pnpm test:unit    # Run unit tests only
pnpm test:watch   # Run tests in watch mode
pnpm test:coverage # Run tests with coverage

pnpm lint         # Check for linting errors
pnpm lint:fix     # Fix linting errors
pnpm format       # Format code with Prettier
pnpm format:check # Check formatting
```

### Project Structure

```
zoho-bookkeeper-mcp/
├── src/
│   ├── index.ts           # Main MCP server setup
│   ├── server.ts          # HTTP server entry point
│   ├── bin.ts             # CLI entry point (stdio)
│   ├── config.ts          # Configuration management
│   ├── api/
│   │   ├── client.ts      # Zoho API client helpers
│   │   └── types.ts       # TypeScript type definitions
│   ├── auth/
│   │   └── oauth.ts       # OAuth token management
│   ├── tools/
│   │   ├── organizations.ts
│   │   ├── chart-of-accounts.ts
│   │   ├── journals.ts
│   │   ├── expenses.ts
│   │   ├── bills.ts
│   │   ├── invoices.ts
│   │   ├── contacts.ts
│   │   └── bank-accounts.ts
│   ├── utils/
│   │   ├── errors.ts
│   │   ├── mime-types.ts
│   │   └── response-parser.ts
│   └── __tests__/         # Test files
├── dist/                   # Compiled JavaScript
├── Dockerfile
├── package.json
└── tsconfig.json
```

## API Endpoints

When running as HTTP server:

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check (returns JSON status) |
| `POST /mcp` | MCP protocol endpoint (streamable-http) |

## Troubleshooting

### "Invalid OAuth token" errors

1. Verify your refresh token is valid
2. Check that your Zoho app has the `ZohoBooks.fullaccess.all` scope
3. Ensure the correct regional API URL is set

### "Organization not found" errors

1. Use `list_organizations` first to get valid org IDs
2. Set `ZOHO_ORGANIZATION_ID` env var for default org

### Attachment upload fails

1. Verify the file path is accessible to the server
2. Check file type is supported (PDF, PNG, JPG, GIF, DOC, DOCX, XLS, XLSX)
3. Ensure file size is within Zoho's limits

### Rate limiting

This server uses ~3k tokens per request vs ~30k for the hosted Zoho MCP (100+ tools). If you still hit rate limits, add delays between requests.

## Tech Stack

- **Runtime**: Node.js 20+
- **Framework**: [FastMCP](https://github.com/jlowin/fastmcp)
- **Language**: TypeScript
- **Auth**: OAuth 2.0 with refresh token flow
- **Build**: tsup
- **Testing**: Vitest
- **Linting**: ESLint + Prettier

## License

MIT License - see [LICENSE](LICENSE) for details.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## Related Projects

- [Model Context Protocol](https://modelcontextprotocol.io/) - The protocol specification
- [FastMCP](https://github.com/jlowin/fastmcp) - The MCP framework used by this server
- [Zoho Books API](https://www.zoho.com/books/api/v3/) - Official Zoho Books API documentation
