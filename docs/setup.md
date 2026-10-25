# DMBot setup

DMBot watches comments on your Instagram reels. When a comment is exactly one of your keywords, it sends the commenter a
**private reply** (a DM) and posts a **public reply** under the comment. Keywords are set per reel on the admin page.

```
Someone comments "LINK" ──► Meta webhook ──► /server/webhook/ (Catalyst)
                                              ├─ check the signature
                                              ├─ find the reel's rule (exact match)
                                              ├─ log the comment (once only)
                                              ├─ POST /<ig-user-id>/messages  (private reply)
                                              └─ POST /<comment-id>/replies   (public reply)
```

## Sharing with friends (several accounts, one deployment)
Each signed-in email has its own Instagram account, reels, keywords and Activity, and nobody sees anyone else's.
The 12 public replies are shared. There's no App Review: Meta's Standard Access covers Instagram accounts added to
the app as testers, which is enough for about 20 friends.

**One-time setup:** in Meta → Instagram → API setup with Instagram login → *Set up Instagram business login* →
Business login settings, add the OAuth redirect URI `https://<domain>/server/admin/oauth/callback`.

**Adding a friend:**
1. Their Instagram must be a **public Professional** account (Creator or Business).
2. Meta dashboard → App roles → Roles → Add people → **Instagram Tester** → their username. They accept the invite at
   instagram.com → Settings → Website permissions → Apps and websites → Tester invites.
3. Catalyst console → Authentication → add their email as a user (public sign-up stays off).
4. They open `https://<domain>/app/`, sign in, and click **Settings → Connect Instagram**. Instagram's login handles the
   token, so nothing secret is shared. Then they add keywords on **Reels**.

An Instagram account can only be connected to one email. The pasted-token option under Settings → Advanced is
for the owner only, because it needs the Meta dashboard.

## Follow-gate (every keyword)
Only followers get the real DM. Instagram has no "new follower" event and allows one DM per comment, so the
person's own reply is the trigger:
1. They comment the keyword. They get the public reply and the keyword's **follow-gate message**, with an
   **I followed ✅** button. Their user ID is stored as *waiting*.
