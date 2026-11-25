export interface AvatarPreset {
  readonly iconName: string;
  readonly label: string;
}

export const AVATAR_PRESETS: readonly AvatarPreset[] = [
  { iconName: "Crown", label: "总管" },
  { iconName: "Sparkles", label: "陪伴" },
  { iconName: "Compass", label: "领航" },
  { iconName: "Code2", label: "研发" },
  { iconName: "PenTool", label: "设计" },
  { iconName: "Brain", label: "思考" },
  { iconName: "FolderKanban", label: "统筹" },
  { iconName: "ShieldCheck", label: "审查" },
  { iconName: "Terminal", label: "终端" },
  { iconName: "Radar", label: "巡检" },
  { iconName: "BookOpen", label: "记忆" },
  { iconName: "Cpu", label: "执行" },
];

export const CONTRAST_PALETTE: readonly string[] = [
  "#3B66F5",
  "#0F766E",
  "#B45309",
  "#6D28D9",
  "#BE185D",
  "#1D4ED8",
  "#047857",
  "#9333EA",
  "#C2410C",
  "#0369A1",
];

export function pickNextColor(usedColors: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const hex of CONTRAST_PALETTE) counts.set(hex, 0);
  for (const used of usedColors) {
    if (counts.has(used)) counts.set(used, (counts.get(used) ?? 0) + 1);
  }
  let best = CONTRAST_PALETTE[0];
  let bestCount = Number.POSITIVE_INFINITY;
  for (const hex of CONTRAST_PALETTE) {
    const count = counts.get(hex) ?? 0;
    if (count < bestCount) {
      best = hex;
      bestCount = count;
    }
  }
  return best;
}

export function roleLabel(roleType: "companion" | "butler" | "project_lead"): string {
  if (roleType === "butler") return "总管";
  if (roleType === "companion") return "陪伴";
  return "项目主管";
}
