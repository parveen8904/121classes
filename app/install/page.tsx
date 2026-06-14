import SiteNav from "../components/SiteNav";
import SiteFooter from "../components/SiteFooter";
import InstallHelper from "./InstallHelper";

export const metadata = {
  title: "Install the app — 121 CA Classes",
};

export default function InstallPage() {
  return (
    <main>
      <SiteNav />
      <section className="section" style={{ paddingTop: 50 }}>
        <div className="section-head">
          <div className="eyebrow">Get the app</div>
          <h2>Install on your device</h2>
          <p>Add 121 CA Classes to your phone or computer — it runs full-screen, like an app.</p>
        </div>
        <InstallHelper />
      </section>
      <SiteFooter />
    </main>
  );
}
