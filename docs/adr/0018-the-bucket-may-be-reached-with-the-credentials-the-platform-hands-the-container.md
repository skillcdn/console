# ADR-0018: The bucket may be reached with the credentials the platform hands the container, through a port of their own

- Status: Accepted
- Date: 2026-10-11

## Context

[ADR-0016](0016-the-bucket-is-reached-through-the-s3-api-with-the-consoles-own-signing-and-reads-what-the-rows-kept-before-it.md) reaches the bucket with the console's own signing on one pair of keys from configuration, and left open reading the credentials a platform hands a container itself. The first deployment of the reference shape on an organization's own accounts ([ADR-0017](0017-the-reference-deployment-is-the-image-on-aws-behind-cloudflare-written-as-a-skill.md), 2026-10-11) found that pair to be the one long-lived credential in the whole deployment: the database's password, the tunnel's token and the providers' secrets sit in the platform's secret store and are handed to the tasks, but the bucket's key belongs to a user and lives until somebody rotates it. An operator whose rule is "no long-lived keys" cannot run the reference deployment as written, and the platform already hands every task the credentials of its role, renewed, at an endpoint of its own; the same endpoint serves pods with an identity on the platform's managed Kubernetes.

## Decision

1. **A port for the credentials.** The store asks a `CredentialsSource` (`apps/console/src/ports/credentials.ts`) for the credentials of every request and keeps none. The pair from configuration is one implementation, `fixedCredentials`; the platform's endpoint is the other, `apps/console/src/adapters/container-credentials.ts`.
2. **Chosen by configuration, explicitly.** `S3_CREDENTIALS=keys`, the default, is the pair of `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` as before. `S3_CREDENTIALS=platform` reads the endpoint from the platform's own variables, `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI` at the platform's fixed address or `AWS_CONTAINER_CREDENTIALS_FULL_URI` with `AWS_CONTAINER_AUTHORIZATION_TOKEN` or its `_FILE`, and refuses keys beside it. A full address is `https`, or `http` to the loopback or the platform's own link-local addresses, and nothing else. A console on keys does not read the platform's variables at all, whatever they hold.
3. **The endpoint's protocol, spoken by the console.** One `GET`, a JSON answer with the key, the secret, the token and the expiration, bounded and checked; asked again five minutes before the expiration; the answer in hand serves while the endpoint is away, until it expires; nothing of it is logged. No SDK, as ADR-0016 decided.
4. **What this names, and where.** The variables and the address are one cloud's. They are read in the config module, as every variable is, and nowhere else; the adapter takes an address and a token. The port's other implementation is the keys every store with the S3 API takes, which keeps the rule of [ADR-0002](0002-one-image-one-database-and-the-main-repositorys-toolchain.md): cloud-specific code only behind a port that also has a self-hostable implementation.
5. **The reference deployment uses it.** The task's role carries the policy on the bucket, the tasks run with `S3_CREDENTIALS=platform`, and no user and no key exist for the files. Where ADR-0017 says the files go to the bucket with the console's own keys, this replaces it.

## Consequences

- On the platform's container services, the console holds nothing long-lived for the bucket; what it signs with is renewed by the platform. Every other platform keeps the keys, with `S3_SESSION_TOKEN` for a pair that is temporary by other means.
- At start, credentials that cannot be read are the bucket not answering: logged, and tried again with the first file, as ADR-0016 treats a bucket that is away; never a configuration error, since the endpoint is the platform's to answer.
- The skill of the reference deployment loses a user, a key and a script's mode, and its secrets file carries keys only for a bucket elsewhere ([`skills/deploying-a-console`](../../skills/deploying-a-console/SKILL.md)).
- Rejected: the SDK's chain of credential providers (the SDK, which ADR-0016 rejected, for one provider); reading a virtual machine's metadata service (a machine mounts a credentials file or sets keys; the console runs as containers); detecting the platform from its variables without a setting (a console on keys must not change where its credentials come from because the platform set a variable).
