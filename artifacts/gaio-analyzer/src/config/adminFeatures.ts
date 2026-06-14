export const ADMIN_FEATURES = [
  { id: "nutzerverwaltung",  label: "Nutzerverwaltung",   icon: "Users",             defaultRoles: ["admin"] },
  { id: "analyseprotokoll",  label: "Analyseprotokoll",   icon: "ClipboardList",     defaultRoles: ["admin"] },
  { id: "geteilte_analysen", label: "Geteilte Analysen",  icon: "Share2",            defaultRoles: ["admin"] },
  { id: "angebots_creator",  label: "Angebots-Creator",   icon: "FileText",          defaultRoles: ["admin"] },
  { id: "versand_analyse",   label: "Versand-Analyse",    icon: "Send",              defaultRoles: ["admin"] },
  { id: "erscheinungsbild",  label: "Erscheinungsbild",   icon: "Palette",           defaultRoles: ["admin"] },
  { id: "kontakt_daten",     label: "Kontakt-Daten",      icon: "ContactRound",      defaultRoles: ["admin"] },
  { id: "rechtemanagement",  label: "Rechtemanagement",   icon: "ShieldCheck",       defaultRoles: ["admin"] },
  { id: "prompt_verwaltung", label: "Prompt-Verwaltung",  icon: "MessageSquareCode", defaultRoles: ["admin"] },
  { id: "ki_tool",           label: "KI-Tool",            icon: "Cpu",               defaultRoles: ["admin"] },
  { id: "textverwaltung",    label: "Textverwaltung",     icon: "Languages",         defaultRoles: ["admin"] },
  { id: "mailserver",        label: "Server",             icon: "Server",            defaultRoles: ["admin"] },
  { id: "user",        label: "User (Gruppe)",              icon: "Users",        defaultRoles: ["admin"], isGroup: true },
  { id: "analysen",    label: "Analysen (Gruppe)",          icon: "BarChart2",    defaultRoles: ["admin"], isGroup: true },
  { id: "darstellung", label: "Darstellung (Gruppe)",       icon: "Palette",      defaultRoles: ["admin"], isGroup: true },
  { id: "llm",         label: "LLM-Einstellungen (Gruppe)", icon: "BrainCircuit", defaultRoles: ["admin"], isGroup: true },
] as const;

export const ADMIN_NAV_GROUPS = [
  {
    id: "user",
    label: "User",
    icon: "Users",
    items: ["nutzerverwaltung", "rechtemanagement"] as const,
  },
  {
    id: "analysen",
    label: "Analysen",
    icon: "BarChart2",
    items: ["analyseprotokoll", "geteilte_analysen", "angebots_creator", "versand_analyse"] as const,
  },
  {
    id: "darstellung",
    label: "Darstellung",
    icon: "Palette",
    items: ["erscheinungsbild", "kontakt_daten", "textverwaltung"] as const,
  },
  {
    id: "llm",
    label: "LLM-Einstellungen",
    icon: "BrainCircuit",
    items: ["prompt_verwaltung", "ki_tool"] as const,
  },
] as const;

export type FeatureId = typeof ADMIN_FEATURES[number]["id"];
