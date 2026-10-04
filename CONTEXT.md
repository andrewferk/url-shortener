# URL Shortener

A service that maps short, memorable URLs to long ones and redirects visitors to the original destination.

## Language

### Links

**Link**:
The stored mapping from a Short code to a Target URL, optionally carrying an Expiry. Its fields never change after creation; the only change a Link makes is to become a Deleted link, which only a Void reverses.
_Avoid_: Short URL (as a name for the record), mapping, entry

**Short code**:
The case-sensitive key that identifies a Link in its Short URL: 7 random base62 characters when generated. Unique within its Namespace, and never reused there once issued. Only a disaster that loses the record of a Link can break this.
_Avoid_: Slug, hash, key, token

**Namespace**:
The scope within which a Short code is unique. Every Link belongs to exactly one Namespace, and each Short domain serves exactly one. A Deployment starts with a single default Namespace.
_Avoid_: Tenant, workspace, domain

**Short domain**:
A domain that a Deployment answers Redirects on, for one Namespace. It is given to the Deployment, not chosen by the service.
_Avoid_: Vanity domain, host

**Short URL**:
A Short domain followed by a Short code: the address a Visitor follows.
_Avoid_: Short link, shortened URL

**Custom alias**:
A Short code chosen by the Creator rather than generated: 3–32 characters of letters, digits, `-` and `_`. Shares its Namespace with generated Short codes.
_Avoid_: Vanity URL, custom slug

**Target URL**:
The URL a Link redirects to. Set when the Link is created and never changed, and erased when the Link is deleted. The one copy kept is in the Operator's record of a Takedown.
_Avoid_: Long URL, original URL, destination URL

**Expiry**:
The optional moment after which a Link stops redirecting. Set when the Link is created and never changed.
_Avoid_: TTL, expiration time

**Expired link**:
A Link past its Expiry. It answers 410 Gone and its Short code is never reissued.

**Deleted link**:
A Link its Creator has deleted, or the Operator has taken down. The deletion is permanent unless the Operator voids it: it answers 410 Gone, its Target URL is erased, and its Short code is never reissued.
_Avoid_: Disabled link, removed link, inactive link

**Takedown**:
The deletion of a Link by the Operator, or by the service on the Operator's behalf, made for a stated reason. The Link becomes a Deleted link that records the Operator, not its Creator, as the one who deleted it.
_Avoid_: Ban, block, removal

**Void**:
The Operator's cancelling of a delete that was forged or was the Operator's own mistake. The Link is live again with every field as it was.
_Avoid_: Undelete, restore, revive

**Redirect hijack**:
A Short URL answering with anything other than what its Link says, without the Link having been deleted.
_Avoid_: Link tampering, re-pointing

**Abuse report**:
A claim, from anyone, that a Link's Target URL is harmful, sent to the Deployment's abuse address. The Operator answers it; a confirmed report ends in a Takedown.
_Avoid_: Complaint, flag

### People

**Creator**:
An authenticated caller, a person or an automation, whom the Operator has admitted to create Links. A Creator's identity outlives any credential it authenticates with, and it may delete only the Links it created.
_Avoid_: User, owner, account

**Suspended Creator**:
A Creator barred from the Link API until the Operator resumes it. Its Links keep redirecting, and it is still a Creator.
_Avoid_: Banned, disabled, blocked

**Operator**:
The person who runs the service: admits and removes Creators and can take down any Link. Not a kind of Creator; the Operator acts through the service's infrastructure, never through the Link API.
_Avoid_: Admin, superuser

**Visitor**:
Anyone, unauthenticated, who follows a Short URL.
_Avoid_: User, client

### Operations

**Deployment**:
One running instance of the service, run by one Operator, with its own Cloudflare accounts, Short domains and Namespaces.
_Avoid_: Instance, install

**Ops repo**:
The repository an Operator runs one Deployment from. It holds that Deployment's configuration and credentials; the service's own repository holds neither.
_Avoid_: Config repo, deploy repo

**Link API**:
The authenticated HTTP interface on the API subdomain through which Creators create, read, list and delete their own Links.
_Avoid_: Admin API, management API

**Operator CLI**:
The command-line interface through which the Operator admits and removes Creators, takes down Links and restores data.
_Avoid_: Admin API, admin tool

**Redirect**:
Answering a Visitor's request for a Short URL: a 302 to the Target URL for a live Link, 410 Gone for an Expired or Deleted link, and 404 when no Link has that Short code in the Short domain's Namespace.
_Avoid_: Lookup, resolve, forward

**Status page**:
The public page reporting the service's uptime, Redirect latency percentiles, and request volume over time, and how the service stands against its Objectives.
_Avoid_: Dashboard, metrics page

**Objective**:
A target the Status page reports the service against, over a rolling 30 days: uptime, Redirect latency, or error rate. A published target, not a promise.
_Avoid_: SLA, commitment

**Error budget**:
The share of an Objective's window that may fall short of its target before the Objective is breached.
_Avoid_: Allowance

**Redirect event**:
The record of one Redirect: its Short code, outcome, and duration.
_Avoid_: Hit, click (reserved for future click analytics)

**Redirect flood**:
Redirect volume, of every outcome, sustained above the rate the Operator has set as abnormal. It is a cost signal, not a verdict that the traffic is hostile.
_Avoid_: Attack, spike, DDoS

**Probe**:
A synthetic Redirect request made from outside the service to measure uptime.
_Avoid_: Health check, ping

**Probe location**:
A place outside the service from which Probes are made. Uptime is judged across all Probe locations together, never by one alone.
_Avoid_: Region, vantage point

**Probe-minute**:
One minute of the uptime Objective's window, judged up, down, or unobserved by the Probes that cover it.
_Avoid_: Probe run, check, tick

**Canary link**:
The Link that Probes follow. Its Redirects count toward the Status page's Redirect latency percentiles, but not toward request volume or any Objective.
_Avoid_: Test link, health link
