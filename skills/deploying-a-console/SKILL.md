---
name: deploying-a-console
description: "Deploys a SkillCDN Console for an organization on AWS behind Cloudflare, by an agent on the person's machine, no developer needed: asks a few plain questions (how many people, the web address, how people sign in and who is in, where the organization's skills are, and its website, whose look the console takes by default), shows the monthly cost of the fitting size and the next before anything is made, creates the database, bucket, secrets, tunnel and containers, builds the organization's own look into the image, leaves a private repository that redeploys on every push, signs the first administrator in, makes the first project, connects an agent and proves it with a file handed in and read back. Also grows it to the next size, updates it to a new version of the console, adds a member or rotates a secret. Use when an agent is asked to deploy, set up, host, upgrade or resize a console for an organization. To build a console's pages, use building-a-console; to work tasks on a board, use working-the-board."
license: MIT
compatibility: Needs a shell with Node.js 24 or newer, git, curl, jq and the AWS CLI v2, the gh command signed in or an empty repository the person made, network access to AWS, Cloudflare, GitHub and npm, an AWS account and a domain on Cloudflare the person can create a key and a token for, and a browser on any device for the few steps only a signed-in person can take. Works in any agent that can run a shell and write files; on Windows, in Git Bash with path conversion off.
metadata:
  author: skillcdn
  version: "1.4"
skillcdn:
  translations:
    ko:
      title: 조직의 콘솔 배포하기
      description: "조직의 SkillCDN 콘솔을 AWS와 Cloudflare에 배포합니다. 개발자가 아니어도 됩니다: 에이전트가 쉬운 질문 몇 개(몇 명이 쓰는지, 주소, 로그인 방식과 구성원, 조직 스킬의 위치, 그리고 조직의 웹사이트. 웹사이트가 있으면 그 디자인이 콘솔의 기본이 됩니다)를 묻고, 맞는 크기와 그 다음 크기의 월 비용을 먼저 보여준 뒤, 데이터베이스·버킷·비밀·터널·컨테이너를 만들고, 조직의 디자인을 이미지에 담고, 푸시할 때마다 다시 배포되는 비공개 저장소를 남기고, 첫 관리자를 로그인시키고 첫 프로젝트를 만들고 에이전트를 연결해 파일 제출과 되읽기로 증명합니다. 규모 키우기, 콘솔 새 버전으로 올리기, 구성원 추가, 비밀 교체도 합니다. 조직의 콘솔을 배포·설치·호스팅·업그레이드·확장하라고 할 때 쓰세요. 콘솔 페이지를 만들 때는 building-a-console, 보드의 작업을 할 때는 working-the-board를 쓰세요."
---
# Deploying a console for an organization

