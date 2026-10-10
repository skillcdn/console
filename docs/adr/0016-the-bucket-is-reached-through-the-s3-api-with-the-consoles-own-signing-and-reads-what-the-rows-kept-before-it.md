# ADR-0016: The bucket is reached through the S3 API with the console's own signing, on one pair of keys, and reads what the rows kept before it

- Status: Accepted
- Date: 2026-10-11

## Context

The files runs hand in and people attach to documents are kept behind the blob-store port, in rows of PostgreSQL so that the smallest install has one dependency ([ADR-0002](0002-one-image-one-database-and-the-main-repositorys-toolchain.md)). On a cloud the bytes belong in a bucket, and every cloud, as every self-hosted store worth the name, offers the S3 API, so one implementation covers them all. Two questions remained: how the console talks to it, with a cloud's SDK, which brings that cloud's way of finding credentials and a large dependency with it, or with the API as a protocol, which every store checks the same way, Signature Version 4; and what becomes of the files an installation kept in rows before it was given a bucket.

## Decision

1. **The S3 API as a protocol, signed by the console.** The second implementation of the blob-store port, `apps/console/src/adapters/s3-blob-store.ts`, sends plain HTTPS requests to the store and signs them itself with Signature Version 4, checked against the examples the API's documentation publishes. No SDK; nothing in the code names a cloud.
2. **One pair of keys, from configuration.** `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` together, or none; `S3_REGION`, `S3_SESSION_TOKEN`, `S3_KEY_PREFIX` and `S3_PATH_STYLE` with them; the secrets take `_FILE` as every secret does. Credentials a platform hands a container some other way, a role or a metadata service, are not read: that is one cloud's way, and it would be the first code here that names one.
3. **One object per file, under its hash.** The key is the prefix and the SHA-256 of the bytes; the hash travels with the request, so the store keeps nothing it did not receive whole; what is read back is checked against the hash it was asked by. The rows of artifacts and of files attached keep the name, the size and the media type, as before.
4. **The rows stay readable.** With a bucket configured, the bucket is where files go, and a hash the bucket has nothing under is read from the rows: an installation that moves to a bucket loses nothing and copies nothing. The table is not written again.
5. **A bucket that is wrong stops the boot; one that is away does not.** The `api` role asks the bucket whether it is there at start: no such bucket, or one served from elsewhere, is a configuration error (exit `78`); no answer, or a refusal to say, is logged and tried again with the first file. A file that cannot be kept or read because the bucket is away is `503 file.store_unavailable` to the client, with `retry-after`, and nothing is written on the run or the page.

## Consequences

- A cloud deployment is the image, a managed PostgreSQL and a bucket, as ADR-0002 said, with the bucket's keys in the platform's secret store beside the database's ([deploy/README.md](../../deploy/README.md#the-bucket)).
- The console signs with keys that are rotated by hand, as the database's password is; temporary credentials work through `S3_SESSION_TOKEN`, and the console does not renew them. Reading a platform's own credentials would be an adapter of a port of its own, if a deployment ever needs it.
- The integration tests run against a real store with the S3 API, as the database tests run against real PostgreSQL: `deploy/compose.dev.yaml` carries one and CI starts the same.
- Rejected: a cloud's SDK (a large dependency in the image for four kinds of request, and ways of finding credentials that a self-hosted store does not have); a port wider than put and get (nothing needs it); copying the rows into the bucket when one is configured (a copy nobody asked for, and the rows read fine).
