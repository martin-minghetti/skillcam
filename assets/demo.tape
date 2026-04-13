Output assets/demo.gif

Set Shell "bash"
Set FontSize 16
Set Width 900
Set Height 500
Set Theme "Catppuccin Mocha"
Set Padding 20
Set TypingSpeed 40ms

Type "# List your recent agent sessions"
Enter
Sleep 500ms

Type "skillcam list --last 5"
Enter
Sleep 3s

Type ""
Enter
Sleep 500ms

Type "# Distill the latest session into a reusable skill"
Enter
Sleep 500ms

Type "skillcam distill --latest --no-llm"
Enter
Sleep 3s

Type ""
Enter
Sleep 500ms

Type "# Check the generated skill"
Enter
Sleep 500ms

Type "cat examples/skills/debug-failing-tests.md"
Enter
Sleep 5s
