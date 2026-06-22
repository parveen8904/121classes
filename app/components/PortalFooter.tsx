// Shared footer for every signed-in portal page (student + admin).
// Inspirational line + brand credit + the two-colour strip.
export default function PortalFooter() {
  return (
    <footer className="portal-footer">
      <div className="portal-footer-inner">
        <p className="line">📚 Built with ❤️ for future Chartered Accountants — keep going, you&apos;ve got this! 🎯</p>
        <p className="sub">
          © 121 CA Classes · A venture by CA Parveen Sharma 🙏 · Site by: Dmeter Inc.
        </p>
      </div>
      <div className="portal-strip" />
    </footer>
  );
}
