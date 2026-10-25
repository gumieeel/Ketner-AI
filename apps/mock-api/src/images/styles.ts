/**
 * Стили картинок. Пользователь выбирает стиль из списка, а сервер дописывает к английскому описанию
 * фиксированную подсказку. Текст стиля задаёт только сервер, поэтому через него нельзя обойти проверку
 * запроса: проверяется описание пользователя, а подсказки стилей безопасны.
 */

export interface ImageStyle {
  id: string;
  /** Подсказка для модели (по-английски); пустая — без стиля. */
  prompt: string;
}

export const IMAGE_STYLES: readonly ImageStyle[] = [
  { id: 'none', prompt: '' },
  {
    id: 'whiteboard',
    prompt:
      'whiteboard animation style drawing, black marker line art on a clean white board, simple hand-drawn doodles, a few color accents',
  },
  {
    id: 'anime',
    prompt: 'anime style illustration, clean line art, vibrant cel shading, expressive characters',
  },
  {
    id: 'product',
    prompt:
      'professional product advertising photo, studio lighting, clean gradient background, sharp focus, commercial product shot',
  },
  {
    id: 'cinematic',
    prompt:
      'cinematic film still, dramatic lighting, shallow depth of field, color graded, wide anamorphic shot',
  },
  {
    id: 'cartoon',
    prompt:
      'cartoon style illustration, bold outlines, bright flat colors, playful exaggerated shapes',
  },
  {
    id: 'app-promo',
    prompt:
      'mobile app promotional banner, modern smartphone mockup showing a sleek app interface, clean gradient background, marketing design',
  },
  {
    id: 'comic',
    prompt:
      'comic book style, bold ink outlines, halftone dot shading, dynamic composition, vibrant colors',
  },
  {
    id: 'ugc',
    prompt:
      'authentic user-generated content photo, casual smartphone snapshot, natural everyday lighting, candid and unpolished',
  },
  {
    id: 'photo',
    prompt: 'photorealistic photograph, natural lighting, sharp focus, high detail, shot on 35mm',
  },
  {
    id: 'portrait',
    prompt:
      'professional portrait photography, 85mm lens, soft studio lighting, blurred bokeh background',
  },
  {
    id: 'watercolor',
    prompt: 'watercolor painting, soft color washes, visible paper texture, delicate brush strokes',
  },
  {
    id: 'oil',
    prompt: 'oil painting on canvas, visible brush strokes, rich deep colors, classical fine art',
  },
  {
    id: '3d',
    prompt: '3D render, soft global illumination, smooth detailed materials, studio lighting',
  },
  { id: 'digital', prompt: 'digital painting, concept art, highly detailed, vivid colors' },
  {
    id: 'pixel',
    prompt: 'pixel art, 16-bit retro video game style, limited color palette, crisp pixels',
  },
  {
    id: 'sketch',
    prompt: 'pencil sketch, graphite drawing, hand-drawn lines, monochrome on white paper',
  },
  {
    id: 'neon',
    prompt:
      'neon cyberpunk aesthetic, glowing neon lights, night city atmosphere, vivid magenta and cyan',
  },
  {
    id: 'minimal',
    prompt:
      'minimalist flat illustration, simple geometric shapes, limited color palette, clean plain background',
  },
];

export const DEFAULT_IMAGE_STYLE_ID = 'none';

export function getImageStyle(id: unknown): ImageStyle {
  return IMAGE_STYLES.find((style) => style.id === id) ?? IMAGE_STYLES[0];
}

/** Описание для модели: перевод запроса пользователя и подсказка стиля. */
export function applyImageStyle(promptEn: string, styleId: unknown): string {
  const style = getImageStyle(styleId);
  return style.prompt ? `${promptEn.trim().replace(/[.,;\s]+$/, '')}, ${style.prompt}` : promptEn;
}
