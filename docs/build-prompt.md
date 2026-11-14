# Build Kvestuj

Build Kvestuj, a private quest-and-feed webapp for one friend group, from the files in this folder:

- `2026-11-14-kvestuj-design.md`: the approved spec. It is the source of truth for behaviour.
- `docs/superpowers/plans/2026-11-14-kvestuj.md`: the implementation plan. Follow it task by task, in order, using TDD as written.
- `kvestuj-quests.csv`: the quest bank. Copy it to `data/kvestuj-quests.csv`.
- `design/`: screenshots or an export of the Kvestuj design canvas. Match it for every screen.

How to work:
1. Start with Task 0 (platform spike). Report its four results to me before Task 1. If the Drive upload from the phone or the video playback fails, stop and tell me.
2. Use the subagent-driven-development skill if you have it (one subagent per task, reviewed before the next). Otherwise, execute the plan yourself and commit after each task.
3. Steps that need my Google account (clasp login, creating the API key, running `setup()`, deploying, real-phone checks): give me exact click-by-click instructions and wait for me.
4. Ask before guessing on anything the spec and plan leave open that would change what I see or how the group uses it.
5. At the end, send me the Pages URL, the invite link, and a list of every assumption you made.
