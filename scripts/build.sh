#!/usr/bin/env bash
# Build and test this checkout. Does not install or download release binaries.
set -euo pipefail
project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"
[[ "$(uname -s)" == Linux ]] || { echo 'This fork supports Linux only.' >&2; exit 1; }
node --test tests/extension.test.cjs
cargo test --locked --manifest-path native-host/Cargo.toml
cargo build --locked --release --manifest-path native-host/Cargo.toml
node --test tests/native-host.test.cjs
printf '\nBuilt %s/native-host/target/release/cloe-host\n' "$project_dir"
printf 'No browser configuration or installed files changed.\n'
