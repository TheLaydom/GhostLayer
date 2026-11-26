import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  CustomProvider,
  getToken,
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  type AppCheck,
} from 'firebase/app-check';
import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
  type AI,
} from 'firebase/ai';
import {
  ChromeLanguageModelRunner,
  ENTITY_JSON_SCHEMA,
  LocalContextualScanner,
  type LocalAiAvailability,
  type OnDeviceRunner,
} from './localAi';

export interface CloudResult {
  rawText: string;
  model: string;
  latencyMs: number;
}

export interface CloudClient {
  readonly isFirebaseConfigured: boolean;
  readonly modelName: string;
  generate(sanitizedPrompt: string): Promise<CloudResult>;
}

export interface GatewayTelemetry {
  firebaseConfigured: boolean;
  cloudModel: string;
  appCheckMode:
    | 'custom-broker'
    | 'debug-runtime'
    | 'recaptcha-enterprise'
    | 'unconfigured';
  note?: string;
}

const CLOUD_SYSTEM_INSTRUCTION = `You are a helpful AI assistant behind GhostLayer, a local privacy firewall.
Sensitive items in the user's prompt have been replaced with placeholders like [PERSON_1], [EMAIL_1], [API_KEY_1].
Rules:
1. Keep placeholders verbatim in your response wherever those entities belong.
2. Never ask the user to send raw secrets, passwords, or API keys.`;

interface EnvFirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  cloudModel: string;
  appCheckBrokerUrl?: string;
  appCheckDebugMode: boolean;
  recaptchaEnterpriseSiteKey?: string;
}

function loadFirebaseEnv(): EnvFirebaseConfig | null {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY?.trim() ?? '';
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID?.trim() ?? '';
  const appId = import.meta.env.VITE_FIREBASE_APP_ID?.trim() ?? '';
  if (!apiKey || !projectId || !appId) return null;

  return {
    apiKey,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN?.trim() ?? '',
    projectId,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET?.trim() ?? '',
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID?.trim() ?? '',
    appId,
    cloudModel: import.meta.env.VITE_FIREBASE_CLOUD_MODEL?.trim() || 'gemini-3.5-flash',
    appCheckBrokerUrl:
      import.meta.env.VITE_FIREBASE_APPCHECK_BROKER_URL?.trim() || undefined,
    appCheckDebugMode: import.meta.env.VITE_FIREBASE_APPCHECK_DEBUG_MODE === 'true',
    recaptchaEnterpriseSiteKey:
      import.meta.env.VITE_FIREBASE_RECAPTCHA_ENTERPRISE_SITE_KEY?.trim() || undefined,
  };
}

/**
 * Firebase AI Logic on-device runner using InferenceMode.ONLY_ON_DEVICE.
 * Explicitly calls initializeDeviceModel() inside a user gesture before inference,
 * and NEVER uses PREFER_ON_DEVICE so raw prompts cannot fall back to cloud.
 */
class FirebaseOnlyOnDeviceRunner implements OnDeviceRunner {
  readonly engine = 'firebase-only-on-device' as const;
  private readonly probe = new ChromeLanguageModelRunner();
  private deviceModelPromise: Promise<ReturnType<typeof getGenerativeModel>> | null = null;

  constructor(private readonly ai: AI) {}

  checkAvailability(): Promise<{ status: LocalAiAvailability; reason?: string }> {
    return this.probe.checkAvailability();
  }

  private async getInitializedModel(): Promise<ReturnType<typeof getGenerativeModel>> {
    if (!this.deviceModelPromise) {
      this.deviceModelPromise = (async () => {
        const model = getGenerativeModel(this.ai, {
          mode: InferenceMode.ONLY_ON_DEVICE,
          onDeviceParams: {
            createOptions: {
              expectedInputs: [{ type: 'text', languages: ['en'] }],
              expectedOutputs: [{ type: 'text', languages: ['en'] }],
            },
            promptOptions: {
              responseConstraint: ENTITY_JSON_SCHEMA as unknown as Record<string, unknown>,
            },
          },
        });
        await model.initializeDeviceModel();
        return model;
      })();
    }
    try {
      return await this.deviceModelPromise;
    } catch (err) {
      this.deviceModelPromise = null;
      throw err;
    }
  }

  async initialize(): Promise<void> {
    await this.getInitializedModel();
  }

  async prompt(systemPrompt: string, userPrompt: string): Promise<string> {
    const model = await this.getInitializedModel();
    const res = await model.generateContent(`${systemPrompt}\n\n${userPrompt}`);
    const source = (res.response as { inferenceSource?: string }).inferenceSource;
    if (source && source !== 'ON_DEVICE') {
      throw new Error(`Unexpected inference source for local scan: ${source}`);
    }
    return res.response.text();
  }
}

class FirebaseCloudClient implements CloudClient {
  readonly isFirebaseConfigured: boolean;
  readonly modelName: string;

  constructor(
    private readonly ai: AI | null,
    private readonly appCheck: AppCheck | null,
    modelName: string,
  ) {
    // Enforce App Check: never enable live cloud calls unless BOTH ai and appCheck are active.
    this.isFirebaseConfigured = ai !== null && appCheck !== null;
    this.modelName = modelName;
  }

