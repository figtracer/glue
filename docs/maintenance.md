# Repository maintenance

CI is intentionally small: formatting, lint, syntax and mock-payment tests on Linux/macOS and Node 22.13/24. The aggregate `CI` check fails unless every matrix job succeeds. No wallet secrets or paid services belong in a workflow.

Actions are restricted to GitHub-owned actions with full SHA pins. Workflow tokens are read-only and cannot approve PRs. Dependabot checks development dependencies and Actions weekly; npm updates have a seven-day cooldown. Required CI also checks all resolved npm package publication dates and Action commit/release dates, so manual updates follow the same seven-day soak. Missing metadata fails the check. Run `npm run deps:check` locally. This is an age gate, not a malware scanner or network firewall. Review Action release dates before merging updates; pins should be at least seven days old unless a security fix warrants an exception.

The main-branch policy is checked in at [branch-protection.json](../.github/branch-protection.json): an up-to-date passing `CI` check, one approving review, code-owner review, dismissed stale approvals, resolved conversations, linear history and no force pushes or deletion. It includes admins.

The repository is public. The config file alone does not enforce protection; maintainers can apply and inspect the GitHub policy with:

```sh
gh api --method PUT repos/figtracer/glue/branches/main/protection \
  --input .github/branch-protection.json
gh api repos/figtracer/glue/branches/main/protection
```

Do not disable protection to merge failing checks or approve your own PR. An author cannot approve their own PR; maintainer-authored changes need another eligible reviewer.
