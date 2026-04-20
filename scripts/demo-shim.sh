# Demo shim used by assets/demo.tape. Replaces the real `skillcam` command
# with canned output from scripts/demo-fixtures/ so the recorded gif never
# exposes real session IDs, filesystem paths, or project names, and stays
# reproducible without a network call or API key.
#
# This file is sourced by the tape before any `skillcam ...` Type. It is
# never shipped to end users.
#
# If you sourced this in an interactive shell by accident (audit #3 D3),
# call `_skillcam_demo_cleanup` to restore the real `skillcam` binary
# and unset the helper variables.

# Resolve the shim's own directory. Using BASH_SOURCE directly so this works
# regardless of the cwd the tape happens to be in when it sources the file.
_SKILLCAM_DEMO_SELF="${BASH_SOURCE[0]}"
if [[ "$_SKILLCAM_DEMO_SELF" != /* ]]; then
  _SKILLCAM_DEMO_SELF="$PWD/$_SKILLCAM_DEMO_SELF"
fi
_SKILLCAM_DEMO_DIR="${_SKILLCAM_DEMO_SELF%/*}/demo-fixtures"

skillcam() {
  case "$1" in
    list)    cat "$_SKILLCAM_DEMO_DIR/list.txt" ;;
    preview) cat "$_SKILLCAM_DEMO_DIR/preview.txt" ;;
    distill)
      # Print each "✓" line with a small delay so the viewer can read the
      # pipeline staging (read → judge → distill → write).
      while IFS= read -r line; do
        printf '%s\n' "$line"
        if [[ "$line" == "✓"* ]]; then
          sleep 0.4
        fi
      done < "$_SKILLCAM_DEMO_DIR/distill.txt"
      ;;
    *)
      printf 'skillcam: unknown subcommand in demo shim: %s\n' "$1" 1>&2
      return 1
      ;;
  esac
}

# Audit #3 D3 — explicit cleanup. The tape can call this after recording,
# and a developer who sourced the file by accident in their interactive
# shell can call it manually to drop the override.
_skillcam_demo_cleanup() {
  unset -f skillcam 2>/dev/null
  unset _SKILLCAM_DEMO_SELF _SKILLCAM_DEMO_DIR 2>/dev/null
  unset -f _skillcam_demo_cleanup 2>/dev/null
}
