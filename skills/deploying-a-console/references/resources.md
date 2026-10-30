# The phases in detail: procedure, checks, failures

What each phase of the skill does, command by command, with its checks and what to do when a step fails. Placeholders are in angle brackets. The run keeps its notes (ids, names, endpoints) in `scratch/notes.md` of the run's folder; `DEPLOY.md` is written from them at the end. Facts that move carry the month they were checked; the vendor's reference is the source when one has moved.

## Conventions

The run's folder is the deployment repository to be; `scratch/` in it holds the scripts, the request bodies and the notes, and never enters git. Every AWS command runs as the deployer, in the region of the plan; every Cloudflare call carries the token from its file. Set once per shell, in the run's folder (the shell is bash: Git Bash on Windows, bash or zsh elsewhere):

```bash
export MSYS_NO_PATHCONV=1                 # Git Bash on Windows: keep /console and the like as written
export AWS_PROFILE=console AWS_REGION=<region>
printf 'Authorization: Bearer %s\n' "$(tr -d '\r\n ' < .cf-token)" > scratch/auth.txt   # the header from a file, never on a command line
cf() { curl -sS "https://api.cloudflare.com/client/v4$1" -H @scratch/auth.txt -H "Content-Type: application/json" "${@:2}"; }
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
SECRETS=../console-secrets.json          # outside the repository; made by the first `set` below, never a copy of assets/secrets.example.json
```

