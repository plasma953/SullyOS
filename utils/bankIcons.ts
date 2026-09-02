// ============================================================
// 银行卡品牌 SVG 图标映射 —— public/bank/ 下 21 个本地 SVG（无外链）
// 来源：cellier/bank-icon-cn（国内银行）+ gilbarbara-logos / simple-icons（国际卡组织）
// BANK_ICON_MAP: BankCard.brand → svg 路径；BANK_BRANDS: 添加卡时宫格选择
// ============================================================

export interface BankBrand {
  key: string;        // svg 文件名（public/bank/key.svg）
  label: string;      // 展示名
  color: string;      // 卡面渐变主色（拟真）
  color2: string;     // 渐变辅色
  domestic: boolean;  // 国内/国际分组
}

export const BANK_BRANDS: BankBrand[] = [
  { key: 'icbc', label: '工商银行', color: '#C8102E', color2: '#7A0C1B', domestic: true },
  { key: 'ccb', label: '建设银行', color: '#0066B3', color2: '#003D6B', domestic: true },
  { key: 'abc', label: '农业银行', color: '#00923F', color2: '#00582A', domestic: true },
  { key: 'boc', label: '中国银行', color: '#A6192E', color2: '#63101C', domestic: true },
  { key: 'cmb', label: '招商银行', color: '#E60012', color2: '#8A000B', domestic: true },
  { key: 'bocom', label: '交通银行', color: '#003F8C', color2: '#002654', domestic: true },
  { key: 'psbc', label: '邮储银行', color: '#007A33', color2: '#004A1F', domestic: true },
  { key: 'citic', label: '中信银行', color: '#D40F2A', color2: '#7E0918', domestic: true },
  { key: 'ceb', label: '光大银行', color: '#6E2C8F', color2: '#421A56', domestic: true },
  { key: 'cmbc', label: '民生银行', color: '#0066B2', color2: '#003E6B', domestic: true },
  { key: 'hxb', label: '华夏银行', color: '#E60012', color2: '#8A000B', domestic: true },
  { key: 'cib', label: '兴业银行', color: '#0B5EA8', color2: '#07396B', domestic: true },
  { key: 'spdb', label: '浦发银行', color: '#005CA9', color2: '#00386B', domestic: true },
  { key: 'pab', label: '平安银行', color: '#F58220', color2: '#B54E0F', domestic: true },
  { key: 'cgb', label: '广发银行', color: '#C8102E', color2: '#7A0C1B', domestic: true },
  { key: 'czb', label: '浙商银行', color: '#C8102E', color2: '#7A0C1B', domestic: true },
  { key: 'unionpay', label: '银联', color: '#0165B3', color2: '#004580', domestic: true },
  { key: 'visa', label: 'Visa', color: '#1A1F71', color2: '#0E1133', domestic: false },
  { key: 'mastercard', label: 'MasterCard', color: '#EB001B', color2: '#C70000', domestic: false },
  { key: 'amex', label: 'American Express', color: '#006FCF', color2: '#004A8C', domestic: false },
  { key: 'jcb', label: 'JCB', color: '#0E4C96', color2: '#093167', domestic: false },
];

export const BANK_ICON_MAP: Record<string, BankBrand> = Object.fromEntries(
  BANK_BRANDS.map(b => [b.key, b])
);

export function bankIconSrc(key?: string): string | null {
  if (!key || !BANK_ICON_MAP[key]) return null;
  return `${import.meta.env.BASE_URL}bank/${key}.svg`;
}

export function bankCardGradient(brand?: string): string {
  const b = brand ? BANK_ICON_MAP[brand] : undefined;
  if (!b) return 'linear-gradient(135deg, #5C6BC0 0%, #3949AB 100%)';
  return `linear-gradient(135deg, ${b.color} 0%, ${b.color2} 100%)`;
}
