# The phases in detail: procedure, checks, failures

What each phase of the skill does, command by command, with its checks and what to do when a step fails. Placeholders are in angle brackets. The run keeps its notes (ids, names, endpoints) in `scratch/notes.md` of the run's folder; `DEPLOY.md` is written from them at the end. Facts that move carry the month they were checked; the vendor's reference is the source when one has moved.

## Conventions

The run's folder is the deployment repository to be; `scratch/` in it holds the scripts, the request bodies and the notes, and never enters git. Every AWS command runs as the deployer, in the region of the plan; every Cloudflare call carries the token from its file. Set once per shell, in the run's folder:

```sh
export MSYS_NO_PATHCONV=1                 # Git Bash on Windows: keep /console and the like as written
export AWS_PROFILE=console AWS_REGION=<region>
export CLOUDFLARE_API_TOKEN=$(tr -d '\r\n ' < .cf-token)
cf() { curl -sS "https://api.cloudflare.com/client/v4$1" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" "${@:2}"; }
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
SECRETS=../console-secrets.json          # outside the repository, in the shape of assets/secrets.example.json
```

A value that must not be seen goes through a file or a pipe, never a command line: `aws ... --cli-input-json file://scratch/<file>` for a request that carries one, and the two scripts of this skill ([import-aws-key.mjs](../scripts/import-aws-key.mjs), [store-secrets.mjs](../scripts/store-secrets.mjs)), copied to `scratch/`, for the key and the parameters. A response that carries one is piped straight into the secrets file:

```sh
set_secret() { node scratch/store-secrets.mjs set "$SECRETS" "$1"; }   # reads the value from standard input
node -e "process.stdout.write(require('node:crypto').randomBytes(36).toString('base64url'))" | set_secret AUTH_SECRET
```

## Phase 1: Access

