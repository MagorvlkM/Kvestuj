# Kvestuj API contract

One Google Apps Script web app. The web app calls it with:

```
POST <exec URL>
Content-Type: text/plain;charset=utf-8      (a "simple" request: no CORS preflight)
body: JSON {op: string, token?: string, ...args}
```

Every response is JSON:

- `{ok: true, data: <op result>}`
- `{ok: false, error: string, code?: 'auth'}`. `error` is a friendly English sentence shown to the user as-is. Never a stack trace. `code: 'auth'` means the token is missing or invalid; the client clears its session and goes to Recover.

Times are UTC epoch milliseconds (`number`). Request and response types live in `shared/types.ts` so the server and the web client share them.

## Views (what the server sends; never raw records)

```ts
MemberView      = {id, name, tz, joinedAt}                      // never tokenHash, recoveryHash, questChannel
PostView        = {id, assignmentId, memberId, kind: 'photo'|'video',
                   fileId: string|null,                        // null once a video has expired (trashed)
                   stillFileId: string|null, caption, createdAt, capturedAt: number|null,
                   durationS: number|null, late, recordedEarlier, expired,
                   questText: string,
                   reactions: Record<Emoji, number>,           // all six keys, 0 when none
                   mine: Emoji[],                              // the caller's reactions
                   commentCount: number}
CommentView     = {id, postId, memberId, text, createdAt}
OpenQuest       = {assignmentId, questText, difficulty, dropAt, deadlineAt, rerollAvailable: boolean}
LateQuest       = {assignmentId, questText, dropAt, deadlineAt} // most recent missed quest, still postable
HistoryItem     = {assignmentId, status: 'done'|'missed', questText, dropAt, deadlineAt, post: PostView|null}
FeedItemView    = {kind: 'post', at, locked: false, post: PostView}
                | {kind: 'post', at, locked: true, postId, memberId}   // redacted: no media, caption, quest, reactions
                | {kind: 'missed', at, memberId, assignmentId}
                | {kind: 'recap', at, month: 'YYYY-MM', totalDone: number}
GroupMemberView = MemberView & {hasOpen: boolean, lastPostAt: number|null, lastMissedAt: number|null}
Emoji           = '😂' | '🔥' | '😮' | '❤️' | '👏' | '💀'
```

## Ops

| op | args | result | refusals (exact `error` text) |
|---|---|---|---|
| `join` | `secret, name, tz, recoveryCode?` | `{token, recoveryCode, member, questChannel, groupChannel}` | wrong secret: "This invite link isn't valid" · ≥10 members: "The group is full (10 of 10)" · name taken, any case: "That name is taken" · name not 1–24 chars after trimming: "Pick a name of 1 to 24 characters" · bad zone: "Pick a valid time zone" · malformed code: "That recovery code isn't valid" |
| `recover` | `secret, name, code` | `{token, member, questChannel, groupChannel}` (new token; the old one stops working) | wrong secret: "This invite link isn't valid" · unknown name or wrong code: "Name or recovery code doesn't match" |
| `me` | | `{member, questChannel, groupChannel, open: OpenQuest\|null, late: LateQuest\|null, monthDone, history: HistoryItem[]}` | |
| `feed` | `before?` | `{items: FeedItemView[] (≤ 20, at < before), members: MemberView[], nextBefore: number\|null}` | |
| `post` | `postId` | `{post, comments: CommentView[], members}` | locked: "Post your quest to see this" · unknown: "That post is gone" |
| `reroll` | | `{open: OpenQuest}` | no open quest: "You have no open quest to reroll" · used: "You've used this week's reroll" |
| `createUpload` | `assignmentId, kind, mime, size, hasStill` | `{uploadUrl, stillUploadUrl?}` | see Posting |
| `finalizePost` | `assignmentId, fileId, stillFileId?, caption, capturedAt, durationS?` | `{post}` | see Posting |
| `react` | `postId, emoji` | `{reactions, mine}` (toggle) | not one of the six: "That reaction isn't available" · locked / unknown as for `post` |
| `comment` | `postId, text` | `{comment}` | not 1–500 chars after trimming: "Comments need 1 to 500 characters" · locked / unknown as for `post` |
| `group` | | `{members: GroupMemberView[]}` (sorted by name, locale `cs`) | |
| `recap` | `month` | `{recap: RecapData, posts: PostView[], members}` (posts = gallery + most-reacted) | "No recap for that month yet" |
| `setTz` | `tz` | `{member}` | "Pick a valid time zone" |

Any op except `join`/`recover` without a valid token: "Please rejoin with your recovery code", `code: 'auth'`. Unknown op: "Something went wrong. Please try again." Unexpected exceptions are logged server-side and return the same sentence.

## Posting

`createUpload` and `finalizePost` share these checks on the assignment (in this order):

1. Exists and belongs to the caller, else "That quest isn't yours".
2. `status` is `open` or `missed`. `scheduled`: "That quest hasn't dropped yet". `done` (only `createUpload`; `finalizePost` returns the existing post): "You already posted this quest".
3. The member's next drop hasn't happened (no other assignment of theirs with `dropAt > a.dropAt` and `dropAt ≤ now`), else "This quest is closed. You have a new one."

`createUpload` also checks: `kind` is photo/video and `mime` starts with `image/` or `video/` to match, else "Only photos and videos can be posted"; size limits: photo ≤ 15 MB ("Photos can be up to 15 MB"), video ≤ 100 MB ("Videos can be up to 100 MB"). It creates a Drive resumable-upload session named `<assignmentId>-main.<ext>` (and `<assignmentId>-still.jpg`, `image/jpeg`, when `hasStill`), with the `Origin` of `config.appUrl`.

`finalizePost`:

- Idempotent: if a post already exists for the assignment, return it unchanged (no new share, no notification).
- Each file must exist, sit in `config.folderId`, and have a name starting with the assignmentId, else "That upload wasn't found". `kind` comes from the main file's mimeType.
- caption trimmed ≤ 500, else "Captions can be up to 500 characters". `durationS` only for video, `> 61` → "Videos can be up to 60 seconds".
- Shares the file(s) "anyone with the link can view", stores the post with `late = isLate(now, a)` and `recordedEarlier = isRecordedEarlier(capturedAt, a.dropAt)`, sets the assignment to `done`, and sends ntfy to the group channel: title "Kvestuj", body "{name} posted their quest".

## Locks and visibility

- A post is locked for the viewer per `buildFeed`'s rule (their open quest exists, they haven't posted it, `now < deadlineAt`, the post is newer than its drop, and it isn't their own). Locked posts are redacted in `feed`; `post`, `react` and `comment` refuse them.
- Mutating ops (`join`, `recover`, `reroll`, `createUpload`, `finalizePost`, `react`, `comment`, `setTz`) run inside `ports.lock`.

## Notifications (ntfy; never include quest text)

| when | channel | title | body |
|---|---|---|---|
| quest drops | member's questChannel | New quest | You have 12 hours. Open Kvestuj. |
| 2 h of awake time left | member's questChannel | 2 hours left | Your quest is due soon. Open Kvestuj. |
| someone posts | groupChannel | Kvestuj | {name} posted their quest |
| recap on the 1st | groupChannel | Kvestuj | {Month} recap is ready |

Every message carries `config.appUrl` as its click target. Member-channel alerts (new quest, 2 hours left) never go out between 22:00 and 10:00 member-local; a reminder that comes due at night waits for the first tick after 10:00. Group-channel alerts (new post, recap) go out when they happen: posting is the member's own action, the group spans time zones, and each person can mute the group channel at night in the ntfy app.
