import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  CustomProvider,
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
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
  LocalContextualScanner,
  type LocalAiAvailability,
  type OnDeviceRunner,
} from './localAi';

export interface CloudResult {
  rawText: string;
  model: string;
  mode: 'firebase-cloud' | 'mock-cloud';
  latencyMs: number;
}

export interface CloudClient {
  readonly isFirebaseConfigured: boolean;
  readonly modelName: string;
  generate(sanitizedPrompt: string, useMock: boolean): Promise<CloudResult>;
}

export interface GatewayTelemetry {
  firebaseConfigured: boolean;
  cloudModel: string;
  appCheckMode: 'debug-token' | 'recaptcha-enterprise' | 'mv3-pending-attestation' | 'none';
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
  appCheckDebugToken?: string;
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
    appCheckDebugToken:
      import.meta.env.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN?.trim() || undefined,
    recaptchaEnterpriseSiteKey:
      import.meta.env.VITE_FIREBASE_RECAPTCHA_ENTERPRISE_SITE_KEY?.trim() || undefined,
  };
}

/**
 * Firebase AI Logic on-device runner using InferenceMode.ONLY_ON_DEVICE.
 * Critically NEVER uses PREFER_ON_DEVICE so raw prompts cannot fall back to cloud.
 */
class FirebaseOnlyOnDeviceRunner implements OnDeviceRunner {
  readonly engine = 'firebase-only-on-device' as const;
  private readonly probe = new ChromeLanguageModelRunner();

  constructor(private readonly ai: AI) {}

  checkAvailability(): Promise<{ status: LocalAiAvailability; reason?: string }> {
    return this.probe.checkAvailability();
  }

  async prompt(systemPrompt: string, userPrompt: string): Promise<string> {
    const model = getGenerativeModel(this.ai, {
      mode: InferenceMode.ONLY_ON_DEVICE,
    });
    const res = await model.generateContent(`${systemPrompt}\n\n${userPrompt}`);
    return res.response.text();
  }
}

async function runMockCloudResponse(sanitizedPrompt: string): Promise<CloudResult> {
  const started = performance.now();
  await new Promise((r) => setTimeout(r, 220));
  const placeholders = Array.from(
    new Set(sanitizedPrompt.match(/\[[A-Z_]+_\d+\]/g) ?? []),
  );

  const rawText = [
    '[MOCK CLOUD RESPONSE — Firebase credentials not configured yet]',
    '',
    'I received only your sanitized prompt:',
    `"${sanitizedPrompt}"`,
    '',
    placeholders.length > 0
      ? `Placeholders preserved in cloud reply: ${placeholders.join(', ')}.`
      : 'No placeholders were present in the sanitized prompt.',
    '',
    placeholders.includes('[EMAIL_1]')
      ? `Draft reply referencing ${placeholders.includes('[PERSON_1]') ? '[PERSON_1]' : 'the recipient'} at [EMAIL_1]: Thank you for the update — I have reviewed the details and will follow up shortly.`
      : 'Tip: Once you add Firebase config to extension/.env.local, switch off Mock Mode to call live Gemini via Firebase AI Logic.',
  ].join('\n');

  return {
    rawText,
    model: 'mock-cloud-simulator',
    mode: 'mock-cloud',
    latencyMs: Math.round(performance.now() - started),
  };
}

class HybridCloudClient implements CloudClient {
  readonly isFirebaseConfigured: boolean;
  readonly modelName: string;

  constructor(
    private readonly ai: AI | null,
    modelName: string,
  ) {
    this.isFirebaseConfigured = ai !== null;
    this.modelName = modelName;
  }

  async generate(sanitizedPrompt: string, useMock: boolean): Promise<CloudResult> {
    if (useMock || !this.ai) {
      return runMockCloudResponse(sanitizedPrompt);
    }

    const started = performance.now();
    const model = getGenerativeModel(this.ai, {
      model: this.modelName,
      mode: InferenceMode.ONLY_IN_CLOUD,
      systemInstruction: CLOUD_SYSTEM_INSTRUCTION,
    });
    const result = await model.generateContent(sanitizedPrompt);
    return {
      rawText: result.response.text(),
      model: this.modelName,
      mode: 'firebase-cloud',
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
      localScanner: new LocalContextualScanner(new ChromeLanguageModelRunner()),
      cloudClient: new HybridCloudClient(null, 'mock-cloud-simulator'),
      telemetry: {
        firebaseConfigured: false,
        cloudModel: 'unconfigured',
        appCheckMode: 'none',
        note: 'Firebase AI Logic is not configured yet. Using Mock Cloud mode for E2E testing until extension/.env.local is populated.',
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

  let appCheckMode: GatewayTelemetry['appCheckMode'] = 'none';
  if (env.appCheckDebugToken) {
    (self as unknown as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN =
      env.appCheckDebugToken;
    initializeAppCheck(app, {
      provider: new CustomProvider({
        getToken: async () => {
          throw new Error('App Check debug token expected to handle token exchange.');
        },
      }),
      isTokenAutoRefreshEnabled: true,
    });
    appCheckMode = 'debug-token';
  } else if (!isExtension && env.recaptchaEnterpriseSiteKey) {
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(env.recaptchaEnterpriseSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
    appCheckMode = 'recaptcha-enterprise';
  } else {
    appCheckMode = 'mv3-pending-attestation';
  }

  const ai = getAI(app, { backend: new GoogleAIBackend() });

  return {
    localScanner: new LocalContextualScanner(new FirebaseOnlyOnDeviceRunner(ai)),
    cloudClient: new HybridCloudClient(ai, env.cloudModel),
    telemetry: {
      firebaseConfigured: true,
      cloudModel: env.cloudModel,
      appCheckMode,
      note:
        appCheckMode === 'mv3-pending-attestation'
          ? 'MV3 CSP blocks remote reCAPTCHA scripts. Set VITE_FIREBASE_APPCHECK_DEBUG_TOKEN in extension/.env.local for local dev.'
          : undefined,
    },
  };
}
