# Sizing and cost: three sizes, and what each costs

How the organization's size becomes a size of the deployment, what each size is made of, how its monthly cost is estimated before anything is made, and what changes when the organization grows. Every price here is a snapshot that illustrates the shape, marked with the month it was read; the run reads today's prices where it can, shows those, and says which lines are still the snapshot.

## The sizes

The question is how many people will use the console within a year; an answer stands for the run and is written in the record. Growing later is a change of numbers (below).

| Size | For | The `api` service | The `worker` | The database | What else |
|---|---|---|---|---|---|
| `small` | Up to 10 people | One task, 0.25 vCPU, 0.5 GB, carrying the worker's work (`WORKER_IN_PROCESS=true`) | In the `api` task | One instance, the smallest class with 1 GB of memory (`db.t4g.micro`), 20 GB growing to 100, one zone | A bucket, the parameter store, one public address for the task's egress |
| `medium` | Up to 30 people | One task, 0.5 vCPU, 1 GB, carrying the worker's work | In the `api` task | One instance with 2 GB (`db.t4g.small`), 20 GB growing to 100, one zone | The same |
| `large` | Up to 100 people | Two tasks, 0.5 vCPU, 1 GB each | A service of its own, one task, 0.25 vCPU, 0.5 GB | One instance with 4 GB (`db.t4g.medium`), 20 GB growing to 200; in two zones when the organization wants the database to survive a zone | The same, with three public addresses |

The board is a light load: a page, a feed held open per browser tab with a heartbeat every 25 seconds, a command now and then from each agent. What grows with people is the number of open feeds (memory and connections) and the database's working set, not the CPU. These sizes leave room; the delivery says how to read the gauges (below) and the record says which size was chosen.

## What is billed

| Item | How it is billed | Illustrative price, N. Virginia (`us-east-1`), read 2026-10 |
|---|---|---|
| Fargate tasks | Per vCPU-hour and per GB-hour of each task, per second, a minute at least; x86 by default, ARM about a fifth cheaper when the image is built for it | x86 $0.04048 per vCPU-hour, $0.004445 per GB-hour; ARM $0.03238 and $0.00356 |
| Public IPv4 address, one per task | Per hour | $0.005 per hour, about $3.65 a month |
| RDS PostgreSQL instance | Per hour by class; two zones doubles it | `db.t4g.micro` $0.016 per hour, `db.t4g.small` $0.032 per hour, `db.t4g.medium` about twice the small |
| RDS storage, `gp3` | Per GB-month of what is allocated; backups up to the instance's size are free | $0.115 per GB-month |
| S3 | Per GB-month and per request; a board's files are small | $0.023 per GB-month |
| ECR | Per GB-month of images kept | $0.10 per GB-month |
| CloudWatch Logs | Per GB ingested and per GB-month kept, 30 days here | $0.50 per GB ingested, $0.03 per GB-month |
| SSM Parameter Store | Standard parameters free; the certificate bundle is an advanced parameter | $0.05 per advanced parameter a month |
| Cloudflare | The Free plan: DNS, the proxy, the tunnel, one rate limiting rule, certificates | $0 |
| A domain | Per year, at cost through the Registrar | About $10 a year for a `.com` |
| GitHub Actions | Minutes of the deployment repository's builds; a build takes about ten | Within the minutes a plan includes |

Other regions are dearer by a tenth to a third for the same items (Tokyo's ARM task rates were about a quarter above N. Virginia's, read 2026-10); Seoul's rates are read from the price list in the run. A new AWS account made after 2025-07-15 starts with credits ($100 at sign-up, up to $200 with the first activities), which the paid plan spends on these bills over the first months; the free plan ends after six months and is not for a console that stays.

## The estimate, size by size

Illustrative, from the prices above, x86 tasks, one zone, 730 hours a month, read 2026-10. The run recomputes each line with the prices of the day and the region, and shows the chosen size with the next one beside it.

| Size | Tasks | Addresses | Database | Storage, logs, images | About |
|---|---|---|---|---|---|
| `small` | $9 | $4 | $12 | $3 | $28 a month |
| `medium` | $18 | $4 | $23 | $4 | $49 a month |
| `large` | $45 | $11 | $47 (one zone) or $95 (two) | $6 | $109 a month, $157 in two zones |

A domain is on top, per year. Cloudflare costs nothing on the Free plan.

## Reading today's prices