1. The folder: `mkdir -p <folder>/scratch && cd <folder> && git init -b main`, and `.gitignore` with `.cf-token`, `.aws-key.csv`, `scratch/`, `*.pem`, `console-secrets.json`, `node_modules/`, `console-ui/dist/`, `.env`, `.env.*`, before anything else is written.
2. The command and the scripts: `npm install -g @skillcdn/console`, then copy `$(npm root -g)/@skillcdn/console/skills/deploying-a-console/scripts/*.mjs` into `scratch/` (or write them there from the connection's copy of the skill).
3. The key: the person saved `.aws-key.csv` in the folder ([access.md](access.md)). `node scratch/import-aws-key.mjs .aws-key.csv console` writes the profile and deletes the file. Then `aws configure set region <region> --profile console`.
4. `aws sts get-caller-identity`: the account id and `user/console-deployer`. A refusal means the key is wrong or not yet active (a minute after creation).
5. The network: `aws ec2 describe-vpcs --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text`. `None`: `aws ec2 create-default-vpc`. Then the subnets: `aws ec2 describe-subnets --filters Name=vpc-id,Values=<vpc> Name=default-for-az,Values=true --query 'Subnets[].SubnetId' --output text`.
6. The token: `cf /user/tokens/verify` answers `"status": "active"`; `cf /accounts` the account and its id (`CF_ACCOUNT`); `cf "/zones?name=<domain>"` the zone and its `status`, or an empty list when the domain is not on Cloudflare yet.
7. The git host: `gh auth status`; the owner the person named is theirs or an organization they are in (`gh api user`, `gh api user/orgs`).
8. The tools: `node --version` (24 or newer), `git --version`, `jq --version`, `curl --version`.

Report what is missing in one message, with the row of access.md to add, before the plan.

## Phase 2: Plan and estimate

Nothing is created. The size from the answer and its numbers ([sizing.md](sizing.md) "The sizes"); the prices read and the estimate computed ("Reading today's prices"); the names:

| Resource | Name |
|---|---|
| Cluster; services; task families | `console`; `api`, `worker`; `console-api`, `console-worker`, `console-migrate` |
| Database instance, subnet group, user, database | `console`, `console`, `console`, `console` |
| Bucket, files user | `console-files-<account id>` (bucket names are global; the account id makes it unique), `console-files` |
| Image repository, log group | `console`, `/console` |
| Roles | `console-task-execution`, `console-task`, `console-github-deploy` |
| Security groups | `console-tasks`, `console-db` |
| Parameters | `/console/<NAME>`, one per secret of the secrets file |
| Tunnel, hostname | `console`, `<hostname>` |
| Deployment repository | `<owner>/<the folder's name>`, private |

The plan message is the estimate message of sizing.md followed by the line in the skill's phase 2.

## Phase 3: Foundation

### The zone, first

Not on Cloudflare yet: `cf /zones -X POST --data '{"name":"<domain>","account":{"id":"<CF_ACCOUNT>"},"type":"full"}'`; the answer's `name_servers` go to the person with the steps for their registrar (access.md "The domain"), the run goes on, and the hostname answers once `cf "/zones?name=<domain>"` says `"status": "active"`. A domain to buy: `cf "/accounts/<CF_ACCOUNT>/registrar/domain-search?q=<words>"` to find one, `cf "/accounts/<CF_ACCOUNT>/registrar/domain-check" -X POST --data '{"domains":["<domain>"]}'` for the live price, the checkpoint with the price and the renewal, then `cf "/accounts/<CF_ACCOUNT>/registrar/registrations" -X POST --data '{"domain_name":"<domain>"}'`; a `202` is polled at `.../registrations/<domain>/registration-status`; `extension_not_supported_via_api` means the dashboard (Domain Registration, Register Domains). A bought domain's zone is active at once (the Registrar API was in beta when checked, 2026-10). Either way: `ZONE=$(cf "/zones?name=<domain>" | jq -r '.result[0].id')`.

### The network

```sh
VPC=<vpc>; SUBNETS=<subnet ids, comma-separated>
TASKS_SG=$(aws ec2 create-security-group --group-name console-tasks --description "console tasks: no inbound" --vpc-id $VPC --query GroupId --output text)
DB_SG=$(aws ec2 create-security-group --group-name console-db --description "console database: from the tasks only" --vpc-id $VPC --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id $DB_SG --protocol tcp --port 5432 --source-group $TASKS_SG
```

A new group allows all egress and no ingress; the tasks' group stays so. Check: `aws ec2 describe-security-groups --group-ids $TASKS_SG --query 'SecurityGroups[0].IpPermissions'` is `[]`.

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

### The bucket and its keys

```sh
BUCKET=console-files-$ACCOUNT
aws s3api create-bucket --bucket $BUCKET --region $AWS_REGION --create-bucket-configuration LocationConstraint=$AWS_REGION   # us-east-1: without the configuration
aws s3api put-public-access-block --bucket $BUCKET --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws iam create-user --user-name console-files --tags Key=app,Value=console
aws iam put-user-policy --user-name console-files --policy-name console-files --policy-document file://scratch/files-policy.json
node scratch/store-secrets.mjs key "$SECRETS" console-files      # makes the key once, stores both halves, prints neither
```

`scratch/files-policy.json`:

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

```sh
aws ecr create-repository --repository-name console --image-scanning-configuration scanOnPush=true --image-tag-mutability IMMUTABLE
aws logs create-log-group --log-group-name /console && aws logs put-retention-policy --log-group-name /console --retention-in-days 30
aws iam create-role --role-name console-task-execution --assume-role-policy-document file://scratch/ecs-trust.json
aws iam attach-role-policy --role-name console-task-execution --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
aws iam put-role-policy --role-name console-task-execution --policy-name console-parameters --policy-document file://scratch/parameters-policy.json
aws iam create-role --role-name console-task --assume-role-policy-document file://scratch/ecs-trust.json
aws iam create-service-linked-role --aws-service-name ecs.amazonaws.com    # "has been taken" means it exists: fine
aws ecs create-cluster --cluster-name console --capacity-providers FARGATE --default-capacity-provider-strategy capacityProvider=FARGATE,weight=1
```

`scratch/ecs-trust.json` lets ECS tasks assume the role: `{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ecs-tasks.amazonaws.com"},"Action":"sts:AssumeRole"}]}`. `scratch/parameters-policy.json` lets the execution role read the console's parameters: `{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["ssm:GetParameters"],"Resource":"arn:aws:ssm:<region>:<account>:parameter/console/*"}]}` (the parameters use the account's default key, which needs no `kms:Decrypt` of its own; checked 2026-10). The task role carries nothing: the console reaches the bucket with its own keys.