  async generate(sanitizedPrompt: string): Promise<CloudResult> {
    if (!this.ai || !this.appCheck) {
      throw new Error(
        'Cloud Gemini requires Firebase AI Logic + App Check to be configured in extension/.env.local.',
      );
    }

    const started = performance.now();

    // Explicitly acquire and verify an App Check token before live cloud inference.
    const appCheckToken = await getToken(this.appCheck, false);
    if (!appCheckToken?.token) {
      throw new Error('App Check failed to issue a valid attestation token.');
    }

    // Firebase JS SDK 13 hybrid mode requires cloud config inside `inCloudParams`
    // (top-level `model` and `systemInstruction` are ignored when `mode` is set).
    const model = getGenerativeModel(this.ai, {
      mode: InferenceMode.ONLY_IN_CLOUD,
      inCloudParams: {
        model: this.modelName,
        systemInstruction: CLOUD_SYSTEM_INSTRUCTION,
      },
    });
    const result = await model.generateContent(sanitizedPrompt);
    return {
      rawText: result.response.text(),
      model: this.modelName,
      latencyMs: Math.round(performance.now() - started),
    };
  }
}

export interface ExtensionServices {
  localScanner: LocalContextualScanner;
  cloudClient: CloudClient;
  telemetry: GatewayTelemetry;
}

export function createExtensionServices(): ExtensionServices {
  const env = loadFirebaseEnv();
  const isExtension =
    typeof location !== 'undefined' && location.protocol === 'chrome-extension:';

  if (!env) {
    return {
      localScanner: new LocalContextualScanner(new ChromeLanguageModelRunner(), {
        enableBrowserHeuristicFallback: true,
      }),
      cloudClient: new FirebaseCloudClient(null, null, 'unconfigured'),
      telemetry: {
        firebaseConfigured: false,
        cloudModel: 'unconfigured',
        appCheckMode: 'unconfigured',
        note: 'Add your Firebase Web App config and App Check mode to extension/.env.local to enable built-in Cloud Gemini chat.',
      },
    };
  }

  const app: FirebaseApp = initializeApp({
    apiKey: env.apiKey,
    authDomain: env.authDomain,
    projectId: env.projectId,
    storageBucket: env.storageBucket,
    messagingSenderId: env.messagingSenderId,
    appId: env.appId,
  });

  let appCheck: AppCheck | null = null;
  let appCheckMode: GatewayTelemetry['appCheckMode'] = 'unconfigured';

  if (env.appCheckBrokerUrl) {
    // Production MV3 CustomProvider: mints short-lived App Check tokens automatically for every user
    const brokerUrl = env.appCheckBrokerUrl;
    appCheck = initializeAppCheck(app, {
      provider: new CustomProvider({
        getToken: async () => {
          const resp = await fetch(brokerUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ appId: env.appId }),
          });
          if (!resp.ok) {
            throw new Error(`App Check broker returned HTTP ${resp.status}.`);
          }
          const data = (await resp.json()) as {
            token?: string;
            expireTimeMillis?: number;
          };
          if (!data.token || typeof data.expireTimeMillis !== 'number') {
            throw new Error('App Check broker returned an invalid token payload.');
          }
          return {
            token: data.token,
            expireTimeMillis: data.expireTimeMillis,
          };
        },
      }),
      isTokenAutoRefreshEnabled: true,
    });
    appCheckMode = 'custom-broker';
  } else if (env.appCheckDebugMode) {
    (self as unknown as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    appCheck = initializeAppCheck(app, {
      provider: new CustomProvider({
        getToken: async () => {
          throw new Error(
            'App Check runtime debug token should handle token exchange in local development.',
          );
        },
      }),
      isTokenAutoRefreshEnabled: true,
    });
    appCheckMode = 'debug-runtime';
  } else if (!isExtension && env.recaptchaEnterpriseSiteKey) {
    appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(env.recaptchaEnterpriseSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
    appCheckMode = 'recaptcha-enterprise';
  }

  const ai = getAI(app, { backend: new GoogleAIBackend() });
  const liveAi = appCheck ? ai : null;

  return {
    // Always route Chrome Gemini Nano through Firebase AI Logic (InferenceMode.ONLY_ON_DEVICE)
    // to satisfy #BuildHybridAI 2026 Chrome track requirements.
    localScanner: new LocalContextualScanner(new FirebaseOnlyOnDeviceRunner(ai), {
      enableBrowserHeuristicFallback: true,
    }),
    cloudClient: new FirebaseCloudClient(liveAi, appCheck, env.cloudModel),
    telemetry: {
      firebaseConfigured: liveAi !== null,
      cloudModel: liveAi ? env.cloudModel : 'unconfigured',
      appCheckMode,
      note:
        liveAi === null
          ? 'Live cloud calls are disabled until App Check is configured (set VITE_FIREBASE_APPCHECK_BROKER_URL for production MV3 or VITE_FIREBASE_APPCHECK_DEBUG_MODE=true for local dev).'
          : undefined,
    },
  };
}
