export function h3LoraBaseName(name) {
  return String(name || "").split(/[\\/]/).pop().trim().toLowerCase();
}

// Strip classification prefixes only. Versions and the remaining model name
// are significant: v1, v2, FL2VA and Ref2VA must never become interchangeable.
export function h3LoraIdentity(name) {
  return h3LoraBaseName(name).replace(/^(?:(?:sty|nsfw|sfw|mot|cam|char|aud|pov)[_ -]+)+/iu, "");
}

export function resolveH3LoraFile(installed = [], expected = []) {
  const names = (Array.isArray(expected) ? expected : [expected]).filter(Boolean);
  for (const name of names) {
    const exact = installed.find((file) => h3LoraBaseName(file) === h3LoraBaseName(name));
    if (exact) return exact;
  }
  const identities = new Set(names.map(h3LoraIdentity));
  const matches = installed.filter((file) => identities.has(h3LoraIdentity(file)));
  return matches.length === 1 ? matches[0] : "";
}

export const H3_LEGACY_PRESET_FILES = Object.freeze({
  realism: "STY_Realism_People.safetensors", motion: "STY_Motion_Booster.safetensors",
  betterMotion: "MOT_Better_Motion.safetensors", zeroTwo: "MOT_Zero_Two_Dance.safetensors",
  whisper: "AUD_Whispering.safetensors", drone: "CAM_Drone_Shot.safetensors",
  nsfwAio: "NSFW_AIO.safetensors", mystic: "NSFW_MysticXXX_MMH3-V4.safetensors",
  blowjob: "NSFW_Blowjob.safetensors", deepthroat: "NSFW_deepthroat.safetensors",
  boobPhysics: "NSFW_Boob Physics.safetensors", bounce: "NSFW_bouncetits.safetensors",
  bounceFl2va: "NSFW_bounceV07_fl2va-000230_Intense.safetensors", bounceRef2va: "NSFW_bouncetits.safetensors",
  breastPlay: "NSFW_breastplayjiggle_h3_v2.safetensors", tiddiesRealism: "NSFW_PlagueKind-tiddies-realismslider.safetensors",
  galaxyAce: "STY_GalaxyAce.safetensors", vbvrPro: "STY_H3_VBVR_Pro_attn_only.safetensors",
  bst: "NSFW_MiniMax_bst_v1.safetensors", animeAdult: "NSFW_General_Hentai_Anime_H3.safetensors",
  flatAnime: "STY_Flat_Anime_H3.safetensors", penis: "NSFW_PenisV2_minimax-h3_epoch60.safetensors",
});
