// ============================================================
// 银行卡品牌图标（本地 SVG，无外链）— BankApp 卡面渲染
// src 取 utils/bankIcons bankIconSrc()；brand 缺省返回 null 不渲染
// ============================================================
import React from 'react';
import { bankIconSrc } from '../utils/bankIcons';

export default function BankBrandIcon({ brand, className, size = 32 }: { brand?: string; className?: string; size?: number }) {
  const src = bankIconSrc(brand);
  if (!src) return null;
  return (
    <img
      src={src}
      alt={brand || ''}
      width={size}
      height={size}
      className={className}
      style={{ objectFit: 'contain' }}
      loading="lazy"
      draggable={false}
    />
  );
}