Every id the run makes or finds (`CF_ACCOUNT`, `ZONE`, `VPC`, `SUBNETS`, `TASKS_SG`, `DB_SG`, `ENDPOINT`, `BUCKET`, `TUNNEL`, the rules' ids) goes into `scratch/notes.md` as it is made, as a line `NAME=value`, and a new shell sets them again from there (`set -a; . scratch/notes.md; set +a` when the file holds nothing but such lines): phases 5 to 7 come after a ten-minute watch, or after a pause of hours, almost always in a new shell. Where every command runs in a new shell, as some agents' tools do, the lines above go in `scratch/env.sh`, sourced at the start of every command; a wait longer than one command may take (the database, the workflow's run, a sign-in) runs in the background or is polled.

A value that must not be seen goes through a file or a pipe, never a command line: `aws ... --cli-input-json file://scratch/<file>` for a request that carries one, and the two scripts of this skill ([import-aws-key.mjs](../scripts/import-aws-key.mjs), [store-secrets.mjs](../scripts/store-secrets.mjs)), copied to `scratch/`, for the key and the parameters. A response that carries one is piped straight into the secrets file:

```sh
set_secret() { node scratch/store-secrets.mjs set "$SECRETS" "$1"; }   # reads the value from standard input
node -e "process.stdout.write(require('node:crypto').randomBytes(36).toString('base64url'))" | set_secret AUTH_SECRET
```

## Phase 1: Access

1. The folder: `mkdir -p <folder>/scratch && cd <folder> && git init -b main`, and `.gitignore` with `.cf-token`, `.aws-key.csv`, `scratch/`, `*.pem`, `console-secrets.json`, `node_modules/`, `console-ui/dist/`, `.env`, `.env.*`, `.skillcdn-console.json` (which `console use` writes in phase 6, and which belongs to a checkout people work in, not to the deployment), before anything else is written.
2. The command and the scripts: `npm install -g @skillcdn/console`, then copy `$(npm root -g)/@skillcdn/console/skills/deploying-a-console/scripts/*.mjs` into `scratch/` (or write them there from the connection's copy of the skill).
3. The key: the person saved `.aws-key.csv` in the folder ([access.md](access.md)). `node scratch/import-aws-key.mjs .aws-key.csv console` writes the profile and deletes the file. Then `aws configure set region <region> --profile console`.
4. `aws sts get-caller-identity`: the account id and `user/console-deployer`. A refusal means the key is wrong or not yet active (a minute after creation).
5. The network: `aws ec2 describe-vpcs --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text`. `None`: phase 3 "The network" makes one. Then the subnets, once there is a VPC: `aws ec2 describe-subnets --filters Name=vpc-id,Values=<vpc> Name=default-for-az,Values=true --query 'Subnets[].SubnetId' --output text`.
6. The token: `cf /user/tokens/verify` answers `"status": "active"`; `cf "/zones?name=<domain>" > scratch/zone.json` the zone, with its id, its `status` and its account (`ZONE=$(jq -r '.result[0].id' scratch/zone.json)`, `CF_ACCOUNT=$(jq -r '.result[0].account.id' scratch/zone.json)`), or an empty list when the domain is not on Cloudflare yet, in which case `CF_ACCOUNT=$(cf /accounts | jq -r '.result[0].id')` and the zone is made now, as "The zone, first" says: the one thing made before the plan, since it costs nothing, is undone as easily, and its nameservers must reach the person in the second message. A zone that exists: `cf "/zones/$ZONE/dns_records" | jq '.result | length'`; records of its own mean the zone serves the organization's site already, which the access record says and phase 3 "A zone that serves other hosts" acts on.
7. The git host: `gh auth status`; the owner the person named is theirs or an organization they are in (`gh api user`, `gh api user/orgs`).
8. The tools: `node --version` (24 or newer), `git --version`, `jq --version`, `curl --version`.

Report what is missing in one message, with the row of access.md to add, before the plan.

## Phase 2: Plan and estimate

Nothing is created, but for the zone of phase 1, which costs nothing. The size from the answer and its numbers ([sizing.md](sizing.md) "The sizes"); the prices read and the estimate computed ("Reading today's prices"); the names:

| Resource | Name |
|---|---|
| Cluster; services; task families | `console`; `api`, `worker`; `console-api`, `console-worker`, `console-migrate` |
| Database instance, subnet group, user, database | `console`, `console`, `console`, `console` |
| Bucket | `console-files-<account id>` (bucket names are global; the account id makes it unique), read and written by the task's role |
| Image repository, log group | `console`, `/console`; the connector's image in the same repository under `cloudflared-<version>` |
| Roles | `console-task-execution`, `console-task`, `console-github-deploy` |
| Security groups | `console-tasks`, `console-db` |
| Parameters | `/console/<NAME>`, one per secret of the secrets file |
| Tunnel, hostname | `console`, `<hostname>` |
| Deployment repository | `<owner>/<the folder's name>`, private |

The plan message is the estimate message of sizing.md followed by the line in the skill's phase 2.

## Phase 3: Foundation

### The zone, first

Not on Cloudflare yet, and not made in phase 1: `cf /zones -X POST --data '{"name":"<domain>","account":{"id":"'$CF_ACCOUNT'"},"type":"full"}' > scratch/zone.json`, then `ZONE=$(jq -r .result.id scratch/zone.json)`, and the nameservers are `jq -r '.result.name_servers[]' scratch/zone.json`. Before the nameservers change, the zone must carry what the domain serves already (its site, its mail), or that stops working at the switch: `cf "/zones/$ZONE/dns_records/scan" -X POST` has Cloudflare find the common records and add them (checked 2026-10), `cf "/zones/$ZONE/dns_records" | jq -r '.result[] | "\(.type) \(.name) \(.content)"'` lists what the zone now has, and the list goes to the person with the nameserver steps: "Compare this with the DNS page at your registrar and send me anything that is missing", each missing one added with `cf "/zones/$ZONE/dns_records" -X POST --data '{"type":"<MX | A | CNAME | TXT>","name":"<name>","content":"<value>","priority":<MX only>,"ttl":1}'`. Each record the scan added is checked for `proxied` (`cf "/zones/$ZONE/dns_records" | jq -r '.result[] | "\(.id) \(.name) \(.proxied)"'`): a record of the organization's site or mail is set `"proxied":false` (`cf "/zones/$ZONE/dns_records/<id>" -X PATCH --data '{"proxied":false}'`), so that it comes over as it is and nothing of the site passes through Cloudflare until the person asks for that; and the zone's SSL mode (`cf "/zones/$ZONE/settings/ssl"`) is read and said at the plan, since a site proxied later needs `full` or `strict` to keep serving its own certificate. The answer's `name_servers` go to the person with the steps for their registrar (access.md "The domain"), the run goes on, and the hostname answers once `cf "/zones?name=<domain>"` says `"status": "active"`. A domain to buy: `cf "/accounts/$CF_ACCOUNT/registrar/domain-search?q=<words>"` to find one, `cf "/accounts/$CF_ACCOUNT/registrar/domain-check" -X POST --data '{"domains":["<domain>"]}'` for the live price, the checkpoint with the price and the renewal, then `cf "/accounts/$CF_ACCOUNT/registrar/registrations" -X POST --data '{"domain_name":"<domain>"}'`; a `202` is polled at `.../registrations/<domain>/registration-status`. Buying through the API was in beta when checked (2026-10) and is not open to every account: `extension_not_supported_via_api`, a `404` or a route error means the person buys in the dashboard (Domain Registration, Register Domains), with the price in front of them there. A bought domain's zone is active at once, and `ZONE` is read as above.

### The network

No default VPC (phase 1 found `None`): `aws ec2 create-default-vpc` first, free of charge, then its subnets as phase 1 reads them.

```sh
VPC=<vpc>; SUBNETS=<subnet ids, comma-separated>
TASKS_SG=$(aws ec2 create-security-group --group-name console-tasks --description "console tasks: no inbound" --vpc-id $VPC --query GroupId --output text)
DB_SG=$(aws ec2 create-security-group --group-name console-db --description "console database: from the tasks only" --vpc-id $VPC --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id $DB_SG --protocol tcp --port 5432 --source-group $TASKS_SG
```

A new group allows all egress and no ingress; the tasks' group stays so. Check: `aws ec2 describe-security-groups --group-ids $TASKS_SG --query 'SecurityGroups[0].IpPermissions'` is `[]`. What the tasks need out, for an organization that restricts egress later: the connector reaches Cloudflare on `7844` (UDP first, then TCP) and `443`; the console reaches the database on `5432`, and the bucket, the sign-in providers and SkillCDN on `443`.

### The database

Start it now; it takes five to fifteen minutes, during which the rest below is made.

```sh
aws rds create-db-subnet-group --db-subnet-group-name console --db-subnet-group-description console --subnet-ids <the subnet ids, space-separated>
node -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('base64url'))" | set_secret DATABASE_PASSWORD
```

Write `scratch/db.template.json` from this template, with the size's class, and render it with the password from the secrets file (`node scratch/store-secrets.mjs render "$SECRETS" scratch/db.template.json scratch/db.json`, which fills `{{DATABASE_PASSWORD}}`):

```json
{
  "DBInstanceIdentifier": "console",
  "Engine": "postgres",
  "EngineVersion": "18",
  "DBInstanceClass": "<db.t4g.micro | db.t4g.small | db.t4g.medium>",
  "AllocatedStorage": 20,
  "MaxAllocatedStorage": <100 | 100 | 200>,
  "StorageType": "gp3",
  "StorageEncrypted": true,
  "MasterUsername": "console",
  "MasterUserPassword": "{{DATABASE_PASSWORD}}",
  "DBName": "console",
  "DBSubnetGroupName": "console",
  "VpcSecurityGroupIds": ["<db security group>"],
  "PubliclyAccessible": false,
  "MultiAZ": <false, or true for two zones>,
  "BackupRetentionPeriod": 7,
  "DeletionProtection": true,
  "AutoMinorVersionUpgrade": true,
  "CopyTagsToSnapshot": true,
  "Tags": [{ "Key": "app", "Value": "console" }]
}
```

The major version alone picks the region's current minor of PostgreSQL 18 (checked 2026-10; `aws rds describe-db-engine-versions --engine postgres --engine-version 18` lists what that is).

```sh
aws rds create-db-instance --cli-input-json file://scratch/db.json && rm scratch/db.json
# ... the bucket, the roles, the cluster and Cloudflare meanwhile ...
aws rds wait db-instance-available --db-instance-identifier console
ENDPOINT=$(aws rds describe-db-instances --db-instance-identifier console --query 'DBInstances[0].Endpoint.Address' --output text)
curl -sSf "https://truststore.pki.rds.amazonaws.com/$AWS_REGION/$AWS_REGION-bundle.pem" | set_secret DATABASE_CA
node scratch/store-secrets.mjs derive "$SECRETS" DATABASE_URL "postgres://console:{{DATABASE_PASSWORD}}@$ENDPOINT:5432/console"
```

The regional bundle holds the three authorities a database in the region may be signed by (about 4.5 KB, read 2026-10), so it covers the instance whatever authority it got; it goes in as `DATABASE_CA`, and the URL carries no `ssl` parameter of its own (the console refuses both together). The password is base64url, so the URL needs no encoding.

### The bucket

```sh
BUCKET=console-files-$ACCOUNT
aws s3api create-bucket --bucket $BUCKET --region $AWS_REGION --create-bucket-configuration LocationConstraint=$AWS_REGION   # us-east-1: without the configuration
aws s3api put-public-access-block --bucket $BUCKET --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

No user and no key: the tasks read and write the bucket as their own role, whose credentials the platform hands them and renews (`S3_CREDENTIALS=platform` in the task definition; `deploy/README.md` "The bucket"). The role gets the policy below when it is made. `scratch/files-policy.json`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["s3:ListBucket"], "Resource": "arn:aws:s3:::<bucket>" },
    { "Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject"], "Resource": "arn:aws:s3:::<bucket>/*" }
  ]
}
```

`ListBucket` on the bucket is what the console's probe at start (`HEAD` on the bucket) needs; the objects are read and written under their hash.

### The image repository, the logs, the roles, the cluster

Two files first. `scratch/ecs-trust.json` lets ECS tasks assume a role: `{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ecs-tasks.amazonaws.com"},"Action":"sts:AssumeRole"}]}`. `scratch/parameters-policy.json` lets the execution role read the console's parameters: `{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["ssm:GetParameters"],"Resource":"arn:aws:ssm:<region>:<account>:parameter/console/*"}]}` (the parameters use the account's default key, which needs no `kms:Decrypt` of its own; checked 2026-10). Then:

```sh
aws ecr create-repository --repository-name console --image-scanning-configuration scanOnPush=true --image-tag-mutability IMMUTABLE
aws logs create-log-group --log-group-name /console && aws logs put-retention-policy --log-group-name /console --retention-in-days 30
aws iam create-role --role-name console-task-execution --assume-role-policy-document file://scratch/ecs-trust.json
aws iam attach-role-policy --role-name console-task-execution --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
aws iam put-role-policy --role-name console-task-execution --policy-name console-parameters --policy-document file://scratch/parameters-policy.json
aws iam create-role --role-name console-task --assume-role-policy-document file://scratch/ecs-trust.json
aws iam put-role-policy --role-name console-task --policy-name console-files --policy-document file://scratch/files-policy.json
aws iam create-service-linked-role --aws-service-name ecs.amazonaws.com    # "has been taken" means it exists: fine
aws ecs create-cluster --cluster-name console --capacity-providers FARGATE --default-capacity-provider-strategy capacityProvider=FARGATE,weight=1
```

The task role carries the files policy and nothing else: the platform hands every container of the task the role's credentials at an address it puts in the environment, and the console reads them there.

### The tunnel, the hostname and the rules at Cloudflare

1. **The tunnel.** `cf "/accounts/$CF_ACCOUNT/cfd_tunnel" -X POST --data '{"name":"console","config_src":"cloudflare"}' > scratch/tunnel.json`; `TUNNEL=$(jq -r .result.id scratch/tunnel.json)`; `jq -r .result.token scratch/tunnel.json | set_secret TUNNEL_TOKEN`; `rm scratch/tunnel.json`. Then its routing: `cf "/accounts/$CF_ACCOUNT/cfd_tunnel/$TUNNEL/configurations" -X PUT --data '{"config":{"ingress":[{"hostname":"<hostname>","service":"http://127.0.0.1:11199"},{"service":"http_status:404"}]}}'`. The connector runs beside the `api` container, so the service is the loopback, by its address rather than `localhost`, which may resolve to `::1` and reach the console from there; the last rule, without a hostname, is required.
2. **The hostname.** `cf "/zones/$ZONE/dns_records" -X POST --data '{"type":"CNAME","name":"<hostname>","content":"'$TUNNEL'.cfargotunnel.com","proxied":true,"ttl":1}'`. Proxied: the traffic goes through Cloudflare, which terminates TLS with its own certificate for the zone.
3. **Always HTTPS**, so that `http://` turns into `https://`, which `PUBLIC_URL` is. On a zone of the console's own: `cf "/zones/$ZONE/settings/always_use_https" -X PATCH --data '{"value":"on"}'`. On a zone that serves other hosts: the redirect rule of "A zone that serves other hosts" below, for the hostname alone.
4. **The rate limiting rule**, on the sign-in and connect paths of the console's hostname, which is what the console asks of a proxy; the board's own traffic is not limited. `RULESET=$(cf "/zones/$ZONE/rulesets/phases/http_ratelimit/entrypoint" | jq -r '.result.id')`: the entry point ruleset's id, or `null` when the zone has none yet. With one, `cf "/zones/$ZONE/rulesets/$RULESET/rules" -X POST --data @scratch/rule.json`, which adds the rule and leaves the zone's others alone; with none, `cf "/zones/$ZONE/rulesets" -X POST --data '{"name":"console","kind":"zone","phase":"http_ratelimit","rules":[<the rule>]}'`. Either answer carries the ruleset with its rules: the ruleset's id and the rule's (`.result.id`, `.result.rules[-1].id`) go into the notes and the record. Never `PUT` on the entry point: it replaces every rule of the phase. `scratch/rule.json`:

```json
{
  "description": "console: sign-in and connect, per client",
  "expression": "(http.host eq \"<hostname>\" and (starts_with(http.request.uri.path, \"/auth/\") or starts_with(http.request.uri.path, \"/api/v1/connect\")))",
  "action": "block",
  "enabled": true,
  "ratelimit": { "characteristics": ["ip.src", "cf.colo.id"], "period": 10, "requests_per_period": 30, "mitigation_timeout": 10 }
}
```

The Free plan allows one rate limiting rule, with a ten-second window and a ten-second block (checked 2026-10); a paid plan allows more, with longer windows.

### A zone that serves other hosts

The organization's site on the same domain is the usual case: the zone has records of its own (phase 1), and the run changes nothing zone-wide. The hostname's record and the rate limiting rule above name the hostname, so they touch nothing of the site. Always HTTPS is a setting of the whole zone, so for the hostname alone it is a redirect rule instead, in the phase `http_request_dynamic_redirect`, added the same way as the rate limiting rule (`RULESET=$(cf "/zones/$ZONE/rulesets/phases/http_request_dynamic_redirect/entrypoint" | jq -r '.result.id')`, then a `POST` of the rule to it, or a new ruleset of that phase with it), with the token's "Dynamic URL Redirects: Edit" (access.md). `scratch/redirect.json`:

```json
{
  "description": "console: https only",
  "expression": "(http.host eq \"<hostname>\" and not ssl)",
  "action": "redirect",
  "action_parameters": { "from_value": { "status_code": 301, "target_url": { "expression": "concat(\"https://\", http.host, http.request.uri.path)" }, "preserve_query_string": true } },
  "enabled": true
}
```

When the zone's `always_use_https` is `on` already (`cf "/zones/$ZONE/settings/always_use_https"`), the site has it and the console gets it with the rest: no rule is needed, and the record says so. A rule made here goes into the notes and the record with its ruleset's id and its own, as the rate limiting rule does. Other per-host settings of the site (its own rules, its integrity checks, its obfuscation) are the site's: the run neither reads nor changes them.

### The parameters

The generated one first, if the Conventions' example was not run as a step: `node -e "process.stdout.write(require('node:crypto').randomBytes(36).toString('base64url'))" | set_secret AUTH_SECRET`. With it, the database's URL and authority and the tunnel's token in the secrets file: `node scratch/store-secrets.mjs store "$SECRETS" /console` writes each as a `SecureString` parameter `/console/<NAME>` (the certificate bundle in the advanced tier, which takes up to 8 KB; the rest standard), skipping `later` and the password that is already inside the URL. Check: `aws ssm describe-parameters --parameter-filters Key=Name,Option=BeginsWith,Values=/console/ --query 'Parameters[].Name'`.

### The secrets the person holds

The hostname being known, one message per provider chosen with the steps of access.md "The GitHub App" and "The OAuth client", the exact URLs filled in, the lines to add to the secrets file (`"GITHUB_CLIENT_SECRET": "<the secret>"`, and, with an organization, `"GITHUB_APP_PRIVATE_KEY": "<the key, as PEM>"`, the file's lines joined with `\n`), and `later` as the other answer. On an answer, store it (`store` again adds what is new) and note the client id, and the app's id and the organization, for the task definition. A provider answered `later` is left out of the task definition entirely, since the console wants both halves or neither, and so is the organization without its key, since it wants all three or none; a provider not chosen has no line in the secrets file and nothing in the record.

## Phase 4: The deployment repository

In the run's folder, write:

### `deploy/console.env`

```sh
CONSOLE_REPOSITORY=https://github.com/skillcdn/console.git
CONSOLE_REF=<the commit of the release tag pinned at the plan>
CLOUDFLARED_VERSION=<the connector's newest release, which gh api repos/cloudflare/cloudflared/releases/latest --jq .tag_name prints>
AWS_ACCOUNT_ID=<account id>
AWS_REGION=<region>
ECR_REPOSITORY=console
ECS_CLUSTER=console
SUBNETS=<subnet ids, comma-separated>
TASKS_SECURITY_GROUP=<the tasks' security group id>
API_COUNT=<1 | 1 | 2>
WORKER_COUNT=<0 | 0 | 1>
PLATFORM=linux/amd64
```

`PLATFORM=linux/arm64` with `cpuArchitecture` `ARM64` in the task definitions when the organization's builds run on ARM runners (sizing.md "Options the plan offers").

### `deploy/api.task.json`

The task definition of the `api` role with the tunnel's connector beside it, in the shape `register-task-definition` takes; the workflow fills both `image` fields. At `small` and `medium`, `WORKER_IN_PROCESS` is `true` and there is no `worker.task.json`; at `large`, it is left out and the worker is a service of its own.

```json
{
  "family": "console-api",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "<256 | 512 | 512>",
  "memory": "<512 | 1024 | 1024>",
  "runtimePlatform": { "operatingSystemFamily": "LINUX", "cpuArchitecture": "X86_64" },
  "executionRoleArn": "arn:aws:iam::<account>:role/console-task-execution",
  "taskRoleArn": "arn:aws:iam::<account>:role/console-task",
  "containerDefinitions": [
    {
      "name": "api",
      "image": "<image>",
      "essential": true,
      "command": ["api"],
      "readonlyRootFilesystem": true,
      "portMappings": [{ "containerPort": 11199, "protocol": "tcp" }],
      "environment": [
        { "name": "PUBLIC_URL", "value": "https://<hostname>" },
        { "name": "WORKSPACE_NAME", "value": "<the board's name, such as Acme Console>" },
        { "name": "WORKER_IN_PROCESS", "value": "true" },
        { "name": "TRUSTED_PROXIES", "value": "127.0.0.1,::1" },
        { "name": "CLIENT_IP_HEADER", "value": "cf-connecting-ip" },
        { "name": "HTTP_KEEP_ALIVE_SECONDS", "value": "100" },
        { "name": "ADMINS", "value": "<the first administrators: logins and addresses, comma-separated>" },
        { "name": "GITHUB_CLIENT_ID", "value": "<the GitHub App's client id>" },
        { "name": "GITHUB_APP_ID", "value": "<the GitHub App's id, or drop the three lines of the organization>" },
        { "name": "GITHUB_ORG", "value": "<the organization's login at GitHub>" },
        { "name": "SKILLS_ADDRESS", "value": "<the organization's skills address, or drop the line>" },
        { "name": "S3_ENDPOINT", "value": "https://s3.<region>.amazonaws.com" },
        { "name": "S3_BUCKET", "value": "console-files-<account>" },
        { "name": "S3_REGION", "value": "<region>" },
        { "name": "S3_CREDENTIALS", "value": "platform" }
      ],
      "secrets": [
        { "name": "DATABASE_URL", "valueFrom": "arn:aws:ssm:<region>:<account>:parameter/console/DATABASE_URL" },
        { "name": "DATABASE_CA", "valueFrom": "arn:aws:ssm:<region>:<account>:parameter/console/DATABASE_CA" },
        { "name": "AUTH_SECRET", "valueFrom": "arn:aws:ssm:<region>:<account>:parameter/console/AUTH_SECRET" },
        { "name": "GITHUB_CLIENT_SECRET", "valueFrom": "arn:aws:ssm:<region>:<account>:parameter/console/GITHUB_CLIENT_SECRET" },
        { "name": "GITHUB_APP_PRIVATE_KEY", "valueFrom": "arn:aws:ssm:<region>:<account>:parameter/console/GITHUB_APP_PRIVATE_KEY" }
      ],
      "healthCheck": {
        "command": ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:11199/readyz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))\""],
        "interval": 15,
        "timeout": 5,
        "retries": 3,
        "startPeriod": 60
      },
      "stopTimeout": 30,
      "logConfiguration": { "logDriver": "awslogs", "options": { "awslogs-group": "/console", "awslogs-region": "<region>", "awslogs-stream-prefix": "api" } }
    },
    {
      "name": "tunnel",
      "image": "<the workflow fills it: the connector's image, mirrored into the repository>",
      "essential": true,
      "command": ["tunnel", "--no-autoupdate", "run"],
      "secrets": [{ "name": "TUNNEL_TOKEN", "valueFrom": "arn:aws:ssm:<region>:<account>:parameter/console/TUNNEL_TOKEN" }],
      "dependsOn": [{ "containerName": "api", "condition": "HEALTHY" }],
      "stopTimeout": 10,
      "logConfiguration": { "logDriver": "awslogs", "options": { "awslogs-group": "/console", "awslogs-region": "<region>", "awslogs-stream-prefix": "tunnel" } }
    }
  ]
}
```

With Google: `GOOGLE_CLIENT_ID` and `GOOGLE_WORKSPACE_DOMAIN` in `environment`, `GOOGLE_CLIENT_SECRET` in `secrets`; without GitHub, the two GitHub entries are dropped. The connector starts only once the console is ready (`dependsOn` on the health check, which is `/readyz`), and stops first when the task stops, so a rollout never routes to a task that is not serving; the console's `stopTimeout` of 30 seconds is above its grace period of 20. The console sees every request from the loopback with the client's address in `cf-connecting-ip`, which is why the trusted proxies are the loopback's two addresses; its keep-alive of 100 seconds outlasts the connector's idle timeout of 90 (checked 2026-10). The image writes nothing to its filesystem, so the root filesystem is read-only (`deploy/README.md` "The image"); the connector's is not, since it is not the console's image. The image is the Node.js base, which has no `curl`, so the health check uses Node itself. The bucket's credentials are the task's role's, which the platform hands the container at an address it sets in the environment (`AWS_CONTAINER_CREDENTIALS_RELATIVE_URI`); nothing of that is written here.

### `deploy/worker.task.json` (at `large`)

The same with `"family": "console-worker"`, `"cpu": "256"`, `"memory": "512"`, one container `worker` with `"command": ["worker"]` and the read-only root filesystem, the `environment` reduced to `WORKSPACE_NAME`, the `secrets` to `DATABASE_URL` and `DATABASE_CA`, no port, no health check, `"stopTimeout": 30`, the log stream prefix `worker`, and no tunnel.

### `deploy/migrate.task.json`

The same with `"family": "console-migrate"`, `"cpu": "256"`, `"memory": "512"`, one container `migrate` with `"command": ["migrate"]` and the read-only root filesystem, `secrets` `DATABASE_URL` and `DATABASE_CA`, no environment, no port, no health check, the log stream prefix `migrate`, and no tunnel: a connector must never start for a one-off task.

**Without a pipeline.** A deployment that is rolled by hand, or on a platform that runs one task definition and nothing before it, can run `migrate` inside the tasks instead of as a one-off: a container `migrate` in `api.task.json`, and at `large` in `worker.task.json` too, from the same image with `"command": ["migrate"]`, `"essential": false` and the `secrets` of the migrate task, and the role's own container with `"dependsOn": [{ "containerName": "migrate", "condition": "SUCCESS" }]` (the tunnel keeps its `dependsOn` on `api`). Every task of every role then migrates before it serves; tasks that start together wait on the advisory lock the migration takes, so none races another; a migration that fails leaves the role's container unstarted and the circuit breaker rolls the deployment back. The contract then holds per task rather than per rollout, which hard rule 8 allows in these words. The one-off task stays the default here because it stops the rollout before a single task is replaced.

### `.github/workflows/deploy.yml`

```yaml
name: Deploy the console
on:
  push:
    branches: [main]
    paths: ["deploy/**", "console-ui/**", ".github/workflows/deploy.yml"]
  workflow_dispatch:
permissions:
  id-token: write
  contents: read
concurrency: deploy
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Read the deployment's settings
        run: cat deploy/console.env >> "$GITHUB_ENV"
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::${{ env.AWS_ACCOUNT_ID }}:role/console-github-deploy
          aws-region: ${{ env.AWS_REGION }}
      - uses: aws-actions/amazon-ecr-login@v2
        id: ecr
      - name: Mirror the connector's image, once per version
        run: |
          TUNNEL_IMAGE="${{ steps.ecr.outputs.registry }}/$ECR_REPOSITORY:cloudflared-$CLOUDFLARED_VERSION"
          if ! aws ecr describe-images --repository-name "$ECR_REPOSITORY" --image-ids imageTag="cloudflared-$CLOUDFLARED_VERSION" > /dev/null 2>&1; then
            docker pull --platform "$PLATFORM" "cloudflare/cloudflared:$CLOUDFLARED_VERSION"
            docker tag "cloudflare/cloudflared:$CLOUDFLARED_VERSION" "$TUNNEL_IMAGE"
            docker push "$TUNNEL_IMAGE"
          fi
          echo "TUNNEL_IMAGE=$TUNNEL_IMAGE" >> "$GITHUB_ENV"
      - name: Get the console at the pinned commit
        run: |
          git clone --no-checkout "$CONSOLE_REPOSITORY" console
          git -C console checkout --detach "$CONSOLE_REF"
      - name: Build and push the image
        run: |
          IMAGE="${{ steps.ecr.outputs.registry }}/$ECR_REPOSITORY:${CONSOLE_REF::12}-${GITHUB_SHA::7}-$GITHUB_RUN_NUMBER"
          docker build --platform "$PLATFORM" -f console/deploy/Dockerfile -t "$IMAGE" console
          if [ -d console-ui ]; then
            (cd console-ui && npm ci && npm run build)
            printf 'FROM %s\nCOPY --chown=node:node console-ui/dist/ /app/web/\n' "$IMAGE" | docker build --platform "$PLATFORM" -t "$IMAGE" -f - .
          fi
          docker push "$IMAGE"
          echo "IMAGE=$IMAGE" >> "$GITHUB_ENV"
      - name: Register the task definitions
        run: |
          for role in migrate api worker; do
            [ -f "deploy/$role.task.json" ] || continue
            jq --arg image "$IMAGE" --arg tunnel "$TUNNEL_IMAGE" '(.containerDefinitions[] | select(.name != "tunnel") | .image) = $image | (.containerDefinitions[] | select(.name == "tunnel") | .image) = $tunnel' "deploy/$role.task.json" > "$RUNNER_TEMP/$role.json"
            aws ecs register-task-definition --cli-input-json "file://$RUNNER_TEMP/$role.json" --query 'taskDefinition.taskDefinitionArn' --output text
          done
      - name: Migrate, before anything new starts
        run: |
          NETWORK="awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$TASKS_SECURITY_GROUP],assignPublicIp=ENABLED}"
          echo "NETWORK=$NETWORK" >> "$GITHUB_ENV"
          TASK=$(aws ecs run-task --cluster "$ECS_CLUSTER" --task-definition console-migrate --launch-type FARGATE --network-configuration "$NETWORK" --query 'tasks[0].taskArn' --output text)
          aws ecs wait tasks-stopped --cluster "$ECS_CLUSTER" --tasks "$TASK"
          CODE=$(aws ecs describe-tasks --cluster "$ECS_CLUSTER" --tasks "$TASK" --query 'tasks[0].containers[0].exitCode' --output text)
          aws logs tail /console --since 15m --format short --log-stream-name-prefix migrate || true
          [ "$CODE" = "0" ] || { echo "migrate exited with $CODE"; exit 1; }
      - name: Roll the services
        run: |
          for role in api worker; do
            [ -f "deploy/$role.task.json" ] || continue
            COUNT=$([ "$role" = api ] && echo "$API_COUNT" || echo "$WORKER_COUNT")
            if aws ecs describe-services --cluster "$ECS_CLUSTER" --services "$role" --query 'services[?status==`ACTIVE`].serviceName' --output text | grep -q "$role"; then
              aws ecs update-service --cluster "$ECS_CLUSTER" --service "$role" --task-definition "console-$role" --desired-count "$COUNT" --force-new-deployment > /dev/null
            else
              aws ecs create-service --cluster "$ECS_CLUSTER" --service-name "$role" --task-definition "console-$role" --desired-count "$COUNT" --launch-type FARGATE --network-configuration "$NETWORK" --deployment-configuration "minimumHealthyPercent=100,maximumPercent=200,deploymentCircuitBreaker={enable=true,rollback=true}" > /dev/null
            fi
          done
      - name: Wait for the rollout
        run: |
          for role in api worker; do
            [ -f "deploy/$role.task.json" ] || continue
            WANTED=$(aws ecs describe-task-definition --task-definition "console-$role" --query 'taskDefinition.taskDefinitionArn' --output text)
            for i in $(seq 1 60); do
              DEPLOYED=$(aws ecs describe-services --cluster "$ECS_CLUSTER" --services "$role" --query 'services[0].deployments[0]' --output json | jq -r '"\(.taskDefinition) \(.rolloutState)"')
              case "$DEPLOYED" in
                "$WANTED COMPLETED") echo "$role: rolled out"; continue 2 ;;
                "$WANTED IN_PROGRESS") sleep 15 ;;
                *) echo "$role: the rollout failed ($DEPLOYED): a rollback is a deployment of the previous definition"; aws logs tail /console --since 15m --format short --log-stream-name-prefix "$role" || true; exit 1 ;;
              esac
            done
            echo "$role: not rolled out after 15 minutes"; exit 1
          done
```

What it does on every push that touches `deploy/` or `console-ui/`: mirrors the connector's image into the repository the first time a version is seen, so that the tasks never pull from elsewhere; builds the image from the console's pinned commit (and, when `console-ui/` exists, the organization's own console on top of it, as `deploy/README.md` "A custom console in the image" says), pushes it under a tag of its own (the console's commit, the repository's commit and the run's number, so that a run on the same commit still gets a new tag), registers the task definitions with the two images, runs `migrate` as a one-off task and stops if it did not exit `0`, then rolls `api` (and `worker`) with a circuit breaker that rolls back a deployment whose tasks never become healthy, and waits for the rollout of the task definition it registered to be `COMPLETED` (`aws ecs wait services-stable` returns as soon as the running count matches, before the tasks are healthy, which on a first deployment is too early; and a rollback is a new deployment of the previous definition, which completes too, so the definition is compared, not the state alone). The first push creates the services. Pin the actions' majors to the current ones (`checkout@v4`, `configure-aws-credentials@v4`, `amazon-ecr-login@v2`, checked 2026-10; the actions' pages say when a newer major exists).

### The role the workflow assumes

```sh
aws iam create-open-id-connect-provider --url https://token.actions.githubusercontent.com --client-id-list sts.amazonaws.com   # "EntityAlreadyExists" is fine
aws iam create-role --role-name console-github-deploy --assume-role-policy-document file://scratch/github-trust.json
aws iam put-role-policy --role-name console-github-deploy --policy-name console-deploy --policy-document file://scratch/deploy-policy.json
```

`scratch/github-trust.json`, trusting this repository's `main` and nothing else:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "arn:aws:iam::<account>:oidc-provider/token.actions.githubusercontent.com" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": { "StringEquals": {
      "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
      "token.actions.githubusercontent.com:sub": "repo:<owner>/<repository>:ref:refs/heads/main"
    } }
  }]
}
```

`scratch/deploy-policy.json`: `ecr:GetAuthorizationToken` on `*`; `ecr:BatchCheckLayerAvailability`, `ecr:InitiateLayerUpload`, `ecr:UploadLayerPart`, `ecr:CompleteLayerUpload`, `ecr:PutImage`, `ecr:BatchGetImage`, `ecr:DescribeImages` on `arn:aws:ecr:<region>:<account>:repository/console`; `ecs:RegisterTaskDefinition`, `ecs:DescribeTaskDefinition`, `ecs:RunTask`, `ecs:DescribeTasks`, `ecs:DescribeServices`, `ecs:CreateService`, `ecs:UpdateService`, `ecs:ListTasks` on `*`; `iam:PassRole` on the two task roles; `logs:DescribeLogStreams`, `logs:GetLogEvents`, `logs:FilterLogEvents` on `arn:aws:logs:<region>:<account>:log-group:/console:*`.

### The organization's own console

`console-ui/`, when the organization has a look of its own: a console made with building-a-console at the plan's look, depending on `@skillcdn/console` at the version of the release `CONSOLE_REF` pins, with a `package-lock.json` (the workflow runs `npm ci`), a `build` script that runs `vite build` into `dist/`, and a `vite.config.ts` that sends `/api` to `console serve` while it is built; the workflow builds it on every push and lays `console-ui/dist/` over the image's web root. Absent, the image's default pages serve.

### The rest of the repository

- `README.md`, in the organization's language: what this repository is (the deployment of the organization's console), that a push to `main` deploys, where the record is, and where the skill that made it lives (`skillcdn.ai/gh/skillcdn/console`).
- `DEPLOY.md`: the draft from the template (phase 8), filled as far as the run has gone.
- `console-ui/`: only when the organization has its own console (building-a-console makes it); otherwise absent and the image's default UI serves.

### Commit, create, push, watch

`git add -A && git commit -m "The console's deployment"` (`.gitignore` keeps `scratch/`, the key file and the token file out; check with `git status --short` that nothing of them is staged); show the files to the person; `gh repo create <owner>/<name> --private --source . --remote origin` (without `--push`), or `git remote add origin <the address the person gave>`. Checkpoint, then `git push -u origin main`; a few seconds later `RUN=$(gh run list --limit 1 --json databaseId -q '.[0].databaseId')` and `gh run watch "$RUN" --exit-status` (`gh run view "$RUN" --log` when it fails). The first run takes about ten minutes: the build, the push, the migration, the services.

## Phase 5: Live

```sh
cf "/zones?name=<domain>" | jq -r '.result[0].status'                                    # active; else the wait of the skill
curl -sS -o scratch/readyz.txt -w '%{http_code}\n' https://<hostname>/readyz              # 200 (a file, not /dev/null: see "When a step fails")
curl -sS https://<hostname>/api/v1/me | jq .signIn                                         # the providers set, asked as nobody
cf "/accounts/$CF_ACCOUNT/cfd_tunnel/$TUNNEL/connections" | jq '.result | length'          # 1 or more
aws ecs describe-services --cluster console --services api --query 'services[0].[runningCount,deployments[0].rolloutState]'   # [<the size's api count>, "COMPLETED"]
aws logs tail /console --since 15m --format short | grep -E 'migrations applied|api listening|files go to the bucket'
```

The three log lines are the console's stable start lines (`deploy/README.md` "Process contract"); `files go to the bucket` carries `"credentials":"platform"`.

Then the budget alert, at one and a half times the estimate, to the address of the plan, which emails when the month's bill passes it or is forecast to:

```sh
aws budgets create-budget --account-id $ACCOUNT --budget file://scratch/budget.json --notifications-with-subscribers file://scratch/notifications.json
```

`scratch/budget.json`: `{"BudgetName":"console","BudgetType":"COST","BudgetLimit":{"Amount":"<estimate x 1.5>","Unit":"USD"},"TimeUnit":"MONTHLY"}`; `scratch/notifications.json`: `[{"Notification":{"NotificationType":"ACTUAL","ComparisonOperator":"GREATER_THAN","Threshold":100,"ThresholdType":"PERCENTAGE"},"Subscribers":[{"SubscriptionType":"EMAIL","Address":"<email>"}]},{"Notification":{"NotificationType":"FORECASTED","ComparisonOperator":"GREATER_THAN","Threshold":100,"ThresholdType":"PERCENTAGE"},"Subscribers":[{"SubscriptionType":"EMAIL","Address":"<email>"}]}]`. The person confirms the subscription from the email AWS sends.

## Phases 6 and 7: the first people, and the proof

The person signs in and makes the first project on the pages (the skill's phase 6). Then, in the run's folder:

```sh
console login --url https://<hostname> --agent deploying-a-console     # relay the address and the code; the person approves
console use <key>
printf '# Deployment check\n\nHanded in by the deploying agent on <date> to prove the bucket.\n' > scratch/deployment-check.md
NUMBER=$(console task new "Deployment check" --body "What this run deployed, in a few lines: the size, the address, what is owed." --json | jq -r .number)
RUN_ID=$(console take "$NUMBER" --json | jq -r .run.id)                 # take answers the run and the task
console hand-in scratch/deployment-check.md --label "the check"
HASH=$(console run "$RUN_ID" --json | jq -r '.artifacts[0].file.sha256')
aws s3api head-object --bucket $BUCKET --key "$HASH"                    # the object, with its size
console finish --summary "Deployed <size> at <address>; owed: <what the delivery names>."
```

The hash `console run` shows is the object's key in the bucket (no prefix is set); `head-object` finding it proves the file went to the bucket and that the console reads it back from there. `console help <command>` is right where this differs from it.

## Phase 8: the record

`DEPLOY.md`, in the organization's language, from this template:

```markdown
# The console's deployment

