#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Checks that scripts/webstore-setup.sh refuses bad arguments, with an
# error and a message, before it calls gcloud or the network. PATH holds
# no gcloud and no curl here, so reaching either shows as "not found".
set -uo pipefail
script="scripts/webstore-setup.sh"
fail=0
expect_refusal() {
  local out code
  out="$(PATH=/nonexistent /bin/bash "$script" "$@" 2>&1)"
  code=$?
  if [[ $code -eq 0 ]]; then
    echo "FAIL: $* succeeded: $out"
    fail=1
  elif [[ "$out" == *"not found"* ]]; then
    echo "FAIL: $* got as far as running a program: $out"
    fail=1
  elif [[ -z "$out" ]]; then
    echo "FAIL: $* printed no message"
    fail=1
  fi
}
expect_refusal
expect_refusal filmil-webstore
expect_refusal filmil-webstore notarepo
expect_refusal filmil-webstore filmil/a other/b
expect_refusal filmil-webstore filmil/a/b
exit $fail
