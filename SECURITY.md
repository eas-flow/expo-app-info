# Security Policy

## Supported Versions

Only the latest published version of `expo-app-info` receives security fixes.

| Version | Supported |
| ------- | --------- |
| 0.1.x   | ✅         |

## Reporting a Vulnerability

Please **do not open a public issue** for security problems.

Report privately through GitHub Security Advisories:

1. Go to the [Security tab](https://github.com/eas-flow/expo-app-info/security/advisories)
2. Click **Report a vulnerability**

You should get an initial response within 7 days. Once a fix is released, you
will be credited in the advisory unless you prefer to stay anonymous.

## How this CLI handles your access token

`expo-app-info` reads a single credential: the **`EXPO_TOKEN`** environment
variable. The following are deliberate design constraints, and a violation of
any of them should be reported as a security issue:

- **The token is never read from `argv`.** Command-line arguments are visible to
  every other process on the machine via the process list.
- **The token is never written to disk.** No config file, no cache, no log.
- **The token is never printed.** It does not appear in output, error messages,
  or progress lines.
- **The token is sent to exactly one destination**: the EAS GraphQL endpoint
  (`https://api.expo.dev/graphql`), over HTTPS, in an `Authorization` header.
- **There are zero runtime dependencies.** The published package contains only
  first-party code, so there is no transitive supply chain to audit.

> `EXPO_API_URL` can override the endpoint. It exists for local testing, is
> intentionally undocumented in the README, and is not covered by any
> compatibility guarantee. Do not point it at an untrusted host — doing so sends
> your token there.

## Scope

Out of scope: vulnerabilities in the EAS API itself, and issues that require an
attacker to already control the environment the CLI runs in (for example, a
machine where they can read your environment variables).
