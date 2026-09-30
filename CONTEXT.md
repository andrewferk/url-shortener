# URL Shortener

A service that maps short, memorable URLs to long ones and redirects visitors to the original destination.

## Language

### Links

**Link**:
The stored mapping from a Short code to a Target URL, optionally carrying an Expiry.
_Avoid_: Short URL (as a name for the record), mapping, entry

**Short code**:
The case-sensitive key that identifies a Link in its short URL: 7 random base62 characters when generated. Unique across all Links, and never reused once issued.
_Avoid_: Slug, hash, key, token

**Short domain**:
A domain that a deployment of the service answers Redirects on. It is given to the deployment, not chosen by the service.
_Avoid_: Vanity domain, host

**Short URL**:
A Short domain followed by a Short code: the address a Visitor follows.
_Avoid_: Short link, shortened URL

**Custom alias**:
A Short code chosen by the Creator rather than generated: 3–32 characters of letters, digits, `-` and `_`. Shares one namespace with generated Short codes.
_Avoid_: Vanity URL, custom slug

**Target URL**:
The URL a Link redirects to.
_Avoid_: Long URL, original URL, destination URL

**Expiry**:
The optional moment after which a Link stops redirecting. Set when the Link is created and never changed.
_Avoid_: TTL, expiration time

**Expired link**:
A Link past its Expiry. It answers 410 Gone and its Short code is never reissued.

**Deleted link**:
A Link its Creator has deleted, or the Operator has taken down. The deletion is permanent: it answers 410 Gone and its Short code is never reissued.
_Avoid_: Disabled link, removed link, inactive link

**Takedown**:
The Operator's deletion of a Link, made for a stated reason. The Link becomes a Deleted link that records the Operator, not its Creator, as the one who deleted it.
_Avoid_: Ban, block, removal

### People

**Creator**:
An authenticated caller, a person or an automation, whom the Operator has admitted to create Links. A Creator's identity outlives any credential it authenticates with, and it may delete only the Links it created.
_Avoid_: User, owner, account

**Operator**:
The person who runs the service: admits and removes Creators and can take down any Link. Not a kind of Creator; the Operator acts through the service's infrastructure, never through the Link API.
_Avoid_: Admin, superuser

**Visitor**:
Anyone, unauthenticated, who follows a short URL.
_Avoid_: User, client

### Operations

**Link API**:
The authenticated HTTP interface on the API subdomain through which Creators create, read, list and delete their own Links.
_Avoid_: Admin API, management API

**Redirect**:
Answering a Visitor's request for a short URL: a 302 to the Target URL for a live Link, 410 Gone for an Expired or Deleted link, and 404 when no Link has that Short code.
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

**Probe**:
A synthetic Redirect request made from outside the service to measure uptime.
_Avoid_: Health check, ping

**Canary link**:
The Link that Probes follow. Its Redirects count toward Redirect latency but not request volume.
_Avoid_: Test link, health link
