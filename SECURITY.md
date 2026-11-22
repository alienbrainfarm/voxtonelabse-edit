# Security Policy

## Supported versions

Security fixes target the latest published release and the current `main` branch.
Older releases are not maintained separately; please upgrade to the latest release
before reporting an issue when practical. Reports affecting older versions are
still welcome if the issue may also affect the current version.

## Reporting a vulnerability

Please report suspected vulnerabilities privately using
[GitHub's Report a vulnerability form](https://github.com/alienbrainfarm/voxtonelabse-edit/security/advisories/new).
You can also find it under **Security → Report a vulnerability** in this repository.
A GitHub account is required.

Do not include vulnerability details, exploit code, or sensitive files in public
issues or pull requests. Use public issues for ordinary bugs and feature requests.

Include as much of the following as you can:

- The affected release, tag, or commit.
- Your operating system and version, and whether you use the browser or desktop
  app. For the browser version, include the browser name and version.
- A description of the issue, its security impact, and any prerequisites.
- Steps to reproduce it and, if available, a minimal proof of concept.
- Relevant logs or screenshots, with credentials and personal information removed.
- For file or MIDI issues, a minimal sample file or message and the relevant
  device/interface details. Use synthetic data where possible.

If the private reporting form is unavailable, open an issue asking only for a
private security contact. Do not disclose the vulnerability in that issue.

## Scope

Reports are welcome for security issues in this project's browser editor,
Electron desktop app, build and release tooling, and bundled dependencies.
Examples include:

- Malicious `.TLP` or `.TLG` files causing script execution, unintended file
  access, or other security impact.
- Unsafe handling of MIDI or SysEx messages.
- Electron permission, navigation, or isolation weaknesses.
- Exposure of sensitive data or compromise of distributed release artifacts.

This project is independent of Korg and VOX. Vulnerabilities confined to their
hardware, firmware, or original software should be reported to the relevant
vendor.

## Handling and disclosure

Reports are reviewed on a best-effort basis; response and fix times are not
guaranteed. Use the private advisory discussion for follow-up and additional
evidence.

Please coordinate public disclosure with the maintainer so that a fix or
mitigation can be made available first. When a fix is released, the advisory can
document affected versions, remediation, and reporter credit if desired.

## Safe testing

Test only on systems and MIDI devices you own or have permission to test.
Back up your ToneLab programs before testing: MIDI writes can overwrite presets.
Avoid accessing other people's data or disrupting their systems.

