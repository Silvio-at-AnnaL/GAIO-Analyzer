export const ADMIN_FEATURES = [
  { id: "nutzerverwaltung",  label: "nav.admin_nutzerverwaltung",   icon: "Users",             defaultRoles: ["admin"] },
  { id: "analyseprotokoll",  label: "nav.admin_analyseprotokoll",   icon: "ClipboardList",     defaultRoles: ["admin"] },
  { id: "geteilte_analysen", label: "nav.admin_geteilte_analysen",  icon: "Share2",            defaultRoles: ["admin"] },
  { id: "angebots_creator",  label: "nav.admin_angebots_creator",   icon: "FileText",          defaultRoles: ["admin"] },
  { id: "versand_analyse",   label: "nav.admin_versand_analyse",    icon: "Send",              defaultRoles: ["admin"] },
  { id: "erscheinungsbild",  label: "nav.admin_erscheinungsbild",   icon: "Palette",           defaultRoles: ["admin"] },
  { id: "kontakt_daten",     label: "nav.admin_kontakt_daten",      icon: "ContactRound",      defaultRoles: ["admin"] },
  { id: "rechtemanagement",  label: "nav.admin_rechtemanagement",   icon: "ShieldCheck",       defaultRoles: ["admin"] },
  { id: "prompt_verwaltung", label: "nav.admin_prompt_verwaltung",  icon: "MessageSquareCode", defaultRoles: ["admin"] },
  { id: "ki_tool",           label: "nav.admin_ki_tool",            icon: "Cpu",               defaultRoles: ["admin"] },
  { id: "textverwaltung",    label: "nav.admin_textverwaltung",     icon: "Languages",         defaultRoles: ["admin"] },
  { id: "mailserver",        label: "nav.server",                   icon: "Server",            defaultRoles: ["admin"] },
  { id: "user",        label: "nav.admin_feat_group_user",       icon: "Users",        defaultRoles: ["admin"], isGroup: true },
  { id: "analysen",    label: "nav.admin_feat_group_analysen",   icon: "BarChart2",    defaultRoles: ["admin"], isGroup: true },
  { id: "darstellung", label: "nav.admin_feat_group_darstellung",icon: "Palette",      defaultRoles: ["admin"], isGroup: true },
  { id: "llm",         label: "nav.admin_feat_group_llm",        icon: "BrainCircuit", defaultRoles: ["admin"], isGroup: true },
] as const;

export const ADMIN_NAV_GROUPS = [
  {
    id: "user",
    label: "nav.admin_grp_user",
    icon: "Users",
    items: ["nutzerverwaltung", "rechtemanagement"] as const,
  },
  {
    id: "analysen",
    label: "nav.admin_grp_analysen",
    icon: "BarChart2",
    items: ["analyseprotokoll", "geteilte_analysen", "angebots_creator", "versand_analyse"] as const,
  },
  {
    id: "darstellung",
    label: "nav.admin_grp_darstellung",
    icon: "Palette",
    items: ["erscheinungsbild", "kontakt_daten", "textverwaltung"] as const,
  },
  {
    id: "llm",
    label: "nav.admin_grp_llm",
    icon: "BrainCircuit",
    items: ["prompt_verwaltung", "ki_tool"] as const,
  },
] as const;

export type FeatureId = typeof ADMIN_FEATURES[number]["id"];
