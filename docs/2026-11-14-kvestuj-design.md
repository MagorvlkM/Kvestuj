# Kvestuj: design

## Intent
A private app for one friend group (max 10 people) split across cities (Vienna and Prague). Twice a week, each person gets a random quest. They post a photo or video as proof to a shared feed, where friends react and comment.

The point is **staying connected at a distance**. Pushing each other out of their comfort zone and easing social anxiety come second. It is a sibling of Trapas (a one-night pass-the-phone game), but runs continuously with everyone on their own phone.

## Goals
- Seeing friends' quest videos keeps the group close across cities.
- Small regular nudges out of the comfort zone, never punishing.
- Zero running cost, everything in the owner's Google account, simple enough for one student to run.

## Non-goals
- No points, leaderboard or ranking.
- No per-person friend lists, no public sign-up, no multiple groups.
- No native app, no App Store.
- No moderation tooling beyond the owner editing the Sheet.

## Anti-goals (failure even if it works)
- It feels like a chore or a punishment (missed quests shamed, streak pressure).
- It needs regular maintenance or money.
- Strangers end up on video without having agreed (house rule: always ask before filming).

## Constraints
- Max 10 members, one group.
- Storage: the owner's Google Drive. Backend: Google Apps Script plus a Google Sheet. Frontend: a static webapp on GitHub Pages, installable to the home screen.
- Members use iPhones and Android phones. Alerts go through the ntfy app.
- Members live in different time zones possibly, so each person's local time counts.

## Approaches considered
| Approach | Trade-off | Decision |
|---|---|---|
| **A. Google-only:** GitHub Pages webapp + Apps Script + Sheet + Drive + ntfy | Free, one place, editable by hand. About 1 s per call, Google daily quotas (ample for 10 people). | **Chosen** |
| B. Firebase/Supabase backend + Drive for media | Live feed, sturdier logins. Two services, more to build and run. | Rejected: overkill for 10 people |
| C. Native app with push | Real push. Needs a €99/yr Apple developer account and TestFlight. | Rejected |

A Claude artifact was rejected as the host because friends need a stable link without a Claude account, and calls to Apps Script may be blocked.

## Decided behaviour

### Group and joining
- Only the owner can create the group: one Sheet, one Drive folder, one script deployment.
- Members join through a private invite link that carries a group secret. They pick a display name (unique in the group) and their time zone, which is auto-detected and editable. No passwords.
- The device keeps a member token in local storage. Anyone holding the invite link can join or see the feed, so the link must stay in the group.
- Max 10 members. The 11th join is refused.

### Quests
- Each member gets **2 quests per calendar week** (Mon–Sun, member's local time).
- Drop times are random, between **10:00 and 22:00 local**, with at least 24 h between a member's two drops.
- The **deadline is 12 hours of awake time**. The clock pauses 22:00–10:00 local. For example, a drop at 20:00 has 2 h left that day, then 10 h from 10:00, so it is due 20:00 the next day.
- **One free reroll per member per week:** a different quest, with the same deadline.
- **Missed quest:** no penalty. The feed shows a small "{name} didn't get to their quest" line.
- Quests are drawn from the bank, never repeating for that member until they have seen the whole bank.
- **Quest bank:** solo quests that work in any city, can be done within 12 h, and need no group in person and no night. It is adapted from the Trapas 800-quest bank (filter out group, Prague and night-only quests, then rewrite for this format). The owner can add quests through the Sheet.

### Proof and feed
- A post is one photo or a video of up to 60 s, plus an optional caption. Camera or gallery.
- Video is compressed on the phone before upload. Upload goes straight from the phone to Drive through a one-off upload link the script creates.
- **Date check:** the app reads the capture date from the file's metadata. If it's earlier than the quest drop, the post shows a visible "recorded earlier" label. If there's no date, nothing is shown. It is not blocked.
- **Feed:** newest first. Each post shows the member, their quest, the media, the caption, emoji reactions and comments.
- **Feed lock:** while a member has an open, unposted quest, posts newer than that quest's drop time are blurred for them until they post or the deadline passes.
- **Monthly recap:** on the 1st, the feed gets a recap card for the previous month. It shows each member's count of done quests, the most-reacted post, and a short gallery. There is no ranking.

### Alerts (ntfy)
- Each member subscribes to their own private channel (new quest, 2 h-left reminder) and to one group channel (new post).
- The script's timer, every 15 min, drops due quests, closes expired ones, and sends the alerts.

### Privacy and ownership
- All media sits in the owner's Drive folder, and files are served only through the app.
- House rule shown on first launch: always ask strangers before filming them.

## Calls made after the builder check (Claude's calls, correctable)
- **Media sharing:** each Drive file is shared as "anyone with the link" and embedded by its unguessable link. Media never goes through Apps Script, because the script can't stream video. Privacy rests on the links staying in the group, the same as the invite link.
- **New phone or cleared storage:** at join, each member gets a personal recovery code to save (shown once, with a reminder to screenshot). Rejoining with the code restores the same member and uses no new slot. The owner can also reset a member in the Sheet.
- **Late posts:** allowed. A post after the deadline replaces the "didn't get to it" line, carries a small "late" label, and counts as done in the recap. The feed lock lifts at the deadline either way.
- **Quest bank:** the adapted bank (solo, works anywhere, doable within 12 h) is produced in the design phase as `kvestuj-quests.csv` (`text,difficulty`, 200 quests, about 45% easy, 40% medium and 15% hard), before the build. Drops pick difficulty at random with the same weights. The builder only imports it.

## Storage limit (owner's decision)
- Videos older than 6 months are deleted automatically by a daily script job. The post keeps a still frame (saved at upload time), the caption, reactions and comments, and shows "video expired".
- Photos are small and are kept.
- The monthly recap cards stay.

## Visual style (owner's decision)
- A BeReal-like look: black background, white type (Inter), one accent colour (yellow) for quest and time cues. Posts are the photo or video plus a caption only, with no selfie inset. Screens are on the Kvestuj design canvas.

## Left to the builder
- Sheet schema, script endpoints, the auth token format, and how media is served (thumbnails, streaming).
- Video compression method and target bitrate.
- Retry and offline behaviour for uploads.
- How the app is installed to the home screen.
- Screen layouts and visual design come from a separate design step (Claude Design).
