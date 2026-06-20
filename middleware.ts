import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { deviceKind } from "@/lib/device";

type CookieToSet = { name: string; value: string; options: CookieOptions };

// Refreshes the Supabase session on every request and guards portal routes.
export async function middleware(request: NextRequest) {
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

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

  if (!user && isProtected) {
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

    // 1) Single active session per device kind. Only enforced once a session has
    //    claimed a device (has the dsid cookie); older/grandfathered sessions pass.
    const dsid = request.cookies.get("dsid")?.value;
    if (dsid) {
      try {
        const kind = deviceKind(request.headers.get("user-agent") || "");
        const { data: ds } = await supabase
          .from("device_sessions")
          .select("token")
          .eq("user_id", user.id)
          .eq("device_kind", kind)
          .maybeSingle();
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
    try {
      const { data: prof } = await supabase
        .from("profiles")
        .select("has_password")
        .eq("id", user.id)
        .maybeSingle();
      if (prof && prof.has_password === false) {
        const url = request.nextUrl.clone();
        url.pathname = "/auth/set-password";
        url.search = "";
        url.searchParams.set("next", path);
        return NextResponse.redirect(url);
      }
    } catch {
      /* fail-open */
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
