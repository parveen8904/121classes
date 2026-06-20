// Plain link to the server sign-out route. A full-page GET lets the server
// clear the auth + device cookies and redirect to /login in one shot — no
// client/cookie race, so sign-out is instant and always works.
export default function SignOutButton() {
  return (
    <a className="btn secondary" href="/auth/signout">
      Sign out
    </a>
  );
}
