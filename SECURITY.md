# Security policy

## Reporting a vulnerability

Report a vulnerability privately, through GitHub's private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability**, or go straight to [a new advisory](https://github.com/andrewferk/url-shortener/security/advisories/new).

Please don't open a public issue, pull request or discussion about it. The report stays private between you and the maintainers until a fix is released and the advisory is published.

A useful report says:

- what an attacker can do, and to whom: a Visitor, a Creator, the Operator or a Deployment;
- the steps to reproduce it, or a proof of concept;
- the commit or release you found it in.

## What's in scope

This repository: the domain core, the Workers, the OpenTofu configuration, the reusable workflows and the example ops repo.

A problem with one Deployment, such as a Short URL that redirects somewhere harmful, belongs to that Deployment's Operator. Send it to the Deployment's abuse address, not here.

## Supported versions

Fixes land on `main` and in the next release. Until `v1.0.0`, only the latest release is supported.
