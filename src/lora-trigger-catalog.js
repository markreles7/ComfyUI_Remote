function civitai(trigger, modelId, versionId, extra = {}) {
  return Object.freeze({
    trigger,
    verifiedBy: "civitai-sha256",
    modelId,
    versionId,
    sourceUrl: `https://civitai.com/models/${modelId}?modelVersionId=${versionId}`,
    ...extra,
  });
}

function civitaiTriggers(triggers, modelId, versionId, extra = {}) {
  return Object.freeze({
    triggers,
    verifiedBy: "civitai-sha256",
    modelId,
    versionId,
    sourceUrl: `https://civitai.com/models/${modelId}?modelVersionId=${versionId}`,
    ...extra,
  });
}

function civitaiOptions(triggerOptions, modelId, versionId, extra = {}) {
  return Object.freeze({
    triggerOptions,
    automatic: false,
    verifiedBy: "civitai-sha256",
    modelId,
    versionId,
    sourceUrl: `https://civitai.com/models/${modelId}?modelVersionId=${versionId}`,
    ...extra,
  });
}

function huggingFace(trigger, repository, extra = {}) {
  return Object.freeze({
    trigger,
    verifiedBy: "huggingface-model-card",
    sourceUrl: `https://huggingface.co/${repository}`,
    ...extra,
  });
}

