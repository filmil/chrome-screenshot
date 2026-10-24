#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Google Cloud setup for publishing Chrome extensions from GitHub Actions,
# for .github/workflows/webstore.yml. One project serves all of an
# owner's extensions:
#
# - one service account, the one the Chrome Web Store knows (a publisher
#   can have only one);
# - one Workload Identity Federation provider, which takes GitHub Actions
#   logins from the owner's repositories only;
# - for each repository named here, the right to act as the service
#   account, from its .github/workflows/webstore.yml on its main branch
#   only. Other workflows, other branches, and the owner's other
#   repositories cannot.
#
# No key is created. Running it again changes nothing; running it with a
# new repository adds that repository.
#
# usage: scripts/webstore-setup.sh PROJECT_ID REPOSITORY [REPOSITORY...]
#   e.g. scripts/webstore-setup.sh filmil-webstore filmil/chrome-screenshot
# All repositories must have the same owner. Needs gcloud, logged in as
# an owner of the project, and curl.
set -euo pipefail
usage="usage: webstore-setup.sh PROJECT_ID REPOSITORY [REPOSITORY...]"
project="${1:?$usage}"
shift
(( $# > 0 )) || { echo "$usage" >&2; exit 2; }
repos=("$@")
owner="${repos[0]%%/*}"
for r in "${repos[@]}"; do
  [[ -n "$owner" && "$r" == "$owner"/?* && "$r" != */*/* ]] || {
    echo "$r: want OWNER/NAME, all with the owner $owner" >&2; exit 2; }
done

# The owner's numeric GitHub ID does not change if the name is given up and
# taken by someone else, so the provider checks the ID, not the name.
owner_json="$(curl -fsS "https://api.github.com/users/$owner")" \
  || { echo "could not look up $owner on GitHub" >&2; exit 1; }
owner_id="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])' <<<"$owner_json")" \
  || { echo "could not find the GitHub ID of $owner" >&2; exit 1; }

sa_name="chrome-web-store"
sa="$sa_name@$project.iam.gserviceaccount.com"
pool="github"
# A provider ID is 4 to 32 lowercase letters, digits and hyphens; GitHub
# names are case-insensitive and use only letters, digits and hyphens.
lower_owner="$(tr 'A-Z' 'a-z' <<<"$owner")"
provider="gh-${lower_owner:0:29}"
provider="${provider%-}"

g() { gcloud --project "$project" --quiet "$@"; }

g services enable chromewebstore.googleapis.com iamcredentials.googleapis.com \
  sts.googleapis.com iam.googleapis.com
number="$(g projects describe "$project" --format='value(projectNumber)')"

# Each step makes the thing if it is missing, and brings back one that was
# deleted in the last 30 days, which gcloud still describes.
state() { g "$@" --format='value(state)' 2>/dev/null || echo MISSING; }

if ! g iam service-accounts describe "$sa" >/dev/null 2>&1; then
  g iam service-accounts create "$sa_name" --display-name="Chrome Web Store publisher"
fi

case "$(state iam workload-identity-pools describe "$pool" --location=global)" in
  MISSING) g iam workload-identity-pools create "$pool" --location=global \
             --display-name="GitHub Actions" ;;
  DELETED) g iam workload-identity-pools undelete "$pool" --location=global ;;
esac

condition="assertion.repository_owner_id == '$owner_id'"
issuer="https://token.actions.githubusercontent.com"
# attribute.workflow names the workflow file and the branch it ran from.
mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.workflow=assertion.job_workflow_ref"
provider_args=(--location=global --workload-identity-pool="$pool")
case "$(state iam workload-identity-pools providers describe "$provider" "${provider_args[@]}")" in
  MISSING) g iam workload-identity-pools providers create-oidc "$provider" "${provider_args[@]}" \
             --display-name="GitHub, $owner" \
             --issuer-uri="$issuer" --attribute-mapping="$mapping" \
             --attribute-condition="$condition" ;;
  DELETED) g iam workload-identity-pools providers undelete "$provider" "${provider_args[@]}" ;;
esac
# Set the provider every time, in case it was changed by hand.
g iam workload-identity-pools providers update-oidc "$provider" "${provider_args[@]}" \
  --issuer-uri="$issuer" --attribute-mapping="$mapping" \
  --attribute-condition="$condition" >/dev/null

for r in "${repos[@]}"; do
  g iam service-accounts add-iam-policy-binding "$sa" \
    --role=roles/iam.workloadIdentityUser \
    --member="principalSet://iam.googleapis.com/projects/$number/locations/global/workloadIdentityPools/$pool/attribute.workflow/$r/.github/workflows/webstore.yml@refs/heads/main" \
    >/dev/null
  echo "$r may publish as $sa, from webstore.yml on main"
done

cat <<DONE

Done. Next:
1. If you have not yet: in the Chrome Web Store Developer Dashboard,
   under Account, add the service account: $sa
2. Set each repository's variables (they are not secret):
DONE
for r in "${repos[@]}"; do
  cat <<VARS
   gh variable set -R $r GCP_WORKLOAD_IDENTITY_PROVIDER --body projects/$number/locations/global/workloadIdentityPools/$pool/providers/$provider
   gh variable set -R $r CWS_SERVICE_ACCOUNT --body $sa
   gh variable set -R $r CWS_PUBLISHER_ID --body <from Dashboard, Publisher, Settings>
   gh variable set -R $r CWS_EXTENSION_ID --body <the extension's item ID>
VARS
done
