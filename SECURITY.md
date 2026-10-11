# Security policy

Tabby AI Panel lets a language model type into your terminals, so security issues matter here. Examples include ways to bypass approvals, run commands without the user's consent, inject markup through model output, or leak data to places other than the configured endpoint.

## Supported versions

Only the latest release receives fixes.

## Reporting a vulnerability

Please **do not open a public issue**. Report it privately through GitHub: [**Report a vulnerability**](https://github.com/giejqf/tabby-ai-panel/security/advisories/new), found under the repository's *Security* tab.

Include the plugin and Tabby versions, the steps to reproduce, and the impact. The report stays private until a fix is released, and you will be credited unless you prefer otherwise.

## Scope

The risk patterns described in [docs/safety.md](docs/safety.md) are a safety net, not a security boundary. A model that runs an approved command which turns out to be harmful is expected behaviour, not a vulnerability. A command that runs **without** the approval the current mode requires is a vulnerability.
