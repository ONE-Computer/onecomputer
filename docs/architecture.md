# ONEComputer architecture

ONEComputer is intentionally a thin product layer over OpenVTC/VTI.

```text
administrator
    |
    v
ONEComputer control plane ---- policy and audit ----> PostgreSQL
    |
    +--> employee sandbox --> Claude / agent
    |                              |
    |                              v
    |                     ONEComputer policy gateway
    |                              |
    |              +---------------+----------------+
    |              |                                |
    |          allowed action                    held action
    |                                               |
    |                                               v
    |                                     OpenVTC Trust Task
    |                                               |
    |                                      external wallet
    |                                               |
    |                                  signed proof verified
    |                                               |
    +--------------------------------------- one-time release
```

## Responsibility boundaries

ONEComputer is responsible for:

- company policy authoring and strictest-wins evaluation;
- sandbox lifecycle and employee-facing business workflows;
- connector routing and gateway enforcement;
- durable approval correlation and audit evidence;
- operational controls such as pause, revoke, and delete.

OpenVTC/VTI is responsible for:

- identity, DID/key lifecycle, and trust authority;
- wallet key custody and human consent;
- versioned Trust Task schemas;
- DIDComm/TSP delivery and contentless wake-up;
- signed approval evidence and verification primitives.

The browser control plane must never become the approval authority or hold a
manager private key. A database status is not authorization: the gateway must
verify the signed response, action binding, challenge, expiry, approver
authority, and replay state before releasing a held request.

## Repository boundaries

The ONEComputer application repository is built and hosted as the product.
OpenVTC components are maintained in separate organization forks and consumed
as pinned dependencies or separately hosted services. A repository is not
included in the application merely because it is cloned beside it.

See the [ONEComputer organization site](https://one-computer.github.io/) for
the current repository map, local development path, and promotion gates.
