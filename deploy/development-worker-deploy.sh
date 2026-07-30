#!/usr/bin/env bash

set -euo pipefail

release_sha="${1:?usage: development-worker-deploy.sh RELEASE_SHA}"
case "${release_sha}" in
  *[!0-9a-f]* | "")
    echo "Release SHA must contain only lowercase hexadecimal characters." >&2
    exit 2
    ;;
esac

service_root="${HOME}/services/relay-development-worker"
archive="${service_root}/relay-development-worker-${release_sha}.tar.gz"
release_dir="${service_root}/releases/${release_sha}"
current_link="${service_root}/current"
next_link="${service_root}/current.next"
previous_target=""

if [[ ! -f "${archive}" ]]; then
  echo "Worker release archive is missing: ${archive}" >&2
  exit 2
fi

if [[ -L "${current_link}" ]]; then
  previous_target="$(readlink "${current_link}")"
fi

mkdir -p "${release_dir}"
tar -xzf "${archive}" -C "${release_dir}"
(
  cd "${release_dir}"
  npm ci
  npm run build
)

ln -sfn "${release_dir}" "${next_link}"
mv -Tf "${next_link}" "${current_link}"
systemctl --user restart relay-development-worker.service

healthy=false
for _attempt in {1..20}; do
  if curl --fail --silent --show-error http://127.0.0.1:3212/health >/dev/null; then
    healthy=true
    break
  fi
  sleep 1
done

if [[ "${healthy}" == "true" ]]; then
  rm -f "${archive}"
  echo "Worker release ${release_sha} is healthy."
  exit 0
fi

echo "Worker release ${release_sha} failed its health check." >&2
if [[ -n "${previous_target}" && -d "${previous_target}" ]]; then
  ln -sfn "${previous_target}" "${next_link}"
  mv -Tf "${next_link}" "${current_link}"
  systemctl --user restart relay-development-worker.service
  echo "Restored worker release ${previous_target}." >&2
else
  echo "No prior worker release was available for rollback." >&2
fi
exit 1
