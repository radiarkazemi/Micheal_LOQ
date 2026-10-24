export function loadConfig(env = process.env) {
    // MICHEAL_* preferred; VIGIL_* still accepted for existing VPS env files
    const token = env.MICHEAL_TOKEN?.trim() ||
        env.VIGIL_TOKEN?.trim() ||
        "dev-token-change-me";
    return {
        host: env.MICHEAL_HOST?.trim() || env.VIGIL_HOST?.trim() || "0.0.0.0",
        port: Number(env.MICHEAL_PORT || env.VIGIL_PORT || 8787),
        token,
        openaiApiKey: env.OPENAI_API_KEY?.trim() || null,
        openaiModel: env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
        openaiBaseUrl: env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1",
    };
}
