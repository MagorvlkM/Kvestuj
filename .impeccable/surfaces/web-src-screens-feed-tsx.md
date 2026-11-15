---
version: 1
slug: "web-src-screens-feed-tsx"
primary_target: "web/src/screens/Feed.tsx"
related_targets: ["web/src/screens/Quest.tsx","web/src/screens/Post.tsx","web/src/screens/PostDetail.tsx","web/src/screens/Me.tsx","web/src/screens/Group.tsx","web/src/screens/Recap.tsx","web/src/screens/Join.tsx"]
---

# Feed (home) and the app shell

Scope: the Feed home screen and the shell every Kvestuj screen shares (top bar, quest strip, bottom tab bar). Mode: Operate. Build path: code-led.
Audience and job: one friend group (max 10, Vienna/Prague and beyond) checking their bobřík and posting proof one-handed outdoors, then catching up on friends' posts. Constraints: PRODUCT.md; English UI; WCAG AA, 44 px targets.
Chosen in a two-round decision (2026-11-15): world Bobříci, layout B1 "centre patch". Reference sketches (committed): design/bobrici/world-round1.html (world) and design/bobrici/layout-b1.html (layout), with PNGs beside them. The old BeReal-like canvas in design/*.png is a record of screens and copy only.

## Direction contract

THESIS: Each quest is a bobřík, a personal dare from Foglar's Czech scouting tradition; the app is the troop's chronicle and a done quest becomes a stitched patch, a memory rather than a score. It refuses the dark feed-with-neon-accent default and every points, streak or ranking device.

OWN-WORLD: Felt forest green #23402B owns the shell (top quest strip, tab bar, primary panels); khaki linen #D8CFB0 is the ground; chronicle ink #1F1A14. Thread colours mark people and states: red #C8372D, mustard #E0A526 (late), cornflower #4C6FB3 (recorded earlier). Avatars sit in stitched patches (dashed rings in the member's thread). Archivo Narrow caps with tracking for labels and names, Archivo for reading. Locked posts are dashed-outline panels; reactions are ink-outlined pills.

STORY: A member opens from an ntfy alert, sees today's bobřík and the time left, posts proof with one thumb from the centre patch, watches their empty patch get stitched and friends' locked posts open, then scrolls the chronicle, reacts and comments.

FIRST VIEWPORT: Khaki top bar with the KVESTUJ wordmark. Green quest strip: "TODAY'S BOBŘÍK · YOUR PATCH IS WAITING", the quest in two lines at most, "Left 7h 12m" at the right, "Reroll · 1 left" as a quiet link. Then the chronicle: patch avatar, name, city · time, thread tags (LATE, RECORDED EARLIER), quest in italic, media, caption, reaction pills, comments pill; missed quests as one gentle line. Green bottom tab bar: Chronicle · Troop 6/10 · a raised round stitched "Post proof" patch in the centre (the primary action) · Me. Signature interaction: on posting, the dotted patch ring stitches closed into a solid ring in your thread colour, then locked posts unlock in place.

FORM: Bobříci troop chronicle, position 1 on my ordered list (shown as Impeccable's pick, chosen over the dealt transit direction), layout B1 from round 2. seed:769a846083148a36

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
