'use client';

import React, { useState } from 'react';

// Product name to emoji or image mapping logic
export function getProductVisual(name: string): { type: 'emoji' | 'image'; value: string; fallback: string } {
  const n = (name || '').toLowerCase().trim();

  // 1. Uploaded Image Mappings (exact sequence matched from user prompt)
  if (n.includes('lady finger') || n.includes('okra') || n.includes('bhindi') || n === 'ladyfinger') {
    return { type: 'image', value: '/ladyfinger.png', fallback: '🫛' };
  }
  if (n.includes('guava') || n.includes('amrood')) {
    return { type: 'image', value: '/guava.png', fallback: '🍏' };
  }
  if (n.includes('papaya') || n.includes('papeeta') || n.includes('papiya')) {
    return { type: 'image', value: '/papaya.png', fallback: '🍈' };
  }
  if (n.includes('pomegranate') || n.includes('anar')) {
    return { type: 'image', value: '/pomegranate.png', fallback: '🍎' };
  }
  if (n.includes('turnip') || n.includes('shalgam')) {
    return { type: 'image', value: '/turnip.png', fallback: '🫜' };
  }
  if (n.includes('radish') || n.includes('mooli')) {
    return { type: 'image', value: '/radish.png', fallback: '🫜' };
  }
  if (n.includes('beetroot') || n.includes('chukandar')) {
    return { type: 'image', value: '/beetroot.png', fallback: '🫜' };
  }
  if (n.includes('plum') || n.includes('alobukhara') || n.includes('alubukhara')) {
    return { type: 'image', value: '/plum.png', fallback: '🍑' };
  }

  // 2. Standardized Emojis according to the user's list
  // Vegetables:
  if (n.includes('beans') || n.includes('phali')) return { type: 'emoji', value: '🫘', fallback: '🫘' };
  if (n.includes('bitter') || n.includes('karela')) return { type: 'emoji', value: '🥒', fallback: '🥒' };
  if (n.includes('bottle') || n.includes('lauki') || n.includes('ghia') || n.includes('gourd')) return { type: 'emoji', value: '🥒', fallback: '🥒' };
  if (n.includes('brinjal') || n.includes('baingan') || n.includes('eggplant')) return { type: 'emoji', value: '🍆', fallback: '🍆' };
  if (n.includes('broccoli')) return { type: 'emoji', value: '🥦', fallback: '🥦' };
  if (n.includes('cabbage') || n.includes('gobhi') || n.includes('gobi')) return { type: 'emoji', value: '🥬', fallback: '🥬' };
  if (n.includes('capsicum') || n.includes('shimla')) return { type: 'emoji', value: '🫑', fallback: '🫑' };
  if (n.includes('carrot') || n.includes('gajar')) return { type: 'emoji', value: '🥕', fallback: '🥕' };
  if (n.includes('cauliflower')) return { type: 'emoji', value: '🥦', fallback: '🥦' };
  if (n.includes('coriander') || n.includes('dhaniya')) return { type: 'emoji', value: '🌿', fallback: '🌿' };
  if (n.includes('corn') || n.includes('makai') || n.includes('bhutta')) return { type: 'emoji', value: '🌽', fallback: '🌽' };
  if (n.includes('cucumber') || n.includes('kheera')) return { type: 'emoji', value: '🥒', fallback: '🥒' };
  if (n.includes('garlic') || n.includes('lehsun')) return { type: 'emoji', value: '🧄', fallback: '🧄' };
  if (n.includes('ginger') || n.includes('adrak')) return { type: 'emoji', value: '🫚', fallback: '🫚' };
  if (n.includes('green chilli') || n.includes('green chili') || n.includes('hari mirch')) return { type: 'emoji', value: '🌶️', fallback: '🌶️' };
  if (n.includes('chilli') || n.includes('chili') || n.includes('mirch')) return { type: 'emoji', value: '🌶️', fallback: '🌶️' };
  if (n.includes('iceberg')) return { type: 'emoji', value: '🥬', fallback: '🥬' };
  if (n.includes('lemon') || n.includes('limo') || n.includes('nimbu')) return { type: 'emoji', value: '🍋', fallback: '🍋' };
  if (n.includes('lettuce')) return { type: 'emoji', value: '🥬', fallback: '🥬' };
  if (n.includes('mint') || n.includes('pudina')) return { type: 'emoji', value: '🌿', fallback: '🌿' };
  if (n.includes('mushroom')) return { type: 'emoji', value: '🍄', fallback: '🍄' };
  if (n.includes('onion') || n.includes('piaz') || n.includes('pyaz')) return { type: 'emoji', value: '🧅', fallback: '🧅' };
  if (n.includes('peas') || n.includes('matar')) return { type: 'emoji', value: '🫛', fallback: '🫛' };
  if (n.includes('potato') || n.includes('aloo')) return { type: 'emoji', value: '🥔', fallback: '🥔' };
  if (n.includes('pumpkin') || n.includes('kaddu')) return { type: 'emoji', value: '🎃', fallback: '🎃' };
  if (n.includes('spinach') || n.includes('palak')) return { type: 'emoji', value: '🥬', fallback: '🥬' };
  if (n.includes('sweet potato') || n.includes('shakarkandi')) return { type: 'emoji', value: '🍠', fallback: '🍠' };
  if (n.includes('tomato') || n.includes('tamatar')) return { type: 'emoji', value: '🍅', fallback: '🍅' };

  // Fruits:
  if (n.includes('apple') || n.includes('seeb')) return { type: 'emoji', value: '🍎', fallback: '🍎' };
  if (n.includes('banana') || n.includes('kela')) return { type: 'emoji', value: '🍌', fallback: '🍌' };
  if (n.includes('grapes') || n.includes('angoor')) return { type: 'emoji', value: '🍇', fallback: '🍇' };
  if (n.includes('mango') || n.includes('aam')) return { type: 'emoji', value: '🥭', fallback: '🥭' };
  if (n.includes('melon') || n.includes('kharbooza')) return { type: 'emoji', value: '🍈', fallback: '🍈' };
  if (n.includes('orange') || n.includes('malta') || n.includes('kinnow')) return { type: 'emoji', value: '🍊', fallback: '🍊' };
  if (n.includes('peach') || n.includes('aaroo')) return { type: 'emoji', value: '🍑', fallback: '🍑' };
  if (n.includes('pear') || n.includes('nashpati')) return { type: 'emoji', value: '🍐', fallback: '🍐' };
  if (n.includes('watermelon') || n.includes('tarbooz')) return { type: 'emoji', value: '🍉', fallback: '🍉' };

  return { type: 'emoji', value: '🥬', fallback: '🥬' };
}

