import { getMockDb } from "@/lib/mock-repo";
import { isMockMode } from "@/lib/runtime";
import { toEasternISO } from "@/lib/timezone";

export async function getHealthSnapshot() {
  const db = getMockDb();

  if (isMockMode()) {
    // TODO(backend): replace with clinical queries and medication workflow logic.
    const marToday = db.members.map((m, idx) => ({
      id: `mar-today-${idx}`,
      member_name: m.display_name,
      medication_name: idx % 2 === 0 ? "Donepezil 10mg" : "Metformin 500mg",
      due_at: toEasternISO(new Date(Date.now() + (idx + 1) * 3600000)),
      administered_at: idx % 3 === 0 ? null : toEasternISO(new Date(Date.now() - idx * 1800000)),
      nurse_name: "Nina Nurse",
      status: idx % 3 === 0 ? "scheduled" : "administered"
    }));

    const bloodSugarHistory = [...db.bloodSugarLogs].sort((a, b) => (a.checked_at < b.checked_at ? 1 : -1));

    return {
      marToday,
      bloodSugarHistory,
      memberActions: db.members.map((m) => ({
        member_id: m.id,
        member_name: m.display_name,
        action: "Review meds and glucose trends"
      }))
    };
  }

  return { marToday: [], bloodSugarHistory: [], memberActions: [] };
}

