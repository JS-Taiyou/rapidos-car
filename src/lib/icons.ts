// Galería de iconos preset para el logo del tenant (Ajustes → Apariencia).
// ~24 opciones en 4 categorías; cada path vive en un viewBox 0 0 24 24 y se
// rellena con el color elegido. Añadir uno = una línea acá.
export interface IconDef {
  id: string;
  label: string;
  category: 'negocio' | 'movilidad' | 'viaje' | 'general';
  path: string;
}

export const ICON_GALLERY: IconDef[] = [
  // Negocio / renta
  { id: 'bolt', label: 'Rayo', category: 'negocio', path: 'M13 2 4.5 13.5H11L9.5 22 19 10h-6.5L13 2Z' },
  { id: 'car', label: 'Auto', category: 'negocio', path: 'M5 11l1.5-4.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11m-14 0h14a2 2 0 0 1 2 2v4a1 1 0 0 1-1 1h-1a2 2 0 1 1-4 0H9a2 2 0 1 1-4 0H4a1 1 0 0 1-1-1v-4a2 2 0 0 1 2-2Z' },
  { id: 'key', label: 'Llave', category: 'negocio', path: 'M14 7a4 4 0 1 1-3.5 5.9L4 19.4V21H2v-2l6.1-6.5A4 4 0 0 1 14 7Z' },
  { id: 'steering', label: 'Volante', category: 'negocio', path: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 2a8 8 0 0 1 7.9 7H14a2 2 0 0 0-4 0H4.1A8 8 0 0 1 12 4Zm-2.9 9a6 6 0 0 0 2.5 4.6L10 20.9A8 8 0 0 1 4.3 13H9.1Zm4.9 4.6A6 6 0 0 0 16.7 13h4A8 8 0 0 1 14 20.9l.1-2.3Z' },
  { id: 'tag', label: 'Etiqueta', category: 'negocio', path: 'M3 3h8l10 10-8 8L3 11V3Zm4 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z' },
  { id: 'shop', label: 'Tienda', category: 'negocio', path: 'M4 4h16l1 5a3 3 0 0 1-3 3 3 3 0 0 1-2.5 3A3 3 0 0 1 12 17a3 3 0 0 1-3.5-2A3 3 0 0 1 6 12a3 3 0 0 1-3-3l1-5Zm1 10v6h14v-6' },
  { id: 'badge', label: 'Escudo', category: 'negocio', path: 'M12 2 4 5v6c0 5 3.4 9.3 8 11 4.6-1.7 8-6 8-11V5l-8-3Z' },
  { id: 'star', label: 'Estrella', category: 'negocio', path: 'M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17l-6.1 3.6 1.4-6.8L2.2 9.1l6.9-.8L12 2Z' },

  // Movilidad
  { id: 'van', label: 'Van', category: 'movilidad', path: 'M2 6h12a2 2 0 0 1 2 2v2h2.6a2 2 0 0 1 1.7 1l1.4 2.4a2 2 0 0 1 .3 1V16a1 1 0 0 1-1 1h-1a2 2 0 1 1-4 0H8a2 2 0 1 1-4 0H3a1 1 0 0 1-1-1V6Zm2 2v5h10V8H4Z' },
  { id: 'road', label: 'Carretera', category: 'movilidad', path: 'M11 2h2v20h-2V2ZM4 4l1.5 16h-2L2 4h2Zm16 0 1.5 16h-2L18 4h2Z' },
  { id: 'gauge', label: 'Velocímetro', category: 'movilidad', path: 'M12 4a9 9 0 0 0-9 9 8.9 8.9 0 0 0 2 5.6A2 2 0 0 0 6.6 20h10.8a2 2 0 0 0 1.6-.4A8.9 8.9 0 0 0 21 13a9 9 0 0 0-9-9Zm4.4 6.4-4.9 3.7a1 1 0 0 0 1.2 1.6l4.9-3.7a5 5 0 1 1-1.2-1.6Z' },
  { id: 'fuel', label: 'Gasolina', category: 'movilidad', path: 'M5 3h8a2 2 0 0 1 2 2v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a2 2 0 0 1 2-2Zm0 3v4h8V6H5Zm12 3 2.4 2.4a3 3 0 0 1 .6 3.4V18a2 2 0 1 1-4 0v-5h1l-1.5-4H17Z' },
  { id: 'wrench', label: 'Llave inglesa', category: 'movilidad', path: 'M21 6.5a5 5 0 0 1-6.6 6.1L7 20a2.1 2.1 0 0 1-3-3l7.4-7.4A5 5 0 0 1 17.5 3L14 6.5 17.5 10 21 6.5Z' },
  { id: 'helmet', label: 'Casco', category: 'movilidad', path: 'M12 3a9 9 0 0 0-9 9v3a2 2 0 0 0 2 2h1v-6h12v6h1a2 2 0 0 0 2-2v-3a9 9 0 0 0-9-9Z' },

  // Viaje
  { id: 'pin', label: 'Pin', category: 'viaje', path: 'M12 21s-7-5.3-7-11a7 7 0 1 1 14 0c0 5.7-7 11-7 11Zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z' },
  { id: 'plane', label: 'Avión', category: 'viaje', path: 'M21 15v-2l-8-4V4a1.5 1.5 0 0 0-3 0v5l-8 4v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-6.5L21 15Z' },
  { id: 'compass', label: 'Brújula', category: 'viaje', path: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm3.5 5.5-2.1 5.9-5.9 2.1 2.1-5.9 5.9-2.1Z' },
  { id: 'map', label: 'Mapa', category: 'viaje', path: 'M9 3 3 5v16l6-2 6 2 6-2V3l-6 2-6-2Zm0 2.2 4 1.3v12.3l-4-1.3V5.2Z' },
  { id: 'suitcase', label: 'Maleta', category: 'viaje', path: 'M8 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm0 2v14h8V5H8ZM9 1h6v2H9V1ZM2 9h2v8H2V9Zm18 0h2v8h-2V9Z' },
  { id: 'sun', label: 'Sol', category: 'viaje', path: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0-6 1.5 3.5L12 6l-1.5-1.5L12 1Zm0 17 1.5 3.5L12 23l-1.5-1.5L12 18ZM1 12l3.5-1.5L6 12l-1.5 1.5L1 12Zm17 0 3.5-1.5L23 12l-1.5 1.5L18 12ZM4.2 4.2l3.5 1.5.6 2-2-.6L4.2 4.2Zm12.1 12.1 3.5 1.5-2.1 2.1-1.5-3.5.1-.1Z' },
  { id: 'palm', label: 'Palmera', category: 'viaje', path: 'M12 22v-8m0 0c-3 0-5-1-5-4 0-1.5.8-3 2-4-1.5.5-3 1.8-3 4 0 1 .3 1.9.9 2.6C5.3 11.4 4 9.5 4 7c0-1.7 1-3.4 2.6-4.2C7.3 4 8.7 5.4 9.6 7.1c.6-1.9 1.3-3.6 2.4-5.1 1.1 1.5 1.8 3.2 2.4 5.1.9-1.7 2.3-3.1 3-4.3C19 3.6 20 5.3 20 7c0 2.5-1.3 4.4-2.9 5.6.6-.7.9-1.6.9-2.6 0-2.2-1.5-3.5-3-4 1.2 1 2 2.5 2 4 0 3-2 4-5 4Z' },
  { id: 'wave', label: 'Ola', category: 'viaje', path: 'M2 12c2 0 3-1.5 5-1.5S9 12 12 12s3-1.5 5-1.5S19 12 22 12v3c-3 0-3-1.5-5-1.5S14 15 12 15s-3-1.5-5-1.5S5 15 2 15v-3Zm0 6c2 0 3-1.5 5-1.5S9 18 12 18s3-1.5 5-1.5S19 18 22 18v2c-3 0-3-1.5-5-1.5S14 20 12 20s-3-1.5-5-1.5S5 20 2 20v-2ZM6 3c1.5 0 2.5 1 2.5 2.5S7.5 8 6 8 3.5 7 3.5 5.5 4.5 3 6 3Z' },

  // General
  { id: 'heart', label: 'Corazón', category: 'general', path: 'M12 21S3 14.7 3 8.6C3 5.5 5.4 3 8.4 3c1.5 0 2.8.7 3.6 1.8A4.5 4.5 0 0 1 15.6 3C18.6 3 21 5.5 21 8.6 21 14.7 12 21 12 21Z' },
  { id: 'check', label: 'Palomita', category: 'general', path: 'M9 16.2 4.8 12l-1.5 1.5L9 19.2 20.7 7.5 19.2 6 9 16.2Z' },
  { id: 'clock', label: 'Reloj', category: 'general', path: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 5h-2v6l5 3 1-1.7-4-2.4V7Z' },
  { id: 'crown', label: 'Corona', category: 'general', path: 'M3 7l4 4 5-7 5 7 4-4v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z' },
  { id: 'flame', label: 'Flama', category: 'general', path: 'M12 22c-4 0-7-2.8-7-6.5C5 11 8 9 9.5 5.5c.8 1.5 1 2.7.5 4.5C11.5 8.5 13 5 13 2c3 2.5 6 6.5 6 11 0 5-3 9-7 9Z' },
  { id: 'diamond', label: 'Diamante', category: 'general', path: 'M6 3h12l4 6-10 12L2 9l4-6Z' },
  { id: 'leaf', label: 'Hoja', category: 'general', path: 'M5 21c-1-6 2-13 8-16 5-2.5 8-2 8-2s.5 3-2 8c-3 6-10 9-16 10h2Z' },
  { id: 'cube', label: 'Cubo', category: 'general', path: 'M12 2 3 7v10l9 5 9-5V7l-9-5Zm0 2.3L18.8 8 12 11.7 5.2 8 12 4.3Z' },
];

export function iconPath(id: string): string {
  return ICON_GALLERY.find((i) => i.id === id)?.path ?? ICON_GALLERY[0].path;
}

export const ICON_CATEGORIES: Array<{ id: IconDef['category']; label: string }> = [
  { id: 'negocio', label: 'Negocio' },
  { id: 'movilidad', label: 'Movilidad' },
  { id: 'viaje', label: 'Viaje' },
  { id: 'general', label: 'General' },
];
