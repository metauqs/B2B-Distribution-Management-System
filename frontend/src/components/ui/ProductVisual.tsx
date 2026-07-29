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
  size?: number;
  style?: React.CSSProperties;
  className?: string;
}

export function ProductVisual({ name, size = 22, style, className }: ProductVisualProps) {
  const visual = getProductVisual(name);
  const [hasError, setHasError] = useState(false);

  if (visual.type === 'image' && !hasError) {
    return (
      <img
        src={visual.value}
        alt={name}
        onError={() => setHasError(true)}
        style={{
          width: size,
          height: size,
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

  // Fallback to emoji
  return (
    <span
      style={{
        fontSize: size,
        lineHeight: 1,
        display: 'inline-block',
        verticalAlign: 'middle',
        fontFamily: '"Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", sans-serif',
        ...style
      }}
      className={className}
    >
      {visual.type === 'image' ? visual.fallback : visual.value}
    </span>
  );
}
