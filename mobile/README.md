# CA Parveen Sharma — mobile app (iOS + Android)

Built with **Capacitor**: a native iOS/Android shell around the live website
(`caparveensharma.com`, Mumbai backend). It opens at **login → dashboard** (no
marketing pages). One iOS build runs on **both iPhone and iPad**.

- **Phase 1 (this folder):** branded native shell that streams classes online.
- **Phase 2 (next):** native secure offline download + decrypt-on-play plugin
  (the mobile version of the desktop app's encrypted offline feature).
- **Payments:** students upgrade/buy plans on the **web** (in-browser), not inside
  the app — so Apple/Google take no cut and review is simpler.

---

## One-time setup on your Mac

Install the tools (once):
- **Xcode** (from the Mac App Store) + run `xcode-select --install`
- **CocoaPods**: `sudo gem install cocoapods`
- **Android Studio** (includes the Android SDK)
- **Node 20+**

Then, in this `mobile/` folder:

```bash
npm install
npx cap add ios
npx cap add android
npx cap sync
```

## App icon & splash (from Canva)

1. Export from Canva and drop these into `mobile/assets/`:
   - `icon.png` — 1024×1024 (no transparency, no rounded corners)
   - `splash.png` — 2732×2732 (logo centred on the dark brand background)
2. Generate every required size:
   ```bash
   npm run assets
   npx cap sync
   ```

## Run on a device / simulator

```bash
npm run open:ios       # opens Xcode → pick your iPhone/iPad or a simulator → Run
npm run open:android   # opens Android Studio → pick a device/emulator → Run
```

In Xcode: select the project → **Signing & Capabilities** → choose your Apple
Developer **Team** (you have the account) so it can run on real devices.

## Submit to the stores

**iOS (App Store):**
1. Xcode → set version/build → **Product ▸ Archive** → **Distribute App ▸ App Store Connect**.
2. On [App Store Connect](https://appstoreconnect.apple.com): create the app
   (bundle id `in.caclasses.app`), add screenshots + description, attach the build,
   give the reviewer a **demo student login**, submit.

**Android (Google Play):**
1. Android Studio → **Build ▸ Generate Signed Bundle (.aab)** (create a keystore once — keep it safe).
2. On [Play Console](https://play.google.com/console): create the app, upload the
   `.aab`, add screenshots + description, complete the questionnaires, submit.

## Phase 2 — secure offline download (built)

The `plugins/offline-classes/` Capacitor plugin gives the app the same offline
ability as the desktop app:
- **download** — streams the encrypted class to app storage (`<id>.enc`) with progress.
- **decrypt** — AES-256-CBC decrypt to a temp file, **only while playing**; the key
  is fetched per-play from the server (`getOfflineKey`) and never stored on the device.

It's wired automatically: `npm install` (the plugin is a local `file:` dependency)
then `npx cap sync` registers it into both iOS and Android. The website's existing
Downloads page detects the app and uses it — no website change needed at build time.

> ⚠️ **This native code has not been run on a device yet** (it can only be compiled
> on your Mac with Xcode/Android Studio). After your first `cap sync` + run, test:
> download a class → Play. If playing the decrypted local file inside the
> webview is blocked on iOS, the fix is a small native full-screen player method —
> tell me and I'll add it.

## Update the app later

Because the app loads the live website, **most updates ship instantly** when you
deploy the site — no new app version needed. You only rebuild/resubmit when the
native shell or the offline plugin changes.
