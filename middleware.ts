import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { deviceKind } from "@/lib/device";

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
  // Expose the current path to server layouts (the admin layout uses it to gate
  // operators/faculty to their permitted areas).
  request.headers.set("x-pathname", request.nextUrl.pathname);
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
    let prof: { has_password: boolean | null; role: string | null } | null = null;
    try {
      const profRes = await withTimeout(
        supabase.from("profiles").select("has_password, role").eq("id", user.id).maybeSingle(),
        3000,
      );
      prof = profRes === TIMEOUT ? null : (profRes.data as typeof prof);
    } catch {
      /* fail-open */
    }
    const isStaff = prof?.role === "admin" || prof?.role === "faculty";

    // 1) Single active session per device kind — STUDENTS only. Staff test on
    //    many devices/browsers; the rule kept logging the founder out.
    const dsid = request.cookies.get("dsid")?.value;
    if (dsid && !isStaff) {
      try {
        const kind = deviceKind(request.headers.get("user-agent") || "");
        const dsRes = await withTimeout(
          supabase.from("device_sessions").select("token").eq("user_id", user.id).eq("device_kind", kind).maybeSingle(),
          3000,
        );
        const ds = dsRes === TIMEOUT ? null : dsRes.data;
        if (ds && ds.token !== dsid) {
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
  // Run on everything except static assets and the legacy static marketing pages.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:html|css|js|png|jpg|jpeg|svg|gif|webp|ico)).*)",
  ],
};