What goes in: an AWS account, a domain on Cloudflare or one to buy, and the answers to a few plain questions. What comes out: the console at `https://<hostname>`, signed in by its first administrator, with a first project and an agent connected; running as containers on AWS next to a managed PostgreSQL and a bucket, reached only through Cloudflare, every secret in a parameter store; a private deployment repository whose every push rebuilds and redeploys; a budget alert; and a record, `DEPLOY.md`, of what exists and how it is run. The person never needs to know the cloud: every choice is derived from their answers, shown with its cost, and changed when they ask. The shape and why it was chosen are [ADR-0017](/docs/adr/0017-the-reference-deployment-is-the-image-on-aws-behind-cloudflare-written-as-a-skill.md); what the console asks of any platform is [deploy/README.md](/deploy/README.md). For one machine, a trial, or a closed network that reaches no cloud, the smallest install of [deploy/README.md](/deploy/README.md#the-smallest-install-and-a-closed-network) is the shape, not this skill: the image next to PostgreSQL with the packs in a directory, carried in where nothing is reachable.

## How the person is involved

- **Questions:** one message at the start, the ones under "Inputs" that the request leaves open, in plain words. Then a second message, so that the questions stay short: the order of cost for the size ([sizing.md](references/sizing.md)'s snapshot, named as such) and the two credentials to create ([access.md](references/access.md)), so that the person knows what it costs before an account or a key exists, and the credentials are ready when the plan is.
- **Checkpoints:** the plan with today's cost, before anything is made; each purchase with its price (a domain); a secret only the person holds, asked with the exact steps once the address is known; the first push, which starts the first build and makes the address public once it serves; the record's push; the deletion of the secrets file and the token file. One short message each, with the recommendation, and "OK", in the person's language, continues.
- **Go-ahead:** when the person says to go ahead alone, the reports between phases need no answer. The plan, a purchase, the first push and a deletion are confirmed in every mode.
- **Waiting:** what only the person or the world can finish, the run waits for, in the open. A domain whose nameservers the person must change answers at Cloudflare minutes to hours later: the zone is made first, the steps go out in the second message, and from phase 5 the run checks the zone every ten minutes for up to an hour, saying so; still not there, it stops with the record saying what waits and resumes at phase 5 when the person says the nameservers are set. The only way of signing in answered `later` means nobody can sign in: the run stops at phase 5 the same way and resumes when the secret is in the secrets file.
- **Changes mid-run:** applied from that point. What was created is kept and recorded, never silently deleted.
- **Language:** messages to the person in the language they wrote in; the repository's files in English, its `README.md` and `DEPLOY.md` in the organization's language.

## Requirements

| What | Used for |
|---|---|
| A shell with Node.js 24 or newer, git, curl, jq and the AWS CLI v2 (`aws --version`); on Windows, Git Bash with `export MSYS_NO_PATHCONV=1`, since Git Bash otherwise rewrites an argument that starts with `/` (a log group, a parameter) into a Windows path before a program sees it | Every command of the run; the deployment repository |
| The deployer's access key and the Cloudflare token, as [access.md](references/access.md) says they are made and reach the agent | Everything on AWS and at Cloudflare |
| The `gh` command signed in (`gh auth status`), or an empty private repository the person made | The deployment repository, its first push, watching its runs |
| The `console` command, `npm install -g @skillcdn/console` in phase 1 | The proof at the end: an agent connected, a file handed in; and this skill's two scripts, which the package carries at `$(npm root -g)/@skillcdn/console/skills/deploying-a-console/scripts/`, copied into the run's `scratch/` folder, or read through the connection and written there |
| The person, with a browser on any device | The GitHub App or the Google client, the first sign-in, approving the agent's code, a registrar's nameservers |
| Network access to AWS, Cloudflare, GitHub and npm | |

Check these before the first message. Without the AWS CLI, offer to install it (access.md); without `gh`, the person makes the repository; without network, stop. This skill's own pages ([access.md](references/access.md), [sizing.md](references/sizing.md), [resources.md](references/resources.md)) arrive with it through SkillCDN, in the package, and in a copy of its directory. `deploy/README.md` and the decisions are read through the repository connection or in a checkout of the console's repository; without them, this skill and its pages carry the shape.

## Inputs

| Input | Source |
|---|---|
| How many people | Asked: "How many people will use the console within a year: just you, up to 10, up to 30, or up to 100?" The answer picks the size ([sizing.md](references/sizing.md)). |
| The board's name | Suggested from the convention and confirmed, never invented: the organization or the person the console is for, then Console, as `SkillCDN Console` is named. With the organization's name in the request or on its website: "The board will be called `Acme Console`, as consoles are named: the organization's name, then Console. Keep it, or say another?" Without one: "Whose console is this, your organization's or yours? Its name, then Console, is what the board is called." It goes to `WORKSPACE_NAME`, one line of up to 100 characters: what the pages say after the SkillCDN mark, and what the console calls itself at SkillCDN when it connects a pack. |
| The web address | Asked: "Which web address should the console have? A domain you already own, and where it is registered (I set it up on Cloudflare; you change its nameservers there once, and I give you the steps), or should I find one to buy (I show the price before buying)? I suggest `console.<domain>`." A domain is needed: the tunnel has no free hostname. A domain that already serves the organization's site is fine: only the console's hostname is added to its zone, and nothing of the site is touched (resources.md "A zone that serves other hosts"). |
| How people sign in, and who | Asked: "How should people sign in: with GitHub, with Google (Workspace), or both? Who configures the console (you, at least): their GitHub login or Google address. With GitHub, everyone of your organization can be in, as the organization has them: say which organization. With a Google Workspace, everyone of the domain is in. Anyone else, an administrator lets in on the People page once the console runs." |
| The organization's skills | Asked: "Where are your organization's skills on SkillCDN, if anywhere yet? An address like `/gh/<owner>/<repo>`. Is that repository private?" Default: none; a project names one later on its Settings page. A private one is connected in phase 6, with a code the person approves at SkillCDN ([ADR-0036](/docs/adr/0036-a-private-pack-is-connected-with-a-code-a-person-approves-from-the-projects-settings.md)); nothing of it is needed before. |
| The organization's website, and the look | Asked: "Does your organization have a website? Its address." With one, the console takes the organization's look by default: the marks, the colours and the type read from the site as building-a-console's [the-look-from-a-website.md](/skills/building-a-console/references/the-look-from-a-website.md) says, mapped onto the pages and shown at the plan, and built into the image as the organization's own console, `console-ui/` of the deployment repository, so that the first deploy already carries it. Without a site, or when the person says the default pages are fine, the image's default pages serve: the board's name alone, and no marks. A look that is wanted later is the same skill, building-a-console, in `console-ui/`, and a push. |
| The AWS account | Asked: "Do you have an AWS account for this, or should the console get an account of its own (the simplest to run and to read the bill of)?" A new account is made by the person, on the paid plan, with the order of cost already in front of them (the second message). |
| The region | Asked when the organization's country does not say: "Which AWS region: the one nearest your people?" Default: the nearest to where the organization is (`ap-northeast-2`, Seoul, for Korea; `ap-northeast-1` for Japan; `eu-central-1` for central Europe; `us-east-1` for the eastern United States). |
| The run's folder | Asked with a suggestion: "Which folder should the deployment live in on this machine? I suggest `console-deploy` under your home folder." It is made at once and becomes the deployment repository. |
| The deployment repository | Asked: "Where should the deployment's files live on GitHub: a private repository under your account, or under an organization you name?" Its name is the folder's. |
| Where alerts go | Asked: "Which email should the cost alert go to?" |
| The console's version | Derived: the latest release of the console, the tag `@skillcdn/console@<version>` of its repository: the last line of `git ls-remote --tags https://github.com/skillcdn/console 'refs/tags/@skillcdn/console@*' \| sort -t@ -k3 -V` is the highest version, and its first column the commit (an annotated tag lists its commit on a `^{}` line, which sorts last the same way), pinned in the deployment repository as `CONSOLE_REF`. An organization's own console (building-a-console) depends on the package at that same version, so that the pages and the server are one release. An update is the next tag, a new commit there. |
| Everything else | Derived and shown in the plan: the size's numbers, the names (`console` for the cluster and the database, `api` and `worker` for the services, `console-files-<account id>` for the bucket), the generated secrets (`AUTH_SECRET`, the database password), the variables of [deploy/README.md](/deploy/README.md) with the tunnel's settings (`TRUSTED_PROXIES=127.0.0.1,::1`, `CLIENT_IP_HEADER=cf-connecting-ip`, `HTTP_KEEP_ALIVE_SECONDS=100`) and the bucket read and written as the task's own role (`S3_CREDENTIALS=platform`), so that no key exists for it; the connector's image, mirrored into the organization's image repository; the estimate of this size and the next, the budget alert at one and a half times the estimate, the rate limiting rule on the sign-in paths, and what the person does once. |

## Workflow

Each phase produces a named artifact and ends with one line to the person. The procedure of each, its commands, its checks and what to do when a step fails, is in [resources.md](references/resources.md) under the phase's name; the sizes and the prices in [sizing.md](references/sizing.md); the credentials and the dashboard steps in [access.md](references/access.md).

### Phase 1: Access

Produces the **access record**: the account id, the region, the default VPC and its subnets, the Cloudflare account and the zone of the domain (or none yet; or one that serves the organization's site already), the git host owner. Make the run's folder with its `scratch/` subfolder and `.gitignore`; install the `console` command and copy this skill's scripts into `scratch/`; import the key into the profile `console` and read the token from its file, as access.md says, and verify each with the harmless calls there. What a harmless call can show, report now with the row to add: an action the deployer's policy lacks. A Cloudflare token's permissions show only at the first creation, since Read lists what Edit makes, so the step that fails names the row (resources.md "When a step fails").

### Phase 2: Plan and estimate

Produces the **plan**, shown at the checkpoint. From the answers: the size and what it is made of (sizing.md "The sizes"); today's prices, read as sizing.md "Reading today's prices" says, and the estimate of this size and the next one, each line saying whether it is today's price or the snapshot; the resources to create under which names; the domain's path (owned, with the registrar's steps already sent; bought at the price shown); the secrets, which are generated, which are derived, and which the person holds and will be asked for at phase 3 with the exact steps; the look, with a website: the marks found on it, the colours and how they map onto the pages, the type and whether it can be taken, as a table, with a mock or a screenshot where a browser can be driven; the budget alert; the few steps only the person takes, and when. Then stop, with the estimate message of sizing.md and: "I will create <the resources>, set <n> secrets, connect <hostname> through Cloudflare, build the console in your look (<the marks and the colours>), and make a repository at <owner>/<name> that deploys on every push. You do once: <the steps>. OK?"

### Phase 3: Foundation

Produces the **resource record**: each resource with its name and id. In this order: the zone at Cloudflare, with the records the domain serves already found by Cloudflare's scan and checked by the person against their registrar's DNS page, so that nameservers propagate meanwhile; the network and its two security groups; the database, started, and waited for while the rest is made; the bucket; the image repository, the log group, the roles, the task's with the bucket's policy, the cluster; the tunnel, the hostname, always-HTTPS for the hostname and the rate limiting rule; the parameters, generated and derived, from the secrets file. Then, the hostname being known, the message for each secret the person holds (access.md "The GitHub App", "The OAuth client"): "Save it in the secrets file as the line I show, or say `later` and that way of signing in stays off until it is set." A value the person pastes into the chat instead is written into the file by the agent's file tool, never repeated, and the person is told to generate a new one once the run is over, since the chat kept a copy; the new one goes in as "a secret rotated" of the record.

### Phase 4: The deployment repository

Produces the **repository**: `deploy/console.env`, the task definitions `deploy/migrate.task.json`, `deploy/api.task.json` and, at the large size, `deploy/worker.task.json`, the workflow `.github/workflows/deploy.yml`, `README.md` and a draft `DEPLOY.md`, as resources.md gives them, every value filled from the record; with the organization's look, `console-ui/`, the organization's own console made here with building-a-console at the console's pinned version, from the look approved at the plan, which the workflow builds into the image on every push (resources.md "The organization's own console"); and on AWS the role the workflow assumes, trusted for this repository's `main` alone. Show the files, each with the lines that matter pointed out for a person who is not a developer, and the look's pages where a browser can be driven; commit; create the empty private repository. Checkpoint: "Pushing starts the first build (about ten minutes), runs the migrations, and starts the console at <hostname>. OK?" On the word, push, and watch the run to its end.

### Phase 5: Live

Produces the **live address**. The zone is active (else the wait of "How the person is involved"); `https://<hostname>/readyz` answers `200` through Cloudflare; the page shows the sign-in buttons of the providers set (none set: the stop of "How the person is involved"); the tunnel shows a connector; the log says `api listening` and `files go to the bucket`; the rollout is complete. Create the budget alert. Report the address.

### Phase 6: The first people

Produces the **first administrator and the first project**. Tell the person: "Open <address> and sign in with <provider>; you are an administrator. Make the first project: Projects, New project, a key such as `general`, its name, and the skills address <address or none>. Tell me the key." Then connect this agent: `console login --url <address> --agent deploying-a-console`, which shows an address and a code; relay them, and the person approves on the console's own pages. `console use <key>` in the run's folder. A private pack: `console project pack-token <key> --connect`, which prints a page at SkillCDN and a code; relay them, and the person, signed in at SkillCDN as someone who may open the repository, checks the code and approves there; the command says when the pack is connected, and `console skills` then lists it. Nothing is pasted.

### Phase 7: Proof

Produces the **proof**: `console task new "Deployment check"` with a body that says what this run deployed, `console take <number>` (`task new --json` answers the task, whose `.number` this is; `take --json` answers the run and the task, and the run's id is `.run.id`), `console hand-in scratch/deployment-check.md --label "the check"` with a small file written for it, `console run <id> --json` showing the file with its hash, the object under that hash in the bucket (`aws s3api head-object`), and `console finish --summary "<what was deployed, and what is owed>"`. The task stays on the board as the first record of the deployment.

### Phase 8: Record and delivery

Produces **`DEPLOY.md`** in the repository, from the template in resources.md: what exists under which names, the size and its estimate, how a deploy happens, how to add a member, update, grow, rotate a secret, pause and remove, and what is owed. Checkpoint: "Committing and pushing the record. OK?" (a change to the record alone does not redeploy). Then, on the person's word, delete the secrets file and the token file. Deliver in one message: the address, what was made in the person's words, the estimate and the alert, what the person still owes (a `later` secret, nameservers), what was verified and how, and how the console is operated from here: the record, and a push.

### Running it again

The same skill, from phase 2, with the plan naming only what changes: a new version (the next release tag's commit as `CONSOLE_REF` in `deploy/console.env`, with `console-ui/` moved to the same version of the package when there is one, a push), a new connector (`CLOUDFLARED_VERSION` there, a push), the next size (the numbers in the task definitions and a push; the database's class with one command, as sizing.md "Growing" says), a person let in or taken out (on the People page, or `console person add <login>` and `console person deactivate <login>`, by an administrator; no push), a secret rotated (the parameter overwritten, the service rolled), the console paused or removed (resources.md "Removing"). Each is confirmed at the plan, and the record is updated with it.

### Verdicts

| Result | Verdict |
|---|---|
| `/readyz` answers `200` at the hostname over HTTPS; the administrator signed in; the project made; the agent connected with a code; the file handed in is in the bucket under its hash and `console run` shows it; the workflow's run is green; every parameter is present; the record is pushed | Accepted |
| A second way of signing in is `later` (it stays off); the budget alert waits on the person confirming its email | Accepted, with the gap named in `DEPLOY.md` and the delivery |
| The zone waits for its nameservers, or the only way of signing in is `later`: phases 5 to 7 wait with it, the record says so, and the delivery says what was verified and what waits | Paused, to resume at phase 5 |
| A task never becomes healthy (the log says why: exit `78` names a variable, a database unreachable names the network), the tunnel shows no connector, the first sign-in is refused, the migration task exits other than `0` | Redone from the phase that failed, with resources.md "When a step fails"; the person is told what was tried |

## Hard rules

1. The access key, the token and every secret stay out of the repository, the logs, the chat and the agent's own words: a value is read from its file into the environment or the parameter store, never put as a literal on a command line, never echoed; a value the person pasted is written to its file with a file tool and the person is told to make a new one when the run is over; the secrets file is deleted, on the person's word, when its values are stored. A leak means a rotation, which the person is told at once.
2. Nothing is bought or made before the price is in front of the person and they said the word: the second message carries the order of cost, the plan carries today's estimate of everything that bills; a domain is bought only after its price is shown.
3. The first push is confirmed, and every push after it: once the repository is connected, a push is a deployment, which the person chose at the plan.
4. The person is never asked to do what the key and the token can do; what only they can do (a GitHub App or a Google client, a sign-in, approving a code, nameservers at their registrar) is given as the exact steps of the day in one message, for the registrar they named where its steps are known and in general words otherwise, so that they can do it while the run goes on.
5. Nothing of the deployment listens on the internet: the tasks' security group has no inbound rule, the database is not publicly accessible, the bucket blocks public access, and the hostname reaches the console only through the tunnel.
6. Names and ids go into the repository and the record; a value a secret scanner would flag never does, and `scratch/`, the key file and the token file never enter git. Every file the repository gets is shown before it is pushed.
7. What was created is kept and recorded, never silently deleted; removing the deployment is a run of its own, asked for, and confirmed resource by resource.
8. The console's contract holds on every rollout: `migrate` runs and exits `0` before the new `api` and `worker` start, as the one-off task of the workflow, or, without a pipeline, as a container of every task of both roles that its own container waits on (resources.md "Without a pipeline"); the stop timeout stays above the shutdown grace period, and no secret is a build argument.

## Terms

| Term | Meaning |
|---|---|
| Size | `small`, `medium` or `large`: the numbers of sizing.md, chosen by how many people. |
| The deployer | The IAM user whose key the agent acts with, as the profile `console` of the AWS CLI. |
| The task's role | The role the containers run as, `console-task`, whose credentials the platform hands them and renews: it may read and write the bucket, and nothing else; no key exists for the files. |
| The run's folder | The folder the person chose, which becomes the deployment repository; `scratch/`, the key file and the token file in it never enter git; the secrets file is beside it, in the folder above. |
| The tunnel | The Cloudflare Tunnel whose connector runs beside the `api` container; the hostname's traffic comes in through it and nothing else does. |
| Task, service | On ECS, a task is the containers of one role running together; a service keeps the wanted number of tasks running and rolls them to a new definition. |
| Parameter | A value in SSM Parameter Store that a task reads as an environment variable at start. |
| The deployment repository | The private repository of the task definitions, the workflow and the record; a push to it is a deployment. |
| `DEPLOY.md` | The record: what exists under which names, how it is run, what is owed, what it costs. |
| Later | A secret the person did not supply; the way of signing in it serves stays off, and the record says so. |