Made on <date> with the skill `deploying-a-console` of the SkillCDN Console (skillcdn.ai/gh/skillcdn/console), from release `@skillcdn/console@<version>` of `skillcdn/console` (commit `<CONSOLE_REF>`).

## What exists

| What | Where |
|---|---|
| The console | https://<hostname>, through Cloudflare (zone <domain>, tunnel `console`, id `<tunnel id>`) |
| Cloudflare rules | The rate limiting rule `console: sign-in and connect, per client` (ruleset `<id>`, rule `<id>`); always HTTPS as <the zone's setting | the redirect rule `console: https only` (ruleset `<id>`, rule `<id>`) | the zone's own setting, on already> |
| AWS account and region | <account id>, <region> |
| Containers | ECS cluster `console`; services `api` (<n> tasks of <cpu>/<memory>)<, `worker`>; task families `console-api`, `console-migrate`<, `console-worker`> |
| Database | RDS PostgreSQL <version>, `console`, <class>, <storage>, <one zone | two zones>, backups 7 days, deletion protection on |
| Files | S3 bucket `console-files-<account>`, read and written by the task's role `console-task`; no key exists |
| Secrets | SSM Parameter Store, `/console/*`: <the names> |
| Logs | CloudWatch Logs `/console`, kept 30 days |
| Images | ECR `console`: one tag per deployment, and the connector's image under `cloudflared-<version>` |
| Roles | `console-task-execution`, `console-task` (the bucket), `console-github-deploy` (assumed by this repository's `main`) |
| Size and cost | `<size>`; about <estimate> a month at <date>'s prices; a budget alert at <amount> emails <address> |

## How it is run

- **A deployment** is a push to `main` that touches `deploy/` or `console-ui/`: the workflow builds the image, runs the migrations, and rolls the services. `gh run list` shows the runs.
- **A new version of the console:** set `CONSOLE_REF` in `deploy/console.env` to the commit of the newest release tag: the last line of `git ls-remote --tags https://github.com/skillcdn/console 'refs/tags/@skillcdn/console@*' | sort -t@ -k3 -V` is the highest version, with the commit in its first column; move `console-ui/` to the same version of the package when there is one; push. **A new connector:** `CLOUDFLARED_VERSION` there, push.
- **A person added or removed:** with an organization at GitHub (`GITHUB_ORG`), in the organization, which the console reads every ten minutes; otherwise on the People page, or with `console person add <login>` and `console person deactivate <login>`, by an administrator; nothing to push. With a Google Workspace, everyone of `GOOGLE_WORKSPACE_DOMAIN` is in. `ADMINS` in `deploy/api.task.json` names only the first administrators, who make others on the People page.
- **The next size:** the numbers in `deploy/api.task.json` (and `deploy/worker.task.json` at `large`), `API_COUNT` and `WORKER_COUNT` in `deploy/console.env`, push; to `large`, also `deploy/worker.task.json` written as the skill's resources.md gives it and `WORKER_IN_PROCESS` dropped from the api task; the database: `aws rds modify-db-instance --db-instance-identifier console --db-instance-class <class> --apply-immediately` (a few minutes of unavailability).
- **A secret rotated:** the new value into a secrets file of the same shape with the skill's script (`set`), then `node <the script> store <file> /console`, which overwrites the parameter in its tier (`$(npm root -g)/@skillcdn/console/skills/deploying-a-console/scripts/store-secrets.mjs`; `DATABASE_CA` is in the advanced tier, which an `aws ssm put-parameter --overwrite` by hand must name with `--tier Advanced`); then `aws ecs update-service --cluster console --service api --force-new-deployment`.
- **The organization's own console:** its source in `console-ui/` (building-a-console makes it); a push builds it into the image.
- **Paused:** `aws ecs update-service --cluster console --service api --desired-count 0` (and `worker`), `aws rds stop-db-instance --db-instance-identifier console` (seven days at most); the reverse resumes.
- **Removed:** the skill's "Removing", resource by resource, confirmed.

## What is owed

<a provider's secret said later, with its steps; nameservers; a secret pasted into the chat, to be made anew; nothing>

## Verified on <date>

`/readyz` 200 at the address; <who> signed in as administrator; project `<key>` made; the agent connected with a code; the deployment check handed in and found in the bucket under its hash; workflow run <id> green.
```

A change to `DEPLOY.md` or `README.md` alone does not run the workflow (its `paths`), so the record is pushed without a deployment: `git add DEPLOY.md README.md && git commit -m "The record" && git push`, never `git add -A` here, after `git status --short` shows nothing else of the folder as untracked (`scratch/`, the files and `.skillcdn-console.json` are ignored).

## Removing

Only on request, each step confirmed, in this order, after a last snapshot of the database: the services (`aws ecs update-service --desired-count 0`, then `delete-service`), the cluster; the hostname (`DELETE /zones/<zone>/dns_records/<id>`), the rules (`DELETE /zones/<zone>/rulesets/<ruleset>/rules/<rule>`, the two ids of the record; a zone-wide always-HTTPS the run turned on is left as it is, since the zone may have come to rely on it) and the tunnel (`DELETE /accounts/<account>/cfd_tunnel/<id>`, after `.../connections` is empty); the database (`modify-db-instance --no-deletion-protection`, then `delete-db-instance --final-db-snapshot-identifier console-final-<date>`); the bucket, emptied first (`aws s3 rm s3://<bucket> --recursive`, then `delete-bucket`); the parameters; the roles' policies and the roles; the log group; the image repository (`--force`); the security groups; the budget. The deployment repository stays, with the record of what was removed and the snapshot's name.

## When a step fails

| Symptom | Cause | What to do |
|---|---|---|
| `AccessDenied` or `UnauthorizedOperation` naming an action | The deployer's policy lacks it | Add the action to the policy (access.md) and run the step again |
| A log group or a parameter gets a name like `C:/Program Files/Git/console` | Git Bash rewrote the `/console` argument | `export MSYS_NO_PATHCONV=1`, delete the misnamed resource, run the step again |
| With that set, `curl` says it cannot open `/dev/null`, or a program cannot find `/tmp/...` | Git Bash now passes those as written, and a native program on Windows knows no such paths | Give the program a file under `scratch/` instead (`-o scratch/out.txt`); the shell's own `> /dev/null` still works |
| `POST .../cfd_tunnel` answers `403` with code `10000` while listing tunnels works | The token has Read where Edit is needed: Read lists what Edit makes | Edit the token's permission (access.md's table, "Cloudflare One Connector: cloudflared"), run the step again; the same for a ruleset's `POST` under Zone WAF or Dynamic URL Redirects |
| `aws rds create-db-instance` refuses the engine version | The region has no PostgreSQL 18 yet | `describe-db-engine-versions --engine postgres` and take the newest major it lists |
| `create-bucket` says the name is taken | Bucket names are global | Add a short suffix and update the task definition and the files policy |
| `POST /zones` is refused with a permission error | The token lacks Zone Edit | Add the row (access.md) and run the step again |
| `POST /zones` answers that the domain is on Cloudflare already, in another account | The organization's zone lives under another Cloudflare account | The person signs in there and moves the domain to this account, or makes the token under that account; the run then reads the zone as phase 1 does |
| The migration task exits `78` | A variable refused; the log names it, never its value | Fix the parameter or the environment entry, push again |
| The migration task exits `1` with a connection error | The tasks' group is not allowed into the database's, or the URL's host is wrong | Check the `authorize-security-group-ingress` and the endpoint in `DATABASE_URL` |
| `ResourceInitializationError` on a task: unable to pull secrets | The execution role cannot read `/console/*` | Check `console-parameters` on `console-task-execution` and the parameter ARNs |
| A task stops before it is healthy; the log says `api listening` and then nothing | The health check fails: wrong port or `/readyz` not `200` (database unreachable, schema behind) | `aws logs tail /console --since 10m`; `/readyz` says which of the three |
| The service never stabilizes and rolls back | The circuit breaker tripped on the above | Fix the cause; `--force-new-deployment` |
| The tunnel shows no connector while `api` is healthy | The token is wrong, or the task has no public IP for its egress | Check `TUNNEL_TOKEN` and `assignPublicIp=ENABLED` in the network configuration |
| The connector's log warns at start about ICMP or the ping group, and that it `failed to sufficiently increase receive buffer size` | Harmless on Fargate: no raw sockets for pinging through the tunnel, and a small UDP buffer; HTTP through the tunnel needs neither | Nothing; the connector is up when its log says `Registered tunnel connection` and the tunnel shows a connector |
| `files go to the bucket` is missing from the log, and the first file answers `503` | The task's role cannot reach the bucket: no `taskRoleArn`, no files policy on `console-task`, or `S3_CREDENTIALS` not `platform` | Check the three; the log's warning at start says what the bucket or the credentials answered |
| `https://<hostname>` answers 530 or 502 from Cloudflare | No connector yet, or the hostname's ingress rule points elsewhere | Wait for the service; check the tunnel's configuration and the DNS record |
| `https://<hostname>` does not resolve | The zone is not active yet | The nameservers at the registrar; `cf "/zones?name=<domain>"` says when |
| The sign-in button is missing | The provider's id or secret is not in the task definition | Both halves or neither; check `environment` and `secrets` |
| The sign-in is refused after the provider | Nobody let the login in: it is not in `ADMINS`, not of the organization (`GITHUB_ORG`) or of `GOOGLE_WORKSPACE_DOMAIN`, and no administrator listed it on the People page; or the person was deactivated | An administrator lets the login in on the People page (`console person add <login>`), or takes the person back in; the first administrator is `ADMINS`, a push |
| The log says `the organization could not be read` | The app's key is wrong (`unauthorized`), the app is not installed on the organization or lacks the Members permission (`invalid`, `unauthorized`), or GitHub was away (`transient`) | Check the parameter, the installation and the app's permissions; nothing changed meanwhile, and the next pass reads again |
| The mirror step cannot pull `cloudflare/cloudflared` | Docker Hub's anonymous pull limit on the runner | Run the workflow again (`gh run rerun <id>`); the pull happens once per connector version, and the tasks pull from the repository afterwards |
| `gh run watch` shows the build failing on `npm ci` in `console-ui` | The UI's lockfile is out of step | Fix in `console-ui/` (building-a-console), push |
| A 524 at Cloudflare on a long read | A request held longer than the proxy's 100 seconds | The console holds a decision's read for 50 at most; look for a slow database |

