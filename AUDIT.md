# Public audit boundary

This repository export intentionally excludes historical audit records that
may contain third-party reference tokens, internal URLs, tenant identifiers,
or deployment-only evidence. Those records belong in the private engineering
handover and are not part of the public source distribution.

Security-sensitive configuration must be supplied through the documented
environment and secret-manager interfaces. Never commit credentials,
provider tokens, private keys, or generated deployment state.
