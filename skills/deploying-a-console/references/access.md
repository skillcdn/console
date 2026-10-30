# Access: what the person creates once, and how it reaches the agent

What the agent needs to act on the organization's accounts, the exact steps of the day for the person to create each, and how each value reaches the agent without passing through the chat. Dashboards move; every path here carries the month it was checked, and the vendor's own page is the source when a label has changed.

## The AWS account and the deployer

**Which account.** The skill asks whether the organization has an account for this. A dedicated AWS account for the console is the simplest to run and to read the bill of: nothing else shares it, and one budget alert covers it. An account that already runs other things works with the scoped policy below. A new account (`aws.amazon.com`, Create an AWS account; a payment method is asked; checked 2026-10) is created by the person on the **paid plan**, once the order of cost is in front of them (the skill's second message): the free plan ends after six months and closes the account with its data, and a console is meant to stay. Both plans start with credits, which the paid plan spends on the first months' bills.

**The deployer user and its policy.** Signed in to the account, in the IAM console (checked 2026-10):

1. Users, Create user. Name `console-deployer`. Leave console access off: this user is for the agent's commands only. Next.
2. Permissions: Attach policies directly. In a dedicated account, `AdministratorAccess`, which is the honest choice when nobody else is in the account. In a shared account, first create a policy from [deployer-policy.json](../assets/deployer-policy.json) (Policies, Create policy, JSON, paste, name it `console-deployer`), then attach that one. The scoped policy is broad where names cannot be known in advance and tight where they can (`console-` prefixed roles and buckets, `/console/` parameters); a step the policy does not cover fails with `AccessDenied` naming the action, and the fix is to add that action.
3. Create user. Open it, Security credentials, Access keys, Create access key. Use case: Command Line Interface (and tick the confirmation), or Other. Next, Create access key. **Download .csv file.** The secret is shown once; the file is the one copy.

**How the key reaches the agent.** Save the downloaded file as `.aws-key.csv` in the run's folder, and tell the agent. The agent reads the two values from the file with a script, writes them as the profile `console` into the AWS CLI's own credentials file (`~/.aws/credentials`, the person's file, readable by them alone where the system can say so), sets the region on the profile, and deletes `.aws-key.csv`; neither value is ever written in a command line, a message or a log. A key pasted into the chat instead is written to the profile the same way and never repeated, and the person is told to make a new key once the run is over, since the chat kept a copy.

**The AWS CLI.** Version 2: `aws --version`. Without it, Windows: `winget install Amazon.AWSCLI`; macOS: `brew install awscli`, or the installer at `docs.aws.amazon.com/cli` (checked 2026-10). The agent installs it with the person's word.

**Verify:**

```sh
aws sts get-caller-identity --profile console          # the account id, and the user's ARN
aws ec2 describe-vpcs --profile console --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId'
```

The first answers with the account id the plan names; the second with the default VPC, or nothing, in which case `aws ec2 create-default-vpc` makes one (the deployer's policy allows it). Every command of the run carries `--profile console` (or `AWS_PROFILE=console` in the shell) and `--region <region>`.

## The Cloudflare account and the token

**The domain.** The console's address is a hostname of a zone on Cloudflare: a domain the organization already has, moved to Cloudflare's nameservers (the zone is made first in the run, and the two nameservers it answers go to the person to set at their registrar), or one bought through Cloudflare's Registrar in the run with its price shown first. There is no free hostname for a tunnel; a domain is needed. The account is free (`dash.cloudflare.com/sign-up`). A domain already on Cloudflare and serving the organization's site is the usual case and needs nothing moved: the run adds the console's hostname to that zone and touches nothing else of it (resources.md "A zone that serves other hosts").

**The nameservers, at the registrar.** The person named the registrar with the domain; give its steps where they are known (the registrar's own help page for "nameservers" or "DNS settings", read at run time), and otherwise the general ones: sign in at the registrar, open the domain, find the nameserver (NS) setting, replace what is there with the two names Cloudflare gave, save; the change takes minutes to hours to reach the world, and the run checks the zone's status until it is `active`. Everything else of the domain's DNS (mail records, other hosts) must be in the Cloudflare zone before the switch, so that nothing stops working: the run has Cloudflare scan for the common records, shows the person what it found, and asks them to compare with the registrar's DNS page and send what is missing (resources.md "The zone, first").

**The token.** My Profile, API Tokens (`dash.cloudflare.com/profile/api-tokens`), Create Token, **Create Custom Token** (checked 2026-10). Name it `console deploy`. Permissions, one row each:

| Scope | Permission | Level | For |
|---|---|---|---|
| Account | Cloudflare One Connector: cloudflared | Edit | The tunnel the task connects out through, and its routing. The row was called "Cloudflare Tunnel" before and is listed as "Argo Tunnel (Legacy)" beside the new name, which still works; the API reports it as "Cloudflare Tunnel Write" (checked 2026-10) |
| Account | Account Settings | Read | The account id, only when the zone is made or a domain bought in the run; a zone that exists names its account itself |
| Zone | DNS | Edit | The console's hostname |
| Zone | Zone | Edit | Making the zone for a domain the organization owns, finding it, its status and nameservers |
| Zone | Zone Settings | Edit | Always use HTTPS, on a zone of the console's own |
| Zone | Dynamic URL Redirects | Edit | Always HTTPS for the console's hostname alone, on a zone that serves other hosts too (resources.md "A zone that serves other hosts") |
| Zone | Zone WAF | Edit | The rate limiting rule |
| Account | Registrar | Edit | Only when a domain is to be bought in the run |

Ask for every row at once, Registrar excepted, which is asked only when a domain is to be bought: whether the zone serves other hosts, which decides between Zone Settings and Dynamic URL Redirects, is learned only once the token exists. Zone Resources: Include, All zones, so that a zone made in the run is covered. Account Resources: the one account. Client IP filtering: none. TTL: none, or a year. Continue to summary, Create Token, copy the secret once. Read where Edit is needed is the mistake to look for: a token with Read lists tunnels and rules and fails only at the first creation, with `403` and code `10000` (resources.md "When a step fails").

**How it reaches the agent.** Save it in a file named `.cf-token` in the run's folder (a file without an extension: in Notepad, "All files" as the type, so that it is not `.cf-token.txt`), and tell the agent; the agent reads it into the environment for each call and never prints it. The file is listed in the deployment repository's `.gitignore` from the first commit, and deleted at the end of the run on the person's word. A token pasted into the chat is written into the file with the agent's file tool and never repeated, and the person is told to make a new token once the run is over, since the chat kept a copy.

**Verify:**

```sh
printf 'Authorization: Bearer %s\n' "$(tr -d '\r\n ' < .cf-token)" > scratch/auth.txt
curl -s https://api.cloudflare.com/client/v4/user/tokens/verify -H @scratch/auth.txt
curl -s https://api.cloudflare.com/client/v4/zones -H @scratch/auth.txt
curl -s https://api.cloudflare.com/client/v4/accounts -H @scratch/auth.txt
```

`"status": "active"`, the zones the token sees (the domain among them, or none yet), and the account with its id; the last call is refused without Account Settings Read, which is fine when the zone exists and carries the id. The file carries a carriage return on Windows; the `tr` strips it, and the header goes to `curl` from a file in `scratch/`, never on a command line. These calls prove the token is live, not what it may change: Read lists exactly what Edit lists.

## The git host

**The deployment repository.** The organization's deployment lives in a private repository on GitHub: the task definitions, the workflow that builds and deploys, the record. The agent makes it with the `gh` command signed in (`gh auth status`; `gh auth login` otherwise, which opens the browser for the person) under the owner the person names: their account, or an organization. Without `gh`, the person creates an empty private repository in the browser (New repository, private, no README) and gives its address, and the agent pushes to it.

### The GitHub App, for signing in with GitHub, and for the organization to say who is in

One app does both ([ADR-0022](/docs/adr/0022-who-is-in-is-the-consoles-own-record-and-an-administrator-keeps-it.md)): its client signs people in, and, installed on the organization, it lets the console read who is a member, at sign-in and every ten minutes after. Once the console's address is known, the person, signed in to GitHub as an owner of the organization (checked 2026-10): Your organizations, Settings next to the organization, Developer settings, GitHub Apps, New GitHub App.

- GitHub App name: the board's name (34 characters at most, unique across GitHub).
- Homepage URL: the console's address, `https://<hostname>`.
- Callback URL: `https://<hostname>/auth/gh/callback`. Leave "Expire user authorization tokens" as it is, and "Request user authorization (OAuth) during installation" off: the console asks who the person is once, and keeps nothing of the credential.
- Webhook: untick Active. The console takes no webhooks.
- Permissions: under Organization permissions, Members: Read-only. Nothing else, and no repository permission: the console reads who is in, and nothing of the code.
- Where can this GitHub App be installed?: Only on this account.
- Create GitHub App. The app's page shows the **App ID** and the **Client ID**: copy both into the chat (neither is secret). Under Client secrets, Generate a new client secret, and save it to the secrets file as `GITHUB_CLIENT_SECRET` (below), as the line the agent shows. Under Private keys, Generate a private key: a `.pem` file downloads; tell the agent where the file is, and it writes the key into the secrets file as `GITHUB_APP_PRIVATE_KEY` whole and deletes the file on the person's word; by hand instead, the file's lines joined with `\n`, as the line the agent shows. A secret pasted into the chat instead is written into the file by the agent's file tool and never repeated, and the person generates a new one once the run is over, since the chat kept a copy; the new one goes in as "a secret rotated" of the record.
- Install App, in the app's left sidebar: Install next to the organization, and confirm. No repository access is asked for, since the app has no repository permission. Everyone of the organization is in from then on, as the organization has them; the plan's `GITHUB_ORG` is the organization's login, as it reads in `github.com/<login>`.

Without an organization, an OAuth app signs people in as well (Developer settings, OAuth Apps, New OAuth App: the same name, homepage and callback; Register application; the Client ID and a client secret), and an administrator lets each person in on the People page. No scopes are needed either way: the console asks only who the person is.

### The OAuth client, for signing in with Google

In the Google Cloud console, a project of the organization's, Google Auth Platform (checked 2026-10): if the project has not registered with Google Auth yet, the Overview asks for the app's name, a support address and the audience (Internal, for a Workspace organization), once. Then Clients, Create client, Application type **Web application**, name it, under Authorized redirect URIs add `https://<hostname>/auth/google/callback`, Create. Copy the **Client ID** into the chat; the client secret is shown once: save it to the secrets file as `GOOGLE_CLIENT_SECRET`, as the line the agent shows (pasted instead: written to the file by the agent, never repeated, and replaced after the run, as with GitHub's). The Workspace domain, when everyone of it is a member, is the plan's `GOOGLE_WORKSPACE_DOMAIN`. Changes take from minutes to hours to be effective at Google.

## The secrets file

What the person holds (a client secret) is written to a file outside any repository, in the shape of [secrets.example.json](../assets/secrets.example.json): `console-secrets.json` in the folder above the run's folder, with the generated and derived values the run adds to it. The file starts empty: the script's `set` makes it with the first value, and the example is its shape, never a template to copy, since `store` would write a copied placeholder as a parameter. The run reads it to put each value in the parameter store, and deletes it at the end on the person's word. A value the person says `later` to leaves its provider out until it is set; the record names it. A provider the person did not choose has no line in it.
