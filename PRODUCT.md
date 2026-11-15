# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Preact + Vite + TypeScript, static site on GitHub Pages (public repo MagorvlkM/Kvestuj), installable to the home screen. Backend: one Google Apps Script web app with a Google Sheet as the database and a Drive folder for media; alerts through the ntfy app. Decided in the implementation plan (`docs/superpowers/plans/2026-11-14-kvestuj.md`).

## Users

One private friend group of at most 10 people (students and young adults) split across cities, mainly Vienna and Prague. Each member uses Kvestuj on their own phone (iPhone and Android), in short sessions through the day: when a quest alert arrives, when they're out doing the quest, and when they scroll friends' posts in the evening.

## Product Purpose

Keep a friend group close at a distance. Twice a week each member gets a random small quest (solo, works in any city, mostly about the street and strangers) and has 12 hours of awake time to do it. They post a photo or video as proof to a shared feed, where friends react and comment. Success means friends keep seeing each other's lives and nudge each other a little out of their comfort zone, without the app ever feeling like a chore.

## Positioning

A closed circle, not a network: one group, max 10, invite link only. The randomness and the shared deadline give everyone something to post about; the feed lock (you see friends' new posts after you've posted yours or your time is up) makes the reveal a small event.

## Operating Context

- Quest drops arrive as ntfy push alerts between 10:00 and 22:00 local time; the clock pauses overnight.
- Posting happens outdoors, one-handed, often in a hurry, on mobile data: camera or gallery, a video of up to 60 s or a photo, an optional caption.
- Members live in different time zones; each person's local time governs their quests.
- The owner (Martin) runs it from his Google account and can edit the Sheet by hand.

## Capabilities and Constraints

- 2 quests per member per week, one free reroll per week, missed quests carry no penalty ("{name} didn't get to their quest"), late posts are allowed and labelled "late".
- Posts captured before the quest dropped show "recorded earlier"; nothing is ever blocked.
- Reactions are exactly 😂 🔥 😮 ❤️ 👏 💀; comments up to 500 characters.
- Videos are deleted after 6 months (the post keeps a still frame and shows "video expired"); photos are kept.
- Monthly recap on the 1st: each member's done count (alphabetical), the most-reacted post, a gallery.
- No passwords: a device token plus a one-time recovery code (KVS-XXXX-XXXX).
- Zero running cost; no other services.
- Interface language: English only (owner's decision, 2026-11-15).

## Brand Commitments

- Name: **Kvestuj** (Czech for "go questing"). House rule shown to everyone: "House rule: always ask strangers before you film them."
- Never punishing: no points, leaderboard, ranking or streak pressure; missed quests are shown gently.
- Visual direction: open. The owner asked (2026-11-15) for new design options unrelated to the earlier BeReal-like canvas in `design/`; that canvas is no longer binding.

## Evidence on Hand

- `data/kvestuj-quests.csv`: the real 200-quest bank (90 easy, 80 medium, 30 hard), English.
- `design/`: the earlier 8-screen canvas (Feed, Quest, Post, Post detail, Me, Group, Recap, Join), kept only as a record of screens and copy, not of look.
- No real member photos, videos or names exist yet; any shown in mockups are synthetic and must be labelled so.

## Product Principles

1. Closeness over performance: the feed is for friends, not an audience.
2. Gentle by default: missing a quest, posting late or rerolling never shames anyone.
3. Fast to act outdoors: the quest and the post button are always one tap away.
4. The reveal matters: seeing friends' posts after posting yours is the moment the app is built around.
5. Respect people on camera: strangers are asked before they're filmed.

## Accessibility & Inclusion

WCAG AA baseline: readable contrast, 44 px minimum tap targets, honours large system text and reduced motion. No member-specific needs reported.
