import React from "react";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import type { Plan } from "./engine";

const s = StyleSheet.create({
  page: { padding: 28, fontSize: 9, fontFamily: "Helvetica", color: "#0f172a" },
  h1: { fontSize: 15, marginBottom: 2 },
  sub: { fontSize: 9, color: "#64748b", marginBottom: 10 },
  stage: { fontSize: 10, marginTop: 10, marginBottom: 3, color: "#0d9488" },
  row: { flexDirection: "row", borderBottom: "0.5pt solid #e5e7eb", paddingVertical: 3 },
  date: { width: 92, color: "#475569" },
  taskCol: { flex: 1 },
  task: {},
  meta: { color: "#64748b", fontSize: 8 },
});

// Render the plan to a PDF buffer (multi-page). Server-only.
export async function renderPlanPdf(plan: Plan, opts: { subjectTitle: string; examDate: string }): Promise<Buffer> {
  const rows = plan.days.filter((d) => d.stage !== "break");
  const doc = (
    <Document>
      <Page size="A4" style={s.page}>
        <Text style={s.h1}>Study plan — {opts.subjectTitle}</Text>
        <Text style={s.sub}>Exam {opts.examDate}</Text>
        {rows.map((dd, i) => {
          const header = i === 0 || rows[i - 1].stageLabel !== dd.stageLabel;
          return (
            <View key={i} wrap={false}>
              {header ? <Text style={s.stage}>{dd.stageLabel}</Text> : null}
              <View style={s.row}>
                <Text style={s.date}>{dd.weekday} {dd.date}</Text>
                <View style={s.taskCol}>
                  <Text style={s.task}>{dd.task}</Text>
                  <Text style={s.meta}>{dd.meta}</Text>
                </View>
              </View>
            </View>
          );
        })}
      </Page>
    </Document>
  );
  const out = await renderToBuffer(doc);
  return out as Buffer;
}