The two lines that matter, the tasks and the database, come from the Price List API, which answers from `us-east-1` whatever the region priced (the deployer's policy allows `pricing:GetProducts`); the small lines (the address, storage, logs, images) from the pricing pages, or the snapshot with the region's premium stated. The database's instance, per hour:

```sh
aws pricing get-products --region us-east-1 --service-code AmazonRDS \
  --filters Type=TERM_MATCH,Field=instanceType,Value=<db.t4g.micro | db.t4g.small | db.t4g.medium> \
            Type=TERM_MATCH,Field=databaseEngine,Value=PostgreSQL \
            Type=TERM_MATCH,Field=deploymentOption,Value=<Single-AZ | Multi-AZ> \
            Type=TERM_MATCH,Field=regionCode,Value=<region> \
  --query 'PriceList[0]' --output text | jq -r '.terms.OnDemand[] | .priceDimensions[] | .pricePerUnit.USD'
```

The tasks, per vCPU-hour and per GB-hour, by the usage type of the region (`APN2` for Seoul, `APN1` for Tokyo, `EUC1` for Frankfurt, `EUW1` for Ireland, `USE2` for Ohio, no prefix for N. Virginia; `ARM-` before `vCPU` and `GB` for ARM tasks):

```sh
for usage in "<prefix>-Fargate-vCPU-Hours:perCPU" "<prefix>-Fargate-GB-Hours"; do
  aws pricing get-products --region us-east-1 --service-code AmazonECS \
    --filters Type=TERM_MATCH,Field=usagetype,Value="$usage" Type=TERM_MATCH,Field=regionCode,Value=<region> \
    --query 'PriceList[0]' --output text | jq -r '.terms.OnDemand[] | .priceDimensions[] | .pricePerUnit.USD'
done
```

The pages, each with the region selected, for the rest: the public IPv4 charge on the EC2 pricing page (`aws.amazon.com/ec2/pricing/on-demand`, "IPv4 address"), S3 (`aws.amazon.com/s3/pricing`), ECR, CloudWatch; or the AWS Pricing Calculator. A lookup that fails is said so in the plan, and that line is the snapshot with the premium of "What is billed" applied, named as an estimate. State in the plan where each number came from and the month.

## The estimate message

Part of the plan, in plain words, one line per item, the chosen size first:

> For <n> people I would set it up as **<size>**: <what it is made of, in words>. That is about **<total> a month** in <region> (<tasks>, <database>, <addresses>, <the rest>; <which lines are today's prices and which the snapshot>)<, plus the domain at <price> a year when one is bought>. The next size up, **<size>**, would be about <total> a month and is a change of numbers later, not a new deployment. A budget alert at <total × 1.5> will email <address> when the month's bill runs past it, or is forecast to.

## Options the plan offers

- **The database as serverless capacity.** Aurora Serverless v2 for PostgreSQL scales its capacity with load, down to nothing when idle (0 ACU with automatic pause, since 2024-11). The console holds a listening connection open and sweeps every fifteen minutes, so it never idles and the database never pauses: the floor is 0.5 ACU, about $44 a month at $0.12 per ACU-hour (read 2026-10), more than the `small` and `medium` instances. Offer it when the organization wants capacity that follows load without resizing, and say the floor.
- **The bucket on Cloudflare R2** instead of S3: the same S3 API, keys made in the Cloudflare dashboard, `S3_ENDPOINT=https://<account id>.r2.cloudflarestorage.com`, `S3_REGION=auto`, path style; no egress charges. Offer it when the organization keeps its files at Cloudflare already; S3 stays the default because the keys, the budget and the audit are then in one account.
- **A load balancer instead of the tunnel.** ECS Express Mode creates an Application Load Balancer with HTTPS on an AWS domain in one command, at about $16 to $23 a month for the balancer (read 2026-10); the custom domain is a manual step on the balancer, and Cloudflare then proxies to it. Offer it only when the organization does not want its traffic through the tunnel; the tunnel is the default because it costs nothing, exposes nothing, and brings the client's address to the console cleanly.
- **ARM tasks** when the organization has ARM runners for its builds (building for ARM on an x86 runner takes many times longer): a fifth off the task line.

## Growing

- **More people:** change the task sizes and counts in `deploy/api.task.json` and `deploy/worker.task.json` of the deployment repository and push; the services roll. At `large`, the `worker` becomes a service of its own and `WORKER_IN_PROCESS` is dropped from the `api` task; `deploy.yml` deploys both.
- **A bigger database:** `aws rds modify-db-instance --db-instance-identifier <name> --db-instance-class <class> --apply-immediately` (a few minutes of unavailability; do it when nobody works) and, for two zones, `--multi-az`. Storage grows on its own up to the maximum set.
- **Reading the gauges:** the ECS service's CPU and memory in CloudWatch (`AWS/ECS`, by cluster and service), the database's `FreeableMemory` and `DatabaseConnections` (`AWS/RDS`). Memory above 70% or connections near the instance's limit (87 on a `t4g.micro`) says the next size is due.
- **Fewer people, or a trial that ended:** the opposite; or `aws ecs update-service --desired-count 0` for both services and `aws rds stop-db-instance` (seven days at most, then it starts itself) to pause the deployment at the cost of storage alone.