### The tunnel, the hostname and the rules at Cloudflare

1. **The tunnel.** `cf "/accounts/<CF_ACCOUNT>/cfd_tunnel" -X POST --data '{"name":"console","config_src":"cloudflare"}' > scratch/tunnel.json`; `TUNNEL=$(jq -r .result.id scratch/tunnel.json)`; `jq -r .result.token scratch/tunnel.json | set_secret TUNNEL_TOKEN`; `rm scratch/tunnel.json`. Then its routing: `cf "/accounts/<CF_ACCOUNT>/cfd_tunnel/$TUNNEL/configurations" -X PUT --data '{"config":{"ingress":[{"hostname":"<hostname>","service":"http://localhost:11199"},{"service":"http_status:404"}]}}'`. The connector runs beside the `api` container, so the service is the loopback; the last rule, without a hostname, is required.
2. **The hostname.** `cf "/zones/$ZONE/dns_records" -X POST --data '{"type":"CNAME","name":"<hostname>","content":"'$TUNNEL'.cfargotunnel.com","proxied":true,"ttl":1}'`. Proxied: the traffic goes through Cloudflare, which terminates TLS with its own certificate for the zone.
3. **Settings.** `cf "/zones/$ZONE/settings/always_use_https" -X PATCH --data '{"value":"on"}'`, so that `http://` turns into `https://`, which `PUBLIC_URL` is.
4. **The rate limiting rule**, on the sign-in and connect paths, which is what the console asks of a proxy; the board's own traffic is not limited. `RULESET=$(cf "/zones/$ZONE/rulesets/phases/http_ratelimit/entrypoint" | jq -r '.result.id')`: the entry point ruleset's id, or `null` when the zone has none yet. With one, `cf "/zones/$ZONE/rulesets/$RULESET/rules" -X POST --data @scratch/rule.json`; with none, `cf "/zones/$ZONE/rulesets" -X POST --data '{"name":"console","kind":"zone","phase":"http_ratelimit","rules":[<the rule>]}'`. `scratch/rule.json`:

```json
{
  "description": "console: sign-in and connect, per client",
  "expression": "(starts_with(http.request.uri.path, \"/auth/\") or starts_with(http.request.uri.path, \"/api/v1/connect\"))",
  "action": "block",
  "enabled": true,
  "ratelimit": { "characteristics": ["ip.src", "cf.colo.id"], "period": 10, "requests_per_period": 30, "mitigation_timeout": 10 }
}
```

The Free plan allows one rate limiting rule, with a ten-second window and a ten-second block (checked 2026-10); a paid plan allows more, with longer windows.

### The parameters

With the database's URL and authority, the bucket's keys and the tunnel's token in the secrets file, and the generated `AUTH_SECRET`: `node scratch/store-secrets.mjs store "$SECRETS" /console` writes each as a `SecureString` parameter `/console/<NAME>` (the certificate bundle in the advanced tier, which takes up to 8 KB; the rest standard), skipping `later` and the password that is already inside the URL. Check: `aws ssm describe-parameters --parameter-filters Key=Name,Option=BeginsWith,Values=/console/ --query 'Parameters[].Name'`.

### The secrets the person holds

The hostname being known, one message per provider chosen with the steps of access.md "The OAuth app" and "The OAuth client", the exact URLs filled in, the line to add to the secrets file (`"GITHUB_CLIENT_SECRET": "<the secret>"`), and `later` as the other answer. On an answer, store it (`store` again adds what is new) and note the client id for the task definition. A provider answered `later` is left out of the task definition entirely, since the console wants both halves or neither; a provider not chosen has no line in the secrets file and nothing in the record.

