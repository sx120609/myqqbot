export interface TopicDefinition {
  key: string;
  label: string;
}

export const TOPICS: TopicDefinition[] = [
  { key: "dorm", label: "宿舍" },
  { key: "bathroom", label: "卫浴澡堂" },
  { key: "air_conditioning", label: "空调" },
  { key: "study_schedule", label: "早晚自习" },
  { key: "running", label: "晨跑跑步" },
  { key: "vacation", label: "假期小学期" },
  { key: "delivery", label: "外卖" },
  { key: "transport", label: "交通" },
  { key: "laundry", label: "洗衣" },
  { key: "network", label: "校园网" },
  { key: "electricity", label: "断电限电" },
  { key: "food", label: "食堂" },
  { key: "ebike", label: "电瓶车" },
  { key: "study_room", label: "自习室" },
  { key: "computer", label: "电脑" },
  { key: "payment", label: "校园卡支付" },
  { key: "bank", label: "银行卡" },
  { key: "market", label: "超市" },
  { key: "package", label: "快递" },
  { key: "bike_share", label: "共享单车" },
  { key: "access_control", label: "门禁查寝" }
];

export function topicLabel(key: string): string {
  return TOPICS.find((topic) => topic.key === key)?.label ?? "综合";
}
