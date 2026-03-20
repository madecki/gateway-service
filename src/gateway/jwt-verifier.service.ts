import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { request as undiciRequest } from 'undici';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import { AppConfigService } from '../config';

interface JwkKey {
  kid: string;
  kty: string;
  n: string;
  e: string;
}

@Injectable()
export class JwtVerifierService implements OnModuleInit {
  private readonly logger = new Logger(JwtVerifierService.name);
  // kid → PEM-encoded public key
  private readonly keyCache = new Map<string, string>();
  private lastFetchedAt = 0;
  private readonly cacheTtlMs = 10 * 60 * 1000; // 10 minutes

  constructor(private readonly config: AppConfigService) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.refreshKeys();
    } catch {
      this.logger.warn('Could not pre-fetch JWKS on startup — will retry on first request');
    }
  }

  async verify(token: string): Promise<string> {
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || typeof decoded === 'string') {
      throw new Error('Malformed token');
    }

    const kid = decoded.header.kid as string | undefined;
    let publicKey = kid ? this.keyCache.get(kid) : undefined;

    if (!publicKey || this.isCacheExpired()) {
      await this.refreshKeys();
      publicKey = kid ? this.keyCache.get(kid) : undefined;
    }

    if (!publicKey) {
      throw new Error(`No signing key found for kid: ${kid ?? '(none)'}`);
    }

    const payload = jwt.verify(token, publicKey, { algorithms: ['RS256'] }) as jwt.JwtPayload;
    if (!payload.sub) throw new Error('JWT is missing sub claim');
    return payload.sub;
  }

  private isCacheExpired(): boolean {
    return Date.now() - this.lastFetchedAt > this.cacheTtlMs;
  }

  private async refreshKeys(): Promise<void> {
    const jwksUrl = this.config.authJwksUrl;
    const response = await undiciRequest(jwksUrl, { method: 'GET' });
    const body = (await response.body.json()) as { keys: JwkKey[] };

    this.keyCache.clear();
    for (const key of body.keys) {
      const publicKey = crypto.createPublicKey({
        key: key as unknown as crypto.JsonWebKey,
        format: 'jwk',
      });
      const pem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
      this.keyCache.set(key.kid, pem);
    }

    this.lastFetchedAt = Date.now();
    this.logger.log(`Loaded ${body.keys.length} JWKS key(s) from ${jwksUrl}`);
  }
}
