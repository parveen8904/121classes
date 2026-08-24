import { createClient } from "@/lib/supabase/server";
import { lightImg } from "@/lib/img";
import { tryServiceClient } from "@/lib/supabase/service";
import { sameAsFrom, personNode, personRef, SITE, WEBSITE_ID } from "@/lib/entity";

export const metadata = {
  title: "Faculty",
  description:
    "CA Parveen Sharma — Chartered Accountant since 1996, merit list at CA Inter and Final, 100% in Accountancy at Delhi University, Gold Medal at the 1990 Accounts Olympiad, and ICAI Board of Studies and Accounting Standards committee member. He teaches CA Final Financial Reporting and CA Inter Advanced Accounting.",
  // Its own address, so it is not read as a copy of the home page.
  alternates: { canonical: "/faculty" },
  openGraph: {
    type: "profile",
    url: "https://caparveensharma.com/faculty",
    title: "CA Parveen Sharma — Chartered Accountant and accounting educator",
  },
};

export const dynamic = "force-dynamic";

export default async function FacultyPage() {
  const supabase = createClient();
  const { data: faculty } = await supabase
    .from("faculties")
    .select("id, full_name, photo_url, bio")
    .order("full_name");

  // THE ONE PAGE THAT IS ABOUT HIM.
  //
  // Google will not assemble a Knowledge Panel out of a site that only ever
  // mentions a person in passing; it wants a single page it can treat as the
  // authority on the entity, and it wants that page to say so itself. That is
  // what ProfilePage means, and mainEntity is the line that points it at the
  // same #person the whole site already refers to.
  const svc = tryServiceClient();
  const { data: settings } = svc
    ? await svc.from("site_settings").select("key, value")
        .in("key", ["support_youtube", "support_instagram", "support_twitter", "support_facebook", "founder_photo"])
    : { data: null };
  const m = new Map((settings ?? []).map((r) => [r.key, r.value as string | null]));
  const sameAs = sameAsFrom(m);
  const him = (faculty ?? []).find((f) => /parveen|praveen/i.test(f.full_name));
  const profileLd = {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    "@id": `${SITE}/faculty`,
    url: `${SITE}/faculty`,
    name: "CA Parveen Sharma — faculty",
    isPartOf: { "@id": WEBSITE_ID },
    about: personRef,
    mainEntity: personNode({ sameAs, image: m.get("founder_photo") || him?.photo_url || undefined }),
  };

  return (
    <section className="section">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(profileLd) }} />
      <div className="section-head">
        <span className="eyebrow">👩‍🏫 Faculty</span>
        <h2>Meet the team</h2>
        <p>
          Led by <strong>CA Parveen Sharma</strong> — one of India&apos;s most renowned Accountancy
          educators — and his handpicked faculty.
        </p>
      </div>

      {/* GOOGLE WILL NOT ANCHOR TO MARKUP THE PAGE ITSELF DOES NOT BACK UP.
          The JSON-LD above claims a university, a qualifying year, an award and
          three professional bodies. Every one of them is stated here in prose
          too, in the same words, because structured data that a page does not
          corroborate is a claim with nothing behind it — and a person Google
          cannot corroborate never gets a Knowledge Panel. */}
      <div className="card" style={{ maxWidth: 780, margin: "0 auto 26px", lineHeight: 1.8 }}>
        <p style={{ margin: 0 }}>
          <strong>CA Parveen Sharma</strong> — also written Praveen Sharma — is a Chartered Accountant and
          accounting educator, and one of the most recognised names in Indian CA education for Accountancy,
          Advanced Accounting and Financial Reporting. Students have long called him the{" "}
          <strong>&ldquo;God of Accounts&rdquo;</strong>; it is their nickname for him, not a designation.
        </p>

        <h3 style={{ margin: "18px 0 6px", fontSize: "1.02rem" }}>Academic record</h3>
        <p style={{ margin: 0 }}>
          He graduated in Commerce from the <strong>University of Delhi</strong>, where he scored{" "}
          <strong>100% in Accountancy</strong>, and won the <strong>Gold Medal at the Accounts Olympiad
          in 1990</strong>. He qualified as a <strong>Chartered Accountant in 1996</strong>, placing in the{" "}
          <strong>merit list at both the Intermediate and the Final</strong> examinations. He went on to a
          post-graduate specialisation in <strong>Indian Accounting Standards and US GAAP</strong> in July 2007,
          and completed ICAI&rsquo;s <strong>certificate course in Valuation</strong> in January 2010.
        </p>

        <h3 style={{ margin: "18px 0 6px", fontSize: "1.02rem" }}>Professional bodies and ICAI roles</h3>
        <p style={{ margin: 0 }}>
          Beyond the classroom he has served on ICAI committees: <strong>Co-opted Member of the Board of
          Studies (2006&ndash;07)</strong>, <strong>Advisor to the Accounting Standards Committee
          (2007&ndash;08)</strong>, member of the <strong>Committee for Accounting Standards for Local Bodies
          (2007&ndash;08)</strong>, the <strong>Regional Monitoring Committee (2003&ndash;04)</strong> and the{" "}
          <strong>Committee on Management Accounting (2008&ndash;09)</strong>. He has been visiting faculty with
          ICAI and ICWAI. He is an Associate of the <strong>Institute of Cost Accountants of India</strong> and a
          Licentiate of the <strong>Institute of Company Secretaries of India</strong>.
        </p>

        <h3 style={{ margin: "18px 0 6px", fontSize: "1.02rem" }}>What he teaches, and how</h3>
        <p style={{ margin: 0 }}>
          Two papers, and only two: <strong>Financial Reporting</strong> for the CA Final and{" "}
          <strong>Advanced Accounting</strong> for CA Intermediate. Financial Instruments is taught as part of
          Financial Reporting. His teaching starts from why an entry is passed rather than what entry to pass —
          the principle first, then the journal entries, the ledger effect, the presentation, and finally the
          same problem in enough variations that an exam cannot surprise you. Answers are written the way ICAI
          expects them to be written.
        </p>

        <h3 style={{ margin: "18px 0 6px", fontSize: "1.02rem" }}>Before online classes existed</h3>
        <p style={{ margin: 0 }}>
          He was teaching by <strong>satellite from around 2008</strong>, delivering classes over a VSAT network
          to students at centres across India — years before recorded CA lectures were common. His career
          predates the current online coaching industry rather than being a product of it.
        </p>

        <h3 style={{ margin: "18px 0 6px", fontSize: "1.02rem" }}>Books</h3>
        <p style={{ margin: 0 }}>
          He is co-author, with CA Kapileshwar Bhalla, of <strong>Taxmann&rsquo;s CRACKER for Financial
          Reporting</strong> — past examination questions, RTPs and MTPs, tagged by Ind AS. His own study
          material, handwritten notes, MCQs and revision planners accompany the courses on this site.
        </p>

        <p className="muted" style={{ margin: "18px 0 0", fontSize: ".88rem" }}>
          He teaches from Gurugram and online across India, in English and Hindi. His earlier work is at{" "}
          <a href="https://aldine.edu.in" rel="noopener noreferrer" target="_blank" className="grad">aldine.edu.in</a>,
          which is his own.
        </p>
      </div>

      {faculty && faculty.length > 0 ? (
        <div className="grid grid-3">
          {faculty.map((f) => (
            <div className="tile" key={f.id} style={{ textAlign: "center" }}>
              <div
                style={{
                  width: 110,
                  height: 110,
                  borderRadius: "50%",
                  margin: "0 auto 14px",
                  overflow: "hidden",
                  border: "2px solid var(--accent)",
                  background: "linear-gradient(135deg, rgba(13,148,136,.25), rgba(16,185,129,.25))",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "2.4rem",
                }}
              >
                {f.photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={lightImg(f.photo_url, 256)} loading="lazy" decoding="async" alt={f.full_name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  "👨‍🏫"
                )}
              </div>
              <h3 style={{ fontSize: "1.15rem" }}>{f.full_name}</h3>
              {f.bio && <p className="muted" style={{ fontSize: ".9rem", marginTop: 8 }}>{f.bio}</p>}
            </div>
          ))}
        </div>
      ) : (
        <p className="muted" style={{ textAlign: "center" }}>Faculty profiles are coming soon.</p>
      )}
    </section>
  );
}
