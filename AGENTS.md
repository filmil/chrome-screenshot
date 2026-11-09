# Notes for coding agents

## Scripts are Bazel targets

Every script in this repository has a Bazel target, and the README and
CI run it through Bazel:

```sh
bazel run //:webstore_setup -- PROJECT_ID filmil/chrome-screenshot
```

- A new script gets a target in the same change: `sh_binary` for shell,
  or the matching rule for its language. If it can be tested without a
  network or an account, it gets a test too, like
  `//:webstore_setup_test`.
- Docs show `bazel run //:target -- ARGS`, never the script's path.
- A script used once, for one change, stays out of the repository.

Two older scripts do not follow this yet: `scripts/make_icons.py`, which
`npm run icons` and the test workflow run with `python3`, and
`scripts/webstore.mjs`, which the store workflow runs with `node`. Give
them targets when they next change.
