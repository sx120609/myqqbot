export const GAOKAO_PROVINCES = [
  ["11", "北京"],
  ["12", "天津"],
  ["13", "河北"],
  ["14", "山西"],
  ["15", "内蒙古"],
  ["21", "辽宁"],
  ["22", "吉林"],
  ["23", "黑龙江"],
  ["31", "上海"],
  ["32", "江苏"],
  ["33", "浙江"],
  ["34", "安徽"],
  ["35", "福建"],
  ["36", "江西"],
  ["37", "山东"],
  ["41", "河南"],
  ["42", "湖北"],
  ["43", "湖南"],
  ["44", "广东"],
  ["45", "广西"],
  ["46", "海南"],
  ["50", "重庆"],
  ["51", "四川"],
  ["52", "贵州"],
  ["53", "云南"],
  ["54", "西藏"],
  ["61", "陕西"],
  ["62", "甘肃"],
  ["63", "青海"],
  ["64", "宁夏"],
  ["65", "新疆"]
] as const;

export const GAOKAO_SUBJECT_TYPES = [
  { id: "2073", name: "物理类" },
  { id: "2074", name: "历史类" },
  { id: "1", name: "理科" },
  { id: "2", name: "文科" },
  { id: "3", name: "综合改革" }
] as const;

const COMPREHENSIVE_REFORM_PROVINCES = new Set(["北京", "天津", "上海", "浙江", "山东", "海南"]);
const TRADITIONAL_PROVINCES = new Set(["西藏", "新疆"]);
const THIRD_BATCH_3_1_2_PROVINCES = new Set(["河北", "辽宁", "江苏", "福建", "湖北", "湖南", "广东", "重庆"]);
const FOURTH_BATCH_3_1_2_PROVINCES = new Set(["吉林", "黑龙江", "安徽", "江西", "广西", "贵州", "甘肃"]);
const FIFTH_BATCH_3_1_2_PROVINCES = new Set(["山西", "内蒙古", "河南", "四川", "云南", "陕西", "青海", "宁夏"]);

export function gaokaoProvinceNames(): string[] {
  return GAOKAO_PROVINCES.map(([, name]) => name);
}

export function defaultAdmissionSubjectTypeNamesForProvinceYear(provinceName: string, year: number): string[] {
  const province = normalizeGaokaoProvinceName(provinceName);
  if (COMPREHENSIVE_REFORM_PROVINCES.has(province)) return ["综合改革"];
  if (TRADITIONAL_PROVINCES.has(province)) return ["理科", "文科"];
  if (THIRD_BATCH_3_1_2_PROVINCES.has(province)) return ["物理类", "历史类"];
  if (FOURTH_BATCH_3_1_2_PROVINCES.has(province)) return year >= 2024 ? ["物理类", "历史类"] : ["理科", "文科"];
  if (FIFTH_BATCH_3_1_2_PROVINCES.has(province)) return year >= 2025 ? ["物理类", "历史类"] : ["理科", "文科"];
  return ["理科", "文科"];
}

function normalizeGaokaoProvinceName(value: string): string {
  return value
    .trim()
    .replace(/省$/u, "")
    .replace(/市$/u, "")
    .replace(/壮族自治区$/u, "")
    .replace(/回族自治区$/u, "")
    .replace(/维吾尔自治区$/u, "")
    .replace(/自治区$/u, "");
}