2. They follow, then tap the button or reply **DONE** (the same word for every keyword; any capitals).
3. The bot asks Instagram whether they follow you (`is_user_follow_business`; only allowed once they've messaged):
   - **Yes:** the real DM is sent and Activity shows *Follow: unlocked*.
   - **No:** "Looks like you're not following @you yet…" with the button again.
   - **After 7 days:** "This offer has expired…".

Other DMs people send you are never answered. Keywords saved without a follow-gate message send the real DM straight away.
If the `messages` field was added after connecting, `POST /server/admin/cron/resubscribe` (header `x-cron-secret`)
switches it on without pasting the token again.

## Limitations (set by Instagram, not by DMBot)
- Only **Professional** accounts (Creator or Business) can use the API, and the account must be **public** to get comment webhooks.
- You get **one private reply per comment**, and it must be sent within **7 days** of the comment. After that you can
  only message the person again if they reply, which opens a 24-hour window.
- If the commenter doesn't follow you, the DM may land in their **Message requests**.
- Meta caps automated DMs (roughly 200 an hour per account) and flags spammy behaviour. That's why public replies
  are drawn from a fixed set of 12 (`shared/replies.js`), never the same twice in a row.
- Only **top-level comments** trigger the bot. Replies to other comments and your own comments are ignored.
- The **Reels** page and the reel-link search look at your 250 most recent posts.
- Access tokens last **60 days**. The cron job below refreshes them.

## 1. Instagram and the Meta app
1. In the Instagram app, switch to a **Professional account** (Settings → Account type and tools) and make sure it's public.
2. Go to [developers.facebook.com](https://developers.facebook.com) → **My Apps → Create app**. Pick the use case for
   managing messaging and content on Instagram (the **Instagram API**). The app type is **Business**.
3. Open **Instagram → API setup with Instagram login**:
   - Under **Generate access tokens**, click **Add account**, log in to your Instagram account and allow every permission:
     `instagram_business_basic`, `instagram_business_manage_comments` and `instagram_business_manage_messages`.
   - Copy the **Instagram app secret** shown on that page. It goes in `META_APP_SECRET`. Webhooks are signed with this
     one, not with the main App secret.
   - First give your own Instagram account the **Instagram Tester** role (App roles → Roles) and accept the invite
     (instagram.com → Settings → Website permissions → Apps and websites → Tester invites).
   - Leave the token for now. You'll generate and paste it in step 5.
4. Leave the page open; you'll come back to set up webhooks after deploying.

## 2. Catalyst project (separate Catalyst account)
DMBot runs on a **different Catalyst account** from your other projects, so make sure the CLI is signed in to the right one.
```bash
catalyst logout            # only if the CLI is signed in to another account
catalyst login             # sign in with the DMBot Catalyst account
cd DMBot && catalyst init  # pick the DMBot project; skip creating functions/client, they already exist
```
`catalyst init` writes `.catalystrc`, which is git-ignored.

Then, in the console for that project:
1. **Data Store** (Cloud Scale → Data Store): create the three tables below. `node scripts/setup-datastore.js` prints the same list.
   | Table | Columns |
   |---|---|
   | Settings | `owner_email` varchar 100, `ig_user_id` varchar 32, `username` varchar 64, `access_token` text, `token_expires_at` bigint |
   | Rules | `account_id` varchar 32, `media_id` varchar 32 ✱, `permalink` varchar 255, `caption_preview` varchar 255, `keyword` varchar 100 ✱, `dm_text` text ✱, `gate_text` text, `enabled` varchar 5 |
   | Processed | `account_id` varchar 32, `comment_id` varchar 32 ✱ **Unique**, `media_id` varchar 32, `from_id` varchar 32, `from_username` varchar 64, `comment_text` text, `rule_id` varchar 32, `dm_status` varchar 10, `reply_status` varchar 10, `reply_text` varchar 255, `unlock_status` varchar 10, `unlock_expires_at` bigint, `unlocked_at` bigint, `error` varchar 255 |

   ✱ = mandatory. **`comment_id` must be Unique**: that's what stops a second DM when Meta re-sends a webhook.
   Set each table's permissions so only the server (admin scope) can read and write. The browser never touches the Data Store directly.
2. **Authentication** (Cloud Scale → Authentication): turn on Embedded Authentication.
   - Add your own account as the **only** user, using the email you'll put in `ADMIN_EMAIL`.
   - Turn off public sign-up.
   - Set the redirect URL to `https://<domain>/app/#/reels`.

## 3. Secrets
```bash
cp .env.deploy.example .env.deploy   # git-ignored
```
| Variable | Function | Value |
|---|---|---|
| `META_APP_SECRET` | webhook | **Instagram app secret** (Instagram → API setup with Instagram login), **not** the main App secret |
| `WEBHOOK_VERIFY_TOKEN` | webhook | any random string of 16+ characters; you'll type it into Meta too |
| `ADMIN_EMAIL` | admin | your Catalyst sign-in email |
| `CRON_SECRET` | admin | any random string of 16+ characters; the cron job sends it |
| `IG_APP_ID` | admin | Instagram app ID (digits, same page as the Instagram app secret); `META_APP_SECRET` also goes to admin |
| `APP_BASE_URL` | admin | `https://<domain>`, no trailing slash (used for the Instagram login redirect) |

Generate random values with `openssl rand -hex 24`.

## 4. Deploy
```bash
(cd functions/webhook && npm install --registry https://registry.npmjs.org)
(cd functions/admin && npm install --registry https://registry.npmjs.org)
(cd client && npm install --registry https://registry.npmjs.org)
./deploy.sh
```
`deploy.sh` does the following, in order:
1. runs every test;
2. copies `shared/` into each function;
3. builds the client;
4. adds the secrets for the deploy, then puts the files back the way they were.

`DEPLOY_DRY_RUN=1 ./deploy.sh` does all of this except the actual deploy.

## 5. Connect and switch on webhooks
1. Open `https://<domain>/app/` and sign in.
2. Generate a token on the Meta page from step 1.3 (**Generate token**), then paste it into **Settings → Save and connect**.
   This checks the token, saves your account ID, and turns on comment notifications for your account
   (`POST /me/subscribed_apps?subscribed_fields=comments`).
3. Back on the Meta page, go to **Configure webhooks**:
   - **Callback URL:** `https://<domain>/server/webhook/`. It's shown on the Settings page with a Copy button.
   - **Verify token:** the value of `WEBHOOK_VERIFY_TOKEN`.
   - Click **Verify and save**, then **subscribe** to the `comments` **and** `messages` fields (messages is needed for the follow-gate).
4. **App mode.** Meta's docs say the app must be **Live** to deliver webhooks for real comments.
   - Fill in App settings → Basic:
     - **Privacy policy URL:** `https://<domain>/app/#/privacy`
     - **User data deletion:** use the same URL; the page explains how to ask for deletion.
     - App icon and category.
   - Then switch the app to **Live**.
5. **Cron for the token** (Cloud Scale → Cron): set up a weekly job that sends **POST** to `https://<domain>/server/admin/cron/refresh-token`
   with the header `x-cron-secret: <CRON_SECRET>`. Use the Asia/Kolkata timezone.

## 6. Try it
1. On **Reels**, pick a reel (or paste its link) and add a keyword, for example `LINK`, with your DM text.
2. From a **different** Instagram account, comment `link` on that reel.
3. Check three things:
   - a DM arrived (look under **Requests** too);
   - your public reply appears under the comment;
   - **Activity** shows the comment with `DM: sent` and `Reply: sent`.

## What made it work (confirmed 2026-10-25)
- **The app must be Live.** In Development mode, Meta hides other people's comments from the app: `/comments` returns
  an empty list even though `comments_count` is higher, and no comment webhooks arrive. Publishing the app fixed it.
  It did **not** need App Review or Advanced Access for your own account, and commenters don't need any role.
- **`META_APP_SECRET` must be the Instagram app secret.** With the main App secret, every real webhook fails the
  signature check (`webhook: bad signature` in the logs) and is refused.
- **Old comments aren't sent again.** Only comments posted after the app went Live (and after the secret was right) trigger the bot.
- **Raw body works on Catalyst.** The signature is checked against the exact bytes.
- **API version.** It is `v26.0`, set in `API_VERSION` in `shared/instagram.js`.

## Diagnostics
`GET https://<domain>/server/admin/cron/diagnose` with the header `x-cron-secret: <CRON_SECRET>` is read-only. It returns:
- the connection status and Meta's webhook subscription;
- your rules;
- recent Activity;
- for each reel with a rule, the latest comments, whether each one matches a rule, and whether it was recorded.

It never returns the token.

## Troubleshooting
| Symptom | Likely cause |
|---|---|
| Settings: "access token is invalid or expired" | Generate a new token in the Meta dashboard and paste it again. |
| Activity: `DM: failed … (#10)` or "outside of allowed window" | The comment is older than 7 days, or it already got a private reply. |
| Activity: `DM: failed`, but the reply was sent | The commenter's privacy settings block messages from accounts they don't follow. |
| Nothing in Activity | The comment didn't exactly match (`link pls` ≠ `link`), the rule is paused, the app isn't Live, or `META_APP_SECRET` isn't the Instagram app secret. Run the diagnostics. |
| Admin page says "not allowed" | The signed-in Catalyst email is different from `ADMIN_EMAIL`. |

## Local testing without Instagram
`IG_MOCK=1` swaps the Instagram client for a fake that only logs. With `catalyst serve` running, you can POST a signed
sample payload to `/server/webhook/`. The tests in `shared/test/webhook-handler.test.js` show the payload shape.
