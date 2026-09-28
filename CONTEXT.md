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

**Custom alias**:
A Short code chosen by the Creator rather than generated: 3–32 characters of letters, digits, `-` and `_`. Shares one namespace with generated Short codes.
_Avoid_: Vanity URL, custom slug

**Target URL**:
The URL a Link redirects to.
_Avoid_: Long URL, original URL, destination URL

**Expiry**:
The optional moment after which a Link stops redirecting.
_Avoid_: TTL, expiration time

**Expired link**:
A Link past its Expiry. It answers 410 Gone and its Short code is never reissued.

**Deleted link**:
A Link its Creator has deleted. The deletion is permanent: it answers 410 Gone and its Short code is never reissued.
_Avoid_: Disabled link, removed link, inactive link

### People

**Creator**:
An authenticated caller permitted to create Links.
_Avoid_: User, owner, account

**Visitor**:
Anyone, unauthenticated, who follows a short URL.
_Avoid_: User, client

### Operations

**Redirect**:
Answering a Visitor's request for a short URL: a 302 to the Target URL for a live Link, 410 Gone for an Expired or Deleted link, and 404 when no Link has that Short code.
_Avoid_: Lookup, resolve, forward

**Status page**:
The public page reporting the service's uptime, Redirect latency percentiles, and request volume over time.
_Avoid_: Dashboard, metrics page

**Redirect event**:
The record of one Redirect: its Short code, outcome, and duration.
_Avoid_: Hit, click (reserved for future click analytics)

**Probe**:
A synthetic Redirect request made from outside the service to measure uptime.
_Avoid_: Health check, ping

**Canary link**:
The Link that Probes follow. Its Redirects count toward Redirect latency but not request volume.
_Avoid_: Test link, health link
