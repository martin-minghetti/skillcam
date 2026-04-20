Output assets/demo.gif

Set Shell "bash"
Set FontSize 16
Set Width 960
Set Height 620
Set Theme "Catppuccin Mocha"
Set Padding 20
Set TypingSpeed 38ms

Type "# See your recent agent sessions"
Enter
Sleep 500ms

Type "skillcam list --last 5"
Enter
Sleep 2500ms

Type ""
Enter
Sleep 300ms

Type "# Preview one without distilling"
Enter
Sleep 400ms

Type "skillcam preview --latest"
Enter
Sleep 2500ms

Type ""
Enter
Sleep 300ms

Type "# Distill: Haiku judge filters bad sessions, Sonnet produces the skill"
Enter
Sleep 500ms

Type "# (output below is an actual v0.3.0 distillation)"
Enter
Sleep 500ms

Type "cat examples/skills/fix-broken-imports-after-rename-refactor.md"
Enter
Sleep 7s
