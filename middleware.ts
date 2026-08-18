import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { deviceKind, sameDevice } from "@/lib/device";

type CookieToSet = { name: string; value: string; options: CookieOptions };

// Resilience against a Supabase blip: race any auth/DB call against a short
// timeout so a stalled dependency can't hang the request for 25s (→ 504 for
// the whole site). On timeout we degrade gracefully — public pages render, and
// protected pages fall through to their OWN server-side auth check (every
// dashboard/admin/learn page re-verifies the user), so nobody is falsely
// logged out and no page dies just because the middleware couldn't reach the DB.
const TIMEOUT = Symbol("timeout");
function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T | typeof TIMEOUT> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<typeof TIMEOUT>((resolve) => setTimeout(() => resolve(TIMEOUT), ms)),
  ]);
}

// Refreshes the Supabase session on every request and guards portal routes.
export async function middleware(request: NextRequest) {
  // Heal mangled URLs where the query separator got percent-encoded into the
  // path ("/plans%3Fsubject=…" → 404). Sources include email-client link
  // rewriting and copy-paste; whatever produced it, redirect to the real page.
  const rawPath = request.nextUrl.pathname;
  if (/%3F/i.test(rawPath)) {
    const [path, rest] = rawPath.split(/%3F/i, 2);
    const qs = (rest ?? "").replace(/%3D/gi, "=").replace(/%26/gi, "&");
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = qs ? `?${qs}${url.search ? "&" + url.search.slice(1) : ""}` : url.search;
    return NextResponse.redirect(url, 308);
  }

  // Expose the current path to server layouts (the admin layout uses it to gate
  // operators/faculty to their permitted areas).
  request.headers.set("x-pathname", request.nextUrl.pathname);

  // NOBODY SIGNED IN? THEN THERE IS NOTHING TO ASK SUPABASE.
  //
  // Everything below verifies a session over the network — a hop to Mumbai on
  // every page a visitor opens. A visitor with no auth cookie has no session to
  // verify: getUser() can only ever answer "no user", after the round-trip.
  //
  // Two costs, both paid on every public page. The obvious one is the wait. The
  // expensive one is that touching the session makes the response private and
  // uncacheable, so the homepage — which declares revalidate = 300 and should
  // be served from the edge in milliseconds — was rebuilt for every visitor,
  // every time. It reported x-vercel-cache: MISS on every request.
  //
  // With no cookie the answer is known without asking: a protected path goes to
  // the login page, and everything else is public and passes straight through.
  // Signed-in requests are untouched below — same client, same checks.
  const hasSession = request.cookies
    .getAll()
    .some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"));

  const publicPath = request.nextUrl.pathname;
  const guarded =
    publicPath.startsWith("/dashboard") ||
    publicPath.startsWith("/admin") ||
    publicPath.startsWith("/learn") ||
    publicPath.startsWith("/live");

  if (!hasSession) {
    if (guarded) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", publicPath);
      return NextResponse.redirect(url);
    }
    // A public page for a signed-out visitor: leave the response alone so it
    // stays cacheable.
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Validate the session, but never wait more than 4s for Supabase. If it
  // stalls (a Supabase outage/slowdown), we proceed rather than 504.
  const authRes = await withTimeout(supabase.auth.getUser(), 4000);
  const authTimedOut = authRes === TIMEOUT;
  const user = authTimedOut ? null : authRes.data.user;

  const path = request.nextUrl.pathname;

  // Already signed in but landed on /login (e.g. pressed Back) — send them
  // straight to where they were going, so it never looks like a logout.
  if (user && path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = request.nextUrl.searchParams.get("next") || "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  const isProtected =
    path.startsWith("/dashboard") ||
    path.startsWith("/admin") ||
    path.startsWith("/learn") ||
    path.startsWith("/live");

  // Only redirect to login when we KNOW there's no user. If the auth check
  // timed out, let the request through — the destination page re-verifies auth
  // itself, so we avoid falsely logging real users out during a Supabase blip.
  if (!user && isProtected && !authTimedOut) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  // For signed-in users on portal routes: enforce single-device + mandatory
  // password. Both checks fail OPEN (any DB hiccup never locks anyone out).
  if (user && isProtected) {
    // Email must be verified before using the portal.
    if (user.email && !user.email_confirmed_at && !user.phone_confirmed_at) {
      const url = request.nextUrl.clone();
      url.pathname = "/auth/verify-pending";
      url.search = "";
      return NextResponse.redirect(url);
    }

    // One profile read serves both checks below (password + role).
    type Prof = { has_password: boolean | null; role: string | null };
    let prof: Prof | null = null;
    try {
      const profRes = await withTimeout(
        supabase.from("profiles").select("has_password, role").eq("id", user.id).maybeSingle(),
        3000,
      );
      prof = profRes === TIMEOUT ? null : ((profRes.data ?? null) as Prof | null);
    } catch {
      /* fail-open */
    }
    const isStaff = prof?.role === "admin" || prof?.role === "faculty";

    // 1) Single active session per device kind — STUDENTS only. Staff test on
    //    many devices/browsers; the rule kept logging the founder out.
    const dsid = request.cookies.get("dsid")?.value;
    if (dsid && !isStaff) {
      try {
        const ua = request.headers.get("user-agent") || "";
        const kind = deviceKind(ua);
        const dsRes = await withTimeout(
          supabase.from("device_sessions").select("token, user_agent").eq("user_id", user.id).eq("device_kind", kind).maybeSingle(),
          3000,
        );
        const ds = dsRes === TIMEOUT ? null : dsRes.data;
        // The same phone signing in again — cookies cleared, app reinstalled,
        // a private window — is not a second person. Evicting for that tells a
        // student they are logged in elsewhere while they hold the only device
        // they own.
        if (ds && ds.token !== dsid && !sameDevice(ds.user_agent as string | null, ua)) {
          const url = request.nextUrl.clone();
          url.pathname = "/auth/signout";
          url.search = "";
          url.searchParams.set("reason", "elsewhere");
          return NextResponse.redirect(url);
        }
      } catch {
        /* fail-open */
      }
    }

    // 2) Mandatory password: first-timers must set one before using the portal.
    if (prof && prof.has_password === false) {
      const url = request.nextUrl.clone();
      url.pathname = "/auth/set-password";
      url.search = "";
      url.searchParams.set("next", path);
      return NextResponse.redirect(url);
    }
  }

  return response;
}

export const config = {
  // WHAT THIS COSTS WHEN IT RUNS ON THE WRONG THING.
  //
  // This middleware asks Supabase to verify the session — a network hop to
  // Mumbai, with a four-second timeout — on every request it matches. The old
  // list excluded eight image extensions and nothing else, so it also ran on:
  //
  //   /manifest.webmanifest   10,690 requests a day
  //   /media/*.jfif            ~8,000 requests a day across a handful of files
  //
  // Nineteen thousand session checks a day, none of which could ever change
  // what was served: a manifest and a photograph do not have a logged-in
  // version. That is the largest avoidable line on the bill, and it is not the
  // crons — those are barely two per cent of traffic.
  //
  // So: everything that is a file rather than a page is excluded, by extension,
  // along with the media folder itself. A page has no extension, which is what
  // makes this safe — no route the portal actually guards can match it.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|media/|.*\\.(?:html|css|js|mjs|json|txt|xml|webmanifest|map|png|jpg|jpeg|jfif|svg|gif|webp|avif|ico|bmp|mp3|mp4|webm|ogg|wav|pdf|zip|woff|woff2|ttf|otf|eot)).*)",
  ],
};
