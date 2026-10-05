// Starting points based on local filenames and safetensors metadata, not render validation.
const entries = [
  ['sfwCinema', 'Cinema · CINEMA1', 'STY_CINEMA1.safetensors', 'cinema'],
  ['sfwCinemaV2', 'Cinema V2 · CINEMA2', 'STY_CINEMA2.safetensors', 'cinema'],
  ['sfwCinemaV3', 'Cinema V3 · CINEMA3 adattata', 'STY_CINEMA3.safetensors', 'cinema'],
  ['sfwMotion', 'Movimento · Motion Booster', 'STY_Motion_Booster.safetensors', 'motion'],
  ['sfwMotionV2', 'Movimento V2 · Better Motion', 'MOT_Better_Motion.safetensors', 'motion'],
  ['sfwVbvr', 'VBVR · base', 'STY_VBVR_H3.safetensors', 'natural'],
  ['sfwVbvrV2', 'VBVR V2 · Pro attention', 'STY_H3_VBVR_Pro_attn_only.safetensors', 'natural'],
  ['sfwClay', 'Animazione · Claymation', 'STY_Claymation_H3.safetensors', 'clay'],
  ['sfwPixel', 'Animazione · Cutesy Pixel', 'STY_Cutesy_Pixel_H3.safetensors', 'pixel'],
  ['sfwFlatAnime', 'Animazione · Flat Anime', 'STY_Flat_Anime_H3.safetensors', 'anime'],
  ['sfwHanafuda', 'Illustrazione · Hanafuda Retro', 'STY_Hanafuda_Retro_H3.safetensors', 'illustration'],
  ['sfwPbr', 'Animazione · PBR (Ref2V)', 'STY_PBR_Animation_H3.safetensors', 'pbr'],
  ['sfwDrone', 'Camera · Drone', 'CAM_Drone_Shot.safetensors', 'drone'],
  ['sfwWhisper', 'Audio · Whispering', 'AUD_Whispering.safetensors', 'whisper'],
  ['sfwLain', 'Personaggio · Lain Iwakura', 'CHAR_Lain_Iwakura_H3.safetensors', 'anime'],
  ['sfwDance', 'Danza · Zero Two', 'MOT_Zero_Two_Dance.safetensors', 'dance'],
  ['sfwRealism', 'Ritratto · Realism People', 'STY_Realism_People.safetensors', 'natural'],
];

const descriptions = {
  cinema: 'One continuous cinematic medium shot of an adult walking through a sunlit courtyard. Stable identity, clothing and environment; gentle camera tracking.',
  motion: 'An adult walks across a courtyard, turns and stops. Show continuous natural movement, planted feet and a stable ending. One fixed wide shot.',
  natural: 'An adult arranges books on a table. Preserve identity, clothing, object shapes and room lighting in one continuous medium shot.',
  clay: 'A clay stop-motion bird walks across a miniature garden. Preserve handmade clay texture and character proportions.',
  pixel: 'A small pixel-art robot walks across a garden. Preserve the pixel grid, palette and silhouette throughout.',
  anime: 'A fully clothed anime character walks through a quiet street. Preserve line art, cel shading and character design.',
  illustration: 'An illustrated bird moves among flowers in a retro Hanafuda-inspired composition. Preserve the flat palette and graphic shapes.',
  pbr: 'A stylized animated robot turns on a tabletop. Preserve physically based materials, lighting and geometry.',
  drone: 'A slow aerial flyover of a countryside village. Preserve buildings, terrain and coherent camera parallax.',
  whisper: 'An adult quietly whispers a short greeting in a calm room. Natural mouth movement and quiet room ambience.',
  dance: 'A fully clothed adult dancer performs a brief dance in one fixed full-body shot. Preserve anatomy and grounded footwork.',
};

export const H3_SFW_PRESETS = Object.freeze(Object.fromEntries(entries.map(([id, label, file, scene]) => [id, {
  label, file, lora: id, strength: 0.5, mode: 'image', duration: '6',
  aspect: '16:9 (Widescreen)', look: 'neutral', starter: descriptions[scene],
  hint: `${label}: singola LoRA a 0,50; punto di partenza sperimentale, non validato con rendering. Confrontare mantenendo prompt, seed, input e parametri identici.${id === 'sfwCinemaV3' ? ' Variante adattata di CINEMA2, non un addestramento indipendente.' : ''}${id === 'sfwPbr' ? ' Metadati Ref2V: compatibilità con PlagueKind da verificare.' : ''}`,
}])));
