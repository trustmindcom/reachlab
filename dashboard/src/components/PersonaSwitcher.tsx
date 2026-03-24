import { usePersona } from "../context/PersonaContext";

export default function PersonaSwitcher() {
  const { personas, active, switchPersona } = usePersona();
  if (personas.length <= 1) return null;

  return (
    <select
      value={active?.id}
      onChange={(e) => switchPersona(Number(e.target.value))}
      className="text-[13px] bg-surface-1 border border-border rounded-md px-2 py-1 text-text-primary"
    >
      {personas.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name} {p.type === "company_page" ? "(Page)" : ""}
        </option>
      ))}
    </select>
  );
}
