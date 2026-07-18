# iOS in-app rating prompt — spec for Ravi (next build)

Android already shows Google Play's in-app review card. This adds the iOS
equivalent: Apple's native ⭐️⭐️⭐️⭐️⭐️ rating sheet (`StoreKit`), which lets a
student rate without leaving the app.

## Apple's rules (important)

- Use `SKStoreReviewController.requestReview(in:)` / `AppStore.requestReview` —
  **never a custom "rate us" popup** that mimics it (App Review rejection risk).
- iOS decides whether the sheet actually appears; Apple caps it at
  **3 prompts per user per 365 days**. Calling it more often is fine — extra
  calls are silently ignored.
- Never call it from a button labelled "Rate now" that promises a prompt
  (it may not show). Trigger it silently at a good moment instead.

## When to trigger (same logic as the Android build)

Prompt on the **5th app open**, and only if **3+ days have passed since first
launch** — a student who just installed shouldn't be asked. After a prompt
attempt, wait **60 days** before attempting again.

## Code (Swift)

```swift
import StoreKit

enum RatingPrompt {
    private static let openCountKey = "rating.openCount"
    private static let firstLaunchKey = "rating.firstLaunch"
    private static let lastPromptKey = "rating.lastPrompt"

    /// Call from applicationDidBecomeActive / scene activation.
    static func appOpened() {
        let d = UserDefaults.standard
        if d.object(forKey: firstLaunchKey) == nil {
            d.set(Date(), forKey: firstLaunchKey)
        }
        d.set(d.integer(forKey: openCountKey) + 1, forKey: openCountKey)
        maybePrompt()
    }

    private static func maybePrompt() {
        let d = UserDefaults.standard
        let opens = d.integer(forKey: openCountKey)
        guard opens >= 5 else { return }

        let firstLaunch = d.object(forKey: firstLaunchKey) as? Date ?? Date()
        guard Date().timeIntervalSince(firstLaunch) > 3 * 24 * 3600 else { return }

        if let last = d.object(forKey: lastPromptKey) as? Date,
           Date().timeIntervalSince(last) < 60 * 24 * 3600 { return }

        d.set(Date(), forKey: lastPromptKey)

        // Small delay so the sheet doesn't collide with launch animations.
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            if let scene = UIApplication.shared.connectedScenes
                .first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene {
                if #available(iOS 18.0, *) {
                    AppStore.requestReview(in: scene)
                } else {
                    SKStoreReviewController.requestReview(in: scene)
                }
            }
        }
    }
}
```

Hook it up in the App/Scene delegate:

```swift
func sceneDidBecomeActive(_ scene: UIScene) {
    RatingPrompt.appOpened()
}
```

## Testing

- In a **development build**, the sheet shows every time it's requested (no
  quota) — run the app 5 times to see it.
- In **TestFlight** the sheet never shows (by Apple design) — that's expected,
  not a bug.
- The quota applies only in the App Store build.

## Optional extra (nice to have, not required)

A "⭐ Rate the app" row in the app's settings/about screen may deep-link to the
write-a-review page (this one is allowed to be a button because it opens the
App Store rather than promising the sheet):

```swift
if let url = URL(string: "https://apps.apple.com/app/id6789032629?action=write-review") {
    UIApplication.shared.open(url)
}
```

That's the whole change — no web/app-content changes needed; the site is
unaffected.
