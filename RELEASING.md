# Release process

The first time you cut a release, do **steps 0–2** as a one-time setup. Every release after that is steps 3 onward.

## 0. One-time setup — Homebrew tap repo

DumpVault publishes to a Homebrew tap living in a sibling repo: [`github.com/ahmedtahir2311/homebrew-dumpvault`](https://github.com/ahmedtahir2311/homebrew-dumpvault).

```bash
# Create the tap repo on GitHub (public, MIT or no LICENSE — Homebrew taps don't need one)
# Then locally:
mkdir -p ~/code/homebrew-dumpvault/Formula
cd ~/code/homebrew-dumpvault
git init
git remote add origin git@github.com:ahmedtahir2311/homebrew-dumpvault.git
echo "# homebrew-dumpvault" > README.md
git add README.md
git commit -m "init tap"
git branch -M main
git push -u origin main
```

After this, end users can install with:
```
brew install ahmedtahir2311/dumpvault/dumpvault
```

## 1. One-time setup — GHCR access

Docker images publish to `ghcr.io/ahmedtahir2311/dumpvault`. The `docker.yml` workflow uses the built-in `GITHUB_TOKEN` so no extra secrets are needed — just make sure GHCR is enabled for your account:

1. Settings → Developer settings → Personal access tokens → *not* needed for the workflow itself (it uses `GITHUB_TOKEN`)
2. After the first publish, go to your GHCR package page and set visibility to **public** if you want users to `docker pull` without auth.

## 2. One-time setup — npm / Homebrew namespace check

Make sure `brew install ahmedtahir2311/dumpvault/dumpvault` doesn't already exist. (It won't — your username is unique.)

---

## 3. Cut a release

```bash
# 3a. Bump the version in package.json (e.g. 0.5.0 → 0.6.0).
$EDITOR package.json
$EDITOR src/cli.ts        # update the .version() call in commander
git commit -am "release: v0.6.0"

# 3b. Tag and push. The release.yml + docker.yml workflows fire on tag push.
git tag v0.6.0
git push origin main v0.6.0
```

## 4. Wait for CI

Two workflows run on a `v*` tag push:

| Workflow | Produces |
|---|---|
| [`release.yml`](.github/workflows/release.yml) | 4 binaries + sha256 sidecars attached to the GitHub Release |
| [`docker.yml`](.github/workflows/docker.yml) | Multi-arch image at `ghcr.io/ahmedtahir2311/dumpvault:v0.6.0` (also tagged `latest`, `0.6.0`, `0.6`) |

Watch them at `github.com/ahmedtahir2311/dumpvault/actions`. Both should be green within ~10 minutes.

## 5. Update the Homebrew tap

```bash
# From the dumpvault repo:
./scripts/render-homebrew-formula.sh v0.6.0 > /tmp/dumpvault.rb

# Move it into the tap repo and commit:
cp /tmp/dumpvault.rb ~/code/homebrew-dumpvault/Formula/dumpvault.rb
cd ~/code/homebrew-dumpvault
git add Formula/dumpvault.rb
git commit -m "dumpvault 0.6.0"
git push
```

End users can now upgrade:
```
brew update && brew upgrade dumpvault
```

## 6. Smoke-test the published artifacts

```bash
# Install script
curl -fsSL https://raw.githubusercontent.com/ahmedtahir2311/dumpvault/main/scripts/install.sh | sh
dumpvault --version

# Homebrew (in a fresh terminal so brew sees the new tap)
brew install ahmedtahir2311/dumpvault/dumpvault
dumpvault --version

# Docker
docker run --rm ghcr.io/ahmedtahir2311/dumpvault:v0.6.0 --version
```

If any of those break, file the bug, ship a `v0.6.1` patch.

## 7. Post-release housekeeping

- [ ] Bump `package.json` version to `0.6.1-pre` to mark the next dev cycle.
- [ ] Update the README's "Status" line if the release crossed a milestone (e.g. v1.0).
- [ ] If the release added user-visible features, post to Show HN, r/selfhosted, r/devops, etc.
