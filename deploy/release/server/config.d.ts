export interface ServerConfig {
    readonly host: string;
    readonly port: number;
    readonly token: string;
    readonly openaiApiKey: string | null;
    readonly openaiModel: string;
    readonly openaiBaseUrl: string;
}
export declare function loadConfig(env?: NodeJS.ProcessEnv): ServerConfig;
