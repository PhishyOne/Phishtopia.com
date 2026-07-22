# Security Policy

Thank you for helping keep Phishtopia and its users safe. Please report suspected vulnerabilities privately and give the project a reasonable opportunity to investigate and fix them before public disclosure.

## Supported versions

| Version or deployment | Supported |
| --- | --- |
| Current production deployment at `phishtopia.com` | Yes |
| Current `main` branch | Yes |
| Older releases, branches, forks, or local modifications | No |

## Reporting a vulnerability

Use GitHub's private vulnerability-reporting form whenever possible:

https://github.com/PhishyOne/Phishtopia.com/security/advisories/new

You may also report a vulnerability by emailing `security@phishtopia.com`.

Do not include vulnerability details in a public issue, discussion, pull request, commit, gist, or social-media post.

A useful report includes:

- The affected URL, route, feature, dependency, or commit.
- Clear reproduction steps and any required preconditions.
- The security impact and who or what could be affected.
- A minimal proof of concept when it can be provided safely.
- Relevant screenshots, request or response samples, and logs with credentials, tokens, cookies, personal data, and other secrets removed.
- Any suggested mitigation or fix.

## Response targets

Phishtopia is a small, independently maintained project. The targets below are goals rather than guarantees:

- Acknowledge a complete private report within 3 business days.
- Provide an initial assessment or request for more information within 7 business days.
- Share meaningful status updates while remediation is underway.
- Coordinate disclosure after a fix is available or on another mutually agreed date.

Resolution time depends on severity, reproducibility, affected infrastructure, and the availability of a safe fix.

## Testing rules

Good-faith testing must be limited to accounts and data you own or have explicit permission to use. Use the least invasive method needed to demonstrate the issue, minimize requests, and stop immediately if you encounter another person's data, credentials, or private information.

The following activities are out of scope unless explicit written authorization is provided in advance:

- Accessing, changing, downloading, or deleting another person's data.
- Credential theft, session hijacking, phishing, or other social engineering.
- Denial-of-service, load, stress, resource-exhaustion, or availability testing.
- Destructive testing or persistence on production systems.
- Automated scanning that creates significant traffic, accounts, messages, or stored data.
- Testing third-party services or infrastructure not owned by Phishtopia.
- Physical attacks or attacks against project maintainers, users, hosting providers, or support personnel.

Do not intentionally retain sensitive data. If sensitive information is encountered accidentally, stop testing, do not share it further, preserve only what is necessary to identify the issue, and report it privately.

## Good-faith research

Research performed in good faith, within this policy, and with prompt private reporting will be treated as an effort to improve the project's security. This policy does not authorize violations of law or third-party terms, and it does not create a bug-bounty program or promise payment.

## Public disclosure

Please avoid public disclosure until the vulnerability has been investigated and a fix or mitigation is available. The project will work toward coordinated disclosure and will credit reporters who request attribution, provided doing so is safe and appropriate.
