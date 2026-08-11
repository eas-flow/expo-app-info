# Security Policy

## Supported Versions

Only the latest published version of each package under `packages/*`
receives security fixes. Older versions are not patched — upgrade before
reporting.

## Reporting a Vulnerability

Please **do not open a public issue** for security problems.

Report privately through GitHub Security Advisories:

1. Go to the [Security tab](https://github.com/my-shelfio/shelfit/security/advisories)
2. Click **Report a vulnerability**

You should get an initial response within 7 days. Once a fix is released, you
will be credited in the advisory unless you prefer to stay anonymous.

## CI secrets

The only secret used by CI is `EXPO_TOKEN`, used exclusively by the weekly
API canary workflow (`.github/workflows/api-canary.yml`) to smoke-test
`expo-shelfit` against the real EAS API. It is never printed in logs and is
not available to workflows triggered from forks.

## Scope

Out of scope: vulnerabilities in third-party APIs a package depends on (e.g.
the EAS API), and issues that require an attacker to already control the
environment a package runs in (for example, a machine where they can read
your environment variables).