interface ProductVisualProps {
  name: string;
  emoji?: string | null;
  imageUrl?: string | null;
  size?: number;
  loading?: 'lazy' | 'eager';
  style?: React.CSSProperties;
  className?: string;
}

export function ProductVisual({ name, emoji, imageUrl, size = 22, loading = 'lazy', style, className }: ProductVisualProps) {
  const [masterImgError, setMasterImgError] = useState(false);
  const [staticImgError, setStaticImgError] = useState(false);

  // Reset imgError whenever the imageUrl or name prop changes
  React.useEffect(() => {
    setMasterImgError(false);
    setStaticImgError(false);
  }, [imageUrl, name]);

  // 1. Highest Priority: Uploaded Image from Product Master (imageUrl)
  if (imageUrl && imageUrl.trim() && !masterImgError) {
    const rawUrl = imageUrl.trim();
    // Normalize URL to ensure it routes through API proxy if needed
    const finalUrl = rawUrl.startsWith('/uploads/products/')
      ? `/api/products/image/${rawUrl.replace('/uploads/products/', '')}`
      : rawUrl;

    return (
      <img
        src={finalUrl}
        alt={name}
        width={size}
        height={size}
        loading={loading}
        decoding="async"
        onError={() => setMasterImgError(true)}
        style={{
          width: size,
          height: size,
          aspectRatio: '1 / 1',
          objectFit: 'cover',
          borderRadius: size > 30 ? 6 : 4,
          display: 'inline-block',
          verticalAlign: 'middle',
          ...style
        }}
        className={className}
      />
    );
  }

  // 2. Second Priority: Pre-mapped static image assets
  const visual = getProductVisual(name);
  if (visual.type === 'image' && !staticImgError) {
    return (
      <img
        src={visual.value}
        alt={name}
        width={size}
        height={size}
        loading={loading}
        decoding="async"
        onError={() => setStaticImgError(true)}
        style={{
          width: size,
          height: size,
          aspectRatio: '1 / 1',
          objectFit: 'cover',
          borderRadius: size > 30 ? 6 : 4,
          display: 'inline-block',
          verticalAlign: 'middle',
          ...style
        }}
        className={className}
      />
    );
  }

  // 3. Third Priority: Explicit Product Master Emoji
  if (emoji && emoji.trim()) {
    return (
      <span
        style={{
          fontSize: size,
          lineHeight: 1,
          display: 'inline-block',
          verticalAlign: 'middle',
          direction: 'ltr',
          unicodeBidi: 'isolate',
          fontFamily: '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Segoe UI Symbol", sans-serif',
          ...style
        }}
        className={className}
      >
        {emoji.trim()}
      </span>
    );
  }

  // 4. Fallback to standard emoji
  return (
    <span
      style={{
        fontSize: size,
        lineHeight: 1,
        display: 'inline-block',
        verticalAlign: 'middle',
        direction: 'ltr',
        unicodeBidi: 'isolate',
        fontFamily: '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Segoe UI Symbol", sans-serif',
        ...style
      }}
      className={className}
    >
      {visual.type === 'image' ? visual.fallback : visual.value}
    </span>
  );
}
