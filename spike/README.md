# Task 0: platform spike (your steps)

This proves the four things the whole app relies on, before anything is built on them:

1. The Pages site can call an Apps Script web app (no CORS error), and `Intl` time zones work in Apps Script.
2. A phone can upload a big video **straight to Drive** through an upload link the script creates.
3. That Drive file plays (and seeks) in a `<video>` on iPhone Safari and Android Chrome, using a restricted API key.
4. An iPhone can shrink a 60 s camera video to 720p in the browser, and the app can read when it was recorded.

You need: your Google account, your GitHub account, an iPhone and an Android phone. About 30 minutes.

---

## A. Create the public GitHub repo (2 min)

1. Open <https://github.com/new>.
2. **Owner:** MagorvlkM. **Repository name:** `kvestuj`. **Public**.
3. Leave **everything else empty**: no README, no .gitignore, no license. (I push the code; an auto-created README would clash.)
4. Click **Create repository**.
5. In the new repo: **Settings** (top tab) → **Pages** (left menu) → **Build and deployment** → **Source** → choose **GitHub Actions**. (If the option isn't shown yet, skip it; do it after I push.)
6. Tell me "repo created" in the chat. I connect it and push the spike page. The page will be at <https://magorvlkm.github.io/Kvestuj/> (capital K: the address is case-sensitive).

## B. Create a Drive folder (1 min)

1. Open <https://drive.google.com> → **+ New** → **New folder** → name it `Kvestuj spike` → **Create**.
2. Open the folder. Copy the ID from the address bar: the part after `/folders/`.
   Example: `https://drive.google.com/drive/folders/1AbC...xyz` → the ID is `1AbC...xyz`.

## C. Create the spike Apps Script (5 min)

1. Open <https://script.google.com> → **New project**.
2. Click **Untitled project** (top left) → rename it `Kvestuj spike` → **Rename**.
3. Delete everything in `Code.gs`, then paste the whole content of [`spike/Code.gs`](Code.gs).
4. On the line `const FOLDER_ID = 'PASTE_YOUR_DRIVE_FOLDER_ID_HERE';` replace the placeholder with your folder ID from B (keep the quotes).
5. Click the **Save** icon (💾).
6. In the toolbar's function dropdown pick **authorize**, then click **▶ Run**.
   - **Review permissions** → pick your Google account.
   - "Google hasn't verified this app" → **Advanced** → **Go to Kvestuj spike (unsafe)** → **Allow**. (It's your own script.)
   - The **Execution log** should show `Folder OK: Kvestuj spike`, `UrlFetchApp OK: HTTP 200` and a `Ping:` line.
7. **Deploy** (top right) → **New deployment** → click the ⚙️ next to "Select type" → **Web app**.
   - Description: `spike`
   - **Execute as:** Me
   - **Who has access:** Anyone
   - **Deploy** → (authorize again if asked) → copy the **Web app URL** (it ends in `/exec`). Keep it for E.

## D. Create the Drive API key (5 min)

1. Open <https://console.cloud.google.com> → project picker (top bar) → **New project** → name `kvestuj` → **Create** → when it's done, select the `kvestuj` project in the picker.
2. ☰ menu → **APIs & Services** → **Library** → search **Google Drive API** → open it → **Enable**.
3. ☰ menu → **APIs & Services** → **Credentials** → **+ Create credentials** → **API key**. Copy the key.
4. Click the key's name (or **Edit API key**) to restrict it:
   - **Application restrictions:** **Websites** → **Add** → `https://magorvlkm.github.io/*` → **Done**.
   - **API restrictions:** **Restrict key** → tick **Google Drive API** → **OK**.
   - **Save**. (Restrictions can take up to 5 minutes to apply.)

## E. Run the spike on both phones (10 min each)

Do this on the **iPhone in Safari** and on the **Android phone in Chrome**, once I've told you the page is live.

1. Open <https://magorvlkm.github.io/Kvestuj/>.
2. Paste the **Web app URL** (C7) and the **API key** (D3) into the two fields at the top. The phone remembers them.
3. **Step 1 · Ping** → it should say PASS and show the Prague time.
4. **Step 2 · Upload**: tap **Record video** (or **Choose from library**) and use a video of **30 MB or more** (on iPhone, about 20 s of 4K or 60 s of 1080p). Tap **Upload** and watch the progress. It should say PASS with a file ID.
5. **Step 3 · Share + play** → the video should play. Tap **Seek to middle**: it should jump and keep playing.
6. **Step 4 · Shrink**: pick a **60 s camera video** recorded on that phone. Tap **Shrink to 720p**. Note how long it takes and the final size. Then tap **Upload the small one** and check it plays.
7. Tap **Copy report** and paste the text into the chat.

If Step 2 or Step 3 fails on a phone, that's important: paste the report anyway. I'll stop and we decide together before going further.

## F. Afterwards

Nothing to clean up yet. The real setup later creates its own Sheet, folder and script. You can delete the `Kvestuj spike` folder and script once the results are written into the README.
