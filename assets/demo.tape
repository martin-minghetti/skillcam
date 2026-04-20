Output assets/demo.gif

Set Shell "bash"
Set FontSize 16
Set Width 960
Set Height 640
Set Theme "Catppuccin Mocha"
Set Padding 20
Set TypingSpeed 40ms

# Load the demo shim. All `skillcam ...` commands below are served from
# scripts/demo-fixtures/ — no real sessions, no real paths, no API keys.
Hide
Type "clear && source scripts/demo-shim.sh"
Enter
Sleep 200ms
Show

Type "# List your recent agent sessions"
Enter
Sleep 1200ms

Type "skillcam list --last 5"
Enter
Sleep 5s

Type ""
Enter
Sleep 800ms

Type "# Preview one before spending tokens"
Enter
Sleep 1200ms

Type "skillcam preview --latest"
Enter
Sleep 5s

Type ""
Enter
Sleep 800ms

Type "# Distill: a cheap Haiku judge filters bad sessions,"
Enter
Sleep 800ms
Type "# then Sonnet writes the skill"
Enter
Sleep 1500ms

Type "skillcam distill --latest"
Enter
Sleep 6s

Type ""
Enter
Sleep 800ms

Type "# The result"
Enter
Sleep 1000ms

Type "cat examples/skills/fix-broken-imports-after-rename-refactor.md"
Enter
Sleep 10s