## Phase 4: The deployment repository

In the run's folder, write:

### `deploy/console.env`

```sh
CONSOLE_REPOSITORY=https://github.com/skillcdn/console.git
CONSOLE_REF=<the commit of main pinned at the plan>
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

`PLATFORM=linux/arm64` with `cpuArchitecture` `ARM64` in the task definitions when the organization's builds run on ARM runners (sizing.md "Options").

### `deploy/api.task.json`

The task definition of the `api` role with the tunnel's connector beside it, in the shape `register-task-definition` takes; the workflow fills `image`. At `small` and `medium`, `WORKER_IN_PROCESS` is `true` and there is no `worker.task.json`; at `large`, it is left out and the worker is a service of its own.

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
      "portMappings": [{ "containerPort": 11199, "protocol": "tcp" }],
      "environment": [
        { "name": "PUBLIC_URL", "value": "https://<hostname>" },
        { "name": "WORKSPACE_NAME", "value": "<the board's name>" },
        { "name": "WORKER_IN_PROCESS", "value": "true" },
        { "name": "TRUSTED_PROXIES", "value": "127.0.0.1" },
        { "name": "CLIENT_IP_HEADER", "value": "cf-connecting-ip" },
        { "name": "HTTP_KEEP_ALIVE_SECONDS", "value": "100" },
        { "name": "MEMBERS", "value": "<logins and addresses, comma-separated>" },
        { "name": "ADMINS", "value": "<logins among them>" },
        { "name": "GITHUB_CLIENT_ID", "value": "<the OAuth app's client id>" },
        { "name": "SKILLS_ADDRESS", "value": "<the organization's skills address, or drop the line>" },
        { "name": "S3_ENDPOINT", "value": "https://s3.<region>.amazonaws.com" },
        { "name": "S3_BUCKET", "value": "console-files-<account>" },
        { "name": "S3_REGION", "value": "<region>" }
      ],
      "secrets": [
        { "name": "DATABASE_URL", "valueFrom": "arn:aws:ssm:<region>:<account>:parameter/console/DATABASE_URL" },
        { "name": "DATABASE_CA", "valueFrom": "arn:aws:ssm:<region>:<account>:parameter/console/DATABASE_CA" },
        { "name": "AUTH_SECRET", "valueFrom": "arn:aws:ssm:<region>:<account>:parameter/console/AUTH_SECRET" },
        { "name": "GITHUB_CLIENT_SECRET", "valueFrom": "arn:aws:ssm:<region>:<account>:parameter/console/GITHUB_CLIENT_SECRET" },
        { "name": "S3_ACCESS_KEY_ID", "valueFrom": "arn:aws:ssm:<region>:<account>:parameter/console/S3_ACCESS_KEY_ID" },
        { "name": "S3_SECRET_ACCESS_KEY", "valueFrom": "arn:aws:ssm:<region>:<account>:parameter/console/S3_SECRET_ACCESS_KEY" }
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
      "image": "cloudflare/cloudflared:<the latest release, from github.com/cloudflare/cloudflared/releases>",
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

With Google: `GOOGLE_CLIENT_ID` and `GOOGLE_WORKSPACE_DOMAIN` in `environment`, `GOOGLE_CLIENT_SECRET` in `secrets`; without GitHub, the two GitHub entries are dropped. The connector starts only once the console is ready (`dependsOn` on the health check, which is `/readyz`), and stops first when the task stops, so a rollout never routes to a task that is not serving; the console's `stopTimeout` of 30 seconds is above its grace period of 20. The console sees every request from the loopback with the client's address in `cf-connecting-ip`, which is why the trusted proxy is `127.0.0.1`; its keep-alive of 100 seconds outlasts the connector's idle timeout of 90 (checked 2026-10). The image is the Node.js base, which has no `curl`, so the health check uses Node itself.

### `deploy/worker.task.json` (at `large`)

The same with `"family": "console-worker"`, `"cpu": "256"`, `"memory": "512"`, one container `worker` with `"command": ["worker"]`, the `environment` reduced to `WORKSPACE_NAME`, the `secrets` to `DATABASE_URL` and `DATABASE_CA`, no port, no health check, `"stopTimeout": 30`, the log stream prefix `worker`, and no tunnel.

### `deploy/migrate.task.json`

The same with `"family": "console-migrate"`, `"cpu": "256"`, `"memory": "512"`, one container `migrate` with `"command": ["migrate"]`, `secrets` `DATABASE_URL` and `DATABASE_CA`, no environment, no port, no health check, the log stream prefix `migrate`, and no tunnel: a connector must never start for a one-off task.

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
            jq --arg image "$IMAGE" '(.containerDefinitions[] | select(.name != "tunnel") | .image) = $image' "deploy/$role.task.json" > "$RUNNER_TEMP/$role.json"
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
          aws ecs wait services-stable --cluster "$ECS_CLUSTER" --services api
```

