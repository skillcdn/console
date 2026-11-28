# When a step does not go

`install.sh` keeps every setting it wrote: run again after a fix, it goes on from where it stood. What it prints never holds a secret, so its lines may be read to the person as they are.

| What is seen | What to do |
|---|---|
| `the docker daemon does not answer` | Docker is not running: the person starts Docker Desktop, or the service. Run the script again. |
| Port 11199 is taken, or `docker compose` says a port is allocated | `bash console/deploy/install.sh --port <another>`: the console is then at `http://127.0.0.1:<another>`, the address of every later step. |
| `port 11196 of this host must be free` | Whatever listens on 11196 is stopped; the page that registers the app has no other port. |
| `no image ... could be pulled` | The registry is not reached, or holds no image of that version: `bash console/deploy/install.sh --build` builds it from the clone, which takes some minutes. |
| `unknown option: --github-app` | The release is older than this skill. The app is registered by hand, below. |
| `the image ... does not carry the script that registers a GitHub App` | An image of an older release was named: leave `--image` out, or register by hand, below. |
| `Nobody pressed "Create GitHub App" within 600 seconds` | Nothing was registered. Say the address to the person again, and run step 3 again. |
| GitHub shows an error in place of the app to confirm | Tell the person what GitHub's page says, and register by hand, below. The flow was run against a stand-in for GitHub and not yet against GitHub itself ([ADR-0171](/docs/adr/0171-the-smallest-install-registers-its-github-app-from-a-manifest-with-one-press.md)): put GitHub's words in the last message, so that they can be reported. |
| `GitHub refused the exchange`, or its answer was not taken | An app may stand at GitHub with nothing taken from it: the person deletes it (Settings, Developer settings, GitHub Apps), and step 3 is run again. |
| `the console did not become ready` | `(cd console/deploy && docker compose logs --tail 30 migrate api)` says why; the settings file is not what to read. |
| Signing in ends on a refusal | The console was opened as `localhost`: open `http://127.0.0.1:11199/`. Or the account that signed in is not the one that pressed: `bash console/deploy/install.sh --admins <their login>` names the first administrator, and they sign in again. |
| The press was made by another account than the person meant | The app is that account's, and it is the first administrator. `--admins <login>` names another; the app itself is deleted and made again only by its owner. |
| `console login` ends with exit 3 | The approval still waits: tell the person the address and the code again, and run the same command again while the code lasts. |
| `node --version` is older than 24 | 22 runs the command today and is not what the package is tested on; older does not run it. The person installs a current Node.js. |

## Registering by hand

Where the script cannot register the app, the person does, as [the deploy guide](/deploy/README.md#signing-in) says: at GitHub, Settings, Developer settings, OAuth Apps, New OAuth App, with `http://127.0.0.1:11199` as the homepage and `http://127.0.0.1:11199/auth/gh/callback` as the callback, then a client secret. They write three lines into `console/deploy/.env` themselves, where they wait commented out: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` and `ADMINS`, their GitHub login. The agent does not open the file, and the secret is not said in the chat. Then:

```sh
bash console/deploy/install.sh --url http://127.0.0.1:11199
```

and the workflow goes on at step 4.
