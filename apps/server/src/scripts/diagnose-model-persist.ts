/**
 * 诊断 zen/big-pickle 回写：模拟 load/save 链路
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SettingsSchema,
  upgradeToModelConfig,
  parseModelRef,
  mergeSettingsForSave,
  mergeSettingsPatch,
  isDefaultZenModelSection,
  resolveOpenxHome,
} from "@openx/shared";
import { resolveProvidersForLoad } from "../providers-store.js";

const configPath =
  process.env.OPENX_CONFIG_PATH?.trim() || join(resolveOpenxHome(), "config.json");
const raw = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
const providers = resolveProvidersForLoad();

console.log("=== diagnose model persist ===");
console.log("config.json model:", raw.model);
console.log("provider slugs:", Object.keys(providers).join(", "));

for (const role of ["coach", "pi", "default"] as const) {
  const ref = (raw.model as Record<string, string>)?.[role] ?? "?";
  const parsed = parseModelRef(ref);
  if (!parsed) {
    console.log(`${role}: ${ref} -> parse FAIL`);
    continue;
  }
  const prov = providers[parsed.slug];
  const entry = prov?.models[parsed.modelId];
  console.log(
    `${role}: ${ref} -> slug=${parsed.slug} provider=${Boolean(prov)} model=${Boolean(entry)} disabled=${entry?.disabled ?? prov?.disabled ?? false}`,
  );
}

const parsedSettings = SettingsSchema.parse({ ...raw, providers: {} });
const upgraded = upgradeToModelConfig({ ...parsedSettings, providers });
console.log("\nupgradeToModelConfig:", upgraded.model);
console.log("would reset to zen:", isDefaultZenModelSection(upgraded.model));

const freshMimo = mergeSettingsPatch(SettingsSchema.parse({}), {
  model: {
    coach: "mimo-sgp/mimo-v2.5-pro",
    pi: "mimo-sgp/mimo-v2.5-pro",
    default: "mimo-sgp/mimo-v2.5-pro",
  },
});
const localZen = SettingsSchema.parse({});
const merged = mergeSettingsForSave(freshMimo, localZen);
console.log("\nmergeSettingsForSave (server=mimo, local=zen):", merged.model?.coach);

const staleZen = SettingsSchema.parse({
  model: {
    coach: "zen/big-pickle",
    pi: "zen/big-pickle",
    default: "zen/big-pickle",
  },
});
const stalePutLegacy = mergeSettingsPatch(freshMimo, staleZen);
const stalePutProtected = mergeSettingsPatch(
  freshMimo,
  mergeSettingsForSave(freshMimo, staleZen),
);
console.log("stale PUT 无保护:", stalePutLegacy.model?.coach);
console.log("stale PUT + mergeSettingsForSave:", stalePutProtected.model?.coach);
