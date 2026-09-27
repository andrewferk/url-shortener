# URL Shortener

A service that maps short, memorable URLs to long ones and redirects visitors to the original destination.

## Language

### Links

**Link**:
The stored mapping from a Short code to a Target URL, optionally carrying an Expiry.
_Avoid_: Short URL (as a name for the record), mapping, entry

**Short code**:
The 5–7 character base62 key that identifies a Link in its short URL. Unique across all Links, and never reused once issued.
_Avoid_: Slug, hash, key, token

**Custom alias**:
A Short code chosen by the Creator rather than generated. Shares one namespace with generated Short codes.
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
Resolving a Short code and answering the Visitor with a 302 to the Target URL.
_Avoid_: Lookup, resolve, forward

**Status page**:
The public page reporting the service's uptime, Redirect latency percentiles, and request volume over time.
_Avoid_: Dashboard, metrics page
