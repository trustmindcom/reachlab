import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

export interface Persona {
  id: number;
  name: string;
  linkedin_url: string;
  type: "personal" | "company_page";
}

interface PersonaContextValue {
  personas: Persona[];
  active: Persona | null;
  switchPersona: (id: number) => void;
  refreshPersonas: () => Promise<void>;
}

const PersonaContext = createContext<PersonaContextValue>({
  personas: [],
  active: null,
  switchPersona: () => {},
  refreshPersonas: async () => {},
});

export function usePersona() {
  return useContext(PersonaContext);
}

// Global getter so the API client can read it outside React
let _activePersonaId = Number(localStorage.getItem("reachlab_active_persona_id") || "1");
export function getActivePersonaId(): number {
  return _activePersonaId;
}

export function PersonaProvider({ children }: { children: ReactNode }) {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [activeId, setActiveId] = useState(_activePersonaId);

  const refreshPersonas = async () => {
    const res = await fetch("/api/personas");
    if (res.ok) {
      const data = await res.json();
      setPersonas(data.personas);
      if (!data.personas.find((p: Persona) => p.id === activeId)) {
        const first = data.personas[0];
        if (first) {
          setActiveId(first.id);
          _activePersonaId = first.id;
          localStorage.setItem("reachlab_active_persona_id", String(first.id));
        }
      }
    }
  };

  useEffect(() => { refreshPersonas(); }, []);

  const switchPersona = (id: number) => {
    setActiveId(id);
    _activePersonaId = id;
    localStorage.setItem("reachlab_active_persona_id", String(id));
    window.location.reload();
  };

  const active = personas.find((p) => p.id === activeId) ?? personas[0] ?? null;

  return (
    <PersonaContext.Provider value={{ personas, active, switchPersona, refreshPersonas }}>
      {children}
    </PersonaContext.Provider>
  );
}
