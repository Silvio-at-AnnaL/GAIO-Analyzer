export const ADMIN_FEATURES = [
  { id: "nutzerverwaltung",  label: "Nutzerverwaltung",   icon: "Users",        defaultRoles: ["admin"] },
  { id: "analyseprotokoll",  label: "Analyseprotokoll",   icon: "ClipboardList",defaultRoles: ["admin"] },
  { id: "geteilte_analysen",  label: "Geteilte Analysen",  icon: "Share2",       defaultRoles: ["admin"] },
  { id: "angebots_creator",  label: "Angebots-Creator",   icon: "FileText",     defaultRoles: ["admin"] },
  { id: "erscheinungsbild",  label: "Erscheinungsbild",   icon: "Palette",      defaultRoles: ["admin"] },
  { id: "kontakt_daten",     label: "Kontakt-Daten",      icon: "ContactRound", defaultRoles: ["admin"] },
  { id: "rechtemanagement",  label: "Rechtemanagement",   icon: "ShieldCheck",  defaultRoles: ["admin"] },
  { id: "ki_tool",           label: "KI-Tool",            icon: "Cpu",          defaultRoles: ["admin"] },
  { id: "mailserver",        label: "Server",             icon: "Server",       defaultRoles: ["admin"] },
  { id: "versand_analyse",   label: "Versand-Analyse",    icon: "Send",         defaultRoles: ["admin"] },
] as const;

export type FeatureId = typeof ADMIN_FEATURES[number]["id"];
