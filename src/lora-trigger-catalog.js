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

  "h3\\nsfw_aio.safetensors": civitai("hmmotion", 2834417, 3206518),
  "h3\\nsfw_bouncetits.safetensors": civitaiOptions(["her breast is bouncing up and down", "her breast is bouncing from left to right"], 1343431, 3242184),
  "h3\\sty_combat.safetensors": civitaiOptions(["prfight2", "prfin1"], 2853878, 3246572, { selectedByProfile: true }),
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
  "h3\\sty_realism_people.safetensors": huggingFace("r34l1sm", "fal/MiniMax-H3-Realism-People-LoRA", {
    baseModel: "MiniMax H3",
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
