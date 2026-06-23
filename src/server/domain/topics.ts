export interface TopicDefinition {
  key: string;
  label: string;
  keywords: string[];
}

export const TOPICS: TopicDefinition[] = [
  { key: "dorm", label: "宿舍", keywords: ["宿舍", "寝室", "上床下桌", "上下铺", "床位", "四人寝", "六人寝", "住宿"] },
  { key: "bathroom", label: "卫浴澡堂", keywords: ["独卫", "卫浴", "浴室", "澡堂", "洗澡", "热水", "淋浴"] },
  { key: "air_conditioning", label: "空调", keywords: ["空调", "制冷", "制热"] },
  { key: "study_schedule", label: "早晚自习", keywords: ["早自习", "晚自习", "早八", "晚课", "早读", "自习", "管得严"] },
  { key: "running", label: "晨跑跑步", keywords: ["晨跑", "跑操", "跑步", "打卡", "乐跑", "校园跑", "体育"] },
  { key: "vacation", label: "假期小学期", keywords: ["寒假", "暑假", "小学期", "假期", "放假"] },
  { key: "delivery", label: "外卖", keywords: ["外卖", "取餐", "点餐", "送到宿舍", "校门口"] },
  { key: "transport", label: "交通", keywords: ["地铁", "公交", "交通", "车站", "校车"] },
  { key: "laundry", label: "洗衣", keywords: ["洗衣机", "洗衣", "烘干"] },
  { key: "network", label: "校园网", keywords: ["校园网", "网速", "网络", "断网", "宽带", "流量", "wifi", "Wi-Fi"] },
  { key: "electricity", label: "断电限电", keywords: ["断电", "限电", "电费", "功率", "电器", "熄灯"] },
  { key: "food", label: "食堂", keywords: ["食堂", "饭堂", "饭菜", "价格", "吃饭", "异物"] },
  { key: "ebike", label: "电瓶车", keywords: ["电瓶车", "电动车", "充电", "骑车"] },
  { key: "study_room", label: "自习室", keywords: ["通宵自习", "自习室", "图书馆", "通宵"] },
  { key: "computer", label: "电脑", keywords: ["电脑", "笔记本", "大一", "带电脑"] },
  { key: "payment", label: "校园卡支付", keywords: ["校园卡", "饭卡", "消费", "一卡通", "支付"] },
  { key: "bank", label: "银行卡", keywords: ["银行卡", "银行"] },
  { key: "market", label: "超市", keywords: ["超市", "商店", "便利店"] },
  { key: "package", label: "快递", keywords: ["快递", "收发", "驿站", "菜鸟"] },
  { key: "bike_share", label: "共享单车", keywords: ["共享单车", "单车", "自行车"] },
  { key: "access_control", label: "门禁查寝", keywords: ["门禁", "查寝", "封寝", "晚归", "出入校", "进出校"] }
];

export function detectTopics(text: string): TopicDefinition[] {
  const normalized = text.toLowerCase();
  const hits = TOPICS.filter((topic) =>
    topic.keywords.some((keyword) => normalized.includes(keyword.toLowerCase()))
  );
  return hits.length ? hits : [];
}

export function topicForQuestion(question: string): TopicDefinition {
  return detectTopics(question)[0] ?? { key: "general", label: "综合", keywords: [] };
}

export function topicLabel(key: string): string {
  return TOPICS.find((topic) => topic.key === key)?.label ?? "综合";
}

