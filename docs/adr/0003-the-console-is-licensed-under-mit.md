# ADR-0003: The console is licensed under MIT

- Status: Accepted
- Date: 2026-10-09

## Context

The main repository is source-available under FSL-1.1-ALv2, which reserves one thing: offering SkillCDN itself as a competing commercial service. That reservation protects the product. The console is the reference console (ADR-0001): an example that follows the standard and is meant for real use, published so that anyone can build their own from it. A restriction on it would protect nothing the main repository's license does not already protect, and would make it a worse example and a worse starting point.

## Decision

- The console, everything in this repository, is licensed under the MIT License, unmodified. The published package `@skillcdn/console` carries the same license.
- The `@skillcdn/*` packages the console depends on are the main repository's and keep its license, FSL-1.1-ALv2. They are installed from npm under that license; none of their code is copied here. `pnpm check:licenses` allows those packages by name and otherwise permits only permissive licenses, as the main repository does.
- Names and logos stay governed by the main repository's trademark policy: the MIT License does not license trademarks, and the console uses the marks as the project's own product.
- Contributions are accepted under the MIT License, without a separate contributor agreement.

## Consequences

- Anyone can take the console, change it and ship it, under any terms, as long as the notice stays. A custom console built from the package owes nothing beyond the notice.
- The protection of SkillCDN as a product lies in the main repository alone; this repository must never carry anything that needs protecting.
- A console that is distributed modified cannot be called SkillCDN's; that is the trademark policy, not the license.
- Rejected: FSL-1.1-ALv2 like the main repository (protects nothing more and gets in the way of the example's purpose); Apache 2.0 (its patent and notice terms are more than this needs, and MIT is what people expect of a starting point).
