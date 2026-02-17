# Gateway Service

A lightweight API gateway / reverse proxy for internal microservices built with NestJS, Fastify, and TypeScript.

## Features

- **Reverse Proxy**: Route requests to upstream services based on path prefixes
- **Rate Limiting**: Global and per-route rate limiting with configurable limits
- **Correlation ID**: Automatic generation and propagation of correlation IDs
- **Request Size Limits**: Configurable maximum request body size
- **Header Normalization**: Automatic normalization of forwarded headers
- **Security Headers**: Automatic addition of security headers to responses
- **Structured Logging**: Pino-based logging with correlation ID in every log line
- **Health Checks**: Built-in health endpoint

## Requirements

- Node.js 20+
- pnpm 9.5.0+

## Quick Start

### Installation

```bash
# Install dependencies
pnpm install

# Copy environment file
cp .env.example .env

# Start development server
pnpm dev
```

### Available Scripts

| Script | Description |
|--------|-------------|
| `pnpm dev` | Start development server with watch mode |
| `pnpm build` | Build for production |
| `pnpm start` | Start production server |
| `pnpm lint` | Run ESLint |
| `pnpm test` | Run unit tests |
| `pnpm test:e2e` | Run integration tests |
| `pnpm test:cov` | Run tests with coverage |

## Configuration

All configuration is done via environment variables. See `.env.example` for available options.

### Server Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `NODE_ENV` | Environment (development/production/test) | `development` |
| `TRUST_PROXY` | Trust proxy headers (x-forwarded-for) | `false` |
| `REQUEST_BODY_LIMIT_BYTES` | Maximum request body size | `1048576` (1MB) |
| `LOG_LEVEL` | Logging level | `info` |

### Upstream Services

| Variable | Description | Example |
|----------|-------------|---------|
| `AUTH_UPSTREAM_URL` | Auth service URL | `http://localhost:4000` |
| `DIARY_UPSTREAM_URL` | Diary service URL | `http://localhost:4100` |
| `TASKS_UPSTREAM_URL` | Tasks service URL | `http://localhost:4200` |
| `HEALTH_UPSTREAM_URL` | Health service URL | `http://localhost:4300` |
| `UPSTREAM_TIMEOUT_MS` | Upstream request timeout | `30000` |

### Rate Limiting

| Variable | Description | Default |
|----------|-------------|---------|
| `RATE_LIMIT_MAX` | Global max requests per window | `100` |
| `RATE_LIMIT_WINDOW_SECONDS` | Global rate limit window | `60` |
| `AUTH_RATE_LIMIT_MAX` | Auth endpoints max requests | `5` |
| `AUTH_RATE_LIMIT_WINDOW_SECONDS` | Auth rate limit window | `60` |

## Route Mapping

The gateway routes requests to upstream services based on path prefixes:

| Path Prefix | Upstream |
|-------------|----------|
| `/auth/*` | `AUTH_UPSTREAM_URL` |
| `/diary/*` | `DIARY_UPSTREAM_URL` |
| `/tasks/*` | `TASKS_UPSTREAM_URL` |
| `/health` | Internal health endpoint |

## Security Features

### Rate Limiting

- Global rate limiting applies to all endpoints
- Stricter rate limits apply to auth endpoints:
  - `POST /auth/login`
  - `POST /auth/register`
  - `POST /auth/refresh`

### Header Normalization

The gateway normalizes headers before forwarding to upstream:

- Sets `x-forwarded-for` with client IP
- Sets `x-forwarded-proto` with request protocol
- Sets `x-forwarded-host` with original host
- Strips hop-by-hop headers (connection, keep-alive, etc.)
- Removes duplicate authorization header variants
- Sets default `accept: application/json` if missing

### Security Headers

The gateway adds security headers to all responses:

- `x-content-type-options: nosniff`
- `referrer-policy: no-referrer`

### Correlation ID

Every request is assigned a correlation ID:

- Uses existing `x-correlation-id` header if present
- Generates UUID v4 if missing
- Propagates to upstream services
- Included in all log entries
- Returned in response header

## Error Responses

All errors follow a consistent format:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "correlationId": "uuid-v4"
  }
}
```

Error codes:
- `BAD_REQUEST` (400)
- `UNAUTHORIZED` (401)
- `FORBIDDEN` (403)
- `NOT_FOUND` (404)
- `PAYLOAD_TOO_LARGE` (413)
- `RATE_LIMIT_EXCEEDED` (429)
- `INTERNAL_ERROR` (500)
- `UPSTREAM_ERROR` (502)
- `SERVICE_UNAVAILABLE` (503)
- `GATEWAY_TIMEOUT` (504)

## Docker

### Build Image

```bash
docker build -t gateway-service .
```

### Run Container

```bash
docker run -p 3000:3000 \
  -e AUTH_UPSTREAM_URL=http://auth-service:4000 \
  gateway-service
```

### Docker Compose

```bash
docker-compose up -d
```

## Development

### Project Structure

```
src/
├── common/
│   ├── constants/          # Shared constants
│   ├── filters/            # Exception filters
│   ├── interfaces/         # TypeScript interfaces
│   └── plugins/            # Fastify plugins
├── config/                 # Configuration module
├── gateway/                # Gateway module
│   ├── gateway.module.ts
│   ├── health.controller.ts
│   ├── proxy.provider.ts
│   └── rate-limit.provider.ts
├── app.module.ts
└── main.ts
```

### Setting Up Husky

After cloning the repository, run:

```bash
pnpm install
```

This will automatically set up Husky git hooks via the `prepare` script.

To manually initialize Husky:

```bash
npx husky init
```

### Commit Convention

This project uses [Conventional Commits](https://www.conventionalcommits.org/). All commits must follow the format:

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `test`: Test changes
- `build`: Build system changes
- `ci`: CI configuration changes
- `chore`: Other changes

Examples:
```bash
git commit -m "feat(proxy): add support for websocket proxying"
git commit -m "fix(rate-limit): correct window calculation"
git commit -m "docs: update README with new configuration options"
```

### Semantic Release

Releases are automated using [semantic-release](https://semantic-release.gitbook.io/). When commits are pushed to `main`:

1. Version is determined from commit messages
2. CHANGELOG.md is updated
3. Git tag is created
4. GitHub release is created

## Testing

### Running Tests

```bash
# Unit tests
pnpm test

# Integration tests
pnpm test:e2e

# With coverage
pnpm test:cov
```

### Test Coverage

Tests cover:
- Correlation ID generation and propagation
- Request size limit enforcement
- Rate limit triggering
- Header normalization and hop-by-hop removal

## License

MIT
