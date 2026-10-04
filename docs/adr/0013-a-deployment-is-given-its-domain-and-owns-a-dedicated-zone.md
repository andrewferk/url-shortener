---
status: accepted
---

> Amended by [ADR 0014](./0014-link-identity-carries-an-opaque-namespace.md): each Short domain maps to exactly one Namespace, resolved from the request's hostname. A deployment today maps its `base_domain` to the `default` Namespace.
>
> Amended by [ADR 0015](./0015-apache-2-and-every-deployment-runs-from-its-own-ops-repo.md): the ban on committed deployment values covers this repo. Each deployment's ops repo commits its own non-secret config.
>
> Amended by [ADR 0023](./0023-take-abuse-reports-at-abuse-alert-at-the-daily-cap-and-suspend-past-a-daily-ceiling.md): `infra/zone` adds an Email Routing rule forwarding `abuse@` to the Operator's verified address, and the Status Worker serves the deployment's abuse policy at `/abuse`.
>
> Amended by [ADR 0025](./0025-keep-a-locked-off-account-copy-of-the-change-log-and-state-what-every-operator-must-protect.md): a registrar lock and auto-renew are required of every Operator. The advice to use Cloudflare Registrar is reversed: keep the registrar outside the prod Cloudflare account. `doctor` and the Status Worker read the Short domain's lock and expiry over RDAP.

> Amended by [ADR 0026](./0026-detect-redirect-hijacks-from-links-data-and-the-ops-repo.md): `infra/zone` publishes no CAA records. Certificate Transparency Monitoring is turned on by hand at bootstrap, so a mis-issued certificate is detected, not prevented.

