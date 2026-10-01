# Research: how Cloudflare, registrars, registries and blocklists act on abuse reports against a shortener domain

Ticket: [#47](https://github.com/andrewferk/url-shortener/issues/47), a child of [#1](https://github.com/andrewferk/url-shortener/issues/1). Every source below was fetched directly (with `curl`, not through a summarising fetcher) on **2026-10-01**. Cloudflare docs were read as raw Markdown (`…/index.md`).

**Scope.** Facts only. The choices are made in "How does a deployment take in abuse reports and notice an abusive Creator?" and "How does a deployment survive losing its Cloudflare account, its domain or an identity root?".

**Labels.** Every claim carries one of:

- **Confirmed**: the primary source says it, and the quote is given.
- **Contradicted**: the primary source says otherwise, and the quote is given.
- **Not documented**: no primary source found. What a `doctor` check or spike would have to test is stated.
- **Inference**: reasoned from a stated source, not itself documented.
- **Secondary**: taken from a vendor's blog, help centre or source code rather than a policy page or standard.

---

## Summary

| Party | What it does on a report or detection | How the Operator hears | Documented deadline | Way back |
|---|---|---|---|---|
| **Cloudflare (as host of the Worker)** | Phishing: a warning page on the reported link. Malware: the URL is blocked. Hosted content in breach "may be blocked or removed". Services may be suspended or terminated | Email to the account's abuse contact (else a Super Administrator), the dashboard's Abuse reports page, and optional email / webhook / PagerDuty notifications on all plans | "Respond to any abuse report notification within 24 hours" | "Request Review" on the dashboard's Blocked Content page, or the Abuse Report Mitigations API |
| **Registrar (gTLD)** | Must "promptly take the appropriate mitigation action(s)" on actionable evidence of DNS Abuse. `clientHold` is the example action | Not specified by the RAA. The registrar need not ask the registrant first | No fixed time. ICANN's examples act within two to three business days | The registrar removes `clientHold` |
| **Registry (gTLD)** | Refers the domain to the registrar, or acts directly (`serverHold`) | Through the registrar | No fixed time | The registry, through the registrar |
| **Google Safe Browsing** | Browser interstitial and a search-result warning | Search Console's Security Issues report, for a verified site owner | None for the owner. A review takes "a few days to a few weeks" | "Request Review" in Search Console. Repeat Offenders are locked out for 30 days |
| **Spamhaus DBL** | Lists the hostname, automatically. Return code `127.0.1.103` is "abused spammed redirector domain" | No notification is documented. Spamhaus suggests `abuse@`, `postmaster@` and feedback loops | None | Listings expire on their own. Early removal through the reputation checker's form |
| **SURBL** | Lists the domain in `multi`, and keeps separate shortener datasets | No notification is documented | None | The removal form on the Lookup page |

Three points hold across all of them:

1. **Only Cloudflare documents a response deadline for the Operator: 24 hours.** Registrars and blocklists act on evidence. None of their documents promise to contact the domain's owner first.
2. **A registrar or registry can act only on the whole domain.** ICANN's advisory names this as the reason suspension "may not be the appropriate mitigation" for an otherwise legitimate domain.
3. **Nobody documents a rule for a site that redirects rather than hosts.** Cloudflare's split is by its own product (pass-through proxy against hosting), and Workers and Workers KV are on the hosting side.

---

## 1. Cloudflare

Sources:

- [Abuse](https://developers.cloudflare.com/fundamentals/reference/report-abuse/) (last updated 2026-04-20)
- [Customer abuse report obligations](https://developers.cloudflare.com/fundamentals/reference/report-abuse/abuse-report-obligations/) (2026-04-20)
- [Complaint types](https://developers.cloudflare.com/fundamentals/reference/report-abuse/complaint-types/) (2026-04-20)
- [View and submit reports](https://developers.cloudflare.com/fundamentals/reference/report-abuse/submit-report/) (2026-09-10)
- [Blocked Content](https://developers.cloudflare.com/fundamentals/reference/report-abuse/blocked-content/) (2026-05-01)
- [Add abuse contact](https://developers.cloudflare.com/fundamentals/account/account-security/abuse-contact/) (2026-04-20)
- [Available notifications](https://developers.cloudflare.com/notifications/notification-available/)
- [Our approach to abuse](https://www.cloudflare.com/trust-hub/abuse-approach/) (the abuse policy the docs link to)
- [Self-Serve Subscription Agreement](https://www.cloudflare.com/terms/) (last updated 2025-09-12)
- [Service-Specific Terms](https://www.cloudflare.com/service-specific-terms-developer-platform/), Developer Platform section (last updated 2026-09-28)

### 1.1 Are reports forwarded to the customer, and where?

- **Confirmed: reports are forwarded.** "You may receive an abuse report from our Trust & Safety team if an abuse report identifies a URL for a domain associated with your Cloudflare account." "Our Trust & Safety team sends abuse reports to the domain owner or the abuse point of contact on your account." (Obligations.)
- **Confirmed: the destination is the account's abuse contact, set in the dashboard.** "Go to **Manage Account** > **Configurations**. For **Abuse report contact email address**, select **Change email address**." "If you choose not to provide an abuse contact email address, communication about abuse will be directed to one of the Super Administrators on your account." (Add abuse contact.)
- **The two pages disagree about the fallback.** The obligations page says: "If you do not provide or monitor an abuse contact, Cloudflare will send abuse reports to your hosting provider." For a Worker, Cloudflare is the hosting provider. **Not documented:** which fallback applies to a zone whose only origin is a Worker.
- **Confirmed: reports are also visible in the dashboard and by API.** "Entitled Cloudflare customers with the **Trust & Safety**, **Admin**, or **Super Admin** role can view abuse reports against content associated with their account." Mitigations can be reviewed "in the dashboard or using the Abuse Report Mitigations API". (View and submit reports.) **Not documented:** what "entitled" means for a Free or Workers Paid account. A `doctor` check would call the Abuse Reports API with the deployment's token and see whether it is allowed.
- **Confirmed: notifications exist on every plan.** "You can enable abuse notifications for your account to configure email, webhook, or PagerDuty alerts about new abuse reports against your websites." (View and submit reports.) The notifications page lists three: **Abuse report** ("Customers who want to be alerted in the event that an abuse report is filed against their website"), **New Blocks** ("when Cloudflare Trust & Safety places a block on their website") and **Block Review Rejection**. Each says "Included with: All Cloudflare plans."
- **Confirmed: the reporter can sometimes keep the report from the operator.** "For some categories of complaints, you can direct us not to forward your complaint to the website operator." (Our approach to abuse, about pass-through services.)

### 1.2 The deadline

- **Confirmed: 24 hours.** "Respond to any abuse report notification within 24 hours. In your response, include any information that you believe will be relevant to Cloudflare in its assessment of the abuse report. Failure to respond in a timely manner or to address the concerns in the abuse report may result in the removal or blocking of reported content, websites, or apps and suspension or termination of Cloudflare services for the associated account." (Obligations.)
- **Confirmed: Cloudflare advises a shared mailbox.** "Consider using a mailing list email address that goes to multiple people or teams within your organization instead of the email address for an individual person." (Obligations.)

### 1.3 What actions are documented

| Action | Quote | Source |
|---|---|---|
| Warning page on a phishing link | "After Cloudflare confirms existence of the phishing page, Cloudflare provides a warning page to visitors accessing the phishing link. Cloudflare also notifies the site owner to clean the malicious files from their origin web server." | Complaint types |
| Malware URL blocked | "Legitimate reports of malware URLs are blocked from loading via Cloudflare." | Complaint types |
| Hosted content blocked or removed | "If your abuse report pertains to content that we host and that we believe violates the applicable supplemental terms of service, we will remove or disable access to that content. If we disable access or remove content in response to an abuse report, we generally also notify the website operator of our action and we may make the content available again if appropriate based on the website operator's response." | Our approach to abuse |
| Scheduled ("pending") block | "A pending block represents a blocking action Cloudflare will take at the scheduled time." "Selecting **Request Review** cancels the pending delayed action. This means that the block will not be placed." | Blocked Content |
| Hosting services suspended or terminated | "We may suspend or terminate hosting services, however, if we conclude that those services have been repeatedly used to store content in violation of our policy and that no meaningful steps have been taken to address the issue." | Our approach to abuse |
| Immediate removal without notice | "When Cloudflare is made aware of a website solely dedicated to the sharing or promotion of child exploitation material, the offending website is immediately removed from our network without notice." | Complaint types |

- **Confirmed: the contract is broader than the policy.**
  - Developer Platform terms: "Content stored on the Developer Platform (whether in conjunction with a Cloudflare storage offering or not) that we determine in our sole judgment to be illegal, harmful, or in violation of Section 4 of the Cloudflare Developer Platforms Service-Specific Terms may be blocked or removed, and use of the Developer Platform for storage of such illegal or harmful content may result in suspension or termination of Cloudflare Services. While we generally try to provide notice of such action, we reserve the right to take action without notice as appropriate." Harmful content includes "content that seeks to distribute malware, facilitate phishing, or otherwise constitutes technical abuse".
  - The same terms: "You acknowledge and agree that you are solely responsible for the acts of your End Users. Cloudflare may, but is not obligated to, limit or suspend your or your End Users access to any Developer Platform services ... for any suspected violations of the Agreement."
  - Self-Serve Subscription Agreement §2.7: "You agree not to, and not to allow third parties to use the Services to: ... (b) post, transmit, store or link to any files, materials, data, text, audio, video, images or other content that infringe on any person's intellectual property rights or that are otherwise unlawful; (c) distribute viruses, worms, time bombs, Trojan horses, or other malicious code ...; (d) facilitate phishing, spamming, or other technical abuse". Note "link to" and "not to allow third parties".
  - Self-Serve Subscription Agreement §8: "We may at our sole discretion terminate your user account or Suspend or terminate your use or access to the Service at any time, with or without notice for any reason or no reason at all. If we determine you have breached Section 2.2 or 2.7, we may immediately Suspend or terminate all or part of your use of the Services, or limit End User access to certain of your resources through the Services."
- **Confirmed: data access after termination is not promised.** "you may be permitted to access the Customer Content you uploaded to the Developer Platform for up to thirty (30) days following the expiration or termination of your trial or subscription. You understand that Cloudflare has no obligation to retain the Customer Content you upload to the Developer Platform following the expiration or termination of your trial or subscription." (Developer Platform terms.) This is the clause that bears on backups kept in the same account (ADR 0008).
- **Not documented:**
  - Whether a block covers one URL, a hostname or the whole zone. The phishing text says "the phishing link". The Blocked Content page says "content blocks on your domain". A spike would have to report a test Link and observe the scope.
  - How long a pending block waits before it is placed.
  - How many reports, or what interval, makes use "repeated".
  - Whether suspension of a zone and suspension of an account are distinct steps. The docs name "reported content, websites, or apps" and "Cloudflare services for the associated account" and nothing in between.
  - What a suspended account can still do (read R2, export KV, run `wrangler`). The terms say only "may be permitted".

### 1.4 Does a redirecting site differ from a hosting site?

- **Confirmed: Cloudflare's split is by which of its services is used, not by what the site does.** "our ability to respond depends on the type of Cloudflare service at issue." (Abuse.)
- **Confirmed: Workers and Workers KV are on the hosting side.** "If Cloudflare might qualify as the origin hosting provider because of the use of services such as Cloudflare Stream, Cloudflare Pages, Cloudflare Workers, Cloudflare Workers KV, and Cloudflare Images that can definitively store content, our systems will account for those services in processing your report." (Our approach to abuse.)
- **Confirmed: the lenient regime is for pass-through services only.** "Cloudflare does not host content through those services, and we cannot remove content from the Internet that we do not host." "Because Cloudflare's security services help prevent cyberattack from being used as a means for network disruption, terminating all our services is not normally an appropriate or effective response to abuse." (Our approach to abuse.)
- **Not documented: any rule for a Worker that only issues a Redirect.** No Cloudflare page read here mentions redirectors or URL shorteners.
- **Inference** (from the two quotes above and from §2.7's "link to"): a deployment's Redirects are served by a Worker reading Workers KV, so reports against it fall under the hosting regime, where content is removed or blocked and services can be suspended, and not under the forward-only regime for proxied sites.

---

## 2. Registrars and registries

Sources:

- [2013 Registrar Accreditation Agreement, as amended 2024-01-21](https://www.icann.org/en/system/files/files/registrar-accreditation-agreement-21jan24-en.htm) (RAA)
- [Base gTLD Registry Agreement, 2024-01-21](https://itp.cdn.icann.org/en/files/registry-agreements/base-registry-agreement-21-01-2024-en.html) (RA)
- [ICANN Advisory: Compliance With DNS Abuse Obligations in the RAA and the RA](https://www.icann.org/resources/pages/advisory-compliance-dns-abuse-obligations-raa-ra-2024-02-05-en) (2024-02-05)
- [ICANN: EPP Status Codes](https://www.icann.org/resources/pages/epp-status-codes-2014-06-16-en)
- [ICANN: Expired Registration Recovery Policy](https://www.icann.org/resources/pages/errp-2013-02-28-en) (ERRP)
- [Verisign: Registry Lock Service Status](https://www.verisign.com/resources/registrar-resources/registry-lock-status)
- Cloudflare Registrar: [Renew domains](https://developers.cloudflare.com/registrar/account-options/renew-domains/), [FAQ](https://developers.cloudflare.com/registrar/faq/), [Domain management](https://developers.cloudflare.com/registrar/account-options/domain-management/), [Transfer out](https://developers.cloudflare.com/registrar/account-options/transfer-out-from-cloudflare/), [Custom Domain Protection](https://developers.cloudflare.com/registrar/custom-domain-protection/), [Domain Registration Agreement](https://www.cloudflare.com/domain-registration-agreement/)

All of this section applies to gTLDs under ICANN contract. **Not documented here:** ccTLD rules, which each registry sets for itself. ADR 0013 lets the Operator pick any domain, so a ccTLD deployment would need its own registry's policy read.

### 2.1 The abuse obligations that lead to a hold

- **Confirmed: the registrar must act on DNS Abuse.** RAA 3.18.2: "When Registrar has actionable evidence that a Registered Name sponsored by Registrar is being used for DNS Abuse, Registrar must promptly take the appropriate mitigation action(s) that are reasonably necessary to stop, or otherwise disrupt, the Registered Name from being used for DNS Abuse. Action(s) may vary depending on the circumstances, taking into account the cause and severity of the harm from the DNS Abuse and the possibility of associated collateral damage."
- **Confirmed: what counts.** RAA 3.18.1: "'DNS Abuse' means malware, botnets, phishing, pharming, and spam (when spam serves as a delivery mechanism for the other forms of DNS Abuse listed in this Section)".
- **Confirmed: the registry has the matching duty.** RA Specification 6, 4.2: "Where a Registry Operator reasonably determines, based on actionable evidence, that a registered domain name in the TLD is being used for DNS Abuse, Registry Operator must promptly take the appropriate mitigation action(s) ... Such action(s) shall, at a minimum, include: (i) the referral of the domains being used for DNS Abuse, along with relevant evidence, to the sponsoring registrar; or (ii) the taking of direct action by the Registry Operator, where the Registry Operator deems appropriate."
- **Confirmed: registration agreements must allow suspension.** RA Specification 11 (public interest commitments), section 3, requires registrars' registration agreements to carry "a provision prohibiting Registered Name Holders from distributing malware, abusively operating botnets, phishing, piracy, trademark or copyright infringement, fraudulent or deceptive practices, counterfeiting or otherwise engaging in activity contrary to applicable law, and providing (consistent with applicable law and any related procedures) consequences for such activities including suspension of the domain name."
- **Confirmed: Cloudflare Registrar's own agreement does so.** §4.3: Cloudflare, registries and sponsoring registrars "reserve the right to deny, cancel, suspend, transfer, redirect, modify, or renew the Registrar Services or a Registration, or place any domain name(s) on lock, hold or similar status, as deemed necessary in the unlimited and sole discretion of Cloudflare, the Registry Operator, or the Sponsoring Registrar for any of the following reasons: ... (vii) if domain name use is abusive or violates Registry Policies. Abusive use of a domain is described as an illegal, disruptive, malicious or fraudulent action and includes, without limitation, distributing malware, abusively operating botnets, phishing ...". Cloudflare's abuse policy adds: "Consistent with ICANN requirements, Cloudflare takes action to mitigate technical abuse like phishing by domains using our registrar services."
- **Confirmed: `clientHold` and `serverHold` take the whole domain out of the DNS.**
  - `clientHold`: "This status code tells your domain's registry to not activate your domain in the DNS and as a consequence, it will not resolve. It is an uncommon status that is usually enacted during legal disputes, non-payment, or when your domain is subject to deletion."
  - `serverHold`: "This status code is set by your domain's Registry Operator. Your domain is not activated in the DNS."
- **Confirmed: ICANN treats suspension as the wrong tool for an abused but legitimate domain.** Advisory: "Collateral damage is a particularly important consideration when an otherwise legitimate or benign domain name is used as a vector for DNS Abuse without the knowledge or consent of the registrant. ... In these compromise situations, direct suspension of the domain by the registrar or registry operator may not be the appropriate mitigation, as suspension will cut off access to all legitimate content as well as render any associated email and other services with the domain inaccessible. ... Registrars and registries can only act at the second-level domain level. ... In these situations, a registrar might elect to provide notification to the registrant, site operator, and/or web host."
- **Not documented: how a URL shortener is classed.** The advisory's examples are a freshly registered phishing domain (suspended) and a compromised brand site (registrant notified). It names no redirector case. Whether a registrar treats an abused Short URL like the second example is the registrar's judgement.
- **Confirmed: a hold has a second, unrelated cause.** RAA Whois Accuracy Program Specification: if the registrant does not confirm their email, "Registrar shall either verify the applicable contact information manually or suspend the registration". Cloudflare Registrar FAQ: "ICANN requires the registrar to place a hold on the domain and Cloudflare temporarily replaces your nameservers with parking nameservers, which is why the site stops resolving."

### 2.2 Response windows

- **Confirmed: there is no fixed window for DNS Abuse.** Advisory: "The timelines in the examples included in this Advisory are not contractual requirements, but illustrative only. ... other circumstances may require the registrar to act more quickly, such as instances of DNS Abuse that carry the potential of causing imminent harm to end users."
- **Confirmed: ICANN's illustrative timings.**
  - Registrar, phishing on a five-day-old domain: "The investigation and mitigation action occur within two business days of receipt of the report of abuse", by "applying the clientHold Extensible Provisioning Protocol (EPP) status code".
  - Registrar, compromised legitimate domain: the registrant is notified "requesting that it eliminate the phishing content by a certain date reasonably determined by the registrar. The investigation and mitigation action occur within three business days".
  - Registry: a report "processed and reviewed by the registry operator within two business days", then referred to the registrar with "a time-bound request".
- **Confirmed: the only fixed window is for authorities' reports.** RAA 3.18.3: "Well-founded reports of Illegal Activity submitted to these contacts must be reviewed within 24 hours by an individual who is empowered by Registrar to take necessary and appropriate actions".
- **Confirmed: the registrar must acknowledge the reporter.** RAA 3.18.1: "Upon receipt of such reports, Registrar shall provide the reporter with confirmation that it has received the report."
- **Not documented: any duty to warn the registrant before a hold, or any deadline given to the registrant.** The RAA sets none.

### 2.3 What each protection covers

| Protection | EPP status | What it stops | What it does not stop | Source |
|---|---|---|---|---|
| Registrar lock | `clientTransferProhibited` | "reject requests to transfer the domain from your current registrar to another ... will help prevent unauthorized transfers resulting from hijacking and/or fraud" | Anything done from inside the registrar account | ICANN EPP |
| | `clientUpdateProhibited` | "reject requests to update the domain" | | ICANN EPP |
| | `clientDeleteProhibited` | "reject requests to delete the domain" | | ICANN EPP |
| Registry lock | `serverTransferProhibited`, `serverUpdateProhibited`, `serverDeleteProhibited` | The same three, set at the registry: "some Registry Operators offer a Registry Lock Service that allows registrants, through their registrars to set this status as an extra protection against unauthorized" transfers, updates and deletions. "Removing this status can take longer ... because your registrar has to forward your request to your domain's registry" | | ICANN EPP |
| Auto-renew | none | Expiry through forgetting | A failed payment: "There is no guarantee that the renewal will succeed. Renewals may fail for various reasons, including billing failures and registry downtime." | Cloudflare Renew domains |

- **Confirmed: none of the locks is a defence against an abuse hold.** They are separate status codes, and `clientHold` and `serverHold` are set by the registrar and the registry themselves. (ICANN EPP.)
- **Inference** (from the same definitions): a lock does not stop expiry either. `clientDeleteProhibited` rejects delete requests, but renewal is a payment and not a status. Verisign's wording, "Client Delete Prohibited – Confirms a domain name cannot be deleted or lapsed", reads the other way, and is the registry's own description of the registrar-set status. **Not documented:** which is right for a given TLD. Auto-renew and an expiry check are the documented protections against lapse.
- **Confirmed: Cloudflare Registrar has a registrar lock, and an account admin can remove it.** Transfer out: "Select **Configuration** > **Unlock**." "Anyone with super-admin and admin permissions for a zone can also manage your domains. This means these users can also unlock domains or obtain authorization codes to transfer domains to other registrars."
- **Not documented:** that the lock is on by default at Cloudflare Registrar. The transfer-out steps imply it, and no page read here states it. A `doctor` check would read the domain's RDAP status for `client transfer prohibited`.
- **Confirmed: registry lock at Cloudflare is Enterprise only.** "Cloudflare offers Custom Domain Protection to customers with a Cloudflare Enterprise plan ... **Registry lock**: Cloudflare applies Registry Lock, when available, to all domains registered through Custom Domain Protection."
- **Confirmed: Cloudflare Registrar turns auto-renew on by default.** "Cloudflare Registrar enrolls your domain to auto-renew by default." "Cloudflare attempts to renew these domains automatically 30 days before their expiration date. ... The last attempt to renew is made on the day before expiration." "If the renewal fails, you will receive an email notification and Cloudflare will try to renew the domain three additional times. If these attempts fail, you must manually renew your domain."
- **Confirmed: a domain can be renewed up to 10 years ahead.** "choose a number of years to renew your domain (up to 10 years)."

### 2.4 A lapsed domain

- **Confirmed: Cloudflare Registrar's timeline** (FAQ, "What happens when a domain expires"):

  | Days after expiry | State |
  |---|---|
  | 0 | Expiration Date |
  | 1 – 30 | "Grace Period (domain resolves normally)" |
  | 31 – 40 | "Suspension Period (domains resolves to suspension page)" |
  | 41 – 70 | "Redemption Period" — "will no longer resolve to any web page". "A restore fee may apply in addition to the renewal fee." |
  | 71 – 75 | "Pending Delete Period" — "The domain cannot be restored or renewed during this period." |
  | after 75 | "released and made available for re-registration" |

  "Cloudflare currently offers a 40-day grace period for most top-level domains (TLDs)." No auto-renew attempts are made after expiry.
- **Confirmed: ICANN's floor for every gTLD registrar is lower.**
  - ERRP 2.2.1: "registrars may delete registrations at any time after they expire."
  - ERRP 2.2.3: "For at least the last eight consecutive days (after expiration) that the registration is renewable by the RAE, the existing DNS resolution path specified by the RAE must be interrupted".
  - ERRP 3.1: "all gTLD registries must offer a Redemption Grace Period ('RGP') of 30 days immediately following the deletion of a registration".
  - EPP `redemptionPeriod`: "After five calendar days following the end of the redemptionPeriod, your domain is purged from the registry database and becomes available for registration."
- **Inference** (from ERRP 2.2.1, 3.1 and the five-day pending delete): at a registrar that deletes at once, the shortest path from expiry to re-registration by a stranger is about 35 days. At Cloudflare Registrar it is about 75.
- **Confirmed: notices are required and Cloudflare sends more.** ERRP 2.1.1 requires two notices, "approximately one month prior to expiration and ... approximately one week prior". Cloudflare sends monthly, weekly and daily notices before expiry and two after (Renew domains).
- **Confirmed: at other registrars the name may not be released at all.** Cloudflare's own agreement §4.2 reserves that "Cloudflare or a Sponsoring Registrar may, at its discretion, elect to assume the registration and may hold it in its own account, delete it, or sell it to a third party."
- **Not documented: how quickly a released name is taken.** No primary source gives a figure. That released names are caught within seconds by drop-catching services is common industry commentary and is **not verified** here.
- **Confirmed: deletion is the point of no return.** "At the end of that process, the domain will be available for anyone to purchase at any domain registrar." (Domain management.)

---

## 3. Blocklists

### 3.1 Google Safe Browsing

Sources: [Security issues report](https://support.google.com/webmasters/answer/9044101), [Social engineering](https://developers.google.com/search/docs/monitor-debug/security/social-engineering), [Repeat Offenders Policy](https://developers.google.com/search/docs/monitor-debug/security/safe-browsing-repeat-offenders) (last updated 2025-12-10), [Safe Browsing v4: URLs and Hashing](https://developers.google.com/safe-browsing/v4/urls-hashing), [Safe Browsing v4: Usage Limits](https://developers.google.com/safe-browsing/v4/usage-limits), [Safe Browsing API overview](https://developers.google.com/safe-browsing).

- **Confirmed: the effect.** "Pages or sites affected by a security issue can appear with a warning label in search results or an interstitial warning page in the browser when a user tries to visit them." (Security issues report.)
- **Confirmed: a page that only sends Visitors onward can be flagged.** "the host site does not contain any visible ads, but leads users to social engineering pages via pop-ups, pop-unders, or other types of redirection. In both cases, this type of embedded social engineering content will result in a policy violation for the host page." (Social engineering.) This is written about embedded content, not about shorteners. **Not documented:** any Google policy that names URL shorteners.
- **Confirmed: a listing can cover one path or a whole host.** List entries are "suffix/prefix expressions": "Each suffix/prefix expression consists of a host suffix (or full host) and a path prefix (or full path)". (URLs and Hashing.) **Inference:** Google can list a single Short URL or the whole domain. **Not documented:** what makes Google widen a listing from one path to the host.
- **Confirmed: how the Operator finds out.** "you should rely on the Security Issues report as the source of truth to verify whether any security issues exist for your site". Finding out requires verifying the domain in Search Console first ("Verify that you own your site in Search Console"). **Not documented** on the pages read: that Google emails a verified owner on a first listing. The Repeat Offenders page says only that "Safe Browsing also notifies website owners when their websites are compromised". A `doctor` check could instead query the Safe Browsing API for the deployment's own domain.
- **Confirmed: the delisting route and its speed.** "When you confirm that the problem is fixed in your site, request a security review in the Security Issues report. A review can take from a few days to a few weeks to complete." A wrong classification is reported separately: "If you believe Safe Browsing has classified a web page in error, report it."
- **Confirmed: repeat listings lock the owner out.** "Sites that repeatedly switch between compliant and noncompliant behavior within a short window of time will be classified as Repeat Offenders. ... the website owner will be unable to request additional reviews via Search Console. Repeat Offender status persists for 30 days". Also: "Submitting a reconsideration request when the issue hasn't been fixed can cause longer turnaround time for the next request, or even get you marked as a repeat offender."
- **Confirmed: the API has a use restriction.** "The Safe Browsing API is for non-commercial use only (meaning 'not for sale or revenue generating purposes'). If you need a solution for commercial purposes, please refer to Web Risk." Showing a warning based on it requires the line "Advisory provided by Google". (Usage Limits.)

### 3.2 Spamhaus DBL

Sources: [Domain Blocklist FAQ](https://www.spamhaus.org/faqs/domain-blocklist/), [Domain Blocklist](https://www.spamhaus.org/blocklists/domain-blocklist/), [DNSBL Fair Use Policy](https://www.spamhaus.org/blocklists/dnsbl-fair-use-policy/).

- **Confirmed: shorteners have their own return code.** "DBL has a specific return code for abused shorteners/redirectors in the DBL zone: 127.0.1.103." The code table reads "127.0.1.103 — abused spammed redirector domain".
- **Confirmed: that code is meant for scoring, not outright blocking.** Spamhaus's dataset documentation: "127.0.1.102-199 ... identify domains that -while not inherently 'bad'- have been observed involved in abuse. ... This second set of return codes is only suggested for use in scoring systems." ([Spamhaus datasets](https://docs.spamhaus.com/datasets/docs/source/10-data-type-documentation/datasets/030-datasets.html).) **Not documented:** how mail and security products actually treat `127.0.1.103`.
- **Confirmed: the whole hostname is listed, not the Short URL.** "Domain Blocklist listings include only the hostnames, not the full directory path of URL/URIs."
- **Confirmed: listing is automatic.** "Most DBL listings occur automatically, although where necessary, Spamhaus researchers will add or remove listings manually."
- **Confirmed: how the Operator finds out, as far as Spamhaus says.** "We suggest that all domains, especially redirector domains, be set up with appropriate and RFC required role accounts (abuse@ & postmaster@, etc.) ISP feedback loops, and other reporting such as DMARC notifications for email. These can help provide notification of problems." **Not documented:** that Spamhaus notifies anyone of a listing. A `doctor` check or a scheduled job would query `<domain>.dbl.spamhaus.org`, subject to the fair-use policy below.
- **Confirmed: delisting.** "DBL is highly automated and most listings will expire automatically after they cease to have associated activity." For earlier removal: "please use the IP and Domain Reputation Checker ... Using the form does not guarantee removal." "Once the removal request is approved, the request will be processed immediately." "Domains are listed in DBL Zone automatically, and they may re-list automatically after removal if they are re-detected." "There is never any charge or fee".
- **Confirmed: Spamhaus publishes advice for shorteners.** Quoted in full, as it is the only blocklist operator's own guidance found:
  - "URL shortening services should check every URL's domain against the DBL and not allow those that are listed."
  - "Don't string several shorteners/redirectors together! This includes 'Don't shorten other shorteners' and 'Don't accept referrals from other shorteners.'"
  - "Don't redirect to domains with the 'A' Record on the SBL (and possibly the XBL – your decision)."
  - "Check blocklists at the time of URL creation and again, later, as traffic on the new URL ramps up (a day or a week's time later)."
  - "Don't allow users to change the landing URL after the redirect is created."
  - "Don't provide an interstitial link to the spammer's payload if abuse is detected: Fully suspend the offending URL (404 or 410 HTTP return)."
  - "Code a system to prevent automated URL creation (using good CAPTCHA or other bot-stopping tools)."
  - "If you have access to the Spamhaus ZRD product, consider not creating URLs for brand new domains with no reputation."
  - "Do create and maintain role accounts & feedback loops (FBLs) to help detect abuse, and process that information promptly."
- **Confirmed: free DBL queries are limited to non-commercial use.** "The DNSBL Public Mirror is provided free of charge for non-commercial use by small and medium sized organisations." (Fair Use Policy 1.1.1.) **Not documented:** whether queries from Cloudflare Workers' resolvers are answered. Spamhaus is known to refuse queries from large public resolvers; that is **not verified** here and a spike would have to test it.

### 3.3 SURBL

Sources: [Lists](https://surbl.org/lists), [FAQ](https://surbl.org/faqs), [Usage policy](https://surbl.org/usage-policy), [home page](https://surbl.org/).

- **Confirmed: SURBL's position on shorteners.** "The big picture solution is for the redirection sites to block abusive sites on their own. In other words, they should not let abusers redirect through their sites. Some redirection sites, such as tinyurl.com, reportedly actively block and report abusers of their site. Others such as Metamark and SnipURL are using SURBL intelligence to deny abusers access to their redirection services." (FAQ, "How are redirection sites handled?")
- **Confirmed: SURBL tracks shorteners specifically.** "Shortener domain list is a list of URI shortener services that we are aware of, from major ones like bit.ly, t.co, to many more minor, hobbyist shorteners." "Abused shortener URI list contains specific recently appeared abused shortener URIs." HASHBL categories include "abuse - URIs such as shorteners used in spam", "malware - URIs such as shorteners used to host malware" and "phish - URIs such as shorteners used for phishing". (Home page and Lists.) These datasets are "available with granted access".
- **Inference** (from the per-URI list and the hash list): SURBL can list one abused Short URL without listing the shortener's domain. **Not documented:** when a shortener's domain itself goes onto the public `multi` list.
- **Confirmed: SURBL keeps a whitelist.** "The whitelists are intended to be a safety backstop to make sure domains with legitimate uses don't get added." **Not documented:** how a domain gets onto it.
- **Confirmed: delisting.** "To request removal from a SURBL list, please start with the the SURBL Lookup page and follow the instructions on the removal form."
- **Confirmed: free use is limited.** The free query service is for "organizations that have fewer than 1,000 users or that scan fewer than 250,000 messages per day" and "does not include embedding our data in any way into products or services for which a fee is charged."
- **Not documented:** that SURBL notifies a listed domain's owner.

### 3.4 Others

Not researched: Microsoft Defender SmartScreen, PhishTank, OpenPhish, abuse.ch URLhaus, and the reputation lists inside mail and security products. The ticket names Google Safe Browsing, Spamhaus DBL and SURBL "and similar"; these would each need their own policy page read.

---

## 4. Intake conventions

Sources: [RFC 2142](https://www.rfc-editor.org/rfc/rfc2142.txt), [RFC 9116](https://www.rfc-editor.org/rfc/rfc9116.txt).

### 4.1 `abuse@` (RFC 2142)

- **Confirmed: `abuse@` is the conventional mailbox, and it is for complaints about behaviour.** The table reads "ABUSE — Customer Relations — Inappropriate public behaviour".
- **Confirmed: it must exist at the top-level domain name.** "For well known names that are not related to specific protocols, only the organization's top level domain name are required to be valid. For example, if an Internet service provider's domain name is COMPANY.COM, then the <ABUSE@COMPANY.COM> address must be valid and supported".
- **Confirmed: RFC 2142 sets no response time and no content for a reply.** The RFC defines names only (Standards Track, May 1997): "if a given service is offerred, then the associated mailbox name(es) must be supported, resulting in delivery to a recipient appropriate for the referenced service or role."
- **Inference** (from ADR 0013): a deployment's domain is dedicated to the shortener, so `abuse@<the deployment's domain>` needs mail routing on that zone. Whether the zone receives mail at all is a design question for the grilling ticket.

### 4.2 `security.txt` (RFC 9116)

- **Confirmed: it is for vulnerability reports, not abuse reports.** "This document defines a text file to be placed in a known location that provides information about vulnerability disclosure practices of a particular organization." "'vulnerability response' refers to reports of product vulnerabilities, which is related to but distinct from reports of network intrusions and compromised websites ('incident response'). The mechanism defined in this document is intended to be used for the former".
- **Confirmed: using it for incidents is discouraged.** §5.1: "While it is not recommended, implementors may choose to use the information published within a 'security.txt' file for an incident response."
- **Confirmed: required content.** Two fields are mandatory:
  - `Contact`: "This field MUST always be present". A web URI "MUST begin with 'https://'"; email uses `mailto:`.
  - `Expires`: "This field MUST always be present and MUST NOT appear more than once." "It is RECOMMENDED that the value of this field be less than a year into the future".
  - Optional: `Policy` ("a link to where the vulnerability disclosure policy is located"), `Canonical`, `Encryption`, `Acknowledgments`, `Preferred-Languages`, `Hiring`.
- **Confirmed: location and format.** "organizations MUST place the 'security.txt' file under the '/.well-known/' path". "the file access MUST use the 'https' scheme ... It MUST have a Content-Type of 'text/plain' with the default charset parameter set to 'utf-8'". It applies only to "the domain or IP address in the URI used to retrieve it, not to any of its subdomains or parent domains."
- **Confirmed: a stale file is worse than none.** "Not having a 'security.txt' file may be preferable to having stale information in this file."
- **Inference** (from the location rule and ADR 0002's reserved aliases): serving it means the path `/.well-known/security.txt` on the deployment's domain is not a Short code.

### 4.3 A published abuse policy

- **Not documented: no standard says what a site's abuse policy must contain.** The nearest primary texts bind registrars, not site operators: RAA 3.18.1 ("publish an email address or webform to receive such reports on, or conspicuously and readily accessible from, the home page") and 3.18.4 ("publish on its website a description of its procedures for the receipt, handling, and tracking of abuse reports").
- **Secondary:** what comparable shorteners publish is in section 5.

### 4.4 What response time reporters expect

- **Confirmed, Cloudflare to its customer:** 24 hours (section 1.2).
- **Confirmed, registrars:** confirm receipt to every reporter; 24 hours to review reports from authorities; otherwise "reasonable and prompt" (RAA 3.18.1, 3.18.3).
- **Confirmed, Spamhaus:** "process that information promptly", with no figure.
- **Not documented: a response time that an ordinary reporter expects from a site operator.** No RFC sets one. M3AAWG's "Abuse Desk Common Practices" is the usual industry reference; its PDF was downloaded from [m3aawg.org](https://www.m3aawg.org/sites/default/files/document/MAAWG_Abuse_Desk_Common_Practices.pdf) but its text could not be extracted in this environment, so nothing is quoted from it.

---

## 5. What comparable shorteners publicly document

Everything here is **Secondary**: vendors' own trust pages, help articles, terms and source code. None of them claims that the practice keeps the domain off a blocklist.

| Shortener | Create-time check | On detection or report | Public intake | Source |
|---|---|---|---|---|
| **Bitly** | "Once a Bitly link has been created, the destination URL for that short link gets sent to a service we call the Crawler", then to a "Threat Detection Service". Inputs: its own detection, "our trusted partners", and "a form that anyone can use" | A warning page that "shows the long URL but advises you to not click it", or a block page where "you won't see the long URL" | Report form, also used for false positives | [Trust Center](https://bitly.com/pages/trust), [abuse system overview](https://bitly.com/blog/trust-safety-abuse-system/) (2023-02-21) |
| **Rebrandly** | Not quoted here | "Immediately suspend the link ... anyone clicking the link will be redirected to a 404 error page". "Suspend the Rebrandly account of any user creating these links" | Contact / report | [Help centre](https://support.rebrandly.com/en/articles/565049-how-does-rebrandly-handle-reports-of-harmful-and-abusive-short-links) |
| **is.gd** | "We can reject URLs when they are submitted ... (e.g. if they appear on a blacklist we consult)". Refuses links to "other URL shortening or redirection sites" | "later remove, disable or redirect shortened URLs". Creators "cannot later delete them or modify their destinations (this helps to prevent abuse)" | "Report Abuse" page | [Terms](https://is.gd/terms.php) |
| **Dub** (open source) | `maliciousLinkCheck(url)`: a domain blacklist, then a model-based check; a hit returns "Malicious URL detected" | Not quoted here | Web form with name, email, link, abuse type and reason | [Report Abuse](https://dub.co/legal/abuse), [source](https://github.com/dubinc/dub/blob/main/apps/web/lib/api/links/malicious-link-check.ts) |
| **YOURLS** (self-hosted) | Plugins only: "Google Safe Browsing — Check every new URL against Google's Safe Browsing Lookup service", Phishtank plugins | "Compliance — Anti-abuse plugin, designed to address link complaints from 3rd parties" | None built in | [Plugin list](https://github.com/YOURLS/awesome) |
| **Kutt** (self-hosted) | No URL-reputation setting appears in `.example.env` or the README on `main` | Not documented there | `REPORT_EMAIL`: "The email address that will receive submitted reports" | [.example.env](https://github.com/thedevs-network/kutt/blob/main/.example.env) |

- **Confirmed (as vendor statements):** the three practices the ticket names all appear: create-time reputation checks (Bitly, is.gd, Dub, YOURLS plugins), interstitials (Bitly) and report forms (Bitly, Dub, is.gd, Kutt).
- **Two sources disagree about interstitials.** Bitly shows a warning page that reveals the Target URL for its "warn" category. Spamhaus advises against exactly that: "Don't provide an interstitial link to the spammer's payload if abuse is detected: Fully suspend the offending URL (404 or 410 HTTP return)." Rebrandly returns a 404.
- **Could not be fetched:** TinyURL's terms (the page returned a JavaScript shell), and the Rebrandly and Short.io abuse-policy URLs tried (404). Nothing is claimed about TinyURL or Short.io.

---

## 6. Were the reviews right?

| Review claim | Verdict | Basis |
|---|---|---|
| "Account suspension over abusive Links is a realistic trigger for a shortener." (security review, finding 3) | **Right that it is a documented possibility.** How likely it is, is not documented | Obligations page: failure to respond or to address a report "may result in ... suspension or termination of Cloudflare services for the associated account". Developer Platform terms: "may result in suspension or termination of Cloudflare Services". The abuse policy narrows it to services "repeatedly used to store content in violation of our policy and that no meaningful steps have been taken", but §8 of the agreement reserves termination "for any reason or no reason at all" |
| ADR 0008's accepted risk, that losing the account "can lose everything" (security review, finding 3) | **Right, and the terms support it** | "Cloudflare has no obligation to retain the Customer Content you upload to the Developer Platform following the expiration or termination" |
| "ADR 0013 says the domain can never change but has no registrar lock, auto-renew or expiry check." (security review, finding 6) | **Right** about the ADR's text. Two details: Cloudflare Registrar enables auto-renew by default, and ADR 0013 allows any registrar | ADR 0013 as merged; Renew domains |
| "A lapsed domain hands every Short URL ever issued to whoever buys it." (finding 6) | **Right** as to the mechanism (the name is "released and made available for re-registration"). That the new owner controls every Short URL is an inference from DNS, not a quote. It takes about 75 days at Cloudflare Registrar and can take about 35 elsewhere | Registrar FAQ; ERRP |
| "There is ... no `abuse@` route or `security.txt`." ("No abuse intake") | **Partly right.** `abuse@` is the abuse convention. `security.txt` is not an abuse-intake convention | RFC 9116 scopes itself to "vulnerability disclosure" and calls incident use "not recommended" |
| "Unanswered reports are how shortener domains get suspended or blocklisted." ("No abuse intake") | **Right for Cloudflare suspension. Not supported for blocklists. Unproven for registrars** | Cloudflare ties suspension to failing to respond. Spamhaus lists "automatically" and Google on its own evaluation, with no report to the owner in the loop. The RAA has registrars act on "actionable evidence", with no step that waits for the registrant |
| "abuse that gets the domain blocklisted or the account suspended" is among the most damaging and cheap attacks; what breaks is "the whole deployment" (attacks review) | **The mechanisms are confirmed. The cost to an attacker is not documented** | Hostname-level listing (Spamhaus), whole-domain holds (ICANN), account-level suspension (Cloudflare). No source says how many reports or how much abuse it takes |
| "there is no URL scanning or `abuse@` intake" (attacks review) | **Right** as a description of the design. Create-time checks are what Spamhaus and SURBL ask of shorteners | Spamhaus FAQ; SURBL FAQ |

One point the reviews did not make: an Operator-admitted Creator model does not change Cloudflare's position. "You acknowledge and agree that you are solely responsible for the acts of your End Users."

---

## 7. Open questions

Each is **not documented**; the test that would settle it is given.

1. **Scope of a Cloudflare block** (one Short URL, the hostname or the zone). Test: report a harmless test Link through the abuse form and observe.
2. **Whether a Free or Workers Paid account is "entitled"** to the Abuse reports dashboard page and API. Test: a `doctor` check that calls the Abuse Reports API.
3. **The delay on a pending block**, and whether the 24 hours runs from the email or from the report.
4. **What a suspended account can still read** (R2 backups, KV, Durable Object exports).
5. **Whether Cloudflare Registrar sets `clientTransferProhibited` by default.** Test: RDAP lookup of the deployment's domain.
6. **Whether DBL and SURBL DNS queries work from a Worker,** and whether an Operator's use counts as non-commercial under each fair-use policy.
7. **Whether Google emails a verified Search Console owner on a first Safe Browsing listing.**
8. **When Google or SURBL widen a listing from one Short URL to the whole domain.**
9. **ccTLD registries' abuse and expiry rules,** for a deployment not on a gTLD.
10. **M3AAWG's abuse-desk guidance on response times** (PDF text not extracted).
11. **How fast a released domain is re-registered.**