What it does on every push that touches `deploy/` or `console-ui/`: builds the image from the console's pinned commit (and, when `console-ui/` exists, the organization's own console on top of it, as `deploy/README.md` "A custom console in the image" says), pushes it under a tag of its own (the console's commit, the repository's commit and the run's number, so that a run on the same commit still gets a new tag), registers the task definitions with that image, runs `migrate` as a one-off task and stops if it did not exit `0`, then rolls `api` (and `worker`) with a circuit breaker that rolls back a deployment whose tasks never become healthy, and waits for `api` to be stable. The first push creates the services. Pin the actions' majors to the current ones (`checkout@v4`, `configure-aws-credentials@v4`, `amazon-ecr-login@v2`, checked 2026-10; the actions' pages say when a newer major exists).

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

### The rest of the repository

- `README.md`, in the organization's language: what this repository is (the deployment of the organization's console), that a push to `main` deploys, where the record is, and where the skill that made it lives (`skillcdn.ai/gh/skillcdn/console`).
- `DEPLOY.md`: the draft from the template (phase 8), filled as far as the run has gone.
- `console-ui/`: only when the organization has its own console (building-a-console makes it); otherwise absent and the image's default UI serves.

### Commit, create, push, watch

`git add -A && git commit -m "The console's deployment"` (`.gitignore` keeps `scratch/`, the key file and the token file out; check with `git status --short` that nothing of them is staged); show the files to the person; `gh repo create <owner>/<name> --private --source . --remote origin` (without `--push`), or `git remote add origin <the address the person gave>`. Checkpoint, then `git push -u origin main`; a few seconds later `RUN=$(gh run list --limit 1 --json databaseId -q '.[0].databaseId')` and `gh run watch "$RUN" --exit-status` (`gh run view "$RUN" --log` when it fails). The first run takes about ten minutes: the build, the push, the migration, the services.

## Phase 5: Live

```sh
cf "/zones?name=<domain>" | jq -r '.result[0].status'                                    # active; else the wait of the skill
curl -sS -o /dev/null -w '%{http_code}\n' https://<hostname>/readyz                       # 200
curl -sS https://<hostname>/api/v1/me | jq .signIn                                         # the providers set, asked as nobody
cf "/accounts/<CF_ACCOUNT>/cfd_tunnel/$TUNNEL/connections" | jq '.result | length'         # 1 or more
aws ecs describe-services --cluster console --services api --query 'services[0].[runningCount,deployments[0].rolloutState]'
aws logs tail /console --since 15m --format short | grep -E 'migrations applied|api listening|files go to the bucket'
```

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
RUN_ID=$(console take "$NUMBER" --json | jq -r .id)
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

Made on <date> with the skill `deploying-a-console` of the SkillCDN Console (skillcdn.ai/gh/skillcdn/console), from commit `<CONSOLE_REF>` of `skillcdn/console`.

## What exists

| What | Where |
|---|---|
| The console | https://<hostname>, through Cloudflare (zone <domain>, tunnel `console`, id `<tunnel id>`) |
| AWS account and region | <account id>, <region> |
| Containers | ECS cluster `console`; services `api` (<n> tasks of <cpu>/<memory>)<, `worker`>; task families `console-api`, `console-migrate`<, `console-worker`> |
| Database | RDS PostgreSQL <version>, `console`, <class>, <storage>, <one zone | two zones>, backups 7 days, deletion protection on |
| Files | S3 bucket `console-files-<account>`, read and written by the IAM user `console-files` |
| Secrets | SSM Parameter Store, `/console/*`: <the names> |
| Logs | CloudWatch Logs `/console`, kept 30 days |
| Images | ECR `console`, one tag per deployment |
| Roles | `console-task-execution`, `console-task`, `console-github-deploy` (assumed by this repository's `main`) |
| Size and cost | `<size>`; about <estimate> a month at <date>'s prices; a budget alert at <amount> emails <address> |

## How it is run

- **A deployment** is a push to `main` that touches `deploy/` or `console-ui/`: the workflow builds the image, runs the migrations, and rolls the services. `gh run list` shows the runs.
- **A new version of the console:** set `CONSOLE_REF` in `deploy/console.env` to the commit, push.
- **A person added or removed:** `MEMBERS` and `ADMINS` in `deploy/api.task.json`, push. Administrators also change roles on the People page.
- **The next size:** the numbers in `deploy/api.task.json` (and `deploy/worker.task.json` at `large`), `API_COUNT` and `WORKER_COUNT` in `deploy/console.env`, push; the database: `aws rds modify-db-instance --db-instance-identifier console --db-instance-class <class> --apply-immediately` (a few minutes of unavailability).
- **A secret rotated:** `aws ssm put-parameter --name /console/<NAME> --type SecureString --overwrite --cli-input-json file://<file>`, then `aws ecs update-service --cluster console --service api --force-new-deployment`.
- **The organization's own console:** its source in `console-ui/` (building-a-console makes it); a push builds it into the image.
- **Paused:** `aws ecs update-service --cluster console --service api --desired-count 0` (and `worker`), `aws rds stop-db-instance --db-instance-identifier console` (seven days at most); the reverse resumes.
- **Removed:** the skill's "Removing", resource by resource, confirmed.

## What is owed

<a provider's secret said later, with its steps; nameservers; a secret pasted into the chat, to be made anew; nothing>

## Verified on <date>

`/readyz` 200 at the address; <who> signed in as administrator; project `<key>` made; the agent connected with a code; the deployment check handed in and found in the bucket under its hash; workflow run <id> green.
```

A change to `DEPLOY.md` or `README.md` alone does not run the workflow (its `paths`), so the record is pushed without a deployment.

## Removing

Only on request, each step confirmed, in this order, after a last snapshot of the database: the services (`aws ecs update-service --desired-count 0`, then `delete-service`), the cluster; the hostname (`DELETE /zones/<zone>/dns_records/<id>`) and the tunnel (`DELETE /accounts/<account>/cfd_tunnel/<id>`, after `.../connections` is empty); the database (`modify-db-instance --no-deletion-protection`, then `delete-db-instance --final-db-snapshot-identifier console-final-<date>`); the bucket, emptied first (`aws s3 rm s3://<bucket> --recursive`, then `delete-bucket`); the parameters; the users' keys and the users; the roles' policies and the roles; the log group; the image repository (`--force`); the security groups; the budget. The deployment repository stays, with the record of what was removed and the snapshot's name.

## When a step fails

| Symptom | Cause | What to do |
|---|---|---|
| `AccessDenied` or `UnauthorizedOperation` naming an action | The deployer's policy lacks it | Add the action to the policy (access.md) and run the step again |
| A log group or a parameter gets a name like `C:/Program Files/Git/console` | Git Bash rewrote the `/console` argument | `export MSYS_NO_PATHCONV=1`, delete the misnamed resource, run the step again |
| `aws rds create-db-instance` refuses the engine version | The region has no PostgreSQL 18 yet | `describe-db-engine-versions --engine postgres` and take the newest major it lists |
| `create-bucket` says the name is taken | Bucket names are global | Add a short suffix and update the task definition and the files policy |
| `POST /zones` is refused with a permission error | The token lacks Zone Edit | Add the row (access.md) and run the step again |
| The migration task exits `78` | A variable refused; the log names it, never its value | Fix the parameter or the environment entry, push again |
| The migration task exits `1` with a connection error | The tasks' group is not allowed into the database's, or the URL's host is wrong | Check the `authorize-security-group-ingress` and the endpoint in `DATABASE_URL` |
| `ResourceInitializationError` on a task: unable to pull secrets | The execution role cannot read `/console/*` | Check `console-parameters` on `console-task-execution` and the parameter ARNs |
| A task stops before it is healthy; the log says `api listening` and then nothing | The health check fails: wrong port or `/readyz` not `200` (database unreachable, schema behind) | `aws logs tail /console --since 10m`; `/readyz` says which of the three |
| The service never stabilizes and rolls back | The circuit breaker tripped on the above | Fix the cause; `--force-new-deployment` |
| The tunnel shows no connector while `api` is healthy | The token is wrong, or the task has no public IP for its egress | Check `TUNNEL_TOKEN` and `assignPublicIp=ENABLED` in the network configuration |
| `https://<hostname>` answers 530 or 502 from Cloudflare | No connector yet, or the hostname's ingress rule points elsewhere | Wait for the service; check the tunnel's configuration and the DNS record |
| `https://<hostname>` does not resolve | The zone is not active yet | The nameservers at the registrar; `cf "/zones?name=<domain>"` says when |
| The sign-in button is missing | The provider's id or secret is not in the task definition | Both halves or neither; check `environment` and `secrets` |
| The sign-in is refused after the provider | The login is not in `MEMBERS` (or the domain not in `GOOGLE_WORKSPACE_DOMAIN`) | Add it, push |
| The image pull of `cloudflared` is refused | Docker Hub's anonymous pull limit | Try again; when it keeps failing, a step in the workflow mirrors the image into ECR (`docker pull`, `docker tag`, `docker push`) and the task definition points there |
| `gh run watch` shows the build failing on `npm ci` in `console-ui` | The UI's lockfile is out of step | Fix in `console-ui/` (building-a-console), push |
| A 524 at Cloudflare on a long read | A request held longer than the proxy's 100 seconds | The console holds a decision's read for 50 at most; look for a slow database |

## Facts that move

- AWS App Runner stopped taking new customers on 2026-04-30 and is in maintenance; ECS Express Mode (2025-11) is AWS's successor and provisions a load balancer (checked 2026-10).
- Fargate: `stopTimeout` from 2 to 120 seconds, 30 when unset; containers stop in the reverse order of their start dependencies (checked 2026-10).
- SSM Parameter Store: 4 KB per standard parameter, 8 KB per advanced one at about $0.05 a month; the RDS regional certificate bundle is about 4.5 KB with three authorities (checked 2026-10).
- RDS for PostgreSQL has had major version 18 since 2025-11 (checked 2026-10).
- Cloudflare: a proxied request's idle limit is 100 seconds on every plan but Enterprise; the Free plan allows one rate limiting rule with a ten-second window; a tunnel costs nothing and its connector token is read from `TUNNEL_TOKEN`; a remotely managed tunnel's routing is the `configurations` document, whose last rule has no hostname; creating a zone needs Zone Edit on the token (checked 2026-10).
- A new AWS account made after 2025-07-15 starts with $100 of credits and a choice between a free plan that ends after six months and a paid one (checked 2026-10).
- Git Bash on Windows rewrites an argument that starts with `/` into a Windows path for a native program unless `MSYS_NO_PATHCONV=1` is set (checked 2026-10).