> Amended in place by [Bring older ADRs, the glossary and the PRD in line with their amendments](https://github.com/andrewferk/url-shortener/issues/75): the body's CAA bullet follows ADR 0026. The Cloudflare Registrar bullet follows ADR 0025.

# A deployment is given its domain and owns a dedicated zone

The project is headed for open source. It should run as its own service, be embeddable in another service, and not rule out a SaaS built on it. So no decision names a domain. [ADR 0007](./0007-opentofu-wrangler-split-links-data-worker-account-isolation.md) already takes the Short domain as an input (`base_domain`, `preview_base_domain`) and derives every hostname from it. This ADR states what a deployment requires of that domain, and what it does to the zone.

The earlier ADRs quietly assume a deployment owns its whole zone:
- `infra/zone` owns *all* the zone's rulesets (ADR 0007);
- [ADR 0004](./0004-abuse-protection-edge-ceiling-worker-limits-cost-brake.md)'s edge flood ceiling matches every hostname in the zone;
- [ADR 0011](./0011-objectives-error-budgets-and-email-alerts.md)'s Email Routing takes the zone's MX records.

We make that assumption the contract, rather than loosen three decisions to share a zone with someone else's site.

Decided in [What does a deployment require of its domain?](https://github.com/andrewferk/url-shortener/issues/15).

## Decision

### The domain is an input

- **No domain, Cloudflare account, or other value of one particular deployment appears in code, ADRs or committed config.** The author's instance is the reference deployment, and its values are supplied at deploy time like any other operator's.
- A deployment serves exactly one Short domain today. Whether one deployment can serve several is open, in [Does Link identity carry a namespace so one deployment can serve many domains?](https://github.com/andrewferk/url-shortener/issues/31).

### The zone

- **Each Short domain is a dedicated Cloudflare zone** on the Free plan, in full setup (Cloudflare's nameservers). The deployment owns everything in it.
- **Any registrar works.** The operator points the domain's nameservers at Cloudflare. Buying the domain is a manual step outside OpenTofu. `cloudflare_registrar_domain` can only manage a domain already registered with Cloudflare, and can't buy one.
- **Hostnames** are ADR 0007's template: Redirects on the apex, the Link API on `api.`, the Status page on `status.`.
  - **No `www` record.** `www` is a reserved alias ([ADR 0002](./0002-random-short-codes-claimed-by-conditional-insert.md)), and a hostname the service doesn't serve can't be abused.
  - **The apex `/` answers 404,** like any other path that can't be a Short code (ADR 0004).

### Embedding

- **Supported:**
  - **As a library:** the domain core, which never imports Cloudflare ([ADR 0001](./0001-cloudflare-workers-typescript-durable-objects-kv.md)), inside another codebase with its own adapters.
  - **As a deployment in the host's Cloudflare account,** on its own dedicated zone.
- **Not supported:**
  - **A hostname inside a zone that serves something else.** Our rulesets would replace the host's, the edge ceiling would rate-limit the host's traffic, and Email Routing would take its MX.
  - **A path prefix on the host's site** (`example.com/s/…`). ADR 0002's reserved-alias list stays tiny only because the Short domain serves nothing but Redirects.

### Zone hardening

These are defaults in `infra/zone`. They cost nothing.

- **DNSSEC** on. It is one click with Cloudflare Registrar. With any other registrar, the operator adds the DS record there.
- **No CAA records** (ADR 0026). This ADR first allowed only the certificate authorities that Universal SSL uses, but Cloudflare changes authority without notice and a stale record can block a renewal. Certificate Transparency Monitoring is turned on by hand instead.
- **HTTPS only:**
  - Always Use HTTPS;
  - an HSTS header on every response, `max-age` one year, with `includeSubDomains`.
  - `preload` is left to the operator. Getting off the preload list takes months, and some TLDs are already preloaded as a whole.
- **Mail:** Email Routing is the zone's only mail, as ADR 0011 requires.
  - It owns the MX, SPF and DKIM records.
  - DMARC is `p=reject`, so nobody else can send mail as the Short domain.
  - The Status Worker's alert mail is signed by Email Routing. Bootstrap confirms it passes DMARC before the policy is applied.

### Choosing a domain

This is guidance for operators, written into the build's docs. It isn't decided here.
- **The domain can never change** once Links are shared. Losing it breaks every short URL ever issued.
- **Prefer gTLDs, or long-established ccTLDs with open registration.** Avoid TLDs with a retirement or seizure risk: `.io` could be retired if its territory's code is withdrawn, and Libya has revoked `.ly` domains over the content they pointed to.
- **Avoid TLDs with bad abuse reputations,** such as `.cc` and `.click`. Mail and security filters punish them, and shorteners are already filtered.
- **Budget the renewal against the worst month.** At ADR 0004's defaults, Workers Paid ($5) plus a month of the cost brake's ceiling (about $13) leaves about $24 a year for the domain within $20 a month.
- **Short names are often registry-premium,** at hundreds of dollars a year. Check the renewal price at checkout.
- **Cloudflare Registrar** charges renewals at cost and gives one-click DNSSEC. [ADR 0025](./0025-keep-a-locked-off-account-copy-of-the-change-log-and-state-what-every-operator-must-protect.md) advises against it all the same: keep the registrar outside the prod Cloudflare account.

## Cost

$0 beyond the domain's renewal.

## Considered options

- **Deploying into a zone that serves something else.** It would need hostname-scoped rules, which the Free plan's single rate limiting rule can't provide. It would also need a way to share `cloudflare_ruleset` ownership, and mail without Email Routing's MX. It is incompatible with ADR 0004, ADR 0007 and ADR 0011 as decided.
- **A path prefix under another site.** It would bring back route clashes between Short codes and the host's own paths.
- **Naming the author's domain in the ADRs and committed config.** It would couple the project to one deployment and leak it into every fork.
- **A null MX and SPF `-all`.** They would stop Email Routing and the Status Worker's alert mail (ADR 0011).
- **HSTS `preload` by default.** It is a months-long commitment per domain, which should be the operator's call.
- **Previews on `workers.dev`.** Superseded by ADR 0007, which puts them on `preview_base_domain`.

## Consequences

- **A host service that wants short URLs needs its own domain for them.** Cloudflare's separate zone for a subdomain of an existing domain is an Enterprise feature.
- **Every value of a deployment is an input.** The delivery pipeline must take the account, domains and GitHub identities from its environment, so a fork deploys by setting its own.
- **Buying the domain, pointing its nameservers and adding the DS record** are the operator's steps before the first `infra/zone` apply.
