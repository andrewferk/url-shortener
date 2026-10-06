#!/usr/bin/env bash
# Checks the formatting of infra/ and validates every OpenTofu root in it: each
# directory holding .tf files, except shared modules. It needs no credentials:
# the backend is skipped and providers are checked against the committed lock.
set -euo pipefail
cd "$(dirname "$0")/.."

tofu fmt -check -recursive infra

roots=$(find infra -name '*.tf' -not -path 'infra/modules/*' -not -path '*/.terraform/*' -exec dirname {} \; | sort -u)
if [ -z "$roots" ]; then
  echo "No OpenTofu roots found under infra/." >&2
  exit 1
fi

for root in $roots; do
  echo "tofu validate: $root"
  tofu -chdir="$root" init -backend=false -input=false -lockfile=readonly >/dev/null
  tofu -chdir="$root" validate
done