export const LORA_TRIGGER_CATALOG = Object.freeze({
  "anima\\anima-base-1-masterpiece-v51.safetensors": civitaiTriggers(["masterpiece", "very aesthetic"], 929497, 2961717, {
    baseModel: "Anima",
    recommendedStrength: 1,
  }),
  "anima\\ballsdeep-anima-v1f-re.safetensors": civitai("deep penetration", 550870, 2885588, {
    baseModel: "Anima",
    recommendedStrength: 1,
  }),
  "anima\\sagging-anima-v4.1.safetensors": civitaiTriggers(["breasts apart", "sagging breasts"], 139131, 3052892, {
    baseModel: "Anima",
    recommendedStrength: 1,
  }),
  "anima\\fcomic1to1000_anima_v1.safetensors": civitai("Hentai comic style", 585589, 3008158, {
    baseModel: "Anima",
    recommendedStrength: 1,
    promptRule: "Use the concise activation phrase automatically; describe panels, action, framing and any speech separately in the scene prompt.",
  }),
  "anima\\dynamicposer_slider_anima.safetensors": civitai(null, 438059, 3261827, {
    baseModel: "Anima",
    recommendedStrength: 3,
    recommendedRange: [1, 4],
    promptRule: "Civitai declares no activation token. The pose effect is controlled by LoRA strength; the creator recommends early-step application when using very high strength.",
  }),
  "anima\\rimixao5050.safetensors": civitai(null, 996220, 3011920, {
    baseModel: "Anima",
    recommendedStrength: 1,
    promptRule: "Civitai declares no activation token for this version; the style is activated by the LoRA weight.",
  }),
  "anima\\fcomichardcore_anima_v1.safetensors": civitai("Hentai comic style", 588622, 3014282, {
    baseModel: "Anima",
    recommendedStrength: 1,
    promptRule: "Use the concise activation phrase automatically; describe panels, action, framing and any speech separately in the scene prompt.",
  }),
  "anima\\animamythsmo0thl1nes.safetensors": civitai("Smo0thL1nes", 599757, 3226360, {
    baseModel: "Anima",
    recommendedStrength: 1,
  }),
  "anima\\sty_quality_masterpiece_anima.safetensors": civitaiTriggers(["masterpiece", "very aesthetic"], 929497, 2961717, { baseModel: "Anima", recommendedStrength: 1 }),
  "anima\\nsfw_deep_penetration_anima.safetensors": civitai("deep penetration", 550870, 2885588, { baseModel: "Anima", recommendedStrength: 1 }),
  "anima\\nsfw_sagging_breasts_anima.safetensors": civitaiTriggers(["breasts apart", "sagging breasts"], 139131, 3052892, { baseModel: "Anima", recommendedStrength: 1 }),
  "anima\\nsfw_hentai_comic_fullcolor_anima.safetensors": civitai("Hentai comic style", 585589, 3008158, { baseModel: "Anima", recommendedStrength: 1 }),
  "anima\\sty_dynamic_poses_anima.safetensors": civitai(null, 438059, 3261827, { baseModel: "Anima", recommendedStrength: 3, recommendedRange: [1, 4] }),
  "anima\\sty_rimix_anima.safetensors": civitai(null, 996220, 3011920, { baseModel: "Anima", recommendedStrength: 1 }),
  "anima\\nsfw_hentai_comic_hardcore_anima.safetensors": civitai("Hentai comic style", 588622, 3014282, { baseModel: "Anima", recommendedStrength: 1 }),
  "anima\\sty_mythic_smooth_lines_anima.safetensors": civitai("Smo0thL1nes", 599757, 3226360, { baseModel: "Anima", recommendedStrength: 1 }),

  "flux\\chr_glarak2.safetensors": civitai("Glara", 1241174, 3089597),
  "flux\\chr_rly-thot_shot-krea2-aspen-v11-trigger-rlyaspen.safetensors": civitai("rlyaspen", 2561824, 3071791),
  "flux\\chr_rly-thot_shot-krea2-helena-v1-trigger-rlyhelena.safetensors": civitai("rlyhelena", 2618083, 3085180),
  "flux\\chr_rly-thot_shot-krea2-irena-v1.safetensors": civitai("rlyirena", 2548498, 3069381),
  "flux\\chr_rly-thot_shot-krea2-jada-v11-trigger-rlyjada.safetensors": civitai("rlyjada", 2558101, 3185258),
  "flux\\chr_rly-thot_shot-krea2-marley-v1-trigger-rlymarley.safetensors": civitai("rlymarley", 2588941, 3089102),
  "flux\\chr_rly-thot_shot-krea2-rayven-v1-trigger-rlyrayven.safetensors": civitai("rlyrayven", 2545383, 3091646),
  "flux\\sty_flux_krea_real.safetensors": civitai("in the style of R34L", 1838562, 2080589),

  "flux2\\chr_1zz33xlv2.safetensors": civitai("1zz33XLV2", 2194957, 2657085, { baseModel: "Qwen" }),
  "flux2\\chr_f2k9bbabe_ange_v1.0.safetensors": civitai("F2K9BBabe_Ange_v1.0", 2436391, 2761390),
  "flux2\\chr_f2k9bbabe_engel_v1.0.safetensors": civitai("F2K9BBabe_Engel_v1.0", 2436391, 2758885),
  "flux2\\chr_f2k9bbabe_jania_v1.0.safetensors": civitai("F2K9BBabe_Jania_v1.0", 2436391, 2759091),
  "flux2\\chr_f2k9bbabe_kalia_v1.0.safetensors": civitai("F2K9BBabe_Kalia_v1.0", 2436453, 2759107),
  "flux2\\chr_f2k9bbabe_katerina_v1.0.safetensors": civitai("F2K9BBabe_Katerina_v1.0", 2436475, 2765033),
  "flux2\\chr_f2k9bbabe_marot_v1.0.safetensors": civitai("F2K9BBabe_Marot_v1.0", 2436475, 2739502),
  "flux2\\chr_f2k9bbabe_meng_v1.0.safetensors": civitai("F2K9BBabe_Meng_v1.0", 2436391, 2766416),
  "flux2\\chr_flux2kl_base_br33zy_v7.safetensors": civitai("br33zy", 1657990, 2660687),
  "flux2\\chr_fluzizzy26_klein9b.safetensors": civitai("FLUXIzzy26", 2194957, 2680812),
  "flux2\\chr_glarak9b.safetensors": civitai("Glara", 1241174, 2804403),
  "flux2\\chr_influencer_the_lust_klein_epoch_10.safetensors": civitai("Infthlst", 2488881, 2798065, { derivedFromCommonPrefix: true }),
  "flux2\\chr_kiara-fevernight-k9.safetensors": civitai("kiarafever", 747473, 2751150),
  "flux2\\chr_korean_f2k.safetensors": civitai("k0re1n", 2319175, 2609092),
  "flux2\\chr_lyrak2.safetensors": civitai("Lyra", 1190916, 3089725, { baseModel: "Krea 2" }),
  "flux2\\chr_natiakleinlora.safetensors": civitai("Natia", 2344736, 2637390),
  "flux2\\nsfw_uncut_penis_klein.safetensors": civitai("uncut_penis", 1988828, 2834733),
  "flux2\\sty_1nfl43nc3r.safetensors": civitai("1nfl43nc3r", 1938828, 2194349, { baseModel: "Qwen" }),
  "flux2\\sty_instapic_v3_flux_klein.safetensors": civitai("instapic", 2168120, 2998522),
  "flux2\\nsfw_diverse_male_nudity.safetensors": civitaiOptions(["penis", "large", "small", "circumcised", "uncircumcised", "flaccid", "erect"], 1120962, 2694231),
  "flux2\\nsfw_generalpenis-v1-5beta.safetensors": civitaiOptions(["penis", "hung", "flaccid", "erect", "uncut", "circumcised"], 2333479, 2790299),
  "flux2\\sty_flux2_klein_unlocked_v2.safetensors": civitaiOptions(["nude", "naked", "blow job", "cum", "ass", "pussy"], 2063193, 3030169),
  "flux2\\bigsloppytits-flux2-v1_000001200.safetensors": civitai("bigsloppytits", 1890652, 2736416, {
    baseModel: "Flux.2 Klein 9B",
    promptRule: "Use bigsloppytits as the activation token; describe the intended breast size, clothing, nipple, and areola traits separately.",
  }),

  "h3\\nsfw_aio.safetensors": civitai("hmmotion", 2834417, 3206518, {
    baseModel: "MiniMax H3",
    recommendedStrength: 0.65,
    recommendedRange: [0.5, 0.8],
  }),
  "h3\\nsfw_blowjob.safetensors": civitai(null, 2845331, 3235946, {
    baseModel: "MiniMax H3",
    recommendedStrength: 0.7,
    recommendedRange: [0.55, 0.85],
    promptRule: "No trained word is declared for H3 v2; describe the adult action explicitly and chronologically.",
  }),
  "h3\\nsfw_boob physics.safetensors": civitai(null, 1626704, 3245935, {
    baseModel: "MiniMax H3",
    recommendedStrength: 0.65,
    recommendedRange: [0.5, 0.8],
    promptRule: "No trained word is declared; describe direction, physical cause, inertia and settling explicitly.",
  }),
  "h3\\nsfw_bouncetits.safetensors": civitaiOptions(["her breast is bouncing up and down", "her breast is bouncing from left to right"], 1343431, 3242184, {
    baseModel: "MiniMax H3",
    recommendedStrength: 0.65,
    recommendedRange: [0.5, 0.8],
  }),
  "h3\\nsfw_bouncev07_fl2va-000230_intense.safetensors": civitaiOptions(["her breast is bouncing up and down", "her breast is bouncing from left to right"], 1343431, 3258590, {
    baseModel: "MiniMax H3",
    modelVariant: "FL2VA v0.7",
    recommendedStrength: 0.65,
    recommendedRange: [0.5, 0.8],
    promptRule: "Use this variant for H3 Text/Image/First-Last. Select one directional phrase that matches the requested motion.",
  }),
  "h3\\nsfw_bouncev07-000230_intense.safetensors": civitaiOptions(["her breast is bouncing up and down", "her breast is bouncing from left to right"], 1343431, 3242184, {
    baseModel: "MiniMax H3",
    modelVariant: "Ref2VA v0.7",
    recommendedStrength: 0.6,
    recommendedRange: [0.45, 0.75],
    promptRule: "Use this variant with H3 Reference Images; select one directional phrase that matches the requested motion.",
  }),
  "h3\\nsfw_breastplayjiggle_h3_v2.safetensors": civitai(null, 2856004, 3278283, {
    baseModel: "MiniMax H3",
    modelVariant: "FL2VA v2.0",
    recommendedStrength: 0.75,
    recommendedRange: [0.7, 0.8],
    promptRule: "No trained word is declared. Describe the adult hand action, direction, pressure and resulting motion explicitly. Lower the strength for experimental Ref2VA use.",
  }),
  "h3\\sty_h3_vbvr_pro_attn_only.safetensors": civitai(null, 2497207, 3306139, {
    baseModel: "MiniMax H3",
    recommendedStrength: 0.8,
    recommendedRange: [0.7, 1],
    promptRule: "No activation token is declared. Improves video reasoning and prompt adherence; the creator used 1.0 alone, so use 0.8 in a multi-LoRA stack.",
  }),
  "h3\\nsfw_minimax_vag_000002500.safetensors": civitai(null, 2835594, 3200540, {
    baseModel: "MiniMax H3",
    incompatible: true,
    promptRule: "The creator marks this early v0.2 experiment as broken and says not to use it. It is intentionally excluded from presets.",
  }),
  "h3\\nsfw_deepthroat.safetensors": civitai(null, 2476698, 3226989, {
    baseModel: "MiniMax H3",
    recommendedStrength: 0.65,
    recommendedRange: [0.5, 0.8],
    promptRule: "No trained word is declared for the FL2VA version; describe the adult action and temporal rhythm explicitly.",
  }),
  "h3\\nsfw_synthpussy_closeups.safetensors": civitai(null, 2509189, 3204862, {
    baseModel: "MiniMax H3",
    recommendedStrength: 0.5,
    recommendedRange: [0.35, 0.65],
    promptRule: "Experimental close-up LoRA trained from still material; keep its weight low in video stacks.",
  }),
  "h3\\nsfw_titsenlarge.safetensors": civitai(null, 2322189, 3206151, {
    baseModel: "MiniMax H3",
    recommendedStrength: 0.5,
    recommendedRange: [0.35, 0.65],
    promptRule: "Early H3 beta with no declared trained word; use only for an explicitly requested transformation.",
  }),
  "h3\\penisv2_minimax-h3_epoch60.safetensors": civitai("penis", 2849923, 3247473, {
    baseModel: "MiniMax H3",
    recommendedStrength: 0.45,
    recommendedRange: [0.35, 0.65],
  }),
  "h3\\nsfw_penisv2_minimax-h3_epoch60.safetensors": civitai("penis", 2849923, 3247473, {
    baseModel: "MiniMax H3",
    recommendedStrength: 0.45,
    recommendedRange: [0.35, 0.65],
  }),
  "h3\\vagina_minimax-h3_epoch20.safetensors": civitai("pussy", 2846342, 3252213, {
    baseModel: "MiniMax H3",
    recommendedStrength: 0.5,
    compatibleUse: ["stillsOnly"],
    promptRule: "This installed version is published as Stills only and is intentionally excluded from MiniMax H3 video presets.",
  }),
  "h3\\mysticxxx_mmh3-v4.safetensors": civitai(null, 2856467, 3266628, {
    baseModel: "MiniMax H3",
    recommendedStrength: 0.8,
    recommendedRange: [0.6, 1],
    promptRule: "The author recommends 1.0 when used alone; use 0.6-0.8 when stacking for temporal stability.",
  }),
  "h3\\nsfw_mysticxxx_mmh3-v4.safetensors": civitai(null, 2856467, 3266628, {
    baseModel: "MiniMax H3",
    recommendedStrength: 0.8,
    recommendedRange: [0.6, 1],
    promptRule: "The author recommends 1.0 when used alone; use 0.6-0.8 when stacking for temporal stability.",
  }),
  "h3\\h3_mis_insrt_v07.safetensors": civitai(null, 2843744, 3210503, {
    baseModel: "MiniMax H3",
    recommendedStrength: 0.6,
    promptRule: "No trained word or sufficiently clear usage guidance is declared; keep manual until validated locally.",
  }),
  "h3\\sty_combat.safetensors": civitaiOptions(["prfight2", "prfin1"], 2853878, 3246572, { selectedByProfile: true }),
  "h3\\mot_weapon_combat_h3_trigger-bunny.safetensors": civitai("BUNNY", 2904053, 3283995, {
    baseModel: "MiniMax H3",
    recommendedStrength: 0.8,
    recommendedRange: [0.7, 0.9],
    selectedByProfile: true,
  }),
  "h3\\mot_continuity_repair_h3_trigger-bunny_crisp_motion.safetensors": civitai("bunny_crisp_motion", 2890788, 3268186, {
    baseModel: "MiniMax H3",
    recommendedStrength: 0.6,
    recommendedRange: [0.5, 0.7],
    promptRule: "Use 0.5-0.7 in the first pass and 0.2-0.3 in a conservative second pass; the trigger is optional.",
  }),
  "h3\\sty_motion_booster.safetensors": civitai("dynv2", 2840146, 3228867),
  "h3\\sty_galaxyace.safetensors": civitai(null, 2200329, 3201619, {
    baseModel: "MiniMax H3",
    recommendedStrength: 1,
    recommendedRange: [0.7, 1],
    compatibleModelProfiles: ["base", "erosMax"],
    promptRule: "No activation token is required. Use with MiniMax H3 base/pruned or Eros Max; do not use with PinkCherry unpruned.",
  }),
  "h3\\mot_better_motion.safetensors": civitai(null, 2734359, 3256084, {
    baseModel: "MiniMax H3",
    recommendedStrength: 0.55,
    recommendedRange: [0.4, 0.8],
    promptRule: "Keep the motion prompt short and physically explicit; no activation token is required.",
  }),
  "h3\\mot_zero_two_dance.safetensors": civitai("doing the zero-two dance", 1819613, 3264304, {
    baseModel: "MiniMax H3",
    recommendedStrength: 0.75,
  }),
  "h3\\aud_whispering.safetensors": civitai(null, 2826446, 3198292, {
    baseModel: "MiniMax H3",
    recommendedStrength: 0.7,
    dynamicTriggerTemplate: "{speaker} whispers: <d>[{language}] {dialogue}</d>",
    promptRule: "Describe the speaker whispering and keep the H3 dialogue tag; do not add a static token.",
  }),
  "h3\\cam_drone_shot.safetensors": civitai("dr0nesh0t", 2857065, 3226987, {
    baseModel: "MiniMax H3",
    recommendedStrength: 0.7,
  }),
  "h3\\minimax_bst_v1.safetensors": civitai("bigsloppytits", 1890652, 3220778, {
    baseModel: "MiniMax H3",
    recommendedStrength: 0.85,
    recommendedRange: [0.7, 1],
    promptRule: "Use bigsloppytits as the activation token; describe the intended breast size, clothing, nipple, and areola traits separately.",
  }),
  "h3\\nsfw_minimax_bst_v1.safetensors": civitai("bigsloppytits", 1890652, 3220778, {
    baseModel: "MiniMax H3",
    recommendedStrength: 0.85,
    recommendedRange: [0.7, 1],
    promptRule: "Use bigsloppytits as the activation token; describe the intended breast size, clothing, nipple, and areola traits separately.",
  }),
  "h3\\sty_realism_people.safetensors": huggingFace("r34l1sm", "fal/MiniMax-H3-Realism-People-LoRA", {
    baseModel: "MiniMax H3",
    recommendedStrength: 0.8,
  }),
  "h3\\minimaxh3_tfmcutesypixel.safetensors": civitai(null, 2907373, 3288098, {
    baseModel: "MiniMax H3",
    recommendedStrength: 0.8,
    promptRule: "No activation token is declared; describe a cutesy pixel anime look explicitly.",
  }),
  "h3\\minimaxh3_tfmhanafudaretrostyle_000003000.safetensors": civitai(null, 2902682, 3282334, {
    baseModel: "MiniMax H3",
    recommendedStrength: 0.8,
    promptRule: "No activation token is declared; describe the Hanafuda retro 2D anime style explicitly.",
  }),
  "h3\\minimaxh3_ref2v_pbrstyle_v1.0.safetensors": civitai("PBRSty1e", 2868582, 3240881, {
    baseModel: "MiniMax H3",
    recommendedStrength: 0.8,
  }),
  "h3\\mh3-lys.safetensors": civitai("LYS-Style", 1659949, 3222216, {
    baseModel: "MiniMax H3",
    recommendedStrength: 0.8,
    promptRule: "Use LYS-Style as the general claymation activation; plasticine-transforms and plasticine-melts are optional action phrases.",
  }),
  "h3\\sty_cutesy_pixel_h3.safetensors": civitai(null, 2907373, 3288098, { baseModel: "MiniMax H3", recommendedStrength: 0.8 }),
  "h3\\sty_hanafuda_retro_h3.safetensors": civitai(null, 2902682, 3282334, { baseModel: "MiniMax H3", recommendedStrength: 0.8 }),
  "h3\\sty_pbr_animation_h3.safetensors": civitai("PBRSty1e", 2868582, 3240881, { baseModel: "MiniMax H3", recommendedStrength: 0.8 }),
  "h3\\sty_claymation_h3.safetensors": civitai("LYS-Style", 1659949, 3222216, { baseModel: "MiniMax H3", recommendedStrength: 0.8 }),
  "h3\\sty_flat_anime_h3.safetensors": civitai(null, 1952560, 3225946, { baseModel: "MiniMax H3", recommendedStrength: 0.8 }),
  "h3\\char_lain_iwakura_h3.safetensors": civitai("Lain Iwakura", 653421, 3209651, { baseModel: "MiniMax H3", recommendedStrength: 0.8 }),
  "h3\\nsfw_general_anime_h3.safetensors": civitai("2d anime style", 2861135, 3286171, { baseModel: "MiniMax H3", recommendedStrength: 0.8 }),
  "h3\\nsfw_general_hentai_anime_h3.safetensors": civitai("2D-animated", 2821851, 3270361, { baseModel: "MiniMax H3", recommendedStrength: 0.8 }),
  "h3\\nsfw_plaguekind-tiddies-realismslider.safetensors": civitai(null, 2858760, 3229050, {
    baseModel: "MiniMax H3",
    recommendedStrength: 1.1,
    recommendedRange: [0.4, 2],
    promptRule: "Detail/realism slider with no activation token. Use 0.4-0.5 for 2D/anime, 0.5-0.8 for CGI/semi-real and 1.0-2.0 for realistic breast and nipple detail; avoid values above 2.0.",
  }),

  "ltx2.3\\fantasy_anime.safetensors": civitai("f4nt4sy4n1m6", 2552450, 2868543, {
    baseModel: "LTXV 2.3",
    recommendedStrength: 0.8,
  }),
  "ltx2.3\\h-anime4.comfy.safetensors": civitai(null, 2725065, 3062850, {
    baseModel: "LTXV 2.3",
    recommendedStrength: 0.8,
    promptRule: "No activation token is declared for the downloadable ANIME LoRA file.",
  }),
  "ltx2.3\\anime90s-step00053000.comfy.safetensors": civitai("ANIMSTY", 2557755, 2898537, {
    baseModel: "LTXV 2.3",
    recommendedStrength: 0.8,
    promptRule: "ANIMSTY activates the general retro anime look; SHW_* tokens select optional show-specific variants.",
  }),
  "ltx2.3\\gl-23-step00040000.comfy.safetensors": civitai("TTGL", 2537530, 2851819, {
    baseModel: "LTXV 2.3",
    recommendedStrength: 0.8,
  }),
  "ltx2.3\\yourname_env_ltx23-step00064500.comfy.safetensors": civitaiTriggers(["ANIMSTY", "SHW_YN"], 2650155, 2975759, {
    baseModel: "LTXV 2.3",
    recommendedStrength: 0.8,
  }),
  "ltx2.3\\pixar_toon.safetensors": civitai("P1x4r", 2536130, 2850271, {
    baseModel: "LTXV 2.3",
    recommendedStrength: 0.8,
  }),
  "ltx2.3\\ltx-2.3_deepthroat.safetensors": civitai("LTXdeepthroat", 2476698, 2784573),
  "ltx2.3\\ltx-2.3_dr34ml4y.safetensors": civitaiOptions(["m15510n4ry", "bl0wj0b", "d0ubl3_bj", "d0gg1e", "c0wg1rl"], 1811313, 2747549),
  "ltx2.3\\ltx2.3_beeg breasts.safetensors": civitai("BEEG", 2425578, 2789533),
  "ltx2.3\\ltx2.3_blowjob_animation_i2v_v1.0.safetensors": civitaiOptions(["blowjob animation", "mouth is wrapped around the penis", "performing oral sex"], 2535778, 2849892),
  "ltx2.3\\ltx2.3_bounce.safetensors": civitaiOptions(["her breast is bouncing up and down", "her breast is bouncing from left to right"], 1343431, 2864091),
  "ltx2.3\\ltx2.3_ltxnudes_sexgod.safetensors": civitai("LTXNUDES", 2308157, 2778606),
  "ltx2.3\\ltx23_hazel.safetensors": civitai("hazelashgrove", 2687244, 3020583),
  "ltx2.3\\ltx23_isab311v2.safetensors": civitai("ISAB311v2", 2527788, 2840943),
  "ltx2.3\\ltx23_sienna_v1.safetensors": civitai("Sienna_v1", 2657774, 2984418),
  "ltx2.3\\plora_sulfer_v1.2-step00008500.safetensors": civitai("PENISLORA", 2598050, 2930335),
  "ltx2.3\\plora_sulfter_i2v-step00008500.comfy.safetensors": civitai("PENISLORA", 2598050, 3086880),
  "ltx2.3\\仙侠风格.safetensors": civitai("仙侠风格", 2489394, 2798625),
  "ltx2.5\\3dsrx_1250.safetensors": civitai("3dsrx", 2895989, 3273961, {
    baseModel: "LTXV 2.5",
    recommendedStrength: 0.6,
    recommendedRange: [0.4, 0.8],
    promptRule: "The author recommends 0.8 for T2V and 0.4 for I2V; 0.6 is a neutral default.",
  }),
  "ltx2.3\\sty_fantasy_anime_ltx23.safetensors": civitai("f4nt4sy4n1m6", 2552450, 2868543, { baseModel: "LTXV 2.3", recommendedStrength: 0.8 }),
  "ltx2.3\\sty_ai_anime_ltx23.safetensors": civitai(null, 2725065, 3062850, { baseModel: "LTXV 2.3", recommendedStrength: 0.8 }),
  "ltx2.3\\sty_retro_90s_anime_ltx23.safetensors": civitai("ANIMSTY", 2557755, 2898537, { baseModel: "LTXV 2.3", recommendedStrength: 0.8 }),
  "ltx2.3\\sty_gurren_lagann_ltx23.safetensors": civitai("TTGL", 2537530, 2851819, { baseModel: "LTXV 2.3", recommendedStrength: 0.8 }),
  "ltx2.3\\sty_makoto_shinkai_environment_ltx23.safetensors": civitaiTriggers(["ANIMSTY", "SHW_YN"], 2650155, 2975759, { baseModel: "LTXV 2.3", recommendedStrength: 0.8 }),
  "ltx2.3\\sty_pixar_toon_ltx23.safetensors": civitai("P1x4r", 2536130, 2850271, { baseModel: "LTXV 2.3", recommendedStrength: 0.8 }),
  "ltx2.5\\sty_3d_animation_ltx25.safetensors": civitai("3dsrx", 2895989, 3273961, { baseModel: "LTXV 2.5", recommendedStrength: 0.6, recommendedRange: [0.4, 0.8] }),

  "qwen\\1nfl43nc3r.safetensors": civitai("1nfl43nc3r", 1938828, 2194349),
  "qwen\\influencer2.safetensors": civitai(null, 2140610, 2421273, {
    baseModel: "Qwen",
    promptRule: "Civitai does not declare an activation token for this version; describe the intended influencer/selfie aesthetic directly.",
  }),
  "qwen\\4play2512_v2.safetensors": civitaiOptions(["bl0wj0b", "c0wg1rl", "r3v3rs3_c0wg1rl", "d0ubl3_j0b", "m15510n4ry", "d0gg13", "pov"], 2004155, 3061098),
  "qwen\\[qwen] jtt2_5.safetensors": civitaiOptions(["massive breasts", "large breasts", "medium breasts", "small breasts"], 708319, 2146703, {
    baseModel: "Qwen",
    recommendedRange: [0.2, 1],
  }),
  "qwen\\aigc.safetensors": civitai("变成真实风格", 2050933, 2371342),
  "qwen\\anime2real_v4-22.safetensors": civitai("将图片转为真实风格", 2110229, 2396073),
  "qwen\\b10ndi.safetensors": civitai("b10ndi", 2347280, 2643016),
  "qwen\\e1st_asn.safetensors": civitai("e1st_asn", 2233187, 2528874),
  "qwen\\famegrid_qwen_lora_standard_v1.5_realskinfix.safetensors": civitaiTriggers(["igmodel", "rlskn"], 2088956, 2453097),
  "qwen\\hearmemanai_v4_rank128_breastslora_epoch80.safetensors": civitaiOptions([
    "tiny sized areoles", "small sized areoles", "medium sized areoles", "large sized areoles",
    "tiny sized breasts", "small sized breasts", "medium sized breasts", "large sized breasts",
    "pale areoles", "ghost areoles", "brown areoles", "dark areoles", "hard nipples", "erect nipples",
  ], 2036919, 2305397, { baseModel: "Qwen" }),
  "qwen\\hmfemme_v1.safetensors": civitai("HMFemme", 2126422, 2405380, {
    baseModel: "Qwen",
    promptRule: "Start the prompt with: HMFemme, an amateur photo taken from a smartphone camera.",
  }),
  "qwen\\jib_qwen_fix_000002750.safetensors": civitai(null, 1943554, 2199719, {
    baseModel: "Qwen",
    promptRule: "Corrective anatomy LoRA; no activation token is required.",
  }),
  "qwen\\korean_qwen.safetensors": civitai("e1st_asn", 2233187, 2528874),
  "qwen\\m99_dick_size_adjuster_1.safetensors": civitai(null, 139061, 153799, { baseModel: "SD 1.5", incompatible: true }),
  "qwen\\m99_labiaplasty_pussy_4_qwen-image-edit-2511.safetensors": civitaiOptions(["adjust her pussy", "adjust her pussy and anus", "adjust her pussy, anal"], 112299, 2637922),
  "qwen\\nsfw-one-click breast enhancement.safetensors": civitai("Make your breasts bigger", 2280916, 2567144),
  "qwen\\nsfw-qwen_snofs.safetensors": civitaiOptions(["sex", "missionary", "cum", "cowgirl", "reverse cowgirl", "selfie", "snapchat selfie", "undressing", "massage"], 1972981, 2233198),
  "qwen\\nsfw-sexgod_femalenudity_qwenedit_2511_v2.safetensors": civitai("SEXGOD", 2339965, 2689224),
  "qwen\\qwen-image-penis-lora-coachbate-v3.safetensors": civitai("p3n15", 2382421, 3053299),
  "qwen\\qwen-image_smartphonesnapshotphotoreality.safetensors": civitai("amateur photo", 2022854, 2289403),
  "qwen\\qwen2512_bigsloppytits_v1_copy_000003000.safetensors": civitaiOptions(["huge bust", "huge breasts", "huge saggy breasts"], 1890652, 2943581, {
    baseModel: "Qwen",
    promptRule: "Choose the phrase that matches the requested clothed or nude result; this version has no separate coined activation token in its version metadata.",
  }),
  "qwen\\qwen_mcnl_v1.0.safetensors": civitaiOptions(["cum_on_face", "nsfw", "blowjob", "cowgirlout", "creamp1e", "penis", "l1ck", "missionary", "nipples", "reversecowgirlpov", "vagina"], 1851673, 2105899),
  "qwen\\breasts_rest_qwen_v1.safetensors": civitaiOptions(["her breasts rest on table", "her huge sagging breasts rest on table", "her huge natural breasts rest on table"], 2103195, 2379447, {
    baseModel: "Qwen",
    recommendedRange: [1, 1.5],
    promptRule: "Replace table with the intended support surface when needed; keep the phrase her breasts rest on <surface>.",
  }),
  "qwen\\sh0r7y_asian.safetensors": civitai("sh0r7y_asian", 2276315, 2616190),
  "qwen\\woman41.safetensors": civitai("woman041", 2144960, 2426161),
  "qwen\\woman877-qwen.safetensors": civitai("woman877", 1750662, 2432755),
  "qwen\\young_blonde_2_qw.safetensors": civitai("y0ngcut1", 2672772, 3006493),
});

export function normalizedLoraName(name) {
  return String(name || "").replaceAll("/", "\\").toLocaleLowerCase();
}

export function loraTriggerMetadata(installedLoras = []) {
  return Object.fromEntries(installedLoras.flatMap((name) => {
    const metadata = LORA_TRIGGER_CATALOG[normalizedLoraName(name)];
    return metadata ? [[name, metadata]] : [];
  }));
}
