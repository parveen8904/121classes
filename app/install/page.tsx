import InstallHelper from "./InstallHelper";

export const metadata = {
  title: "Install the app — CA Parveen Sharma",
};

export default function InstallPage() {
  return (
    <main>
      <section className="section" style={{ paddingTop: 50 }}>
        <div className="section-head">
          <div className="eyebrow">Get the app</div>
          <h2>Install on your device</h2>
          <p>Add CA Parveen Sharma to your phone or computer — it runs full-screen, like an app.</p>
        </div>
        <InstallHelper />
      </section>
    </main>
  );
}