## As infrastructure code

An organization that writes this shape as infrastructure code (Terraform, for one) instead of running the commands keeps the same resources, names and contract; the first such rendering found these worth knowing (2026-10). A tunnel resource with its configuration at Cloudflare (`config_src = "cloudflare"`) and no secret of its own keeps the tunnel's secret out of the state, and the connector token is then read by a script straight into the secret store rather than through a data source, which would land it in the state. The database's password and the parameters go in as write-only arguments where the provider has them, for the same reason. Where the secret store is Secrets Manager rather than the parameter store, two halves of a key pair (the bucket on R2) fit one JSON secret, which a task definition reads by key (`arn:...:secret:<name>:S3_ACCESS_KEY_ID::`). The tasks' role, the connector beside `api`, the read-only root filesystem and the rollout's state apply as written.

## Facts that move

- AWS App Runner stopped taking new customers on 2026-04-30 and is in maintenance; ECS Express Mode (2025-11) is AWS's successor and provisions a load balancer (checked 2026-10).
- ECS: `aws ecs wait services-stable` returns once the running count matches the desired one, before the tasks are healthy; a deployment's `rolloutState` is `COMPLETED` once they are, or `FAILED` when the circuit breaker rolled it back (checked 2026-10).
- The connector reaches Cloudflare on `7844` (QUIC over UDP, falling back to TCP) and `443`, and reads its token from `TUNNEL_TOKEN`; its image is `cloudflare/cloudflared` on Docker Hub, tagged by release (checked 2026-10).
- Fargate: `stopTimeout` from 2 to 120 seconds, 30 when unset; containers stop in the reverse order of their start dependencies (checked 2026-10).
- SSM Parameter Store: 4 KB per standard parameter, 8 KB per advanced one at about $0.05 a month; the RDS regional certificate bundle is about 4.5 KB with three authorities (checked 2026-10).
- RDS for PostgreSQL has had major version 18 since 2025-11 (checked 2026-10).
- Cloudflare: a proxied request's idle limit is 100 seconds on every plan but Enterprise; the Free plan allows one rate limiting rule with a ten-second window; a tunnel costs nothing; a remotely managed tunnel's routing is the `configurations` document, whose last rule has no hostname; creating a zone needs Zone Edit on the token; the tunnel's permission is listed as "Cloudflare One Connector: cloudflared" in the dashboard and reported as "Cloudflare Tunnel Write" by the API; a redirect rule lives in the phase `http_request_dynamic_redirect` under "Dynamic URL Redirects" (checked 2026-10).
- A new AWS account made after 2025-07-15 starts with $100 of credits and a choice between a free plan that ends after six months and a paid one (checked 2026-10).
- Git Bash on Windows rewrites an argument that starts with `/` into a Windows path for a native program unless `MSYS_NO_PATHCONV=1` is set; with it set, `/dev/null` and `/tmp/...` as arguments reach the program as written, which knows no such paths, while the shell's own redirections keep working (checked 2026-10).
